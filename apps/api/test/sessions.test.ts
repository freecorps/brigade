// Sessions (RFC 0002 "Auth", RFC 0004 "Session revocation"): a sign-up that answers the same whether or not the address
// is taken, and tells the address's owner instead; sign-in limited per address as well as per IP; and the sockets of a
// session that ends (sign-out, a revoked session) closed in every workspace of the account, with the phone that signed
// out taken off all of them.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { DEVICE_HEADER, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { sessionTag } from "../src/actor.ts";
import { SIGN_IN_ACCOUNT_LIMIT, SIGN_IN_IP_LIMIT, SIGN_UP_NOTICE_LIMIT } from "../src/auth.ts";
import { renderSignUpAttemptEmail } from "../src/email-templates.ts";
import { endSessionWith } from "../src/index.ts";
import { Shard } from "../src/shard.ts";
import type { SocketState, WorkspaceDO } from "../src/workspace.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-1, a block of its own) per call. */
const clientIp = () => `192.0.2.${(++clients % 200) + 1}`;
const address = (name: string) => `${name.toLowerCase()}-x${++people}@example.com`;

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

const open: WebSocket[] = [];
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

type SentEmail = { to: { email: string }; subject: string; text: string };

/** What the dev log double (`EMAIL_LOG=1`, set for the tests) printed, as emails. */
function outbox() {
  const spy = vi.spyOn(console, "log");
  return () =>
    spy.mock.calls.flatMap(([line]) => {
      if (typeof line !== "string" || !line.includes("email not sent (EMAIL_LOG)")) return [];
      return [JSON.parse(line) as SentEmail];
    });
}

const signUpRequest = (name: string, email: string, password = PASSWORD) =>
  api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });

async function signUp(name: string, email = address(name)) {
  const response = await signUpRequest(name, email);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, email, cookie: await sessionCookie(email, PASSWORD) };
}

const signIn = (email: string, password: string, ip = clientIp()) =>
  api("/auth/sign-in/email", {
    method: "POST",
    headers: { "cf-connecting-ip": ip },
    body: JSON.stringify({ email, password }),
  });

/** The shape of a JSON value: its keys and the types of its leaves, not its values. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, shape(inner)]),
    );
  }
  return value === null ? null : typeof value;
}

describe("signing up", () => {
  test("a taken address gets the same answer as a new one, no session either way, and its owner is told", async () => {
    const ana = await signUp("Ana");
    const sent = outbox();
    const fresh = await signUpRequest("Bia", address("Bia"));
    const taken = await signUpRequest("Mallory Quill", ana.email, "another password entirely");
    expect(taken.status).toBe(fresh.status);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.getSetCookie()).toEqual([]);
    expect(taken.headers.getSetCookie()).toEqual([]);
    type Answer = { token: null; user: { id: string; email: string } };
    const freshBody = (await fresh.json()) as Answer;
    const takenBody = (await taken.json()) as Answer;
    expect(shape(takenBody)).toEqual(shape(freshBody));
    expect(takenBody.token).toBeNull();
    // A made-up user, never the account's own id.
    expect(takenBody.user.id).not.toBe(ana.id);
    expect(takenBody.user.email).toBe(ana.email);

    // Nothing changed for the account: its password still signs in, the one typed at the sign-up does not.
    expect((await signIn(ana.email, PASSWORD)).status).toBe(200);
    expect((await signIn(ana.email, "another password entirely")).status).toBe(401);

    await vi.waitFor(() => expect(sent().some((one) => one.to.email === ana.email)).toBe(true));
    const notice = sent().find((one) => one.to.email === ana.email)!;
    expect(notice.subject).toBe("Someone tried to sign up with your email");
    // Nothing the person signing up typed but the address.
    expect(notice.to).toEqual({ email: ana.email });
    expect(notice.text).not.toContain("Mallory");
    const link = new URL(/https?:\/\/\S+/.exec(notice.text)![0]);
    expect(link.origin + link.pathname).toBe(`${ORIGIN}/sign-in`);
  });

  test(`the owner is told at most ${SIGN_UP_NOTICE_LIMIT.max} times a day`, async () => {
    const caio = await signUp("Caio");
    const sent = outbox();
    for (let i = 0; i < SIGN_UP_NOTICE_LIMIT.max + 2; i++) {
      expect((await signUpRequest("Caio", caio.email)).status).toBe(200);
    }
    const counted = () =>
      env.DB.prepare(`select count from "rateLimit" where key = ?`)
        .bind(`signup-notice:${caio.id}`)
        .first<{ count: number }>();
    await vi.waitFor(async () =>
      expect((await counted())?.count).toBe(SIGN_UP_NOTICE_LIMIT.max + 2),
    );
    expect(sent().filter((one) => one.to.email === caio.email)).toHaveLength(
      SIGN_UP_NOTICE_LIMIT.max,
    );
  });

  test("the notice is in the account's language, the address escaped in the HTML", () => {
    const email = renderSignUpAttemptEmail(
      { email: "a<b>@example.com" },
      `${ORIGIN}/sign-in`,
      "pt-BR",
    );
    expect(email.subject).toBe("Alguém tentou se cadastrar com seu email");
    expect(email.html).toContain("a&lt;b&gt;@example.com");
    expect(email.html).not.toContain("a<b>@");
  });
});

describe("signing in", () => {
  test(`at most ${SIGN_IN_ACCOUNT_LIMIT.max} tries a minute per address, from any IP, account or not`, async () => {
    // Signed up without signing in, so no try is counted yet.
    const dani = { email: address("Dani") };
    expect((await signUpRequest("Dani", dani.email)).status).toBe(200);
    const nobody = address("Nobody");
    for (const email of [dani.email, nobody]) {
      for (let i = 0; i < SIGN_IN_ACCOUNT_LIMIT.max; i++) {
        expect((await signIn(email, "not the password")).status).toBe(401);
      }
      // A new IP each time: the address's own count refuses it, even with the right password.
      expect((await signIn(email, PASSWORD)).status).toBe(429);
    }
    // The address as Better Auth looks it up: another spelling is the same count.
    expect((await signIn(dani.email.toUpperCase(), PASSWORD)).status).toBe(429);
    // Another account is not affected.
    const eva = await signUp("Eva");
    expect((await signIn(eva.email, PASSWORD)).status).toBe(200);
  });

  test(`one IP gets ${SIGN_IN_IP_LIMIT.max} tries a minute, so a team behind one NAT can sign in at once`, async () => {
    const ip = "192.0.2.250";
    const team = await Promise.all(
      Array.from({ length: SIGN_IN_IP_LIMIT.max }, (_, i) => signUp(`Member${i}`)),
    );
    for (const member of team) {
      expect((await signIn(member.email, PASSWORD, ip)).status).toBe(200);
    }
    const one = await signUp("Late");
    const limited = await signIn(one.email, PASSWORD, ip);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("X-Retry-After"))).toBeGreaterThan(0);
    expect((await signIn(one.email, PASSWORD, "192.0.2.251")).status).toBe(200);
  }, 30_000);
});

/** A workspace `owner` creates, with a handle on its shard. */
async function workspaceOf(owner: { cookie: string }, name = "Acme") {
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: owner.cookie },
    body: JSON.stringify({ name }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const stub = env.WORKSPACE.getByName(id);
  const withShard = <R>(fn: (shard: Shard, state: DurableObjectState) => R | Promise<R>) =>
    runInDurableObject(stub, (_instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state,
      ),
    );
  return { id, stub, withShard };
}

type Workspace = Awaited<ReturnType<typeof workspaceOf>>;

/** Opens a socket as `cookie`'s session; resolves with a promise of its close code. */
async function connect(w: Workspace, cookie: string) {
  const response = await exports.default.fetch(`${ORIGIN}/sync/${w.id}`, {
    headers: { Upgrade: "websocket", Cookie: cookie, Origin: ORIGIN },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket!;
  socket.accept();
  open.push(socket);
  const closed = new Promise<number>((resolve) =>
    socket.addEventListener("close", (event) => resolve(event.code)),
  );
  socket.send(JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "test" }));
  return { closed };
}

/** The shard's sockets still open, by the session they were tagged with. */
const openSockets = (w: Workspace, sessionId: string) =>
  runInDurableObject(
    w.stub,
    (_instance, state) =>
      state
        .getWebSockets(sessionTag(sessionId))
        .filter((ws) => !(ws.deserializeAttachment() as SocketState | null)?.closed).length,
  );

const sessionId = async (cookie: string) => {
  const response = await api("/auth/get-session", { headers: { Cookie: cookie } });
  return ((await response.json()) as { session: { id: string } }).session.id;
};

/** Registers a device for `actor` straight in the shard, as `device.register` from their phone would. */
const register = (w: Workspace, actor: Actor, id: string) =>
  w.withShard((shard) => {
    const { result } = shard.mutate({
      clientId: "test",
      mutationId: newId("mut", Date.now(), random),
      actor,
      name: "device.register",
      args: {
        id,
        platform: "ios",
        environment: "sandbox",
        pushToken: `token${newId("tok", Date.now(), random)}`.replace(/_/g, ""),
        voipToken: null,
        publicKey: `B${"a".repeat(86)}`,
      },
      now: Date.now(),
      internal: true,
    });
    expect(result).toMatchObject({ ok: true });
  });

const devices = (w: Workspace) =>
  w.withShard((shard) => shard.store.scan("devices").map((device) => device.id));

/** Adds an existing user to a workspace with a role, as an accepted invitation does. */
async function addMember(workspaceId: string, userId: string, role: string) {
  await env.DB.prepare(
    `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
  )
    .bind(newId("mem", Date.now(), random), workspaceId, userId, role, new Date().toISOString())
    .run();
}

describe("a session that ends", () => {
  test("signing out closes that session's sockets in every workspace, and no other session's", async () => {
    const ana = await signUp("Ana");
    const first = await workspaceOf(ana, "One");
    const second = await workspaceOf(ana, "Two");
    // The same account signed in elsewhere: its socket stays.
    const laptop = await sessionCookie(ana.email, PASSWORD);
    const mine = await sessionId(ana.cookie);
    const other = await sessionId(laptop);
    const a = await connect(first, ana.cookie);
    const b = await connect(second, ana.cookie);
    await connect(first, laptop);
    expect(await openSockets(first, mine)).toBe(1);

    const out = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: ana.cookie },
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect(await a.closed).toBe(1012);
    expect(await b.closed).toBe(1012);
    expect(await openSockets(first, other)).toBe(1);
    // It reconnects without a session and is refused.
    const again = await exports.default.fetch(`${ORIGIN}/sync/${first.id}`, {
      headers: { Upgrade: "websocket", Cookie: ana.cookie, Origin: ORIGIN },
    });
    expect(again.status).toBe(401);
  });

  test("revoking the account's other sessions closes their sockets", async () => {
    const bia = await signUp("Bia");
    const w = await workspaceOf(bia);
    const stolen = await sessionCookie(bia.email, PASSWORD);
    const theirs = await connect(w, stolen);
    const revoked = await api("/auth/revoke-other-sessions", {
      method: "POST",
      headers: { Cookie: bia.cookie },
      body: "{}",
    });
    expect(revoked.status).toBe(200);
    expect(await theirs.closed).toBe(1012);
    expect(await openSockets(w, await sessionId(bia.cookie))).toBe(0);
  });

  // A paging path (AGENTS.md): a phone registered in several of the member's workspaces must stop getting their pages
  // in all of them when they sign out on it, not only in the one the app had open.
  test("a phone that names itself on sign-out comes off every workspace of the member, and nobody else's device", async () => {
    const caio = await signUp("Caio");
    const dora = await signUp("Dora");
    const first = await workspaceOf(caio, "One");
    const second = await workspaceOf(caio, "Two");
    await addMember(second.id, dora.id, "responder");
    const phone = newId("dev", 0, random);
    const other = newId("dev", 0, random);
    const doras = newId("dev", 0, random);
    await register(first, { kind: "user", id: caio.id, role: "owner" }, phone);
    await register(second, { kind: "user", id: caio.id, role: "owner" }, phone);
    await register(second, { kind: "user", id: caio.id, role: "owner" }, other);
    await register(second, { kind: "user", id: dora.id, role: "responder" }, doras);

    const out = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: caio.cookie, [DEVICE_HEADER]: phone },
      body: "{}",
    });
    expect(out.status).toBe(200);
    // Done by the time the sign-out answers: whoever signs in on the phone next finds it free.
    expect(await devices(first)).toEqual([]);
    expect((await devices(second)).sort()).toEqual([other, doras].sort());
  });

  test("a device named by someone else's sign-out is not theirs to drop", async () => {
    const eva = await signUp("Eva");
    const fabi = await signUp("Fabi");
    const w = await workspaceOf(eva);
    await addMember(w.id, fabi.id, "responder");
    const evas = newId("dev", 0, random);
    await register(w, { kind: "user", id: eva.id, role: "owner" }, evas);
    const out = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: fabi.cookie, [DEVICE_HEADER]: evas },
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect(await devices(w)).toEqual([evas]);
  });

  test("a shard that fails is tried again; one that keeps failing is logged and the sign-out still answers", async () => {
    const gil = await signUp("Gil");
    const w = await workspaceOf(gil);
    const id = await sessionId(gil.cookie);
    const { closed } = await connect(w, gil.cookie);
    const real = env.WORKSPACE;
    let calls = 0;
    const flaky = {
      getByName: (name: string) => {
        const stub = real.getByName(name);
        return {
          endSession: (...args: Parameters<WorkspaceDO["endSession"]>) => {
            if (++calls === 1) return Promise.reject(new Error("shard unavailable"));
            return stub.endSession(...args);
          },
        };
      },
    };
    const end = endSessionWith({ ...env, WORKSPACE: flaky } as unknown as Env, 1);
    await end({ userId: gil.id, sessionId: id });
    expect(calls).toBe(2);
    expect(await closed).toBe(1012);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      getByName: () => ({ endSession: () => Promise.reject(new Error("shard unavailable")) }),
    };
    await endSessionWith(
      { ...env, WORKSPACE: broken } as unknown as Env,
      1,
    )({
      userId: gil.id,
      sessionId: id,
    });
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "closing an ended session's sockets failed",
    );
  });
});
