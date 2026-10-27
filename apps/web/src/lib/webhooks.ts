// The dashboard's side of outbound webhooks (RFC 0005 "Outbound webhooks"): the card's words, checking a draft the way
// the shard will, the event groups of the form, how an endpoint's state and last delivery read, and the two requests
// that make a secret on the server (`POST /api/workspaces/:id/webhooks`, `…/webhooks/:id/rotate`). Pure apart from
// `fetch`; tested in test/webhooks.test.tsx.
import { m } from "@freecorps/brigade-i18n";
import {
  newId,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_EVENT_TYPES,
  webhookTargetProblem,
  type WebhookAttempt,
  type WebhookEventType,
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
  | { ok: false; error: SecretRequestError; field?: "url" | "description" | "events" };

/**
 * Creates an endpoint (`draft` given) or gives `id` a new secret: the server makes the secret and answers it once.
 * A field the shard refused comes back as `field`.
 */
export async function requestSecret(
  workspaceId: string,
  id: string,
  draft: WebhookDraft | null,
  fetcher: typeof fetch = fetch,
): Promise<SecretResult> {
  const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/webhooks`;
  let response: Response;
  try {
    response = await fetcher(draft ? base : `${base}/${encodeURIComponent(id)}/rotate`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...(draft ? { body: JSON.stringify({ id, ...draft }) } : {}),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body = (await response.json().catch(() => ({}))) as {
    secret?: unknown;
    error?: unknown;
    issues?: { path?: unknown }[];
  };
  if (response.ok && typeof body.secret === "string") return { ok: true, id, secret: body.secret };
  const known: SecretRequestError[] = [
    "forbidden",
    "not_a_member",
    "not_configured",
    "limit_reached",
    "conflict",
    "invalid_args",
    "not_found",
    "unavailable",
  ];
  const error = known.find((code) => code === body.error) ?? "internal";
  const path = Array.isArray(body.issues) ? body.issues[0]?.path : undefined;
  const field =
    path === "url" || path === "description" || path === "events" ? (path as "url") : undefined;
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
