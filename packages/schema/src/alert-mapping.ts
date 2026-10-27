// A source's title and severity mapping (RFC 0005 "Alert sources", "Mapping"): how the alerts it sends are named and
// how urgent they are, set by owners and admins per source. Pure and total: a template or a map that cannot be read
// (stored before a rule changed, or written by hand) falls back to what the sender said, so a mapping never keeps an
// alert from paging. No code runs: a template is literal text and `{field}` placeholders, nothing else.

import {
  ALERT_LABEL_KEY_MAX,
  ALERT_SEVERITIES,
  ALERT_TITLE_MAX,
  fitText,
  PROVIDER_SEVERITY_MAX,
  type AlertSeverity,
  type NormalizedAlert,
} from "./alert-normalize.ts";

/** The longest title template, and the most placeholders it may hold. */
export const TITLE_TEMPLATE_MAX = 200;
export const MAX_TEMPLATE_FIELDS = 10;
/** Severity rules per source, and the longest value one matches. */
export const MAX_SEVERITY_RULES = 20;
export const SEVERITY_VALUE_MAX = PROVIDER_SEVERITY_MAX;

/** Where the value a severity rule matches comes from: the sender's own word for it, or a label. */
export const SEVERITY_FIELDS = ["provider", "label"] as const;
export type SeverityField = (typeof SEVERITY_FIELDS)[number];

/**
 * How a source's alerts are named and how urgent they are. Null (or absent) on a source: as the sender said, which is
 * what every source did before mappings existed.
 */
export type AlertMapping = {
  /**
   * The title, from `{title}`, `{severity}` and `{labels.<key>}` placeholders and literal text; null: the alert's own
   * title. A label the alert lacks is empty; a title left with nothing visible is the alert's own.
   */
  titleTemplate: string | null;
  /** Null: the severity Brigade read from the payload. */
  severity: SeverityMapping | null;
};

export type SeverityMapping = {
  /** `provider`: the sender's word (Grafana's `severity` label, Datadog's priority, Sentry's level…); `label`: a label. */
  from: SeverityField;
  /** The label read when `from` is `label` (lower-cased, as labels are stored); null otherwise. */
  label: string | null;
  /** Tried in order; a value matches ignoring case and surrounding space. */
  rules: { value: string; severity: AlertSeverity }[];
  /** When no rule matches (or the value is missing); null: the severity Brigade read. */
  fallback: AlertSeverity | null;
};

/** One piece of a parsed template. */
export type TemplatePart =
  | { kind: "text"; text: string }
  | { kind: "title" }
  | { kind: "severity" }
  | { kind: "label"; key: string };

/** Why a template cannot be used, for the form to say. */
export type TemplateProblem = "unknown_field" | "unclosed" | "stray_brace" | "too_many_fields";

/**
 * A template's parts, or why it is refused. `{` opens a placeholder that `}` closes; braces have no other meaning, so a
 * lone `}` or a `{` never closed is refused rather than guessed at. Placeholders: `title`, `severity`, `labels.<key>`.
 */
export function parseTemplate(
  template: string,
): { ok: true; parts: TemplatePart[] } | { ok: false; problem: TemplateProblem } {
  const parts: TemplatePart[] = [];
  let fields = 0;
  let text = "";
  let at = 0;
  while (at < template.length) {
    const char = template[at]!;
    if (char === "}") return { ok: false, problem: "stray_brace" };
    if (char !== "{") {
      text += char;
      at++;
      continue;
    }
    const end = template.indexOf("}", at + 1);
    if (end < 0) return { ok: false, problem: "unclosed" };
    const name = template.slice(at + 1, end).trim();
    let part: TemplatePart;
    if (name === "title") part = { kind: "title" };
    else if (name === "severity") part = { kind: "severity" };
    else if (name.startsWith("labels.")) {
      const key = name.slice("labels.".length).trim().toLowerCase();
      if (key === "" || key.length > ALERT_LABEL_KEY_MAX || /[{}]/.test(key)) {
        return { ok: false, problem: "unknown_field" };
      }
      part = { kind: "label", key };
    } else return { ok: false, problem: "unknown_field" };
    if (++fields > MAX_TEMPLATE_FIELDS) return { ok: false, problem: "too_many_fields" };
    if (text) parts.push({ kind: "text", text });
    text = "";
    parts.push(part);
    at = end + 1;
  }
  if (text) parts.push({ kind: "text", text });
  return { ok: true, parts };
}

/** The severity a mapping gives `alert`: the first rule its value matches, else the fallback, else its own. */
export function mapSeverity(
  mapping: SeverityMapping | null | undefined,
  alert: Pick<NormalizedAlert, "severity" | "labels" | "providerSeverity">,
): AlertSeverity {
  if (!mapping) return alert.severity;
  const known = (value: unknown): value is AlertSeverity =>
    (ALERT_SEVERITIES as readonly unknown[]).includes(value);
  const raw =
    mapping.from === "label"
      ? mapping.label
        ? labelValue(alert.labels, mapping.label)
        : undefined
      : alert.providerSeverity;
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value !== "" && Array.isArray(mapping.rules)) {
    for (const rule of mapping.rules) {
      if (typeof rule?.value !== "string" || !known(rule.severity)) continue;
      if (rule.value.trim().toLowerCase() === value) return rule.severity;
    }
  }
  return known(mapping.fallback) ? mapping.fallback : alert.severity;
}

const labelValue = (labels: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : undefined;

/**
 * The title a template gives `alert` (with `severity`, the one the mapping gave it): fitted to Brigade's text rules
 * and `ALERT_TITLE_MAX`, so what a label holds can never make it too long or unreadable. A template that cannot be
 * parsed, or that leaves nothing visible, gives the alert's own title.
 */
export function renderTitle(
  template: string | null | undefined,
  alert: Pick<NormalizedAlert, "title" | "labels">,
  severity: AlertSeverity,
): string {
  if (typeof template !== "string" || template === "") return alert.title;
  const parsed = parseTemplate(template.slice(0, TITLE_TEMPLATE_MAX * 2));
  if (!parsed.ok) return alert.title;
  let out = "";
  for (const part of parsed.parts) {
    // Every piece is already bounded (titles and labels are fitted): ten 200-character labels make 2,000 at most.
    if (part.kind === "text") out += part.text;
    else if (part.kind === "title") out += alert.title;
    else if (part.kind === "severity") out += severity;
    else out += labelValue(alert.labels, part.key) ?? "";
  }
  return fitText(out, ALERT_TITLE_MAX) ?? alert.title;
}

/**
 * `alert` as `mapping` has it: its severity first (a template's `{severity}` is the mapped one), then its title.
 * Without a mapping, the alert as it came.
 */
export function applyMapping(
  mapping: AlertMapping | null | undefined,
  alert: NormalizedAlert,
): NormalizedAlert {
  if (!mapping) return alert;
  const severity = mapSeverity(mapping.severity, alert);
  const title = renderTitle(mapping.titleTemplate, alert, severity);
  return severity === alert.severity && title === alert.title
    ? alert
    : { ...alert, severity, title };
}
