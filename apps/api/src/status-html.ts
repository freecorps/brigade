// The public status page as HTML (RFC 0012 "The public page"): rendered by the Worker from the snapshot in KV, with
// no script, no session and nothing fetched after it, so it opens fast on a phone on a bad network and caches whole.
// Every piece of text is escaped; everything in the snapshot was written for the public.

import type { Locale } from "@freecorps/brigade-i18n";
import {
  status_group_count,
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

const saySubscribe = (
  locale: Locale,
  part: string,
  args: { email?: string; page?: string; list?: string } = {},
) =>
  escape(
    status_subscribe(
      {
        part,
        email: args.email ?? "",
        page: args.page ?? "",
        list: args.list ?? "",
      },
      { locale },
    ),
  );

const sayUptime = (
  locale: Locale,
  part: string,
  args: { percent?: string; date?: string; minutes?: string } = {},
) =>
  status_uptime(
    { part, percent: args.percent ?? "", date: args.date ?? "", minutes: args.minutes ?? "" },
    { locale },
  );

/**
 * A snapshot older than this is shown with "this page may be out of date": a public page is rebuilt at least once a
 * UTC day (`STATUS_REFRESH_MS`), so two days without one means its pushes are failing.
 */
export const STATUS_STALE_MS = 48 * 60 * 60 * 1000;

/** How a time reads: the date, the time and its zone's short name. The page's script uses it with the visitor's zone. */
const TIME_FORMAT = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
} as const;

/**
 * A time in UTC, the zone named ("Oct 27, 2026, 12:05 PM UTC"): what every visitor reads without script, and what the
 * feeds say. The Worker does not know the visitor's zone, and the page must stay one cached document for everyone.
 */
export const when = (at: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { ...TIME_FORMAT, timeZone: "UTC" }).format(at);

/**
 * A time on the page: UTC as its text, the instant in `datetime`, and `data-local` so `LOCAL_TIMES_SCRIPT` shows it in
 * the visitor's own zone (the UTC text then moves to its tooltip).
 */
const stamp = (at: number, locale: Locale) =>
  `<time datetime="${new Date(at).toISOString()}" data-local>${escape(when(at, locale))}</time>`;

/**
 * The page's one script (RFC 0012 "Local times"), allowed by its hash and nothing else: it rewrites each `<time
 * data-local>` in the visitor's zone, in the page's language, the UTC text kept as its tooltip. Without it, or where
 * it fails, the page reads exactly as before, in UTC. It reads nothing but the page and sends nothing anywhere, so the
 * cached document is the same for everyone. Changing a character changes `LOCAL_TIMES_SCRIPT_HASH` (tested).
 *
 * It also lets a tap name an uptime day where there is no hover (phones): tapping a bar marks it `tip`, which shows its
 * tooltip as hover does, and tapping anywhere else clears it. Without the script the bars still show and still have
 * their one text alternative.
 */
export const LOCAL_TIMES_SCRIPT = `document.querySelectorAll("time[data-local]").forEach(function(t){try{var f=new Intl.DateTimeFormat(document.documentElement.lang,${JSON.stringify(TIME_FORMAT)}),s=f.format(new Date(t.dateTime));if(s!==t.textContent){t.title=t.textContent;t.textContent=s}}catch(e){}});document.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest(".bars span");document.querySelectorAll(".bars .tip").forEach(function(o){if(o!==b)o.classList.remove("tip")});if(b)b.classList.toggle("tip")})`;

/** `script-src` for the page: the SHA-256 of `LOCAL_TIMES_SCRIPT`, base64. */
export const LOCAL_TIMES_SCRIPT_HASH = "sha256-21GvQ+7+HiGN5xMADGAAaTLbQIAnWEq35JcW6PBQwmQ=";

/**
 * A message with a time (or two) in it, as HTML: the message escaped, each time in its own `<time>`. The times go in as
 * markers first, since the message is escaped whole.
 */
const withTimes = (
  render: (args: { time: string; until: string }) => string,
  locale: Locale,
  times: { time?: number; until?: number },
) => {
  const marker = { time: "\uE000time\uE000", until: "\uE000until\uE000" };
  let html = escape(render(marker));
  for (const key of ["time", "until"] as const) {
    const at = times[key];
    if (at !== undefined) html = html.replace(marker[key], stamp(at, locale));
  }
  return html;
};

const sayAt = (locale: Locale, part: string, time: number) =>
  withTimes(({ time }) => status_text({ part, time, list: "" }, { locale }), locale, { time });

const sayWindowAt = (locale: Locale, part: string, times: { time?: number; until?: number }) =>
  withTimes(
    ({ time, until }) => status_maintenance({ part, time, until }, { locale }),
    locale,
    times,
  );

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
:root{${themeVars("light")};--u-up:#2f9e5b;--u-degraded:#d99a06;--u-down:#d63c2f;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{${themeVars("dark")};--u-up:#3ccf86;--u-degraded:#f2b929;--u-down:#f05a4b}}
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
.group{background:var(--card);border:1px solid var(--border);border-radius:.75rem;margin-bottom:.75rem;overflow:hidden}
.group>summary{display:flex;align-items:center;gap:.625rem;min-height:3rem;padding:.5rem 1rem;cursor:pointer;list-style:none;font-weight:600;-webkit-user-select:none;user-select:none}
.group>summary::-webkit-details-marker{display:none}
.group>summary::before{content:"";flex:none;width:.4375rem;height:.4375rem;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);margin:0 .25rem 0 .125rem;transition:transform 200ms cubic-bezier(.23,1,.32,1)}
.group[open]>summary::before{transform:rotate(45deg)}
.group>summary .count{margin-left:auto;color:var(--muted);font-size:.8125rem;font-weight:400;font-variant-numeric:tabular-nums}
.group>.list{border:0;border-top:1px solid var(--border);border-radius:0}
:root{interpolate-size:allow-keywords}
.group::details-content{height:0;overflow:clip;opacity:0;transition:height 260ms cubic-bezier(.23,1,.32,1),opacity 200ms ease-out,content-visibility 260ms allow-discrete}
.group[open]::details-content{height:auto;opacity:1}
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
.list li.with-bar{flex-wrap:wrap;padding-bottom:.875rem}
.list .chip{background:none;color:var(--muted);font-weight:500;padding:0}
.list .chip .dot{width:.5rem;height:.5rem}
${[...COMPONENT_STATUSES, "maintenance"].map((s) => `.list .c-${s} .dot{color:var(--c-${s}-fg)}`).join("")}
.uptime{flex-basis:100%;margin-top:.25rem}
.bars{display:flex;gap:2px;height:2.25rem}
.bars span{position:relative;flex:1;min-width:2px;border-radius:3px;background:var(--border);transform-origin:bottom;animation:rise 640ms cubic-bezier(.23,1,.32,1) backwards;animation-delay:calc(var(--i,0) * 6ms);transition:opacity 160ms ease-out,filter 160ms ease-out}
@keyframes rise{from{transform:scaleY(.12);opacity:0}}
.bars .u-up{background:var(--u-up)}
.bars .u-degraded{background:var(--u-degraded)}
.bars .u-down{background:var(--u-down)}
.bars .u-none{background:var(--border)}
.bars span::after{content:attr(data-tip);position:absolute;bottom:calc(100% + .5rem);left:50%;transform:translate(-50%,.25rem);opacity:0;pointer-events:none;z-index:1;white-space:nowrap;font-size:.75rem;font-weight:500;line-height:1.4;padding:.25rem .5rem;border-radius:.375rem;background:var(--fg);color:var(--bg);transition:opacity 120ms ease-out,transform 160ms cubic-bezier(.23,1,.32,1)}
.bars span:nth-child(-n+15)::after{left:0;transform:translate(0,.25rem)}
.bars span:nth-last-child(-n+15)::after{left:auto;right:0;transform:translate(0,.25rem)}
@media (hover:hover) and (pointer:fine){.bars:hover span{opacity:.45}.bars span:hover{opacity:1;filter:brightness(1.12)}.bars span:hover::after{opacity:1;transform:translate(-50%,0)}.bars span:nth-child(-n+15):hover::after,.bars span:nth-last-child(-n+15):hover::after{transform:translate(0,0)}}
.bars:has(.tip) span{opacity:.45}.bars span.tip{opacity:1}.bars span.tip::after{opacity:1;transform:translate(-50%,0)}.bars span.tip:nth-child(-n+15)::after,.bars span.tip:nth-last-child(-n+15)::after{transform:translate(0,0)}
@media (max-width:39.99rem){.bars span:nth-child(-n+75)::after{left:0;transform:translate(0,.25rem)}.bars span.tip:nth-child(-n+75)::after{transform:translate(0,0)}}
.scale{display:flex;justify-content:space-between;align-items:center;gap:.75rem;color:var(--muted);font-size:.75rem;margin-top:.375rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.scale::before,.scale::after{content:"";order:2;flex:1;height:1px;background:var(--border)}
.scale::after{order:4}
.scale .from{order:1}.scale .pct{order:3}.scale .to{order:5}
.scale .short{display:none}
@media (max-width:39.99rem){.bars span:nth-child(-n+60){display:none}.scale .long{display:none}.scale .short{display:inline}}
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
@media (prefers-reduced-motion:reduce){button{transition:none}.bars span{animation-name:fade}.group::details-content{transition-property:opacity,content-visibility}}
@keyframes fade{from{opacity:0}}
.hint{margin:-.5rem 0 .75rem}
.follow{flex-basis:100%;min-width:0}
.follow summary{display:flex;align-items:center;gap:.5rem;min-height:3rem;cursor:pointer;font-weight:600;font-size:.9375rem;list-style:none;-webkit-user-select:none;user-select:none}
.follow summary::-webkit-details-marker{display:none}
.follow summary::before{content:"";flex:none;width:.5rem;height:.5rem;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);margin:0 .25rem 0 .125rem}
.follow[open] summary::before{transform:rotate(45deg)}
.follow fieldset{border:0;margin:.75rem 0 0;padding:0;min-width:0}
.follow legend{padding:0;font-size:.8125rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;overflow-wrap:anywhere}
.follow .list{margin-top:.5rem}
.follow label{display:flex;align-items:flex-start;gap:.75rem;min-height:3rem;padding:.5rem 1rem;font-size:1rem;font-weight:400;overflow-wrap:anywhere;cursor:pointer}
.follow label.all{font-weight:600}
.follow .list label+label{border-top:1px solid var(--border)}
.follow label span{padding-top:.25rem}
.follow input[type=checkbox]{flex:none;width:1.25rem;height:1.25rem;margin:.4375rem 0 0;accent-color:var(--fg)}
.follow .meta{margin-top:0}
.choose{margin-top:1.5rem}
.choose h2{margin:0 0 .25rem}
.choose .follow summary{display:none}
.choose .follow>.meta{margin-top:.75rem}
.choose .buttons{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1rem}
button.secondary{color:var(--fg);background:transparent;border:1px solid var(--border)}
.notice{margin-top:1rem;font-weight:600}
.stale{margin-top:.75rem;padding:.75rem 1.25rem;border-radius:.75rem;font-size:.9375rem;overflow-wrap:anywhere}
.feeds{display:flex;flex-wrap:wrap;gap:1rem}
footer{margin-top:2.5rem;color:var(--muted);font-size:.875rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem}
${[...COMPONENT_STATUSES, "maintenance"].map((s) => `.c-${s}{background:var(--c-${s}-bg);color:var(--c-${s}-fg)}`).join("")}
${PUBLIC_STATUSES.map((s) => `.p-${s}{background:var(--p-${s}-bg);color:var(--p-${s}-fg)}`).join("")}
`;

function document(locale: Locale, title: string, body: string, head = "", script = false): string {
  return `<!doctype html>
<html lang="${escape(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${themes.light.background}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${themes.dark.background}" media="(prefers-color-scheme: dark)">
<title>${title}</title>
<style>${STYLE}</style>${head}
</head>
<body><main>${body}</main>${script ? `<script>${LOCAL_TIMES_SCRIPT}</script>` : ""}</body>
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
        `<li><p>${publicChip(locale, update.status)} <span class="meta">${sayAt(locale, "update_at", update.at)}</span></p><p class="body">${escape(update.body)}</p></li>`,
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
      : `<p class="meta">${sayAt(locale, "resolved_at", incident.resolvedAt)}</p>`;
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
  // Each day rises in turn (its index sets the delay) and names itself on hover; the role="img" label above is what
  // a screen reader hears, so the days stay out of the accessibility tree.
  const bars = uptime.days
    .map(
      (one, index) =>
        `<span class="u-${one.state}" style="--i:${index}" data-tip="${escape(describe(one.state, one.date, one.down))}"></span>`,
    )
    .join("");
  const share =
    uptime.percent === null
      ? sayUptime(locale, "no_data")
      : sayUptime(locale, "percent", {
          percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
            uptime.percent,
          ),
        });
  // Phones show the last 30 days (the CSS hides the rest), so the scale's start says so.
  return `<div class="uptime"><div class="bars" role="img" aria-label="${escape(label)}">${bars}</div><p class="scale" aria-hidden="true"><span class="from"><span class="long">${escape(sayUptime(locale, "start"))}</span><span class="short">${escape(sayUptime(locale, "start_short"))}</span></span><span class="pct">${escape(share)}</span><span class="to">${escape(sayUptime(locale, "end"))}</span></p></div>`;
}

function maintenanceWindow(locale: Locale, window: SnapshotMaintenance, active: boolean): string {
  const affects =
    window.components.length > 0
      ? `<p class="meta">${say(locale, "affects", { list: window.components.join(", ") })}</p>`
      : "";
  const range = active
    ? sayWindowAt(locale, "window_active", { until: window.endsAt })
    : sayWindowAt(locale, "window_upcoming", { time: window.startsAt, until: window.endsAt });
  // A planned outage says so whether it runs or is still to come: its components are down while it runs.
  const chip = window.outage
    ? `<span class="chip c-major_outage"><span class="dot"></span>${sayWindow(locale, "outage")}</span>`
    : active
      ? componentChip(locale, "maintenance")
      : "";
  const hint = window.outage ? `<p class="meta">${sayWindow(locale, "outage_hint")}</p>` : "";
  return `<article class="incident"><header><h3>${escape(window.title)}</h3>${chip}</header><p class="window">${range}</p>${affects}${hint}<p class="body">${escape(window.body)}</p></article>`;
}

/** What the page's form offers to follow, from its snapshot: each group with its key and its components'. */
export function followGroups(snapshot: Pick<StatusSnapshot, "groups">): FollowGroup[] {
  return snapshot.groups.flatMap((group) => {
    const components = group.components.flatMap((component) =>
      component.key ? [{ name: component.name, key: component.key }] : [],
    );
    return components.length === 0 ? [] : [{ name: group.name, key: group.key, components }];
  });
}

/** A group the subscribe form offers to follow: its components, and for a named group its own key too. */
export type FollowGroup = {
  name: string | null;
  key?: string;
  components: { name: string; key: string }[];
};

/**
 * The components and groups to follow, as checkboxes named `follow` (plain HTML, no script): each named group has one
 * for the whole group (including components added later) above its own. Folded behind `<details>` unless `open`.
 */
function followPicker(
  locale: Locale,
  groups: FollowGroup[],
  checked: ReadonlySet<string>,
  open: boolean,
): string {
  const box = (key: string, label: string, all = false) =>
    `<label${all ? ' class="all"' : ""}><input type="checkbox" name="follow" value="${escape(key)}"${checked.has(key) ? " checked" : ""}><span>${label}</span></label>`;
  const sets = groups
    .map((group) => {
      const legend =
        group.name === null ? saySubscribe(locale, "follow_ungrouped") : escape(group.name);
      const whole =
        group.name !== null && group.key
          ? box(group.key, saySubscribe(locale, "follow_group"), true)
          : "";
      const rows = group.components
        .map((component) => box(component.key, escape(component.name)))
        .join("");
      return `<fieldset><legend>${legend}</legend><div class="list">${whole}${rows}</div></fieldset>`;
    })
    .join("");
  return `<details class="follow"${open ? " open" : ""}><summary>${saySubscribe(locale, "follow_toggle")}</summary><p class="meta">${saySubscribe(locale, "follow_hint")}</p>${sets}</details>`;
}

function subscribeForm(locale: Locale, slug: string, groups: FollowGroup[]): string {
  const picker = groups.length > 0 ? followPicker(locale, groups, new Set(), false) : "";
  return `<section class="subscribe" aria-labelledby="subscribe"><h2 id="subscribe">${saySubscribe(locale, "form_title")}</h2><p class="meta">${saySubscribe(locale, "form_hint")}</p><form method="post" action="/status/${escape(slug)}/subscribe"><label for="subscribe-email">${saySubscribe(locale, "email_label")}</label><input id="subscribe-email" name="email" type="email" required maxlength="254" autocomplete="email" autocapitalize="none" spellcheck="false" enterkeyhint="send"><span class="trap" aria-hidden="true"><label for="subscribe-website">${saySubscribe(locale, "honeypot")}</label><input id="subscribe-website" name="website" type="text" tabindex="-1" autocomplete="off"></span>${picker}<button type="submit">${saySubscribe(locale, "submit")}</button></form></section>`;
}

/** The page's feeds (src/status-feed.ts), by address: the same snapshot as the page, nothing more. */
const feedPaths = (slug: string) => ({
  atom: `/status/${escape(slug)}/feed.atom`,
  json: `/status/${escape(slug)}/feed.json`,
});

/** `<link rel="alternate">` for each feed, so feed readers find them from the page's address. */
function feedAlternates(title: string, slug: string | undefined): string {
  if (!slug) return "";
  const paths = feedPaths(slug);
  return `
<link rel="alternate" type="application/atom+xml" title="${escape(title)}" href="${paths.atom}">
<link rel="alternate" type="application/feed+json" title="${escape(title)}" href="${paths.json}">`;
}

function feedLinks(locale: Locale, slug: string | undefined): string {
  if (!slug) return "";
  const paths = feedPaths(slug);
  return `<span class="feeds"><a href="${paths.atom}">${say(locale, "feed_atom")}</a><a href="${paths.json}">${say(locale, "feed_json")}</a></span>`;
}

/**
 * The page for a snapshot. `slug` and `subscribe` add the email form, which only shows where email can be sent (a page
 * read from an older snapshot shows it too: subscribing does not depend on the snapshot's version).
 */
export function renderStatusPage(
  snapshot: StatusSnapshot,
  options: { slug?: string; subscribe?: boolean; now?: number } = {},
): string {
  const { locale } = snapshot;
  // Rebuilt at least daily, so a snapshot this old means the shard or KV is stuck (decided, Q23): say so up top.
  const stale =
    (options.now ?? Date.now()) - snapshot.generatedAt > STATUS_STALE_MS
      ? `<p class="stale c-degraded" role="note">${sayAt(locale, "stale", snapshot.generatedAt)}</p>`
      : "";
  const groups =
    snapshot.groups.length === 0
      ? `<p class="empty">${say(locale, "components_empty")}</p>`
      : snapshot.groups
          .map((group) => {
            const rows = group.components
              .map(
                (component) =>
                  `<li${component.uptime ? ' class="with-bar"' : ""}><span class="name">${escape(component.name)}</span>${componentChip(locale, component.status)}${uptimeBar(locale, component)}</li>`,
              )
              .join("");
            if (group.name === null) return `<ul class="list">${rows}</ul>`;
            // A named group is a card that folds (no script: a details element), open to start with.
            const count = escape(
              status_group_count({ count: group.components.length }, { locale }),
            );
            return `<details class="group" open><summary><span class="name">${escape(group.name)}</span><span class="count">${count}</span></summary><ul class="list">${rows}</ul></details>`;
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
  const form =
    options.subscribe && options.slug
      ? subscribeForm(locale, options.slug, followGroups(snapshot))
      : "";
  const body = `<h1>${escape(snapshot.title)}</h1>
${banner}
${stale}
${inProgress}
${active}
<section aria-labelledby="components"><h2 id="components">${say(locale, "components_title")}</h2>${groups}</section>
${planned}
<section aria-labelledby="history"><h2 id="history">${say(locale, "history_title")}</h2><p class="meta hint">${say(locale, "history_hint")}</p>${history}</section>
${form}
<footer><span>${sayAt(locale, "updated", snapshot.generatedAt)}</span>${feedLinks(locale, options.slug)}<span>${say(locale, "powered")}</span></footer>`;
  return document(
    locale,
    `${escape(snapshot.title)} · ${say(locale, "*")}`,
    body,
    feedAlternates(snapshot.title, options.slug),
    true,
  );
}

/** What a subscription route shows (src/status-subscribers.ts). */
export type SubscriptionPage =
  | { kind: "check"; email: string }
  | { kind: "invalid" }
  | { kind: "limited" }
  | { kind: "confirm"; token: string }
  | { kind: "confirmed" }
  | { kind: "expired" }
  | {
      kind: "manage";
      token: string;
      email: string;
      /** What the page offers to follow now; empty when it is not public at this address. */
      groups: FollowGroup[];
      /** The keys followed, or null for everything. */
      follows: string[] | null;
      /** It followed only components no longer on the page, so it hears of everything. */
      gone: boolean;
      /** Just saved. */
      saved: boolean;
    }
  | { kind: "unsubscribed" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

/** A subscription route's page: the page's name, what happened and, to confirm or unsubscribe, one button. */
export function renderSubscriptionPage(
  view: SubscriptionPage,
  page: { title: string | null; locale: Locale; slug: string },
): string {
  const { locale, slug } = page;
  if (view.kind === "not_found" || view.kind === "unavailable") {
    return renderStatusMessage(view.kind === "unavailable" ? "unavailable" : "not_found", locale);
  }
  // A link whose page moved or is no longer public still works: it names the page by the address it was sent from,
  // and links back to none.
  const named = page.title !== null;
  const name = page.title ?? slug;
  const args = { page: name, email: "email" in view ? view.email : "" };
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
        ? `<form method="post" action="${base}/unsubscribe?t=${escape(encodeURIComponent(view.token))}"><button type="submit"${view.groups.length > 0 ? ' class="secondary"' : ""}>${saySubscribe(locale, "unsubscribe_button")}</button></form>`
        : "";
  const heading = saySubscribe(locale, title);
  const choose = view.kind === "manage" ? manageChoice(locale, base, view) : "";
  return document(
    locale,
    named ? `${heading} · ${escape(name)}` : heading,
    `${named ? `<p class="meta">${escape(name)}</p>` : ""}<h1>${heading}</h1><p>${saySubscribe(locale, text, args)}</p>${choose}<div class="actions">${button}${named ? `<a href="${base}">${saySubscribe(locale, "back")}</a>` : ""}</div>`,
  );
}

/**
 * The manage page's part on following: what the subscriber follows now and, while the page offers components, the
 * same checkboxes as the form (ticked as they are), "Save" and "Follow everything" (`scope=all`).
 */
function manageChoice(
  locale: Locale,
  base: string,
  view: Extract<SubscriptionPage, { kind: "manage" }>,
): string {
  const names = new Map<string, string>();
  for (const group of view.groups) {
    if (group.name !== null && group.key) names.set(group.key, group.name);
    for (const component of group.components) names.set(component.key, component.name);
  }
  const followed = (view.follows ?? []).flatMap((key) => names.get(key) ?? []);
  const now = view.gone
    ? saySubscribe(locale, "manage_gone")
    : view.follows === null
      ? saySubscribe(locale, "manage_all")
      : followed.length > 0
        ? saySubscribe(locale, "manage_some", {
            list: new Intl.ListFormat(locale, { type: "conjunction" }).format(followed),
          })
        : "";
  const saved = view.saved
    ? `<p class="notice" role="status">${saySubscribe(locale, "saved")}</p>`
    : "";
  const summary = `${now ? `<p class="meta">${now}</p>` : ""}${saved}`;
  if (view.groups.length === 0) {
    return `<section class="choose">${summary}${view.follows === null ? "" : `<p class="meta">${saySubscribe(locale, "manage_cant_choose")}</p>`}</section>`;
  }
  const action = `${base}/manage?t=${escape(encodeURIComponent(view.token))}`;
  return `<section class="choose" aria-labelledby="choose"><h2 id="choose">${saySubscribe(locale, "manage_choose")}</h2>${summary}<form method="post" action="${action}">${followPicker(locale, view.groups, new Set(view.follows ?? []), true)}<div class="buttons"><button type="submit" name="scope" value="some">${saySubscribe(locale, "follow_save")}</button><button type="submit" name="scope" value="all" class="secondary">${saySubscribe(locale, "follow_all_button")}</button></div></form></section>`;
}

/** No page at this address (or not public), or the snapshot could not be read. */
export function renderStatusMessage(
  kind: "not_found" | "unavailable" | "rate_limited",
  locale: Locale,
): string {
  const title = say(locale, `${kind}_title`);
  return document(
    locale,
    title,
    `<h1>${title}</h1><p class="empty">${say(locale, `${kind}_body`)}</p>`,
  );
}
