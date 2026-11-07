import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as sessions from "../sessions.ts";
import * as events from "../events.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const owner: Actor = { kind: "user", id: ANA, role: "owner" };

/** Rows of `table` (test only). */
const rows = queryGeneric({
  args: { table: v.string() },
  handler: (ctx: QueryCtx, { table }: { table: string }) =>
    (ctx.db as never as { query(t: string): { collect(): { data: string }[] } })
      .query(table)
      .collect()
      .map((row) => JSON.parse(row.data) as Record<string, unknown>),
} as never);

function shard(members: { id: string; name: string }[] = [{ id: ANA, name: "Ana" }]) {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, events, sessions, test: { rows } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown, actor: Actor = owner) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor }).value;
  const mutate = (name: string, args: unknown, as = ANA) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      { identity: { subject: as, claims: { role: "owner", ws: WS } } },
    ).value;
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args).value;
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  for (const member of members) {
    const actor: Actor = { kind: "user", id: member.id, role: "owner" };
    expect(server("member.sync", { ...member, role: "owner" }, actor)).toEqual({ ok: true });
  }
  return { server, mutate, call, table, tick: (ms: number) => (clock += ms) };
}

const device = (fill: number) => ({
  id: newId("dev", T, (n) => new Uint8Array(n).fill(fill)),
  platform: "ios",
  environment: "sandbox",
  pushToken: String(fill).repeat(64).slice(0, 64),
  voipToken: null,
  publicKey: `B${"A".repeat(86)}`,
});

describe("sessions on Ember", () => {
  test("an ended session takes the phone it named off, and no other", () => {
    const s = shard();
    const phone = device(1);
    const tablet = device(2);
    expect(s.mutate("device.register", phone)).toEqual({ ok: true });
    expect(s.mutate("device.register", tablet)).toEqual({ ok: true });
    s.tick(1000);
    expect(
      s.call("sessions:endSession", {
        workspaceId: WS,
        userId: ANA,
        deviceId: phone.id,
        endedAt: T + 1000,
      }),
    ).toEqual({ ok: true });
    expect(s.table("devices").map((row) => row.id)).toEqual([tablet.id]);
    // Again, or without a phone: nothing left to do is fine.
    expect(
      s.call("sessions:endSession", { workspaceId: WS, userId: ANA, deviceId: phone.id }),
    ).toEqual({ ok: true });
    expect(s.call("sessions:endSession", { workspaceId: WS, userId: ANA })).toEqual({ ok: true });
  });

  test("a phone registered again after the session ended stays", () => {
    const s = shard();
    const phone = device(1);
    s.tick(5000);
    expect(s.mutate("device.register", phone)).toEqual({ ok: true });
    expect(
      s.call("sessions:endSession", {
        workspaceId: WS,
        userId: ANA,
        deviceId: phone.id,
        endedAt: T,
      }),
    ).toEqual({ ok: true });
    expect(s.table("devices").map((row) => row.id)).toEqual([phone.id]);
  });

  test("a shard holding another workspace answers not_found", () => {
    const s = shard();
    expect(s.call("sessions:endSession", { workspaceId: "ws_other", userId: ANA })).toEqual({
      ok: false,
      code: "not_found",
    });
    for (const fn of ["sessions:signOutUser", "sessions:takeOver"]) {
      expect(s.call(fn, { workspaceId: "ws_other", userId: ANA })).toEqual({
        ok: false,
        code: "not_found",
      });
    }
  });

  test("a password reset signs every phone out; a takeover of the only member pauses and revokes", () => {
    const s = shard();
    expect(s.mutate("device.register", device(1))).toEqual({ ok: true });
    const monitor = {
      id: newId("mon", T, (n) => new Uint8Array(n).fill(4)),
      name: "Database",
      host: "db.example.com",
      port: 5432,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["weur"],
    };
    expect(s.mutate("monitor.createTcp", monitor)).toEqual({ ok: true });
    expect(s.call("sessions:signOutUser", { workspaceId: WS, userId: ANA })).toEqual({ ok: true });
    expect(s.table("devices")).toEqual([]);
    const result = s.call("sessions:takeOver", { workspaceId: WS, userId: ANA });
    expect(result).toEqual({ ok: true, paused: ["Database"], revoked: 0, sources: 0, routes: 0 });
    expect(s.table("monitors").map((row) => row.paused)).toEqual([true]);
  });

  test("a takeover step that fails leaves the phones signed out", () => {
    const s = shard();
    expect(s.mutate("device.register", device(1))).toEqual({ ok: true });
    expect(s.call("sessions:signOutUser", { workspaceId: WS, userId: ANA })).toEqual({ ok: true });
    // The takeover is its own transaction: refused or thrown, it cannot bring the phone back.
    expect(() => s.call("sessions:takeOver", { workspaceId: WS, userId: 42 })).toThrow();
    expect(s.table("devices")).toEqual([]);
  });

  test("with anyone else a member, a takeover takes nothing over", () => {
    const s = shard([
      { id: ANA, name: "Ana" },
      { id: "usr_bia", name: "Bia" },
    ]);
    expect(s.call("sessions:takeOver", { workspaceId: WS, userId: ANA })).toEqual({ ok: true });
  });
});
