// Inbound alert payloads (RFC 0005 "Alert sources"): each provider's webhook body mapped to the alerts Brigade routes.
// Pure functions over the parsed body and the few headers a provider puts meaning in, so the shard, the tests and a
// future `packages/sdk` share them. Nothing here trusts the sender: every string is fitted to Brigade's text rules,
// every link must be http(s), and a body that yields no alert is `malformed`, never silently nothing.

import { textRules, trimSpace } from "./text.ts";

export const ALERT_SOURCE_KINDS = ["generic", "grafana", "datadog", "sentry"] as const;
export type AlertSourceKind = (typeof ALERT_SOURCE_KINDS)[number];

/** How urgent the sender says an alert is, before a route picks the incident's severity. */
export const ALERT_SEVERITIES = ["critical", "high", "warning", "info"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_TITLE_MAX = 200;
export const ALERT_KEY_MAX = 200;
export const ALERT_LINK_MAX = 2048;
export const ALERT_LABELS_MAX = 20;
export const ALERT_LABEL_KEY_MAX = 64;
export const ALERT_LABEL_VALUE_MAX = 200;
/** Alerts read from one payload (a Grafana group can carry many); the rest are left out and logged. */
export const MAX_ALERTS_PER_PAYLOAD = 50;

/** One alert as Brigade understands it, whatever sent it. */
export type NormalizedAlert = {
  /** Same key while firing: the same alert (a repeat), never a second incident. */
  dedupKey: string;
  title: string;
  severity: AlertSeverity;
  status: "firing" | "resolved";
  /** Where to look in the sender's tool; null when it gave no http(s) link. */
  link: string | null;
  labels: Record<string, string>;
};

/**
 * What a payload holds: alerts (`skipped`: left out past `MAX_ALERTS_PER_PAYLOAD`; `unreadable`: entries with no key
 * or no title, which the shard pages as one unreadable alert besides the rest); `ignored` for a well-formed delivery
 * that is no alert (Sentry's `installation` hook); or `malformed` with why, which the shard turns into an alert of its
 * own so nobody is left unpaged.
 */
export type Normalized =
  | { kind: "alerts"; alerts: NormalizedAlert[]; skipped: number; unreadable: number }
  | { kind: "ignored" }
  | { kind: "malformed"; reason: string };

/** Header names are given lower-cased. */
export type AlertHeaders = Readonly<Record<string, string>>;

// ---- Text --------------------------------------------------------------------------------------------------------

/**
 * Fits sender text to Brigade's text rules: hidden, control and bidi characters become spaces, runs of space
 * collapse, and it is cut to `max` UTF-16 code units (what the shard's validators count), never between the two
 * halves of a pair: 150 emoji fit a 200-unit title as 100. Undefined when nothing visible is left.
 */
export function fitText(raw: unknown, max: number): string | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) raw = String(raw);
  if (typeof raw !== "string") return undefined;
  // Bounded before any work: a megabyte of title is not read code point by code point.
  const input = raw.length > max * 4 ? raw.slice(0, max * 4) : raw;
  let out = "";
  let space = false;
  for (const char of input) {
    const hidden = textRules.problem(char, false) !== undefined;
    const blank = hidden || /\s/.test(char);
    if (blank) {
      space = out.length > 0;
      continue;
    }
    if (space) {
      // A space only with room for what follows it: a trailing one would be trimmed anyway.
      if (out.length + 1 + char.length > max) break;
      out += " ";
      space = false;
    }
    if (out.length + char.length > max) break;
    out += char;
  }
  out = trimSpace(out);
  return out.length > 0 && textRules.hasVisible(out) ? out : undefined;
}

/** FNV-1a over UTF-16 code units, twice with different offsets: 16 hex digits, enough to tell long keys apart. */
function keyHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    a = Math.imul(a ^ unit, 0x01000193);
    b = Math.imul(b ^ unit, 0x01000193);
  }
  return [a, b].map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}

/**
 * A dedup key: `prefix` and the sender's text, fitted after prefixing so it never passes `ALERT_KEY_MAX`. A key
 * that would is cut and ends in a hash of the whole, so two long keys that share their start stay two alerts.
 */
export function fitKey(prefix: string, raw: unknown): string | undefined {
  const text = fitText(raw, ALERT_KEY_MAX * 4);
  if (text === undefined) return undefined;
  const full = `${prefix}${text}`;
  if (full.length <= ALERT_KEY_MAX) return full;
  const tail = `#${keyHash(full)}`;
  return `${fitText(full, ALERT_KEY_MAX - tail.length) ?? ""}${tail}`;
}

/** The WHATWG URL parser (src has no DOM or Node types). */
const URL_PARSER = (
  globalThis as unknown as {
    URL: new (input: string) => {
      protocol: string;
      username: string;
      password: string;
      href: string;
    };
  }
).URL;

/** An absolute http(s) URL without credentials, or null: a link the dashboard can safely show. */
export function fitLink(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > ALERT_LINK_MAX) return null;
  let url: { protocol: string; username: string; password: string; href: string };
  try {
    url = new URL_PARSER(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return null;
  }
  const href = url.href;
  return href.length <= ALERT_LINK_MAX ? href : null;
}

/** Labels fitted like text; keys kept as given (lower-cased), at most `ALERT_LABELS_MAX`, first come first kept. */
export function fitLabels(entries: Iterable<[unknown, unknown]>): Record<string, string> {
  const labels: Record<string, string> = {};
  let count = 0;
  for (const [rawKey, rawValue] of entries) {
    if (count >= ALERT_LABELS_MAX) break;
    // Fitted again once lower-cased: lower case can be longer (U+0130 is one unit, its lower case two).
    const key = fitText(
      fitText(rawKey, ALERT_LABEL_KEY_MAX * 2)?.toLowerCase(),
      ALERT_LABEL_KEY_MAX,
    );
    const value = fitText(rawValue, ALERT_LABEL_VALUE_MAX);
    if (!key || value === undefined || Object.prototype.hasOwnProperty.call(labels, key)) continue;
    labels[key] = value;
    count++;
  }
  return labels;
}

/** A sender's word for severity, or undefined when it is not one Brigade knows. */
export function severityFrom(raw: unknown): AlertSeverity | undefined {
  if (typeof raw !== "string") return undefined;
  switch (raw.trim().toLowerCase()) {
    case "critical":
    case "crit":
    case "fatal":
    case "emergency":
    case "p1":
    case "sev1":
    case "page":
      return "critical";
    case "high":
    case "error":
    case "err":
    case "major":
    case "p2":
    case "sev2":
      return "high";
    case "warning":
    case "warn":
    case "medium":
    case "minor":
    case "p3":
    case "sev3":
      return "warning";
    case "info":
    case "low":
    case "debug":
    case "p4":
    case "p5":
    case "sev4":
      return "info";
    default:
      return undefined;
  }
}

/** A string field as text, else "" (never "[object Object]"). */
const word = (value: unknown): string =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : "";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function entries(value: unknown): [string, unknown][] {
  const object = record(value);
  return object ? Object.entries(object) : [];
}

const firstText = (max: number, ...values: unknown[]): string | undefined => {
  for (const value of values) {
    const text = fitText(value, max);
    if (text !== undefined) return text;
  }
  return undefined;
};

const firstKey = (prefix: string, ...values: unknown[]): string | undefined => {
  for (const value of values) {
    const key = fitKey(prefix, value);
    if (key !== undefined) return key;
  }
  return undefined;
};

/** Builds the alert, or undefined when it has no key or no title (the payload is then malformed). */
function alert(
  key: string | undefined,
  title: string | undefined,
  rest: Omit<NormalizedAlert, "dedupKey" | "title">,
): NormalizedAlert | undefined {
  if (key === undefined || title === undefined) return undefined;
  return { dedupKey: key, title, ...rest };
}

function collect(
  items: unknown[],
  map: (item: unknown) => NormalizedAlert | undefined,
): Normalized {
  const alerts: NormalizedAlert[] = [];
  let skipped = 0;
  let unreadable = 0;
  for (const item of items) {
    if (alerts.length >= MAX_ALERTS_PER_PAYLOAD) {
      skipped++;
      continue;
    }
    const one = map(item);
    if (one) alerts.push(one);
    else unreadable++;
  }
  return alerts.length > 0
    ? { kind: "alerts", alerts, skipped, unreadable }
    : { kind: "malformed", reason: items.length === 0 ? "no_alerts" : "unreadable_alerts" };
}

// ---- Providers ---------------------------------------------------------------------------------------------------

/**
 * Brigade's own shape: one alert, or `{ "alerts": [...] }`. `title` is required; `dedup_key` (or `fingerprint`, or
 * `id`) defaults to the title, so the same alert sent twice is one alert. `status` is `firing` (default) or
 * `resolved`; `severity` one of `ALERT_SEVERITIES` (or a common synonym), default `high`.
 */
function generic(body: unknown): Normalized {
  const root = record(body);
  if (!root) return { kind: "malformed", reason: "not_an_object" };
  const items = Array.isArray(root.alerts) ? root.alerts : [root];
  return collect(items, (item) => {
    const one = record(item);
    if (!one) return undefined;
    const title = firstText(ALERT_TITLE_MAX, one.title, one.summary, one.message);
    const status = (word(one.status) || "firing").toLowerCase();
    return alert(firstKey("", one.dedup_key, one.dedupKey, one.fingerprint, one.id, title), title, {
      severity: severityFrom(one.severity) ?? "high",
      status:
        status === "resolved" || status === "ok" || status === "recovered" ? "resolved" : "firing",
      link: fitLink(one.link ?? one.url),
      labels: fitLabels(entries(one.labels)),
    });
  });
}

/**
 * Grafana Alerting's webhook contact point (`version` "1"): one alert per entry of `alerts`, keyed by its
 * `fingerprint` (a hash of its labels). The title is the `summary` annotation, else `alertname`; the severity is the
 * `severity` label, default `high`; the link the panel, else the rule (`generatorURL`).
 */
function grafana(body: unknown): Normalized {
  const root = record(body);
  if (!root || !Array.isArray(root.alerts)) return { kind: "malformed", reason: "no_alerts" };
  return collect(root.alerts, (item) => {
    const one = record(item);
    if (!one) return undefined;
    const labels = record(one.labels) ?? {};
    const annotations = record(one.annotations) ?? {};
    const title = firstText(ALERT_TITLE_MAX, annotations.summary, labels.alertname, root.title);
    return alert(fitKey("", one.fingerprint), title, {
      severity: severityFrom(labels.severity) ?? "high",
      status: one.status === "resolved" ? "resolved" : "firing",
      link: fitLink(one.panelURL) ?? fitLink(one.dashboardURL) ?? fitLink(one.generatorURL),
      labels: fitLabels(Object.entries(labels)),
    });
  });
}

/**
 * The bracket Datadog starts a notification's title with: `[P1] [Triggered on {host:web-1}] CPU high`. Its priority,
 * transition and scope (the group of a multi-alert monitor), and the title after it.
 */
const DATADOG_TITLE =
  /^\s*(?:\[(P[1-5])\]\s*)?\[(Triggered|Re-Triggered|Recovered|Warn|Re-Warn|No Data|Re-No Data|Renotify)(?: on ([^\]]*))?\]\s*(.*)$/is;

/** A scope as one string, whichever form it came in: `{host:web-1, env:prod}` and `host:web-1,env:prod` alike. */
const scopeKey = (scope: string): string => scope.replace(/^\{|\}$/g, "").replace(/\s+/g, "");

/**
 * Datadog's webhook integration, with the payload Brigade's setup shows (`alert_id`, `scope`, `transition`, `title`,
 * `priority`, `alert_type`, `link`, `tags`, `aggregate`) or with Datadog's default payload (`id`, `title`, `body`).
 *
 * - **Key**: the monitor and the group (`$ALERT_ID` and `$ALERT_SCOPE`), so each group of a multi-alert monitor is its
 *   own alert; else `aggregate` (`$AGGREG_KEY`); else, for the default payload, the title without its bracket and
 *   the scope inside it, which Triggered and Recovered share; the event id (`$ID`, new on every notification) last.
 * - **Resolved** when the transition (`$ALERT_TRANSITION`, else the title's bracket) is Recovered, or with neither,
 *   when the alert type is `success`. Every other transition fires.
 * - **Severity**: a Warn transition (or a `warning` alert type) is `warning`, so a Warn that becomes Triggered under
 *   the same key raises it; else the priority (P1 to P5, else the title's), else the alert type.
 */
function datadog(body: unknown): Normalized {
  const root = record(body);
  if (!root) return { kind: "malformed", reason: "not_an_object" };
  return collect([root], (item) => {
    const one = record(item)!;
    const bracket = DATADOG_TITLE.exec(word(one.title));
    const transition = (word(one.transition) || bracket?.[2] || "").toLowerCase();
    const alertType = word(one.alert_type).toLowerCase();
    const resolved = transition === "recovered" || (transition === "" && alertType === "success");
    const warn =
      transition === "warn" ||
      transition === "re-warn" ||
      (transition === "" && alertType === "warning");
    const severity: AlertSeverity = warn
      ? "warning"
      : (severityFrom(one.priority) ??
        severityFrom(bracket?.[1]) ??
        (alertType === "info" || alertType === "success" ? "info" : "high"));
    const tags = typeof one.tags === "string" ? one.tags.split(",") : [];
    const labels = fitLabels(
      tags.map((tag): [string, string] => {
        const at = tag.indexOf(":");
        return at > 0 ? [tag.slice(0, at), tag.slice(at + 1)] : [tag, "true"];
      }),
    );
    const scope = scopeKey(word(one.scope) || bracket?.[3] || "");
    const monitor = word(one.alert_id).trim();
    const key =
      (monitor && fitKey("datadog:", `${monitor}:${scope}`)) ||
      fitKey("datadog:", one.aggregate) ||
      (bracket && fitKey("datadog:title:", `${scope}:${bracket[4]}`)) ||
      fitKey("datadog:", one.id);
    return alert(key, firstText(ALERT_TITLE_MAX, one.title), {
      severity,
      status: resolved ? "resolved" : "firing",
      link: fitLink(one.link),
      labels,
    });
  });
}

/**
 * Sentry's integration platform webhooks, told apart by the `sentry-hook-resource` header. `event_alert` (an issue
 * alert rule fired) is keyed by the issue, so every event of one issue is one alert; `metric_alert` by the metric
 * alert's id, `resolved` resolving it and `critical` or `warning` firing it; `issue` fires on `created` and
 * `unresolved` and resolves on `resolved`. `installation` and the other resources are no alerts (`ignored`).
 */
function sentry(body: unknown, headers: AlertHeaders): Normalized {
  const root = record(body);
  if (!root) return { kind: "malformed", reason: "not_an_object" };
  const data = record(root.data) ?? {};
  const resource = headers["sentry-hook-resource"] ?? "";
  const action = word(root.action);
  if (resource === "event_alert") {
    const event = record(data.event) ?? {};
    const tags = Array.isArray(event.tags)
      ? event.tags.flatMap((tag): [unknown, unknown][] =>
          Array.isArray(tag) && tag.length === 2 ? [[tag[0], tag[1]]] : [],
        )
      : [];
    return collect([event], () =>
      alert(
        fitKey("sentry:issue:", event.issue_id),
        firstText(ALERT_TITLE_MAX, event.title, data.triggered_rule),
        {
          severity: severityFrom(event.level) ?? "high",
          status: "firing",
          link: fitLink(event.web_url),
          labels: fitLabels(tags),
        },
      ),
    );
  }
  if (resource === "metric_alert") {
    const metric = record(data.metric_alert) ?? {};
    return collect([metric], () =>
      alert(
        fitKey("sentry:metric:", metric.id),
        firstText(ALERT_TITLE_MAX, data.description_title, metric.title),
        {
          severity: action === "warning" ? "warning" : "critical",
          status: action === "resolved" ? "resolved" : "firing",
          link: fitLink(data.web_url),
          labels: {},
        },
      ),
    );
  }
  if (resource === "issue") {
    if (!["created", "unresolved", "resolved"].includes(action)) return { kind: "ignored" };
    const issue = record(data.issue) ?? {};
    return collect([issue], () =>
      alert(fitKey("sentry:issue:", issue.id), firstText(ALERT_TITLE_MAX, issue.title), {
        severity: severityFrom(issue.level) ?? "high",
        status: action === "resolved" ? "resolved" : "firing",
        link: fitLink(issue.permalink ?? issue.web_url),
        labels: {},
      }),
    );
  }
  return resource ? { kind: "ignored" } : { kind: "malformed", reason: "no_resource" };
}

/** The alerts in a payload of `kind`, from its raw text. Never throws. */
export function normalizeAlerts(
  kind: AlertSourceKind,
  text: string,
  headers: AlertHeaders,
): Normalized {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { kind: "malformed", reason: "not_json" };
  }
  try {
    switch (kind) {
      case "generic":
        return generic(body);
      case "grafana":
        return grafana(body);
      case "datadog":
        return datadog(body);
      case "sentry":
        return sentry(body, headers);
    }
  } catch {
    // A shape no branch expected (a getter would be needed to throw on parsed JSON, but be safe).
    return { kind: "malformed", reason: "unreadable_alerts" };
  }
}
