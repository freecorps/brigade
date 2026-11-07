// Ember inside the API Worker (RFC 0016, src/ember.ts): the token, the auth hook's D1 checks, and `/ember` serving a
// workspace only once D1 says its engine is `ember`.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import {
  alertSourceToken,
  heartbeatToken,
  newHeartbeatSecret,
  newId,
} from "@freecorps/brigade-schema";
import grafanaFiring from "../../../packages/schema/tests/fixtures/alerts/grafana-firing.json";
import { describe, expect, test, vi } from "vite-plus/test";
import {
  EMBER_BODY_MAX,
  serveEmber,
  setWorkspaceEngine,
  verifyIdentity,
  workspaceEngine,
  workspaceShard,
} from "../src/ember.ts";
import { EMBER_TOKEN_TTL_S, mintEmberToken, verifyEmberToken } from "../src/ember-token.ts";
import {
  emberPager,
  ENGINE_CACHE_MS,
  freshMembers,
  pageEngine,
  workspacePager,
} from "../src/ember-paging.ts";
import { deleteMembership, writeRole } from "../src/members.ts";
import { sendOverdue } from "../ember/local.ts";
import { provisionWorkspace, workspaceInvitations } from "../src/ember-invitations.ts";
import { INVITE_ENGINE_BUDGET_MS, notifyInvitation } from "../src/notify-invite.ts";
import { getFunctionName } from "@freecorps/ember-server";
import { generateRecipient, toBase64url } from "@freecorps/brigade-push";
import type { BrigadeEvent } from "../src/outbox.ts";
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

describe("members on an Ember workspace", () => {
  test("a role change and a removal go to D1, then to the Ember copy", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    // Bia: a responder in D1 and in the shard's copy.
    const address = `ember-bia-${++people}@example.com`;
    const signedUp = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name: "Bia", email: address, password: PASSWORD }),
    });
    const bia = ((await signedUp.json()) as { user: { id: string } }).user.id;
    await env.DB.prepare(
      `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, 'responder', ?)`,
    )
      .bind(`mem_${bia}`, workspaceId, bia, new Date().toISOString())
      .run();
    const shard = workspaceShard(workspaceId);
    const stub = env.SHARD.getByName(shard) as unknown as {
      mutation(
        s: string,
        fn: string,
        args: unknown,
        identity: null,
        internal: boolean,
      ): Promise<Outcome>;
      query(
        s: string,
        fn: string,
        args: unknown,
        identity: null,
        internal: boolean,
      ): Promise<Outcome>;
    };
    await stub.mutation(
      shard,
      "workspace:serverMutate",
      {
        name: "member.sync",
        args: { id: bia, name: "Bia", role: "responder" },
        actor: { kind: "user", id: bia, role: "responder" },
      },
      null,
      true,
    );
    const copy = async () =>
      (
        (await stub.query(shard, "members:state", { workspaceId, targetId: bia }, null, true))
          .value as {
          copy: { role: string } | null;
        }
      ).copy;

    const demoted = await api(`/workspaces/${workspaceId}/members/${bia}`, {
      method: "PATCH",
      headers: { Cookie: cookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(await demoted.json()).toEqual({ ok: true });
    expect(await copy()).toEqual({ role: "viewer" });
    const d1 = await env.DB.prepare(
      `select role from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(workspaceId, bia)
      .first<{ role: string }>();
    expect(d1?.role).toBe("viewer");

    const removed = await api(`/workspaces/${workspaceId}/members/${bia}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(await removed.json()).toEqual({ ok: true });
    expect(await copy()).toBeNull();
    // The last owner stays, on Ember as on WorkspaceDO.
    const last = await api(`/workspaces/${workspaceId}/members/${userId}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(last.status).toBe(409);
  });
});

describe("member writes without the Durable Object's lock", () => {
  test("a role change or removal checked against roles D1 no longer has changes nothing", async () => {
    const { userId, workspaceId } = await owner();
    const add = async (id: string, role: string) =>
      env.DB.prepare(
        `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
      )
        .bind(`mem_${id}`, workspaceId, id, role, new Date().toISOString())
        .run();
    for (const [id, role] of [
      ["usr_adm", "admin"],
      ["usr_bia", "responder"],
    ] as const) {
      await env.DB.prepare(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values (?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          id,
          id,
          `${id}-${workspaceId}@example.com`,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
      await add(id, role);
    }
    const admin = { id: "usr_adm", role: "admin" as const };
    // The admin was demoted after their change was checked: refused.
    await env.DB.prepare(
      `update member set role = 'viewer' where "userId" = 'usr_adm' and "organizationId" = ?`,
    )
      .bind(workspaceId)
      .run();
    expect(await writeRole(env.DB, workspaceId, "usr_bia", "responder", "admin", admin)).toBe(
      false,
    );
    expect(
      await deleteMembership(env.DB, workspaceId, "usr_bia", { role: "responder", by: admin }),
    ).toBe(false);
    // Bia was promoted after her removal was checked: refused, even by an owner.
    await env.DB.prepare(
      `update member set role = 'owner' where "userId" = 'usr_bia' and "organizationId" = ?`,
    )
      .bind(workspaceId)
      .run();
    const ownerBy = { id: userId, role: "owner" as const };
    expect(
      await deleteMembership(env.DB, workspaceId, "usr_bia", { role: "responder", by: ownerBy }),
    ).toBe(false);
    // As checked: done.
    expect(
      await deleteMembership(env.DB, workspaceId, "usr_bia", { role: "owner", by: ownerBy }),
    ).toBe(true);
  });
});

describe("events from an Ember workspace", () => {
  test("go to the events Queue after the mutation, and leave the shard's events table", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const id = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    const declared = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: { name: "incident.declare", args: { id, title: "Checkout is down" } },
      }),
    });
    expect(await declared.json()).toMatchObject({ ok: true, value: { ok: true } });
    const stub = env.SHARD.getByName(shard) as unknown as {
      query(
        s: string,
        fn: string,
        args: unknown,
        identity: null,
        internal: boolean,
      ): Promise<Outcome>;
    };
    // The drain runs in the shard (no actions Queue is bound), from its alarm right after the commit.
    let left: unknown = "pending";
    for (let i = 0; i < 50 && left !== null; i++) {
      left = (await stub.query(shard, "events:pending", {}, null, true)).value;
      if (left !== null) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(left).toBeNull();
  });
});

describe("pages for an Ember workspace", () => {
  test("are planned and recorded on its Ember shard, after its member list is checked against D1", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const incident = newId("inc", Date.now(), random);
    const declared = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: {
          name: "incident.declare",
          args: { id: incident, title: "Checkout is down", severity: "sev1" },
        },
      }),
    });
    expect(await declared.json()).toMatchObject({ ok: true, value: { ok: true } });
    const stub = env.SHARD.getByName(shard) as unknown as {
      query(
        s: string,
        fn: string,
        args: unknown,
        identity: null,
        internal: boolean,
      ): Promise<Outcome>;
    };
    expect((await stub.query(shard, "members:reconciledAt", {}, null, true)).value).toBeNull();

    const event: BrigadeEvent = {
      id: newId("evt", Date.now(), random),
      type: "incident.declared",
      source: `brigade://${workspaceId}/workspace`,
      workspaceId,
      time: new Date().toISOString(),
      actor: { kind: "user", id: userId },
      subject: incident,
      data: {},
      specversion: "1.0",
    };
    const pager = workspacePager(env, workspaceId);
    // The shard holds the incident (WorkspaceDO does not: it would answer `not_found`); its one member declared it.
    expect(await pager.planPage(event)).toEqual({ send: false, reason: "nobody" });
    expect((await stub.query(shard, "members:reconciledAt", {}, null, true)).value).toBeTypeOf(
      "number",
    );
    await pager.recordPage(event, [], true, []);
    // The email plans go to the same shard (WorkspaceDO, holding nothing, would answer `not_found`).
    expect(await pager.planEmail(event)).toEqual({ send: false, reason: "not_an_email" });
    expect(await pager.planReminder(event)).toEqual({ send: false, reason: "not_a_reminder" });
    expect(await pager.planRotationEmail(event)).toEqual({ send: false, reason: "not_a_rotation" });
    expect(await pager.recordDeadLetter(event)).not.toBe("other_workspace");
    // A workspace still on WorkspaceDO keeps its Durable Object.
    const other = await owner();
    expect(await workspacePager(env, other.workspaceId).planPage(event)).toEqual({
      send: false,
      reason: "not_found",
    });
  });
});

describe("the engine a page goes to", () => {
  test("survives D1 failing: the engine last known, or WorkspaceDO", async () => {
    const failing = {
      prepare: () => ({
        bind: () => ({ first: () => Promise.reject(new Error("D1 is down")) }),
      }),
    } as unknown as D1Database;
    const stalled = {
      prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}) }) }),
    } as unknown as D1Database;
    const { workspaceId } = await owner();
    expect(await pageEngine(failing, workspaceId)).toBe("brigade");
    expect(await pageEngine(stalled, `${workspaceId}_x`)).toBe("brigade");
    // Known from D1, it stays known while D1 is out.
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const now = Date.now();
    expect(await pageEngine(env.DB, workspaceId, now)).toBe("ember");
    expect(await pageEngine(failing, workspaceId, now + ENGINE_CACHE_MS + 1)).toBe("ember");
  });
});

/** `env.SHARD` with some calls answered by `hook` (undefined: the real shard), and every call recorded. */
function hooked(
  hook: (kind: "query" | "mutation", fn: string, args: unknown) => Promise<Outcome> | undefined,
) {
  const calls: { kind: string; fn: string; args: unknown }[] = [];
  const SHARD = {
    getByName(name: string) {
      const real = env.SHARD.getByName(name) as unknown as Record<
        "query" | "mutation",
        (
          s: string,
          fn: string,
          args: unknown,
          identity: null,
          internal: boolean,
        ) => Promise<Outcome>
      >;
      const via =
        (kind: "query" | "mutation") =>
        (s: string, fn: string, args: unknown, identity: null, internal: boolean) => {
          calls.push({ kind, fn, args });
          return hook(kind, fn, args) ?? real[kind](s, fn, args, identity, internal);
        };
      return { query: via("query"), mutation: via("mutation") };
    },
  } as unknown as Env["SHARD"];
  return { env: { DB: env.DB, SHARD }, calls };
}

describe("the member check before an Ember page", () => {
  test("a reconcile a member change overtook reads D1 again, and the check passes", async () => {
    const { userId, workspaceId } = await owner();
    await provision(workspaceId, userId);
    let stale = 1;
    const shard = hooked((_kind, fn) =>
      fn === "members:reconcile" && stale-- > 0
        ? Promise.resolve({ ok: true, value: { ok: false, code: "stale" } })
        : undefined,
    );
    expect(await freshMembers(shard.env, workspaceId, Date.now())).toBe(true);
    expect(shard.calls.filter((call) => call.fn === "members:reconcile")).toHaveLength(2);
  });

  test("a failed check's repair is asked for again when the plan carrying it failed", async () => {
    const { userId, workspaceId } = await owner();
    await provision(workspaceId, userId);
    let plans = 0;
    const shard = hooked((_kind, fn) => {
      if (fn === "members:reconciledAt") return Promise.reject(new Error("shard reset"));
      if (fn === "paging:plan" && plans++ === 0) return Promise.reject(new Error("shard reset"));
      return undefined;
    });
    const event = {
      id: "evt_x",
      type: "incident.declared",
      workspaceId,
      actor: { kind: "user", id: userId },
    } as unknown as BrigadeEvent;
    const pager = emberPager(shard.env, workspaceId);
    await expect(pager.planPage(event)).rejects.toThrow();
    // The check is now backed off, but the repair is still pending: the retried page asks for it.
    await pager.planPage(event);
    await pager.planPage(event);
    const asked = shard.calls
      .filter((call) => call.fn === "paging:plan")
      .map((call) => (call.args as { repair?: boolean }).repair ?? false);
    expect(asked).toEqual([true, true, false]);
  });
});

describe("acknowledging an incident on an Ember workspace", () => {
  test("runs incident.ack on its Ember shard, once per idempotency key", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const incident = newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
    const declared = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: { name: "incident.declare", args: { id: incident, title: "Checkout is down" } },
      }),
    });
    expect(await declared.json()).toMatchObject({ ok: true, value: { ok: true } });
    const ack = (key: string) =>
      api(`/workspaces/${workspaceId}/incidents/${incident}/ack`, {
        method: "POST",
        headers: { Cookie: cookie, "Idempotency-Key": key },
      });
    const first = await ack("tap-1");
    expect(first.status).toBe(200);
    // The same tap again: what the first answered. Another tap: already acknowledged.
    expect((await ack("tap-1")).status).toBe(200);
    const second = await ack("tap-2");
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "conflict" });
    expect(await first.json()).toEqual({ ok: true });
  });
});

/** An Ember workspace with Bia, a responder, and her phone. */
async function withResponder() {
  const { userId, cookie, workspaceId } = await owner();
  await provision(workspaceId, userId);
  await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
  const address = `ember-bia-${++people}@example.com`;
  const signedUp = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name: "Bia", email: address, password: PASSWORD }),
  });
  const bia = ((await signedUp.json()) as { user: { id: string } }).user.id;
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, 'responder', ?)`,
  )
    .bind(`mem_${bia}`, workspaceId, bia, new Date().toISOString())
    .run();
  const shard = workspaceShard(workspaceId);
  const stub = env.SHARD.getByName(shard) as unknown as {
    mutation(
      s: string,
      fn: string,
      args: unknown,
      identity: unknown,
      internal: boolean,
    ): Promise<Outcome>;
  };
  const responder = { kind: "user", id: bia, role: "responder" };
  expect(
    await stub.mutation(
      shard,
      "workspace:serverMutate",
      { name: "member.sync", args: { id: bia, name: "Bia", role: "responder" }, actor: responder },
      null,
      true,
    ),
  ).toMatchObject({ ok: true, value: { ok: true } });
  const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
  const deviceId = newId("dev", Date.now(), random);
  const registered = await stub.mutation(
    shard,
    "workspace:mutate",
    {
      name: "device.register",
      args: {
        id: deviceId,
        platform: "ios",
        environment: "sandbox",
        pushToken: "a".repeat(64),
        voipToken: null,
        publicKey: toBase64url((await generateRecipient()).publicKey),
      },
    },
    { subject: bia, claims: { role: "responder", ws: workspaceId } },
    false,
  );
  expect(registered).toMatchObject({ ok: true, value: { ok: true } });
  const minted = await api(`/ember-token/${workspaceId}`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const { token } = (await minted.json()) as { token: string };
  const incident = newId("inc", Date.now(), random);
  const declared = await api("/ember/api/mutation", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fn: "workspace:mutate",
      shard,
      args: {
        name: "incident.declare",
        args: { id: incident, title: "Checkout is down", severity: "sev1" },
      },
    }),
  });
  expect(await declared.json()).toMatchObject({ ok: true, value: { ok: true } });
  const page = (): BrigadeEvent => ({
    id: newId("evt", Date.now(), random),
    type: "incident.declared",
    source: `brigade://${workspaceId}/workspace`,
    workspaceId,
    time: new Date().toISOString(),
    actor: { kind: "user", id: userId },
    subject: incident,
    data: {},
    specversion: "1.0",
  });
  return { workspaceId, shard, stub, deviceId, incident, page };
}

describe("delivery receipts on an Ember workspace", () => {
  test("a page planned there carries a receipt token, which POST /receipts records once", async () => {
    const ws = await withResponder();
    const plan = await workspacePager(env, ws.workspaceId).planPage(ws.page());
    expect(plan).toMatchObject({ send: true, targets: [{ deviceId: ws.deviceId }] });
    const receipt = (plan as { targets: { receipt?: string }[] }).targets[0]!.receipt;
    expect(receipt).toMatch(/^v1\.k2\./);
    const post = (token: string) =>
      api("/receipts", { method: "POST", body: JSON.stringify({ token }) });
    // Routed by the token's key id, not D1: even with D1 saying `brigade`, an Ember token reaches the Ember shard.
    await setWorkspaceEngine(env.DB, ws.workspaceId, "brigade", Date.now());
    const first = await post(receipt!);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    // Again: `already`, answered as a success (the phone need not retry).
    const again = await post(receipt!);
    expect(again.status).toBe(200);
    // One altered byte: not a token this Worker minted for the workspace.
    const forged = `${receipt!.slice(0, -2)}${receipt!.endsWith("A") ? "B" : "A"}A`;
    expect(await (await post(forged)).json()).toEqual({ error: "invalid" });
  });
});

describe("a page the Queue is late with, on an Ember workspace", () => {
  test("goes out from the shard through the relay, with the shard's plan and record", async () => {
    const ws = await withResponder();
    const late = ws.page();
    let leased = false;
    const requests: unknown[] = [];
    const out = await sendOverdue(
      {
        env: {},
        runMutation: async (ref, args) => {
          const name = getFunctionName(ref as never);
          if (name === "paging:overdue") {
            if (leased) return [];
            leased = true;
            return [{ event: late, tries: 1 }];
          }
          const res = await ws.stub.mutation(ws.shard, name, args, null, true);
          if (!res.ok) throw new Error(`${name}: ${JSON.stringify(res.error)}`);
          return res.value;
        },
      },
      {
        WORKSPACE: env.WORKSPACE,
        RELAY_URL: "https://relay.test",
        RELAY_SEND_TOKEN: "test-token",
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
      } as never,
      async (request) => {
        requests.push(await request.json());
        return Response.json({ status: 200 });
      },
    );
    expect(out).toEqual({ sent: 1 });
    expect(requests).toHaveLength(1);
    // Recorded on the shard: the Queue's copy, if it comes now, plans nobody again.
    expect(await workspacePager(env, ws.workspaceId).planPage(late)).toMatchObject({ send: false });
  });
});

describe("the shard's own send of late pages", () => {
  test("fails its job when the first lease fails, so the scheduler runs it again", async () => {
    await expect(
      sendOverdue(
        {
          env: {},
          runMutation: () => Promise.reject(new Error("storage reset")),
        },
        { WORKSPACE: env.WORKSPACE } as never,
        () => Promise.resolve(Response.json({ status: 200 })),
      ),
    ).rejects.toThrow("storage reset");
  });
});

describe("the public HTTP API on an Ember workspace", () => {
  test("an API token listed there declares and reads incidents, once per idempotency key, until revoked", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/workspaces/${workspaceId}/api-tokens`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        name: "Deploy bot",
        scopes: ["incident:declare", "incident:read"],
        expiresInDays: null,
      }),
    });
    expect(minted.status).toBe(201);
    const { id: tokenId, token } = (await minted.json()) as { id: string; token: string };
    const call = (
      init: { method?: string; body?: unknown; key?: string } = {},
    ): Promise<Response> =>
      api(`/workspaces/${workspaceId}/incidents`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.key ? { "Idempotency-Key": init.key } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    const declared = await call({
      method: "POST",
      body: { title: "Checkout down" },
      key: "deploy-1",
    });
    expect(declared.status).toBe(201);
    const { incident } = (await declared.json()) as { incident: { id: string } };
    // The same key and body: the same incident. The same key for another body: refused.
    const again = await call({ method: "POST", body: { title: "Checkout down" }, key: "deploy-1" });
    expect(((await again.json()) as { incident: { id: string } }).incident.id).toBe(incident.id);
    const reused = await call({ method: "POST", body: { title: "Other" }, key: "deploy-1" });
    expect(reused.status).toBe(422);
    expect(await reused.json()).toEqual({ error: "idempotency_key_reused" });
    // Read from the Ember shard: WorkspaceDO holds no incident of this workspace.
    const listed = await call();
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).toContain(incident.id);

    const revoked = await api(`/workspaces/${workspaceId}/api-tokens/${tokenId}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(revoked.status).toBe(200);
    expect((await call()).status).toBe(401);
  });
});

describe("invitations on an Ember workspace", () => {
  test("invite, resend too soon, accept and revoke run D1 and the Ember shard, and plan the email there", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const verify = (id: string) =>
      env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(id).run();
    await verify(userId);
    const signUp = async (name: string) => {
      const address = `ember-${name.toLowerCase()}-${++people}@example.com`;
      const response = await api("/auth/sign-up/email", {
        method: "POST",
        body: JSON.stringify({ name, email: address, password: PASSWORD }),
      });
      const { user } = (await response.json()) as { user: { id: string } };
      await verify(user.id);
      return { id: user.id, email: address, cookie: await sessionCookie(address, PASSWORD) };
    };
    const ivo = await signUp("Ivo");
    const invite = (email: string) =>
      api(`/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ email, role: "responder" }),
      });
    const sent = await invite(ivo.email);
    expect(sent.status).toBe(201);
    const { invitation } = (await sent.json()) as { invitation: { id: string } };
    // The same address again: already invited, as on the DO.
    expect(await (await invite(ivo.email)).json()).toEqual({ error: "already_invited" });
    // A resend right away is too soon: the shard's ledger counted the first send.
    const resent = await api(`/workspaces/${workspaceId}/invitations/${invitation.id}/resend`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(await resent.json()).toEqual({ error: "too_soon" });

    // The email the event asks for is planned once, from the Ember shard's ledger.
    const shard = await workspaceInvitations(env, workspaceId);
    const event = {
      id: newId("evt", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
      type: "member.invited",
      source: `brigade://${workspaceId}/workspace`,
      workspaceId,
      time: new Date().toISOString(),
      actor: { kind: "user", id: userId },
      subject: invitation.id,
      data: { invitationId: invitation.id, send: 1 },
      specversion: "1.0",
    } as BrigadeEvent;
    const plan = await shard.planInvitationEmail(event);
    expect(plan).toMatchObject({ send: true, key: `${invitation.id}:1` });
    await shard.recordInvitationEmail(event, `${invitation.id}:1`, true);
    expect(await shard.planInvitationEmail(event)).toEqual({ send: false, reason: "nothing" });

    const accepted = await api(`/invitations/${invitation.id}/accept`, {
      method: "POST",
      headers: { Cookie: ivo.cookie },
    });
    expect(accepted.status).toBe(200);
    const role = await env.DB.prepare(
      `select role from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(workspaceId, ivo.id)
      .first<{ role: string }>();
    expect(role?.role).toBe("responder");
    const stub = env.SHARD.getByName(workspaceShard(workspaceId)) as unknown as {
      query(
        s: string,
        fn: string,
        args: unknown,
        identity: null,
        internal: boolean,
      ): Promise<Outcome>;
    };
    const state = await stub.query(
      workspaceShard(workspaceId),
      "members:state",
      { workspaceId, targetId: ivo.id },
      null,
      true,
    );
    expect(state.value).toMatchObject({ copy: { role: "responder" } });

    const other = await signUp("Lia");
    const second = (await (await invite(other.email)).json()) as { invitation: { id: string } };
    const revoked = await api(`/workspaces/${workspaceId}/invitations/${second.invitation.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(revoked.status).toBe(200);
    const status = await env.DB.prepare(`select status from invitation where id = ?`)
      .bind(second.invitation.id)
      .first<{ status: string }>();
    expect(status?.status).toBe("canceled");
  });

  test("a new workspace goes to Ember once NEW_WORKSPACE_ENGINE says so", async () => {
    const id = `ws_${newId("ws", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))).slice(3)}`;
    const out = await provisionWorkspace(
      { DB: env.DB, WORKSPACE: env.WORKSPACE, SHARD: env.SHARD, NEW_WORKSPACE_ENGINE: "ember" },
      { id, name: "Acme" },
      { kind: "user", id: "usr_ana", role: "owner" },
    );
    expect(out).toEqual({ ok: true });
    expect(await workspaceEngine(env.DB, id)).toBe("ember");
    // Again (a retry): fine.
    expect(
      await provisionWorkspace(
        { DB: env.DB, WORKSPACE: env.WORKSPACE, SHARD: env.SHARD, NEW_WORKSPACE_ENGINE: "ember" },
        { id, name: "Acme" },
        { kind: "user", id: "usr_ana", role: "owner" },
      ),
    ).toEqual({ ok: true });
  });
});

describe("invitation caps on an Ember workspace", () => {
  test("the workspace's daily cap holds in D1's reservation, whatever the shard's ledger counted", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(userId).run();
    // 29 sends today that only D1 has (as two Worker calls past the shard's check at once would leave them).
    const now = Date.now();
    for (let i = 0; i < 29; i++) {
      const id = `inv_cap_${people}_${i}`;
      await env.DB.batch([
        env.DB.prepare(
          `insert into invitation (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
           values (?, ?, ?, 'responder', 'expired', ?, ?, ?)`,
        ).bind(
          id,
          workspaceId,
          `cap-${i}@example.com`,
          new Date(now).toISOString(),
          new Date(now).toISOString(),
          userId,
        ),
        env.DB.prepare(
          `insert into invitation_send (id, "invitationId", email, "inviterId", at) values (?, ?, ?, ?, ?)`,
        ).bind(`snd_cap_${people}_${i}`, id, `cap-${i}@example.com`, "usr_elsewhere", now - 1000),
      ]);
    }
    const invite = (email: string) =>
      api(`/workspaces/${workspaceId}/invitations`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: JSON.stringify({ email, role: "responder" }),
      });
    expect((await invite(`cap-a-${people}@example.com`)).status).toBe(201);
    expect(await (await invite(`cap-b-${people}@example.com`)).json()).toEqual({
      error: "rate_limited",
    });
  });
});

describe("an invitation email's engine lookup", () => {
  test("a stalled D1 read throws after its budget, so the message is retried", async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}) }) }),
      } as unknown as D1Database;
      const sent = vi.fn();
      const event: BrigadeEvent = {
        id: "evt_stalled",
        type: "member.invited",
        source: "brigade://ws_x/workspace",
        workspaceId: "ws_x",
        time: new Date().toISOString(),
        actor: { kind: "user", id: "usr_x" },
        subject: "inv_x",
        data: { invitationId: "inv_x", send: 1 },
        specversion: "1.0",
      };
      const outcome = notifyInvitation(
        event,
        1,
        { WORKSPACE: env.WORKSPACE, SHARD: env.SHARD, DB: stalled },
        { id: "test", send: sent },
      );
      const settled = expect(outcome).rejects.toThrow(/took too long/);
      await vi.advanceTimersByTimeAsync(INVITE_ENGINE_BUDGET_MS);
      await settled;
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("registering a phone on an Ember workspace", () => {
  test("POST /devices/register runs there, and frees another member's phone once their session is gone", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const address = `ember-bia-${++people}@example.com`;
    const signedUp = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name: "Bia", email: address, password: PASSWORD }),
    });
    const bia = ((await signedUp.json()) as { user: { id: string } }).user.id;
    await env.DB.prepare(
      `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, 'responder', ?)`,
    )
      .bind(`mem_${bia}`, workspaceId, bia, new Date().toISOString())
      .run();
    const biaCookie = await sessionCookie(address, PASSWORD);
    const device = {
      id: newId("dev", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
      platform: "ios",
      environment: "sandbox",
      pushToken: "a".repeat(64),
      voipToken: null,
      publicKey: toBase64url((await generateRecipient()).publicKey),
    };
    const register = async (as: string) => {
      const response = await api("/devices/register", {
        method: "POST",
        headers: { Cookie: as },
        body: JSON.stringify({ device, workspaces: [workspaceId] }),
      });
      expect(response.status).toBe(200);
      return ((await response.json()) as { workspaces: Record<string, string> }).workspaces[
        workspaceId
      ];
    };
    const shard = workspaceShard(workspaceId);
    const holder = async (as: string) => {
      const stub = env.SHARD.getByName(shard) as unknown as {
        query(s: string, fn: string, args: unknown, identity: unknown): Promise<Outcome>;
      };
      const out = await stub.query(
        shard,
        "workspace:query",
        { name: "devices.all", args: {} },
        { subject: as, claims: { role: "owner", ws: workspaceId } },
      );
      return ((out.value as { rows: { id: string; userId: string }[] }).rows ?? [])
        .filter((row) => row.userId === as)
        .map((row) => row.id);
    };

    expect(await register(cookie)).toBe("ok");
    // Again, unchanged: still fine.
    expect(await register(cookie)).toBe("ok");
    expect(await holder(userId)).toEqual([device.id]);
    // Ana's session still exists: the phone stays hers.
    expect(await register(biaCookie)).toBe("forbidden");
    // Her session is gone (expired and swept): the phone is free for Bia.
    await env.DB.prepare(`delete from "session" where "userId" = ?`).bind(userId).run();
    expect(await register(biaCookie)).toBe("ok");
    expect(await holder(bia)).toEqual([device.id]);
    expect(await holder(userId)).toEqual([]);
  });
});

describe("alert sources on an Ember workspace", () => {
  test("POST /alerts/:token checks the secret in the Worker and ingests on the shard", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const sourceId = newId("src", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const created = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: {
          name: "alertSource.create",
          args: {
            id: sourceId,
            name: "Grafana",
            kind: "grafana",
            tokenHash: [...new Uint8Array(digest)]
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
            auth: null,
            signingSecret: null,
          },
        },
      }),
    });
    expect(await created.json()).toMatchObject({ ok: true, value: { ok: true } });
    // Its alerts dropped by a route: accepted, without an incident whose page would still be on its way through the
    // Queue when this file ends.
    const routed = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: {
          name: "alertRoute.create",
          args: {
            id: newId("rte", Date.now(), random),
            name: "Drop everything",
            match: { sourceIds: [sourceId], severities: [], labels: [] },
            action: { kind: "drop" },
          },
        },
      }),
    });
    expect(await routed.json()).toMatchObject({ ok: true, value: { ok: true } });
    const post = (url: string, body: string) =>
      exports.default.fetch(`${ORIGIN}/alerts/${url}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": clientIp() },
        body,
      });
    const accepted = await post(
      alertSourceToken(workspaceId, sourceId, secret),
      JSON.stringify(grafanaFiring),
    );
    expect(accepted.status).toBe(202);
    expect(await accepted.json()).toMatchObject({ ok: true, malformed: false });
    // A wrong secret is the same 404 as any refusal.
    const wrong = await post(
      alertSourceToken(workspaceId, sourceId, newHeartbeatSecret(random)),
      JSON.stringify(grafanaFiring),
    );
    expect(wrong.status).toBe(404);
  });
});

describe("heartbeats on an Ember workspace", () => {
  test("POST /heartbeat/:token is checked and taken on the Ember shard", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const minted = await api(`/ember-token/${workspaceId}`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const { token, shard } = (await minted.json()) as { token: string; shard: string };
    const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
    const monitorId = newId("mon", Date.now(), random);
    const secret = newHeartbeatSecret(random);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const created = await api("/ember/api/mutation", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        fn: "workspace:mutate",
        shard,
        args: {
          name: "monitor.createHeartbeat",
          args: {
            id: monitorId,
            name: "Nightly backup",
            intervalSeconds: 60,
            graceSeconds: 30,
            tokenHash: [...new Uint8Array(digest)]
              .map((byte) => byte.toString(16).padStart(2, "0"))
              .join(""),
          },
        },
      }),
    });
    expect(await created.json()).toMatchObject({ ok: true, value: { ok: true } });
    const ping = (secretText: string) =>
      exports.default.fetch(
        `${ORIGIN}/heartbeat/${heartbeatToken(workspaceId, monitorId, secretText)}`,
        { method: "POST", headers: { "cf-connecting-ip": clientIp() } },
      );
    expect((await ping(secret)).status).toBe(202);
    expect((await ping(newHeartbeatSecret(random))).status).toBe(404);
  });
});

describe("the status page on an Ember workspace", () => {
  test("PUT /workspaces/:id/status-page claims the slug in D1, and the shard pushes its snapshot to KV", async () => {
    const { userId, cookie, workspaceId } = await owner();
    await provision(workspaceId, userId);
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    const slug = `ember-${++people}-${Date.now().toString(36)}`;
    const saved = await api(`/workspaces/${workspaceId}/status-page`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: JSON.stringify({ slug, title: "Acme", locale: "en", enabled: true }),
    });
    expect(saved.status).toBe(200);
    expect(
      await env.DB.prepare("select workspace_id as ws from status_slug where slug = ?")
        .bind(slug)
        .first<{ ws: string }>(),
    ).toEqual({ ws: workspaceId });
    // The push runs as a scheduled job on the shard.
    let snapshot: string | null = null;
    for (let i = 0; i < 50 && snapshot === null; i++) {
      snapshot = await env.STATUS.get(`status:${slug}`);
      if (snapshot === null) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(JSON.parse(snapshot!)).toMatchObject({ workspaceId });
  });
});
