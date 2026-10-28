// The public page's local times and its feeds (RFC 0012 "Local times", "Feeds"): rendered from a snapshot alone.
import type { StatusSnapshot } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { feedUrls, renderAtomFeed, renderJsonFeed } from "../src/status-feed.ts";
import {
  LOCAL_TIMES_SCRIPT,
  LOCAL_TIMES_SCRIPT_HASH,
  renderStatusPage,
} from "../src/status-html.ts";
import { statusPageHeaders } from "../src/status-route.ts";

const T = Date.UTC(2026, 9, 27, 12, 5);
const HOUR = 60 * 60 * 1000;

const snapshot = (patch: Partial<StatusSnapshot> = {}): StatusSnapshot => ({
  v: 2,
  title: "Acme & Co",
  locale: "en",
  generatedAt: T,
  status: "partial_outage",
  groups: [{ name: null, components: [{ name: "API", status: "partial_outage" }] }],
  active: [
    {
      title: "Slow <API> responses",
      status: "identified",
      impact: "partial_outage",
      components: ["API"],
      publishedAt: T - 2 * HOUR,
      resolvedAt: null,
      updates: [
        { at: T - HOUR, status: "identified", body: "Found it: a bad deploy." },
        { at: T - 2 * HOUR, status: "investigating", body: "Looking into it." },
      ],
    },
  ],
  history: [
    {
      title: "Login errors",
      status: "resolved",
      impact: "major_outage",
      components: [],
      publishedAt: T - 48 * HOUR,
      resolvedAt: T - 47 * HOUR,
      updates: [{ at: T - 47 * HOUR, status: "resolved", body: "Fixed." }],
    },
  ],
  maintenance: [],
  upcoming: [
    {
      title: "Database upgrade",
      body: "A short read-only window.",
      components: ["API"],
      startsAt: T + 24 * HOUR,
      endsAt: T + 26 * HOUR,
    },
  ],
  ...patch,
});

const urls = feedUrls("https://status.example.com", "acme");

describe("local times", () => {
  test("every time is a <time data-local> reading UTC, the script allowed by its hash alone", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(LOCAL_TIMES_SCRIPT),
    );
    const hash = `sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    expect(LOCAL_TIMES_SCRIPT_HASH).toBe(hash);
    const csp = statusPageHeaders(30).get("Content-Security-Policy")!;
    expect(csp).toContain(`script-src '${hash}'`);
    expect(csp).not.toContain("unsafe-inline'; script");
    expect(csp).toContain("default-src 'none'");

    const html = renderStatusPage(snapshot(), { slug: "acme" });
    expect(html).toContain(`<script>${LOCAL_TIMES_SCRIPT}</script>`);
    expect(html.match(/<script[\s>]/g) ?? []).toHaveLength(1);
    // UTC as the text, the instant in `datetime`: the page reads right without the script.
    expect(html).toContain(
      `<time datetime="${new Date(T).toISOString()}" data-local>Oct 27, 2026, 12:05 PM UTC</time>`,
    );
    // Both ends of a window, each its own time.
    expect(html).toContain(
      `<time datetime="${new Date(T + 24 * HOUR).toISOString()}" data-local>Oct 28, 2026, 12:05 PM UTC</time> to <time datetime="${new Date(T + 26 * HOUR).toISOString()}" data-local>Oct 28, 2026, 2:05 PM UTC</time>`,
    );
    expect(html).not.toContain("UTC UTC");
    // The script reads the page only: no request, no storage, no cookie.
    for (const call of ["fetch", "XMLHttpRequest", "cookie", "Storage", "src", "href"]) {
      expect(LOCAL_TIMES_SCRIPT).not.toContain(call);
    }
  });

  test("a pt-BR page says its times in pt-BR", () => {
    const html = renderStatusPage(snapshot({ locale: "pt-BR" }), { slug: "acme" });
    expect(html).toContain("Atualizado em <time");
    expect(html).toContain("27 de out. de 2026, 12:05 UTC</time>");
  });

  test("a snapshot older than 48 hours says the page may be out of date", () => {
    const fresh = renderStatusPage(snapshot(), { slug: "acme", now: T + 48 * HOUR });
    expect(fresh).not.toContain("may be out of date");
    const old = renderStatusPage(snapshot(), { slug: "acme", now: T + 48 * HOUR + 1 });
    expect(old).toContain(
      `This page may be out of date: it was last updated <time datetime="${new Date(T).toISOString()}" data-local>Oct 27, 2026, 12:05 PM UTC</time>.`,
    );
    const pt = renderStatusPage(snapshot({ locale: "pt-BR" }), { now: T + 72 * HOUR });
    expect(pt).toContain("Esta página pode estar desatualizada");
  });

  test("a planned outage says so on the page and in the feeds", () => {
    const planned = snapshot({
      upcoming: [
        {
          title: "Database move",
          body: "The API is off while we move.",
          components: ["API"],
          startsAt: T + 24 * HOUR,
          endsAt: T + 26 * HOUR,
          outage: true,
        },
      ],
    });
    const html = renderStatusPage(planned, { slug: "acme", now: T });
    expect(html).toContain(
      '<span class="chip c-major_outage"><span class="dot"></span>Planned outage</span>',
    );
    expect(html).toContain("The components it affects are down while it runs.");
    const feed = JSON.parse(renderJsonFeed(planned, urls));
    const entry = feed.items.find((item: { title: string }) => item.title === "Database move");
    expect(entry.content_text).toContain(
      "Planned outage: The components it affects are down while it runs.",
    );
    expect(renderAtomFeed(planned, urls)).toContain("Planned outage");
    // Plain maintenance says nothing of the kind.
    expect(renderStatusPage(snapshot(), { slug: "acme", now: T })).not.toContain("Planned outage");
  });

  test("the page links its feeds", () => {
    const html = renderStatusPage(snapshot(), { slug: "acme" });
    expect(html).toContain(
      '<link rel="alternate" type="application/atom+xml" title="Acme &amp; Co" href="/status/acme/feed.atom">',
    );
    expect(html).toContain(
      '<link rel="alternate" type="application/feed+json" title="Acme &amp; Co" href="/status/acme/feed.json">',
    );
    expect(html).toContain('<a href="/status/acme/feed.atom">Atom feed</a>');
  });
});

describe("feeds", () => {
  test("JSON Feed: open incidents, maintenance, then history, as plain text", () => {
    const feed = JSON.parse(renderJsonFeed(snapshot(), urls));
    expect(feed).toMatchObject({
      version: "https://jsonfeed.org/version/1.1",
      title: "Acme & Co",
      home_page_url: "https://status.example.com/status/acme",
      feed_url: "https://status.example.com/status/acme/feed.json",
      language: "en",
    });
    expect(feed.items.map((item: { title: string }) => item.title)).toEqual([
      "Slow <API> responses",
      "Database upgrade",
      "Login errors",
    ]);
    expect(feed.items[0]).toEqual({
      id: `https://status.example.com/status/acme#incident-${T - 2 * HOUR}`,
      url: "https://status.example.com/status/acme",
      title: "Slow <API> responses",
      content_text:
        "Identified\nAffects API\n\nIdentified · Oct 27, 2026, 11:05 AM UTC\nFound it: a bad deploy.\n\nInvestigating · Oct 27, 2026, 10:05 AM UTC\nLooking into it.",
      date_published: new Date(T - 2 * HOUR).toISOString(),
      date_modified: new Date(T - HOUR).toISOString(),
    });
    expect(feed.items[1].content_text).toContain(
      "Oct 28, 2026, 12:05 PM UTC to Oct 28, 2026, 2:05 PM UTC",
    );
  });

  test("Atom: escaped, valid XML characters only, in the page's language", () => {
    const xml = renderAtomFeed(
      snapshot({
        locale: "pt-BR",
        active: [{ ...snapshot().active[0]!, title: 'Erro <b>&\u0007 "x"' }],
      }),
      urls,
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('xml:lang="pt-BR"');
    expect(xml).toContain('<title type="text">Erro &lt;b&gt;&amp; &quot;x&quot;</title>');
    expect(xml).not.toContain("\u0007");
    expect(xml).toContain(
      '<link rel="self" type="application/atom+xml" href="https://status.example.com/status/acme/feed.atom"/>',
    );
    expect(xml).toContain(`<updated>${new Date(T - HOUR).toISOString()}</updated>`);
    expect(xml.match(/<entry>/g)).toHaveLength(3);
    expect(xml).toContain("Identificado");
  });

  test("an entry is dated by its last change: a correction moves it, a window's start never does", () => {
    const shown = snapshot({
      active: [{ ...snapshot().active[0]!, updatedAt: T - 30 * 60 * 1000 }],
      upcoming: [
        { ...snapshot().upcoming![0]!, publishedAt: T - 3 * HOUR, updatedAt: T - 2 * HOUR },
      ],
    });
    const items = JSON.parse(renderJsonFeed(shown, urls)).items;
    // The incident's newest update is an hour old; it was corrected since.
    expect(items[0].date_modified).toBe(new Date(T - 30 * 60 * 1000).toISOString());
    // Planned three hours ago, changed two hours ago, starting tomorrow: dated by the first two.
    expect(items[1].date_published).toBe(new Date(T - 3 * HOUR).toISOString());
    expect(items[1].date_modified).toBe(new Date(T - 2 * HOUR).toISOString());
    expect(items[1].content_text).toContain("Oct 28, 2026, 12:05 PM UTC");
    const feedUpdated = (xml: string) => /<\/title>\n<updated>([^<]+)<\/updated>/.exec(xml)![1];
    expect(feedUpdated(renderAtomFeed(shown, urls))).toBe(
      new Date(T - 30 * 60 * 1000).toISOString(),
    );
    // A snapshot from before the window carried its dates: as of when it was built, never in the future.
    const older = snapshot();
    const xml = renderAtomFeed(older, urls);
    expect(feedUpdated(xml)).toBe(new Date(T).toISOString());
    for (const [, at] of xml.matchAll(/<(?:published|updated)>([^<]+)</g)) {
      expect(Date.parse(at!)).toBeLessThanOrEqual(T);
    }
  });

  test("an empty page is an empty feed, dated by its snapshot", () => {
    const empty = snapshot({ active: [], history: [], upcoming: [], status: "operational" });
    expect(JSON.parse(renderJsonFeed(empty, urls)).items).toEqual([]);
    expect(renderAtomFeed(empty, urls)).toContain(
      `<updated>${new Date(T).toISOString()}</updated>`,
    );
  });

  test("a feed holds nothing the page does not show", () => {
    const shown = snapshot();
    const html = renderStatusPage(shown, { slug: "acme" });
    const feed = JSON.parse(renderJsonFeed(shown, urls));
    for (const item of feed.items as { title: string; content_text: string }[]) {
      const title = item.title.replace(
        /[<>&]/g,
        (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[char]!,
      );
      expect(html).toContain(title);
      for (const line of item.content_text.split("\n")) {
        if (line === "" || line.includes(" · ") || /UTC/.test(line)) continue;
        expect(html).toContain(line.replace(/&/g, "&amp;"));
      }
    }
  });
});
