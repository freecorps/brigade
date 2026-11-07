import {
  createEngine,
  internalMutationGeneric,
  queryGeneric,
  v,
  type MutationCtx,
  type QueryCtx,
} from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { PAGE_HOLD_MS } from "../../src/paging.ts";
import type { BrigadeEvent } from "../../src/outbox.ts";
import * as events from "../events.ts";
import * as paging from "../paging.ts";
import schema from "../schema.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const BIA = "usr_bia";

/** Documents of `table` (test only). */
const rows = queryGeneric({
  args: { table: v.string() },
  handler: (ctx: QueryCtx, { table }: { table: string }) =>
    (ctx.db as never as { query(t: string): { collect(): Record<string, unknown>[] } })
      .query(table)
      .collect()
      .map((row) =>
        typeof row.data === "string" ? (JSON.parse(row.data) as Record<string, unknown>) : row,
      ),
} as never);

/** Rows of a private ledger table (test only). */
const ledger = internalMutationGeneric({
  args: { statement: v.string() },
  handler: (ctx, { statement }: { statement: string }) => (ctx as MutationCtx).sql.exec(statement),
});

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, events, paging, test: { rows, ledger } },
    now: () => clock,
  });
  engine.migrate();
  const owner: Actor = { kind: "user", id: ANA, role: "owner" };
  const server = (name: string, args: unknown, actor: Actor = owner) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor }).value;
  const mutate = (name: string, args: unknown, as = ANA) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      { identity: { subject: as, claims: { role: "owner", ws: WS } } },
    ).value;
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args);
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  const sql = (statement: string) =>
    engine.runMutation("test:ledger", { statement }).value as Record<string, unknown>[];
  /** The events of the outbox, oldest first. */
  const outbox = () =>
    table("events")
      .sort((a, b) => (a.seq as number) - (b.seq as number))
      .map((row) => JSON.parse(row.event as string) as BrigadeEvent);
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  for (const [id, name] of [
    [ANA, "Ana"],
    [BIA, "Bia"],
  ] as const) {
    const actor: Actor = { kind: "user", id, role: "owner" };
    expect(server("member.sync", { id, name, role: "owner" }, actor)).toEqual({ ok: true });
  }
  const device = (as: string, fill: number) => {
    const phone = {
      id: newId("dev", T, (n) => new Uint8Array(n).fill(fill)),
      platform: "ios",
      environment: "sandbox",
      pushToken: String(fill).repeat(64).slice(0, 64),
      voipToken: null,
      publicKey: `B${"A".repeat(86)}`,
    };
    expect(mutate("device.register", phone, as)).toEqual({ ok: true });
    return phone.id;
  };
  const declare = (fill = 1) => {
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(fill));
    expect(mutate("incident.declare", { id, title: "Database down", severity: "sev1" })).toEqual({
      ok: true,
    });
    const event = outbox().findLast((e) => e.subject === id && e.type === "incident.declared")!;
    expect(event).toBeDefined();
    return { incident: id, event };
  };
  return {
    engine,
    server,
    mutate,
    call,
    table,
    sql,
    outbox,
    device,
    declare,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

const another = (event: BrigadeEvent, fill: number): BrigadeEvent => ({
  ...event,
  id: newId("evt", T, (n) => new Uint8Array(n).fill(fill)),
});

describe("paging on Ember", () => {
  test("a page plans the other members' phones once; recorded, it is done", () => {
    const s = shard();
    const phone = s.device(BIA, 1);
    const { incident, event } = s.declare();
    const plan = s.call("paging:plan", { event }).value;
    expect(plan).toMatchObject({ send: true, urgency: "page" });
    expect(JSON.stringify(plan)).toContain(phone);
    s.call("paging:record", {
      event,
      outcomes: [{ deviceId: phone, userId: BIA, ok: true }],
      final: true,
    });
    expect(s.call("paging:plan", { event }).value).toEqual({ send: false, reason: "done" });
    expect(s.sql("select device_id from page_deliveries")).toEqual([{ device_id: phone }]);
    // The incident's timeline has the page, written by the pager's own mutation.
    expect(s.table("timeline").filter((row) => row.incidentId === incident)).not.toEqual([]);
  });

  test("an event of another workspace, or for no page, sends nothing", () => {
    const s = shard();
    s.device(BIA, 1);
    const { event } = s.declare();
    expect(s.call("paging:plan", { event: { ...event, workspaceId: "ws_other" } }).value).toEqual({
      send: false,
      reason: "not_found",
    });
    const created = s.outbox().find((e) => e.type === "workspace.created")!;
    expect(s.call("paging:plan", { event: created }).value).toEqual({
      send: false,
      reason: "not_a_page",
    });
  });

  test("a failed page is on the incident's timeline, through the shard's own mutation", () => {
    const s = shard();
    const phone = s.device(BIA, 1);
    const { incident, event } = s.declare();
    s.call("paging:plan", { event });
    s.call("paging:record", {
      event,
      outcomes: [
        { deviceId: phone, userId: BIA, ok: false, reason: "undelivered", error: "relay_refused" },
      ],
      final: true,
    });
    const kinds = s
      .table("timeline")
      .filter((row) => row.incidentId === incident)
      .map((row) => row.kind);
    expect(kinds).toContain("page_failed");
  });

  test("a SEV3 push waits behind an unconfirmed page; the tick releases it once its hold ran out", () => {
    const s = shard();
    const phone = s.device(BIA, 1);
    const { incident, event } = s.declare();
    s.call("paging:plan", { event });
    s.call("paging:record", {
      event,
      outcomes: [{ deviceId: phone, userId: BIA, ok: true }],
      final: true,
    });
    expect(s.mutate("incident.setSeverity", { id: incident, severity: "sev3" })).toEqual({
      ok: true,
    });
    const later = another(event, 9);
    const out = s.call("paging:plan", { event: later });
    expect(out.value).toMatchObject({ send: false });
    expect(s.sql("select event_id, state from page_held")).toEqual([
      { event_id: later.id, state: "held" },
    ]);
    // One tick is scheduled at the hold's end, and planning again leaves that one.
    const ticks = out.scheduled.filter((job) => job.fn === "paging:tick");
    expect(ticks).toHaveLength(1);
    const newest = another(event, 10);
    expect(
      s.call("paging:plan", { event: newest }).scheduled.filter((job) => job.fn === "paging:tick"),
    ).toHaveLength(0);

    s.tick(PAGE_HOLD_MS - 60_000);
    expect(s.call("paging:tick", {}).value).toEqual({ released: 0, replayed: 0 });
    s.tick(60_001);
    expect(s.call("paging:tick", {}).value).toMatchObject({ released: 1 });
    expect(s.outbox().filter((e) => e.type === "notification.released")).toMatchObject([
      // The newest push goes; the one it came after is passed over.
      { data: { eventId: newest.id, deviceIds: [phone] } },
    ]);
  });

  test("a dead-lettered page is recorded on the shard; another workspace's is not", () => {
    const s = shard();
    s.device(BIA, 1);
    const { incident, event } = s.declare();
    expect(
      s.call("paging:deadLettered", { event: { ...event, workspaceId: "ws_other" } }).value,
    ).toBe("other_workspace");
    expect(s.call("paging:deadLettered", { event }).value).toBe("recorded");
    expect(
      s
        .table("timeline")
        .filter((row) => row.incidentId === incident)
        .map((row) => row.kind),
    ).toContain("page_failed");
  });

  test("an overdue tick is waited for, and replaced once it looks lost", () => {
    const s = shard();
    const phone = s.device(BIA, 1);
    const { incident, event } = s.declare();
    s.call("paging:plan", { event });
    s.call("paging:record", {
      event,
      outcomes: [{ deviceId: phone, userId: BIA, ok: true }],
      final: true,
    });
    s.mutate("incident.setSeverity", { id: incident, severity: "sev3" });
    const ticks = (out: { scheduled: { fn: string }[] }) =>
      out.scheduled.filter((job) => job.fn === "paging:tick").length;
    expect(ticks(s.call("paging:plan", { event: another(event, 9) }))).toBe(1);
    // Its time came and it has not run yet: still queued, nothing new.
    s.tick(PAGE_HOLD_MS + 1000);
    expect(ticks(s.call("paging:plan", { event: another(event, 10) }))).toBe(0);
    // Long past its time: taken for lost, another goes in.
    s.tick(paging.TICK_LEASE_MS);
    expect(ticks(s.call("paging:plan", { event: another(event, 11) }))).toBe(1);
  });
});
