// Better Auth on the Worker (src/auth.ts), workspaces, and who a sync socket acts as (src/actor.ts), end to end
// through the Worker with the test D1 (migrations applied by test/apply-migrations.ts).
import { env, exports } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject } from "cloudflare:test";
import { isId, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test } from "vite-plus/test";
import worker from "../src/index.ts";
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

const api = (
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...init.headers },
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
    async next() {
      while (frames.length <= read) await new Promise<void>((wake) => waiting.push(wake));
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

    // A viewer still reads: the incident the responder declared.
    viewer.send({ type: "subscribe", subId: "s", query: "incidents.active", args: {} });
    expect(await viewer.next()).toMatchObject({
      type: "snapshot",
      rows: [expect.objectContaining({ title: "Checkout down", declaredBy: rui.user.id })],
    });
  });
});
