// Signing in to the mobile app with a QR code from the dashboard (RFC 0015 section 6, D2). The QR is a credential on a
// screen, so it works as a device approval, not as a token anyone holding the picture can use:
//
// 1. `POST /app-sign-in` (dashboard session): a 128-bit random code for 2 minutes, single use, bound to that user and
//    that session; the QR is `brigade://connect?server=<dashboard origin>&code=<code>`.
// 2. `POST /app-sign-in/claim` (no session, the phone; rate limited per IP): spends the code and answers a claim id,
//    a secret only the phone gets and a 2-digit number the phone shows.
// 3. `GET /app-sign-in/:id` (the same dashboard session, polled): "<an iPhone or iPad> wants to sign in as you", the
//    kind of device read from a fixed list, never text the phone wrote (it could carry the number);
//    `POST /app-sign-in/:id/approve { number }` with the number the member types (never shown on the dashboard), or
//    `POST /app-sign-in/:id/deny`. One wrong number ends the claim.
// 4. `GET /app-sign-in/claim/:id` (the phone, `Authorization: Bearer <secret>`, polled): `pending`, then once a new
//    Better Auth session made here for the member (an ordinary one, listed and revocable, with `deviceName` and
//    `signInMethod: "qr"`), or `expired`.
//
// Storage: D1's `app_sign_in` (migrations/0016_app_sign_in.sql), not a Durable Object. Every step that must happen
// once (spending the code, approving or failing on the number, handing out the session) is one conditional
// `update … where state = <the step before> … returning`: D1 runs each statement atomically on its one primary, so of
// two requests at once exactly one gets the row back and the other finds it moved on. Nothing needs to stay in memory
// between requests, the dashboard and the phone poll, and the rows sit beside Better Auth's sessions they are bound to.
// The code and the phone's secret are kept only as SHA-256 digests (both are 128 bits or more of randomness, so no
// salt or slow hash is needed); the session token is never stored here: it is made when the phone picks it up.

import { idPattern, newId, type RandomBytes } from "@freecorps/brigade-schema";
import { makeSignature } from "better-auth/crypto";
import { countRequest, type Auth } from "./auth.ts";
import { json, readJson } from "./member-route.ts";

export const APP_SIGN_IN_PATH = "/app-sign-in";
export const APP_SIGN_IN_CLAIM_PATH = "/app-sign-in/claim";
/** `/app-sign-in/:id`, `/app-sign-in/:id/approve`, `/app-sign-in/:id/deny` (the dashboard's). */
const REQUEST_PATH = /^\/app-sign-in\/([^/]+?)(?:\/(approve|deny))?$/;
/** `/app-sign-in/claim/:id` (the phone's). */
const CLAIM_POLL_PATH = /^\/app-sign-in\/claim\/([^/]+)$/;

/** A sign-in's id (`asi_<ULID>`): the dashboard's request and the phone's claim are the same row. */
export const APP_SIGN_IN_ID = new RegExp(idPattern("asi"));
/** How long a code lives unclaimed, and a claim waits for the member's approval and the phone's pickup after. */
export const APP_SIGN_IN_TTL_MS = 2 * 60 * 1000;
/** Codes one user may ask for a minute (each one is a D1 row), counted in D1's `rateLimit` table. */
export const APP_SIGN_IN_CREATE_LIMIT = { window: 60, max: 10 };
/**
 * The longest device name a claim may give (after `cleanDeviceName`). Stored with the session for the account's
 * sessions list; never shown on the dashboard's approval step.
 */
export const DEVICE_NAME_MAX = 64;
/** How long the phone has to pick its session up after an approval, at least, however close the claim's end was. */
export const APP_SIGN_IN_PICKUP_MS = 30 * 1000;
/** How long an ended row is kept before the cron deletes it. */
export const APP_SIGN_IN_KEEP_MS = 24 * 60 * 60 * 1000;

/** 16 random bytes, base64url: 22 characters. */
const CODE = /^[A-Za-z0-9_-]{22}$/;
/** 32 random bytes, base64url: 43 characters. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const NUMBER = /^[0-9]{2}$/;
const READ_METHODS = ["GET", "HEAD"];

/**
 * What kind of device claimed, as the dashboard names it before the approval ("An iPhone or iPad wants to sign in as
 * you"). Only these values, never text the phone wrote: a free device name would let whoever claims first write
 * "type 37" on the member's own dashboard, and the number is the whole check.
 */
export const DEVICE_KINDS = ["apple", "android", "phone"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/**
 * The kind from the claim's optional `platform` (`ios` or `android`, what Expo's `Platform.OS` says) or else its
 * User-Agent (React Native's fetch sends `<app>/<build> CFNetwork/… Darwin/…` on iOS and `okhttp/…` on Android);
 * `phone` for anything else.
 */
export function deviceKind(platform: unknown, userAgent: string | null): DeviceKind {
  if (platform === "ios") return "apple";
  if (platform === "android") return "android";
  const agent = userAgent ?? "";
  if (/\b(iPhone|iPad|iPod)\b|CFNetwork|Darwin/.test(agent)) return "apple";
  if (/Android|okhttp/i.test(agent)) return "android";
  return "phone";
}

/**
 * The phone's device name as stored for the sessions list: NFKC, without control, format (bidi, zero-width) or
 * other invisible characters, runs of whitespace as one space, trimmed; undefined when nothing is left or it is
 * longer than `DEVICE_NAME_MAX`.
 */
export function cleanDeviceName(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > DEVICE_NAME_MAX * 4) return undefined;
  const cleaned = value
    .normalize("NFKC")
    // Controls and line breaks part words; format, private-use and unassigned characters vanish.
    .replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replaceAll(/[\p{Cf}\p{Co}\p{Cn}]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (cleaned === "" || cleaned.length > DEVICE_NAME_MAX) return undefined;
  return cleaned;
}

type State = "issued" | "claimed" | "approved" | "delivered" | "denied" | "wrong_number";

type Row = {
  id: string;
  userId: string;
  sessionId: string;
  state: State;
  expiresAt: number;
  deviceName: string | null;
  deviceKind: DeviceKind | null;
  secretHash: string | null;
};

/** What the dashboard sees of its request (`GET /app-sign-in/:id`). */
export type AppSignInStatus =
  | "waiting"
  | "claimed"
  | "approved"
  | "signed_in"
  | "denied"
  | "wrong_number"
  | "expired";

/** Why the phone's claim answers `expired`. */
export type ClaimEndReason = "denied" | "wrong_number" | "timeout" | "delivered" | "signed_out";

export type AppSignInEnv = Pick<Env, "DB" | "BETTER_AUTH_SECRET" | "APP_SIGN_IN_LIMIT"> & {
  /** The dashboard's public origin (src/notify-email.ts), what the QR names as the server. */
  DASHBOARD_URL?: string;
};

const randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/**
 * Answers a request under `/app-sign-in`, or undefined for any other path. `auth` is Better Auth for this request
 * (the session, and making the phone's).
 */
export function appSignInRoute(
  request: Request,
  env: AppSignInEnv,
  auth: () => Auth,
  pathname: string,
): Promise<Response> | undefined {
  if (pathname === APP_SIGN_IN_PATH) return createSignIn(request, env, auth);
  if (pathname === APP_SIGN_IN_CLAIM_PATH) return claimSignIn(request, env);
  const poll = CLAIM_POLL_PATH.exec(pathname)?.[1];
  if (poll !== undefined) return pollClaim(request, env, auth, poll);
  const own = REQUEST_PATH.exec(pathname);
  if (own) {
    const action = own[2] as "approve" | "deny" | undefined;
    return action === undefined
      ? readSignIn(request, env, auth, own[1]!)
      : answerSignIn(request, env, auth, own[1]!, action);
  }
  return undefined;
}

/**
 * `POST /app-sign-in`: a new code for the session's user and session, replacing any of that session's codes not
 * claimed yet. 201 `{ id, code, url, expiresAt }`; 401 without a session; 403 from another site; 429 past
 * `APP_SIGN_IN_CREATE_LIMIT`; 503 when D1 fails.
 */
async function createSignIn(
  request: Request,
  env: AppSignInEnv,
  auth: () => Auth,
): Promise<Response> {
  if (request.method !== "POST") return notAllowed(["POST"]);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    const now = Date.now();
    const { window, max } = APP_SIGN_IN_CREATE_LIMIT;
    if ((await countRequest(env.DB, `app-sign-in:${session.user.id}`, window, now)) > max) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": String(window) });
    }
    const id = newId("asi", now, randomBytes);
    const code = base64url(randomBytes(16));
    const expiresAt = now + APP_SIGN_IN_TTL_MS;
    await env.DB.batch([
      // One code on screen per session: a new one ends the last (its QR may still be in someone's photo).
      env.DB.prepare(
        `update app_sign_in set "expiresAt" = ?2, "endedAt" = ?2
         where "sessionId" = ?1 and state = 'issued' and "expiresAt" > ?2`,
      ).bind(session.session.id, now),
      env.DB.prepare(
        `insert into app_sign_in (id, "codeHash", "userId", "sessionId", state, "createdAt", "expiresAt")
         values (?, ?, ?, ?, 'issued', ?, ?)`,
      ).bind(id, await sha256(code), session.user.id, session.session.id, now, expiresAt),
    ]);
    const server = dashboardOrigin(env, request);
    return json(
      {
        id,
        code,
        url: `brigade://connect?${new URLSearchParams({ server, code }).toString()}`,
        expiresAt: new Date(expiresAt).toISOString(),
      },
      201,
      NO_STORE,
    );
  } catch (error) {
    return unavailable("app sign-in: creating a code failed", error);
  }
}

/**
 * `GET /app-sign-in/:id`: the session's own request, as the dashboard shows it. Once claimed, `deviceKind` says what
 * kind of device wants to sign in; the number and the phone's own device name are never in it. 404 for an id that is
 * not this session's.
 */
async function readSignIn(
  request: Request,
  env: AppSignInEnv,
  auth: () => Auth,
  id: string,
): Promise<Response> {
  if (!READ_METHODS.includes(request.method)) return notAllowed(READ_METHODS);
  if (!APP_SIGN_IN_ID.test(id)) return json({ error: "not_found" }, 404);
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    const row = await readRow(env.DB, id);
    if (!row || row.sessionId !== session.session.id) return json({ error: "not_found" }, 404);
    return json(view(row, Date.now()), 200, NO_STORE);
  } catch (error) {
    return unavailable("app sign-in: reading a request failed", error);
  }
}

/**
 * `POST /app-sign-in/:id/approve { number }` and `POST /app-sign-in/:id/deny`. Approving compares the typed number in
 * the same statement that moves the claim on: the right one approves it, any other ends it (403 `wrong_number`). 409
 * `not_claimed` when there is no claim waiting (not claimed yet, or ended, or past its time: the body's `status` says
 * which). Denying ends the request at any step before the phone got its session. An approval leaves the phone at
 * least `APP_SIGN_IN_PICKUP_MS` to pick its session up, however close the claim was to its end.
 */
async function answerSignIn(
  request: Request,
  env: AppSignInEnv,
  auth: () => Auth,
  id: string,
  action: "approve" | "deny",
): Promise<Response> {
  if (request.method !== "POST") return notAllowed(["POST"]);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  if (!APP_SIGN_IN_ID.test(id)) return json({ error: "not_found" }, 404);
  let number: string | undefined;
  if (action === "approve") {
    const body = await readJson(request, 1024);
    const given: unknown =
      typeof body === "object" && body !== null ? Reflect.get(body, "number") : undefined;
    // A malformed number is refused before anything is spent: only a well-formed wrong one ends the claim.
    if (typeof given !== "string" || !NUMBER.test(given)) {
      return json({ error: "invalid_args" }, 400);
    }
    number = given;
  }
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    const now = Date.now();
    const moved =
      action === "approve"
        ? await env.DB.prepare(
            `update app_sign_in
             set state = case when number = ?3 then 'approved' else 'wrong_number' end,
               "endedAt" = case when number = ?3 then null else ?4 end,
               "expiresAt" = case when number = ?3 then max("expiresAt", ?4 + ?5) else "expiresAt" end
             where id = ?1 and "sessionId" = ?2 and state = 'claimed' and "expiresAt" > ?4
             returning state`,
          )
            .bind(id, session.session.id, number, now, APP_SIGN_IN_PICKUP_MS)
            .first<{ state: State }>()
        : await env.DB.prepare(
            `update app_sign_in set state = 'denied', "endedAt" = ?3
             where id = ?1 and "sessionId" = ?2 and state in ('issued', 'claimed', 'approved')
               and "expiresAt" > ?3
             returning state`,
          )
            .bind(id, session.session.id, now)
            .first<{ state: State }>();
    if (moved?.state === "wrong_number") return json({ error: "wrong_number" }, 403, NO_STORE);
    if (moved) return json({ status: moved.state }, 200, NO_STORE);
    const row = await readRow(env.DB, id);
    if (!row || row.sessionId !== session.session.id) return json({ error: "not_found" }, 404);
    return json({ error: "not_claimed", status: view(row, now).status }, 409, NO_STORE);
  } catch (error) {
    return unavailable(`app sign-in: ${action} failed`, error);
  }
}

/**
 * `POST /app-sign-in/claim { code, deviceName, platform? }`: the phone spends the code. `deviceName` is cleaned
 * (`cleanDeviceName`) and kept for the session only; `platform` (`ios`, `android`) or the User-Agent gives the kind the
 * dashboard shows (`deviceKind`). 201 `{ claimId, secret, number,
 * expiresAt }`; 404 `invalid_code` for a code that is unknown, spent or past its time alike (no answer tells them
 * apart); 400 for a body that is not that; 429 past `APP_SIGN_IN_LIMIT` (per caller IP, checked before D1); 403 from
 * a browser page on another site. The phone keeps the secret and shows the number.
 */
async function claimSignIn(request: Request, env: AppSignInEnv): Promise<Response> {
  if (request.method !== "POST") return notAllowed(["POST"]);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  if (!(await claimAllowed(env, request))) {
    return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }
  const body = await readJson(request, 1024);
  const code: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "code") : undefined;
  const field = (key: string): unknown =>
    typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;
  const name = cleanDeviceName(field("deviceName"));
  const platform = field("platform");
  if (
    typeof code !== "string" ||
    name === undefined ||
    (platform !== undefined && platform !== "ios" && platform !== "android")
  ) {
    return json({ error: "invalid_args" }, 400);
  }
  const kind = deviceKind(platform, request.headers.get("user-agent"));
  // Shaped like no code ever made: the same answer as a spent one.
  if (!CODE.test(code)) return json({ error: "invalid_code" }, 404, NO_STORE);
  const secret = base64url(randomBytes(32));
  const number = twoDigits();
  try {
    const now = Date.now();
    const expiresAt = now + APP_SIGN_IN_TTL_MS;
    const claimed = await env.DB.prepare(
      `update app_sign_in
       set state = 'claimed', "deviceName" = ?2, "secretHash" = ?3, number = ?4, "claimedAt" = ?5,
         "expiresAt" = ?6, "deviceKind" = ?7
       where "codeHash" = ?1 and state = 'issued' and "expiresAt" > ?5
       returning id`,
    )
      .bind(await sha256(code), name, await sha256(secret), number, now, expiresAt, kind)
      .first<{ id: string }>();
    if (!claimed) return json({ error: "invalid_code" }, 404, NO_STORE);
    return json(
      { claimId: claimed.id, secret, number, expiresAt: new Date(expiresAt).toISOString() },
      201,
      NO_STORE,
    );
  } catch (error) {
    return unavailable("app sign-in: claiming a code failed", error);
  }
}

/**
 * `GET /app-sign-in/claim/:id` with `Authorization: Bearer <secret>`: `{ status: "pending", expiresAt }` until the
 * member answers; once approved, the first poll moves the claim to `delivered` and gets a new session for the member
 * (`{ status: "approved", session: { cookie, expiresAt }, user }`, `cookie` a `Set-Cookie` value as
 * `@better-auth/expo` stores one); every poll after, and a claim denied, failed or past its time, gets
 * `{ status: "expired", reason }`. 404 for an id or secret that does not match (the same answer for both).
 */
async function pollClaim(
  request: Request,
  env: AppSignInEnv,
  auth: () => Auth,
  id: string,
): Promise<Response> {
  // GET only: a HEAD would move an approved claim to `delivered` and drop the session's body on the floor.
  if (request.method !== "GET") return notAllowed(["GET"]);
  const secret = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!APP_SIGN_IN_ID.test(id) || secret === undefined || !SECRET.test(secret)) {
    return json({ error: "not_found" }, 404);
  }
  try {
    const row = await readRow(env.DB, id);
    if (!row?.secretHash || !sameDigest(row.secretHash, await sha256(secret))) {
      return json({ error: "not_found" }, 404);
    }
    const now = Date.now();
    const ended = (reason: ClaimEndReason) => json({ status: "expired", reason }, 200, NO_STORE);
    if (row.state === "delivered") return ended("delivered");
    if (row.state === "denied" || row.state === "wrong_number") return ended(row.state);
    if (row.expiresAt <= now) return ended("timeout");
    if (row.state === "claimed") {
      return json(
        { status: "pending", expiresAt: new Date(row.expiresAt).toISOString() },
        200,
        NO_STORE,
      );
    }
    // Approved: only the poll that moves it to `delivered` gets a session.
    const taken = await env.DB.prepare(
      `update app_sign_in set state = 'delivered', "endedAt" = ?2
       where id = ?1 and state = 'approved' and "expiresAt" > ?2 returning id`,
    )
      .bind(id, now)
      .first<{ id: string }>();
    if (!taken)
      return ended((await readRow(env.DB, id))?.state === "delivered" ? "delivered" : "timeout");
    // Bound to the dashboard session that asked: signed out there since, no session here.
    const asker = await env.DB.prepare(
      `select "expiresAt" from "session" where id = ? and "userId" = ?`,
    )
      .bind(row.sessionId, row.userId)
      .first<{ expiresAt: string | number }>();
    if (!asker || new Date(asker.expiresAt).getTime() <= now) return ended("signed_out");
    try {
      return json(await newSession(env, auth, row, request), 200, NO_STORE);
    } catch (error) {
      // Nothing was handed out (`newSession` deleted any session it made): the phone's next poll may try again,
      // within the same time.
      await env.DB.prepare(
        `update app_sign_in set state = 'approved', "endedAt" = null where id = ? and state = 'delivered'`,
      )
        .bind(id)
        .run();
      throw error;
    }
  } catch (error) {
    return unavailable("app sign-in: polling a claim failed", error);
  }
}

/**
 * A new Better Auth session for the row's user, made here (no password on the phone), with the device name, the
 * phone's address and user agent, `signInMethod: "qr"` (so the sessions list says how it was made), and the user's
 * first workspace active as a sign-in would. Everything that can fail is read first and the session made last; should
 * signing its cookie still fail, the session is deleted again, so no live session is ever left undelivered.
 */
async function newSession(env: AppSignInEnv, auth: () => Auth, row: Row, request: Request) {
  const context = await auth().$context;
  const user = await context.internalAdapter.findUserById(row.userId);
  if (!user) throw new Error("the user is gone");
  const workspace = await env.DB.prepare(
    `select "organizationId" as id from member where "userId" = ? order by "createdAt" asc limit 1`,
  )
    .bind(row.userId)
    .first<{ id: string }>();
  const cookie = context.authCookies.sessionToken;
  const session = await context.internalAdapter.createSession(row.userId, false, {
    deviceName: row.deviceName,
    signInMethod: SIGN_IN_METHOD_QR,
    ipAddress: request.headers.get("cf-connecting-ip") ?? "",
    userAgent: request.headers.get("user-agent") ?? "",
    activeOrganizationId: workspace?.id ?? null,
  });
  try {
    const signed = `${session.token}.${await makeSignature(session.token, env.BETTER_AUTH_SECRET)}`;
    const expiresAt = new Date(session.expiresAt);
    const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    const attributes = [
      `${cookie.name}=${encodeURIComponent(signed)}`,
      `Max-Age=${maxAge}`,
      `Path=${cookie.attributes.path ?? "/"}`,
      "HttpOnly",
      ...(cookie.attributes.secure ? ["Secure"] : []),
      "SameSite=Lax",
    ];
    return {
      status: "approved" as const,
      session: { cookie: attributes.join("; "), expiresAt: expiresAt.toISOString() },
      user: { id: user.id, name: user.name, email: user.email },
    };
  } catch (error) {
    await context.internalAdapter.deleteSession(session.token);
    throw error;
  }
}

/** `session.signInMethod` for a session a QR sign-in made (src/auth.ts). */
export const SIGN_IN_METHOD_QR = "qr";

/** How the dashboard sees a row at `now`. */
function view(row: Row, now: number) {
  const open = row.expiresAt > now;
  const status: AppSignInStatus =
    row.state === "delivered"
      ? "signed_in"
      : row.state === "denied" || row.state === "wrong_number"
        ? row.state
        : !open
          ? "expired"
          : row.state === "issued"
            ? "waiting"
            : row.state;
  return {
    id: row.id,
    status,
    expiresAt: new Date(row.expiresAt).toISOString(),
    // Once claimed, what kind of device wants in: never the number, nor the phone's own device name.
    ...(row.deviceKind === null ? {} : { deviceKind: row.deviceKind }),
  };
}

function readRow(db: D1Database, id: string): Promise<Row | null> {
  return db
    .prepare(
      `select id, "userId", "sessionId", state, "expiresAt", "deviceName", "deviceKind", "secretHash"
       from app_sign_in where id = ?`,
    )
    .bind(id)
    .first<Row>();
}

/** Deletes rows that ended (or ran out) more than `APP_SIGN_IN_KEEP_MS` ago; run by the Worker's cron. */
export async function pruneAppSignIns(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(`delete from app_sign_in where "expiresAt" < ?1 or "endedAt" < ?1`)
    .bind(now - APP_SIGN_IN_KEEP_MS)
    .run();
}

/**
 * Workers Rate Limiting per caller address (`APP_SIGN_IN_LIMIT`), before D1 is touched. A limiter that fails lets
 * the claim through: the code's 128 bits are what stop guessing, the limit only bounds the work.
 */
async function claimAllowed(env: AppSignInEnv, request: Request): Promise<boolean> {
  try {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";
    return (await env.APP_SIGN_IN_LIMIT.limit({ key })).success;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "app sign-in rate limit failed", error: String(error) }),
    );
    return true;
  }
}

/**
 * The origin the QR names: `DASHBOARD_URL` when set (the dashboard's public origin), else the one the request came
 * through, which the web Worker forwards as the browser's.
 */
export function dashboardOrigin(env: AppSignInEnv, request: Request): string {
  if (env.DASHBOARD_URL) {
    try {
      const url = new URL(env.DASHBOARD_URL);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch {
      // Not a URL: the request's own.
    }
  }
  return new URL(request.url).origin;
}

/** A browser page on another site (the app and the dashboard's own requests pass). */
function crossSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

/** 0 to 99, uniform (bytes from 200 up are drawn again), as two digits. */
function twoDigits(): string {
  for (;;) {
    const [byte] = randomBytes(1);
    if (byte! < 200) return String(byte! % 100).padStart(2, "0");
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Two hex digests compared in constant time. */
function sameDigest(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const NO_STORE = { "Cache-Control": "no-store" };

function notAllowed(methods: string[]): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: methods.join(", ") });
}

function unavailable(message: string, error: unknown): Response {
  console.error(JSON.stringify({ message, error: String(error) }));
  return json({ error: "unavailable" }, 503);
}
