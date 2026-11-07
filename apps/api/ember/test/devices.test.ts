import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as devices from "../devices.ts";
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
    functions: { workspace, local, events, members, devices, test: { rows } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown, actor: Actor = ana) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor }).value;
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args).value;
  const register = (actor: Actor, device: Record<string, unknown>, extra: object = {}) =>
    call("devices:register", { workspaceId: WS, actor, args: device, ...extra });
  const mutate = (name: string, args: unknown, as: string, sid?: string) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      {
        identity: {
          subject: as,
          claims: { role: "owner", ws: WS, ...(sid === undefined ? {} : { sid }) },
        },
      },
    ).value;
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  expect(server("member.sync", { id: ANA, name: "Ana", role: "owner" }, ana)).toEqual({ ok: true });
  expect(server("member.sync", { id: BIA, name: "Bia", role: "responder" }, bia)).toEqual({
    ok: true,
  });
  const raw = (fn: string, args: unknown) => engine.runMutation(fn, args);
  return { server, call, raw, register, mutate, table, tick: (ms: number) => (clock += ms) };
}

const device = (fill: number, token = fill) => ({
  id: newId("dev", T, (n) => new Uint8Array(n).fill(fill)),
  platform: "ios",
  environment: "sandbox",
  pushToken: String(token).repeat(64).slice(0, 64),
  voipToken: null,
  publicKey: `B${"A".repeat(86)}`,
});

describe("devices on Ember", () => {
  test("a registration over HTTP records its session, and again unchanged refreshes it", () => {
    const s = shard();
    const phone = device(1);
    expect(s.register(ana, phone, { sessionId: "ses_1" })).toEqual({ ok: true });
    expect(s.table("devices")).toMatchObject([{ id: phone.id, userId: ANA, sessionId: "ses_1" }]);
    s.tick(1000);
    expect(s.register(ana, phone, { sessionId: "ses_2" })).toEqual({ ok: false, code: "conflict" });
    expect(s.table("devices")).toMatchObject([
      { id: phone.id, sessionId: "ses_2", updatedAt: T + 1000 },
    ]);
  });

  test("a shard holding another workspace answers not_found", () => {
    const s = shard();
    expect(
      s.call("devices:register", { workspaceId: "ws_other", actor: ana, args: device(1) }),
    ).toEqual({ ok: false, code: "not_found" });
  });

  test("over a socket, unchanged still records the socket's session", () => {
    const s = shard();
    const phone = device(1);
    expect(s.mutate("device.register", phone, ANA, "ses_1")).toEqual({ ok: true });
    s.tick(1000);
    expect(s.mutate("device.register", phone, ANA, "ses_2")).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(s.table("devices")).toMatchObject([
      { id: phone.id, sessionId: "ses_2", updatedAt: T + 1000 },
    ]);
  });

  test("another member's phone is forbidden, naming the session it is held with, until it is freed", () => {
    const s = shard();
    const phone = device(1);
    expect(s.register(ana, phone, { sessionId: "ses_ana" })).toEqual({ ok: true });
    s.tick(1000);
    const theirs = device(1, 2);
    expect(s.register(bia, theirs, { sessionId: "ses_bia" })).toEqual({
      ok: false,
      code: "forbidden",
      heldBy: "ses_ana",
    });
    // Freed with another session than the one it is held with: still Ana's.
    expect(
      s.register(bia, theirs, {
        sessionId: "ses_bia",
        free: { sessionId: "ses_x", before: T + 1000 },
      }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(
      s.register(bia, theirs, {
        sessionId: "ses_bia",
        free: { sessionId: "ses_ana", before: T + 1000 },
      }),
    ).toEqual({ ok: true });
    expect(s.table("devices")).toMatchObject([{ id: phone.id, userId: BIA, sessionId: "ses_bia" }]);
  });

  test("a phone registered again after the free's check stays its member's", () => {
    const s = shard();
    const phone = device(1);
    expect(s.register(ana, phone, { sessionId: "ses_ana" })).toEqual({ ok: true });
    s.tick(2000);
    // Ana registered it again (same session) after the Worker read D1 at T + 1000.
    expect(s.register(ana, phone, { sessionId: "ses_ana" })).toMatchObject({ ok: false });
    expect(
      s.register(bia, device(1, 2), { free: { sessionId: "ses_ana", before: T + 1000 } }),
    ).toMatchObject({ ok: false, code: "forbidden" });
    expect(s.table("devices")).toMatchObject([{ id: phone.id, userId: ANA }]);
  });

  test("with resetAt, the member's phones from before the reset come off first", () => {
    const s = shard();
    const old = device(1);
    const fresh = device(2);
    expect(s.register(ana, old)).toEqual({ ok: true });
    s.tick(5000);
    expect(s.register(ana, fresh, { resetAt: T + 1000 })).toEqual({ ok: true });
    expect(s.table("devices").map((row) => row.id)).toEqual([fresh.id]);
  });

  test("a removed member's tombstone answers gone until the Worker says they are back", () => {
    const s = shard();
    expect(s.server("member.remove", { id: BIA, role: "responder", reason: "removed" })).toEqual({
      ok: true,
    });
    const gone = s.register(bia, device(1)) as { ok: false; code: "gone"; gen: number };
    expect(gone).toMatchObject({ ok: false, code: "gone" });
    // The Worker read D1 (she is back), but another removal came in since: that read proves nothing now.
    expect(s.server("member.sync", { id: BIA, name: "Bia", role: "responder" }, bia)).toEqual({
      ok: true,
    });
    expect(s.server("member.remove", { id: BIA, role: "responder", reason: "removed" })).toEqual({
      ok: true,
    });
    expect(s.register(bia, device(1), { memberGen: gone.gen })).toMatchObject({
      ok: false,
      code: "gone",
    });
    // Read again after that: the tombstone goes, and the phone registers.
    const again = s.register(bia, device(1)) as { gen: number };
    expect(s.register(bia, device(1), { memberGen: again.gen })).toEqual({ ok: true });
    expect(s.register(bia, device(2))).toEqual({ ok: true });
  });
});
