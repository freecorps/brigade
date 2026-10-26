// Calls to Slack's Web API (RFC 0011). One function, so every call is bounded in time, never throws, and is classified
// the same way: a 429 carries Slack's `Retry-After`, a 5xx or a network failure may pass, and Slack's own `error`
// codes say whether retrying can help.

import type { SlackFailure } from "@freecorps/brigade-schema";

export type Fetch = (request: Request) => Promise<Response>;

/** Where the Web API lives; tests answer it with a fake `fetch`. */
export const SLACK_API = "https://slack.com/api/";
/** How long one call gets, unless the caller says less (the queue consumer does: pages wait behind it). */
export const SLACK_TIMEOUT_MS = 10_000;

export type SlackCall =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      /** Slack's `error` code, or `http_<status>`, `unreachable`, `invalid_response`. */
      error: string;
      retryable: boolean;
      /** From a 429's `Retry-After`. */
      retryAfterMs?: number;
    };

/** Slack errors that may pass on their own. */
const TRANSIENT = new Set([
  "ratelimited",
  "rate_limited",
  "internal_error",
  "fatal_error",
  "service_unavailable",
  "request_timeout",
]);

/**
 * `POST https://slack.com/api/<method>` with a JSON body (or a form, for `oauth.v2.access`), the token as a bearer
 * when given. Never throws.
 */
export async function callSlack(
  method: string,
  body: Record<string, unknown>,
  options: { token?: string; form?: boolean; fetch: Fetch; timeoutMs?: number },
): Promise<SlackCall> {
  const headers: Record<string, string> = options.form
    ? { "Content-Type": "application/x-www-form-urlencoded" }
    : { "Content-Type": "application/json; charset=utf-8" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const payload = options.form
    ? new URLSearchParams(
        // Forms carry only strings (`oauth.v2.access`, `auth.revoke`).
        Object.entries(body).flatMap(([key, value]) =>
          typeof value === "string" ? [[key, value]] : [],
        ),
      ).toString()
    : JSON.stringify(body);
  let response: Response;
  try {
    response = await options.fetch(
      new Request(`${SLACK_API}${method}`, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(options.timeoutMs ?? SLACK_TIMEOUT_MS),
      }),
    );
  } catch {
    return { ok: false, error: "unreachable", retryable: true };
  }
  if (response.status === 429) {
    await response.body?.cancel();
    const seconds = Number(response.headers.get("Retry-After"));
    return {
      ok: false,
      error: "ratelimited",
      retryable: true,
      ...(Number.isFinite(seconds) && seconds >= 0
        ? { retryAfterMs: Math.min(seconds, 3600) * 1000 }
        : {}),
    };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, error: `http_${response.status}`, retryable: response.status >= 500 };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: "invalid_response", retryable: true };
  }
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "invalid_response", retryable: true };
  }
  const record = data as Record<string, unknown>;
  if (record.ok === true) return { ok: true, data: record };
  const error = typeof record.error === "string" ? record.error.slice(0, 64) : "unknown_error";
  return { ok: false, error, retryable: TRANSIENT.has(error) };
}

/** Slack errors that mean the channel cannot take the bot's messages. */
const NO_CHANNEL = new Set(["channel_not_found", "not_in_channel", "is_archived", "is_inactive"]);
/** Slack errors that mean the token is no good, or lacks what this needs. */
const NOT_AUTHORIZED = new Set([
  "invalid_auth",
  "not_authed",
  "token_revoked",
  "token_expired",
  "account_inactive",
  "missing_scope",
  "no_permission",
  "team_access_not_granted",
  "ekm_access_denied",
  "token_unreadable",
]);

/** How a failed call reads on the incident's timeline (`slack_failed`). */
export function failureReason(error: string): SlackFailure {
  if (NO_CHANNEL.has(error)) return "no_channel";
  if (NOT_AUTHORIZED.has(error)) return "not_authorized";
  if (error === "ratelimited" || error === "rate_limited") return "rate_limited";
  return "undelivered";
}
