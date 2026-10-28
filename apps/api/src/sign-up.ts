// Who may create an account on this instance (RFC 0002 "Auth", "Sign-up modes"): the `SIGNUP` variable, `closed` when
// unset, and the unauthenticated `GET /config` the dashboard and the mobile app read it from to hide the form.
//
// Kept free of Workers imports, like src/auth.ts: the database comes in as an argument.

/**
 * - `open`: anyone may sign up (the `dev` environment, local runs and the tests).
 * - `invite`: only an address holding a pending invitation, from any sign-up form.
 * - `closed` (the default): the same rule on the server, since an invitation is an owner's explicit word and would be
 *   useless to anyone new otherwise; the clients only offer the form from an invitation's link.
 */
export type SignUpMode = "open" | "invite" | "closed";

const MODES: readonly string[] = ["open", "invite", "closed"];

/** The instance's mode from its `SIGNUP` variable. Unset or misspelled is `closed`: a typo never opens sign-up. */
export function signUpMode(value: unknown): SignUpMode {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODES.includes(mode) ? (mode as SignUpMode) : "closed";
}

/** The error code a refused sign-up answers with (403); the clients word it (packages/i18n `authErrorMessage`). */
export const SIGN_UP_CLOSED_CODE = "SIGN_UP_CLOSED";
export const SIGN_UP_CLOSED_MESSAGE =
  "Sign-up is closed on this instance — ask an owner for an invitation";

/**
 * Whether `email` may sign up under `mode`: always under `open`; otherwise only an address holding a pending
 * invitation that has not run out, in any workspace (compared as Better Auth stores addresses, lower case). Throws when
 * D1 cannot say, so a sign-up is never let through on a failed read.
 */
export async function signUpAllowed(
  db: D1Database,
  mode: SignUpMode,
  email: unknown,
  now: number,
): Promise<boolean> {
  if (mode === "open") return true;
  if (typeof email !== "string" || email.length > 254) return false;
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return false;
  const row = await db
    .prepare(
      `select 1 as found from invitation
       where lower(email) = ? and status = 'pending' and "expiresAt" > ? limit 1`,
    )
    .bind(address, new Date(now).toISOString())
    .first();
  return row !== null;
}

/**
 * `GET /config`: what the clients need before anyone signs in. No session, nothing about any account or workspace;
 * cached a minute, as the mode only changes with a deploy.
 */
export function serveConfig(request: Request, mode: SignUpMode): Response {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }
  return Response.json({ signUp: mode }, { headers: { "Cache-Control": "public, max-age=60" } });
}
