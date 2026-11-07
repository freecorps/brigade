import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as monitors from "../monitors.ts";
import * as status from "../status.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

// The real clock: the publisher and the page's mutation ids go by `Date.now()`, as on the DO.
const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const owner = { kind: "user", id: ANA, role: "owner" } as const;

const rows = queryGeneric({
  args: { table: v.string() },
  handler: (ctx: QueryCtx, { table }: { table: string }) =>
    (ctx.db as never as { query(t: string): { collect(): { data: string }[] } })
      .query(table)
      .collect()
      .map((row) => JSON.parse(row.data) as Record<string, unknown>),
} as never);

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, monitors, status, test: { rows } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor: owner }).value;
  const mutate = (name: string, args: unknown) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      { identity: { subject: ANA, claims: { role: "owner", ws: WS } } },
    );
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args);
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  expect(server("member.sync", { id: ANA, name: "Ana", role: "owner" })).toEqual({ ok: true });
  return { mutate, call, table, tick: (ms: number) => (clock += ms) };
}

const page = { slug: "acme", title: "Acme", locale: "en", enabled: true };

type Plan = {
  workspaceId: string;
  now: number;
  plan: { dirty?: number; page?: { key: string; put?: string }; retired: unknown[] };
};

describe("the status page on Ember", () => {
  test("the shard's checks come first, then the page as it is", () => {
    const s = shard();
    expect(s.call("status:current", { workspaceId: "ws_other", actor: owner }).value).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(s.call("status:current", { workspaceId: WS, actor: owner }).value).toEqual({
      ok: true,
      acting: owner,
      page: null,
    });
  });

  test("a page set up arms the push, which puts its snapshot in KV and records it", () => {
    const s = shard();
    const set = s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    expect(set.value).toEqual({ ok: true });
    expect(set.scheduled.map((job) => job.fn)).toContain("status:push");
    const planned = s.call("status:plan", { kv: true });
    // A fallback, so an action that dies before `record` never ends the chain.
    expect(planned.scheduled.map((job) => job.fn)).toContain("status:push");
    const due = planned.value as Plan;
    expect(due.workspaceId).toBe(WS);
    expect(due.plan.dirty).toBeGreaterThan(0);
    expect(due.plan.page?.key).toBe("status:acme");
    expect(JSON.parse(due.plan.page!.put!)).toMatchObject({ workspaceId: WS });
    const recorded = s.call("status:record", {
      kv: true,
      plan: due.plan,
      done: { page: true, cleared: [], released: [] },
      now: due.now,
      late: false,
    });
    expect(recorded.value).toBe(null);
    // Pushed: nothing is due until its daily rebuild.
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
  });

  test("a push that failed keeps the change pending, backed off", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const due = s.call("status:plan", { kv: true }).value as Plan;
    s.call("status:record", {
      kv: true,
      plan: due.plan,
      done: { page: false, cleared: [], released: [], error: "KV is down" },
      now: due.now,
      late: false,
    });
    // Within the backoff: not due yet.
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
    s.tick(10 * 60 * 1000);
    expect((s.call("status:plan", { kv: true }).value as Plan).plan.dirty).toBe(due.plan.dirty);
  });

  test("a refused page answers its code, and says whether a slug just claimed may go back", () => {
    const s = shard();
    const refused = s.call("status:configure", {
      workspaceId: WS,
      actor: { kind: "user", id: ANA, role: "viewer" },
      args: page,
      now: T,
    }).value;
    expect(refused).toMatchObject({ ok: false, code: "forbidden", releasable: true });
  });

  test("a maintenance window scheduled arms its start, and the tick moves it on", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const id = newId("mnt", T, (n) => new Uint8Array(n).fill(7));
    const scheduled = s.mutate("maintenance.schedule", {
      id,
      title: "Database upgrade",
      body: "Read-only for a minute.",
      componentIds: [],
      startsAt: T + 60_000,
      endsAt: T + 120_000,
    });
    expect(scheduled.value).toEqual({ ok: true });
    expect(scheduled.scheduled.map((job) => job.fn)).toContain("status:maintenance");
    expect(s.call("status:maintenance", {}).value).toEqual({ advanced: 0 });
    s.tick(61_000);
    expect(s.call("status:maintenance", {}).value).toEqual({ advanced: 1 });
    expect(s.table("status_maintenance")).toMatchObject([{ id, phase: "in_progress" }]);
  });
});
