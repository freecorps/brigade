// Who may create an account on this instance (RFC 0002 "Auth", "Sign-up modes"): the `SIGNUP` variable, `closed` when
// unset and always `closed` without email (Q21); whether an account must verify its address before signing in
// (`REQUIRE_VERIFIED_EMAIL`, off by default); and the unauthenticated `GET /config` the dashboard and the mobile app
// read them from to hide the form.
//
// Kept free of Workers imports, like src/auth.ts: the database comes in as an argument.

import { emailConfigured, type EmailEnv } from "./email.ts";
import { BRIGADE_API_VERSION, MIN_APP_VERSION } from "./relay-instance.ts";

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

/** Whether `REQUIRE_VERIFIED_EMAIL` asks for it: `true`, `1`, `on` or `yes`, in any case. Anything else is off. */
export function verifiedEmailRequired(value: unknown): boolean {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return text === "true" || text === "1" || text === "on" || text === "yes";
}

/** The parts of the Worker's env that say who may sign up and sign in. */
export type AccessEnv = EmailEnv & { SIGNUP?: string; REQUIRE_VERIFIED_EMAIL?: string };

/**
 * Who may sign up and sign in on this instance, as it really runs:
 * - `signUp`: `SIGNUP`'s mode, but `closed` when no email sender is set up (`email` false), whatever `SIGNUP` says: nobody
 *   there could verify an address or reset a password (Q21). An invited address still gets in, as under `closed`.
 * - `configured`: what `SIGNUP` asked for, so `GET /config` can say it was closed for want of email.
 * - `requireVerifiedEmail`: `REQUIRE_VERIFIED_EMAIL`, only with email: without it no address could ever be verified,
 *   and every account but the first owner's would be locked out for good.
 */
export type InstanceAccess = {
  signUp: SignUpMode;
  configured: SignUpMode;
  email: boolean;
  requireVerifiedEmail: boolean;
};

/** What was already logged about settings email overrides, so each is said once per isolate, not per request. */
const told = new Set<string>();

export function instanceAccess(env: AccessEnv): InstanceAccess {
  const configured = signUpMode(env.SIGNUP);
  const email = emailConfigured(env);
  const asked = verifiedEmailRequired(env.REQUIRE_VERIFIED_EMAIL);
  if (!email && configured !== "closed") tell("sign-up", configured);
  if (!email && asked) tell("verification", "required");
  return {
    signUp: email ? configured : "closed",
    configured,
    email,
    requireVerifiedEmail: email && asked,
  };
}

function tell(setting: "sign-up" | "verification", value: string): void {
  if (told.has(setting)) return;
  told.add(setting);
  console.error(
    JSON.stringify({
      message:
        setting === "sign-up"
          ? "sign-up is closed: this instance has no email sender (EMAIL_FROM), whatever SIGNUP says"
          : "verified email before sign-in is off: this instance has no email sender (EMAIL_FROM)",
      [setting === "sign-up" ? "signUp" : "requireVerifiedEmail"]: value,
    }),
  );
}

/**
 * `GET /config`: what the clients need before anyone signs in. No session, nothing about any account or workspace;
 * cached a minute, as it only changes with a deploy. `signUp` is the mode in force; `signUpClosedBy: "no_email"` says
 * `SIGNUP` asked for more but the instance cannot send email; `requireVerifiedEmail` says sign-in waits for a verified
 * address. For the app (RFC 0015 sections 5 and 7): `brigade` (`api`, the version of what apps rely on, and
 * `minApp`, the oldest app version supported) and, when phones can be paged through the relay with handles, `relay`
 * (`origin`, where the app mints handles; `instance`, this instance's id there; `app`, the own app build's store link
 * when there is one). Nothing secret.
 */
export function serveConfig(
  request: Request,
  access: InstanceAccess,
  relay?: { origin: string; instance: string; app?: string },
): Response {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }
  return Response.json(
    {
      signUp: access.signUp,
      ...(access.signUp !== access.configured ? { signUpClosedBy: "no_email" } : {}),
      requireVerifiedEmail: access.requireVerifiedEmail,
      brigade: { api: BRIGADE_API_VERSION, minApp: MIN_APP_VERSION },
      ...(relay ? { relay } : {}),
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
