// The emails the notifier sends when paging fails (RFC 0005 "Email"), in each recipient's locale (RFC 0008): plain
// text and a simple HTML version of the same lines. Every line is rendered as text first and escaped as a whole
// when it goes into the HTML, so nothing a member typed (an incident's title, a workspace's or a person's name) can
// become markup; a header (the subject) gets it on one line.

import type { Locale } from "@freecorps/brigade-i18n";
import {
  email_invite,
  email_reminder,
  email_reminder_intro,
  email_reminder_more,
  email_reset,
  email_status,
  email_signup_attempt,
  email_text,
  email_verify,
  email_webhook_disabled,
  member_role,
  severity_named,
  severity_sev1,
  severity_sev2,
  severity_sev3,
  severity_sev4,
  status_text,
} from "@freecorps/brigade-i18n/messages";
import {
  formatIncidentNumber,
  type PageFailure,
  type Role,
  type Severity,
} from "@freecorps/brigade-schema";
import { singleLine, type OutgoingEmail } from "./email.ts";
import type { ReminderItem } from "./mailer.ts";
import type { StatusEmailContent } from "./status-mail.ts";

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
  "token_invalid",
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
  const facts = [
    // "INC-142 · SEV1 Critical": the severity by name here, once.
    text("fact_incident", {
      incident: [formatIncidentNumber(incident.number), severity].filter(Boolean).join(" · "),
    }),
    text("fact_title"),
  ];
  const after =
    content.about === "unpaged"
      ? content.reason === "no_devices" || content.reason === "token_invalid"
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

/**
 * An account email (verification, password reset, invitation): an optional greeting, paragraphs, one link as a
 * button-like anchor, then a footer. Every line is text, escaped as a whole in the HTML, like `renderEmail`.
 */
function renderMessage(
  parts: {
    subject: string;
    lines: string[];
    /** Items after the lines, as a list. */
    list?: string[];
    /** Absent: no link (the dashboard's origin is not configured). */
    link?: { label: string; url: string };
    after: string[];
    footer: string;
    /** Links under the footer (manage, unsubscribe). */
    footerLinks?: { label: string; url: string }[];
  },
  to: { email: string; name?: string },
  locale: Locale,
): OutgoingEmail {
  const { subject, lines, list = [], link, after, footer, footerLinks = [] } = parts;
  const textBody = [
    ...lines,
    ...(list.length ? [list.map((item) => `- ${item}`).join("\n")] : []),
    ...(link ? [`${link.label}: ${link.url}`] : []),
    ...after,
    "--",
    footer,
    ...footerLinks.map((one) => `${one.label}: ${one.url}`),
  ].join("\n\n");
  const paragraph = (line: string, style = "") =>
    `<p style="margin:0 0 16px${style}">${escapeHtml(line)}</p>`;
  const html = [
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(singleLine(subject))}</title></head>`,
    `<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#111">`,
    ...lines.map((line) => paragraph(line)),
    ...(list.length
      ? [
          `<ul style="margin:0 0 16px;padding-left:20px">${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`,
        ]
      : []),
    ...(link
      ? [
          `<p style="margin:0 0 16px"><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:#111;color:#fff;text-decoration:none">${escapeHtml(link.label)}</a></p>`,
        ]
      : []),
    ...after.map((line) => paragraph(line)),
    paragraph(footer, ";color:#666;font-size:13px"),
    ...(footerLinks.length
      ? [
          `<p style="margin:0 0 16px;color:#666;font-size:13px">${footerLinks
            .map(
              (one) =>
                `<a href="${escapeHtml(one.url)}" style="color:#666">${escapeHtml(one.label)}</a>`,
            )
            .join(" &nbsp; ")}</p>`,
        ]
      : []),
    "</body></html>",
  ].join("\n");
  return {
    to: to.name ? { email: to.email, name: singleLine(to.name) } : { email: to.email },
    subject: singleLine(subject),
    text: textBody,
    html,
  };
}

/**
 * The email that proves an address (RFC 0002 "Auth"): `url` is the dashboard's `/verify-email` page. Nothing in it is
 * what the person signing up typed except the address itself, as it goes to an address nobody proved yet.
 */
export function renderVerificationEmail(
  to: { email: string },
  url: string,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) => email_verify({ part, email: to.email }, { locale });
  return renderMessage(
    {
      subject: text("subject"),
      lines: [text("intro")],
      link: { label: text("open"), url },
      after: [text("expires")],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/**
 * The password reset email (RFC 0002 "Auth"): `url` is the dashboard's `/reset-password` page. Like the verification
 * email, nothing in it but the address: on an account nobody verified, whoever signed up typed the name.
 */
export function renderPasswordResetEmail(
  to: { email: string },
  url: string,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) => email_reset({ part, email: to.email }, { locale });
  return renderMessage(
    {
      subject: text("subject"),
      lines: [text("intro")],
      link: { label: text("open"), url },
      after: [text("expires")],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/**
 * The "someone tried to sign up with your address" notice (RFC 0002 "Auth"): a sign-up with a taken address answers
 * as for a new one, and the address's owner is told instead. `url` is the dashboard's sign-in page, whose "Forgot your
 * password?" link is the way back for an owner who lost the password. Nothing in it but the address.
 */
export function renderSignUpAttemptEmail(
  to: { email: string },
  url: string,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) => email_signup_attempt({ part, email: to.email }, { locale });
  return renderMessage(
    {
      subject: text("subject"),
      lines: [text("intro")],
      link: { label: text("open"), url },
      after: [text("reset")],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/**
 * The invitation email (RFC 0003 "Invitations"): who invited, to which workspace, as which role; `url` is the
 * dashboard's `/invitations/:id` page. The workspace's and inviter's names are what members typed.
 */
export function renderInvitationEmail(
  invitation: { inviter: string; workspace: string; role: Role },
  to: { email: string },
  url: string,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) =>
    email_invite(
      {
        part,
        inviter: invitation.inviter,
        workspace: invitation.workspace,
        role: member_role({ role: invitation.role }, { locale }),
      },
      { locale },
    );
  return renderMessage(
    {
      subject: text("subject"),
      lines: [text("intro"), text("how")],
      link: { label: text("open"), url },
      after: [text("expires")],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/**
 * The email that tells an owner Brigade turned a webhook endpoint off after its deliveries kept failing (RFC 0005
 * "Outbound webhooks"). `webhook` is the endpoint's description, or its host when it has none (never the path or
 * query, which may carry a token); the description and the workspace's name are what members typed.
 */
export function renderWebhookDisabledEmail(
  facts: { workspace: string; webhook: string; failures: number },
  to: { email: string; name?: string },
  url: string | undefined,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) =>
    email_webhook_disabled(
      { part, workspace: facts.workspace, webhook: facts.webhook, failures: facts.failures },
      { locale },
    );
  return renderMessage(
    {
      subject: text("subject"),
      lines: [text("intro"), text("how")],
      ...(url ? { link: { label: text("open"), url } } : {}),
      after: [],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/**
 * The daily reminder of a member's follow-ups due (RFC 0013 "Reminders"): each open follow-up due on `date` or before
 * it, with its incident, up to `REMINDER_MAX_LISTED` (the rest counted), and how to turn reminders off. Titles and the
 * workspace's name are what members typed. A due date is a calendar day, written in the recipient's language.
 */
export function renderReminderEmail(
  facts: { workspace: string; items: ReminderItem[]; total: number },
  to: { email: string; name?: string },
  url: string | undefined,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string, item?: ReminderItem) =>
    email_reminder(
      {
        part,
        workspace: facts.workspace,
        title: item?.title ?? "",
        incident: item
          ? [formatIncidentNumber(item.incidentNumber), item.incidentTitle]
              .filter(Boolean)
              .join(" ")
          : "",
        date: item ? calendarDay(item.dueDate, locale) : "",
      },
      { locale },
    );
  const more = facts.total - facts.items.length;
  return renderMessage(
    {
      subject: text("subject"),
      lines: [email_reminder_intro({ count: facts.total, workspace: facts.workspace }, { locale })],
      list: facts.items.map((item) => text(item.overdue ? "item_overdue" : "item", item)),
      ...(url ? { link: { label: text("open"), url } } : {}),
      after: [...(more > 0 ? [email_reminder_more({ count: more }, { locale })] : []), text("off")],
      footer: text("footer"),
    },
    to,
    locale,
  );
}

/** A calendar day (`YYYY-MM-DD`) as the locale writes it, never shifted by a time zone. */
function calendarDay(date: string, locale: Locale): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    Date.UTC(year, month - 1, day),
  );
}

/** The public page's links a status page email carries. */
export type StatusEmailLinks = { page: string; manage?: string; unsubscribe?: string };

const UTC_TIME = (locale: Locale, at: number) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at);

/**
 * The confirmation email of a status page subscription (RFC 0012 "Email subscriptions"): the one email an address
 * nobody proved yet gets. It names the page (what its owners typed) and nothing the visitor typed but the address.
 */
export function renderStatusConfirmEmail(
  page: string,
  to: { email: string },
  url: string,
  locale: Locale,
): OutgoingEmail {
  const text = (part: string) => statusText(part, { page }, locale);
  return {
    ...renderMessage(
      {
        subject: text("confirm_subject"),
        lines: [text("confirm_intro")],
        link: { label: text("confirm_open"), url },
        after: [text("confirm_after")],
        footer: text("confirm_footer"),
      },
      to,
      locale,
    ),
    headers: { "Auto-Submitted": "auto-generated", "Content-Language": locale },
  };
}

/**
 * A notification to a page's subscriber: an incident published, updated or resolved, or a maintenance window
 * scheduled, started, ended or called off, in the page's language. Every email links the page, its manage page and,
 * on an https origin, carries RFC 8058's one-click unsubscribe headers (Email Sending refuses an http one).
 */
export function renderStatusEmail(
  page: string,
  content: StatusEmailContent,
  to: { email: string },
  links: StatusEmailLinks,
  locale: Locale,
): OutgoingEmail {
  const facts = { page, title: content.title };
  const text = (part: string, extra: Record<string, string> = {}) =>
    statusText(part, { ...facts, ...extra }, locale);
  const lines: string[] = [];
  if ("status" in content) {
    lines.push(
      text("status", {
        status: status_text({ part: `public_${content.status}`, time: "", list: "" }, { locale }),
      }),
    );
  } else {
    const window = {
      time: UTC_TIME(locale, content.startsAt),
      until: UTC_TIME(locale, content.endsAt),
    };
    if (content.kind === "maintenance_started") lines.push(text("started", window));
    else if (content.kind === "maintenance_ended") lines.push(text("ended"));
    else if (content.kind === "maintenance_cancelled")
      lines.push(text("cancelled"), text("window", window));
    else lines.push(text("window", window));
  }
  if (content.components.length)
    lines.push(text("affects", { list: content.components.join(", ") }));
  // One paragraph per paragraph the team wrote, so its line breaks survive in the HTML too.
  if (content.body) lines.push(...content.body.split(/\n\s*\n|\n/).filter((line) => line.trim()));
  const footerLinks = [
    ...(links.manage ? [{ label: text("manage"), url: links.manage }] : []),
    ...(links.unsubscribe ? [{ label: text("unsubscribe"), url: links.unsubscribe }] : []),
  ];
  const headers: Record<string, string> = {
    "Auto-Submitted": "auto-generated",
    "Content-Language": locale,
  };
  if (links.unsubscribe?.startsWith("https://")) {
    headers["List-Unsubscribe"] = `<${links.unsubscribe}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    ...renderMessage(
      {
        subject: text(`${content.kind}_subject`),
        lines: [content.title, ...lines],
        link: { label: text("open"), url: links.page },
        after: [],
        footer: text("footer"),
        footerLinks,
      },
      to,
      locale,
    ),
    headers,
  };
}

function statusText(
  part: string,
  args: {
    page: string;
    title?: string;
    status?: string;
    time?: string;
    until?: string;
    list?: string;
  },
  locale: Locale,
): string {
  return email_status(
    {
      part,
      page: args.page,
      title: args.title ?? "",
      status: args.status ?? "",
      time: args.time ?? "",
      until: args.until ?? "",
      list: args.list ?? "",
    },
    { locale },
  );
}

/**
 * A page of the dashboard at `path` (with `search`, and `fragment` after the `#`), from `DASHBOARD_URL` when it is an
 * http(s) origin, else from `fallback` (the origin the request came through); undefined with neither.
 */
export function dashboardLink(
  path: string,
  search: Record<string, string>,
  dashboardUrl: string | undefined,
  fallback: string | null | undefined,
  fragment: Record<string, string> = {},
): string | undefined {
  for (const candidate of [dashboardUrl, fallback]) {
    if (!candidate) continue;
    let base: URL;
    try {
      base = new URL(candidate);
    } catch {
      continue;
    }
    if (base.protocol !== "https:" && base.protocol !== "http:") continue;
    const url = new URL(path, base.origin);
    for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
    const hash = new URLSearchParams(fragment).toString();
    if (hash) url.hash = hash;
    return url.href;
  }
  return undefined;
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
