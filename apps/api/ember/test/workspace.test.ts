import { createEngine, queryGeneric, type Identity, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as eventDrain from "../events.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const OWNER = "usr_owner";
const owner: Actor = { kind: "user", id: OWNER, role: "owner" };

/** Every event envelope the shard holds, oldest first (test only). */
const allEvents = queryGeneric({
  handler: (ctx: QueryCtx) =>
    (ctx.db as never as { query(t: string): { collect(): { event: string }[] } })
      .query("events")
      .collect()
      .map((row) => row.event),
} as never);

const user = (id: string, role: string): Identity => ({ subject: id, claims: { role, ws: WS } });

/** A provisioned workspace shard: the owner created it and their member row is in. */
function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, events: eventDrain, test: { events: allEvents } },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown, actor: Actor = owner) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor })
      .value as workspace.MutateResult;
  const mutate = (identity: Identity | null, name: string, args: unknown) =>
    engine.runMutation("workspace:mutate", { name, args }, { identity })
      .value as workspace.MutateResult;
  const query = (identity: Identity | null, name: string, args: unknown = {}) =>
    engine.runQuery("workspace:query", { name, args }, { identity }).value as
      | { ok: true; rows: Record<string, unknown>[] }
      | { ok: false; error: { code: string } };
  const events = () =>
    (engine.runQuery("test:events", {}).value as string[]).map((e) => JSON.parse(e));
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  // The API copies a member in from D1 as that member, as the shard does on a socket's upgrade today.
  expect(server("member.sync", { id: OWNER, name: "Ana", role: "owner" })).toEqual({ ok: true });
  return { engine, server, mutate, query, events, tick: (ms: number) => (clock += ms) };
}

describe("a workspace on Ember", () => {
  test("a member declares an incident: the server numbers it and writes its event", () => {
    const s = shard();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    expect(
      s.mutate(user(OWNER, "owner"), "incident.declare", {
        id,
        title: "Checkout is down",
        severity: "sev1",
      }),
    ).toEqual({ ok: true });
    const listed = s.query(user(OWNER, "owner"), "incidents.active");
    expect(listed.ok && listed.rows.map((row) => [row.id, row.number])).toEqual([[id, 1]]);
    const declared = s.events().filter((e) => e.type === "incident.declared");
    expect(declared).toEqual([
      expect.objectContaining({
        type: "incident.declared",
        subject: id,
        source: `brigade://${WS}/workspace`,
        workspaceId: WS,
        actor: { kind: "user", id: OWNER },
        time: new Date(T).toISOString(),
        data: expect.objectContaining({ id, number: 1, severity: "sev1" }),
      }),
    ]);
  });

  test("a refusal keeps its code and writes nothing", () => {
    const s = shard();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    const before = s.events().length;
    expect(s.mutate(user("usr_v", "viewer"), "incident.declare", { id, title: "x" })).toMatchObject(
      {
        ok: false,
        error: { code: "forbidden" },
      },
    );
    expect(s.mutate(user(OWNER, "owner"), "incident.declare", { id, title: "" })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
    expect(s.mutate(user(OWNER, "owner"), "incident.nope", {})).toMatchObject({
      ok: false,
      error: { code: "unknown_mutation" },
    });
    s.mutate(user(OWNER, "owner"), "incident.declare", { id, title: "First" });
    expect(
      s.mutate(user(OWNER, "owner"), "incident.declare", { id, title: "Again" }),
    ).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    const listed = s.query(user(OWNER, "owner"), "incidents.active");
    expect(listed.ok && listed.rows.map((row) => row.title)).toEqual(["First"]);
    expect(s.events().length).toBe(before + 1);
  });

  test("no identity, one without a Brigade role, or one for another workspace, is no one", () => {
    const s = shard();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    expect(s.mutate(null, "incident.declare", { id, title: "x" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      s.mutate({ subject: OWNER, claims: { role: "root", ws: WS } }, "incident.declare", {
        id,
        title: "x",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    // A token for another workspace, even an owner's.
    const elsewhere: Identity = { subject: OWNER, claims: { role: "owner", ws: "ws_other" } };
    expect(s.mutate(elsewhere, "incident.declare", { id, title: "x" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(
      s.query({ subject: OWNER, claims: { role: "owner" } }, "incidents.active"),
    ).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(s.query(null, "incidents.active")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("a demotion the shard ran holds at once, before the identity's role claim catches up", () => {
    const s = shard();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    expect(
      s.server(
        "member.sync",
        { id: "usr_bia", name: "Bia", role: "viewer" },
        { kind: "user", id: "usr_bia", role: "viewer" },
      ),
    ).toEqual({ ok: true });
    // Bia's token still says responder (minted before the change): the shard's copy says viewer.
    expect(
      s.mutate(user("usr_bia", "responder"), "incident.declare", { id, title: "x" }),
    ).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    // A claim lower than the copy is kept: the claim is D1's, and D1 is the truth.
    expect(s.mutate(user(OWNER, "viewer"), "incident.declare", { id, title: "x" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("the instance's monitor cap applies to clients' mutations too", () => {
    const s = shard();
    const tcp = (fill: number) => ({
      id: newId("mon", T, (n) => new Uint8Array(n).fill(fill)),
      name: `Database ${fill}`,
      host: "db.example.com",
      port: 5432,
      intervalSeconds: 60,
      timeoutSeconds: 10,
      regions: ["weur"],
    });
    workspace.setWorkspaceLimits({ monitors: 1 });
    try {
      expect(s.mutate(user(OWNER, "owner"), "monitor.createTcp", tcp(1))).toEqual({ ok: true });
      expect(s.mutate(user(OWNER, "owner"), "monitor.createTcp", tcp(2))).toMatchObject({
        ok: false,
        error: { code: "limit_reached" },
      });
    } finally {
      workspace.setWorkspaceLimits(undefined);
    }
  });

  test("a server actor without a Brigade role is refused, not run", () => {
    const s = shard();
    expect(
      s.server(
        "workspace.create",
        { id: WS, name: "x" },
        { kind: "system", id: "sys_x", role: "root" as never },
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("server-only mutations are not reachable from a client", () => {
    const s = shard();
    expect(
      s.mutate(user(OWNER, "owner"), "workspace.create", { id: WS, name: "Again" }),
    ).toMatchObject({
      ok: false,
      error: { code: "unknown_mutation" },
    });
    expect(s.server("workspace.create", { id: WS, name: "Again" })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  test("an API token acts with its row's scopes, and not once revoked or expired", () => {
    const s = shard();
    const token = newId("tok", T, (n) => new Uint8Array(n).fill(9));
    expect(
      s.server("apiToken.create", {
        id: token,
        name: "CI",
        scopes: ["incident:read"],
        expiresAt: T + 60_000,
      }),
    ).toEqual({ ok: true });
    const asToken: Identity = { subject: token, claims: { kind: "token", role: "owner", ws: WS } };
    expect(s.query(asToken, "incidents.active")).toMatchObject({ ok: true });
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    // `incident:declare` is not among its scopes, whatever its creator's role allows.
    expect(s.mutate(asToken, "incident.declare", { id, title: "x" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    s.tick(60_000);
    expect(s.query(asToken, "incidents.active")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
