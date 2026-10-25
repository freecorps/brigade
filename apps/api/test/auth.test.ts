// Better Auth on the Worker (src/auth.ts), workspaces, and who a sync socket acts as (src/actor.ts), end to end
// through the Worker with the test D1 (migrations applied by test/apply-migrations.ts).
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { isId, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { RATE_LIMIT, UNLIMITED_READS, WORKSPACE_LIMIT } from "../src/auth.ts";
import worker, { createWorkspace as postWorkspace, workerAuth } from "../src/index.ts";
import type { SocketState } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

const open: WebSocket[] = [];
afterEach(() => {
  for (const ws of open.splice(0)) ws.close(1000, "done");
});

let people = 0;
/** A unique example.com address per call: every test signs up its own people. */
const email = (name: string) => `${name.toLowerCase()}-${++people}@example.com`;

let clients = 0;
/**
 * A new client IP (TEST-NET-2, RFC 5737) per call: sign-in and sign-up are rate-limited per IP, and every test
 * signs up its own people. A test about the limit passes its own `cf-connecting-ip`.
 */
const clientIp = () => `198.51.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  origin = ORIGIN,
) =>
  exports.default.fetch(`${origin}${path}`, {
    ...init,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  });

/** The `name=value` pairs of a response's cookies, as a browser would send them back. */
function cookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

async function signUp(name: string, address = email(name)) {
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email: address, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string; email: string } };
  return { email: address, user: body.user, cookie: cookies(response) };
}

async function createWorkspace(cookie: string, name = "Acme") {
  const response = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function session(cookie: string) {
  const response = await api("/auth/get-session", { headers: { Cookie: cookie } });
  return (await response.json()) as {
    user: { id: string; email: string };
    session: { activeOrganizationId: string | null };
  } | null;
}

/** Adds an existing user to a workspace with a role, as an accepted invitation will. */
async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(
      newId("mem", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
      workspaceId,
      userId,
      role,
      new Date().toISOString(),
    )
    .run();
}

function upgrade(workspaceId: string, headers: Record<string, string> = {}) {
  return exports.default.fetch(`${ORIGIN}/sync/${workspaceId}`, {
    headers: { Upgrade: "websocket", ...headers },
  });
}

/** Opens a socket, sends `hello` and returns a reader of the frames the shard sends. */
async function connect(workspaceId: string, cookie: string) {
  const response = await upgrade(workspaceId, { Cookie: cookie, Origin: ORIGIN });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  open.push(socket);
  const frames: { type: string; [key: string]: unknown }[] = [];
  const waiting: (() => void)[] = [];
  socket.addEventListener("message", (event) => {
    frames.push(JSON.parse(event.data as string));
    waiting.splice(0).forEach((wake) => wake());
  });
  socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "test" }));
  let read = 0;
  return {
    send: (frame: unknown) => socket.send(JSON.stringify(frame)),
    /** The next frame; fails with a clear message after 2 s instead of hanging until the test times out. */
    async next() {
      while (frames.length <= read) {
        await new Promise<void>((wake, fail) => {
          const timer = setTimeout(
            () => fail(new Error(`no frame after ${read} within 2 s`)),
            2_000,
          );
          waiting.push(() => {
            clearTimeout(timer);
            wake();
          });
        });
      }
      return frames[read++]!;
    },
  };
}

/** The actor the shard recorded for its only socket. */
const socketActor = (workspaceId: string) =>
  runInDurableObject(env.WORKSPACE.getByName(workspaceId), (_instance, state): Actor => {
    const [socket] = state.getWebSockets();
    return (socket!.deserializeAttachment() as SocketState).actor;
  });

const declare = (title: string) => ({
  type: "mutate",
  mutationId: `m-${++people}`,
  name: "incident.declare",
  args: {
    id: newId("inc", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n))),
    title,
    severity: "sev2",
  },
});

describe("Better Auth routes", () => {
  test("sign-up creates a user with a usr_ id and a session cookie", async () => {
    const ana = await signUp("Ana");
    expect(isId("usr", ana.user.id)).toBe(true);
    expect(ana.cookie).toContain("better-auth.session_token=");
    expect((await session(ana.cookie))?.user).toMatchObject({ id: ana.user.id, email: ana.email });
  });

  test("sign-in with the password gives a new session; a wrong password does not", async () => {
    const ana = await signUp("Ana");
    const wrong = await api("/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: ana.email, password: "not the password" }),
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toEqual([]);

    const right = await api("/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: ana.email, password: PASSWORD }),
    });
    expect(right.status).toBe(200);
    expect((await session(cookies(right)))?.user.id).toBe(ana.user.id);
  });

  test("sign-out ends the session", async () => {
    const ana = await signUp("Ana");
    const out = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: ana.cookie },
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect(await session(ana.cookie)).toBeNull();
  });

  test("an email can only sign up once", async () => {
    const ana = await signUp("Ana");
    const again = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({ name: "Ana", email: ana.email, password: PASSWORD }),
    });
    expect(again.status).toBe(422);
  });

  test("over HTTPS the cookie is Secure and __Secure- prefixed; over HTTP it is neither", async () => {
    const secure = await api(
      "/auth/sign-up/email",
      {
        method: "POST",
        body: JSON.stringify({ name: "Ana", email: email("ana"), password: PASSWORD }),
      },
      "https://api.test",
    );
    expect(secure.status).toBe(200);
    const [cookie] = secure.headers.getSetCookie();
    expect(cookie).toMatch(/^__Secure-better-auth\.session_token=/);
    expect(cookie).toMatch(/; Secure/i);
    // The session reads back under the prefixed name.
    const me = await api(
      "/auth/get-session",
      { headers: { Cookie: cookies(secure) } },
      "https://api.test",
    );
    expect(((await me.json()) as { user?: unknown } | null)?.user).toBeDefined();

    const plain = await signUp("Bia");
    expect(plain.cookie).toMatch(/^better-auth\.session_token=/);
  });

  test("sign-in is rate-limited per client IP: 429 after 3 tries in 10 s", async () => {
    const ana = await signUp("Ana");
    const ip = "203.0.113.7";
    const attempt = (headers: Record<string, string> = { "cf-connecting-ip": ip }) =>
      api("/auth/sign-in/email", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: ana.email, password: "not the password" }),
      });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("X-Retry-After"))).toBeGreaterThan(0);
    // Even the right password waits.
    const right = await api("/auth/sign-in/email", {
      method: "POST",
      headers: { "cf-connecting-ip": ip },
      body: JSON.stringify({ email: ana.email, password: PASSWORD }),
    });
    expect(right.status).toBe(429);
    // Counted per IP: another client is not affected.
    expect((await attempt({ "cf-connecting-ip": "203.0.113.8" })).status).toBe(401);
    // The counts live in D1, so every isolate shares them.
    const row = await env.DB.prepare(`select count from "rateLimit" where key = ?`)
      .bind(`${ip}|/sign-in/email`)
      .first<{ count: number }>();
    expect(row?.count).toBe(3);
  });

  test("sign-up is rate-limited too, so it cannot probe many emails quickly", async () => {
    const ip = "203.0.113.9";
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const response = await api("/auth/sign-up/email", {
        method: "POST",
        headers: { "cf-connecting-ip": ip },
        body: JSON.stringify({ name: "Eve", email: email("eve"), password: PASSWORD }),
      });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  test(`other routes allow ${RATE_LIMIT.max} requests per ${RATE_LIMIT.window} s; reading the session is not limited`, async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < RATE_LIMIT.max + 5; i++) {
      const response = await api("/auth/get-session", { headers: { "cf-connecting-ip": ip } });
      expect(response.status).toBe(200);
    }
    const counted = await env.DB.prepare(`select count(*) as n from "rateLimit" where key like ?`)
      .bind(`${ip}|%`)
      .first<{ n: number }>();
    expect(counted?.n).toBe(0);
  });

  test("a later request never waits on an earlier request's Better Auth instance", async () => {
    // One isolate: a request that makes no Better Auth instance, then one that does, then the reverse.
    const timeout = <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000)),
      ]);
    for (const first of ["/health", "/auth/get-session", "/nowhere"]) {
      await api(first);
      const response = await timeout(api("/auth/get-session"));
      expect(response === "timeout" ? response : response.status, first).toBe(200);
    }
  });

  test("the dashboard's organization reads are not limited either", async () => {
    const ana = await signUp("Reader");
    await createWorkspace(ana.cookie);
    const ip = "203.0.113.11";
    // Past the limit on each path; in parallel per path, so a slow CI runner stays within the timeout.
    for (const path of UNLIMITED_READS.filter((p) => p !== "/get-session")) {
      const statuses = await Promise.all(
        Array.from({ length: RATE_LIMIT.max + 5 }, () =>
          api(`/auth${path}`, { headers: { Cookie: ana.cookie, "cf-connecting-ip": ip } }).then(
            (response) => response.status,
          ),
        ),
      );
      expect(new Set(statuses), path).toEqual(new Set([200]));
    }
  }, 30_000);

  test("a POST from another site is refused", async () => {
    const response = await api("/auth/sign-up/email", {
      method: "POST",
      headers: { Origin: "https://evil.example.com" },
      body: JSON.stringify({ name: "Eve", email: email("eve"), password: PASSWORD }),
    });
    expect(response.status).toBe(403);
  });
});

describe("POST /workspaces", () => {
  test("creates a workspace owned by the user, active in the session, with its shard provisioned", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie, "  Acme Ops  ");
    expect(isId("ws", workspace.id)).toBe(true);
    expect(workspace.name).toBe("Acme Ops");
    expect((await session(ana.cookie))?.session.activeOrganizationId).toBe(workspace.id);

    const member = await env.DB.prepare(
      `select role from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(workspace.id, ana.user.id)
      .first<{ role: string }>();
    expect(member).toEqual({ role: "owner" });

    // The shard recorded the workspace and announced it through its outbox (RFC 0005).
    await runInDurableObject(env.WORKSPACE.getByName(workspace.id), (_instance, state) => {
      const meta = state.storage.sql
        .exec<{ value: string }>("select value from shard_meta where key = 'workspace'")
        .one();
      expect(meta.value).toBe(workspace.id);
      const events = state.storage.sql
        .exec<{ event: string }>("select event from outbox")
        .toArray()
        .map((row) => JSON.parse(row.event));
      expect(events).toEqual([
        expect.objectContaining({
          type: "workspace.created",
          source: `brigade://${workspace.id}/workspace`,
          workspaceId: workspace.id,
          actor: { kind: "user", id: ana.user.id },
          data: { id: workspace.id, name: "Acme Ops", createdBy: ana.user.id },
        }),
      ]);
    });
  });

  test("a shard that fails to provision leaves no workspace behind", async () => {
    const ana = await signUp("Ana");
    const request = new Request(`${ORIGIN}/workspaces`, {
      method: "POST",
      headers: { Cookie: ana.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Doomed" }),
    });
    let called = 0;
    const response = await postWorkspace(request, () =>
      workerAuth(env, createExecutionContext(), request, async () => {
        called++;
        throw new Error("provision failed");
      }),
    );
    expect(called).toBe(1);
    expect(response.status).toBe(500);
    const rows = await env.DB.prepare(
      `select (select count(*) from organization where name = 'Doomed') as workspaces,
              (select count(*) from member where "userId" = ?) as memberships`,
    )
      .bind(ana.user.id)
      .first<{ workspaces: number; memberships: number }>();
    expect(rows).toEqual({ workspaces: 0, memberships: 0 });
    // Never made active either: the dashboard asks for a workspace again.
    expect((await session(ana.cookie))?.session.activeOrganizationId).toBeNull();
    // And trying again works.
    expect((await createWorkspace(ana.cookie, "Doomed")).name).toBe("Doomed");
  });

  test(`a user belongs to at most ${WORKSPACE_LIMIT} workspaces`, async () => {
    const ana = await signUp("Founder");
    for (let i = 0; i < WORKSPACE_LIMIT; i++) await createWorkspace(ana.cookie, `Team ${i}`);
    const over = await api("/workspaces", {
      method: "POST",
      headers: { Cookie: ana.cookie },
      body: JSON.stringify({ name: "One more" }),
    });
    expect(over.status).toBe(403);
    expect(await over.json()).toEqual({ error: "workspace_limit" });
  });

  test("parallel creates cannot get past the limit", async () => {
    const founder = await signUp("Racer");
    const responses = await Promise.all(
      Array.from({ length: WORKSPACE_LIMIT + 5 }, (_, i) =>
        api("/workspaces", {
          method: "POST",
          headers: { Cookie: founder.cookie },
          body: JSON.stringify({ name: `Team ${i}` }),
        }),
      ),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.every((status) => status === 201 || status === 403)).toBe(true);
    const kept = await env.DB.prepare(`select count(*) as n from "member" where "userId" = ?`)
      .bind(founder.user.id)
      .first<{ n: number }>();
    expect(kept?.n).toBeLessThanOrEqual(WORKSPACE_LIMIT);
    expect(kept?.n).toBe(statuses.filter((status) => status === 201).length);
  });

  test("a body over 4 KiB is refused, whether or not it declares its length", async () => {
    const ana = await signUp("Ana");
    const big = JSON.stringify({ name: "Acme", padding: "x".repeat(5000) });
    const declared = await api("/workspaces", {
      method: "POST",
      headers: { Cookie: ana.cookie },
      body: big,
    });
    expect(declared.status).toBe(400);
    const encoder = new TextEncoder();
    const streamed = await exports.default.fetch(`${ORIGIN}/workspaces`, {
      method: "POST",
      headers: { Cookie: ana.cookie, Origin: ORIGIN, "Content-Type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < 5; i++) controller.enqueue(encoder.encode("x".repeat(1024)));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(400);
  });

  test("a new session starts in the user's first workspace", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    await createWorkspace(ana.cookie, "Second");
    const signIn = await api("/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email: ana.email, password: PASSWORD }),
    });
    expect((await session(cookies(signIn)))?.session.activeOrganizationId).toBe(workspace.id);
  });

  test("needs a session, a valid name and the same origin", async () => {
    const ana = await signUp("Ana");
    const anonymous = await api("/workspaces", { method: "POST", body: '{"name":"Acme"}' });
    expect(anonymous.status).toBe(401);
    for (const body of [
      '{"name":""}',
      '{"name":"   "}',
      `{"name":"${"x".repeat(81)}"}`,
      "{",
      "[]",
    ]) {
      const response = await api("/workspaces", {
        method: "POST",
        headers: { Cookie: ana.cookie },
        body,
      });
      expect(response.status, body).toBe(400);
    }
    const crossSite = await api("/workspaces", {
      method: "POST",
      headers: { Cookie: ana.cookie, Origin: "https://evil.example.com" },
      body: '{"name":"Acme"}',
    });
    expect(crossSite.status).toBe(403);
    expect((await api("/workspaces", { headers: { Cookie: ana.cookie } })).status).toBe(405);
  });
});

describe("Better Auth's organization routes", () => {
  test("the ones that would change a workspace or its members without an event are refused", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    for (const route of [
      "create",
      "update",
      "delete",
      "leave",
      "invite-member",
      "accept-invitation",
      "cancel-invitation",
      "reject-invitation",
      "update-member-role",
      "remove-member",
      "add-member",
      "create-team",
      "create-role",
      "list-members",
    ]) {
      const response = await api(`/auth/organization/${route}`, {
        method: "POST",
        headers: { Cookie: ana.cookie },
        body: JSON.stringify({ organizationId: workspace.id, name: "Renamed", role: "viewer" }),
      });
      expect(response.status, route).toBe(404);
    }
    const name = await env.DB.prepare(`select name from organization where id = ?`)
      .bind(workspace.id)
      .first<{ name: string }>();
    expect(name).toEqual({ name: "Acme" });
  });

  test("the dashboard's reads and set-active still work", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    const headers = { Cookie: ana.cookie };
    const full = await api("/auth/organization/get-full-organization", { headers });
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({ id: workspace.id, name: "Acme" });
    expect((await api("/auth/organization/get-active-member", { headers })).status).toBe(200);
    expect((await api("/auth/organization/list", { headers })).status).toBe(200);
    const active = await api("/auth/organization/set-active", {
      method: "POST",
      headers,
      body: JSON.stringify({ organizationId: workspace.id }),
    });
    expect(active.status).toBe(200);
  });

  test("Better Auth itself checks the name and never deletes a workspace", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    const request = new Request(`${ORIGIN}/`);
    const auth = workerAuth(env, createExecutionContext(), request);
    const headers = new Headers({ Cookie: ana.cookie });
    // Better Auth's own schema refuses "" before the hook runs; these reach the hook.
    for (const name of ["   ", "x".repeat(81)]) {
      await expect(
        auth.api.createOrganization({ body: { name, slug: `ws-${crypto.randomUUID()}` }, headers }),
        JSON.stringify(name),
      ).rejects.toMatchObject({ status: "BAD_REQUEST" });
    }
    const created = await env.DB.prepare(`select count(*) as n from member where "userId" = ?`)
      .bind(ana.user.id)
      .first<{ n: number }>();
    expect(created).toEqual({ n: 1 });
    await expect(
      auth.api.deleteOrganization({ body: { organizationId: workspace.id }, headers }),
    ).rejects.toMatchObject({ status: "NOT_FOUND" });
    const left = await env.DB.prepare(`select count(*) as n from organization where id = ?`)
      .bind(workspace.id)
      .first<{ n: number }>();
    expect(left).toEqual({ n: 1 });
  });
});

describe("GET /sync/:workspaceId: the actor", () => {
  test("a member's socket acts as them, with their role in the workspace", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    const socket = await connect(workspace.id, ana.cookie);
    socket.send({ type: "subscribe", subId: "s", query: "incidents.active", args: {} });
    expect(await socket.next()).toMatchObject({ type: "snapshot", subId: "s" });
    expect(await socketActor(workspace.id)).toEqual({
      kind: "user",
      id: ana.user.id,
      role: "owner",
    });
  });

  test("without a session and without the dev actor: 401", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    const deployed: Env = {
      WORKSPACE: env.WORKSPACE,
      DB: env.DB,
      BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    };
    const request = new Request(`${ORIGIN}/sync/${workspace.id}`, {
      headers: { Upgrade: "websocket" },
    }) as Parameters<typeof worker.fetch>[0];
    const response = await worker.fetch(request, deployed, createExecutionContext());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    // A cookie that is no longer a session is no session either.
    const stale = new Request(`${ORIGIN}/sync/${workspace.id}`, {
      headers: { Upgrade: "websocket", Cookie: "better-auth.session_token=x.y" },
    }) as Parameters<typeof worker.fetch>[0];
    expect((await worker.fetch(stale, deployed, createExecutionContext())).status).toBe(401);
  });

  test("a signed-in user who is not a member: 403", async () => {
    const ana = await signUp("Ana");
    const bia = await signUp("Bia");
    const workspace = await createWorkspace(ana.cookie);
    const response = await upgrade(workspace.id, { Cookie: bia.cookie, Origin: ORIGIN });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_a_member" });
  });

  test("a page on another site: 403, even with the user's cookie", async () => {
    const ana = await signUp("Ana");
    const workspace = await createWorkspace(ana.cookie);
    const response = await upgrade(workspace.id, {
      Cookie: ana.cookie,
      Origin: "https://evil.example.com",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden_origin" });
  });

  test("an actor header from the client never reaches the shard", async () => {
    const ana = await signUp("Ana");
    const bia = await signUp("Bia");
    const workspace = await createWorkspace(ana.cookie);
    await addMember(workspace.id, bia.user.id, "viewer");
    const forged = JSON.stringify({ kind: "system", id: "usr_root", role: "owner" });
    const response = await upgrade(workspace.id, {
      Cookie: bia.cookie,
      Origin: ORIGIN,
      "Brigade-Actor": forged,
    });
    expect(response.status).toBe(101);
    response.webSocket!.accept();
    open.push(response.webSocket!);
    expect(await socketActor(workspace.id)).toEqual({
      kind: "user",
      id: bia.user.id,
      role: "viewer",
    });
  });
});

describe("RBAC in the shard", () => {
  test("a viewer cannot declare an incident; a responder can", async () => {
    const ana = await signUp("Ana");
    const vic = await signUp("Vic");
    const rui = await signUp("Rui");
    const workspace = await createWorkspace(ana.cookie);
    await addMember(workspace.id, vic.user.id, "viewer");
    await addMember(workspace.id, rui.user.id, "responder");

    const viewer = await connect(workspace.id, vic.cookie);
    viewer.send(declare("Checkout down"));
    expect(await viewer.next()).toMatchObject({
      type: "mutationResult",
      ok: false,
      error: { code: "forbidden" },
    });

    const responder = await connect(workspace.id, rui.cookie);
    responder.send(declare("Checkout down"));
    expect(await responder.next()).toMatchObject({ type: "mutationResult", ok: true });

    // Even the owner cannot run the server-only workspace.create from a socket.
    const owner = await connect(workspace.id, ana.cookie);
    owner.send({
      type: "mutate",
      mutationId: "ws-again",
      name: "workspace.create",
      args: { id: workspace.id, name: "Hijacked" },
    });
    expect(await owner.next()).toMatchObject({
      type: "mutationResult",
      ok: false,
      error: { code: "unknown_mutation" },
    });

    // A viewer still reads: the incident the responder declared.
    viewer.send({ type: "subscribe", subId: "s", query: "incidents.active", args: {} });
    expect(await viewer.next()).toMatchObject({
      type: "snapshot",
      rows: [expect.objectContaining({ title: "Checkout down", declaredBy: rui.user.id })],
    });
  });
});
