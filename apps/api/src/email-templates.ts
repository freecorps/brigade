// The emails the notifier sends when paging fails (RFC 0005 "Email"), in each recipient's locale (RFC 0008): plain
// text and a simple HTML version of the same lines. Every line is rendered as text first and escaped as a whole
// when it goes into the HTML, so nothing a member typed (an incident's title, a workspace's or a person's name) can
// become markup; a header (the subject) gets it on one line.

import type { Locale } from "@freecorps/brigade-i18n";
import {
  email_text,
  severity_named,
  severity_sev1,
  severity_sev2,
  severity_sev3,
  severity_sev4,
} from "@freecorps/brigade-i18n/messages";
import { formatIncidentNumber, type PageFailure, type Severity } from "@freecorps/brigade-schema";
import { singleLine, type OutgoingEmail } from "./email.ts";

/** What an email says about the incident: all of it user content except the severity and number. */
export type EmailIncident = {
  id: string;
  number: number | null;
  title: string;
  severity: Severity;
};

/** Why a member's page did not reach them, as the unpaged email words it. */
export const UNPAGED_REASONS = [
  "no_devices",
  "undelivered",
  "unsupported",
  "not_configured",
  "over_limit",
] as const satisfies readonly PageFailure[];
export type UnpagedReason = (typeof UNPAGED_REASONS)[number];

export type EmailContent = { about: "unpaged"; reason: UnpagedReason } | { about: "nobody_paged" };

export type EmailContext = {
  incident: EmailIncident;
  /** The workspace's name. */
  workspace: string;
  /** The dashboard's origin (`DASHBOARD_URL`), for a link to the incident; no link without it. */
  dashboardUrl?: string;
};

const SEVERITY_NAMES = {
  sev1: severity_sev1,
  sev2: severity_sev2,
  sev3: severity_sev3,
  sev4: severity_sev4,
} as const;

/** One email for one recipient, in `locale`. */
export function renderEmail(
  content: EmailContent,
  context: EmailContext,
  to: { email: string; name?: string },
  locale: Locale,
): OutgoingEmail {
  const { incident } = context;
  // "SEV1 · INC-142", as the push says it: codes, the same in every locale.
  const code = [incident.severity.toUpperCase(), formatIncidentNumber(incident.number)]
    .filter(Boolean)
    .join(" · ");
  const severity = severity_named(
    {
      code: incident.severity.toUpperCase(),
      name: SEVERITY_NAMES[incident.severity]({}, { locale }),
    },
    { locale },
  );
  const text = (part: string, values: { reason?: string; incident?: string } = {}) =>
    email_text(
      {
        part,
        incident: values.incident ?? code,
        title: incident.title,
        workspace: context.workspace,
        reason: values.reason ?? "",
        url: "",
      },
      { locale },
    );
  const link = incidentLink(context);

  const subject = content.about === "unpaged" ? text("unpaged_subject") : text("nobody_subject");
  const intro =
    content.about === "unpaged"
      ? text("unpaged_intro", { reason: text(`unpaged_reason_${content.reason}`) })
      : text("nobody_intro");
  const facts = [text("fact_incident", { incident: `${code} (${severity})` }), text("fact_title")];
  const after =
    content.about === "unpaged"
      ? content.reason === "no_devices"
        ? [text("unpaged_hint")]
        : []
      : [text("nobody_timeline")];
  const footer = content.about === "unpaged" ? text("unpaged_footer") : text("nobody_footer");
  const open = text("open");

  const textBody = [
    intro,
    facts.join("\n"),
    ...(link ? [`${open}: ${link}`] : []),
    ...after,
    "--",
    footer,
  ].join("\n\n");
  const paragraph = (line: string, style = "") =>
    `<p style="margin:0 0 16px${style}">${escapeHtml(line)}</p>`;
  const html = [
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(singleLine(subject))}</title></head>`,
    `<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">`,
    paragraph(intro),
    `<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #c00;background:#f6f6f6">${facts.map(escapeHtml).join("<br>")}</p>`,
    ...(link
      ? [
          `<p style="margin:0 0 16px"><a href="${escapeHtml(link)}" style="color:#0645ad">${escapeHtml(open)}</a></p>`,
        ]
      : []),
    ...after.map((line) => paragraph(line)),
    paragraph(footer, ";color:#666;font-size:13px"),
    "</body></html>",
  ].join("\n");

  return {
    to: to.name ? { email: to.email, name: singleLine(to.name) } : { email: to.email },
    subject: singleLine(subject),
    text: textBody,
    html,
  };
}

/** The incident's page on the dashboard, when `DASHBOARD_URL` is an http(s) origin and the incident has a number. */
export function incidentLink({ dashboardUrl, incident }: EmailContext): string | undefined {
  if (!dashboardUrl || incident.number === null) return undefined;
  let base: URL;
  try {
    base = new URL(dashboardUrl);
  } catch {
    return undefined;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return undefined;
  return new URL(`/incidents/${incident.number}`, base.origin).href;
}

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text as HTML text or an attribute value: the five characters that can end either are escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char]!);
}
