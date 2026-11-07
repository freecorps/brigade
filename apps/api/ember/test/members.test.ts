import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import * as members from "../members.ts";
import schema from "../schema.ts";
import * as events from "../events.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const owner: Actor = { kind: "user", id: "usr_ana", role: "owner" };

const rows = queryGeneric({
  args: { table: v.string() },
  handler: (ctx: QueryCtx, { table }: { table: string }) =>
    (ctx.db as never as { query(t: string): { collect(): { data: string }[] } })
      .query(table)
      .collect()
      .map((row) => JSON.parse(row.data) as Record<string, unknown>),
} as never);

function shard() {
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, members, test: { rows } },
    now: () => T,
  });
  engine.migrate();
  const server = (name: string, args: unknown, actor: Actor = owner) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor }).value;
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  for (const [id, name, role] of [
    ["usr_ana", "Ana", "owner"],
    ["usr_bia", "Bia", "responder"],
  ] as const) {
    expect(server("member.sync", { id, name, role }, { kind: "user", id, role })).toEqual({
      ok: true,
    });
  }
  return {
    engine,
    query: (fn: string, args: unknown) => engine.runQuery(fn, args).value,
    call: (fn: string, args: unknown) => engine.runMutation(fn, args).value,
    table: (name: string) =>
      engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[],
  };
}

describe("members on Ember", () => {
  test("state: the copy and what is left of a member, for the Worker's rules", () => {
    const s = shard();
    expect(s.query("members:state", { workspaceId: WS, targetId: "usr_bia" })).toEqual({
      found: true,
      copy: { role: "responder" },
      leftovers: true,
      gen: 0,
    });
    expect(s.query("members:state", { workspaceId: WS, targetId: "usr_eva" })).toEqual({
      found: true,
      copy: null,
      leftovers: false,
      gen: 0,
    });
    expect(s.query("members:state", { workspaceId: "ws_other", targetId: "usr_bia" })).toEqual({
      found: false,
    });
    expect(
      s.query("members:state", { workspaceId: WS, targetId: "usr_bia", tokenId: "tok_none" }),
    ).toMatchObject({ tokenBacked: false });
  });

  test("apply: a role change and a removal D1 already has, as the caller", () => {
    const s = shard();
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: owner,
        name: "member.changeRole",
        args: { id: "usr_bia", from: "responder", to: "viewer" },
      }),
    ).toEqual({ ok: true });
    expect(s.table("members").find((m) => m.id === "usr_bia")?.role).toBe("viewer");
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: owner,
        name: "member.remove",
        args: { id: "usr_bia", role: "viewer", reason: "removed" },
      }),
    ).toEqual({ ok: true });
    expect(s.table("members").map((m) => m.id)).toEqual(["usr_ana"]);
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: { ...owner, role: "root" },
        name: "member.remove",
        args: { id: "usr_ana", role: "owner", reason: "removed" },
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("reconcile: the copy follows D1 and answers whom it removed and changed", () => {
    const s = shard();
    expect(s.query("members:reconciledAt", {})).toBeNull();
    expect(
      s.call("members:reconcile", {
        workspaceId: WS,
        members: [{ id: "usr_ana", role: "admin", resetAt: null }],
      }),
    ).toEqual({ ok: true, removed: ["usr_bia"], changed: ["usr_ana"] });
    expect(s.table("members").map((m) => [m.id, m.role])).toEqual([["usr_ana", "admin"]]);
    // Already agreeing: nothing to do.
    expect(
      s.call("members:reconcile", {
        workspaceId: WS,
        members: [{ id: "usr_ana", role: "admin", resetAt: null }],
      }),
    ).toEqual({ ok: true, removed: [], changed: [] });
    // Either way the copy agrees with D1 now: a page need not check it again for a while.
    expect(s.query("members:reconciledAt", {})).toBeTypeOf("number");
  });

  test("a repair's snapshot that a member change overtook is refused as stale", () => {
    const s = shard();
    const gen = (
      s.query("members:state", { workspaceId: WS, targetId: "usr_bia" }) as { gen: number }
    ).gen;
    // Meanwhile a change is applied (D1 made Bia a viewer): the snapshot read before it still says responder.
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: owner,
        name: "member.changeRole",
        args: { id: "usr_bia", from: "responder", to: "viewer" },
      }),
    ).toEqual({ ok: true });
    const stale = [
      { id: "usr_ana", role: "owner", resetAt: null },
      { id: "usr_bia", role: "responder", resetAt: null },
    ];
    expect(s.call("members:reconcile", { workspaceId: WS, members: stale, gen })).toEqual({
      ok: false,
      code: "stale",
    });
    expect(s.table("members").find((m) => m.id === "usr_bia")?.role).toBe("viewer");
    const now = (
      s.query("members:state", { workspaceId: WS, targetId: "usr_bia" }) as { gen: number }
    ).gen;
    expect(now).toBe(gen + 1);
  });

  test("a one-member repair is fenced the same way", () => {
    const s = shard();
    const gen = (
      s.query("members:state", { workspaceId: WS, targetId: "usr_bia" }) as { gen: number }
    ).gen;
    // A demotion lands after the repair read D1 (which still said responder).
    s.call("members:apply", {
      workspaceId: WS,
      actor: owner,
      name: "member.changeRole",
      args: { id: "usr_bia", from: "responder", to: "viewer" },
    });
    expect(
      s.call("members:apply", {
        workspaceId: WS,
        actor: { kind: "system", id: "sys_members", role: "admin" },
        name: "member.changeRole",
        args: { id: "usr_bia", from: "viewer", to: "responder" },
        gen,
      }),
    ).toMatchObject({ ok: false, error: { code: "stale" } });
    expect(s.table("members").find((m) => m.id === "usr_bia")?.role).toBe("viewer");
  });

  test("armRepair schedules the repair action", () => {
    const s = shard();
    const out = s.engine.runMutation("members:armRepair", { workspaceId: WS, targetId: "usr_bia" });
    expect(out.scheduled.map((job) => [job.fn, job.kind])).toEqual([["members:repair", "action"]]);
  });
});
