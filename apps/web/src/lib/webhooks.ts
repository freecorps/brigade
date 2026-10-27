// The dashboard's side of outbound webhooks (RFC 0005 "Outbound webhooks"): the card's words, checking a draft and its
// custom headers the way the shard will, the event groups of the form, how an endpoint's state and last delivery read,
// which deliveries can be replayed, and the requests that need the server's key (`POST /api/workspaces/:id/webhooks`,
// `…/webhooks/:id/rotate`, `PUT …/webhooks/:id/headers`). Pure apart from `fetch`; tested in test/webhooks.test.tsx.
import { m } from "@freecorps/brigade-i18n";
import {
  isReservedWebhookHeader,
  MAX_WEBHOOK_HEADERS,
  newId,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_REPLAY_MAX_AGE_MS,
  webhookHeaderNameProblem,
  webhookHeaderValueProblem,
  webhookTargetProblem,
  type WebhookAttempt,
  type WebhookEventType,
  type WebhookHeader,
  type WebhookRow,
} from "@freecorps/brigade-schema";

/** The card's text for `part`, with the endpoint's host and a time filled in where it says so. */
export function webhookText(part: string, args: { host?: string; when?: string } = {}): string {
  return m.webhooks_card({ part, host: args.host ?? "", when: args.when ?? "" });
}

/** An event type as the form and the log name it. */
export function eventLabel(type: string): string {
  return m.webhook_event({ type });
}

/** The form's groups, in catalog order. */
export const EVENT_GROUPS: { part: string; types: WebhookEventType[] }[] = [
  {
    part: "group_incidents",
    types: WEBHOOK_EVENT_TYPES.filter((type) => type.startsWith("incident.")),
  },
  {
    part: "group_monitors",
    types: WEBHOOK_EVENT_TYPES.filter(
      (type) => type.startsWith("alert.") || type.startsWith("monitor."),
    ),
  },
  {
    part: "group_escalation",
    types: WEBHOOK_EVENT_TYPES.filter((type) => type.startsWith("escalation.")),
  },
];

export type WebhookDraft = { url: string; description: string; events: WebhookEventType[] };

/** A new endpoint's draft: every event, since most receivers want them all and filter themselves. */
export const emptyDraft = (): WebhookDraft => ({
  url: "",
  description: "",
  events: [...WEBHOOK_EVENT_TYPES],
});

export const draftOf = (row: WebhookRow): WebhookDraft => ({
  url: row.url,
  description: row.description,
  events: [...row.events],
});

export type DraftIssues = { url?: string; description?: string; events?: string };

/** The draft trimmed, or what is wrong with each field, as the shard would refuse it. */
export function checkDraft(
  draft: WebhookDraft,
): { ok: true; value: WebhookDraft } | { ok: false; issues: DraftIssues } {
  const url = draft.url.trim();
  const description = draft.description.trim();
  const issues: DraftIssues = {};
  if (url === "" || webhookTargetProblem(url) !== null) issues.url = webhookText("url_invalid");
  if (Array.from(description).length > WEBHOOK_DESCRIPTION_MAX) {
    issues.description = webhookText("description_invalid");
  }
  if (draft.events.length === 0) issues.events = webhookText("events_none");
  if (Object.keys(issues).length) return { ok: false, issues };
  const events = WEBHOOK_EVENT_TYPES.filter((type) => draft.events.includes(type));
  return { ok: true, value: { url, description, events } };
}

/** Whether `draft` says the same as `row` (an edit that changes nothing sends nothing). */
export function sameDraft(draft: WebhookDraft, row: WebhookRow): boolean {
  return (
    draft.url === row.url &&
    draft.description === row.description &&
    draft.events.length === row.events.length &&
    draft.events.every((type) => row.events.includes(type))
  );
}

/** The host an endpoint is named by when it has no description. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The endpoint's name on the card: its description, or its host. */
export function webhookName(row: Pick<WebhookRow, "url" | "description">): string {
  return row.description || hostOf(row.url);
}

/**
 * The URL as the row shows it: host and path, never the query or fragment, which often carry the receiver's token and
 * would be on screen whenever someone shares it.
 */
export function shownUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export type WebhookState = "on" | "off" | "failing";

export function webhookState(row: Pick<WebhookRow, "enabled" | "disabledReason">): WebhookState {
  if (row.enabled) return "on";
  return row.disabledReason === "failing" ? "failing" : "off";
}

/** Why an attempt failed (or its status when it did not), as the log says it. */
export function attemptResult(attempt: WebhookAttempt): string {
  if (attempt.ok) return String(attempt.status ?? "");
  return m.webhook_error({
    error: attempt.error ?? "status",
    status: attempt.status === null ? "" : String(attempt.status),
  });
}

// ---- Custom headers ----------------------------------------------------------------------------------------------

/** A custom header in the form. `kept`: one the endpoint has, whose value stays as it is while `value` is empty. */
export type HeaderDraft = { name: string; value: string; kept?: boolean };

export type HeaderIssue = { name?: string; value?: string };

/** The form's rows for an endpoint's headers: each one it has, its value left to keep. */
export const headerDrafts = (headers: readonly WebhookHeader[] = []): HeaderDraft[] =>
  headers.map(({ name }) => ({ name, value: "", kept: true }));

/**
 * The headers to send, or what is wrong with each row, as the API would refuse it. A row with neither a name nor a
 * value is left out; a kept one sent without a value keeps the one it has.
 */
export function checkHeaders(
  rows: readonly HeaderDraft[],
):
  | { ok: true; value: { name: string; value?: string }[] }
  | { ok: false; issues: Record<number, HeaderIssue> } {
  const issues: Record<number, HeaderIssue> = {};
  const value: { name: string; value?: string }[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const name = row.name.trim();
    const text = row.value.trim();
    if (name === "" && text === "" && !row.kept) return;
    const issue: HeaderIssue = {};
    if (webhookHeaderNameProblem(name) !== null) {
      issue.name = webhookText(
        isReservedWebhookHeader(name) ? "header_reserved" : "header_name_invalid",
      );
    } else if (seen.has(name.toLowerCase())) {
      issue.name = webhookText("header_duplicate");
    }
    seen.add(name.toLowerCase());
    if (text === "" && !row.kept) issue.value = webhookText("header_value_required");
    else if (text !== "" && webhookHeaderValueProblem(text) !== null) {
      issue.value = webhookText("header_value_invalid");
    }
    if (issue.name || issue.value) issues[index] = issue;
    else value.push(text === "" ? { name } : { name, value: text });
  });
  if (value.length > MAX_WEBHOOK_HEADERS) {
    issues[MAX_WEBHOOK_HEADERS] = { name: webhookText("headers_limit") };
  }
  return Object.keys(issues).length ? { ok: false, issues } : { ok: true, value };
}

/** How a header's value shows: never itself; its last 4 characters when the server kept them. */
export function headerValueShown(header: WebhookHeader): string {
  return header.hint === null
    ? webhookText("header_hidden")
    : webhookText("header_hint", { when: header.hint });
}

export type HeadersResult =
  | { ok: true; headers: WebhookHeader[] }
  | { ok: false; error: SecretRequestError; index?: number };

/**
 * `PUT /api/workspaces/:id/webhooks/:webhookId/headers`: every custom header, each value sealed by the server, which
 * answers only names and hints. Sent with an `Idempotency-Key`, and once more with it when the answer was lost.
 */
export async function requestHeaders(
  workspaceId: string,
  id: string,
  headers: { name: string; value?: string }[],
  fetcher: typeof fetch = fetch,
  key: string = crypto.randomUUID(),
): Promise<HeadersResult> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/webhooks/${encodeURIComponent(id)}/headers`;
  const put = async (): Promise<Response | undefined> => {
    try {
      return await fetcher(url, {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ headers }),
      });
    } catch {
      return undefined;
    }
  };
  let response = await put();
  if (response === undefined || response.status === 503) response = (await put()) ?? response;
  if (response === undefined) return { ok: false, error: "network" };
  const body = (await response.json().catch(() => ({}))) as {
    headers?: unknown;
    error?: unknown;
    issues?: { path?: unknown }[];
  };
  if (response.ok && Array.isArray(body.headers)) {
    return { ok: true, headers: body.headers as WebhookHeader[] };
  }
  const error = knownError(body.error);
  const path = Array.isArray(body.issues) ? body.issues[0]?.path : undefined;
  const index = typeof path === "string" ? /^headers\[(\d+)\]/.exec(path)?.[1] : undefined;
  return index === undefined ? { ok: false, error } : { ok: false, error, index: Number(index) };
}

// ---- Replay ------------------------------------------------------------------------------------------------------

/**
 * Whether the log's `attempt` gets a Replay button: the newest attempt of its event (one button per event), while the
 * shard still keeps the payload. The shard decides the rest (on, the rate limit).
 */
export function canReplay(
  attempts: readonly WebhookAttempt[],
  index: number,
  now: number,
): boolean {
  const attempt = attempts[index];
  if (!attempt) return false;
  if (attempts.findIndex((one) => one.eventId === attempt.eventId) !== index) return false;
  const first = Math.min(
    ...attempts.filter((one) => one.eventId === attempt.eventId).map((one) => one.at),
  );
  return now - first <= WEBHOOK_REPLAY_MAX_AGE_MS;
}

export type ReplayOutcome = "sent" | "too_soon" | "off" | "gone" | "failed";

/** What a refused `webhook.replay` means on the card. */
export function replayOutcome(code: string | undefined): ReplayOutcome {
  if (code === undefined) return "sent";
  if (code === "limit_reached") return "too_soon";
  if (code === "invalid_transition") return "off";
  if (code === "not_found") return "gone";
  return "failed";
}

/** A new endpoint id, made here as every id the dashboard sends is. */
export function newWebhookId(now = Date.now()): string {
  return newId("whk", now, (length) => crypto.getRandomValues(new Uint8Array(length)));
}

export type SecretRequestError =
  | "forbidden"
  | "not_a_member"
  | "not_configured"
  | "limit_reached"
  | "conflict"
  | "invalid_args"
  | "not_found"
  | "unavailable"
  | "network"
  | "internal";

export type SecretResult =
  | { ok: true; id: string; secret: string }
  | { ok: false; error: SecretRequestError; field?: "url" | "description" | "events" | "headers" };

const KNOWN_ERRORS: SecretRequestError[] = [
  "forbidden",
  "not_a_member",
  "not_configured",
  "limit_reached",
  "conflict",
  "invalid_args",
  "not_found",
  "unavailable",
];

const knownError = (code: unknown): SecretRequestError =>
  KNOWN_ERRORS.find((known) => known === code) ?? "internal";

/**
 * Creates an endpoint (`draft` given) or gives `id` a new secret: the server makes the secret and answers it once.
 * A field the shard refused comes back as `field`. Sent with an `Idempotency-Key`, and sent once more with the same
 * key when the first answer was lost (no connection, or the API could not reach the shard): the server answers the
 * first request's outcome and secret, so a rotation retried never rotates twice (which would cut the previous
 * secret's grace short).
 */
export async function requestSecret(
  workspaceId: string,
  id: string,
  draft: (WebhookDraft & { headers?: { name: string; value: string }[] }) | null,
  fetcher: typeof fetch = fetch,
  key: string = crypto.randomUUID(),
): Promise<SecretResult> {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/webhooks`;
  const post = async (): Promise<Response | undefined> => {
    try {
      return await fetcher(draft ? base : `${base}/${encodeURIComponent(id)}/rotate`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        ...(draft ? { body: JSON.stringify({ id, ...draft }) } : {}),
      });
    } catch {
      return undefined;
    }
  };
  let response = await post();
  // A 503 is `unavailable` (the shard may have run it) or `not_configured`, which only answers the same again.
  if (response === undefined || response.status === 503) response = (await post()) ?? response;
  if (response === undefined) return { ok: false, error: "network" };
  const body = (await response.json().catch(() => ({}))) as {
    secret?: unknown;
    error?: unknown;
    issues?: { path?: unknown }[];
  };
  if (response.ok && typeof body.secret === "string") return { ok: true, id, secret: body.secret };
  const error = knownError(body.error);
  const path = Array.isArray(body.issues) ? body.issues[0]?.path : undefined;
  const field =
    path === "url" || path === "description" || path === "events"
      ? path
      : typeof path === "string" && path.startsWith("headers")
        ? "headers"
        : undefined;
  return field ? { ok: false, error, field } : { ok: false, error };
}

/** How a refused create or rotation reads on the card. */
export function secretErrorPart(error: SecretRequestError): string {
  if (error === "not_configured") return "not_configured";
  if (error === "limit_reached") return "limit";
  if (error === "conflict") return "exists";
  if (error === "forbidden" || error === "not_a_member") return "manage_only";
  return "save_failed";
}
