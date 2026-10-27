// Better Auth on Workers + D1 (RFC 0002, RFC 0003): users, sessions and workspace membership. A workspace is a
// Better Auth organization; its roles and permissions are Brigade's own table from packages/schema, so the API,
// the sync engine and the UI check the same grants.
//
// Kept free of Workers imports: bindings come in as arguments. test/migrations.test.ts checks that migrations/
// creates exactly what these options need, and prints the SQL for anything missing.

import {
  DEVICE_HEADER,
  memberName,
  newId,
  roles,
  SESSION_LIFETIME_S,
  statement,
  workspaceName,
  type RandomBytes,
} from "@freecorps/brigade-schema";
import { isLocale, resolveLocale } from "@freecorps/brigade-i18n";
import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";
import {
  dashboardLink,
  renderPasswordResetEmail,
  renderSignUpAttemptEmail,
  renderVerificationEmail,
} from "./email-templates.ts";
import { linkFallback, type EmailSender } from "./email.ts";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

/** Where the API Worker serves Better Auth; the dashboard reaches it as `/api/auth` (apps/web/worker). */
export const AUTH_BASE_PATH = "/auth";

/** Brigade's permissions next to Better Auth's own (organization, member, invitation, team, ac). */
export const ac = createAccessControl({ ...defaultStatements, ...statement });

/**
 * Owners and admins also manage the workspace through Better Auth (members, invitations), with the plugin's own
 * grants for those two roles; responders and viewers get Brigade's grants only.
 */
export const authRoles = {
  owner: ac.newRole({ ...ownerAc.statements, ...grants(roles.owner) }),
  admin: ac.newRole({ ...adminAc.statements, ...grants(roles.admin) }),
  responder: ac.newRole(grants(roles.responder)),
  viewer: ac.newRole(grants(roles.viewer)),
};

/** A mutable copy of a role's grants, as `newRole` takes them. */
function grants<G extends { readonly [resource: string]: readonly string[] }>(
  role: G,
): { -readonly [R in keyof G]: G[R][number][] } {
  return Object.fromEntries(
    Object.entries(role).map(([resource, actions]) => [resource, [...actions]]),
  ) as { -readonly [R in keyof G]: G[R][number][] };
}

/** RFC 0003 prefixed ULIDs for Better Auth's rows: `usr_…`, `ws_…` (a workspace is an organization), … */
const ID_PREFIXES: Record<string, string> = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  organization: "ws",
  member: "mem",
  invitation: "inv",
  team: "team",
  teamMember: "tmm",
  organizationRole: "role",
  rateLimit: "rl",
};

export function authId(model: string, now: number, random: RandomBytes): string {
  const prefix =
    ID_PREFIXES[model] ??
    (model
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 8) ||
      "id");
  return newId(prefix.length < 2 ? `${prefix}x` : prefix, now, random);
}

export type AuthBindings = {
  /** The D1 database (the `DB` binding): Better Auth's tables, and the counters and clean-ups Brigade runs there. */
  database: D1Database;
  secret: string;
  /** Runs promises after the response (`ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Whether the request came over HTTPS: cookies then get the `Secure` attribute and the `__Secure-` prefix.
   * Better Auth would otherwise decide from `NODE_ENV === "production"`, which Workers never set.
   */
  secureCookies?: boolean;
  /**
   * Called once Better Auth has created a workspace (provisions its shard). If it throws, the workspace is
   * deleted again (see createAuth) and the request fails, so no workspace exists without its shard.
   */
  onWorkspaceCreated?: (workspace: { id: string; name: string; ownerId: string }) => Promise<void>;
  /**
   * The email sender (`emailSender(env)`), for verification emails; none when email is not set up, and then none is
   * sent (and asking again answers `EMAIL_NOT_CONFIGURED`). `dashboardUrl`: the dashboard's origin for the link;
   * without it only the dev log sender uses the origin the request came through (`linkFallback`), and a real one
   * sends nothing.
   */
  email?: { sender: EmailSender | undefined; dashboardUrl?: string };
  /**
   * Called once a password reset went through, after Better Auth deleted the user's sessions and the address was
   * marked verified (and `user.passwordResetAt` set): signs the user's devices and sockets out of every workspace
   * (src/index.ts). `takeOver`: the address was not verified before, so this is its owner taking back an account
   * someone else signed up with. Must not throw.
   */
  onPasswordReset?: (userId: string, reset: { takeOver: boolean; at: number }) => Promise<void>;
  /**
   * Called for every session that ends (sign-out, a revoked or expired session, a password reset): closes the sockets
   * opened with it in each of the user's workspaces, and with `deviceId` (the mobile app signing out names its device,
   * `DEVICE_HEADER`) takes that phone off them too (src/index.ts). Must not throw.
   */
  onSessionEnded?: (session: EndingSession) => Promise<void>;
  /**
   * Called before a session's row is deleted: records the end durably (D1's `session_end`, src/session-end.ts), so
   * what `onSessionEnded` cannot finish is finished later. Throws when it could not: a sign-out then answers 503 with
   * its session kept, so the client signs out again later (the app keeps the sign-out, src/lib/sign-out.ts); any other
   * way a session ends goes on, with `onSessionEnded` alone.
   */
  onSessionEnding?: (session: EndingSession) => Promise<void>;
};

/** A session that ends: whose, which, the phone that names itself on `/sign-out`, and when. */
export type EndingSession = {
  userId: string;
  sessionId: string;
  deviceId?: string;
  endedAt: number;
};

/**
 * The device the mobile app names on `/sign-out` (`DEVICE_HEADER`). Only ever drops a device of the user signing
 * out, so a made-up id harms nobody.
 */
const DEVICE_ID = /^dev_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Requests per window for Better Auth's routes, counted per client IP and path in D1 (the `rateLimit` table), so
 * every isolate sees the same counts. Better Auth's own stricter rules still apply on top: 3 per 10 s for
 * `/sign-up/*`, `/change-password` and `/change-email` (sign-in has its own, `SIGN_IN_IP_LIMIT`).
 */
export const RATE_LIMIT = { window: 60, max: 100 };
/**
 * Sign-in with email and password (RFC 0002 "Auth"): per client IP, loose enough for a team behind one office or
 * carrier NAT signing in at once during an incident (Better Auth's default, 3 per 10 s, locked them out), and per
 * address from anywhere (`SIGN_IN_ACCOUNT_LIMIT`, counted in D1's `rateLimit` table for any address, account or not,
 * so a 429 says nothing about whether it has one), which is what bounds guessing one account's password from many
 * addresses. The cost: whoever knows an address can keep its sign-in at the limit, a minute at a time; a signed-in
 * phone or dashboard keeps its session. A password reset ends every session, so its owner's way back in is
 * `SIGN_IN_AFTER_RESET`.
 */
export const SIGN_IN_IP_LIMIT = { window: 60, max: 30 };
export const SIGN_IN_ACCOUNT_LIMIT = { window: 60, max: 5 };
/**
 * After a successful password reset, sign-ins for that address from the client IP that reset it skip
 * `SIGN_IN_ACCOUNT_LIMIT` for this many seconds (the per-IP rule still applies): the reset signed its owner out
 * everywhere, and someone holding the address at its limit must not keep them out. Keyed by IP, which whoever holds
 * the address at the limit does not have.
 */
export const SIGN_IN_AFTER_RESET = { window: 15 * 60 };
/**
 * "Someone tried to sign up with your address" emails (`onExistingUserSignUp`), per account: a sign-up with a taken
 * address answers as for a new one, and its owner is told, at most this often, so sign-ups cannot flood an inbox.
 */
export const SIGN_UP_NOTICE_LIMIT = { window: 24 * 60 * 60, max: 3 };
/**
 * Reads the dashboard makes on every load: never limited (and no D1 write each), so a team behind one office or
 * carrier NAT opening the dashboard during an incident cannot hit 429.
 */
export const UNLIMITED_READS = [
  "/get-session",
  "/organization/get-full-organization",
  "/organization/get-active-member",
  "/organization/list",
] as const;
/**
 * The mobile app's origin (its `brigade://` scheme, apps/mobile/app.config.ts). The app has no web origin: its Better
 * Auth client (`@better-auth/expo`) sends this as `expo-origin`, which the `expo()` plugin copies to `Origin` when a
 * request has none, so Better Auth's origin check on sign-in and sign-out passes for the app and still refuses any
 * other site. A browser page cannot send it: browsers set `Origin` themselves, and the plugin never replaces one.
 */
export const APP_ORIGIN = "brigade://";
/** How long an email verification link works, in seconds. */
export const VERIFICATION_TTL_S = 24 * 60 * 60;
/**
 * Verification emails one signed-in user may ask for again (`/send-verification-email`) per window, on top of the
 * per-IP rule (`VERIFICATION_IP_LIMIT`): counted per user in D1's `rateLimit` table, so asking from many addresses
 * floods nobody's inbox. The one sent at sign-up does not count. `VERIFICATION_DAILY_LIMIT` bounds a day of them, so
 * an account signed up with someone else's address cannot keep mailing it 3 times every 15 minutes.
 */
export const VERIFICATION_RESEND_LIMIT = { window: 15 * 60, max: 3 };
export const VERIFICATION_DAILY_LIMIT = { window: 24 * 60 * 60, max: 5 };
export const VERIFICATION_IP_LIMIT = { window: 60, max: 3 };
/** How long a password reset link works, in seconds (Better Auth's default, stated). */
export const RESET_TTL_S = 60 * 60;
/**
 * Password reset emails (`/request-password-reset`), counted for any address, account or not, so the answer never
 * tells the two apart, in D1's `rateLimit` table like verification's: 3 an hour per address from one IP, and 10 a day
 * per address from anywhere, on top of 3 per IP a minute (`RESET_IP_LIMIT`). Keyed by address and IP, so someone
 * asking for another person's address from their own network uses up their own hourly count, not the owner's; only
 * the daily cap is shared, and it is loose enough that the owner still gets a link most days (Q21).
 */
export const RESET_ADDRESS_LIMIT = { window: 60 * 60, max: 3 };
export const RESET_DAILY_LIMIT = { window: 24 * 60 * 60, max: 10 };
export const RESET_IP_LIMIT = { window: 60, max: 3 };
/** Attempts at setting the new password per IP a minute (`/reset-password`); its token cannot be guessed anyway. */
export const RESET_SUBMIT_LIMIT = { window: 60, max: 10 };
/** The answer when a verification email is asked for and email is not set up. */
export const EMAIL_NOT_CONFIGURED_CODE = "EMAIL_NOT_CONFIGURED";
/** Workspaces one user may belong to; bounds `POST /workspaces` (each one also provisions a shard). */
export const WORKSPACE_LIMIT = 10;
/** Better Auth's routes that set a user's name. */
export const NAME_PATHS = ["/sign-up/email", "/update-user"] as const;
/** The error code when a name breaks `memberName`. */
export const INVALID_NAME_CODE = "INVALID_NAME";
/** The error code when a locale is not one Brigade has (`locales` in packages/i18n). */
export const INVALID_LOCALE_CODE = "INVALID_LOCALE";

/**
 * Checks a name before Better Auth stores it, with the rule the shard's member list keeps names by (`memberName`:
 * no bidi or other invisible characters, joiners only between letters, at most `MEMBER_NAME_MAX`), and stores it
 * trimmed. Better Auth itself takes any string. Likewise the user's `locale` (the language emails are written in,
 * RFC 0008): one of Brigade's locales exactly, or null on `/update-user` to unset it; a sign-up without one takes
 * the closest to the request's first `Accept-Language`, if any.
 */
const beforeHook = (
  bindings: AuthBindings,
  signingOut: SigningOut,
  background?: BackgroundReset,
) => {
  // Requests whose limits `checkResetRequest` already counted and that it handed to this instance again in the
  // background: let through as they are. Per instance, so per request.
  const admitted = new WeakSet<Request>();
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/sign-out") return recordSignOut(bindings, ctx, signingOut);
    if (ctx.path === "/send-verification-email") {
      // Only for oneself: Better Auth would otherwise email any unverified address it is given, signed in or not.
      const session = await getSessionFromCtx(ctx);
      if (!session)
        throw APIError.from("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Sign in" });
      if (!bindings.email?.sender) {
        throw APIError.from("SERVICE_UNAVAILABLE", {
          code: EMAIL_NOT_CONFIGURED_CODE,
          message: "Email is not set up",
        });
      }
      // Refused here rather than left to Better Auth, so no version of it can mail an address other than the
      // session's own.
      const email: unknown = Reflect.get(Object(ctx.body), "email");
      if (typeof email !== "string" || email.toLowerCase() !== session.user.email.toLowerCase()) {
        throw APIError.from("FORBIDDEN", {
          code: "FORBIDDEN",
          message: "Only your own address can be verified",
        });
      }
      // Better Auth refuses this itself; only an email that goes out counts.
      if (session.user.emailVerified) return;
      const now = Date.now();
      for (const [key, limit] of [
        [`verify:${session.user.id}`, VERIFICATION_RESEND_LIMIT],
        [`verify-day:${session.user.id}`, VERIFICATION_DAILY_LIMIT],
      ] as const) {
        if ((await countRequest(bindings.database, key, limit.window, now)) > limit.max) {
          throw APIError.from("TOO_MANY_REQUESTS", {
            code: "TOO_MANY_REQUESTS",
            message: "Too many verification emails",
          });
        }
      }
      return;
    }
    if (ctx.path === "/request-password-reset") {
      return checkResetRequest(bindings, ctx, background, admitted);
    }
    if (ctx.path === "/sign-in/email") return checkSignIn(bindings, ctx);
    return checkName(ctx);
  });
};

/**
 * `/sign-in/email`: counts the try against its address (`SIGN_IN_ACCOUNT_LIMIT`), account or not, on top of the per-IP
 * rule Better Auth counts first. The address as Better Auth looks it up (lower case), trimmed, so spelling it another
 * way does not get another count.
 */
async function checkSignIn(
  bindings: AuthBindings,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
) {
  const email: unknown = Reflect.get(Object(ctx.body), "email");
  // Anything else is Better Auth's to refuse (400).
  if (typeof email !== "string" || email.length > 254) return;
  const address = email.trim().toLowerCase();
  // Only something that could be an address gets a counter of its own (Better Auth refuses the rest).
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return;
  const now = Date.now();
  const ip = ctx.headers?.get("cf-connecting-ip") ?? "";
  if (ip && (await resetLately(bindings.database, address, ip, now))) return;
  const key = `signin:${address}`;
  const { window, max } = SIGN_IN_ACCOUNT_LIMIT;
  if ((await countRequest(bindings.database, key, window, now)) > max) {
    throw APIError.from("TOO_MANY_REQUESTS", {
      code: "TOO_MANY_REQUESTS",
      message: "Too many sign-in attempts for this account",
    });
  }
}

/** The `rateLimit` row that records a password reset of `address` from `ip` (`SIGN_IN_AFTER_RESET`). */
const resetKey = (address: string, ip: string) => `signin-reset:${address}:${ip}`;

/** Whether `address`'s password was reset from `ip` within `SIGN_IN_AFTER_RESET`. */
async function resetLately(db: D1Database, address: string, ip: string, now: number) {
  const row = await db
    .prepare(`select "lastRequest" from "rateLimit" where key = ?`)
    .bind(resetKey(address, ip))
    .first<{ lastRequest: number }>();
  return row !== null && now - row.lastRequest <= SIGN_IN_AFTER_RESET.window * 1000;
}

/** What `/request-password-reset` answers, for every address. Better Auth's own words, so both paths say the same. */
export const RESET_REQUESTED = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
};

/**
 * `/request-password-reset` (RFC 0002 "Auth"): the same answer for every address, account or not, except when email
 * is not set up at all (`EMAIL_NOT_CONFIGURED`, the same for everyone) or the address asked too often (counted for
 * any address, so a limit says nothing about whether it has an account). The link is always the dashboard's own
 * page, so whatever `redirectTo` the request names is dropped. Answered here, before Better Auth looks the address
 * up: the lookup, the token and the email run after the response (`waitUntil`), so its timing is the same for an
 * address with an account and one without.
 */
async function checkResetRequest(
  bindings: AuthBindings,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  background: BackgroundReset | undefined,
  admitted: WeakSet<Request>,
) {
  if (ctx.request && admitted.has(ctx.request)) return;
  if (!bindings.email?.sender) {
    throw APIError.from("SERVICE_UNAVAILABLE", {
      code: EMAIL_NOT_CONFIGURED_CODE,
      message: "Email is not set up",
    });
  }
  const body: unknown = ctx.body;
  if (typeof body !== "object" || body === null) return;
  const email: unknown = Reflect.get(body, "email");
  // Anything else is Better Auth's to refuse (400).
  if (typeof email !== "string" || email.length > 254) return;
  const address = email.trim().toLowerCase();
  const ip = ctx.headers?.get("cf-connecting-ip") ?? "";
  const now = Date.now();
  for (const [key, limit] of [
    [`reset:${address}:${ip}`, RESET_ADDRESS_LIMIT],
    [`reset-day:${address}`, RESET_DAILY_LIMIT],
  ] as const) {
    if ((await countRequest(bindings.database, key, limit.window, now)) > limit.max) {
      throw APIError.from("TOO_MANY_REQUESTS", {
        code: "TOO_MANY_REQUESTS",
        message: "Too many password reset emails",
      });
    }
  }
  const { redirectTo: _dropped, ...rest } = body as Record<string, unknown>;
  if (!background || !bindings.waitUntil || !ctx.request) return { context: { body: rest } };
  const request = ctx.request;
  admitted.add(request);
  bindings.waitUntil(
    background(rest, request).catch((error: unknown) =>
      console.error(
        JSON.stringify({ message: "password reset request failed", error: String(error) }),
      ),
    ),
  );
  return RESET_REQUESTED;
}

/** Runs `/request-password-reset` again with `body`, through Better Auth (`createAuth`), after the response. */
type BackgroundReset = (body: Record<string, unknown>, request: Request) => Promise<unknown>;

/**
 * Counts one more request under `key` in D1's `rateLimit` table and answers the count in the current window
 * (`window` seconds from its first request). One statement, so requests at once each get their own count.
 */
export async function countRequest(
  db: D1Database,
  key: string,
  window: number,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `insert into "rateLimit" (id, key, count, "lastRequest") values (?1, ?2, 1, ?3)
       on conflict (key) do update set
         count = case when ?3 - "lastRequest" > ?4 then 1 else count + 1 end,
         "lastRequest" = case when ?3 - "lastRequest" > ?4 then ?3 else "lastRequest" end
       returning count`,
    )
    // The window starts at the first request in it, so `lastRequest` moves only when a new one starts.
    .bind(authId("rateLimit", now, randomBytes), key, now, window * 1000)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Rate-limit counters older than every window (the longest is a day): deleted by the API Worker's cron, since counters
 * are kept for any key a request names (an address with no account, a made-up one).
 */
export const RATE_LIMIT_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

/** Deletes the `rateLimit` rows whose window ended more than `RATE_LIMIT_KEEP_MS` ago. */
export async function pruneRateLimits(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(`delete from "rateLimit" where "lastRequest" < ?`)
    .bind(now - RATE_LIMIT_KEEP_MS)
    .run();
}

const randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

const checkName = async (ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) => {
  if (!(NAME_PATHS as readonly string[]).includes(ctx.path)) return;
  const body: unknown = ctx.body;
  if (typeof body !== "object" || body === null) return;
  const checked: Record<string, unknown> = {};
  if ("name" in body) {
    const name = memberName(body.name, "name");
    if (!name.ok) {
      throw APIError.from("BAD_REQUEST", { code: INVALID_NAME_CODE, message: "Invalid name" });
    }
    checked.name = name.value;
  }
  if ("locale" in body && body.locale !== undefined) {
    // null on `/update-user` unsets it (back to English); a sign-up without one leaves it out.
    const unset = body.locale === null && ctx.path === "/update-user";
    if (!unset && !isLocale(body.locale)) {
      throw APIError.from("BAD_REQUEST", { code: INVALID_LOCALE_CODE, message: "Invalid locale" });
    }
  } else if (ctx.path === "/sign-up/email") {
    const wanted = ctx.headers?.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim();
    if (wanted) checked.locale = resolveLocale(wanted);
  }
  if (Object.keys(checked).length === 0) return;
  return { context: { body: { ...body, ...checked } } };
};

/**
 * Where the verification page sends the user after: a dashboard path of Brigade's own (the invitation they were
 * answering), never another site. Undefined for anything else.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^\/invitations\/inv_[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : undefined;
}

type TakenUser = { id: string; email: string; locale: unknown };

/**
 * A sign-up with an address that has an account (RFC 0002 "Auth"): its owner is told, at most `SIGN_UP_NOTICE_LIMIT`,
 * the email sent after the response. Before answering, two D1 writes in a row (the notice's counter, then touching
 * it again), as a sign-up of a free address makes two (the user, then the account), so the answer takes about as long
 * either way; the password was hashed on both paths already. Never throws.
 */
async function signUpNotice(bindings: AuthBindings, user: TakenUser, request: Request | undefined) {
  const key = `signup-notice:${user.id}`;
  let count: number;
  try {
    const { window } = SIGN_UP_NOTICE_LIMIT;
    count = await countRequest(bindings.database, key, window, Date.now());
    await bindings.database
      .prepare(`update "rateLimit" set count = count where key = ?`)
      .bind(key)
      .run();
  } catch (error) {
    console.error(JSON.stringify({ message: "sign-up notice count failed", error: String(error) }));
    return;
  }
  const sender = bindings.email?.sender;
  if (!sender || count > SIGN_UP_NOTICE_LIMIT.max) return;
  const link = dashboardLink(
    "/sign-in",
    {},
    bindings.email?.dashboardUrl,
    linkFallback(sender, request ? new URL(request.url).origin : undefined),
  );
  if (!link) {
    console.error(JSON.stringify({ message: "sign-up notice not sent: DASHBOARD_URL is not set" }));
    return;
  }
  // Never the name, nor anything the person signing up typed but the address.
  const send = sender
    .send(
      renderSignUpAttemptEmail(
        { email: user.email },
        link,
        resolveLocale(typeof user.locale === "string" ? user.locale : undefined),
      ),
    )
    .then(
      (result) => {
        if (!result.ok) {
          console.error(
            JSON.stringify({
              message: "sign-up notice refused",
              sender: sender.id,
              code: result.code,
            }),
          );
        }
      },
      (error: unknown) =>
        console.error(JSON.stringify({ message: "sign-up notice failed", error: String(error) })),
    );
  if (bindings.waitUntil) bindings.waitUntil(send);
  else await send;
}

/** The answer to a sign-out whose end could not be recorded (`onSessionEnding`): its session stays. */
export const SIGN_OUT_FAILED_CODE = "SIGN_OUT_FAILED";

const signOutFailed = () =>
  APIError.from("SERVICE_UNAVAILABLE", {
    code: SIGN_OUT_FAILED_CODE,
    message: "Signing out failed; try again",
  });

/** The request's `/sign-out`: the session `recordSignOut` recorded the end of, for the hooks after it. */
type SigningOut = { sessionId?: string };

/**
 * `/sign-out`, before Better Auth runs it: finds the session in D1 itself and records its end (`onSessionEnding`). Better
 * Auth's own sign-out ignores a failed lookup or delete (it then runs no session hook and deletes nothing) and clears
 * the cookie all the same, answering 200: the session would live on with no `session_end` row, and the phone would
 * stay its member's. So a D1 that cannot be read or written answers 503 `SIGN_OUT_FAILED` here, before the cookie is
 * touched, and the `after` hook checks the row is gone. No session: Better Auth's answer, as for a signed-out client.
 */
async function recordSignOut(
  bindings: AuthBindings,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  signingOut: SigningOut,
) {
  const ending = bindings.onSessionEnding;
  if (!ending) return;
  const token = await ctx.getSignedCookie(
    ctx.context.authCookies.sessionToken.name,
    ctx.context.secret,
  );
  if (!token) return;
  try {
    const session = await bindings.database
      .prepare(`select id, "userId" from "session" where token = ?`)
      .bind(token)
      .first<{ id: string; userId: string }>();
    if (!session) return;
    await ending(endingSession(session, ctx));
    signingOut.sessionId = session.id;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "recording a session's end failed", error: String(error) }),
    );
    throw signOutFailed();
  }
}

/**
 * After Better Auth's `/sign-out`: whether the session `recordSignOut` recorded is gone from D1. False when it is
 * still there or D1 cannot say: the sign-out then answers 503 with the cookie kept, and the client signs out again.
 */
async function signedOut(bindings: AuthBindings, sessionId: string): Promise<boolean> {
  try {
    const row = await bindings.database
      .prepare(`select 1 as found from "session" where id = ?`)
      .bind(sessionId)
      .first();
    return row === null;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "checking a signed-out session failed", error: String(error) }),
    );
    return false;
  }
}

/** The session ending, with the device the mobile app names on `/sign-out` (`DEVICE_HEADER`), if any. */
function endingSession(
  session: { id: string; userId: string },
  ctx: { path?: string; headers?: Headers } | null | undefined,
): EndingSession {
  const named = ctx?.path === "/sign-out" ? ctx.headers?.get(DEVICE_HEADER) : null;
  const deviceId = named && DEVICE_ID.test(named) ? named : undefined;
  return {
    userId: session.userId,
    sessionId: session.id,
    endedAt: Date.now(),
    ...(deviceId ? { deviceId } : {}),
  };
}

export function authOptions(bindings: AuthBindings, store?: WorkspaceStore, self: Self = noSelf) {
  const random = randomBytes;
  // One instance per request (src/index.ts `workerAuth`), so these are the request's own.
  const signingOut: SigningOut = {};
  const taken: { user?: TakenUser; request?: Request } = {};
  return {
    appName: "Brigade",
    basePath: AUTH_BASE_PATH,
    secret: bindings.secret,
    database: bindings.database,
    // Unverified accounts sign in and use their own workspaces; verification gates email, inviting and joining
    // (RFC 0002 "Auth").
    emailAndPassword: {
      enabled: true,
      // A uniform sign-up (RFC 0002 "Auth"): with no session handed out, Better Auth answers a sign-up with a taken
      // address the same as one that created an account (a made-up user, no session, the password hashed all the
      // same), so the answer cannot tell whether an address has an account. The clients sign in right after.
      autoSignIn: false,
      // Its owner is told instead (`signUpNotice`, from the `after` hook, which also evens out the answer's timing).
      // Called synchronously by Better Auth; only noted here.
      onExistingUserSignUp: ({ user }, request) => {
        taken.user = { id: user.id, email: user.email, locale: Reflect.get(user, "locale") };
        taken.request = request;
        return Promise.resolve();
      },
      // Password reset (RFC 0002 "Auth"): the link is the dashboard's `/reset-password#token=…`, and using it proves
      // control of the address, so it also marks the address verified and ends every session. That is how an
      // address someone else signed up with and never verified comes back to its owner.
      resetPasswordTokenExpiresIn: RESET_TTL_S,
      revokeSessionsOnPasswordReset: true,
      // Run in `backgroundTasks` like the verification email, so the answer takes as long for an address without
      // an account.
      sendResetPassword: async ({ user, token }, request) => {
        const sender = bindings.email?.sender;
        if (!sender) return;
        // In the fragment, which browsers never send: not to the dashboard, a proxy's log or a `Referer`.
        const link = dashboardLink(
          "/reset-password",
          {},
          bindings.email?.dashboardUrl,
          linkFallback(sender, request ? new URL(request.url).origin : undefined),
          { token },
        );
        if (!link) {
          console.error(
            JSON.stringify({ message: "password reset email not sent: DASHBOARD_URL is not set" }),
          );
          return;
        }
        const locale = Reflect.get(user, "locale");
        // Never the name: on an account nobody verified, whoever signed up typed it.
        const result = await sender.send(
          renderPasswordResetEmail(
            { email: user.email },
            link,
            resolveLocale(typeof locale === "string" ? locale : undefined),
          ),
        );
        if (!result.ok) {
          console.error(
            JSON.stringify({
              message: "password reset email refused",
              sender: sender.id,
              code: result.code,
            }),
          );
        }
      },
      // After Better Auth set the password, consumed the token and deleted every session. `user` is as it was
      // before the reset.
      onPasswordReset: async ({ user }, request) => {
        const at = Date.now();
        await self.resetDone(user.id, at);
        // Its owner signs in again from where they reset it, whoever holds the address at its limit
        // (`SIGN_IN_AFTER_RESET`). Never in the reset's way.
        const ip = request?.headers.get("cf-connecting-ip");
        if (ip) {
          const address = user.email.toLowerCase();
          await bindings.database
            .prepare(
              `insert into "rateLimit" (id, key, count, "lastRequest") values (?1, ?2, 1, ?3)
               on conflict (key) do update set count = 1, "lastRequest" = ?3`,
            )
            .bind(authId("rateLimit", at, randomBytes), resetKey(address, ip), at)
            .run()
            .catch((error: unknown) =>
              console.error(
                JSON.stringify({
                  message: "recording a reset for sign-in failed",
                  error: String(error),
                }),
              ),
            );
        }
        await bindings.onPasswordReset?.(user.id, { takeOver: !user.emailVerified, at });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: VERIFICATION_TTL_S,
      // Never awaited by the request (Better Auth runs it in `backgroundTasks`), and never throws.
      sendVerificationEmail: async ({ user, token, url }, request) => {
        const sender = bindings.email?.sender;
        if (!sender) return;
        const next = safeNext(new URL(url).searchParams.get("callbackURL"));
        const link = dashboardLink(
          "/verify-email",
          { token, ...(next ? { next } : {}) },
          bindings.email?.dashboardUrl,
          linkFallback(sender, request ? new URL(request.url).origin : undefined),
        );
        if (!link) {
          console.error(
            JSON.stringify({ message: "verification email not sent: DASHBOARD_URL is not set" }),
          );
          return;
        }
        const locale = Reflect.get(user, "locale");
        // Never the name: whoever signs up types it, and this goes to an address nobody proved yet.
        const result = await sender.send(
          renderVerificationEmail(
            { email: user.email },
            link,
            resolveLocale(typeof locale === "string" ? locale : undefined),
          ),
        );
        if (!result.ok) {
          console.error(
            JSON.stringify({
              message: "verification email refused",
              sender: sender.id,
              code: result.code,
            }),
          );
        }
      },
    },
    // The language Brigade writes to the user in (emails, RFC 0008); null: English. Checked by `checkName`.
    user: {
      additionalFields: {
        locale: { type: "string", required: false, input: true },
        // When the password was last reset (ms since the epoch), set by `onPasswordReset` only (RFC 0002 "Auth").
        passwordResetAt: { type: "number", required: false, input: false, returned: false },
      },
      // Stated, not left to the defaults: a verification link holds only the address, so it is safe only while an
      // address belongs to one account for good. With no way to delete a user or move them to another address, an
      // old link can never verify a newer account at that address (RFC 0002 "Auth"). Enabling either needs links
      // bound to the account first.
      deleteUser: { enabled: false },
      changeEmail: { enabled: false },
    },
    // The dashboard is same-origin (Better Auth trusts its own base URL); the mobile app is `APP_ORIGIN`.
    trustedOrigins: [APP_ORIGIN],
    hooks: {
      before: beforeHook(bindings, signingOut, self.requestReset),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && taken.user) {
          const { user, request } = taken;
          taken.user = undefined;
          await signUpNotice(bindings, user, request);
        }
        const sessionId = signingOut.sessionId;
        signingOut.sessionId = undefined;
        // A sign-out whose session Better Auth did not delete (it logs and answers 200): say so, so the client tries
        // again, and drop the cookie Better Auth cleared anyway, so the client keeps the session it still has.
        if (ctx.path === "/sign-out" && sessionId && !(await signedOut(bindings, sessionId))) {
          ctx.context.responseHeaders?.delete("set-cookie");
          throw signOutFailed();
        }
      }),
    },
    // Stated, not left to the default: the mobile app keeps a session from an offline sign-out this long at most.
    session: { expiresIn: SESSION_LIFETIME_S },
    // Off by default on Workers (Better Auth enables it only when NODE_ENV is "production"). The in-memory store
    // would count per isolate, so the counts live in D1.
    rateLimit: {
      enabled: true,
      storage: "database",
      ...RATE_LIMIT,
      customRules: {
        ...Object.fromEntries(UNLIMITED_READS.map((path) => [path, false as const])),
        "/send-verification-email": VERIFICATION_IP_LIMIT,
        "/request-password-reset": RESET_IP_LIMIT,
        "/reset-password": RESET_SUBMIT_LIMIT,
        "/sign-in/email": SIGN_IN_IP_LIMIT,
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A new session starts in the user's first workspace, so signing in lands on it.
          before: async (session, ctx) => {
            const [member] =
              (await ctx?.context.adapter.findMany<{ organizationId: string }>({
                model: "member",
                where: [{ field: "userId", value: session.userId }],
                sortBy: { field: "createdAt", direction: "asc" },
                limit: 1,
              })) ?? [];
            return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
          },
        },
        // Every way a session ends (sign-out, revoking one or all, a password reset, an expired one found) deletes
        // its row through here: its sockets close in every workspace (RFC 0004 "Session revocation").
        delete: {
          // Recorded first, so a shard the hook below cannot reach still hears of it (src/session-end.ts). A
          // sign-out's was recorded before Better Auth ran (`recordSignOut`); any other way a session ends goes on
          // when it cannot be, with `onSessionEnded` alone.
          before: async (session, ctx) => {
            const ending = bindings.onSessionEnding;
            if (!ending || session.id === signingOut.sessionId) return;
            try {
              await ending(endingSession(session, ctx));
            } catch (error) {
              console.error(
                JSON.stringify({
                  message: "recording a session's end failed",
                  error: String(error),
                }),
              );
            }
          },
          after: async (session, ctx) => {
            const ended = bindings.onSessionEnded;
            if (!ended) return;
            const ending = endingSession(session, ctx);
            const { deviceId } = ending;
            const done = ended(ending).catch((error: unknown) =>
              console.error(
                JSON.stringify({ message: "ending a session failed", error: String(error) }),
              ),
            );
            // A phone signing out waits, so the next member signing in on it never finds it still registered as
            // the last one; anything else closes its sockets after the response.
            if (deviceId || !bindings.waitUntil) await done;
            else bindings.waitUntil(done);
          },
        },
      },
    },
    // Nothing leaves the deployment.
    telemetry: { enabled: false },
    advanced: {
      database: {
        generateId: ({ model }) => authId(model, Date.now(), random),
        // A new instance per request would read D1's table metadata on every request; test/migrations.test.ts
        // checks the schema once instead.
        validateSchema: false,
      },
      useSecureCookies: bindings.secureCookies ?? false,
      // Set by Cloudflare on every request (a client cannot forge it) and passed on by the web Worker's service
      // binding; Better Auth's default, `x-forwarded-for`, is whatever the client sends.
      // Without it (a future caller that builds a fresh Request) every client would share one bucket per path:
      // keep the header on any new path into this Worker.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(bindings.waitUntil ? { backgroundTasks: { handler: bindings.waitUntil } } : {}),
    },
    plugins: [
      // The mobile app (RFC 0002): its session lives in the phone's secure storage and travels as a `Cookie` header
      // it sets itself, on these routes and on the sync upgrade (src/actor.ts).
      expo(),
      organization({
        ac,
        roles: authRoles,
        creatorRole: "owner",
        organizationLimit: WORKSPACE_LIMIT,
        // A workspace outlives its D1 row (its shard, its incidents); deleting one is not designed yet.
        disableOrganizationDeletion: true,
        organizationHooks: {
          // The same check as `POST /workspaces`, for any path that reaches Better Auth's create.
          beforeCreateOrganization: async ({ organization: workspace }) => {
            const name = workspaceName(workspace.name, "name");
            if (!name.ok) {
              throw APIError.from("BAD_REQUEST", {
                code: "INVALID_WORKSPACE_NAME",
                message: "Invalid workspace name",
              });
            }
            return { data: { ...workspace, name: name.value } };
          },
          // Runs before Better Auth makes the workspace active in the session, so undoing it here leaves nothing.
          afterCreateOrganization: async ({ organization: workspace, user }) => {
            // Better Auth counts before it inserts, with no transaction, so parallel creates can all pass
            // `organizationLimit`. Count again now: keep the user's first WORKSPACE_LIMIT, undo any later one.
            if (store && (await store.rank(user.id, workspace.id)) >= WORKSPACE_LIMIT) {
              await store.undo(workspace.id);
              throw APIError.from("FORBIDDEN", {
                code: WORKSPACE_LIMIT_CODE,
                message: "You have reached the maximum number of workspaces",
              });
            }
            try {
              await bindings.onWorkspaceCreated?.({
                id: workspace.id,
                name: workspace.name,
                ownerId: user.id,
              });
            } catch (error) {
              await store?.undo(workspace.id);
              throw error;
            }
          },
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Better Auth's error code when a user already belongs to `WORKSPACE_LIMIT` workspaces. */
export const WORKSPACE_LIMIT_CODE = "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS";

/**
 * What hooks need of the instance `authOptions` configures (`createAuth`): its adapters, and its own
 * `/request-password-reset`, run after the response.
 */
type Self = {
  /**
   * After a password reset: marks the address verified (the link reached it, as a verification link would) and
   * records `passwordResetAt`, which lets each shard's member reconcile drop devices and sockets from before it should
   * its own sign-out fail; then deletes the user's other reset links, any of which would reset the password again.
   */
  resetDone(userId: string, at: number): Promise<void>;
  requestReset?: BackgroundReset;
};

const noSelf: Self = {
  resetDone: () => Promise.reject(new Error("authOptions has no instance: use createAuth")),
};

type WorkspaceStore = {
  /** Deletes a workspace Better Auth just created, with its memberships. */
  undo(workspaceId: string): Promise<void>;
  /** How many of the user's memberships are older than the one in `workspaceId` (0 for the first). */
  rank(userId: string, workspaceId: string): Promise<number>;
};

export function createAuth(bindings: AuthBindings) {
  // The hook runs inside a request to this instance, so its context (and adapter) exists by then.
  const auth = betterAuth(
    authOptions(
      bindings,
      {
        async undo(workspaceId: string): Promise<void> {
          const { adapter } = await auth.$context;
          await adapter.deleteMany({
            model: "member",
            where: [{ field: "organizationId", value: workspaceId }],
          });
          await adapter.delete({
            model: "organization",
            where: [{ field: "id", value: workspaceId }],
          });
        },
        async rank(userId: string, workspaceId: string): Promise<number> {
          const { adapter } = await auth.$context;
          const memberships: { organizationId: string }[] = await adapter.findMany({
            model: "member",
            where: [{ field: "userId", value: userId }],
            // Oldest first.
            sortBy: { field: "createdAt", direction: "asc" },
          });
          const index = memberships.findIndex((member) => member.organizationId === workspaceId);
          return index === -1 ? memberships.length : index;
        },
      },
      {
        async resetDone(userId: string, at: number): Promise<void> {
          const { internalAdapter, adapter } = await auth.$context;
          await internalAdapter.updateUser(userId, { emailVerified: true, passwordResetAt: at });
          await adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: userId },
              { field: "identifier", operator: "starts_with", value: "reset-password:" },
            ],
          });
        },
        requestReset: (body: Record<string, unknown>, request: Request): Promise<unknown> =>
          auth.api.requestPasswordReset({
            body: body as { email: string },
            headers: request.headers,
            request,
          }),
      },
    ),
  );
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
