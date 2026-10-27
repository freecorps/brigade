// The public status page as HTML (RFC 0012 "The public page"): rendered by the Worker from the snapshot in KV, with
// no script, no session and nothing fetched after it, so it opens fast on a phone on a bad network and caches whole.
// Every piece of text is escaped; everything in the snapshot was written for the public.

import type { Locale } from "@freecorps/brigade-i18n";
import { status_text } from "@freecorps/brigade-i18n/messages";
import type {
  ComponentStatus,
  PublicStatus,
  SnapshotIncident,
  StatusSnapshot,
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
.hint{margin:-.5rem 0 .75rem}
footer{margin-top:2.5rem;color:var(--muted);font-size:.875rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem}
${COMPONENT_STATUSES.map((s) => `.c-${s}{background:var(--c-${s}-bg);color:var(--c-${s}-fg)}`).join("")}
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

const componentChip = (locale: Locale, status: ComponentStatus) =>
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

/** The page for a snapshot. */
export function renderStatusPage(snapshot: StatusSnapshot): string {
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
                  `<li><span class="name">${escape(component.name)}</span>${componentChip(locale, component.status)}</li>`,
              )
              .join("");
            return `${heading}<ul class="list">${rows}</ul>`;
          })
          .join("");
  const active =
    snapshot.active.length === 0
      ? ""
      : `<section aria-labelledby="active"><h2 id="active">${say(locale, "active_title")}</h2>${snapshot.active.map((incident) => activeIncident(locale, incident)).join("")}</section>`;
  const history =
    snapshot.history.length === 0
      ? `<p class="empty">${say(locale, "history_empty")}</p>`
      : snapshot.history.map((incident) => pastIncident(locale, incident)).join("");
  const body = `<h1>${escape(snapshot.title)}</h1>
<p class="banner c-${snapshot.status}" role="status"><span class="dot"></span>${say(locale, `overall_${snapshot.status}`)}</p>
${active}
<section aria-labelledby="components"><h2 id="components">${say(locale, "components_title")}</h2>${groups}</section>
<section aria-labelledby="history"><h2 id="history">${say(locale, "history_title")}</h2><p class="meta hint">${say(locale, "history_hint")}</p>${history}</section>
<footer><span>${say(locale, "updated", { time: when(snapshot.generatedAt, locale) })}</span><span>${say(locale, "powered")}</span></footer>`;
  return document(locale, `${escape(snapshot.title)} · ${say(locale, "*")}`, body);
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
