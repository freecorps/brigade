import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, REMINDER_HOUR, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import type { BrigadeEvent } from "../../src/outbox.ts";
import * as events from "../events.ts";
import * as mailer from "../mailer.ts";
import * as members from "../members.ts";
import * as paging from "../paging.ts";
import schema from "../schema.ts";
import * as workspace from "../workspace.ts";

// 08:00 UTC: a reminder (09:00 on the member's clock, UTC without a time zone) is due an hour later.
const T = Date.UTC(2026, 10, 7, REMINDER_HOUR - 1, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const CAIO = "usr_caio";
const EVA = "usr_eva";
const MINUTE = 60 * 1000;

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

let ids = 0;
const id = (prefix: string) => newId(prefix, T, (n) => new Uint8Array(n).fill(++ids % 250));

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, events, members, paging, mailer, test: { rows } },
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
    );
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  const outbox = () =>
    table("events")
      .sort((a, b) => (a.seq as number) - (b.seq as number))
      .map((row) => JSON.parse(row.event as string) as BrigadeEvent);
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  for (const [user, name] of [
    [ANA, "Ana"],
    [CAIO, "Caio"],
    [EVA, "Eva"],
  ] as const) {
    const actor: Actor = { kind: "user", id: user, role: "owner" };
    expect(server("member.sync", { id: user, name, role: "owner" }, actor)).toEqual({ ok: true });
  }
  for (const [user, fill] of [
    [CAIO, 1],
    [EVA, 2],
  ] as const) {
    expect(
      mutate(
        "device.register",
        {
          id: newId("dev", T, (n) => new Uint8Array(n).fill(fill)),
          platform: "ios",
          environment: "sandbox",
          pushToken: String(fill).repeat(64).slice(0, 64),
          voipToken: null,
          publicKey: `B${"A".repeat(86)}`,
        },
        user,
      ).value,
    ).toEqual({ ok: true });
  }
  return {
    engine,
    mutate,
    table,
    outbox,
    call: (fn: string, args: unknown) => engine.runMutation(fn, args),
    tick: (ms: number) => (clock += ms),
    now: () => clock,
  };
}

/** Caio always on call; a default policy: the schedule, then Eva, 5 minutes apart. */
function withPolicy(s: ReturnType<typeof shard>) {
  const schedule = id("sch");
  expect(
    s.mutate("schedule.create", {
      id: schedule,
      name: "Primary",
      timeZone: "UTC",
      layers: [
        {
          id: id("lyr"),
          name: "",
          members: [CAIO],
          startDate: "2026-01-01",
          handoffTime: "09:00",
          unit: "weeks",
          count: 1,
        },
      ],
    }).value,
  ).toEqual({ ok: true });
  expect(
    s.mutate("escalation.createPolicy", {
      id: id("esc"),
      name: "Checkout",
      levels: [
        { id: id("lvl"), targets: [{ kind: "schedule", id: schedule }], timeoutMinutes: 5 },
        { id: id("lvl"), targets: [{ kind: "member", id: EVA }], timeoutMinutes: 5 },
      ],
      repeat: 0,
      isDefault: true,
    }).value,
  ).toEqual({ ok: true });
}

const ticks = (out: { scheduled: { fn: string }[] }) =>
  out.scheduled.filter((job) => job.fn === "paging:tick") as unknown as { runAt: number }[];

describe("escalation on Ember", () => {
  test("a page starts the run and schedules the tick at its next level, which fires it once", () => {
    const s = shard();
    withPolicy(s);
    const incident = id("inc");
    expect(
      s.mutate("incident.declare", { id: incident, title: "Checkout is down", severity: "sev1" })
        .value,
    ).toEqual({ ok: true });
    const declared = s.outbox().find((e) => e.type === "incident.declared")!;
    const planned = s.call("paging:plan", { event: declared });
    expect(planned.value).toMatchObject({ send: true });
    const run = (s.table("incidents").find((row) => row.id === incident)!.escalation ?? null) as {
      status: string;
      nextAt: number;
    } | null;
    expect(run).toMatchObject({ status: "running" });
    expect(ticks(planned).map((job) => job.runAt)).toContain(run!.nextAt);

    // Before the timeout: nothing fires.
    s.tick(4 * MINUTE);
    expect(s.call("paging:tick", {}).value).toMatchObject({ fired: 0 });
    s.tick(MINUTE + 1);
    expect(s.call("paging:tick", {}).value).toMatchObject({ fired: 1 });
    const levels = s.outbox().filter((e) => e.type === "escalation.paged");
    expect(levels.map((e) => (e.data as { level: number }).level)).toEqual([1, 2]);
    // Again before the next timeout: the level fired once.
    expect(s.call("paging:tick", {}).value).toMatchObject({ fired: 0 });
    expect(s.outbox().filter((e) => e.type === "escalation.paged")).toHaveLength(2);
  });

  test("an acknowledged incident's timer fires nothing", () => {
    const s = shard();
    withPolicy(s);
    const incident = id("inc");
    s.mutate("incident.declare", { id: incident, title: "Checkout is down", severity: "sev1" });
    const declared = s.outbox().find((e) => e.type === "incident.declared")!;
    s.call("paging:plan", { event: declared });
    expect(s.mutate("incident.ack", { id: incident }, CAIO).value).toEqual({ ok: true });
    s.tick(5 * MINUTE + 1);
    expect(s.call("paging:tick", {}).value).toMatchObject({ fired: 0 });
    expect(s.outbox().filter((e) => e.type === "escalation.paged")).toHaveLength(1);
  });
});

describe("follow-up reminders on Ember", () => {
  test("a follow-up due today arms the tick for the owner's reminder, which runs once that day", () => {
    const s = shard();
    const incident = id("inc");
    s.mutate("incident.declare", { id: incident, title: "Checkout is down" });
    const created = s.mutate("followUp.create", {
      id: id("fup"),
      incidentId: incident,
      title: "Add an index",
      ownerId: CAIO,
      dueDate: "2026-11-07",
      link: null,
    });
    expect(created.value).toEqual({ ok: true });
    // The mutation itself arms the tick, at 09:00 UTC.
    expect(created.scheduled.filter((job) => job.fn === "paging:remind")).toHaveLength(1);
    expect(s.call("paging:remind", {}).value).toEqual({ reminded: 0 });
    s.tick(60 * MINUTE);
    // The paging tick reads no follow-up and reminds nobody: a large follow-up history never weighs on a page.
    expect(s.call("paging:tick", {}).value).toEqual({ fired: 0, released: 0, replayed: 0 });
    expect(s.outbox().filter((e) => e.type === "follow_up.reminder_due")).toEqual([]);
    expect(s.call("paging:remind", {}).value).toEqual({ reminded: 1 });
    expect(s.outbox().filter((e) => e.type === "follow_up.reminder_due")).toHaveLength(1);
    s.tick(MINUTE);
    expect(s.call("paging:remind", {}).value).toEqual({ reminded: 0 });
  });
});

describe("emails on Ember", () => {
  test("a page that failed plans its email once; recorded sent, it is done", () => {
    const s = shard();
    const incident = id("inc");
    s.mutate("incident.declare", { id: incident, title: "Checkout is down", severity: "sev1" });
    const declared = s.outbox().find((e) => e.type === "incident.declared")!;
    s.call("paging:plan", { event: declared });
    s.call("paging:record", {
      event: declared,
      outcomes: [CAIO, EVA].map((userId, i) => ({
        deviceId: newId("dev", T, (n) => new Uint8Array(n).fill(i + 1)),
        userId,
        ok: false,
        reason: "undelivered",
        error: "relay_refused",
      })),
      final: true,
    });
    const failed = s
      .outbox()
      .find(
        (e) =>
          e.type === "notification.failed" && (e.data as { channel?: string }).channel === "push",
      )!;
    expect(failed).toBeDefined();
    const plan = s.call("mailer:plan", { event: failed }).value as {
      send: boolean;
      jobs?: { key: string; about: string }[];
    };
    expect(plan.send).toBe(true);
    for (const job of plan.jobs!) {
      s.call("mailer:record", {
        event: failed,
        key: job.key,
        about: job.about,
        outcomes: [{ userId: (failed.data as { userId: string }).userId, ok: true }],
        final: true,
      });
    }
    expect(s.call("mailer:plan", { event: failed }).value).toMatchObject({ send: false });
    // Another workspace's event: nothing.
    expect(s.call("mailer:plan", { event: { ...failed, workspaceId: "ws_other" } }).value).toEqual({
      send: false,
      reason: "not_found",
    });
  });

  test("a reminder due plans one email for its member, and none once sent", () => {
    const s = shard();
    const incident = id("inc");
    s.mutate("incident.declare", { id: incident, title: "Checkout is down" });
    s.mutate("followUp.create", {
      id: id("fup"),
      incidentId: incident,
      title: "Add an index",
      ownerId: CAIO,
      dueDate: "2026-11-07",
      link: null,
    });
    s.tick(60 * MINUTE);
    s.call("paging:remind", {});
    const due = s.outbox().find((e) => e.type === "follow_up.reminder_due")!;
    expect(s.call("mailer:planReminder", { event: due }).value).toMatchObject({
      send: true,
      userId: CAIO,
    });
    s.call("mailer:recordReminder", {
      event: due,
      outcome: { userId: CAIO, ok: true },
      final: true,
    });
    expect(s.call("mailer:planReminder", { event: due }).value).toMatchObject({ send: false });
  });

  test("a member taken out of schedules plans the owners' email", () => {
    const s = shard();
    withPolicy(s);
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: { kind: "user", id: ANA, role: "owner" },
        name: "member.remove",
        args: { id: CAIO, role: "owner", reason: "removed" },
      }).value,
    ).toEqual({ ok: true });
    const removed = s.outbox().find((e) => e.type === "member.removed")!;
    const plan = s.call("mailer:planRotation", { event: removed }).value;
    expect(plan).toMatchObject({ send: true });
    s.call("mailer:recordRotation", { event: removed, outcomes: [], final: true });
    expect(s.call("mailer:planRotation", { event: removed }).value).toMatchObject({ send: false });
  });
});

describe("acknowledging on Ember", () => {
  test("an API token this shard does not back is refused; a member's ack runs once per key", () => {
    const s = shard();
    const incident = id("inc");
    s.mutate("incident.declare", { id: incident, title: "Checkout is down" });
    const ack = (actor: Actor, mutationId: string) =>
      s.call("paging:acknowledge", { workspaceId: WS, actor, incidentId: incident, mutationId })
        .value;
    const token: Actor = { kind: "token", id: "tok_unknown", role: "responder", by: CAIO };
    expect(ack(token, "k1")).toEqual({ ok: false, code: "unauthenticated" });
    const caio: Actor = { kind: "user", id: CAIO, role: "owner" };
    expect(ack(caio, "k1")).toEqual({ ok: true });
    expect(ack(caio, "k1")).toEqual({ ok: true });
    expect(ack(caio, "k2")).toEqual({ ok: false, code: "conflict" });
    expect(
      s.call("paging:acknowledge", {
        workspaceId: "ws_other",
        actor: caio,
        incidentId: incident,
        mutationId: "k3",
      }).value,
    ).toEqual({ ok: false, code: "not_found" });
  });
});
