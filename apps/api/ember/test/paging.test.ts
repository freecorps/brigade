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
import { PAGE_HOLD_MS, PAGE_LOCAL_TRIES, PAGE_QUEUE_GRACE_MS } from "../../src/paging.ts";
import { RECEIPT_RATE_PER_MINUTE } from "../../src/receipts.ts";
import type { BrigadeEvent } from "../../src/outbox.ts";
import * as events from "../events.ts";
import { local } from "./stubs.ts";
import * as members from "../members.ts";
import * as paging from "../paging.ts";
import schema from "../schema.ts";
import { EmberShard } from "../shard-facade.ts";
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

/** `ctx` with a `db` whose writes fail, as a full disk would. */
function fullDisk(c: MutationCtx): MutationCtx {
  const db = new Proxy(c.db as object, {
    get(target, key) {
      if (key === "insert" || key === "patch") {
        return () => {
          throw new Error("SQLITE_FULL: database or disk is full");
        };
      }
      const value = (target as Record<string | symbol, unknown>)[key];
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  return { ...c, db } as MutationCtx;
}

/** A mutation through `EmberShard` over a full disk (test only). */
const failingDisk = internalMutationGeneric({
  args: { id: v.string() },
  handler: (ctx, { id }: { id: string }) => {
    const c = ctx as MutationCtx;
    const shard = new EmberShard(fullDisk(c));
    return shard.mutate({
      clientId: "test",
      mutationId: "m1",
      actor: { kind: "user", id: ANA, role: "owner" },
      name: "incident.declare",
      args: { id, title: "Disk full" },
      now: c.now,
    }).result;
  },
});

/** `paging:tick` over a full disk (test only). */
const tickOnFullDisk = internalMutationGeneric({
  args: {},
  handler: (ctx) =>
    (paging.tick as unknown as { handler: (c: MutationCtx, a: object) => unknown }).handler(
      fullDisk(ctx as MutationCtx),
      {},
    ),
});

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
    functions: {
      workspace,
      local,
      events,
      members,
      paging,
      test: { rows, ledger, failingDisk, tickOnFullDisk },
    },
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
    expect(s.call("paging:tick", {}).value).toMatchObject({ released: 0, replayed: 0 });
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
    const replaced = s.call("paging:plan", { event: another(event, 11) }).scheduled;
    expect(replaced.filter((job) => job.fn === "paging:tick")).toMatchObject([{ runAt: s.now() }]);
  });

  test("work still due after a tick waits TICK_RETRY_MS, so a failing release never spins the alarm", () => {
    const s = shard();
    const phone = s.device(BIA, 1);
    // Two incidents, paged 2 s apart, each with a SEV3 push held behind its page.
    const hold = (fill: number) => {
      const { incident, event } = s.declare(fill);
      s.call("paging:plan", { event });
      s.call("paging:record", {
        event,
        outcomes: [{ deviceId: phone, userId: BIA, ok: true }],
        final: true,
      });
      s.mutate("incident.setSeverity", { id: incident, severity: "sev3" });
      s.call("paging:plan", { event: another(event, fill + 20) });
    };
    hold(1);
    s.tick(2000);
    hold(2);
    // The first hold ran out; the second runs out 2 s later, which a tick asks for no sooner than TICK_RETRY_MS.
    s.tick(PAGE_HOLD_MS - 2000 + 1);
    const out = s.call("paging:tick", {});
    expect(out.value).toMatchObject({ released: 1 });
    expect(out.scheduled.filter((job) => job.fn === "paging:tick")).toMatchObject([
      { runAt: s.now() + paging.TICK_RETRY_MS },
    ]);
  });

  test("a page whose member check failed schedules a durable member repair", () => {
    const s = shard();
    s.device(BIA, 1);
    const { event } = s.declare();
    const repairs = (out: { scheduled: { fn: string }[] }) =>
      out.scheduled.filter((job) => job.fn === "members:repair").length;
    expect(repairs(s.call("paging:plan", { event }))).toBe(0);
    expect(repairs(s.call("paging:plan", { event: another(event, 9), repair: true }))).toBe(1);
  });

  test("a storage failure under the facade aborts the Ember mutation instead of storing an internal result", () => {
    const s = shard();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(7));
    expect(() => s.call("test:failingDisk", { id })).toThrow(/SQLITE_FULL/);
    expect(s.table("incidents").map((row) => row.id)).not.toContain(id);
    expect(s.sql("select mutation_id from mutation_results")).toEqual([]);
  });

  test("a release whose storage fails fails the whole tick: the push stays held for the next one", () => {
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
    const later = another(event, 9);
    s.call("paging:plan", { event: later });
    s.tick(PAGE_HOLD_MS + 1);
    for (let i = 0; i < 3; i++) {
      expect(() => s.call("test:tickOnFullDisk", {})).toThrow(/could not be written|SQLITE_FULL/);
      expect(s.sql("select state from page_held")).toEqual([{ state: "held" }]);
    }
    expect(s.outbox().filter((e) => e.type === "notification.released")).toEqual([]);
    // The disk is back: the next tick releases it.
    expect(s.call("paging:tick", {}).value).toMatchObject({ released: 1 });
    expect(s.sql("select state from page_held")).toEqual([{ state: "released" }]);
  });
});

describe("pages the Queue is late with, on Ember", () => {
  test("a page written is watched, and the shard's send is armed for when the Queue's grace runs out", () => {
    const s = shard();
    s.device(BIA, 1);
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    const declared = s.engine.runMutation(
      "workspace:mutate",
      { name: "incident.declare", args: { id, title: "Database down", severity: "sev1" } },
      { identity: { subject: ANA, claims: { role: "owner", ws: WS } } },
    );
    const sends = declared.scheduled.filter((job) => job.fn === "local:send") as unknown as {
      runAt: number;
    }[];
    expect(sends.map((job) => job.runAt)).toEqual([T + PAGE_QUEUE_GRACE_MS]);
    const event = s.outbox().find((e) => e.type === "incident.declared")!;
    expect(s.sql("select event_id from page_pending")).toEqual([{ event_id: event.id }]);
    // The shard's own plan leaves it watched; the Queue's ends the watch.
    s.call("paging:plan", { event, local: true });
    expect(s.sql("select event_id from page_pending")).toHaveLength(1);
    s.call("paging:plan", { event });
    expect(s.sql("select event_id from page_pending")).toEqual([]);
  });

  test("an overdue page is leased; sent, its watch ends; refused, it comes back, at most PAGE_LOCAL_TRIES times", () => {
    const s = shard();
    s.device(BIA, 1);
    const { event } = s.declare();
    expect(s.call("paging:overdue", {}).value).toEqual([]);
    s.tick(PAGE_QUEUE_GRACE_MS);
    const leased = s.call("paging:overdue", {});
    expect(leased.value).toMatchObject([{ event: { id: event.id }, tries: 1 }]);
    // Leased: not handed out again until its lease runs out, and the next send is armed for then.
    expect(s.call("paging:overdue", {}).value).toEqual([]);
    expect(leased.scheduled.some((job) => job.fn === "local:send")).toBe(true);
    // Its wakes are the shard's own send's, not the paging tick's.
    expect(leased.scheduled.some((job) => job.fn === "paging:tick")).toBe(false);
    for (let tries = 1; tries < PAGE_LOCAL_TRIES; tries++) {
      s.call("paging:localDone", { eventId: event.id, tries, sent: false });
      s.tick(60 * 1000);
      expect(s.call("paging:overdue", {}).value).toMatchObject([{ tries: tries + 1 }]);
    }
    // Out of tries: left to the Queue.
    s.call("paging:localDone", { eventId: event.id, tries: PAGE_LOCAL_TRIES, sent: false });
    expect(s.sql("select event_id from page_pending")).toEqual([]);
  });

  test("a Retry-After holds a leased page back; a sent one ends its watch", () => {
    const s = shard();
    s.device(BIA, 1);
    const { event } = s.declare();
    s.tick(PAGE_QUEUE_GRACE_MS);
    s.call("paging:overdue", {});
    s.call("paging:localDone", {
      eventId: event.id,
      tries: 1,
      sent: false,
      until: s.now() + 300_000,
    });
    s.tick(60 * 1000);
    expect(s.call("paging:overdue", {}).value).toEqual([]);
    s.tick(240 * 1000);
    expect(s.call("paging:overdue", {}).value).toMatchObject([{ tries: 2 }]);
    s.call("paging:localDone", { eventId: event.id, tries: 2, sent: true });
    expect(s.sql("select event_id from page_pending")).toEqual([]);
  });
});

describe("delivery receipts, on Ember", () => {
  test("a receipt is recorded once, releases what its page held back, and is rate limited per device", () => {
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
    const later = another(event, 9);
    s.call("paging:plan", { event: later });
    expect(s.sql("select state from page_held")).toEqual([{ state: "held" }]);
    const claim = { workspaceId: WS, incidentId: incident, eventId: event.id, deviceId: phone };
    expect(s.call("paging:receipt", claim).value).toBe("recorded");
    // The page is confirmed: the push held behind it goes now, without waiting for the hold.
    expect(s.sql("select state from page_held")).toEqual([{ state: "released" }]);
    expect(s.call("paging:receipt", claim).value).toBe("already");
    expect(s.call("paging:receipt", { ...claim, workspaceId: "ws_other" }).value).toBe("invalid");
    expect(s.call("paging:receipt", { ...claim, eventId: another(event, 8).id }).value).toBe(
      "not_found",
    );
    // Three counted so far (the other workspace's is refused before the rate).
    for (let i = 3; i < RECEIPT_RATE_PER_MINUTE; i++) s.call("paging:receipt", claim);
    expect(s.call("paging:receipt", claim).value).toBe("rate_limited");
  });
});
