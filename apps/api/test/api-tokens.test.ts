// API tokens (RFC 0014): minting and revoking through the Worker, `Authorization: Bearer` on the public routes and the
// sync upgrade, scopes and the creator's current role checked at use time, the same 401 for every refused token, the
// rate limit, the last use, and that the token never reaches a log, an event, a synced row or the shard.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { newId, type Permission } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  forgetAllTokens,
  newApiToken,
  resolveBearer,
  sameDigest,
  tokenDigest,
  type ApiTokenEnv,
} from "../src/api-tokens.ts";
import { MEMBER_CHANGE_LIMIT, workerAuth } from "../src/index.ts";
import { requestDraftRoute } from "../src/postmortem.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import { IDEMPOTENCY_KEY_HEADER, type WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const open: WebSocket[] = [];
beforeEach(() => forgetAllTokens());
afterEach(() => {
  vi.restoreAllMocks();
  for (const ws of open.splice(0)) {
    try {
      ws.close(1000, "done");
    } catch {
      // Already closed by the shard.
    }
  }
});

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-2) per call: sign-up is rate-limited per IP. */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 3}`;

type Init = { method?: string; body?: string; headers?: Record<string, string> };

const api = (path: string, init: Init = {}) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

/** A request with only a bearer token: no cookie, and another site's `Origin`, which a bearer request ignores. */
const bearer = (path: string, token: string, init: Init = {}) =>
  api(path, {
    ...init,
    headers: {
      Origin: "https://elsewhere.example",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

type Person = { id: string; cookie: string };

async function signUp(name: string): Promise<Person> {
  const email = `${name.toLowerCase()}-t${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`)
    .bind(body.user.id)
    .run();
  return { id: body.user.id, cookie: await sessionCookie(email, PASSWORD) };
}

async function addMember(workspaceId: string, userId: string, role: string, at = Date.now()) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date(at).toISOString())
    .run();
}

/** Ana owns a new workspace with an incident in triage; Bea is an admin, Caio a responder. */
async function team() {
  const [ana, bea, caio] = await Promise.all(["Ana", "Bea", "Caio"].map((name) => signUp(name)));
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: ana!.cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  // A moment earlier, so a token minted right after is newer than the membership.
  await addMember(id, bea!.id, "admin", Date.now() - 1000);
  await addMember(id, caio!.id, "responder", Date.now() - 1000);
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard, state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
      ),
    );
  const incident = newId("inc", Date.now(), random);
  await withShard((shard) => {
    const { result } = shard.mutate({
      clientId: "test",
      mutationId: newId("mut", Date.now(), random),
      actor: { kind: "user", id: ana!.id, role: "owner" },
      name: "incident.declare",
      args: { id: incident, title: "Checkout down", severity: "sev1" },
      now: Date.now(),
    });
    expect(result).toMatchObject({ ok: true });
  });
  return { id, stub, incident, ana: ana!, bea: bea!, caio: caio!, withShard };
}

type Team = Awaited<ReturnType<typeof team>>;

type Minted = {
  id: string;
  token: string;
  name: string;
  scopes: Permission[];
  expiresAt: number | null;
};

async function mint(
  t: Team,
  by: Person,
  scopes: Permission[],
  options: { name?: string; expiresInDays?: number | null } = {},
): Promise<Minted> {
  const response = await api(`/workspaces/${t.id}/api-tokens`, {
    method: "POST",
    headers: { Cookie: by.cookie },
    body: JSON.stringify({
      name: options.name ?? "Deploy bot",
      scopes,
      expiresInDays: options.expiresInDays ?? null,
    }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Minted;
}

const ack = (t: Team, token: string) =>
  bearer(`/workspaces/${t.id}/incidents/${t.incident}/ack`, token, {
    method: "POST",
    headers: { [IDEMPOTENCY_KEY_HEADER]: `ack-${newId("key", Date.now(), random)}` },
  });

const listInvitations = (t: Team, token: string) =>
  bearer(`/workspaces/${t.id}/invitations`, token);

const outbox = (t: Team) =>
  t.withShard((_shard, state) =>
    state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent),
  );

describe("minting and revoking", () => {
  test("an owner mints one: shown once, only its digest in D1, listed in the shard with an event", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:ack"], { expiresInDays: 30 });
    expect(minted.token).toMatch(/^brg_[A-Za-z0-9_-]{43}$/);
    expect(minted.id).toMatch(/^tok_/);
    expect(minted.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);

    const row = await env.DB.prepare(`select * from api_token where id = ?`)
      .bind(minted.id)
      .first<Record<string, unknown>>();
    expect(row).toMatchObject({ workspace_id: t.id, created_by: t.ana.id, revoked_at: null });
    expect(row!.hash).toBe(await tokenDigest(minted.token, undefined));
    expect(JSON.stringify(row)).not.toContain(minted.token);

    const listed = await t.withShard((shard) => shard.store.get("api_tokens", minted.id));
    expect(listed).toMatchObject({
      name: "Deploy bot",
      scopes: ["incident:ack"],
      createdBy: t.ana.id,
    });
    const created = (await outbox(t)).find((event) => event.type === "apiToken.created");
    expect(created).toMatchObject({
      actor: { kind: "user", id: t.ana.id },
      data: { id: minted.id, name: "Deploy bot", scopes: ["incident:ack"] },
    });
  });

  test("only owners and admins, with the cookie, from the same site; never with a token", async () => {
    const t = await team();
    const body = JSON.stringify({ name: "x", scopes: ["incident:ack"], expiresInDays: null });
    const as = (headers: Record<string, string>) =>
      api(`/workspaces/${t.id}/api-tokens`, { method: "POST", body, headers });
    expect((await as({ Cookie: t.caio.cookie })).status).toBe(403);
    expect((await as({})).status).toBe(401);
    expect((await as({ Cookie: t.ana.cookie, Origin: "https://elsewhere.example" })).status).toBe(
      403,
    );
    const minted = await mint(t, t.bea, ["incident:ack"]);
    const withToken = await as({ Cookie: t.ana.cookie, Authorization: `Bearer ${minted.token}` });
    expect(withToken.status).toBe(403);
    expect(await withToken.json()).toEqual({ error: "forbidden" });
  });

  test("a scope outside what tokens may carry is invalid", async () => {
    const t = await team();
    const response = await api(`/workspaces/${t.id}/api-tokens`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ name: "x", scopes: ["token:manage"], expiresInDays: null }),
    });
    expect(response.status).toBe(400);
  });

  test("revoking works at once, closes its sockets and emits apiToken.revoked", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read", "incident:ack"]);
    const socket = await openSocket(t, minted.token);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    // Cached in this isolate by the upgrade; revoking drops it.
    const revoked = await api(`/workspaces/${t.id}/api-tokens/${minted.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    expect(revoked.status).toBe(200);
    expect(await closed).toBe(1008);
    expect((await ack(t, minted.token)).status).toBe(401);
    expect((await outbox(t)).find((event) => event.type === "apiToken.revoked")).toMatchObject({
      actor: { kind: "user", id: t.ana.id },
      data: { id: minted.id, name: "Deploy bot" },
    });
    // Again: nothing more to do.
    const again = await api(`/workspaces/${t.id}/api-tokens/${minted.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    expect(again.status).toBe(200);
  });

  test("a revoke the shard has, though another isolate's cache would still serve the token, holds", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:ack"]);
    expect((await ack(t, minted.token)).status).toBe(200);
    // Another isolate revoked it: D1 and the shard have it, this isolate's cache does not know.
    await env.DB.prepare(`update api_token set revoked_at = ? where id = ?`)
      .bind(Date.now(), minted.id)
      .run();
    await t.stub.apiTokenRun(
      t.id,
      { kind: "user", id: t.ana.id, role: "owner" },
      "apiToken.revoke",
      {
        id: minted.id,
      },
    );
    const refused = await ack(t, minted.token);
    expect(refused.status).toBe(401);
  });
});

describe("using one", () => {
  test("acks as the token, from any Origin, named in the timeline and the event", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["incident:ack"]);
    const response = await ack(t, minted.token);
    expect(response.status).toBe(200);
    const entry = await t.withShard((shard) =>
      shard.store.scan("timeline").find((row) => row.kind === "acknowledged"),
    );
    expect(entry?.actor).toBe(minted.id);
    const acked = (await outbox(t)).find((event) => event.type === "incident.acknowledged");
    expect(acked?.actor).toEqual({ kind: "token", id: minted.id });
  });

  test("a token without the scope is refused, though its creator's role allows it", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"]);
    const response = await ack(t, minted.token);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect((await listInvitations(t, minted.token)).status).toBe(403);
  });

  test("a creator demoted below a scope loses it at the next use; promoted back, it works again", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["members:manage"]);
    expect((await listInvitations(t, minted.token)).status).toBe(200);
    const demote = await api(`/workspaces/${t.id}/members/${t.bea.id}`, {
      method: "PATCH",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ role: "responder" }),
    });
    expect(demote.status).toBe(200);
    const refused = await listInvitations(t, minted.token);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    await api(`/workspaces/${t.id}/members/${t.bea.id}`, {
      method: "PATCH",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ role: "admin" }),
    });
    expect((await listInvitations(t, minted.token)).status).toBe(200);
  });

  test("a token changes members by its creator's rules, never its creator", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["members:manage"]);
    const self = await bearer(`/workspaces/${t.id}/members/${t.bea.id}`, minted.token, {
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(self.status).toBe(403);
    const caio = await bearer(`/workspaces/${t.id}/members/${t.caio.id}`, minted.token, {
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(caio.status).toBe(200);
    const changed = (await outbox(t)).find((event) => event.type === "member.role_changed");
    expect(changed?.actor).toEqual({ kind: "token", id: minted.id });
    // An admin's token never touches an owner, as the admin could not.
    const owner = await bearer(`/workspaces/${t.id}/members/${t.ana.id}`, minted.token, {
      method: "DELETE",
    });
    expect(owner.status).toBe(403);
  });

  test("a token with only members:manage removes a member and changes a role, in D1 and the shard", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["members:manage"]);
    const demoted = await bearer(`/workspaces/${t.id}/members/${t.caio.id}`, minted.token, {
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(demoted.status).toBe(200);
    const removed = await bearer(`/workspaces/${t.id}/members/${t.caio.id}`, minted.token, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(
      await env.DB.prepare(`select 1 from member where "organizationId" = ? and "userId" = ?`)
        .bind(t.id, t.caio.id)
        .first(),
    ).toBeNull();
    const events = await outbox(t);
    expect(events.find((event) => event.type === "member.role_changed")).toMatchObject({
      actor: { kind: "token", id: minted.id },
      data: { userId: t.caio.id, from: "responder", to: "viewer" },
    });
    expect(events.find((event) => event.type === "member.removed")).toMatchObject({
      actor: { kind: "token", id: minted.id },
      data: { userId: t.caio.id, role: "viewer", reason: "removed" },
    });
    // Nothing left for the repair alarm: the shard ran it.
    expect(
      await t.withShard((_shard, state) =>
        state.storage.sql.exec("select key from member_repair where key like 'target:%'").toArray(),
      ),
    ).toEqual([]);
  });

  test("a token never grants owner or admin, nor changes or removes an owner or admin", async () => {
    const t = await team();
    // Ana owns the workspace: her own role would allow all of these.
    const minted = await mint(t, t.ana, ["members:manage"]);
    const patch = (target: Person, role: string) =>
      bearer(`/workspaces/${t.id}/members/${target.id}`, minted.token, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    expect((await patch(t.caio, "admin")).status).toBe(403);
    expect((await patch(t.caio, "owner")).status).toBe(403);
    expect((await patch(t.bea, "responder")).status).toBe(403);
    const owner2 = await signUp("Olga");
    await addMember(t.id, owner2.id, "owner", Date.now() - 1000);
    expect((await patch(owner2, "viewer")).status).toBe(403);
    for (const target of [t.bea, owner2]) {
      const removed = await bearer(`/workspaces/${t.id}/members/${target.id}`, minted.token, {
        method: "DELETE",
      });
      expect(removed.status).toBe(403);
    }
    const roles = await env.DB.prepare(
      `select "userId", role from member where "organizationId" = ? order by "userId"`,
    )
      .bind(t.id)
      .all<{ userId: string; role: string }>();
    expect(Object.fromEntries(roles.results.map((row) => [row.userId, row.role]))).toEqual({
      [t.ana.id]: "owner",
      [t.bea.id]: "admin",
      [t.caio.id]: "responder",
      [owner2.id]: "owner",
    });

    const invite = (role: string) =>
      bearer(`/workspaces/${t.id}/invitations`, minted.token, {
        method: "POST",
        body: JSON.stringify({
          email: `${role}-${crypto.randomUUID().slice(0, 8)}@example.com`,
          role,
        }),
      });
    expect((await invite("owner")).status).toBe(403);
    expect((await invite("admin")).status).toBe(403);
    expect((await invite("responder")).status).toBe(201);
    // An invitation to be an admin, sent by Ana herself: the token neither revokes nor resends it.
    const sent = await api(`/workspaces/${t.id}/invitations`, {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ email: "dora@example.com", role: "admin" }),
    });
    expect(sent.status).toBe(201);
    const { invitation } = (await sent.json()) as { invitation: { id: string } };
    const revoked = await bearer(`/workspaces/${t.id}/invitations/${invitation.id}`, minted.token, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(403);
    const resent = await bearer(
      `/workspaces/${t.id}/invitations/${invitation.id}/resend`,
      minted.token,
      { method: "POST" },
    );
    expect(resent.status).toBe(403);
  });

  test("its creator removed disables it for good, even once they are a member again", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["incident:ack"]);
    expect((await ack(t, minted.token)).status).toBe(200);
    const removed = await api(`/workspaces/${t.id}/members/${t.bea.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    expect(removed.status).toBe(200);
    expect((await ack(t, minted.token)).status).toBe(401);
    await addMember(t.id, t.bea.id, "admin");
    expect((await ack(t, minted.token)).status).toBe(401);
  });

  test("expired, revoked, unknown, malformed and another workspace's tokens get the same 401", async () => {
    const t = await team();
    const other = await team();
    const expired = await mint(t, t.ana, ["incident:ack"]);
    await env.DB.prepare(`update api_token set expires_at = ? where id = ?`)
      .bind(Date.now() - 1, expired.id)
      .run();
    const revoked = await mint(t, t.ana, ["incident:ack"]);
    await api(`/workspaces/${t.id}/api-tokens/${revoked.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    const elsewhere = await mint(other, other.ana, ["incident:ack"]);
    const answers = [];
    for (const token of [
      expired.token,
      revoked.token,
      newApiToken(),
      "brg_short",
      elsewhere.token,
    ]) {
      const response = await ack(t, token);
      answers.push({
        status: response.status,
        body: await response.json(),
        challenge: response.headers.get("WWW-Authenticate"),
      });
    }
    for (const answer of answers) {
      expect(answer).toEqual({
        status: 401,
        body: { error: "unauthenticated" },
        challenge: "Bearer",
      });
    }
  });

  test("a cookie request keeps its Origin check", async () => {
    const t = await team();
    const response = await api(`/workspaces/${t.id}/incidents/${t.incident}/ack`, {
      method: "POST",
      headers: {
        Cookie: t.caio.cookie,
        Origin: "https://elsewhere.example",
        [IDEMPOTENCY_KEY_HEADER]: "tap-1",
      },
    });
    expect(response.status).toBe(403);
  });

  test("invites as its creator, whose address must be verified", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["members:manage"]);
    const invite = (email: string) =>
      bearer(`/workspaces/${t.id}/invitations`, minted.token, {
        method: "POST",
        body: JSON.stringify({ email, role: "responder" }),
      });
    const sent = await invite("dora@example.com");
    expect(sent.status).toBe(201);
    expect(await sent.json()).toMatchObject({ invitation: { invitedBy: { id: t.bea.id } } });
    const invited = (await outbox(t)).find((event) => event.type === "member.invited");
    expect(invited?.actor).toEqual({ kind: "token", id: minted.id });
    await env.DB.prepare(`update "user" set "emailVerified" = 0 where id = ?`).bind(t.bea.id).run();
    expect((await invite("eli@example.com")).status).toBe(403);
  });

  test("records its last use in D1 and the shard's list, at most every few minutes", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:ack"]);
    expect((await ack(t, minted.token)).status).toBe(200);
    const first = await vi.waitFor(async () => {
      const row = await env.DB.prepare(`select last_used_at as at from api_token where id = ?`)
        .bind(minted.id)
        .first<{ at: number | null }>();
      expect(row?.at).not.toBeNull();
      return row!.at!;
    });
    await vi.waitFor(async () => {
      const listed = await t.withShard((shard) => shard.store.get("api_tokens", minted.id));
      expect(listed?.lastUsedAt).toBe(first);
    });
    forgetAllTokens();
    expect((await ack(t, minted.token)).status).toBe(409);
    const again = await env.DB.prepare(`select last_used_at as at from api_token where id = ?`)
      .bind(minted.id)
      .first<{ at: number }>();
    expect(again?.at).toBe(first);
  });
});

describe("the dashboard's internal routes", () => {
  /** One request per route a token now reaches, each a valid one for `t`. */
  const routes = (t: Team) => ({
    createWebhook: (token: string) =>
      bearer(`/workspaces/${t.id}/webhooks`, token, {
        method: "POST",
        body: JSON.stringify({
          id: newId("whk", Date.now(), random),
          url: "https://hooks.example.com/brigade",
          description: "",
          events: ["incident.declared"],
        }),
      }),
    configureStatusPage: (token: string) =>
      bearer(`/workspaces/${t.id}/status-page`, token, {
        method: "PUT",
        body: JSON.stringify({
          slug: `acme-${crypto.randomUUID().slice(0, 8)}`,
          title: "Acme status",
          locale: "en",
          enabled: true,
        }),
      }),
    createExport: (token: string) =>
      bearer(`/workspaces/${t.id}/exports`, token, {
        method: "POST",
        body: JSON.stringify({ scope: { kind: "incident", incidentId: t.incident } }),
      }),
    requestDraft: (token: string) =>
      bearer(`/workspaces/${t.id}/incidents/${t.incident}/postmortem/draft`, token, {
        method: "POST",
        body: JSON.stringify({ locale: "en" }),
      }),
  });
  /** What each answers when the token passes: the tests have no `AI` binding, so a draft stops there. */
  const passed = {
    createWebhook: 201,
    configureStatusPage: 200,
    createExport: 201,
    requestDraft: 503,
  };
  const scopes: Permission[] = [
    "webhook:manage",
    "status:manage",
    "data:export",
    "incident:update",
  ];

  test("a token with the scope uses each as its creator, from any Origin", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, scopes);
    for (const [name, send] of Object.entries(routes(t))) {
      const response = await send(minted.token);
      expect(response.status, name).toBe(passed[name as keyof typeof passed]);
      if (name === "requestDraft")
        expect(await response.json()).toEqual({ error: "ai_unavailable" });
      if (name === "createExport") {
        const { id } = (await response.json()) as { id: string };
        const download = await bearer(`/workspaces/${t.id}/exports/${id}`, minted.token);
        expect(download.status).toBe(200);
        expect(await download.json()).toMatchObject({
          incidents: [{ incident: { id: t.incident } }],
        });
      }
    }
    const events = await outbox(t);
    for (const type of ["webhook.created", "status_page.configured", "workspace.exported"]) {
      const event = events.find((one) => one.type === type);
      expect(event, type).toBeDefined();
      expect(event!.actor).toMatchObject({ kind: "token", id: minted.id });
    }
  });

  test("a token without the scope is refused with 403, though its creator's role allows it", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"]);
    for (const [name, send] of Object.entries(routes(t))) {
      const response = await send(minted.token);
      expect(response.status, name).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const download = await bearer(
      `/workspaces/${t.id}/exports/${newId("exp", Date.now(), random)}`,
      minted.token,
    );
    expect(download.status).toBe(403);
  });

  test("revoked or expired tokens get 401", async () => {
    const t = await team();
    const expired = await mint(t, t.ana, scopes);
    await env.DB.prepare(`update api_token set expires_at = ? where id = ?`)
      .bind(Date.now() - 1, expired.id)
      .run();
    const revoked = await mint(t, t.ana, scopes);
    await api(`/workspaces/${t.id}/api-tokens/${revoked.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    for (const token of [expired.token, revoked.token]) {
      for (const [name, send] of Object.entries(routes(t))) {
        const response = await send(token);
        expect(response.status, name).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      }
    }
  });

  test("a revoke the shard has holds on them too, though this isolate's cache would still serve the token", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, scopes);
    expect((await routes(t).createWebhook(minted.token)).status).toBe(201);
    await env.DB.prepare(`update api_token set revoked_at = ? where id = ?`)
      .bind(Date.now(), minted.id)
      .run();
    await t.stub.apiTokenRun(
      t.id,
      { kind: "user", id: t.ana.id, role: "owner" },
      "apiToken.revoke",
      { id: minted.id },
    );
    for (const name of ["createWebhook", "configureStatusPage", "createExport"] as const) {
      expect((await routes(t)[name](minted.token)).status, name).toBe(401);
    }
    // Without an `AI` binding a draft stops before the shard (503, nothing done); with one, the shard refuses it too.
    const request = new Request(
      `${ORIGIN}/workspaces/${t.id}/incidents/${t.incident}/postmortem/draft`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "en" }),
      },
    );
    const ctx = createExecutionContext();
    const ai = { run: async () => ({ response: "{}" }) };
    const draft = await requestDraftRoute(
      request,
      { ...env, AI: ai },
      ctx,
      () => workerAuth(env, ctx, request),
      t.id,
      t.incident,
    );
    expect(draft.status).toBe(401);
  });

  test("a creator demoted loses them at the next use", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, scopes);
    expect((await routes(t).createWebhook(minted.token)).status).toBe(201);
    const demote = await api(`/workspaces/${t.id}/members/${t.bea.id}`, {
      method: "PATCH",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(demote.status).toBe(200);
    for (const [name, send] of Object.entries(routes(t))) {
      const response = await send(minted.token);
      expect(response.status, name).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });
});

describe("the sync socket", () => {
  test("acts as the token: queries and mutations are held to its scopes", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"]);
    const socket = await openSocket(t, minted.token);
    const frames = collect(socket);
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }));
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "a", query: "incidents.active", args: {} }),
    );
    socket.send(JSON.stringify({ type: "subscribe", subId: "m", query: "monitors.all", args: {} }));
    socket.send(
      JSON.stringify({
        type: "mutate",
        mutationId: "m1",
        name: "incident.ack",
        args: { id: t.incident },
      }),
    );
    await vi.waitFor(() => {
      expect(
        frames.find((frame) => frame.type === "snapshot" && frame.subId === "a"),
      ).toBeDefined();
      expect(frames.find((frame) => frame.type === "error" && frame.subId === "m")).toMatchObject({
        code: "forbidden",
      });
      expect(
        frames.find((frame) => frame.type === "mutationResult" && frame.mutationId === "m1"),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    });
  });

  test("a wrong token is refused with 401", async () => {
    const t = await team();
    const response = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${newApiToken()}` },
    });
    expect(response.status).toBe(401);
  });

  test("its creator's role change closes it", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["incident:read"]);
    const socket = await openSocket(t, minted.token);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    await api(`/workspaces/${t.id}/members/${t.bea.id}`, {
      method: "PATCH",
      headers: { Cookie: t.ana.cookie },
      body: JSON.stringify({ role: "responder" }),
    });
    expect(await closed).toBe(1012);
  });

  // RFC 0004 "Session revocation" closes the sockets of a session that ends; a token's socket has no session, so its
  // creator signing out leaves it open (RFC 0014: only a revoke, its expiry or a member change ends it).
  test("its creator signing out closes their session's socket, not the token's", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"]);
    const tokenSocket = await openSocket(t, minted.token);
    const frames = collect(tokenSocket);
    let tokenClosed: number | undefined;
    tokenSocket.addEventListener("close", (event) => (tokenClosed = event.code));
    const upgrade = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
      headers: { Upgrade: "websocket", Cookie: t.ana.cookie, Origin: ORIGIN },
    });
    expect(upgrade.status).toBe(101);
    const sessionSocket = upgrade.webSocket!;
    sessionSocket.accept();
    open.push(sessionSocket);
    const sessionClosed = new Promise<number>((resolve) =>
      sessionSocket.addEventListener("close", (event) => resolve(event.code)),
    );
    // Only the session's socket carries a session tag.
    const tagged = await t.withShard((_shard, state) =>
      state.getWebSockets().map((ws) => state.getTags(ws).length),
    );
    expect(tagged.sort((a, b) => a - b)).toEqual([0, 1]);

    const out = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: t.ana.cookie },
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect(await sessionClosed).toBe(1012);
    // Neither the alarm's session expiry nor the next frame's checks close the token's.
    await runDurableObjectAlarm(t.stub);
    tokenSocket.send(
      JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }),
    );
    tokenSocket.send(
      JSON.stringify({ type: "subscribe", subId: "a", query: "incidents.active", args: {} }),
    );
    await vi.waitFor(() =>
      expect(
        frames.find((frame) => frame.type === "snapshot" && frame.subId === "a"),
      ).toBeDefined(),
    );
    expect(tokenClosed).toBeUndefined();
  });
});

describe("an open sync socket", () => {
  /** Has the shard's copy of the token expire a moment ago, as time passing would. */
  const expire = (t: Team, tokenId: string) =>
    t.withShard((shard) =>
      shard.store.update("api_tokens", tokenId, { expiresAt: Date.now() - 1 }),
    );

  test("closes on its next frame once the token expired, without answering it", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"], { expiresInDays: 30 });
    const socket = await openSocket(t, minted.token);
    const frames = collect(socket);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }));
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "a", query: "incidents.active", args: {} }),
    );
    await vi.waitFor(() =>
      expect(
        frames.find((frame) => frame.type === "snapshot" && frame.subId === "a"),
      ).toBeDefined(),
    );
    await expire(t, minted.id);
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "b", query: "incidents.active", args: {} }),
    );
    expect(await closed).toBe(1008);
    expect(frames.find((frame) => frame.subId === "b")).toBeUndefined();
  });

  test("an idle one is closed by the alarm, armed for the token's expiry at the upgrade", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:read"], { expiresInDays: 30 });
    const socket = await openSocket(t, minted.token);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }));
    await vi.waitFor(async () => {
      const alarm = await t.withShard((_shard, state) => state.storage.getAlarm());
      expect(alarm).not.toBeNull();
      expect(alarm!).toBeLessThanOrEqual(minted.expiresAt!);
    });
    await expire(t, minted.id);
    expect(await runDurableObjectAlarm(t.stub)).toBe(true);
    expect(await closed).toBe(1008);
  });

  test("a demotion the shard ran closes it on its next frame, to reconnect with the new role", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["incident:read"]);
    const socket = await openSocket(t, minted.token);
    const closed = new Promise<number>((resolve) =>
      socket.addEventListener("close", (event) => resolve(event.code)),
    );
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }));
    // Bea's copy in the shard demoted without the member change's own close (as if it failed).
    await t.withShard((shard) => {
      if (!shard.store.get("members", t.bea.id)) {
        shard.store.insert("members", { id: t.bea.id, name: "Bea", role: "viewer", updatedAt: 0 });
      } else shard.store.update("members", t.bea.id, { role: "viewer" });
    });
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "a", query: "incidents.active", args: {} }),
    );
    expect(await closed).toBe(1012);
  });
});

describe("the token itself", () => {
  test("never reaches a log, an event, a synced row or the shard", async () => {
    const lines: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }
    const t = await team();
    const minted = await mint(t, t.ana, ["workspace:read", "incident:read", "incident:ack"]);
    const hash = await tokenDigest(minted.token, undefined);
    expect((await ack(t, minted.token)).status).toBe(200);
    const socket = await openSocket(t, minted.token);
    const frames = collect(socket);
    socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "script" }));
    // A token never lists tokens (owners and admins only, Q25): its socket is refused the list.
    socket.send(JSON.stringify({ type: "subscribe", subId: "t", query: "apiToken.all", args: {} }));
    await vi.waitFor(() =>
      expect(frames.find((frame) => frame.subId === "t")).toMatchObject({
        type: "error",
        code: "forbidden",
      }),
    );
    socket.send(
      JSON.stringify({ type: "subscribe", subId: "a", query: "incidents.active", args: {} }),
    );
    await vi.waitFor(() =>
      expect(
        frames.find((frame) => frame.type === "snapshot" && frame.subId === "a"),
      ).toBeDefined(),
    );
    await api(`/workspaces/${t.id}/api-tokens/${minted.id}`, {
      method: "DELETE",
      headers: { Cookie: t.ana.cookie },
    });
    const everything = await t.withShard((_shard, state) =>
      [
        ...state.storage.sql.exec("select * from store_rows").toArray(),
        ...state.storage.sql.exec("select * from outbox").toArray(),
        ...state.storage.sql.exec("select * from mutation_results").toArray(),
      ]
        .map((row) => JSON.stringify(row))
        .join("\n"),
    );
    const secretPart = minted.token.slice(4);
    for (const text of [lines.join("\n"), JSON.stringify(frames), everything]) {
      expect(text).not.toContain(secretPart);
      expect(text).not.toContain(hash);
    }
  });

  test("its digest is compared in constant time", async () => {
    const spy = vi.spyOn(crypto.subtle, "timingSafeEqual");
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:ack"]);
    expect((await ack(t, minted.token)).status).toBe(200);
    const hash = await tokenDigest(minted.token, undefined);
    const encoded = new TextEncoder().encode(hash);
    expect(spy).toHaveBeenCalledWith(encoded, encoded);
    expect(sameDigest(hash, hash)).toBe(true);
    expect(sameDigest(hash, `${hash.slice(0, -1)}0`)).toBe(hash.endsWith("0"));
    expect(sameDigest(hash, hash.slice(1))).toBe(false);
  });

  test("hashed with HMAC under API_TOKEN_KEY when it is set; a malformed key refuses rather than falls back", async () => {
    const token = newApiToken();
    const key = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
    expect(await tokenDigest(token, key)).not.toBe(await tokenDigest(token, undefined));
    await expect(tokenDigest(token, "short")).rejects.toThrow();
  });

  test("setting API_TOKEN_KEY later keeps a token minted without it, moving its row to the keyed digest", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const t = await team();
    // Minted with no key (the test Worker has none): D1 holds its plain SHA-256.
    const minted = await mint(t, t.ana, ["incident:ack"]);
    const plain = await tokenDigest(minted.token, undefined);
    const key = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
    const keyed = await tokenDigest(minted.token, key);
    const stored = () =>
      env.DB.prepare(`select hash from api_token where id = ?`)
        .bind(minted.id)
        .first<{ hash: string }>()
        .then((row) => row?.hash);
    expect(await stored()).toBe(plain);
    const withKey: ApiTokenEnv = { ...env, API_TOKEN_KEY: key };
    const first = await resolveBearer(minted.token, withKey, t.id, () => {});
    expect(first).toMatchObject({ ok: true, actor: { kind: "token", id: minted.id } });
    expect(await stored()).toBe(keyed);
    // From then on found by the keyed digest alone (no cache to help), and still refused for a wrong token.
    forgetAllTokens();
    expect((await resolveBearer(minted.token, withKey, t.id, () => {})).ok).toBe(true);
    expect((await resolveBearer(newApiToken(), withKey, t.id, () => {})).ok).toBe(false);
    // The other way: a token minted with the key is never found by its plain SHA-256, and without the key (removed)
    // its keyed row no longer matches.
    forgetAllTokens();
    expect((await resolveBearer(minted.token, env, t.id, () => {})).ok).toBe(false);
  });

  test("minted with API_TOKEN_KEY set, D1 holds the keyed digest and only the key finds it", async () => {
    const t = await team();
    const key = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
    const token = newApiToken();
    const id = newId("tok", Date.now(), random);
    // A token minted while the key is set: its row holds the keyed digest.
    await env.DB.prepare(
      `insert into api_token (id, workspace_id, hash, name, created_by, scopes, created_at)
       values (?, ?, ?, 'Keyed', ?, '["incident:ack"]', ?)`,
    )
      .bind(id, t.id, await tokenDigest(token, key), t.ana.id, Date.now())
      .run();
    const withKey: ApiTokenEnv = { ...env, API_TOKEN_KEY: key };
    expect(await resolveBearer(token, withKey, t.id, () => {})).toMatchObject({
      ok: true,
      actor: { id },
    });
    forgetAllTokens();
    expect((await resolveBearer(token, env, t.id, () => {})).ok).toBe(false);
  });
});

describe("the rate limit", () => {
  test("member changes count against the creator's own limit, shared with their sessions", async () => {
    const t = await team();
    const minted = await mint(t, t.bea, ["members:manage"]);
    const path = `/workspaces/${t.id}/members/${t.caio.id}`;
    const byToken = (role: string) =>
      bearer(path, minted.token, { method: "PATCH", body: JSON.stringify({ role }) });
    const bySession = (role: string) =>
      api(path, {
        method: "PATCH",
        headers: { Cookie: t.bea.cookie },
        body: JSON.stringify({ role }),
      });
    for (let i = 0; i < MEMBER_CHANGE_LIMIT.max; i++) {
      const response = i % 2 === 0 ? await byToken("viewer") : await bySession("responder");
      expect(response.status).toBe(200);
    }
    const limited = await byToken("viewer");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await bySession("viewer")).status).toBe(429);
  });

  test("over it answers 429 with Retry-After, counted only for valid tokens; a failing limiter lets it through", async () => {
    const t = await team();
    const minted = await mint(t, t.ana, ["incident:ack"]);
    const keys: string[] = [];
    let answer: () => Promise<{ success: boolean }> = async () => ({ success: false });
    const limited: ApiTokenEnv = {
      DB: env.DB,
      WORKSPACE: env.WORKSPACE,
      API_TOKEN_LIMIT: {
        limit: async ({ key }: { key: string }) => {
          keys.push(key);
          return answer();
        },
      } as RateLimit,
    };
    const over = await resolveBearer(minted.token, limited, t.id, () => {});
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.response.status).toBe(429);
      expect(over.response.headers.get("Retry-After")).toBe("60");
      expect(await over.response.json()).toEqual({ error: "rate_limited" });
    }
    const wrong = await resolveBearer(newApiToken(), limited, t.id, () => {});
    expect(wrong.ok).toBe(false);
    expect(keys).toEqual([minted.id]);
    // Over the limit, the creator is never read: only the token's own row was.
    forgetAllTokens();
    const reads: string[] = [];
    const counting: ApiTokenEnv = {
      ...limited,
      DB: new Proxy(env.DB, {
        get(target, name) {
          if (name !== "prepare") return Reflect.get(target, name);
          return (sql: string) => {
            reads.push(sql);
            return target.prepare(sql);
          };
        },
      }),
    };
    expect((await resolveBearer(minted.token, counting, t.id, () => {})).ok).toBe(false);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("from api_token");

    vi.spyOn(console, "error").mockImplementation(() => {});
    answer = async () => {
      throw new Error("limiter down");
    };
    expect((await resolveBearer(minted.token, limited, t.id, () => {})).ok).toBe(true);
  });
});

async function openSocket(t: Team, token: string): Promise<WebSocket> {
  const upgrade = await exports.default.fetch(`${ORIGIN}/sync/${t.id}`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(upgrade.status).toBe(101);
  const socket = upgrade.webSocket!;
  socket.accept();
  open.push(socket);
  return socket;
}

type Frame = { type: string; subId?: string; mutationId?: string; [key: string]: unknown };

function collect(socket: WebSocket): Frame[] {
  const frames: Frame[] = [];
  socket.addEventListener("message", (event) => frames.push(JSON.parse(event.data as string)));
  return frames;
}
