import {
  createEngine,
  internalMutationGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import {
  DRAIN_BATCH_BYTES,
  DRAIN_RETRY_FIRST_MS,
  DRAIN_RETRY_MAX_MS,
  MAX_EVENT_BYTES,
} from "../../src/outbox.ts";
import * as events from "../events.ts";
import { local } from "./stubs.ts";
import schema from "../schema.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const owner: Actor = { kind: "user", id: "usr_ana", role: "owner" };

/** Writes one event row of `size` bytes straight to `events`, after the newest (test only). */
const big = internalMutationGeneric({
  args: { size: v.number(), id: v.optional(v.string()) },
  handler: (ctx, { size, id = "evt_big" }: { size: number; id?: string }) => {
    const c = ctx as MutationCtx;
    const body = { id, type: "test.big", workspaceId: WS, pad: "x".repeat(size) };
    (c.db as never as { insert(t: string, v: object): string }).insert("events", {
      id,
      seq: events.nextSeq(c.db, {}),
      type: "test.big",
      at: c.now,
      event: JSON.stringify(body),
    });
    events.scheduleDrain(c);
    return null;
  },
});

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, test: { big } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor: owner });
  const declare = (fill: number) =>
    engine.runMutation(
      "workspace:mutate",
      {
        name: "incident.declare",
        args: {
          id: newId("inc", T, (n) => new Uint8Array(n).fill(fill)),
          title: `Incident ${fill}`,
        },
      },
      { identity: { subject: "usr_ana", claims: { role: "owner", ws: WS } } },
    );
  return { engine, server, declare, tick: (ms: number) => (clock += ms) };
}

const drains = (out: { scheduled: { fn: string }[] }) =>
  out.scheduled.filter((job) => job.fn === "events:drain").length;

describe("event delivery on Ember", () => {
  test("a mutation with events schedules one drain; more events wait for it", () => {
    const s = shard();
    expect(drains(s.server("workspace.create", { id: WS, name: "Freecorps" }))).toBe(1);
    expect(drains(s.server("member.sync", { id: "usr_ana", name: "Ana", role: "owner" }))).toBe(0);
    expect(drains(s.declare(1))).toBe(0);
    // A drain pending past its lease is replaced by the next event's.
    s.tick(events.DRAIN_LEASE_MS + 1);
    expect(drains(s.declare(2))).toBe(1);
  });

  test("pending hands them out in seq order; sent deletes them and clears the mark", () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    s.server("member.sync", { id: "usr_ana", name: "Ana", role: "owner" });
    s.declare(1);
    const batch = s.engine.runQuery("events:pending", {}).value as {
      lastSeq: number;
      bodies: { type: string; workspaceId: string }[];
    };
    expect(batch.bodies.map((body) => body.type)).toEqual([
      "workspace.created",
      "incident.declared",
    ]);
    expect(batch.bodies.every((body) => body.workspaceId === WS)).toBe(true);
    expect(batch.lastSeq).toBe(2);
    // Only up to what was sent: an event written since stays.
    s.declare(2);
    const after = s.engine.runMutation("events:sent", { lastSeq: batch.lastSeq, more: false });
    expect(after.value).toBe(true);
    expect(drains(after)).toBe(1);
    const rest = s.engine.runQuery("events:pending", {}).value as {
      lastSeq: number;
      bodies: unknown[];
    };
    expect(rest).toMatchObject({ lastSeq: 3 });
    expect(rest.bodies).toHaveLength(1);
    const done = s.engine.runMutation("events:sent", { lastSeq: rest.lastSeq, more: false });
    expect(done.value).toBe(false);
    expect(s.engine.runQuery("events:pending", {}).value).toBeNull();
    // The mark is gone: the next event schedules a drain at once.
    expect(drains(s.declare(3))).toBe(1);
  });
});

describe("the drain itself", () => {
  /** Runs `events:drain`'s handler over the test engine, with `send` as the Queue. */
  async function drainWith(
    s: ReturnType<typeof shard>,
    send: (messages: { body: { id: string } }[]) => Promise<void>,
    attempt?: number,
  ) {
    const scheduled: { fn: string; delay: number; args: unknown }[] = [];
    const ctx = {
      env: { EVENTS: { sendBatch: send } },
      runQuery: async (ref: unknown, args: unknown) => s.engine.runQuery(ref as never, args).value,
      runMutation: async (ref: unknown, args: unknown) =>
        s.engine.runMutation(ref as never, args).value,
      scheduler: {
        runAfter: async (delay: number, fn: string, args: unknown) => {
          scheduled.push({ fn, delay, args });
          return "job";
        },
      },
    };
    const drain = events.drain as unknown as {
      handler: (c: unknown, a: unknown) => Promise<number>;
    };
    const sent = await drain.handler(ctx, attempt === undefined ? {} : { attempt });
    return { sent, scheduled };
  }

  test("sends in seq order, deletes what went, and clears the mark", async () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    s.server("member.sync", { id: "usr_ana", name: "Ana", role: "owner" });
    s.declare(1);
    s.declare(2);
    const got: string[] = [];
    const { sent, scheduled } = await drainWith(s, async (messages) => {
      got.push(...messages.map((m) => (m.body as unknown as { type: string }).type));
    });
    expect(sent).toBe(3);
    expect(got).toEqual(["workspace.created", "incident.declared", "incident.declared"]);
    expect(scheduled).toEqual([]);
    expect(s.engine.runQuery("events:pending", {}).value).toBeNull();
    expect(drains(s.declare(3))).toBe(1);
  });

  test("a failed send keeps the rows and backs off, doubling each time up to the cap", async () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    const fail = async () => {
      throw new Error("queue down");
    };
    const first = await drainWith(s, fail);
    expect(first.sent).toBe(0);
    expect(first.scheduled).toEqual([
      { fn: "events:drain", delay: DRAIN_RETRY_FIRST_MS, args: { attempt: 1 } },
    ]);
    const third = await drainWith(s, fail, 2);
    expect(third.scheduled[0]!.delay).toBe(DRAIN_RETRY_FIRST_MS * 4);
    const late = await drainWith(s, fail, 40);
    expect(late.scheduled[0]!.delay).toBe(DRAIN_RETRY_MAX_MS);
    // Nothing was lost: the event is still there for the next try.
    expect(
      (s.engine.runQuery("events:pending", {}).value as { bodies: unknown[] }).bodies,
    ).toHaveLength(1);
    // And the mark is fresh: a new event does not start a second drain beside the retry.
    expect(drains(s.declare(1))).toBe(0);
  });

  test("an event too large for the Queue is dropped, the rest goes", async () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    s.engine.runMutation(makeFunctionReference<"mutation">("test:big") as never, {
      size: MAX_EVENT_BYTES + 1,
    });
    s.declare(1);
    const batch = s.engine.runQuery("events:pending", {}).value as {
      bodies: { type: string }[];
      dropped: string[];
    };
    expect(batch.dropped).toEqual(["evt_big"]);
    expect(batch.bodies.map((body) => body.type)).toEqual([
      "workspace.created",
      "incident.declared",
    ]);
  });

  test("a batch stops at the byte bound and the rest waits for the next one", () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    for (let i = 0; i < 3; i++) {
      s.engine.runMutation(makeFunctionReference<"mutation">("test:big") as never, {
        size: Math.floor(DRAIN_BATCH_BYTES / 2.5),
        id: `evt_${i}`,
      });
    }
    const batch = s.engine.runQuery("events:pending", {}).value as { bodies: { id: string }[] };
    // workspace.created plus two of the three large ones fit; the third waits.
    expect(batch.bodies.map((body) => body.id).slice(1)).toEqual(["evt_0", "evt_1"]);
  });
});
