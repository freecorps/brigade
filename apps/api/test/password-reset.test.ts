// Password reset (RFC 0002 "Auth"): asking for the email (the same answer for any address, its limits, what it says),
// setting the new password with its link (and with an expired, forged or used one), what a reset ends (every session,
// the account's devices and sockets in each workspace) and proves (the address), and taking back an address someone
// else signed up with and never verified.
import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { heartbeatToken, newHeartbeatSecret, newId, type Actor } from "@freecorps/brigade-schema";
import { PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  createAuth,
  EMAIL_NOT_CONFIGURED_CODE,
  RESET_ADDRESS_LIMIT,
  RESET_DAILY_LIMIT,
  RESET_IP_LIMIT,
} from "../src/auth.ts";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { renderPasswordResetEmail } from "../src/email-templates.ts";
import { signOutWith, type InheritedWorkspace } from "../src/index.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { pageTargets } from "../src/paging.ts";
import { Shard, type MutateInput } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "another horse, another staple";
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-1) per call: these routes are rate-limited per IP. */
const clientIp = () => `192.0.${Math.floor(++clients / 250) % 250}.${(clients % 250) + 1}`;

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

const address = (name: string) => `${name.toLowerCase()}-r${++people}@example.com`;

async function signUp(name: string, email = address(name), locale?: string) {
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD, ...(locale ? { locale } : {}) }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return { id: body.user.id, email, cookie: cookieOf(response) };
}

const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

const signIn = (email: string, password: string) =>
  api("/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });

const requestReset = (email: string, headers: Record<string, string> = {}) =>
  api("/auth/request-password-reset", {
    method: "POST",
    headers,
    body: JSON.stringify({ email }),
  });

const reset = (token: string, newPassword = NEW_PASSWORD) =>
  api("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) });

const sessionOf = async (cookie: string) =>
  (await api("/auth/get-session", { headers: { Cookie: cookie } })).json() as Promise<{
    user: { id: string; emailVerified: boolean };
  } | null>;

const verified = (userId: string) =>
  env.DB.prepare(`select "emailVerified" as v from "user" where id = ?`)
    .bind(userId)
    .first<{ v: number }>()
    .then((row) => row?.v);

/** The token in a reset link: in its fragment, which browsers never send. */
const tokenOf = (link: URL) => new URLSearchParams(link.hash.slice(1)).get("token")!;

/** Asks for a reset of `email` and answers the link the reset email carries. */
async function resetLink(email: string, headers: Record<string, string> = {}): Promise<URL> {
  const sent = outbox();
  const resets = () =>
    sent().filter((one) => one.to.email === email && one.text.includes("/reset-password#"));
  expect((await requestReset(email, headers)).status).toBe(200);
  await vi.waitFor(() => expect(resets().length).toBeGreaterThan(0));
  return new URL(/https?:\/\/\S+/.exec(resets().at(-1)!.text)![0]);
}

describe("asking for a reset", () => {
  test("the same answer for an address with an account and one without; only the first gets an email", async () => {
    const ana = await signUp("Ana", address("Ana"), "pt-BR");
    const nobody = address("Nobody");
    const sent = outbox();
    const known = await requestReset(ana.email);
    const unknown = await requestReset(nobody);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());

    await vi.waitFor(() => expect(sent().some((one) => one.to.email === ana.email)).toBe(true));
    const email = sent().find((one) => one.to.email === ana.email)!;
    expect(email.subject).toBe("Redefina sua senha do Brigade");
    // Nothing the person who signed up typed but the address.
    expect(email.to).toEqual({ email: ana.email });
    expect(email.text).not.toContain("Ana");
    const link = new URL(/https?:\/\/\S+/.exec(email.text)![0]);
    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe("/reset-password");
    expect(link.search).toBe("");
    expect([...new URLSearchParams(link.hash.slice(1)).keys()]).toEqual(["token"]);
    expect(sent().some((one) => one.to.email === nobody)).toBe(false);
  });

  test("a redirect the request names is dropped: the link is always the dashboard's page", async () => {
    const bia = await signUp("Bia");
    const sent = outbox();
    const response = await api("/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email: bia.email, redirectTo: "/elsewhere" }),
    });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(sent().some((one) => one.to.email === bia.email)).toBe(true));
    const link = new URL(/https?:\/\/\S+/.exec(sent()[0]!.text)![0]);
    expect(link.pathname).toBe("/reset-password");
    expect(link.searchParams.get("callbackURL")).toBe(null);
  });

  test("at most `RESET_ADDRESS_LIMIT` an hour per address from one IP, counted the same with or without an account", async () => {
    const caio = await signUp("Caio");
    const nobody = address("Nobody");
    const squatter = "192.0.2.240";
    const sent = outbox();
    for (let i = 0; i < RESET_ADDRESS_LIMIT.max; i++) {
      expect((await askFrom(squatter, caio.email)).status).toBe(200);
      // The address as typed, in any case: one address.
      expect((await askFrom(squatter, i === 0 ? nobody.toUpperCase() : nobody)).status).toBe(200);
    }
    const known = await askFrom(squatter, caio.email);
    const unknown = await askFrom(squatter, nobody);
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    await vi.waitFor(() =>
      expect(sent().filter((one) => one.to.email === caio.email)).toHaveLength(
        RESET_ADDRESS_LIMIT.max,
      ),
    );
    // Q21: someone asking for another person's address uses up their own count, not the owner's.
    expect((await askFrom("192.0.2.241", caio.email)).status).toBe(200);
    await vi.waitFor(() =>
      expect(sent().filter((one) => one.to.email === caio.email)).toHaveLength(
        RESET_ADDRESS_LIMIT.max + 1,
      ),
    );
  });

  test("at most `RESET_DAILY_LIMIT` a day per address, from any IP", async () => {
    const duda = await signUp("Duda");
    for (let i = 0; i < RESET_DAILY_LIMIT.max; i++) {
      expect((await requestReset(duda.email)).status).toBe(200);
    }
    expect((await requestReset(duda.email)).status).toBe(429);
  });

  test("requests at once each count: no more than the limit pass", async () => {
    const email = address("Eva");
    const statuses = await Promise.all(
      Array.from({ length: RESET_DAILY_LIMIT.max + 3 }, () => requestReset(email)),
    );
    expect(statuses.filter((response) => response.status === 200)).toHaveLength(
      RESET_DAILY_LIMIT.max,
    );
  });

  test("at most `RESET_IP_LIMIT` a minute from one IP, whichever addresses", async () => {
    const ip = { "cf-connecting-ip": "192.0.2.250" };
    for (let i = 0; i < RESET_IP_LIMIT.max; i++) {
      expect((await requestReset(address("Ip"), ip)).status).toBe(200);
    }
    expect((await requestReset(address("Ip"), ip)).status).toBe(429);
  });

  test("without a sender, it says email is not set up, whatever the address", async () => {
    const fia = await signUp("Fia");
    const auth = createAuth({
      database: env.DB,
      secret: env.BETTER_AUTH_SECRET,
      email: { sender: undefined },
    });
    for (const email of [fia.email, address("Nobody")]) {
      const response = await auth.handler(
        new Request(`${ORIGIN}/auth/request-password-reset`, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp(),
          },
          body: JSON.stringify({ email }),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: EMAIL_NOT_CONFIGURED_CODE });
    }
  });

  test("a sender that delivers needs `DASHBOARD_URL`: without it, no link from the request's origin", async () => {
    const sent: OutgoingEmail[] = [];
    const sender: EmailSender = {
      id: "test",
      async send(email) {
        sent.push(email);
        return { ok: true };
      },
    };
    const gil = await signUp("Gil");
    const ask = async (dashboardUrl: string | undefined) => {
      const auth = createAuth({
        database: env.DB,
        secret: env.BETTER_AUTH_SECRET,
        email: { sender, ...(dashboardUrl ? { dashboardUrl } : {}) },
      });
      const response = await auth.handler(
        new Request(`${ORIGIN}/auth/request-password-reset`, {
          method: "POST",
          headers: {
            Origin: ORIGIN,
            "Content-Type": "application/json",
            "cf-connecting-ip": clientIp(),
          },
          body: JSON.stringify({ email: gil.email }),
        }),
      );
      expect(response.status).toBe(200);
    };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await ask(undefined);
    await vi.waitFor(() =>
      expect(errors.mock.calls.flat().join("\n")).toContain("DASHBOARD_URL is not set"),
    );
    expect(sent).toHaveLength(0);
    await ask("https://brigade.example.com");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.text).toContain("https://brigade.example.com/reset-password#token=");
  });

  test("Better Auth's redirect with the token in it is refused", async () => {
    const response = await api("/auth/reset-password/abc?callbackURL=brigade://reset");
    expect(response.status).toBe(404);
  });
});

/**
 * Asks for a reset of `email` from `ip`, after letting Better Auth's per-IP minute (`RESET_IP_LIMIT`) pass, so only
 * Brigade's own counts can refuse it.
 */
async function askFrom(ip: string, email: string) {
  await env.DB.prepare(`delete from "rateLimit" where key like ? and key not like 'reset%'`)
    .bind(`%${ip}%`)
    .run();
  return requestReset(email, { "cf-connecting-ip": ip });
}

describe("what the reset email says", () => {
  test("in the user's language, the address and the link escaped in the HTML", () => {
    const email = `o'brien+<b>@example.com`;
    const link = "https://brigade.example.com/reset-password?token=abc&x=1";
    const en = renderPasswordResetEmail({ email }, link, "en");
    expect(en.subject).toBe("Reset your Brigade password");
    expect(en.to).toEqual({ email });
    expect(en.text).toContain(email);
    expect(en.text).toContain(link);
    expect(en.text).toContain("1 hour");
    expect(en.html).not.toContain("<b>");
    expect(en.html).toContain("o&#39;brien+&lt;b&gt;@example.com");
    expect(en.html).toContain(`href="${link.replace(/&/g, "&amp;")}"`);
    const pt = renderPasswordResetEmail({ email: "ana@example.com" }, link, "pt-BR");
    expect(pt.subject).toBe("Redefina sua senha do Brigade");
    expect(pt.html).toContain('lang="pt-BR"');
  });
});

describe("setting the new password", () => {
  test("ends every session, proves the address, and the new password signs in", async () => {
    const hana = await signUp("Hana");
    const other = cookieOf(await signIn(hana.email, PASSWORD));
    expect(await verified(hana.id)).toBe(0);
    const token = tokenOf(await resetLink(hana.email));

    const response = await reset(token);
    expect(response.status).toBe(200);
    expect(await sessionOf(hana.cookie)).toBe(null);
    expect(await sessionOf(other)).toBe(null);
    expect(await verified(hana.id)).toBe(1);
    expect((await signIn(hana.email, PASSWORD)).status).toBe(401);
    const signedIn = await signIn(hana.email, NEW_PASSWORD);
    expect(signedIn.status).toBe(200);
    expect(await sessionOf(cookieOf(signedIn))).toMatchObject({
      user: { id: hana.id, emailVerified: true },
    });
  });

  test("a password shorter than Better Auth's minimum is refused, and the link still works", async () => {
    const ivo = await signUp("Ivo");
    const token = tokenOf(await resetLink(ivo.email));
    const short = await reset(token, "seven77");
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    expect(await sessionOf(ivo.cookie)).toMatchObject({ user: { id: ivo.id } });
    expect(await verified(ivo.id)).toBe(0);
    expect((await reset(token)).status).toBe(200);
  });

  test("a used, expired or made-up token changes nothing", async () => {
    const jon = await signUp("Jon");
    const used = tokenOf(await resetLink(jon.email));
    expect((await reset(used)).status).toBe(200);
    const again = await reset(used, "a third password, a third staple");
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: "INVALID_TOKEN" });

    const kai = await signUp("Kai");
    const expired = tokenOf(await resetLink(kai.email));
    await env.DB.prepare(`update verification set "expiresAt" = ? where identifier = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), `reset-password:${expired}`)
      .run();
    const late = await reset(expired);
    expect(late.status).toBe(400);
    expect(await late.json()).toMatchObject({ code: "INVALID_TOKEN" });

    const forged = await reset("a".repeat(24));
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({ code: "INVALID_TOKEN" });
    // Kai's account is as it was.
    expect(await sessionOf(kai.cookie)).toMatchObject({ user: { id: kai.id } });
    expect(await verified(kai.id)).toBe(0);
    expect((await signIn(kai.email, PASSWORD)).status).toBe(200);
  });
});

/** A workspace `person` owns, with a handle on its shard. */
async function workspaceOf(person: { cookie: string }) {
  const created = await api("/workspaces", {
    method: "POST",
    headers: { Cookie: person.cookie },
    body: JSON.stringify({ name: "Squat" }),
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

/** Registers a device for `actor` straight in the shard, as `device.register` from their phone would. */
const device = (w: Workspace, actor: Actor) =>
  w.withShard((shard) => {
    const id = newId("dev", Date.now(), random);
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
    return id;
  });

/** Runs `name` in the shard as `actor`, as their client would. */
const run = (w: Workspace, actor: Actor, name: string, args: Record<string, unknown>) =>
  w.withShard((shard) => {
    const { result } = shard.mutate({
      clientId: "test",
      mutationId: newId("mut", Date.now(), random),
      actor,
      name,
      args,
      now: Date.now(),
      internal: true,
    });
    expect(result).toMatchObject({ ok: true });
  });

const sha256Hex = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/** What someone who signed up could leave behind to page the account: a check on their host, a heartbeat URL. */
async function plantMonitors(w: Workspace, actor: Actor) {
  const check = newId("mon", Date.now(), random);
  await run(w, actor, "monitor.createHttp", {
    id: check,
    name: "Their host",
    url: "https://example.com/health",
    method: "GET",
    expectedStatus: null,
    keyword: null,
    intervalSeconds: 60,
    timeoutSeconds: 10,
    regions: ["weur"],
  });
  const beat = newId("mon", Date.now(), random);
  const secret = newHeartbeatSecret(random);
  await run(w, actor, "monitor.createHeartbeat", {
    id: beat,
    name: "Their cron",
    intervalSeconds: 60,
    graceSeconds: 30,
    tokenHash: await sha256Hex(secret),
  });
  const ping = () =>
    exports.default.fetch(`${ORIGIN}/heartbeat/${heartbeatToken(w.id, beat, secret)}`, {
      method: "POST",
    });
  return { check, beat, ping };
}

const notice = (cookie: string, method = "GET") =>
  api("/account/takeover", { method, headers: { Cookie: cookie } });

/**
 * Makes the shard's `device.signOut` throw, `times` times (every time without it), as a storage failure would.
 * Undone by `vi.restoreAllMocks`.
 */
const failSignOut = (w: Workspace, times = Infinity) =>
  runInDurableObject(w.stub, (instance: WorkspaceDO) => {
    const shard = Reflect.get(instance, "shard") as Shard;
    const mutate = shard.mutate.bind(shard);
    let failures = 0;
    vi.spyOn(shard, "mutate").mockImplementation((input: MutateInput) => {
      if (input.name === "device.signOut" && failures++ < times) throw new Error("storage failed");
      return mutate(input);
    });
  });

/** The shard's devices, what a page would find, and the `device.unregistered` events in its outbox. */
const pagedState = (w: Workspace) =>
  w.withShard((shard, state) => ({
    devices: shard.store.scan("devices").map((row) => row.id),
    noDevices: pageTargets(shard.store, { roles: {} }, "sys_monitors").noDevices,
    unregistered: state.storage.sql
      .exec<{ event: string }>("select event from outbox order by seq")
      .toArray()
      .map((row) => JSON.parse(row.event) as BrigadeEvent)
      .filter((event) => event.type === "device.unregistered")
      .map((event) => event.data),
  }));

/** Opens a socket as `cookie`'s user; resolves with a promise of its close code. */
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
  await w.stub.reconcileMembers();
  return { closed };
}

describe("an address someone else signed up with", () => {
  // RFC 0002 "Auth": an account nobody verified keeps its address, so its owner takes it back with a reset. The
  // reset proves the address; whoever signed up with it loses every session, phone and socket.
  test("comes back to its owner: the squatter is signed out everywhere, the workspace stays", async () => {
    const sent = outbox();
    const email = address("Owner");
    const squatter = await signUp("Squatter", email);
    await vi.waitFor(() => expect(sent().some((one) => one.to.email === email)).toBe(true));
    const verification = new URL(/https?:\/\/\S+/.exec(sent()[0]!.text)![0]).searchParams.get(
      "token",
    )!;
    const w = await workspaceOf(squatter);
    const actor: Actor = { kind: "user", id: squatter.id, role: "owner" };
    const phone = await device(w, actor);
    const planted = await plantMonitors(w, actor);
    expect((await planted.ping()).status).toBe(202);
    const { closed } = await connect(w, squatter.cookie);

    // The owner of the address, who has no session, asks from the sign-in page.
    const link = await resetLink(email);
    expect((await reset(tokenOf(link))).status).toBe(200);

    expect(await sessionOf(squatter.cookie)).toBe(null);
    expect(await closed).toBe(1012);
    const again = await exports.default.fetch(`${ORIGIN}/sync/${w.id}`, {
      headers: { Upgrade: "websocket", Cookie: squatter.cookie, Origin: ORIGIN },
    });
    expect(again.status).toBe(401);
    // The squatter's phone is no longer paged as this account: a page finds no device and takes the fallback.
    const after = await pagedState(w);
    expect(after.devices).toEqual([]);
    expect(after.noDevices).toEqual([squatter.id]);
    expect(after.unregistered).toEqual([
      { id: phone, userId: squatter.id, reason: "password_reset" },
    ]);

    // Nothing the squatter set up can page the owner: every monitor is paused, and the heartbeat URL they kept no
    // longer works.
    const monitors = await w.withShard((shard) =>
      shard.store.scan("monitors").map((row) => [row.id, row.paused, row.pausedBy]),
    );
    expect(monitors).toEqual([
      [planted.check, true, "sys_account"],
      [planted.beat, true, "sys_account"],
    ]);
    expect((await planted.ping()).status).toBe(404);

    // The owner signs in with the address, verified, and owns what the account held.
    const owner = await signIn(email, NEW_PASSWORD);
    expect(owner.status).toBe(200);
    const cookie = cookieOf(owner);
    // Told once what they inherited and what Brigade paused.
    const told = (await (await notice(cookie)).json()) as {
      notice: { workspaces: InheritedWorkspace[] } | null;
    };
    expect(told.notice?.workspaces).toEqual([
      { id: w.id, name: "Squat", paused: ["Their host", "Their cron"], revoked: 1, failed: false },
    ]);
    expect((await notice(cookie, "DELETE")).status).toBe(204);
    expect(await (await notice(cookie)).json()).toEqual({ notice: null });
    expect((await notice(squatter.cookie)).status).toBe(401);
    expect(await sessionOf(cookie)).toMatchObject({
      user: { id: squatter.id, emailVerified: true },
    });
    const role = await env.DB.prepare(
      `select role from member where "organizationId" = ? and "userId" = ?`,
    )
      .bind(w.id, squatter.id)
      .first<{ role: string }>();
    expect(role?.role).toBe("owner");
    await connect(w, cookie);

    // The old verification link still reaches only the one account that ever held the address.
    const bystander = await signUp("Bystander");
    expect((await api(`/auth/verify-email?token=${encodeURIComponent(verification)}`)).ok).toBe(
      true,
    );
    expect(await verified(squatter.id)).toBe(1);
    expect(await verified(bystander.id)).toBe(0);
    const holders = await env.DB.prepare(`select id from "user" where email = ?`)
      .bind(email)
      .all<{ id: string }>();
    expect(holders.results).toEqual([{ id: squatter.id }]);
  });

  test("a reset of a verified account signs it out but leaves its monitors alone, with no notice", async () => {
    const nara = await signUp("Nara");
    await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(nara.id).run();
    const w = await workspaceOf(nara);
    const actor: Actor = { kind: "user", id: nara.id, role: "owner" };
    await device(w, actor);
    const planted = await plantMonitors(w, actor);
    expect((await reset(tokenOf(await resetLink(nara.email)))).status).toBe(200);
    expect((await pagedState(w)).devices).toEqual([]);
    const paused = await w.withShard((shard) =>
      shard.store.scan("monitors").map((row) => row.paused),
    );
    expect(paused).toEqual([false, false]);
    expect((await planted.ping()).status).toBe(202);
    const cookie = cookieOf(await signIn(nara.email, NEW_PASSWORD));
    expect(await (await notice(cookie)).json()).toEqual({ notice: null });
  });

  test("a reset deletes the account's other links: none of them resets the password again", async () => {
    const otto = await signUp("Otto");
    const first = tokenOf(await resetLink(otto.email));
    const second = tokenOf(await resetLink(otto.email));
    expect((await reset(second)).status).toBe(200);
    const again = await reset(first, "a third password, a third staple");
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await signIn(otto.email, NEW_PASSWORD)).status).toBe(200);
  });

  // A paging path (AGENTS.md): a phone the reset could not sign out must not keep getting the account's pages.
  test("a shard that fails once is tried again: the phone is signed out and no page reaches it", async () => {
    const pia = await signUp("Pia");
    const w = await workspaceOf(pia);
    const phone = await device(w, { kind: "user", id: pia.id, role: "owner" });
    const { closed } = await connect(w, pia.cookie);
    await failSignOut(w, 1);
    const errors = vi.spyOn(console, "error");

    expect((await reset(tokenOf(await resetLink(pia.email)))).status).toBe(200);
    expect(await closed).toBe(1012);
    const after = await pagedState(w);
    expect(after.devices).toEqual([]);
    expect(after.noDevices).toEqual([pia.id]);
    expect(after.unregistered).toEqual([{ id: phone, userId: pia.id, reason: "password_reset" }]);
    expect(errors.mock.calls.flat().join("\n")).not.toContain(
      "signing a reset account out of a workspace failed",
    );
  });

  test("a shard that keeps failing still closes the sockets, and its member reconcile drops the phone", async () => {
    const rui = await signUp("Rui");
    const w = await workspaceOf(rui);
    const actor: Actor = { kind: "user", id: rui.id, role: "owner" };
    const phone = await device(w, actor);
    const { closed } = await connect(w, rui.cookie);
    await failSignOut(w);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await reset(tokenOf(await resetLink(rui.email)))).status).toBe(200);
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "signing a reset account out of a workspace failed",
    );
    // The sockets close whatever happened; the phone is still registered for now.
    expect(await closed).toBe(1012);
    expect((await pagedState(w)).devices).toEqual([phone]);
    // The failure armed the shard's member repair, which the alarm runs.
    const repairAt = await w.withShard(
      (_shard, state) =>
        state.storage.sql
          .exec<{ value: number }>("select value from member_repair where key = 'at'")
          .toArray()[0]?.value,
    );
    expect(repairAt).toBeGreaterThan(0);
    // The owner signs in again on their own phone meanwhile: registered after the reset, it stays.
    const own = await device(w, actor);
    // The told-once notice says the shard could not be reached.
    const cookie = cookieOf(await signIn(rui.email, NEW_PASSWORD));
    const told = (await (await notice(cookie)).json()) as {
      notice: { workspaces: InheritedWorkspace[] } | null;
    };
    expect(told.notice?.workspaces).toMatchObject([{ id: w.id, failed: true, paused: [] }]);

    vi.restoreAllMocks();
    // What the repair alarm (or the next sync upgrade) runs.
    await w.stub.reconcileMembers();
    const after = await pagedState(w);
    expect(after.devices).toEqual([own]);
    expect(after.unregistered).toEqual([{ id: phone, userId: rui.id, reason: "password_reset" }]);
  });

  test("a reset never fails for a shard that cannot sign the account out: it is logged", async () => {
    const lia = await signUp("Lia");
    // A workspace in D1 whose shard was never provisioned.
    const workspace = newId("ws", Date.now(), random);
    await env.DB.batch([
      env.DB.prepare(
        `insert into organization (id, name, slug, "createdAt") values (?, 'Lost', ?, ?)`,
      ).bind(workspace, workspace, new Date().toISOString()),
      env.DB.prepare(
        `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
      ).bind(
        newId("mem", Date.now(), random),
        workspace,
        lia.id,
        "owner",
        new Date().toISOString(),
      ),
    ]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      signOutWith(env, 0)(lia.id, { takeOver: false, at: Date.now() }),
    ).resolves.toBeUndefined();
    expect(errors.mock.calls.flat().join("\n")).toContain(
      "signing a reset account out of a workspace failed",
    );
    const token = tokenOf(await resetLink(lia.email));
    expect((await reset(token)).status).toBe(200);
    expect(await verified(lia.id)).toBe(1);
  });
});
