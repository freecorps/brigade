// The status page's feeds (RFC 0012 "Feeds"): `GET /status/:slug/feed.atom` and `/feed.json`, built from the same
// sanitized snapshot in KV as the page and nothing else, so a feed reader learns no more than a visitor reads. One
// entry per published incident (open and from the last 90 days) and per maintenance window under way or upcoming.

import type { Locale } from "@freecorps/brigade-i18n";
import { status_maintenance, status_text } from "@freecorps/brigade-i18n/messages";
import type {
  SnapshotIncident,
  SnapshotMaintenance,
  StatusSnapshot,
} from "@freecorps/brigade-schema";
import { when } from "./status-html.ts";

export type FeedFormat = "atom" | "json";

/** Where the page and its feeds live, absolute: entries and readers need full addresses. */
export type FeedUrls = { page: string; atom: string; json: string };

export function feedUrls(origin: string, slug: string): FeedUrls {
  const page = `${origin}/status/${slug}`;
  return { page, atom: `${page}/feed.atom`, json: `${page}/feed.json` };
}

type Entry = {
  /** Stable while the item is on the page: the page's address and when the item began. */
  id: string;
  title: string;
  text: string;
  published: number;
  updated: number;
};

const say = (locale: Locale, part: string, args: { time?: string; list?: string } = {}) =>
  status_text({ part, time: args.time ?? "", list: args.list ?? "" }, { locale });

/**
 * An incident as plain text, newest update first: where it stands, what it affects and every update with its time, as
 * the page shows them. Plain text, so a reader renders nothing the page would not.
 */
function incidentEntry(locale: Locale, urls: FeedUrls, incident: SnapshotIncident): Entry {
  const lines: string[] = [say(locale, `public_${incident.status}`)];
  if (incident.components.length > 0) {
    lines.push(say(locale, "affects", { list: incident.components.join(", ") }));
  }
  for (const update of incident.updates) {
    lines.push(
      "",
      `${say(locale, `public_${update.status}`)} · ${say(locale, "update_at", { time: when(update.at, locale) })}`,
      update.body,
    );
  }
  return {
    id: `${urls.page}#incident-${incident.publishedAt}`,
    title: incident.title,
    text: lines.join("\n"),
    published: incident.publishedAt,
    // A correction or a removed update moves it too, so a reader replaces the text it kept.
    updated: incident.updatedAt ?? incident.updates[0]?.at ?? incident.publishedAt,
  };
}

/**
 * A window is dated when it was planned and last changed, never by its start: an upcoming one would otherwise sit in
 * the future. Its times are in the text. Older snapshots carry neither date, so it reads as of when they were built.
 */
function windowEntry(
  locale: Locale,
  urls: FeedUrls,
  window: SnapshotMaintenance,
  active: boolean,
  generatedAt: number,
): Entry {
  const range = status_maintenance(
    {
      part: active ? "window_active" : "window_upcoming",
      time: when(window.startsAt, locale),
      until: when(window.endsAt, locale),
    },
    { locale },
  );
  const lines: string[] = [range];
  if (window.outage) {
    const say = (part: string) => status_maintenance({ part, time: "", until: "" }, { locale });
    lines.push(`${say("outage")}: ${say("outage_hint")}`);
  }
  if (window.components.length > 0) {
    lines.push(say(locale, "affects", { list: window.components.join(", ") }));
  }
  lines.push("", window.body);
  return {
    id: `${urls.page}#maintenance-${window.startsAt}`,
    title: window.title,
    text: lines.join("\n"),
    published: window.publishedAt ?? Math.min(window.startsAt, generatedAt),
    updated: window.updatedAt ?? Math.min(window.startsAt, generatedAt),
  };
}

/** Open incidents, maintenance under way, upcoming maintenance, then the history: the page's order. */
function entries(snapshot: StatusSnapshot, urls: FeedUrls): Entry[] {
  const { locale, generatedAt } = snapshot;
  return [
    ...snapshot.active.map((incident) => incidentEntry(locale, urls, incident)),
    ...(snapshot.maintenance ?? []).map((window) =>
      windowEntry(locale, urls, window, true, generatedAt),
    ),
    ...(snapshot.upcoming ?? []).map((window) =>
      windowEntry(locale, urls, window, false, generatedAt),
    ),
    ...snapshot.history.map((incident) => incidentEntry(locale, urls, incident)),
  ];
}

const iso = (at: number) => new Date(at).toISOString();

/**
 * What XML 1.0 cannot carry, or should not: controls (but tab and newlines, kept by `xml`), lone surrogates (a pair is
 * one code point under `u`), U+FFFE and U+FFFF.
 */
const NOT_XML = /[\p{Cc}\p{Cs}\uFFFE\uFFFF]/gu;

/** Characters XML cannot carry dropped, the rest escaped. */
const xml = (text: string) =>
  text
    .replace(NOT_XML, (char) => (char === "\t" || char === "\n" || char === "\r" ? char : ""))
    .replace(
      /[&<>"']/g,
      (char) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] ?? char,
    );

/** The feed's own time: its newest entry's, or the snapshot's when it has none. */
function feedUpdated(snapshot: StatusSnapshot, list: readonly Entry[]): number {
  return list.length === 0 ? snapshot.generatedAt : Math.max(...list.map((entry) => entry.updated));
}

/** Atom (RFC 4287), every text as `type="text"`. */
export function renderAtomFeed(snapshot: StatusSnapshot, urls: FeedUrls): string {
  const list = entries(snapshot, urls);
  const items = list
    .map(
      (entry) =>
        `<entry><id>${xml(entry.id)}</id><title type="text">${xml(entry.title)}</title><link rel="alternate" type="text/html" href="${xml(urls.page)}"/><published>${iso(entry.published)}</published><updated>${iso(entry.updated)}</updated><content type="text">${xml(entry.text)}</content></entry>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(snapshot.locale)}">
<id>${xml(urls.page)}</id>
<title type="text">${xml(snapshot.title)}</title>
<updated>${iso(feedUpdated(snapshot, list))}</updated>
<author><name>${xml(snapshot.title)}</name></author>
<link rel="alternate" type="text/html" href="${xml(urls.page)}"/>
<link rel="self" type="application/atom+xml" href="${xml(urls.atom)}"/>
${items}
</feed>
`;
}

/** JSON Feed 1.1, every text as `content_text`. */
export function renderJsonFeed(snapshot: StatusSnapshot, urls: FeedUrls): string {
  const list = entries(snapshot, urls);
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: snapshot.title,
    home_page_url: urls.page,
    feed_url: urls.json,
    language: snapshot.locale,
    items: list.map((entry) => ({
      id: entry.id,
      url: urls.page,
      title: entry.title,
      content_text: entry.text,
      date_published: iso(entry.published),
      date_modified: iso(entry.updated),
    })),
  });
}
