// The public page's component list colours (RFC 0012 "The public page"): every status dot and label readable on the
// card, in both themes.
import type { StatusSnapshot } from "@freecorps/brigade-schema";
import { contrastRatio, themes, type ThemeName } from "@freecorps/brigade-ui";
import { describe, expect, test } from "vite-plus/test";
import { componentDots, renderStatusPage } from "../src/status-html.ts";

const STATUSES = [
  "operational",
  "degraded",
  "partial_outage",
  "major_outage",
  "maintenance",
] as const;
const THEMES: ThemeName[] = ["light", "dark"];

const snapshot: StatusSnapshot = {
  v: 2,
  title: "Acme",
  locale: "en",
  generatedAt: Date.UTC(2026, 9, 27),
  status: "major_outage",
  groups: [
    {
      name: null,
      components: [
        { name: "API", status: "major_outage" },
        { name: "Web", status: "operational" },
      ],
    },
  ],
  active: [],
  history: [],
  maintenance: [],
  upcoming: [],
};

describe("component list colours", () => {
  test.each(THEMES)("every status dot is at least 3:1 on the %s card", (theme) => {
    const dots = componentDots(theme);
    for (const status of STATUSES) {
      expect(contrastRatio(dots[status], themes[theme].card), status).toBeGreaterThanOrEqual(3);
    }
  });

  test.each(THEMES)("every status label is at least 4.5:1 on the %s card", (theme) => {
    const t = themes[theme];
    // Operational reads muted; anything else in the page's foreground, so trouble stands out.
    expect(contrastRatio(t.mutedForeground, t.card)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.foreground, t.card)).toBeGreaterThanOrEqual(4.5);
  });

  test("the list's dots use their own token, not the badge text colour", () => {
    const html = renderStatusPage(snapshot);
    for (const status of STATUSES) {
      expect(html).toContain(`.list .c-${status} .dot{color:var(--c-${status}-dot)}`);
      expect(html).not.toContain(`.list .c-${status} .dot{color:var(--c-${status}-fg)}`);
    }
    expect(html).toContain(`--c-major_outage-dot:${themes.light.severity.sev1.bg}`);
    expect(html).toContain(".list .chip:not(.c-operational){color:var(--fg)}");
  });
});
