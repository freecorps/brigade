import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as clients from "../clients.ts";
import * as events from "../events.ts";
import * as members from "../members.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const BIA = "usr_bia";
const ana: Actor = { kind: "user", id: ANA, role: "owner" };
const bia: Actor = { kind: "user", id: BIA, role: "responder" };

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
    functions: { workspace, local, events, members, clients, test: { rows } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown, actor: Actor = ana) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor }).value;
  const admit = (input: Record<string, unknown>) =>
    engine.runMutation("clients:admit", { workspaceId: WS, ...input });
  const mutate = (name: string, args: unknown, as: string) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      { identity: { subject: as, claims: { role: "owner", ws: WS } } },
    ).value;
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  return { server, admit, mutate, table, tick: (ms: number) => (clock += ms) };
}

describe("a client admitted to Ember", () => {
  test("a member's copy is written or brought up to date, and a first admission asks for one reconcile", () => {
    const s = shard();
    const first = s.admit({ actor: ana, name: "Ana" });
    expect(first.value).toEqual({ ok: true, actor: ana, tokenExpiresAt: null });
    expect(s.table("members")).toMatchObject([{ id: ANA, name: "Ana", role: "owner" }]);
    expect(first.scheduled.map((job) => job.fn)).toContain("members:repair");
    // Again (a token refresh): nothing to write, and no second repair for the burst.
    const again = s.admit({ actor: ana, name: "Ana" });
    expect(again.value).toMatchObject({ ok: true });
    expect(again.scheduled.map((job) => job.fn)).not.toContain("members:repair");
    // Renamed in D1: the copy follows.
    s.admit({ actor: ana, name: "Ana Souza" });
    expect(s.table("members")).toMatchObject([{ id: ANA, name: "Ana Souza" }]);
  });

  test("a removed member is gone until the Worker finds them in D1 with the fence it was told", () => {
    const s = shard();
    s.admit({ actor: bia, name: "Bia" });
    expect(s.server("member.remove", { id: BIA, role: "responder", reason: "removed" })).toEqual({
      ok: true,
    });
    const gone = s.admit({ actor: bia, name: "Bia" }).value as { code: string; gen: number };
    expect(gone).toMatchObject({ ok: false, code: "gone" });
    expect(s.admit({ actor: bia, name: "Bia", memberGen: gone.gen }).value).toMatchObject({
      ok: true,
    });
    expect(s.table("members").map((row) => row.id)).toContain(BIA);
  });

  test("their phones from before a password reset come off", () => {
    const s = shard();
    s.admit({ actor: ana, name: "Ana" });
    const phone = newId("dev", T, (n) => new Uint8Array(n).fill(1));
    expect(
      s.mutate(
        "device.register",
        {
          id: phone,
          platform: "ios",
          environment: "sandbox",
          pushToken: "1".repeat(64),
          voipToken: null,
          publicKey: `B${"A".repeat(86)}`,
        },
        ANA,
      ),
    ).toEqual({ ok: true });
    s.tick(5000);
    expect(s.admit({ actor: ana, name: "Ana", resetAt: T + 1000 }).value).toMatchObject({
      ok: true,
    });
    expect(s.table("devices")).toEqual([]);
  });

  test("an API token the shard does not back, or another workspace, is refused", () => {
    const s = shard();
    expect(
      s.admit({ actor: { kind: "token", id: "tok_x", role: "admin", by: ANA, scopes: [] } }).value,
    ).toEqual({ ok: false, code: "unauthenticated" });
    expect(s.admit({ workspaceId: "ws_other", actor: ana, name: "Ana" }).value).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});
