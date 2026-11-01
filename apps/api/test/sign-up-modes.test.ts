// Sign-up modes (src/sign-up.ts, RFC 0002 "Sign-up modes"): `SIGNUP` open, invite and closed through the Worker, the
// invitation that lets a new person in under `invite` and `closed`, the per-IP sign-up limit still counting refused
// sign-ups, and `GET /config`.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, test, vi } from "vite-plus/test";
import worker from "../src/index.ts";
import {
  SIGN_UP_CLOSED_CODE,
  signUpMode,
  verifiedEmailRequired,
  type SignUpMode,
} from "../src/sign-up.ts";
import { generateInstanceKey } from "@freecorps/brigade-push/instance";
import { BRIGADE_API_VERSION, MIN_APP_VERSION } from "../src/relay-instance.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

let people = 0;
const email = (name: string) => `${name.toLowerCase()}-m${++people}@example.com`;
let clients = 0;
/** A new client IP (TEST-NET-3) per call: sign-up is rate-limited per IP. */
const clientIp = () => `203.0.${Math.floor(++clients / 250) % 113}.${(clients % 250) + 1}`;

/**
 * The Worker as an instance with `SIGNUP` set to `mode` (`undefined`: unset), and `vars` over the tests' env (a var
 * set to `undefined` is taken out: `EMAIL_LOG: undefined` is an instance without email).
 */
function under(
  mode: string | undefined,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
  vars: Record<string, string | undefined> = {},
) {
  const { SIGNUP: _unset, ...base } = env as typeof env & { SIGNUP?: string };
  const rest: Record<string, unknown> = { ...base, ...vars };
  for (const [name, value] of Object.entries(vars)) if (value === undefined) delete rest[name];
  const request = new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  }) as Parameters<typeof worker.fetch>[0];
  const instance = (mode === undefined ? rest : { ...rest, SIGNUP: mode }) as unknown as typeof env;
  return worker.fetch(request, instance, createExecutionContext());
}

const signUp = (
  mode: string | undefined,
  address: string,
  headers: Record<string, string> = {},
  vars: Record<string, string | undefined> = {},
) =>
  under(
    mode,
    "/auth/sign-up/email",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Rui", email: address, password: PASSWORD }),
    },
    vars,
  );

const signIn = (address: string, vars: Record<string, string | undefined> = {}) =>
  under(
    "open",
    "/auth/sign-in/email",
    { method: "POST", body: JSON.stringify({ email: address, password: PASSWORD }) },
    vars,
  );

/** An instance with no email sender at all: no `EMAIL_FROM`, and not the dev log double. */
const NO_EMAIL = { EMAIL_LOG: undefined, EMAIL_FROM: undefined };

/** What every `GET /config` says of the API (RFC 0015 section 5). */
const BRIGADE = { api: BRIGADE_API_VERSION, minApp: MIN_APP_VERSION };

/** An owner with a workspace, verified (to invite), signed up on the tests' open instance. */
async function owner() {
  const address = email("Owner");
  const response = await exports.default.fetch(`${ORIGIN}/auth/sign-up/email`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", "cf-connecting-ip": clientIp() },
    body: JSON.stringify({ name: "Owner", email: address, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  await env.DB.prepare(`update "user" set "emailVerified" = 1 where id = ?`).bind(user.id).run();
  const cookie = await sessionCookie(address, PASSWORD);
  const created = await exports.default.fetch(`${ORIGIN}/workspaces`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Acme" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return { id, cookie };
}

async function invite(from: { id: string; cookie: string }, address: string) {
  const response = await exports.default.fetch(`${ORIGIN}/workspaces/${from.id}/invitations`, {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: from.cookie },
    body: JSON.stringify({ email: address, role: "responder" }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { invitation: { id: string } }).invitation.id;
}

const users = async (address: string) =>
  (await env.DB.prepare(`select count(*) as n from "user" where email = ?`)
    .bind(address)
    .first<{ n: number }>())!.n;

describe("SIGNUP", () => {
  test("reads open, invite and closed; anything else, or unset, is closed", () => {
    expect(signUpMode("open")).toBe("open");
    expect(signUpMode(" Invite ")).toBe("invite");
    expect(signUpMode("closed")).toBe("closed");
    for (const value of [undefined, "", "opne", "true", 1])
      expect(signUpMode(value)).toBe("closed");
  });

  test("open: anyone signs up", async () => {
    const address = email("Ana");
    expect((await signUp("open", address)).status).toBe(200);
    expect(await users(address)).toBe(1);
  });

  for (const mode of ["closed", "invite", undefined, "nonsense"] as const) {
    test(`${mode ?? "unset"}: an address without an invitation is refused, and nothing is created`, async () => {
      const address = email("Bia");
      const response = await signUp(mode, address);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: SIGN_UP_CLOSED_CODE,
        message: "Sign-up is closed on this instance — ask an owner for an invitation",
      });
      expect(await users(address)).toBe(0);
    });
  }

  for (const mode of ["closed", "invite"] satisfies SignUpMode[]) {
    test(`${mode}: an invited address signs up and accepts its invitation`, async () => {
      const team = await owner();
      const address = email("Caio");
      const invitation = await invite(team, address);
      // Spelled another way than invited: the same address.
      const response = await signUp(mode, address.toUpperCase());
      expect(response.status).toBe(200);
      expect(await users(address)).toBe(1);
      // Accepting needs a verified address (RFC 0002 "Auth"); the link would have done this.
      await env.DB.prepare(`update "user" set "emailVerified" = 1 where email = ?`)
        .bind(address)
        .run();
      const cookie = await sessionCookie(address, PASSWORD);
      const accepted = await under(mode, `/invitations/${invitation}/accept`, {
        method: "POST",
        headers: { Cookie: cookie },
      });
      expect(accepted.status).toBe(200);
      // Accepted: the invitation no longer lets anyone in.
      const again = email("Caio");
      await env.DB.prepare(`update invitation set email = ? where id = ?`)
        .bind(again, invitation)
        .run();
      expect((await signUp(mode, again)).status).toBe(403);
    });
  }

  test("closed: an invitation that ran out, or was revoked, lets nobody in", async () => {
    const team = await owner();
    const [expired, revoked] = [email("Duda"), email("Edu")];
    const first = await invite(team, expired);
    const second = await invite(team, revoked);
    await env.DB.prepare(`update invitation set "expiresAt" = ? where id = ?`)
      .bind(new Date(Date.now() - 1000).toISOString(), first)
      .run();
    await env.DB.prepare(`update invitation set status = 'canceled' where id = ?`)
      .bind(second)
      .run();
    expect((await signUp("closed", expired)).status).toBe(403);
    expect((await signUp("closed", revoked)).status).toBe(403);
  });

  test("closed: refused sign-ups still count against the per-IP sign-up limit", async () => {
    const ip = clientIp();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await signUp("closed", email("Fia"), { "cf-connecting-ip": ip })).status);
    }
    // Better Auth's own rule for /sign-up/*: 3 per 10 s, counted before the mode is checked.
    expect(statuses).toEqual([403, 403, 403, 429]);
  });

  test("invite: the limit applies to invited addresses too", async () => {
    const team = await owner();
    const ip = clientIp();
    const addresses = [email("Gil"), email("Gil"), email("Gil"), email("Gil")];
    for (const address of addresses) await invite(team, address);
    const statuses: number[] = [];
    for (const address of addresses) {
      statuses.push((await signUp("invite", address, { "cf-connecting-ip": ip })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("GET /config", () => {
  test("answers the mode without a session, closed when unset", async () => {
    for (const [mode, expected] of [
      ["open", "open"],
      ["invite", "invite"],
      ["closed", "closed"],
      [undefined, "closed"],
    ] as const) {
      const response = await under(mode, "/config");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        signUp: expected,
        requireVerifiedEmail: false,
        brigade: BRIGADE,
      });
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    }
  });

  test("names the relay and this instance's id when phones can be paged with handles (RFC 0015)", async () => {
    const key = await generateInstanceKey();
    const relay = {
      RELAY_URL: "https://relay.example.com/some/path",
      RELAY_INSTANCE_KEY: key.privateKey,
    };
    const config = await (await under("open", "/config", {}, relay)).json();
    expect(config).toMatchObject({
      brigade: BRIGADE,
      relay: { origin: "https://relay.example.com", instance: key.instance },
    });
    expect(Reflect.get(Object(config), "relay")).not.toHaveProperty("app");
    // Never the key, whole or in part.
    expect(JSON.stringify(config)).not.toContain(key.privateKey.slice(0, 16));
    // An own app build's store link, for the store app to send people there.
    const own = await under(
      "open",
      "/config",
      {},
      {
        ...relay,
        RELAY_APP_URL: "https://apps.example.com/acme-brigade",
      },
    );
    expect(await own.json()).toMatchObject({
      relay: { app: "https://apps.example.com/acme-brigade" },
    });
  });

  test("no relay without the instance key, a relay address or a key that reads", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const key = await generateInstanceKey();
      for (const vars of [
        { RELAY_URL: "https://relay.example.com" },
        { RELAY_INSTANCE_KEY: key.privateKey },
        { RELAY_URL: "http://relay.example.com", RELAY_INSTANCE_KEY: key.privateKey },
        { RELAY_URL: "https://relay.example.com", RELAY_INSTANCE_KEY: "not-a-key" },
      ]) {
        const config = await (await under("open", "/config", {}, vars)).json();
        expect(config, JSON.stringify(Object.keys(vars))).not.toHaveProperty("relay");
        expect(config).toMatchObject({ brigade: BRIGADE });
      }
    } finally {
      error.mockRestore();
    }
  });

  test("only GET", async () => {
    const response = await under("open", "/config", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});

describe("an instance without email (Q21)", () => {
  test("always has closed sign-up, whatever SIGNUP says; /config says why, and it is logged once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const mode of ["open", "invite"]) {
        const address = email("Hugo");
        const response = await signUp(mode, address, {}, NO_EMAIL);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: SIGN_UP_CLOSED_CODE });
        expect(await users(address)).toBe(0);
        const config = await under(mode, "/config", {}, NO_EMAIL);
        expect(await config.json()).toEqual({
          signUp: "closed",
          signUpClosedBy: "no_email",
          requireVerifiedEmail: false,
          brigade: BRIGADE,
        });
      }
      const told = error.mock.calls.filter((call) =>
        String(call[0]).includes("sign-up is closed: this instance has no email sender"),
      );
      expect(told).toHaveLength(1);
      // Closed as asked is nothing to explain.
      const closed = await under("closed", "/config", {}, NO_EMAIL);
      expect(await closed.json()).toEqual({
        signUp: "closed",
        requireVerifiedEmail: false,
        brigade: BRIGADE,
      });
    } finally {
      error.mockRestore();
    }
  });

  test("an invited address still gets in, as under closed", async () => {
    const team = await owner();
    const address = email("Iris");
    await invite(team, address);
    expect((await signUp("open", address, {}, NO_EMAIL)).status).toBe(200);
  });
});

describe("REQUIRE_VERIFIED_EMAIL (Q21)", () => {
  test("off by default: an unverified account signs in", async () => {
    const address = email("Joao");
    expect((await signUp("open", address)).status).toBe(200);
    expect((await signIn(address)).status).toBe(200);
  });

  test("on: an unverified account cannot sign in until its address is verified, with a clear code", async () => {
    const on = { REQUIRE_VERIFIED_EMAIL: "true" };
    expect(verifiedEmailRequired("true")).toBe(true);
    expect(verifiedEmailRequired(" ON ")).toBe(true);
    for (const value of [undefined, "", "false", "0", "nope"]) {
      expect(verifiedEmailRequired(value)).toBe(false);
    }
    const config = await under("open", "/config", {}, on);
    expect(await config.json()).toEqual({
      signUp: "open",
      requireVerifiedEmail: true,
      brigade: BRIGADE,
    });
    const address = email("Kai");
    expect((await signUp("open", address, {}, on)).status).toBe(200);
    const refused = await signIn(address, on);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(refused.headers.get("Set-Cookie") ?? "").not.toContain("session_token");
    // The wrong password says nothing about verification.
    const wrong = await under(
      "open",
      "/auth/sign-in/email",
      { method: "POST", body: JSON.stringify({ email: address, password: "not the password" }) },
      on,
    );
    expect(wrong.status).toBe(401);
    await env.DB.prepare(`update "user" set "emailVerified" = 1 where email = ?`)
      .bind(address)
      .run();
    expect((await signIn(address, on)).status).toBe(200);
  });

  test("ignored without email, where no address could ever be verified", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const vars = { ...NO_EMAIL, REQUIRE_VERIFIED_EMAIL: "true" };
      const team = await owner();
      const address = email("Lia");
      await invite(team, address);
      expect((await signUp("open", address, {}, vars)).status).toBe(200);
      expect((await signIn(address, vars)).status).toBe(200);
      const config = await under("open", "/config", {}, vars);
      expect(await config.json()).toMatchObject({ requireVerifiedEmail: false });
    } finally {
      error.mockRestore();
    }
  });
});
