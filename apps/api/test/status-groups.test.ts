// A named group's header on the public page (RFC 0012 "The public page"): its name, the worst status of its
// components (maintenance only while nothing is worse) and its component count.
import type { SnapshotComponentStatus, StatusSnapshot } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { renderStatusPage } from "../src/status-html.ts";

const page = (groups: StatusSnapshot["groups"]): StatusSnapshot => ({
  v: 2,
  title: "Acme",
  locale: "en",
  generatedAt: Date.UTC(2026, 9, 27),
  status: "operational",
  groups,
  active: [],
  history: [],
  maintenance: [],
  upcoming: [],
});

const group = (name: string | null, ...statuses: SnapshotComponentStatus[]) => ({
  name,
  components: statuses.map((status, index) => ({ name: `Part ${index + 1}`, status })),
});

/** Each named group's header, as rendered. */
const headers = (html: string) => [...html.matchAll(/<summary>(.*?)<\/summary>/g)].map((m) => m[1]);

/** What a screen reader reads for a header: its text, tags dropped. */
const read = (header: string | undefined) =>
  (header ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("a named group's header", () => {
  test.each([
    ["all operational", ["operational", "operational"], "operational", "Operational"],
    ["one degraded", ["operational", "degraded"], "degraded", "Degraded performance"],
    [
      "one major outage among operational",
      ["operational", "major_outage", "operational"],
      "major_outage",
      "Major outage",
    ],
    ["under maintenance", ["maintenance", "operational"], "maintenance", "Under maintenance"],
    [
      "maintenance next to something worse",
      ["maintenance", "partial_outage"],
      "partial_outage",
      "Partial outage",
    ],
  ] as const)("%s: shows the worst status", (_, statuses, status, label) => {
    const html = renderStatusPage(page([group("GroceryOps", ...statuses)]));
    const [header] = headers(html);
    expect(header).toContain(
      `<span class="chip c-${status}"><span class="dot"></span>${label}</span>`,
    );
    // Name, then the status, then the count: what a screen reader reads, in that order.
    expect(read(header)).toBe(`GroceryOps ${label} ${statuses.length} components`);
  });

  test("a planned outage shows as a major outage in its group, while the banner says maintenance", () => {
    const html = renderStatusPage({
      ...page([group("Payments", "major_outage", "operational")]),
      maintenance: [
        {
          title: "Card network upgrade",
          body: "Payments are off while we switch.",
          components: ["Part 1"],
          startsAt: Date.UTC(2026, 9, 27, 1),
          endsAt: Date.UTC(2026, 9, 27, 3),
          outage: true,
        },
      ],
    });
    expect(read(headers(html)[0])).toBe("Payments Major outage 2 components");
    expect(html).toContain('<p class="banner c-maintenance" role="status">');
  });

  test("each group has its own status", () => {
    const html = renderStatusPage(
      page([group("GroceryOps", "major_outage", "operational"), group("Billing", "operational")]),
    );
    expect(headers(html).map(read)).toEqual([
      "GroceryOps Major outage 2 components",
      "Billing Operational 1 component",
    ]);
  });

  test("the ungrouped list has no header", () => {
    const html = renderStatusPage(page([group(null, "major_outage", "operational")]));
    expect(headers(html)).toEqual([]);
    expect(html).toContain(
      '<ul class="list"><li><span class="name">Part 1</span><span class="chip c-major_outage"><span class="dot"></span>Major outage</span></li>',
    );
  });

  test("in the visitor's language", () => {
    const html = renderStatusPage(page([group("GroceryOps", "degraded", "operational")]), {
      locale: "pt-BR",
    });
    expect(read(headers(html)[0])).toMatch(/^GroceryOps \S.* 2 componentes$/);
    expect(headers(html)[0]).toContain('class="chip c-degraded"');
  });

  test("the header's dot uses the status's own dot token", () => {
    const html = renderStatusPage(page([group("GroceryOps", "operational")]));
    for (const status of [
      "operational",
      "degraded",
      "partial_outage",
      "major_outage",
      "maintenance",
    ]) {
      expect(html).toContain(`.group>summary .c-${status} .dot{color:var(--c-${status}-dot)}`);
    }
  });
});
