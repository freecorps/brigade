// The public status page as HTML (RFC 0012 "The public page"): rendered by the Worker from the snapshot in KV, with
// no script, no session and nothing fetched after it, so it opens fast on a phone on a bad network and caches whole.
// Every piece of text is escaped; everything in the snapshot was written for the public.

import type { Locale } from "@freecorps/brigade-i18n";
import {
  status_maintenance,
  status_subscribe,
  status_text,
  status_uptime,
} from "@freecorps/brigade-i18n/messages";
import type {
  ComponentStatus,
  PublicStatus,
  SnapshotComponent,
  SnapshotIncident,
  SnapshotMaintenance,
  StatusSnapshot,
  UptimeState,
} from "@freecorps/brigade-schema";
import { themes, type BadgeColors, type ThemeName } from "@freecorps/brigade-ui";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

const say = (locale: Locale, part: string, args: { time?: string; list?: string } = {}) =>
  escape(status_text({ part, time: args.time ?? "", list: args.list ?? "" }, { locale }));

const sayWindow = (locale: Locale, part: string, args: { time?: string; until?: string } = {}) =>
  escape(status_maintenance({ part, time: args.time ?? "", until: args.until ?? "" }, { locale }));

const saySubscribe = (locale: Locale, part: string, args: { email?: string; page?: string } = {}) =>
  escape(status_subscribe({ part, email: args.email ?? "", page: args.page ?? "" }, { locale }));

const sayUptime = (
  locale: Locale,
  part: string,
  args: { percent?: string; date?: string; minutes?: string } = {},
) =>
  status_uptime(
    { part, percent: args.percent ?? "", date: args.date ?? "", minutes: args.minutes ?? "" },
    { locale },
  );

/** Times in UTC, said so on the page: the Worker does not know the visitor's time zone, and no script asks. */
const when = (at: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(at);

/** A component status's colours, from the design tokens: green for working, then SEV3, SEV2, SEV1 tints. */
function componentColors(theme: ThemeName, status: ComponentStatus): BadgeColors {
  const t = themes[theme];
  if (status === "operational") return t.status.resolved;
  if (status === "degraded") return t.severity.sev3;
  if (status === "partial_outage") return t.severity.sev2;
  return t.severity.sev1;
}

function publicColors(theme: ThemeName, status: PublicStatus): BadgeColors {
  const t = themes[theme].status;
  if (status === "investigating") return t.investigating;
  if (status === "identified") return t.fixing;
  if (status === "monitoring") return t.monitoring;
  return t.resolved;
}

const COMPONENT_STATUSES: readonly ComponentStatus[] = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
];
const PUBLIC_STATUSES: readonly PublicStatus[] = [
  "investigating",
  "identified",
  "monitoring",
  "resolved",
];

/** One theme's custom properties, the badge colours included as `--c-<status>-bg` / `-fg`. */
function themeVars(theme: ThemeName): string {
  const t = themes[theme];
  const vars = [
    `--bg:${t.background}`,
    `--fg:${t.foreground}`,
    `--card:${t.card}`,
    `--muted:${t.mutedForeground}`,
    `--border:${t.border}`,
  ];
  for (const status of COMPONENT_STATUSES) {
    const { bg, fg } = componentColors(theme, status);
    vars.push(`--c-${status}-bg:${bg}`, `--c-${status}-fg:${fg}`);
  }
  for (const status of PUBLIC_STATUSES) {
    const { bg, fg } = publicColors(theme, status);
    vars.push(`--p-${status}-bg:${bg}`, `--p-${status}-fg:${fg}`);
  }
  // Maintenance reads as planned work, not trouble: the "monitoring" blue.
  const planned = t.status.monitoring;
  vars.push(`--c-maintenance-bg:${planned.bg}`, `--c-maintenance-fg:${planned.fg}`);
  return vars.join(";");
}

const STYLE = `
:root{${themeVars("light")};color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${themeVars("dark")}}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-tap-highlight-color:transparent}
main{max-width:44rem;margin:0 auto;padding:max(1.5rem,env(safe-area-inset-top)) max(1rem,env(safe-area-inset-right)) max(2rem,env(safe-area-inset-bottom)) max(1rem,env(safe-area-inset-left))}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 1.25rem;overflow-wrap:anywhere;text-wrap:balance}
h2{font-size:1rem;margin:2rem 0 .75rem}
h3{font-size:1rem;margin:0;overflow-wrap:anywhere}
p{margin:0}
.banner{display:flex;align-items:center;gap:.75rem;padding:1rem 1.25rem;border-radius:.75rem;font-weight:600;overflow-wrap:anywhere}
.dot{width:.625rem;height:.625rem;border-radius:999px;flex:none;background:currentColor}
.list{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--border);border-radius:.75rem}
.list li{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 1rem;min-height:3rem}
.list li+li{border-top:1px solid var(--border)}
.name{min-width:0;overflow-wrap:anywhere}
.group{font-size:.8125rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:1.25rem 0 .5rem}
.chip{display:inline-flex;align-items:center;gap:.375rem;flex:none;font-size:.8125rem;font-weight:600;padding:.125rem .5rem;border-radius:999px;white-space:nowrap}
.incident{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem;margin-bottom:.75rem}
.incident header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem}
.meta{color:var(--muted);font-size:.875rem;overflow-wrap:anywhere;margin-top:.25rem}
.updates{list-style:none;margin:.75rem 0 0;padding:0}
.updates li{padding:.75rem 0 0;border-top:1px solid var(--border);margin-top:.75rem}
.updates li:first-child{border-top:0;margin-top:0}
.body{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:.25rem}
details.incident summary{cursor:pointer;list-style:none}
details.incident summary::-webkit-details-marker{display:none}
.empty{color:var(--muted)}
.list li.with-bar{flex-wrap:wrap}
.uptime{flex-basis:100%;margin-top:.25rem}
.summary{color:var(--muted);font-size:.8125rem;margin:0 0 .375rem;font-variant-numeric:tabular-nums}
.bars{display:flex;gap:1px;height:2rem;align-items:stretch}
@media (min-width:40rem){.bars{gap:2px}}
.bars span{flex:1;min-width:1px;border-radius:2px;background:var(--border)}
.bars .u-up{background:var(--c-operational-fg)}
.bars .u-degraded{background:var(--c-degraded-fg)}
.bars .u-down{background:var(--c-major_outage-fg)}
.bars .u-none{background:var(--border)}
.scale{display:flex;justify-content:space-between;gap:.5rem;color:var(--muted);font-size:.75rem;margin-top:.25rem;white-space:nowrap}
.window{color:var(--muted);font-size:.875rem;margin-top:.25rem}
.subscribe{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem;margin-top:2rem}
.subscribe h2{margin:0 0 .25rem}
.subscribe form{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}
.subscribe label{flex-basis:100%;font-size:.875rem;font-weight:600}
input[type=email]{flex:1 1 14rem;min-width:0;min-height:3rem;font:inherit;font-size:16px;color:var(--fg);background:var(--bg);border:1px solid var(--border);border-radius:.5rem;padding:0 .75rem}
input[type=email]:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
button{min-height:3rem;padding:0 1.25rem;font:inherit;font-weight:600;color:var(--bg);background:var(--fg);border:0;border-radius:.5rem;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;transition:transform 120ms cubic-bezier(.23,1,.32,1)}
button:active{transform:scale(.97)}
.trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.actions{margin-top:1.5rem;display:flex;flex-wrap:wrap;align-items:center;gap:1rem}
a{color:inherit}
@media (prefers-reduced-motion:reduce){button{transition:none}}
.hint{margin:-.5rem 0 .75rem}
footer{margin-top:2.5rem;color:var(--muted);font-size:.875rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem}
${[...COMPONENT_STATUSES, "maintenance"].map((s) => `.c-${s}{background:var(--c-${s}-bg);color:var(--c-${s}-fg)}`).join("")}
${PUBLIC_STATUSES.map((s) => `.p-${s}{background:var(--p-${s}-bg);color:var(--p-${s}-fg)}`).join("")}
`;

function document(locale: Locale, title: string, body: string): string {
  return `<!doctype html>
<html lang="${escape(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${themes.light.background}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${themes.dark.background}" media="(prefers-color-scheme: dark)">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const componentChip = (locale: Locale, status: ComponentStatus | "maintenance") =>
  `<span class="chip c-${status}"><span class="dot"></span>${say(locale, `component_${status}`)}</span>`;

const publicChip = (locale: Locale, status: PublicStatus) =>
  `<span class="chip p-${status}">${say(locale, `public_${status}`)}</span>`;

function incidentBody(locale: Locale, incident: SnapshotIncident): string {
  const affects =
    incident.components.length > 0
      ? `<p class="meta">${say(locale, "affects", { list: incident.components.join(", ") })}</p>`
      : "";
  const updates = incident.updates
    .map(
      (update) =>
        `<li><p>${publicChip(locale, update.status)} <span class="meta"><time datetime="${new Date(update.at).toISOString()}">${say(locale, "update_at", { time: when(update.at, locale) })}</time></span></p><p class="body">${escape(update.body)}</p></li>`,
    )
    .join("");
  return `${affects}<ol class="updates">${updates}</ol>`;
}

function activeIncident(locale: Locale, incident: SnapshotIncident): string {
  return `<article class="incident"><header><h3>${escape(incident.title)}</h3>${publicChip(locale, incident.status)}</header>${incidentBody(locale, incident)}</article>`;
}

function pastIncident(locale: Locale, incident: SnapshotIncident): string {
  const resolved =
    incident.resolvedAt === null
      ? ""
      : `<p class="meta">${say(locale, "resolved_at", { time: when(incident.resolvedAt, locale) })}</p>`;
  return `<details class="incident"><summary><h3>${escape(incident.title)}</h3>${resolved}</summary>${incidentBody(locale, incident)}</details>`;
}

const DAY_FORMAT = { dateStyle: "medium", timeZone: "UTC" } as const;

/**
 * A component's uptime bar: 90 days as coloured bars (hidden from screen readers, each with its day as a tooltip) and
 * one text alternative that says the percentage and every day with downtime.
 */
function uptimeBar(locale: Locale, component: SnapshotComponent): string {
  const { uptime } = component;
  if (!uptime) return "";
  const day = (date: string) =>
    new Intl.DateTimeFormat(locale, DAY_FORMAT).format(new Date(`${date}T00:00:00Z`));
  const describe = (state: UptimeState, date: string, down: number) =>
    sayUptime(locale, `day_${state}`, { date: day(date), minutes: String(down) });
  const percent =
    uptime.percent === null
      ? sayUptime(locale, "no_data")
      : sayUptime(locale, "summary", {
          percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
            uptime.percent,
          ),
        });
  const bad = uptime.days.filter((one) => one.state === "degraded" || one.state === "down");
  const label = [
    `${component.name}: ${percent}`,
    ...bad.map((one) => describe(one.state, one.date, one.down)),
  ].join(". ");
  const bars = uptime.days
    .map(
      (one) =>
        `<span class="u-${one.state}" title="${escape(describe(one.state, one.date, one.down))}"></span>`,
    )
    .join("");
  return `<div class="uptime"><p class="summary" aria-hidden="true">${escape(percent)}</p><div class="bars" role="img" aria-label="${escape(label)}">${bars}</div><p class="scale" aria-hidden="true"><span>${escape(sayUptime(locale, "start"))}</span><span>${escape(sayUptime(locale, "end"))}</span></p></div>`;
}

function maintenanceWindow(locale: Locale, window: SnapshotMaintenance, active: boolean): string {
  const affects =
    window.components.length > 0
      ? `<p class="meta">${say(locale, "affects", { list: window.components.join(", ") })}</p>`
      : "";
  const range = active
    ? sayWindow(locale, "window_active", { until: when(window.endsAt, locale) })
    : sayWindow(locale, "window_upcoming", {
        time: when(window.startsAt, locale),
        until: when(window.endsAt, locale),
      });
  return `<article class="incident"><header><h3>${escape(window.title)}</h3>${active ? componentChip(locale, "maintenance") : ""}</header><p class="window"><time datetime="${new Date(window.startsAt).toISOString()}">${range}</time></p>${affects}<p class="body">${escape(window.body)}</p></article>`;
}

function subscribeForm(locale: Locale, slug: string): string {
  return `<section class="subscribe" aria-labelledby="subscribe"><h2 id="subscribe">${saySubscribe(locale, "form_title")}</h2><p class="meta">${saySubscribe(locale, "form_hint")}</p><form method="post" action="/status/${escape(slug)}/subscribe"><label for="subscribe-email">${saySubscribe(locale, "email_label")}</label><input id="subscribe-email" name="email" type="email" required maxlength="254" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="send"><span class="trap" aria-hidden="true"><label for="subscribe-website">${saySubscribe(locale, "honeypot")}</label><input id="subscribe-website" name="website" type="text" tabindex="-1" autocomplete="off"></span><button type="submit">${saySubscribe(locale, "submit")}</button></form></section>`;
}

/**
 * The page for a snapshot. `slug` and `subscribe` add the email form, which only shows where email can be sent (a page
 * read from an older snapshot shows it too: subscribing does not depend on the snapshot's version).
 */
export function renderStatusPage(
  snapshot: StatusSnapshot,
  options: { slug?: string; subscribe?: boolean } = {},
): string {
  const { locale } = snapshot;
  const groups =
    snapshot.groups.length === 0
      ? `<p class="empty">${say(locale, "components_empty")}</p>`
      : snapshot.groups
          .map((group) => {
            const heading =
              group.name === null ? "" : `<h3 class="group">${escape(group.name)}</h3>`;
            const rows = group.components
              .map(
                (component) =>
                  `<li${component.uptime ? ' class="with-bar"' : ""}><span class="name">${escape(component.name)}</span>${componentChip(locale, component.status)}${uptimeBar(locale, component)}</li>`,
              )
              .join("");
            return `${heading}<ul class="list">${rows}</ul>`;
          })
          .join("");
  const active =
    snapshot.active.length === 0
      ? ""
      : `<section aria-labelledby="active"><h2 id="active">${say(locale, "active_title")}</h2>${snapshot.active.map((incident) => activeIncident(locale, incident)).join("")}</section>`;
  const maintenance = snapshot.maintenance ?? [];
  const upcoming = snapshot.upcoming ?? [];
  const inProgress =
    maintenance.length === 0
      ? ""
      : `<section aria-labelledby="maintenance"><h2 id="maintenance">${sayWindow(locale, "active_title")}</h2>${maintenance.map((window) => maintenanceWindow(locale, window, true)).join("")}</section>`;
  const planned =
    upcoming.length === 0
      ? ""
      : `<section aria-labelledby="upcoming"><h2 id="upcoming">${sayWindow(locale, "upcoming_title")}</h2>${upcoming.map((window) => maintenanceWindow(locale, window, false)).join("")}</section>`;
  const history =
    snapshot.history.length === 0
      ? `<p class="empty">${say(locale, "history_empty")}</p>`
      : snapshot.history.map((incident) => pastIncident(locale, incident)).join("");
  // All operational while a window is under way: say maintenance, not "all systems operational".
  const banner =
    snapshot.status === "operational" && maintenance.length > 0
      ? `<p class="banner c-maintenance" role="status"><span class="dot"></span>${say(locale, "overall_maintenance")}</p>`
      : `<p class="banner c-${snapshot.status}" role="status"><span class="dot"></span>${say(locale, `overall_${snapshot.status}`)}</p>`;
  const form = options.subscribe && options.slug ? subscribeForm(locale, options.slug) : "";
  const body = `<h1>${escape(snapshot.title)}</h1>
${banner}
${inProgress}
${active}
<section aria-labelledby="components"><h2 id="components">${say(locale, "components_title")}</h2>${groups}</section>
${planned}
<section aria-labelledby="history"><h2 id="history">${say(locale, "history_title")}</h2><p class="meta hint">${say(locale, "history_hint")}</p>${history}</section>
${form}
<footer><span>${say(locale, "updated", { time: when(snapshot.generatedAt, locale) })}</span><span>${say(locale, "powered")}</span></footer>`;
  return document(locale, `${escape(snapshot.title)} · ${say(locale, "*")}`, body);
}

/** What a subscription route shows (src/status-subscribers.ts). */
export type SubscriptionPage =
  | { kind: "check"; email: string }
  | { kind: "invalid" }
  | { kind: "limited" }
  | { kind: "confirm"; token: string }
  | { kind: "confirmed" }
  | { kind: "expired" }
  | { kind: "manage"; token: string; email: string }
  | { kind: "unsubscribed" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** A subscription route's page: the page's name, what happened and, to confirm or unsubscribe, one button. */
export function renderSubscriptionPage(
  view: SubscriptionPage,
  page: { title: string | null; locale: Locale; slug: string },
): string {
  const { locale, slug } = page;
  if (view.kind === "not_found" || view.kind === "unavailable" || page.title === null) {
    return renderStatusMessage(view.kind === "unavailable" ? "unavailable" : "not_found", locale);
  }
  const args = { page: page.title, email: "email" in view ? view.email : "" };
  const parts: Record<SubscriptionPage["kind"], [string, string]> = {
    check: ["check_title", "check_body"],
    invalid: ["invalid_title", "invalid_body"],
    limited: ["limited_title", "limited_body"],
    confirm: ["confirm_title", "confirm_body"],
    confirmed: ["confirmed_title", "confirmed_body"],
    expired: ["expired_title", "expired_body"],
    manage: ["manage_title", "manage_body"],
    unsubscribed: ["unsubscribed_title", "unsubscribed_body"],
    not_found: ["", ""],
    unavailable: ["", ""],
  };
  const [title, text] = parts[view.kind];
  const base = `/status/${escape(slug)}`;
  const button =
    view.kind === "confirm"
      ? `<form method="post" action="${base}/confirm?t=${escape(encodeURIComponent(view.token))}"><button type="submit">${saySubscribe(locale, "confirm_button")}</button></form>`
      : view.kind === "manage"
        ? `<form method="post" action="${base}/unsubscribe?t=${escape(encodeURIComponent(view.token))}"><button type="submit">${saySubscribe(locale, "unsubscribe_button")}</button></form>`
        : "";
  const heading = saySubscribe(locale, title);
  return document(
    locale,
    `${heading} · ${escape(page.title)}`,
    `<p class="meta">${escape(page.title)}</p><h1>${heading}</h1><p>${saySubscribe(locale, text, args)}</p><div class="actions">${button}<a href="${base}">${saySubscribe(locale, "back")}</a></div>`,
  );
}

/** No page at this address (or not public), or the snapshot could not be read. */
export function renderStatusMessage(kind: "not_found" | "unavailable", locale: Locale): string {
  const title = say(locale, `${kind}_title`);
  return document(
    locale,
    title,
    `<h1>${title}</h1><p class="empty">${say(locale, `${kind}_body`)}</p>`,
  );
}
