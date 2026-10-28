// Sign-in checks and error wording, shared by the web dashboard and the mobile app: what a form says before it
// sends, and what it says when Better Auth refuses. The server has the final say on every rule.
import { m } from "./paraglide/messages.js";

/** Better Auth's default limits for email and password accounts. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export type SignInField = "email" | "password";
export type FieldErrors<F extends string> = Partial<Record<F, string>>;

/** Loose on purpose: something@something.something. The server has the final say. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkEmail(email: string): string | undefined {
  if (email.trim() === "") return m.auth_error_required();
  return EMAIL.test(email.trim()) ? undefined : m.auth_error_email();
}

/** A new password: required and within Better Auth's length limits. */
export function checkPassword(password: string): string | undefined {
  if (password === "") return m.auth_error_required();
  if (password.length < PASSWORD_MIN) return m.auth_error_password_short();
  if (password.length > PASSWORD_MAX) return m.auth_error_password_long();
  return undefined;
}

export function checkSignIn(values: Record<SignInField, string>): FieldErrors<SignInField> {
  const errors: FieldErrors<SignInField> = {};
  const email = checkEmail(values.email);
  if (email) errors.email = email;
  if (values.password === "") errors.password = m.auth_error_required();
  return errors;
}

/**
 * Who may sign up on an instance (`GET /api/config`, RFC 0002 "Sign-up modes"): `open` shows the sign-up form;
 * `invite` shows it, saying only invited addresses get in; `closed` offers it only from an invitation's link.
 */
export type SignUpMode = "open" | "invite" | "closed";

/** The mode in a `GET /api/config` answer; anything unreadable is `closed`, as the server reads its own. */
export function readSignUpMode(config: unknown): SignUpMode {
  const mode: unknown = Reflect.get(Object(config), "signUp");
  return mode === "open" || mode === "invite" ? mode : "closed";
}

/** The shape Better Auth's client returns errors in (`{ status, code?, message? }`), or a thrown fetch error. */
export type AuthFailure = { status?: number; code?: string } | null | undefined;

/**
 * What to tell the user about a failed sign-in or sign-up. `after-sign-up`: the sign-in a form makes right after a
 * sign-up went through. A sign-up answers the same whether or not the address had an account (RFC 0002 "Auth"), so
 * a password that does not match there means the address was taken, and its owner was emailed.
 */
export function authErrorMessage(
  error: AuthFailure,
  during: "sign-in" | "sign-up" | "after-sign-up",
): string {
  const status = error?.status ?? 0;
  // Before the taken-address check: a server that requires verification refuses the new account's sign-in with this
  // code, which is not a sign of a taken address. Brigade signs unverified accounts in (RFC 0002 "Auth").
  if (during !== "sign-up" && error?.code === "EMAIL_NOT_VERIFIED") {
    return m.auth_error_email_not_verified();
  }
  if (
    during === "after-sign-up" &&
    (status === 401 || error?.code === "INVALID_EMAIL_OR_PASSWORD")
  ) {
    return m.account_flow({ part: "sign_up_taken", name: "" });
  }
  if (status === 0) return m.auth_error_network();
  // The instance's sign-up mode refused the address (RFC 0002 "Sign-up modes").
  if (during === "sign-up" && error?.code === "SIGN_UP_CLOSED")
    return m.auth_error_sign_up_closed();
  if (status === 429) return m.auth_error_rate_limited();
  if (during === "sign-in" && (status === 401 || error?.code === "INVALID_EMAIL_OR_PASSWORD")) {
    return m.auth_error_credentials();
  }
  if (during === "sign-up" && error?.code === "INVALID_NAME") return m.auth_name_invalid();
  if (during === "sign-up" && (status === 422 || error?.code?.startsWith("USER_ALREADY_EXISTS"))) {
    return m.auth_error_email_taken();
  }
  return m.auth_error_generic();
}
