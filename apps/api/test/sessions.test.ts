// Sessions (RFC 0002 "Auth", RFC 0004 "Session revocation"): a sign-up that answers the same whether or not the address
// is taken, and tells the address's owner instead; sign-in limited per address as well as per IP; and the sockets of a
// session that ends (sign-out, a revoked session) closed in every workspace of the account, with the phone that signed
// out taken off all of them.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { DEVICE_HEADER, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  ACTOR_HEADER,
  MEMBER_NAME_HEADER,
  SESSION_EXPIRES_HEADER,
  SESSION_HEADER,
  sessionTag,
} from "../src/actor.ts";
import {
  pruneRateLimits,
  RATE_LIMIT_KEEP_MS,
  SIGN_IN_ACCOUNT_LIMIT,
  SIGN_IN_AFTER_RESET,
  SIGN_IN_IP_LIMIT,
  SIGN_OUT_FAILED_CODE,
  SIGN_UP_NOTICE_LIMIT,
} from "../src/auth.ts";
import { DEVICES_REGISTER_PATH } from "../src/device-route.ts";
import { renderSignUpAttemptEmail } from "../src/email-templates.ts";
import { endSessionWith, workerAuth } from "../src/index.ts";
import {
  recordSessionEnd,
  SESSION_END_SWEEP_AFTER_MS,
  sweepSessionEnds,
} from "../src/session-end.ts";
import { Shard } from "../src/shard.ts";
import { WORKSPACE_HEADER, type SocketState, type WorkspaceDO } from "../src/workspace.ts";
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
    // Counted before each answer, as a free address's sign-up writes before its own: the two take about as long.
    expect((await counted())?.count).toBe(SIGN_UP_NOTICE_LIMIT.max + 2);
    await vi.waitFor(() =>
      expect(sent().filter((one) => one.to.email === caio.email)).toHaveLength(
        SIGN_UP_NOTICE_LIMIT.max,
      ),
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
    await end({ userId: gil.id, sessionId: id, endedAt: Date.now() });
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
      endedAt: Date.now(),
    });
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "closing an ended session's sockets failed",
    );
  });
});

/** A D1 whose statements touching `table` fail, every other one going through. */
function failing(table: string): D1Database {
  return new Proxy(env.DB, {
    get(target, key) {
      if (key === "prepare") {
        return (query: string) =>
          query.includes(table)
            ? {
                bind: () => ({
                  run: () => Promise.reject(new Error("D1 is down")),
                  all: () => Promise.reject(new Error("D1 is down")),
                  first: () => Promise.reject(new Error("D1 is down")),
                }),
              }
            : target.prepare(query);
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}

const pendingEnds = (sessionId: string) =>
  env.DB.prepare(`select "workspaceId" from session_end where "sessionId" = ?`)
    .bind(sessionId)
    .all<{ workspaceId: string }>()
    .then(({ results }) => results.map((row) => row.workspaceId).sort());

/** A phone's `device.register` args under `id`. */
const phoneArgs = (id: string) => ({
  id,
  platform: "ios",
  environment: "sandbox",
  pushToken: "f".repeat(64),
  voipToken: null,
  publicKey: `B${"b".repeat(86)}`,
});

/** `/sign-out` with `cookie` through a Worker whose D1 is `db`. */
async function signOutWith(db: D1Database, cookie: string) {
  const request = new Request(`${ORIGIN}/auth/sign-out`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
    body: "{}",
  });
  const ctx = createExecutionContext();
  const out = await workerAuth({ ...env, DB: db }, ctx, request).handler(request);
  await waitOnExecutionContext(ctx);
  return out;
}

const registerOver = (cookie: string, workspaces: string[], device: object) =>
  api(DEVICES_REGISTER_PATH, {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ device, workspaces }),
  });

// A paging path (AGENTS.md): the phone a member signs out of must come off every workspace even when the shard cannot
// be told at once, or it pages them (and stays `taken` for whoever signs in on it next).
describe("a sign-out the shards could not hear of at once", () => {
  test("D1 cannot record it: the sign-out answers 503 and keeps its session, so the app signs out again", async () => {
    const hana = await signUp("Hana");
    await workspaceOf(hana);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request(`${ORIGIN}/auth/sign-out`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: hana.cookie },
      body: "{}",
    });
    const ctx = createExecutionContext();
    const out = await workerAuth({ ...env, DB: failing("session_end") }, ctx, request).handler(
      request,
    );
    await waitOnExecutionContext(ctx);
    expect(out.status).toBe(503);
    expect(((await out.json()) as { code: string }).code).toBe(SIGN_OUT_FAILED_CODE);
    // Answered before Better Auth ran: the cookie is not cleared, so the dashboard keeps its session too.
    expect(out.headers.getSetCookie()).toEqual([]);
    expect(errors.mock.calls.flat().join("\n")).toContain("recording a session's end failed");
    // Still signed in: the kept sign-out is tried again with this cookie.
    const session = await api("/auth/get-session", { headers: { Cookie: hana.cookie } });
    expect(await session.json()).toMatchObject({ user: { id: hana.id } });
    // Once D1 is back, it goes through and is recorded.
    const again = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: hana.cookie },
      body: "{}",
    });
    expect(again.status).toBe(200);
  });

  // Better Auth's own sign-out ignores a failed lookup: it would run no session hook, delete nothing and answer 200.
  test("D1 cannot read the session: 503 before Better Auth runs, the cookie and the session kept", async () => {
    const hugo = await signUp("Hugo");
    await workspaceOf(hugo);
    const id = await sessionId(hugo.cookie);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await signOutWith(failing(`"session" where`), hugo.cookie);
    expect(out.status).toBe(503);
    expect(((await out.json()) as { code: string }).code).toBe(SIGN_OUT_FAILED_CODE);
    expect(out.headers.getSetCookie()).toEqual([]);
    expect(await pendingEnds(id)).toEqual([]);
    const session = await api("/auth/get-session", { headers: { Cookie: hugo.cookie } });
    expect(await session.json()).toMatchObject({ user: { id: hugo.id } });
  });

  test("Better Auth fails to delete the session: 503 with the cookie kept, and the next sign-out goes through", async () => {
    const iris = await signUp("Iris");
    const w = await workspaceOf(iris);
    const id = await sessionId(iris.cookie);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await signOutWith(failing(`delete from "session"`), iris.cookie);
    expect(out.status).toBe(503);
    expect(((await out.json()) as { code: string }).code).toBe(SIGN_OUT_FAILED_CODE);
    expect(out.headers.getSetCookie()).toEqual([]);
    // Its end is on record all the same: a shard catching up acts on it.
    expect(await pendingEnds(id)).toEqual([w.id]);
    const again = await api("/auth/sign-out", {
      method: "POST",
      headers: { Cookie: iris.cookie },
      body: "{}",
    });
    expect(again.status).toBe(200);
    expect(again.headers.getSetCookie().join("\n")).toContain("session_token=;");
    const session = await api("/auth/get-session", { headers: { Cookie: iris.cookie } });
    expect(await session.json()).toBeNull();
  });

  test("one shard fails every try: its row stays, and the sweep takes the phone off and closes the socket later", async () => {
    const ivo = await signUp("Ivo");
    const first = await workspaceOf(ivo, "One");
    const second = await workspaceOf(ivo, "Two");
    const phone = newId("dev", 0, random);
    const owner: Actor = { kind: "user", id: ivo.id, role: "owner" };
    await register(first, owner, phone);
    await register(second, owner, phone);
    const id = await sessionId(ivo.cookie);
    const { closed } = await connect(second, ivo.cookie);
    const ended = { userId: ivo.id, sessionId: id, deviceId: phone, endedAt: Date.now() };
    await recordSessionEnd(env.DB, ended);
    expect(await pendingEnds(id)).toEqual([first.id, second.id].sort());

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const real = env.WORKSPACE;
    const halfBroken = {
      getByName: (name: string) =>
        name === second.id
          ? { endSession: () => Promise.reject(new Error("shard unavailable")) }
          : real.getByName(name),
    };
    await endSessionWith({ ...env, WORKSPACE: halfBroken } as unknown as Env, 1)(ended);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "closing an ended session's sockets failed",
    );
    expect(await devices(first)).toEqual([]);
    expect(await devices(second)).toEqual([phone]);
    expect(await pendingEnds(id)).toEqual([second.id]);

    // Too soon for the sweep: the hook may still be trying.
    await sweepSessionEnds(env, Date.now());
    expect(await devices(second)).toEqual([phone]);
    await sweepSessionEnds(env, Date.now() + SESSION_END_SWEEP_AFTER_MS + 1000);
    expect(await devices(second)).toEqual([]);
    expect(await closed).toBe(1012);
    expect(await pendingEnds(id)).toEqual([]);
  });

  test("whoever signs in on that phone next registers it there, the end caught up first", async () => {
    const jade = await signUp("Jade");
    const kai = await signUp("Kai");
    const w = await workspaceOf(jade);
    await addMember(w.id, kai.id, "responder");
    const phone = newId("dev", 0, random);
    await register(w, { kind: "user", id: jade.id, role: "owner" }, phone);
    // Jade signed out on the phone; the shard never heard of it.
    await recordSessionEnd(env.DB, {
      userId: jade.id,
      sessionId: await sessionId(jade.cookie),
      deviceId: phone,
      endedAt: Date.now(),
    });
    const answer = await registerOver(kai.cookie, [w.id], phoneArgs(phone));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ workspaces: { [w.id]: "ok" } });
    const owners = await w.withShard((shard) =>
      shard.store.scan("devices").map((device) => device.userId),
    );
    expect(owners).toEqual([kai.id]);
  });

  // A paging path (AGENTS.md): a phone left `taken` by a member whose session is gone would never page whoever signed
  // in on it next.
  test("a phone whose member's session is gone, with no sign-out on record, is free for whoever signs in on it next", async () => {
    const joao = await signUp("Joao");
    const kira = await signUp("Kira");
    const w = await workspaceOf(joao);
    await addMember(w.id, kira.id, "responder");
    const phone = newId("dev", Date.now(), random);
    expect(await (await registerOver(joao.cookie, [w.id], phoneArgs(phone))).json()).toEqual({
      workspaces: { [w.id]: "ok" },
    });
    // Joao's session still exists: the phone is still his.
    expect(await (await registerOver(kira.cookie, [w.id], phoneArgs(phone))).json()).toEqual({
      workspaces: { [w.id]: "forbidden" },
    });
    // It ended without its end on record (a sign-out from before `recordSignOut`, an expired session cleaned up).
    await env.DB.prepare(`delete from "session" where id = ?`)
      .bind(await sessionId(joao.cookie))
      .run();
    expect(await (await registerOver(kira.cookie, [w.id], phoneArgs(phone))).json()).toEqual({
      workspaces: { [w.id]: "ok" },
    });
    const owners = await w.withShard((shard) =>
      shard.store.scan("devices").map((device) => device.userId),
    );
    expect(owners).toEqual([kira.id]);
  });

  test("a catch-up D1 cannot do answers `unavailable`, so the phone tries again instead of being refused for good", async () => {
    const leo = await signUp("Leo");
    const w = await workspaceOf(leo);
    const phone = newId("dev", Date.now(), random);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const answer = await runInDurableObject(w.stub, async (instance: WorkspaceDO) => {
      const real: unknown = Reflect.get(instance, "env");
      Reflect.set(instance, "env", { ...env, DB: failing("session_end") });
      try {
        return await instance.registerDevice(
          w.id,
          { kind: "user", id: leo.id, role: "owner" },
          phoneArgs(phone),
        );
      } finally {
        Reflect.set(instance, "env", real);
      }
    });
    expect(answer).toEqual({ ok: false, code: "unavailable" });
    expect(await devices(w)).toEqual([]);
  });

  test("a phone registered again unchanged is not dropped by a sign-out from before it, acted on late", async () => {
    const lua = await signUp("Lua");
    const w = await workspaceOf(lua);
    const phone = newId("dev", Date.now(), random);
    expect((await registerOver(lua.cookie, [w.id], phoneArgs(phone))).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const endedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Nothing changed: `device.register` is a `conflict`, and `device.touch` still records the time.
    expect(await (await registerOver(lua.cookie, [w.id], phoneArgs(phone))).json()).toEqual({
      workspaces: { [w.id]: "ok" },
    });
    // An older session of hers that signed out on the phone, heard of only now.
    await recordSessionEnd(env.DB, {
      userId: lua.id,
      sessionId: "ses_older",
      deviceId: phone,
      endedAt,
    });
    expect(await w.stub.catchUpSessionEnds(w.id)).toBe(true);
    expect(await devices(w)).toEqual([phone]);
  });

  test("the sweep deletes the rows of a workspace whose shard serves none, instead of coming back to them", async () => {
    const nobody = newId("ws", Date.now(), random);
    await env.DB.prepare(
      `insert into session_end ("workspaceId", "sessionId", "userId", "deviceId", "endedAt") values (?, ?, ?, null, ?)`,
    )
      .bind(nobody, "ses_gone", "usr_gone", Date.now())
      .run();
    await sweepSessionEnds(env, Date.now() + SESSION_END_SWEEP_AFTER_MS + 1000);
    expect(await pendingEnds("ses_gone")).toEqual([]);
  });

  test("a sign-out acted on late never drops the phone its member signed in on again since", async () => {
    const lia = await signUp("Lia");
    const w = await workspaceOf(lia);
    const phone = newId("dev", 0, random);
    const endedAt = Date.now();
    await recordSessionEnd(env.DB, {
      userId: lia.id,
      sessionId: await sessionId(lia.cookie),
      deviceId: phone,
      endedAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await register(w, { kind: "user", id: lia.id, role: "owner" }, phone);
    expect(await w.stub.catchUpSessionEnds(w.id)).toBe(true);
    expect(await devices(w)).toEqual([phone]);
  });
});

describe("registering a phone in every workspace it was opened in", () => {
  test("one request registers it in each, and says which are not the member's", async () => {
    const mia = await signUp("Mia");
    const nico = await signUp("Nico");
    const mine = await workspaceOf(mia, "One");
    const also = await workspaceOf(mia, "Two");
    const theirs = await workspaceOf(nico, "Theirs");
    const phone = newId("dev", 0, random);
    const answer = await registerOver(mia.cookie, [mine.id, also.id, theirs.id], phoneArgs(phone));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({
      workspaces: { [mine.id]: "ok", [also.id]: "ok", [theirs.id]: "not_a_member" },
    });
    expect(await devices(mine)).toEqual([phone]);
    expect(await devices(also)).toEqual([phone]);
    expect(await devices(theirs)).toEqual([]);
    // Nothing changed: still `ok`.
    expect(await (await registerOver(mia.cookie, [mine.id], phoneArgs(phone))).json()).toEqual({
      workspaces: { [mine.id]: "ok" },
    });
  });

  test("another member's device is `forbidden` there; bad bodies and no session are refused", async () => {
    const otto = await signUp("Otto");
    const pia = await signUp("Pia");
    const w = await workspaceOf(otto);
    await addMember(w.id, pia.id, "responder");
    const phone = newId("dev", 0, random);
    await register(w, { kind: "user", id: otto.id, role: "owner" }, phone);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = phoneArgs(phone);
    expect(await (await registerOver(pia.cookie, [w.id], args)).json()).toEqual({
      workspaces: { [w.id]: "forbidden" },
    });
    // Each answer that is not `ok` is logged for `wrangler tail`, with its workspace and code and nothing secret.
    const refused = warnings.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes("device registration refused"));
    expect(refused.map((line) => JSON.parse(line))).toEqual([
      { message: "device registration refused", workspace: w.id, code: "forbidden" },
    ]);
    const logged = warnings.mock.calls.flat().join(" ");
    expect(logged).not.toContain(args.pushToken);
    expect(logged).not.toContain(args.publicKey);
    warnings.mockRestore();
    expect((await registerOver(pia.cookie, [], phoneArgs(phone))).status).toBe(400);
    expect((await registerOver(pia.cookie, ["nope"], phoneArgs(phone))).status).toBe(400);
    expect((await registerOver("", [w.id], phoneArgs(phone))).status).toBe(401);
    expect(
      (
        await api(DEVICES_REGISTER_PATH, {
          method: "POST",
          headers: { Cookie: pia.cookie, Origin: "https://evil.example" },
          body: JSON.stringify({ device: phoneArgs(phone), workspaces: [w.id] }),
        })
      ).status,
    ).toBe(403);
  });
});

/** A sync upgrade as the Worker forwards it, sent straight to the shard (one it authenticated a moment ago). */
const forwarded = (w: Workspace, actor: Actor, headers: Record<string, string>) =>
  w.stub.fetch(`${ORIGIN}/sync/${w.id}`, {
    headers: {
      Upgrade: "websocket",
      [WORKSPACE_HEADER]: w.id,
      [ACTOR_HEADER]: JSON.stringify(actor),
      [MEMBER_NAME_HEADER]: encodeURIComponent("Quin"),
      ...headers,
    },
  });

describe("sockets of a session that ended or expired", () => {
  test("an upgrade the Worker let through just before its session ended is refused by the shard", async () => {
    const quin = await signUp("Quin");
    const w = await workspaceOf(quin);
    const actor: Actor = { kind: "user", id: quin.id, role: "owner" };
    const id = await sessionId(quin.cookie);
    expect(await w.stub.endSession(w.id, { userId: quin.id, sessionId: id })).toEqual({ ok: true });
    expect((await forwarded(w, actor, { [SESSION_HEADER]: id })).status).toBe(401);
    // Another session of theirs still opens.
    const other = await sessionId(await sessionCookie(quin.email, PASSWORD));
    const opened = await forwarded(w, actor, { [SESSION_HEADER]: other });
    expect(opened.status).toBe(101);
    opened.webSocket!.accept();
    open.push(opened.webSocket!);
  });

  test("a socket closes when its session expires: refused if already expired, closed on its next frame or by the alarm", async () => {
    const rui = await signUp("Rui");
    const w = await workspaceOf(rui);
    const actor: Actor = { kind: "user", id: rui.id, role: "owner" };
    const id = await sessionId(rui.cookie);
    expect(
      (
        await forwarded(w, actor, {
          [SESSION_HEADER]: id,
          [SESSION_EXPIRES_HEADER]: String(Date.now() - 1),
        })
      ).status,
    ).toBe(401);

    const accept = async (expiresAt: number) => {
      const response = await forwarded(w, actor, {
        [SESSION_HEADER]: id,
        [SESSION_EXPIRES_HEADER]: String(expiresAt),
      });
      expect(response.status).toBe(101);
      const socket = response.webSocket!;
      socket.accept();
      open.push(socket);
      const closed = new Promise<{ code: number; reason: string }>((resolve) =>
        socket.addEventListener("close", (event) =>
          resolve({ code: event.code, reason: event.reason }),
        ),
      );
      return { socket, closed };
    };
    // Idle: the alarm the upgrade armed for its expiry closes it.
    const idle = await accept(Date.now() + 200);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runDurableObjectAlarm(w.stub);
    expect(await idle.closed).toEqual({ code: 1012, reason: "session expired" });

    // Talking: its next frame after the expiry closes it, whether or not the alarm ran.
    const talking = await accept(Date.now() + 60 * 60 * 1000);
    await runInDurableObject(w.stub, (_instance, state) => {
      for (const ws of state.getWebSockets(sessionTag(id))) {
        const socket = ws.deserializeAttachment() as SocketState;
        if (!socket.closed) ws.serializeAttachment({ ...socket, expiresAt: Date.now() - 1 });
      }
    });
    talking.socket.send(
      JSON.stringify({ type: "hello", protocol: PROTOCOL_VERSION, clientId: "t" }),
    );
    expect(await talking.closed).toEqual({ code: 1012, reason: "session expired" });
  });

  test("the Worker passes the session's expiry with the upgrade", async () => {
    const sol = await signUp("Sol");
    const w = await workspaceOf(sol);
    await connect(w, sol.cookie);
    const expiries = await runInDurableObject(w.stub, (_instance, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as SocketState).expiresAt),
    );
    expect(expiries).toHaveLength(1);
    expect(expiries[0]).toBeGreaterThan(Date.now());
  });
});

describe("signing in after a password reset", () => {
  test("from where it was reset, the address's own limit no longer keeps its owner out; from elsewhere it still does", async () => {
    // Signed up without signing in, so no try is counted yet.
    const tom = { email: address("Tom") };
    expect((await signUpRequest("Tom", tom.email)).status).toBe(200);
    for (let i = 0; i < SIGN_IN_ACCOUNT_LIMIT.max; i++) {
      expect((await signIn(tom.email, "not the password")).status).toBe(401);
    }
    const home = "192.0.2.240";
    expect((await signIn(tom.email, PASSWORD, home)).status).toBe(429);
    // The reset, from `home`, as the dashboard's reset page sends it.
    const sent = outbox();
    const resets = () =>
      sent().filter((one) => one.to.email === tom.email && one.text.includes("/reset-password#"));
    expect(
      (
        await api("/auth/request-password-reset", {
          method: "POST",
          headers: { "cf-connecting-ip": home },
          body: JSON.stringify({ email: tom.email }),
        })
      ).status,
    ).toBe(200);
    await vi.waitFor(() => expect(resets().length).toBeGreaterThan(0));
    const link = new URL(/https?:\/\/\S+/.exec(resets().at(-1)!.text)![0]);
    const token = new URLSearchParams(link.hash.slice(1)).get("token")!;
    const newPassword = "a whole new password here";
    const done = await api("/auth/reset-password", {
      method: "POST",
      headers: { "cf-connecting-ip": home },
      body: JSON.stringify({ token, newPassword }),
    });
    expect(done.status).toBe(200);
    expect((await signIn(tom.email, newPassword, home)).status).toBe(200);
    expect((await signIn(tom.email, newPassword)).status).toBe(429);
    const row = await env.DB.prepare(`select "lastRequest" from "rateLimit" where key = ?`)
      .bind(`signin-reset:${tom.email}:${home}`)
      .first<{ lastRequest: number }>();
    expect(Date.now() - row!.lastRequest).toBeLessThan(SIGN_IN_AFTER_RESET.window * 1000);
  });
});

describe("rate-limit counters", () => {
  test("the cron deletes those past every window", async () => {
    const insert = (key: string, at: number) =>
      env.DB.prepare(`insert into "rateLimit" (id, key, count, "lastRequest") values (?, ?, 1, ?)`)
        .bind(newId("rl", at, random), key, at)
        .run();
    const now = Date.now();
    await insert("signin:old@example.com", now - RATE_LIMIT_KEEP_MS - 1000);
    await insert("signin:new@example.com", now - 1000);
    await pruneRateLimits(env.DB, now);
    const keys = await env.DB.prepare(
      `select key from "rateLimit" where key in ('signin:old@example.com', 'signin:new@example.com')`,
    ).all<{ key: string }>();
    expect(keys.results.map((row) => row.key)).toEqual(["signin:new@example.com"]);
  });

  test("a member change is counted only in a workspace that is the caller's", async () => {
    const uma = await signUp("Uma");
    // Made-up workspaces: nobody's, existing or not.
    for (const workspace of [`ws_${"0".repeat(26)}`, `ws_${"1".repeat(26)}`]) {
      const answer = await api(`/workspaces/${workspace}/members/${uma.id}`, {
        method: "DELETE",
        headers: { Cookie: uma.cookie },
      });
      expect(answer.status).toBe(403);
    }
    const counted = await env.DB.prepare(`select count(*) as n from "rateLimit" where key like ?`)
      .bind(`member-change:%:${uma.id}`)
      .first<{ n: number }>();
    expect(counted?.n).toBe(0);
  });

  test("a sign-in with something that is no address leaves no counter", async () => {
    expect((await signIn("not an address", PASSWORD)).status).toBe(400);
    const counted = await env.DB.prepare(`select count(*) as n from "rateLimit" where key = ?`)
      .bind("signin:not an address")
      .first<{ n: number }>();
    expect(counted?.n).toBe(0);
  });
});
