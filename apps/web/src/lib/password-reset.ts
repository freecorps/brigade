// Password reset for the dashboard (RFC 0002 "Auth"): asking for the email (`/forgot-password`) and setting the new
// password with its link (`/reset-password`), against Better Auth's routes on the same origin. Pure, so
// test/password-reset.test.tsx checks every answer.

/**
 * What asking for a reset email came to. `sent` is the answer for any address, with an account or not: the server
 * never says which. `rate_limited`: this address (or this network) asked too often; `not_configured`: the server
 * sends no email at all; `failed`: the network or the server failed.
 */
export type RequestOutcome = "sent" | "rate_limited" | "not_configured" | "failed";

/** `POST /api/auth/request-password-reset` for `email`. */
export async function requestPasswordReset(
  email: string,
  fetcher: typeof fetch = fetch,
): Promise<RequestOutcome> {
  let response: Response;
  try {
    response = await fetcher("/api/auth/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    return "failed";
  }
  if (response.ok) return "sent";
  if (response.status === 429) return "rate_limited";
  const body: unknown = await response.json().catch(() => null);
  return code(body) === "EMAIL_NOT_CONFIGURED" ? "not_configured" : "failed";
}

/**
 * What setting the new password came to. `invalid`: the link expired, was used already or is broken, and a new one
 * is needed; `too_short` / `too_long`: the server's length rule (the form checks it first); `rate_limited`;
 * `network`: the request never got an answer; `uncertain`: the server failed, possibly after it saved the password
 * (what a reset does after, signing devices out, can fail on its own), so the link may be used up already.
 */
export type ResetOutcome =
  | "done"
  | "invalid"
  | "too_short"
  | "too_long"
  | "rate_limited"
  | "network"
  | "uncertain";

/** `POST /api/auth/reset-password` with the link's token. */
export async function resetPassword(
  token: string,
  newPassword: string,
  fetcher: typeof fetch = fetch,
): Promise<ResetOutcome> {
  let response: Response;
  try {
    response = await fetcher("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
  } catch {
    return "network";
  }
  if (response.ok) return "done";
  if (response.status === 429) return "rate_limited";
  if (response.status >= 500) return "uncertain";
  const body: unknown = await response.json().catch(() => null);
  const refused = code(body);
  if (refused === "PASSWORD_TOO_SHORT") return "too_short";
  if (refused === "PASSWORD_TOO_LONG") return "too_long";
  return "invalid";
}

/** The reset link's token as the page reads it from `#token=`: Better Auth's are 24 characters, bounded here. */
export function resetToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

/** The token in a reset link's fragment (`token=…`, without the `#`), or undefined. */
export function resetTokenFromHash(hash: string): string | undefined {
  return resetToken(new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? undefined);
}

function code(body: unknown): unknown {
  return typeof body === "object" && body !== null ? Reflect.get(body, "code") : undefined;
}
