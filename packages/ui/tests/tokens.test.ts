import { readFileSync } from "node:fs";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { themeCss, tokensCss } from "../src/css.ts";
import {
  SEVERITY_KEYS,
  STATUS_KEYS,
  contrastRatio,
  destructiveFill,
  themes,
  type ThemeColors,
} from "../src/index.ts";
import { VISIONS, deltaE, over, simulate } from "./color-vision.ts";

type Pair = [label: string, fg: string, bg: string];

const AA_TEXT = 4.5;
const NON_TEXT = 3; // WCAG 1.4.11: control boundaries, focus rings, chart marks
// A 1.5:1 luminance step reads as a different colour at a glance, whatever the hue.
const DISTINCT_LUMINANCE = 1.5;
// CIE76 ΔE: about 2.3 is just noticeable; 20 keeps categorical marks apart at a glance at chart sizes.
const DISTINCT_DELTA_E = 20;

const CHARTS = ["chart1", "chart2", "chart3", "chart4", "chart5"] as const;

const surfaces = (t: ThemeColors) =>
  [
    ["background", t.background],
    ["card", t.card],
    ["popover", t.popover],
  ] as const;

function textPairs(t: ThemeColors): Pair[] {
  const pairs: Pair[] = [
    ["foreground / background", t.foreground, t.background],
    ["card-foreground / card", t.cardForeground, t.card],
    ["popover-foreground / popover", t.popoverForeground, t.popover],
    ["muted-foreground / muted", t.mutedForeground, t.muted],
    ["primary-foreground / primary", t.primaryForeground, t.primary],
    ["secondary-foreground / secondary", t.secondaryForeground, t.secondary],
    ["accent-foreground / accent", t.accentForeground, t.accent],
    // Brigade extra, for full-opacity destructive fills only.
    ["destructive-foreground / destructive", t.destructiveForeground, t.destructive],
    ["sidebar-foreground / sidebar", t.sidebarForeground, t.sidebar],
    ["muted-foreground / sidebar", t.mutedForeground, t.sidebar],
    ["sidebar-primary-foreground / sidebar-primary", t.sidebarPrimaryForeground, t.sidebarPrimary],
    ["sidebar-accent-foreground / sidebar-accent", t.sidebarAccentForeground, t.sidebarAccent],
  ];
  // Colours that shadcn also uses as text on any surface (links, `text-destructive` errors).
  for (const [name, surface] of surfaces(t)) {
    pairs.push(
      [`muted-foreground / ${name}`, t.mutedForeground, surface],
      [`primary / ${name}`, t.primary, surface],
      [`accent-foreground / ${name}`, t.accentForeground, surface],
      [`destructive / ${name}`, t.destructive, surface],
    );
  }
  for (const k of SEVERITY_KEYS) pairs.push([k, t.severity[k].fg, t.severity[k].bg]);
  for (const k of STATUS_KEYS) pairs.push([`status ${k}`, t.status[k].fg, t.status[k].bg]);
  return pairs;
}

function nonTextPairs(t: ThemeColors): Pair[] {
  const pairs: Pair[] = [["sidebar-ring / sidebar", t.sidebarRing, t.sidebar]];
  // Restyled components draw focus with an opaque `ring-ring`, so it must hold on every surface.
  for (const [name, surface] of [...surfaces(t), ["muted", t.muted] as const]) {
    pairs.push([`ring / ${name}`, t.ring, surface]);
  }
  for (const [name, surface] of surfaces(t)) pairs.push([`input / ${name}`, t.input, surface]);
  for (const k of CHARTS) {
    pairs.push([`${k} / card`, t[k], t.card], [`${k} / background`, t[k], t.background]);
  }
  return pairs;
}

describe.each(["light", "dark"] as const)("%s theme", (name) => {
  const t: ThemeColors = themes[name];

  test.each(textPairs(t))("%s meets WCAG AA for text (4.5:1)", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(nonTextPairs(t))("%s meets WCAG 1.4.11 (3:1)", (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  test("badge prominence: SEV1 > SEV2 > SEV3 > SEV4, and SEV2 is louder than every status", () => {
    // Prominence is how far a badge's fill stands from the page ground.
    const away = (bg: string) => contrastRatio(bg, t.background);
    const [sev1, sev2, sev3, sev4] = SEVERITY_KEYS.map((k) => away(t.severity[k].bg));
    expect(sev1).toBeGreaterThan(sev2!);
    expect(sev2).toBeGreaterThan(sev3!);
    expect(sev3).toBeGreaterThan(sev4!);
    for (const k of STATUS_KEYS) expect(sev2, k).toBeGreaterThan(away(t.status[k].bg));
  });

  // Both are reds and hue alone fails for red-blind users, so they must differ in lightness as seen
  // with normal vision, protanopia and deuteranopia.
  test.each(VISIONS)("SEV1 and destructive stay apart with %s vision", (vision) => {
    const [sev1, destructive] = [t.severity.sev1.bg, t.destructive].map((c) => simulate(c, vision));
    expect(contrastRatio(sev1!, destructive!)).toBeGreaterThanOrEqual(DISTINCT_LUMINANCE);
  });

  // Destructive buttons and badges as drawn (README): the colour at the rest or hover alpha over
  // each surface, with destructiveFill.text on top.
  const drawn = surfaces(t).flatMap(([surface, base]) =>
    (["rest", "hover"] as const).map(
      (state) =>
        [
          `${state} on ${surface}`,
          over(t.destructive, destructiveFill[name][state], base),
        ] as const,
    ),
  );

  test.each(drawn)("destructive fill (%s) carries readable text", (_label, fill) => {
    expect(contrastRatio(destructiveFill[name].text, fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  test.each(VISIONS)("drawn destructive fills stay apart from SEV1 with %s vision", (vision) => {
    const sev1 = simulate(t.severity.sev1.bg, vision);
    for (const [label, fill] of drawn) {
      expect(contrastRatio(sev1, simulate(fill, vision)), label).toBeGreaterThanOrEqual(
        DISTINCT_LUMINANCE,
      );
    }
  });

  test.each(VISIONS)("chart colours are pairwise distinct with %s vision", (vision) => {
    const seen = CHARTS.map((k) => simulate(t[k], vision));
    for (let i = 0; i < seen.length; i++) {
      for (let j = i + 1; j < seen.length; j++) {
        expect(deltaE(seen[i]!, seen[j]!), `${CHARTS[i]} vs ${CHARTS[j]}`).toBeGreaterThanOrEqual(
          DISTINCT_DELTA_E,
        );
      }
    }
  });

  test.each(VISIONS)("no chart colour reads as the resolved status with %s vision", (vision) => {
    const resolved = simulate(t.status.resolved.fg, vision);
    for (const k of CHARTS) {
      expect(deltaE(simulate(t[k], vision), resolved), k).toBeGreaterThanOrEqual(DISTINCT_DELTA_E);
    }
  });
});

test("severities and statuses match packages/schema", () => {
  expect(SEVERITY_KEYS).toEqual(SEVERITIES);
  expect(STATUS_KEYS).toEqual(INCIDENT_STATUSES);
});

test("themes are frozen", () => {
  expect(Object.isFrozen(themes.light.severity.sev1)).toBe(true);
  expect(Object.isFrozen(themes.dark)).toBe(true);
});

test("contrast ratio matches known WCAG values", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
});

describe("shipped CSS", () => {
  const read = (file: string) =>
    readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  // Custom property names declared directly inside the first `<selector> {` block.
  function declared(css: string, selector: string): Set<string> {
    const start = css.indexOf(`\n${selector} {\n`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    const body = css.slice(start, css.indexOf("\n}", start));
    return new Set([...body.matchAll(/^ {2}--([\w-]+):/gm)].map((m) => m[1]!));
  }

  test("tokens.css and theme.css are in sync with tokens.ts (run `vp run generate`)", () => {
    expect(read("tokens.css")).toBe(tokensCss());
    expect(read("theme.css")).toBe(themeCss());
  });

  test("tokens.css: .dark redefines exactly the colours of :root", () => {
    const css = read("tokens.css");
    const root = declared(css, ":root");
    const rootColors = [...root].filter((n) => n !== "radius" && !n.startsWith("brigade-"));
    expect([...declared(css, ".dark")].sort()).toEqual(rootColors.sort());
    for (const v of ["background", "destructive", "ring", "chart-5", "sidebar-ring", "sev1-bg"]) {
      expect(root.has(v), v).toBe(true);
    }
  });

  test("theme.css maps every colour in tokens.css to a Tailwind colour", () => {
    const root = declared(read("tokens.css"), ":root");
    const theme = declared(read("theme.css"), "@theme inline");
    for (const v of root) {
      if (v === "radius" || v.startsWith("brigade-")) continue;
      const utility = `color-${v.replace(/-bg$/, "").replace(/-fg$/, "-foreground")}`;
      expect(theme.has(utility), utility).toBe(true);
    }
  });
});
