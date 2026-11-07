import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as alerts from "../alerts.ts";
import * as events from "../events.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

// The real clock: `AlertIntake` makes its ids at `Date.now()`, as on the DO.
const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const HASH = "a".repeat(64);

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
    functions: { workspace, local, events, alerts, test: { rows } },
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
  return { server, mutate, call, table, tick: (ms: number) => (clock += ms) };
}

const SOURCE = newId("src", T, (n) => new Uint8Array(n).fill(4));

function withSource() {
  const s = shard();
  expect(
    s.mutate("alertSource.create", {
      id: SOURCE,
      name: "Grafana",
      kind: "grafana",
      tokenHash: HASH,
      auth: null,
      signingSecret: null,
    }).value,
  ).toEqual({ ok: true });
  return s;
}

const firing = {
  dedupKey: "cpu",
  title: "CPU high",
  severity: "high",
  status: "firing",
  link: null,
  labels: {},
};

describe("alert sources on Ember", () => {
  test("the Worker gets the source and its secrets, and nothing from another workspace", () => {
    const s = withSource();
    expect(s.call("alerts:source", { workspaceId: WS, sourceId: SOURCE }).value).toMatchObject({
      source: { id: SOURCE, kind: "grafana" },
      secret: { tokenHash: HASH, headerHash: null, signingSecret: null },
    });
    expect(s.call("alerts:source", { workspaceId: "ws_other", sourceId: SOURCE }).value).toBe(null);
    expect(s.call("alerts:source", { workspaceId: WS, sourceId: "src_missing" }).value).toEqual({
      source: null,
      secret: null,
    });
  });

  test("a payload the Worker read is ingested: its alerts, or the unreadable alert", () => {
    const s = withSource();
    const ingest = (payload: unknown) =>
      s.call("alerts:ingest", { workspaceId: WS, sourceId: SOURCE, payload }).value;
    expect(ingest({ kind: "alerts", alerts: [firing], malformed: false, partly: false })).toEqual({
      status: "accepted",
      alerts: 1,
      malformed: false,
    });
    expect(ingest({ kind: "alerts", alerts: [], malformed: true, partly: false })).toEqual({
      status: "accepted",
      alerts: 1,
      malformed: true,
    });
    expect(ingest({ kind: "too_large" })).toEqual({
      status: "accepted",
      alerts: 1,
      malformed: true,
    });
    expect(
      s
        .table("source_alerts")
        .map((row) => String(row.dedupKey))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["cpu", "malformed"]);
    expect(
      s.call("alerts:ingest", {
        workspaceId: WS,
        sourceId: "src_missing",
        payload: { kind: "too_large" },
      }).value,
    ).toEqual({ status: "not_found" });
  });

  test("a route change arms the reroute, which runs in its own job", () => {
    const s = withSource();
    const created = s.mutate("alertRoute.create", {
      id: newId("rte", T, (n) => new Uint8Array(n).fill(5)),
      name: "Drop everything",
      match: { sourceIds: [SOURCE], severities: [], labels: [] },
      action: { kind: "drop" },
    });
    expect(created.value).toEqual({ ok: true });
    expect(created.scheduled.map((job) => job.fn)).toContain("alerts:reroute");
    // Nothing quiet to route: it runs, and arms nothing more.
    const ran = s.call("alerts:reroute", {});
    expect(ran.value).toEqual({ left: false });
    expect(ran.scheduled.map((job) => job.fn)).not.toContain("alerts:reroute");
  });
});
