// Signing in to the app with a QR code from the dashboard (RFC 0015 section 6, src/app-sign-in.ts): the whole flow,
// and each threat property the RFC lists: the 2-minute life, single use, hashed at rest, the number typed on the
// dashboard (never shown there), one wrong number ending the claim, deny, the phone's secret, the session handed out
// once, bound to the dashboard session, and the claim rate limited per IP.
import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  APP_SIGN_IN_CREATE_LIMIT,
  APP_SIGN_IN_KEEP_MS,
  APP_SIGN_IN_PICKUP_MS,
  APP_SIGN_IN_TTL_MS,
  cleanDeviceName,
  deviceKind,
  pruneAppSignIns,
} from "../src/app-sign-in.ts";
import { sessionCookie } from "./session.ts";

const ORIGIN = "http://api.test";
const PASSWORD = "correct horse battery staple";

let people = 0;
let clients = 0;
/** A new client IP (TEST-NET-3) per call, so no test's per-IP limit sees another's requests. */
const clientIp = () => `203.0.${Math.floor(++clients / 250) % 100}.${(clients % 250) + 1}`;

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

/** The phone: no `Origin` (React Native's fetch sends none), its own address. */
const phone = (path: string, init: Init = {}) =>
  exports.default.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": clientIp(),
      "User-Agent": "Brigade/1.0 (iPhone)",
      ...init.headers,
    },
  });

async function signUp(name = "Ana") {
  const email = `${name.toLowerCase()}-q${++people}@example.com`;
  const response = await api("/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });
  expect(response.status).toBe(200);
  const { user } = (await response.json()) as { user: { id: string } };
  return { id: user.id, email, cookie: await sessionCookie(email, PASSWORD) };
}

type Created = { id: string; code: string; url: string; expiresAt: string };
type Claimed = { claimId: string; secret: string; number: string; expiresAt: string };

async function create(cookie: string): Promise<Created> {
  const response = await api("/app-sign-in", { method: "POST", headers: { Cookie: cookie } });
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

const claim = (code: string, deviceName = "Ana's iPhone", ip?: string) =>
  phone("/app-sign-in/claim", {
    method: "POST",
    body: JSON.stringify({ code, deviceName }),
    ...(ip ? { headers: { "cf-connecting-ip": ip } } : {}),
  });

async function claimed(code: string, deviceName?: string): Promise<Claimed> {
  const response = await claim(code, deviceName);
  expect(response.status).toBe(201);
  return (await response.json()) as Claimed;
}

const poll = (id: string, secret: string) =>
  phone(`/app-sign-in/claim/${id}`, { headers: { Authorization: `Bearer ${secret}` } });

const status = async (id: string, cookie: string) => {
  const response = await api(`/app-sign-in/${id}`, { headers: { Cookie: cookie } });
  return { code: response.status, body: (await response.json()) as Record<string, unknown> };
};

const approve = (id: string, cookie: string, number: unknown) =>
  api(`/app-sign-in/${id}/approve`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: JSON.stringify({ number }),
  });

const deny = (id: string, cookie: string) =>
  api(`/app-sign-in/${id}/deny`, { method: "POST", headers: { Cookie: cookie } });

/** Any 2-digit number but `number`. */
const wrong = (number: string) => String((Number(number) + 1) % 100).padStart(2, "0");

/** Moves a row's clock: as if its time ran out. */
const runOut = (id: string) =>
  env.DB.prepare(`update app_sign_in set "expiresAt" = ? where id = ?`)
    .bind(Date.now() - 1, id)
    .run();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QR sign-in", () => {
  test("the dashboard asks, the phone claims, the member types the number, the phone gets a session once", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    expect(created.id).toMatch(/^asi_[0-9A-Z]{26}$/);
    expect(created.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const qr = new URL(created.url);
    expect(qr.protocol).toBe("brigade:");
    expect(qr.host).toBe("connect");
    expect(qr.searchParams.get("server")).toBe(ORIGIN);
    expect(qr.searchParams.get("code")).toBe(created.code);
    const life = Date.parse(created.expiresAt) - Date.now();
    expect(life).toBeGreaterThan(APP_SIGN_IN_TTL_MS - 10_000);
    expect(life).toBeLessThanOrEqual(APP_SIGN_IN_TTL_MS);
    expect(await status(created.id, ana.cookie)).toMatchObject({
      code: 200,
      body: { status: "waiting" },
    });

    const phoneSide = await claimed(created.code, "Ana's iPhone");
    expect(phoneSide.claimId).toBe(created.id);
    expect(phoneSide.number).toMatch(/^[0-9]{2}$/);
    expect(phoneSide.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The dashboard names the kind of device (from its User-Agent), never its name nor the number.
    const waiting = await status(created.id, ana.cookie);
    expect(waiting.body).toMatchObject({ status: "claimed", deviceKind: "apple" });
    expect(JSON.stringify(waiting.body)).not.toContain(`"number"`);
    expect(JSON.stringify(waiting.body)).not.toContain("Ana's iPhone");
    expect(Object.keys(waiting.body).sort()).toEqual(["deviceKind", "expiresAt", "id", "status"]);

    const pending = await poll(phoneSide.claimId, phoneSide.secret);
    expect(await pending.json()).toMatchObject({ status: "pending" });

    const approved = await approve(created.id, ana.cookie, phoneSide.number);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toEqual({ status: "approved" });
    expect((await status(created.id, ana.cookie)).body).toMatchObject({ status: "approved" });

    const delivered = await poll(phoneSide.claimId, phoneSide.secret);
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get("Cache-Control")).toBe("no-store");
    const body = (await delivered.json()) as {
      status: string;
      session: { cookie: string; expiresAt: string };
      user: { id: string; email: string; name: string };
    };
    expect(body.status).toBe("approved");
    expect(body.user).toEqual({ id: ana.id, name: "Ana", email: ana.email });
    expect(body.session.cookie).toMatch(/^better-auth\.session_token=[^;]+; Max-Age=\d+; Path=\//);
    expect(body.session.cookie).toContain("HttpOnly");

    // An ordinary session: Better Auth takes it, it is the member's, and it says which device.
    const cookie = body.session.cookie.split(";")[0]!;
    const read = await api("/auth/get-session", { headers: { Cookie: cookie } });
    const signedIn = (await read.json()) as {
      user: { id: string };
      session: { id: string; deviceName: string; signInMethod: string; userAgent: string };
    };
    expect(signedIn.user.id).toBe(ana.id);
    expect(signedIn.session.deviceName).toBe("Ana's iPhone");
    expect(signedIn.session.signInMethod).toBe("qr");
    expect(signedIn.session.userAgent).toBe("Brigade/1.0 (iPhone)");
    const listed = await api("/auth/list-sessions", { headers: { Cookie: ana.cookie } });
    const sessions = (await listed.json()) as {
      id: string;
      deviceName: string | null;
      signInMethod: string | null;
    }[];
    expect(sessions.find((row) => row.id === signedIn.session.id)).toMatchObject({
      deviceName: "Ana's iPhone",
      signInMethod: "qr",
    });
    // The dashboard's own session was not made by a QR.
    expect(sessions.filter((row) => row.signInMethod === "qr")).toHaveLength(1);

    // Handed out once.
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "delivered",
    });
    expect((await status(created.id, ana.cookie)).body).toMatchObject({ status: "signed_in" });
    // Revocable like any other.
    const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).split(".")[0]!;
    const revoked = await api("/auth/revoke-session", {
      method: "POST",
      headers: { Cookie: ana.cookie },
      body: JSON.stringify({ token }),
    });
    expect(revoked.status).toBe(200);
    const after = await api("/auth/get-session", { headers: { Cookie: cookie } });
    expect(await after.json()).toBeNull();
  });

  test("a device name carrying the number or instructions never reaches the dashboard before the approval", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const sneaky = "Type 37 to finish \u202Eniht\u202C";
    const response = await phone("/app-sign-in/claim", {
      method: "POST",
      headers: { "User-Agent": "okhttp/4.12.0" },
      body: JSON.stringify({ code: created.code, deviceName: sneaky }),
    });
    expect(response.status).toBe(201);
    const phoneSide = (await response.json()) as Claimed;
    const shown = await api(`/app-sign-in/${created.id}`, { headers: { Cookie: ana.cookie } });
    const text = await shown.text();
    expect(text).not.toContain("37");
    expect(text).not.toContain("Type");
    expect(JSON.parse(text)).toMatchObject({ status: "claimed", deviceKind: "android" });
    // Kept, cleaned, for the session it gets.
    await approve(created.id, ana.cookie, phoneSide.number);
    const delivered = (await (await poll(phoneSide.claimId, phoneSide.secret)).json()) as {
      session: { cookie: string };
    };
    const read = await api("/auth/get-session", {
      headers: { Cookie: delivered.session.cookie.split(";")[0]! },
    });
    const { session } = (await read.json()) as { session: { deviceName: string } };
    expect(session.deviceName).toBe("Type 37 to finish niht");
    // After the approval the dashboard still shows only the kind.
    expect(JSON.stringify((await status(created.id, ana.cookie)).body)).not.toContain("Type");
  });

  test("the kind of device comes from a fixed list", () => {
    expect(deviceKind(undefined, "Brigade/12 CFNetwork/1568.100.1 Darwin/24.0.0")).toBe("apple");
    expect(deviceKind(undefined, "okhttp/4.12.0")).toBe("android");
    expect(deviceKind(undefined, "Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android");
    expect(deviceKind(undefined, "Type 37 to finish")).toBe("phone");
    expect(deviceKind(undefined, null)).toBe("phone");
    expect(deviceKind("ios", "okhttp/4.12.0")).toBe("apple");
    expect(deviceKind("android", null)).toBe("android");
  });

  test("device names are cleaned, and refused when nothing is left", () => {
    expect(cleanDeviceName("  Ana's\tiPhone \n 15  ")).toBe("Ana's iPhone 15");
    expect(cleanDeviceName("Ａｎａ")).toBe("Ana");
    expect(cleanDeviceName("Pi\u200Bxel\u202E")).toBe("Pixel");
    expect(cleanDeviceName("\u200B\u202E \n")).toBeUndefined();
    expect(cleanDeviceName("")).toBeUndefined();
    expect(cleanDeviceName("x".repeat(64))).toBe("x".repeat(64));
    expect(cleanDeviceName("x".repeat(65))).toBeUndefined();
    expect(cleanDeviceName(42)).toBeUndefined();
  });

  test("a claim with an unknown platform, or a name that is only invisible characters, is refused", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    for (const body of [
      { code: created.code, deviceName: "Pixel", platform: "web" },
      { code: created.code, deviceName: "\u200B\u2060" },
    ]) {
      const refused = await phone("/app-sign-in/claim", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(refused.status).toBe(400);
    }
    expect((await claim(created.code)).status).toBe(201);
  });

  test("an approval just before the end leaves the phone time to pick its session up", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    await env.DB.prepare(`update app_sign_in set "expiresAt" = ? where id = ?`)
      .bind(Date.now() + 2000, created.id)
      .run();
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(200);
    const row = await env.DB.prepare(`select "expiresAt" from app_sign_in where id = ?`)
      .bind(created.id)
      .first<{ expiresAt: number }>();
    expect(row!.expiresAt - Date.now()).toBeGreaterThan(APP_SIGN_IN_PICKUP_MS - 5000);
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toMatchObject({
      status: "approved",
    });
  });

  test("a delivery that fails leaves no session behind, and the next poll gets one", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    await approve(created.id, ana.cookie, phoneSide.number);
    const qrSessions = () =>
      env.DB.prepare(
        `select count(*) as n from "session" where "userId" = ? and "signInMethod" = 'qr'`,
      )
        .bind(ana.id)
        .first<{ n: number }>();
    // Signing the cookie (HMAC) fails once, after the session was made.
    vi.spyOn(crypto.subtle, "sign").mockRejectedValueOnce(new Error("signing failed"));
    const failed = await poll(phoneSide.claimId, phoneSide.secret);
    expect(failed.status).toBe(503);
    expect((await qrSessions())?.n).toBe(0);
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toMatchObject({
      status: "approved",
    });
    expect((await qrSessions())?.n).toBe(1);
  });

  test("the phone polls with GET only", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    await approve(created.id, ana.cookie, phoneSide.number);
    const head = await phone(`/app-sign-in/claim/${phoneSide.claimId}`, {
      method: "HEAD",
      headers: { Authorization: `Bearer ${phoneSide.secret}` },
    });
    expect(head.status).toBe(405);
    expect(head.headers.get("Allow")).toBe("GET");
    // The HEAD spent nothing.
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toMatchObject({
      status: "approved",
    });
  });

  test("the code is kept hashed, and so is the phone's secret", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    const row = await env.DB.prepare(`select * from app_sign_in where id = ?`)
      .bind(created.id)
      .first<Record<string, unknown>>();
    const stored = JSON.stringify(row);
    expect(stored).not.toContain(created.code);
    expect(stored).not.toContain(phoneSide.secret);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a code is claimed once", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    await claimed(created.code);
    const again = await claim(created.code, "Someone else's phone");
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "invalid_code" });
    // Two at once: exactly one wins.
    const next = await create(ana.cookie);
    const both = await Promise.all([claim(next.code), claim(next.code)]);
    expect(both.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 404]);
  });

  test("a code lives 2 minutes, and a claim 2 minutes from it", async () => {
    const ana = await signUp();
    const stale = await create(ana.cookie);
    await runOut(stale.id);
    expect((await claim(stale.code)).status).toBe(404);
    expect((await status(stale.id, ana.cookie)).body).toMatchObject({ status: "expired" });

    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    await runOut(created.id);
    const late = await approve(created.id, ana.cookie, phoneSide.number);
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "not_claimed", status: "expired" });
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "timeout",
    });
  });

  test("an approved claim the phone never picks up runs out too", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(200);
    await runOut(created.id);
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "timeout",
    });
  });

  test("one wrong number ends the claim", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    const refused = await approve(created.id, ana.cookie, wrong(phoneSide.number));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "wrong_number" });
    // The right number after a wrong one changes nothing.
    const after = await approve(created.id, ana.cookie, phoneSide.number);
    expect(after.status).toBe(409);
    expect(await after.json()).toEqual({ error: "not_claimed", status: "wrong_number" });
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "wrong_number",
    });
  });

  test("a malformed number is refused without ending the claim", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    for (const number of ["5", "123", 42, "ab", null]) {
      expect((await approve(created.id, ana.cookie, number)).status).toBe(400);
    }
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(200);
  });

  test("a code waiting for its claim cannot be approved", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const early = await approve(created.id, ana.cookie, "42");
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "not_claimed", status: "waiting" });
  });

  test("deny ends it, before or after the claim", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    const denied = await deny(created.id, ana.cookie);
    expect(denied.status).toBe(200);
    expect(await denied.json()).toEqual({ status: "denied" });
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "denied",
    });
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(409);

    const unclaimed = await create(ana.cookie);
    expect((await deny(unclaimed.id, ana.cookie)).status).toBe(200);
    expect((await claim(unclaimed.code)).status).toBe(404);
  });

  test("only the phone with the claim's secret polls it", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    await approve(created.id, ana.cookie, phoneSide.number);
    const other = "A".repeat(43);
    const refused = await poll(phoneSide.claimId, other);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not_found" });
    expect((await phone(`/app-sign-in/claim/${phoneSide.claimId}`)).status).toBe(404);
    expect(
      (
        await phone(`/app-sign-in/claim/${phoneSide.claimId}?secret=${phoneSide.secret}`, {
          headers: {},
        })
      ).status,
    ).toBe(404);
    // A wrong secret spent nothing: the phone still gets its session.
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toMatchObject({
      status: "approved",
    });
  });

  test("only the dashboard session that asked sees, approves or denies the claim", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    const anaElsewhere = await sessionCookie(ana.email, PASSWORD);
    const caio = await signUp("Caio");
    for (const cookie of [anaElsewhere, caio.cookie]) {
      expect((await status(created.id, cookie)).code).toBe(404);
      expect((await approve(created.id, cookie, phoneSide.number)).status).toBe(404);
      expect((await deny(created.id, cookie)).status).toBe(404);
    }
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(200);
  });

  test("signing out of the dashboard that asked leaves the phone without a session", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    const phoneSide = await claimed(created.code);
    expect((await approve(created.id, ana.cookie, phoneSide.number)).status).toBe(200);
    const out = await api("/auth/sign-out", { method: "POST", headers: { Cookie: ana.cookie } });
    expect(out.status).toBe(200);
    expect(await (await poll(phoneSide.claimId, phoneSide.secret)).json()).toEqual({
      status: "expired",
      reason: "signed_out",
    });
  });

  test("a new code ends the session's code not claimed yet", async () => {
    const ana = await signUp();
    const first = await create(ana.cookie);
    const second = await create(ana.cookie);
    expect((await claim(first.code)).status).toBe(404);
    expect((await status(first.id, ana.cookie)).body).toMatchObject({ status: "expired" });
    expect((await claim(second.code)).status).toBe(201);
  });

  test("asking needs a session, from the dashboard's own site, and is limited per user", async () => {
    expect((await api("/app-sign-in", { method: "POST" })).status).toBe(401);
    const ana = await signUp();
    const foreign = await api("/app-sign-in", {
      method: "POST",
      headers: { Cookie: ana.cookie, Origin: "https://evil.example" },
    });
    expect(foreign.status).toBe(403);
    expect((await api("/app-sign-in", { headers: { Cookie: ana.cookie } })).status).toBe(405);
    const statuses: number[] = [];
    for (let index = 0; index <= APP_SIGN_IN_CREATE_LIMIT.max; index++) {
      statuses.push(
        (await api("/app-sign-in", { method: "POST", headers: { Cookie: ana.cookie } })).status,
      );
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.slice(0, APP_SIGN_IN_CREATE_LIMIT.max).every((code) => code === 201)).toBe(
      true,
    );
  });

  test("claims are rate limited per caller address", async () => {
    const ip = "198.51.100.231";
    const statuses: number[] = [];
    for (let index = 0; index < 25; index++) {
      statuses.push((await claim("A".repeat(22), "Guessing phone", ip)).status);
    }
    expect(statuses.slice(0, 20).every((code) => code === 404)).toBe(true);
    expect(statuses).toContain(429);
    // Another address is not held back.
    expect((await claim("A".repeat(22), "Another phone")).status).toBe(404);
  });

  test("a claim needs a code and a device name; a browser page elsewhere cannot claim", async () => {
    const bad = [{}, { code: "A".repeat(22) }, { code: "A".repeat(22), deviceName: "" }];
    for (const body of bad) {
      const response = await phone("/app-sign-in/claim", {
        method: "POST",
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const long = await claim("A".repeat(22), "x".repeat(65));
    expect(long.status).toBe(400);
    const ana = await signUp();
    const created = await create(ana.cookie);
    const foreign = await phone("/app-sign-in/claim", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ code: created.code, deviceName: "Browser" }),
    });
    expect(foreign.status).toBe(403);
    // Refused before it was spent.
    expect((await claim(created.code)).status).toBe(201);
  });

  test("ended rows are deleted a day later", async () => {
    const ana = await signUp();
    const created = await create(ana.cookie);
    await pruneAppSignIns(env.DB, Date.now());
    const kept = await env.DB.prepare(`select id from app_sign_in where id = ?`)
      .bind(created.id)
      .first();
    expect(kept).not.toBeNull();
    await pruneAppSignIns(env.DB, Date.now() + APP_SIGN_IN_TTL_MS + APP_SIGN_IN_KEEP_MS + 1);
    const gone = await env.DB.prepare(`select id from app_sign_in where id = ?`)
      .bind(created.id)
      .first();
    expect(gone).toBeNull();
  });
});
