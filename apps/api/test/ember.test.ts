// Ember inside the API Worker (RFC 0016, src/ember.ts): the token, the auth hook's D1 checks, and `/ember` serving a
// workspace only once D1 says its engine is `ember`.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import {
  EMBER_BODY_MAX,
  serveEmber,
  setWorkspaceEngine,
  verifyIdentity,
  workspaceEngine,
  workspaceShard,
} from "../src/ember.ts";
import { EMBER_TOKEN_TTL_S, mintEmberToken, verifyEmberToken } from "../src/ember-token.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const SECRET = env.BETTER_AUTH_SECRET;

let people = 0;
let clients = 0;
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

/** A signed-in owner of a new workspace. */
async function owner() {
  const address = `ember-${++people}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Ana", email: address, password: PASSWORD }),
  });
  expect(signedUp.status).toBe(200);
  const { user } = (await signedUp.json()) as { user: { id: string } };
  const cookie = await sessionCookie(address, PASSWORD);
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return { userId: user.id, cookie, workspaceId: id };
}

type Outcome = { ok: boolean; value?: unknown; error?: unknown };

/** Provisions the workspace's Ember shard as the migration will: the workspace row and its owner's member copy. */
async function provision(workspaceId: string, userId: string) {
  const shard = env.SHARD.getByName(workspaceShard(workspaceId)) as unknown as {
    mutation(
      shard: string,
      fn: string,
      args: unknown,
      identity: null,
      internal: boolean,
    ): Promise<Outcome>;
  };
  const actor = { kind: "user", id: userId, role: "owner" };
  for (const [name, args] of [
    ["workspace.create", { id: workspaceId, name: "Acme" }],
    ["member.sync", { id: userId, name: "Ana", role: "owner" }],
  ] as const) {
    const out = await shard.mutation(
      workspaceShard(workspaceId),
      "workspace:serverMutate",
      { name, args, actor },
      null,
      true,
    );
    expect(out).toMatchObject({ ok: true, value: { ok: true } });
  }
}

describe("Ember tokens", () => {
  test("verify what was minted, and nothing tampered with or expired", async () => {
    const now = Date.UTC(2026, 10, 7);
    const claims = { sub: "usr_a", ws: "ws_a", role: "owner" as const, sid: "ses_a" };
    const minted = await mintEmberToken(SECRET, claims, now);
    expect(minted?.expiresAt).toBe(now + EMBER_TOKEN_TTL_S * 1000);
    expect(await verifyEmberToken(SECRET, minted!.token, now)).toMatchObject(claims);
    const [head, body, signature] = minted!.token.split(".");
    const forged = btoa(JSON.stringify({ ...claims, role: "owner", ws: "ws_b" })).replace(
      /=+$/,
      "",
    );
    expect(await verifyEmberToken(SECRET, `${head}.${forged}.${signature}`, now)).toBeUndefined();
    expect(await verifyEmberToken("another secret", minted!.token, now)).toBeUndefined();
    expect(await verifyEmberToken(SECRET, `${head}.${body}`, now)).toBeUndefined();
    expect(
      await verifyEmberToken(SECRET, minted!.token, now + EMBER_TOKEN_TTL_S * 1000),
    ).toBeUndefined();
  });

  test("never outlive their session, and a session past its expiry gets none", async () => {
    const now = Date.UTC(2026, 10, 7);
    const claims = { sub: "usr_a", ws: "ws_a", role: "owner" as const };
    expect((await mintEmberToken(SECRET, claims, now, now + 60_000))?.expiresAt).toBe(now + 60_000);
    expect(await mintEmberToken(SECRET, claims, now, now)).toBeUndefined();
  });
});

describe("the Ember auth hook", () => {
  test("takes the role from D1, and refuses a member gone or a session ended", async () => {
    const { userId, cookie, workspaceId } = await owner();
    const current = await api("/auth/get-session", { headers: { Cookie: cookie } });
    const { session } = (await current.json()) as { session: { id: string } };
    const now = Date.now();
    const mint = async (sub: string, sid?: string) =>
      (await mintEmberToken(
        SECRET,
        { sub, ws: workspaceId, role: "viewer", ...(sid ? { sid } : {}) },
        now,
      ))!.token;
    // The claim said viewer; D1 says owner, and D1 is the truth.
    expect(await verifyIdentity(env, await mint(userId, session.id))).toMatchObject({
      subject: userId,
      claims: { role: "owner", ws: workspaceId, sid: session.id },
    });
    // A member's token always names a session, and one that is not theirs or not in D1 is refused.
    expect(await verifyIdentity(env, await mint(userId))).toBeNull();
    expect(await verifyIdentity(env, await mint(userId, "ses_made_up"))).toBeNull();
    expect(await verifyIdentity(env, await mint("usr_nobody", session.id))).toBeNull();
    // Signing out deletes the session row: refused from then on, whether or not its `session_end` rows are still there
    // (they go once the workspaces' shards are told).
    const signedOut = await api("/auth/sign-out", { method: "POST", headers: { Cookie: cookie } });
    expect(signedOut.status).toBe(200);
    const stillValid = await mint(userId, session.id);
    expect(await verifyEmberToken(SECRET, stillValid, Date.now())).toBeDefined();
    expect(await verifyIdentity(env, stillValid)).toBeNull();
    // And once the shards were told and `session_end` is empty for it: still refused.
    await env.DB.prepare(`delete from session_end where "sessionId" = ?`).bind(session.id).run();
    expect(await verifyIdentity(env, stillValid)).toBeNull();
    expect(await verifyIdentity(env, "not a token")).toBeNull();
  });
});

describe("the Ember auth hook on an API token", () => {
  test("follows its D1 row and its creator's role now", async () => {
    const { userId, workspaceId } = await owner();
    const now = Date.now();
    const id = newId("tok", now, (n) => crypto.getRandomValues(new Uint8Array(n)));
    await env.DB.prepare(
      `insert into api_token (id, workspace_id, hash, name, created_by, scopes, created_at)
       values (?, ?, ?, 'CI', ?, '["incident:read"]', ?)`,
    )
      .bind(id, workspaceId, `hash-${id}`, userId, now)
      .run();
    const token = (await mintEmberToken(
      SECRET,
      { sub: id, ws: workspaceId, role: "viewer", kind: "token" },
      now,
    ))!.token;
    expect(await verifyIdentity(env, token)).toMatchObject({
      subject: id,
      claims: { role: "owner", kind: "token", ws: workspaceId },
    });
    // Minted for another workspace's token id: no row there.
    const elsewhere = (await mintEmberToken(
      SECRET,
      { sub: id, ws: "ws_other", role: "owner", kind: "token" },
      now,
    ))!.token;
    expect(await verifyIdentity(env, elsewhere)).toBeNull();
    // The creator left and came back: their membership is newer than the token, which stays dead, as on REST.
    const since = await env.DB.prepare(
      `select "createdAt" from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(workspaceId, userId)
      .first<{ createdAt: unknown }>();
    await env.DB.prepare(
      `update member set "createdAt" = ? where "organizationId" = ? and "userId" = ?`,
    )
      .bind(new Date(now + 1000).toISOString(), workspaceId, userId)
      .run();
    expect(await verifyIdentity(env, token)).toBeNull();
    await env.DB.prepare(
      `update member set "createdAt" = ? where "organizationId" = ? and "userId" = ?`,
    )
      .bind(since?.createdAt, workspaceId, userId)
      .run();
    expect(await verifyIdentity(env, token)).not.toBeNull();
    await env.DB.prepare(`update api_token set revoked_at = ? where id = ?`).bind(now, id).run();
    expect(await verifyIdentity(env, token)).toBeNull();
  });
});

describe("/ember", () => {
  test("serves nothing for a workspace still on WorkspaceDO, and mints it no token", async () => {
    const { cookie, workspaceId } = await owner();
    expect(await workspaceEngine(env.DB, workspaceId)).toBe("brigade");
    const token = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(token.status).toBe(409);
    expect(await token.json()).toEqual({ error: "not_on_ember" });
    const query = await api("/ember/api/query", {
      method: "POST",
      body: JSON.stringify({ fn: "workspace:query", args: {}, shard: workspaceShard(workspaceId) }),
    });
    expect(query.status).toBe(404);
    const socket = await api(`/ember/ws?shard=${workspaceShard(workspaceId)}`, {
      headers: { Upgrade: "websocket" },
    });
    expect(socket.status).toBe(404);
  });

  test("refuses an HTTP call's body past the limit before reading the rest", async () => {
    const { workspaceId } = await owner();
    const big = await api("/ember/api/query", {
      method: "POST",
      body: JSON.stringify({ shard: workspaceShard(workspaceId), pad: "x".repeat(EMBER_BODY_MAX) }),
    });
    expect(big.status).toBe(413);
  });

  test("an API token's HTTP calls spend its budget, however the token is sent", async () => {
    const { workspaceId } = await owner();
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const keys: string[] = [];
    const limited = {
      ...env,
      API_TOKEN_LIMIT: {
        limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }),
      } as RateLimit,
    } as Env;
    const token = (await mintEmberToken(
      SECRET,
      { sub: "tok_ci", ws: workspaceId, role: "owner", kind: "token" },
      Date.now(),
    ))!.token;
    const body = JSON.stringify({
      fn: "workspace:query",
      args: {},
      shard: workspaceShard(workspaceId),
    });
    for (const kind of ["query", "mutation"]) {
      for (const [query, headers] of [
        ["", { Authorization: `Bearer ${token}` }],
        ["", { Authorization: `bearer ${token}` }],
        [`?token=${token}`, {}],
      ] as const) {
        const response = await serveEmber(
          new Request(`${ORIGIN}/ember/api/${kind}${query}`, { method: "POST", headers, body }),
          limited,
          createExecutionContext(),
        );
        expect(response.status).toBe(429);
        expect(response.headers.get("Retry-After")).toBe("60");
      }
    }
    expect(keys).toEqual(Array(6).fill("tok_ci"));
  });

  test("never serves the runtime's admin, storage or action paths", async () => {
    for (const path of [
      "/ember/api/_ember/env",
      "/ember/api/storage/x",
      "/ember/api/action",
      "/ember/health",
    ]) {
      expect((await api(path, { method: "POST", body: "{}" })).status).toBe(404);
    }
  });

  test("once a workspace is on Ember, a member's token runs its mutations and queries there", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());

    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(minted.status).toBe(200);
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    expect(shard).toBe(workspaceShard(workspaceId));
    const call = (kind: "query" | "mutation", fn: string, args: unknown, bearer = token) =>
      api(`/ember/api/${kind}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ fn, args, shard }),
      });

    const id = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    const declared = await call("mutation", "workspace:mutate", {
      name: "incident.declare",
      args: { id, title: "Checkout is down", severity: "sev1" },
    });
    expect(await declared.json()).toMatchObject({ ok: true, value: { ok: true } });
    const listed = await call("query", "workspace:query", { name: "incidents.active", args: {} });
    const body = (await listed.json()) as { ok: true; value: { ok: true; rows: { id: string }[] } };
    expect(body.value.rows.map((row) => row.id)).toEqual([id]);

    // The same token in every form the runtime reads is the same caller.
    const viaQuery = await api(`/ember/api/query?token=${token}`, {
      method: "POST",
      body: JSON.stringify({
        fn: "workspace:query",
        args: { name: "incidents.active", args: {} },
        shard,
      }),
    });
    expect(viaQuery.status).toBe(200);
    // The internal server mutation is not callable with a client's token.
    const server = await call("mutation", "workspace:serverMutate", {
      name: "workspace.create",
      args: { id: workspaceId, name: "x" },
      actor: { kind: "system", id: "sys", role: "owner" },
    });
    expect(server.status).toBe(400);
    // A forged token is refused before the shard.
    expect(
      (await call("query", "workspace:query", { name: "incidents.active", args: {} }, "x.y.z"))
        .status,
    ).toBe(401);
  });
});

describe("sessions on an Ember workspace", () => {
  test("signing out on a phone takes it off the Ember shard and clears its session_end row", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const phone = newId("dev", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    const registered = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: {
          name: "device.register",
          args: {
            id: phone,
            platform: "ios",
            environment: "sandbox",
            pushToken: "a".repeat(64),
            voipToken: null,
            publicKey: `B${"A".repeat(86)}`,
          },
        },
      }),
    });
    expect(await registered.json()).toMatchObject({ ok: true, value: { ok: true } });
    const devices = async () => {
      const stub = env.SHARD.getByName(shard) as unknown as {
        query(s: string, fn: string, args: unknown, identity: unknown): Promise<Outcome>;
      };
      const out = await stub.query(
        shard,
        "workspace:query",
        { name: "devices.all", args: {} },
        {
          subject: userId,
          claims: { role: "owner", ws: workspaceId },
        },
      );
      return ((out.value as { rows: { id: string }[] }).rows ?? []).map((row) => row.id);
    };
    expect(await devices()).toEqual([phone]);

    const signedOut = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: cookie, "Brigade-Device": phone },
    });
    expect(signedOut.status).toBe(200);
    expect(await devices()).toEqual([]);
    const left = await env.DB.prepare(
      `select count(*) as n from session_end where "workspaceId" = ?`,
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(left?.n).toBe(0);
  });
});
