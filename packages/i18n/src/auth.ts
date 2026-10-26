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

/** The shape Better Auth's client returns errors in (`{ status, code?, message? }`), or a thrown fetch error. */
export type AuthFailure = { status?: number; code?: string } | null | undefined;

/** What to tell the user about a failed sign-in or sign-up. */
export function authErrorMessage(error: AuthFailure, during: "sign-in" | "sign-up"): string {
  const status = error?.status ?? 0;
  if (status === 0) return m.auth_error_network();
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
