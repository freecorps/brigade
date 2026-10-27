// Alert sources and routes in the dashboard (RFC 0005 "Alert sources"): the card's wording, a source's URL (made here
// and shown once, like a heartbeat's), what each provider needs pasted, and the route form's label syntax.

import { m } from "@freecorps/brigade-i18n";
import {
  ALERT_LABEL_KEY_MAX,
  ALERT_LABEL_VALUE_MAX,
  alertSourceToken,
  MAX_ROUTE_LABELS,
  newHeartbeatSecret,
  type AlertSourceKind,
  type RouteMatch,
} from "@freecorps/brigade-schema";

export type AlertsPart = Parameters<typeof m.alerts_card>[0]["part"];

/** The Alert sources card's wording (`alerts_card`). */
export function alertsText(part: AlertsPart, args: { name?: string; value?: string } = {}): string {
  return m.alerts_card({ part, name: args.name ?? "", value: args.value ?? "" });
}

/** SHA-256 of `text` in lower-case hex: what the shard keeps of a URL secret or a header value. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new source URL and the SHA-256 of its secret, the only part the shard stores. */
export async function newAlertSourceUrl(
  origin: string,
  workspaceId: string,
  sourceId: string,
  random: (length: number) => Uint8Array = (length) =>
    crypto.getRandomValues(new Uint8Array(length)),
): Promise<{ tokenHash: string; url: string }> {
  const secret = newHeartbeatSecret(random);
  // Through the dashboard's origin: its Worker forwards /api/* to the API Worker.
  const url = `${origin}/api/alerts/${alertSourceToken(workspaceId, sourceId, secret)}`;
  return { tokenHash: await sha256Hex(secret), url };
}

/**
 * The Datadog webhook payload Brigade reads: the monitor and the group (`alert_id`, `scope`) key the alert, so each
 * group of a multi-alert monitor is its own; `transition` says when it warned or recovered; `date` when it happened,
 * so a firing that starts after an early resolve still pages. Datadog fills each `$VARIABLE` in.
 */
export const DATADOG_PAYLOAD = `{
  "alert_id": "$ALERT_ID",
  "scope": "$ALERT_SCOPE",
  "transition": "$ALERT_TRANSITION",
  "title": "$EVENT_TITLE",
  "priority": "$ALERT_PRIORITY",
  "alert_type": "$ALERT_TYPE",
  "link": "$LINK",
  "tags": "$TAGS",
  "aggregate": "$AGGREG_KEY",
  "date": "$DATE"
}`;

/** A request to try a generic source with. */
export function genericExample(url: string): string {
  const body = JSON.stringify({
    title: "Disk almost full on web-1",
    dedup_key: "disk-web-1",
    severity: "high",
  });
  return `curl -fsS -X POST -H 'Content-Type: application/json' -d '${body}' ${url}`;
}

/** Which kinds sign their webhooks, and whether Brigade needs the secret. */
export function signing(kind: AlertSourceKind): "required" | "optional" | "none" {
  return kind === "sentry" ? "required" : kind === "grafana" ? "optional" : "none";
}

/** Header names the shard refuses for a source's secret (alertSource.create's `headerName`). */
export function headerNameProblem(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    !/^[A-Za-z0-9-]{1,64}$/.test(name) ||
    ["host", "content-type", "content-length", "cookie", "user-agent", "x-forwarded-for"].includes(
      lower,
    ) ||
    lower.startsWith("cf-") ||
    lower.startsWith("sentry-hook-")
  );
}

/**
 * The route form's labels: `key=value` pairs separated by commas, a key alone matching any value. Undefined when one
 * is not readable, or there are too many.
 */
export function parseLabels(text: string): RouteMatch["labels"] | undefined {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length > MAX_ROUTE_LABELS) return undefined;
  const labels: RouteMatch["labels"] = [];
  for (const part of parts) {
    const at = part.indexOf("=");
    const key = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase();
    const value = at < 0 ? "" : part.slice(at + 1).trim();
    if (key === "" || key.length > ALERT_LABEL_KEY_MAX || value.length > ALERT_LABEL_VALUE_MAX) {
      return undefined;
    }
    labels.push({ key, value });
  }
  return labels;
}

/** The labels back as the form writes them. */
export function formatLabels(labels: RouteMatch["labels"]): string {
  return labels.map((one) => (one.value === "" ? one.key : `${one.key}=${one.value}`)).join(", ");
}
