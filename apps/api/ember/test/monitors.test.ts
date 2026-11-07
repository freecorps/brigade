import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as monitors from "../monitors.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

// The real clock: `Monitoring` makes its ids and times at `Date.now()`, as on the DO.
const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";

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
    functions: { workspace, local, events, monitors, test: { rows } },
    now: () => clock,
  });
  engine.migrate();
  const owner = { kind: "user", id: ANA, role: "owner" } as const;
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

async function sha256(text: string): Promise<number[]> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))];
}
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

const HTTP = newId("mon", T, (n) => new Uint8Array(n).fill(4));
const BEAT = newId("mon", T, (n) => new Uint8Array(n).fill(5));

describe("monitors on Ember", () => {
  test("a monitor a member creates arms the monitor tick, which plans its region's push", () => {
    const s = shard();
    const created = s.mutate("monitor.createHttp", {
      id: HTTP,
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    expect(created.value).toEqual({ ok: true });
    expect(created.scheduled.map((job) => job.fn)).toContain("monitors:tick");
    const checked = s.call("monitors:check", {});
    // A fallback tick, so an action that dies before `arm` never ends the chain.
    expect(checked.scheduled.map((job) => job.fn)).toContain("monitors:tick");
    const due = checked.value as {
      workspaceId: string;
      pushes: { region: string; checks: { id: string }[]; config: string }[];
    };
    expect(due.workspaceId).toBe(WS);
    expect(due.pushes.map((push) => push.region)).toEqual(["weur"]);
    expect(due.pushes[0]!.checks.map((check) => check.id)).toEqual([HTTP]);
    // The probe took it: not due again until it changes or `REPUSH_MS` passes.
    s.call("monitors:pushed", {
      region: "weur",
      config: due.pushes[0]!.config,
      checks: 1,
      at: T,
    });
    expect((s.call("monitors:check", {}).value as { pushes: unknown[] }).pushes).toEqual([]);
    // Monitors left: the next tick is wanted, and the fallback from `check` already stands for it.
    const armed = s.call("monitors:arm", {});
    expect(armed.value).toBeGreaterThan(T);
    expect(armed.scheduled).toEqual([]);
  });

  test("a probe's report is applied once per report id, and a verdict does not arm the tick", () => {
    const s = shard();
    s.mutate("monitor.createHttp", {
      id: HTTP,
      name: "Checkout",
      url: "https://example.com/health",
      method: "GET",
      expectedStatus: null,
      keyword: null,
      intervalSeconds: 60,
      timeoutSeconds: 5,
      regions: ["weur"],
    });
    const report = {
      reportId: newId("rep", T, (n) => new Uint8Array(n).fill(6)),
      id: HTTP,
      at: T,
      up: true,
      latencyMs: 12,
      colo: "LHR",
      httpStatus: 200,
      error: null,
    };
    const first = s.call("monitors:report", {
      workspaceId: WS,
      region: "weur",
      reports: [report],
    });
    expect(first.value).toEqual([true]);
    expect(first.scheduled.map((job) => job.fn)).not.toContain("monitors:tick");
    expect(
      s.call("monitors:report", { workspaceId: WS, region: "weur", reports: [report] }).value,
    ).toEqual([true]);
    expect(
      s.call("monitors:report", { workspaceId: "ws_other", region: "weur", reports: [report] })
        .value,
    ).toEqual([true]);
  });

  test("a heartbeat with the right secret is taken, and keeps the tick armed", async () => {
    const s = shard();
    const digest = await sha256("the secret");
    expect(
      s.mutate("monitor.createHeartbeat", {
        id: BEAT,
        name: "Nightly backup",
        intervalSeconds: 60,
        graceSeconds: 30,
        tokenHash: hex(digest),
      }).value,
    ).toEqual({ ok: true });
    const ping = s.call("monitors:heartbeat", { workspaceId: WS, monitorId: BEAT, digest });
    expect(ping.value).toBe(true);
    expect(s.table("heartbeats")[0]!.lastPingAt).toBeGreaterThanOrEqual(T);
    const wrong = await sha256("another");
    expect(
      s.call("monitors:heartbeat", { workspaceId: WS, monitorId: BEAT, digest: wrong }).value,
    ).toBe(false);
    expect(
      s.call("monitors:heartbeat", { workspaceId: "ws_other", monitorId: BEAT, digest }).value,
    ).toBe(false);
  });
});
