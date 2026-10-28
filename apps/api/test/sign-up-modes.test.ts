// Sign-up modes (src/sign-up.ts, RFC 0002 "Sign-up modes"): `SIGNUP` open, invite and closed through the Worker, the
// invitation that lets a new person in under `invite` and `closed`, the per-IP sign-up limit still counting refused
// sign-ups, and `GET /config`.
import { env, exports } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import worker from "../src/index.ts";
import { SIGN_UP_CLOSED_CODE, signUpMode, type SignUpMode } from "../src/sign-up.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

let people = 0;
const email = (name: string) => `${name.toLowerCase()}-m${++people}@example.com`;
let clients = 0;
/** A new client IP (TEST-NET-3) per call: sign-up is rate-limited per IP. */
const clientIp = () => `203.0.${Math.floor(++clients / 250) % 113}.${(clients % 250) + 1}`;

/** The Worker as an instance with `SIGNUP` set to `mode` (`undefined`: unset). */
function under(
  mode: string | undefined,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  const { SIGNUP: _unset, ...rest } = env as typeof env & { SIGNUP?: string };
  const request = new Request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      Origin: ORIGIN,
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      ...init.headers,
    },
  }) as Parameters<typeof worker.fetch>[0];
  const instance = (mode === undefined ? rest : { ...rest, SIGNUP: mode }) as typeof env;
  return worker.fetch(request, instance, createExecutionContext());
}

const signUp = (mode: string | undefined, address: string, headers: Record<string, string> = {}) =>
  under(mode, "/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Rui", email: address, password: PASSWORD }),
  });

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
      expect(await response.json()).toEqual({ signUp: expected });
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    }
  });

  test("only GET", async () => {
    const response = await under("open", "/config", { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});
