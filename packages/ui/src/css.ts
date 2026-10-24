// Builds the shipped CSS from the tokens. Internal: `scripts/generate-css.ts` writes the output to
// `src/tokens.css` and `src/theme.css`, and a test fails if those files drift from this.

import {
  SEVERITY_KEYS,
  SHADCN_COLOR_KEYS,
  STATUS_KEYS,
  fontFamily,
  fontSize,
  fontWeight,
  motion,
  radius,
  spacing,
  themes,
  type ThemeColors,
} from "./tokens.ts";

const HEADER =
  "/* Generated from src/tokens.ts by scripts/generate-css.ts. Do not edit by hand. */";

type Vars = [name: string, value: string | number][];

// `cardForeground` -> `card-foreground`, `chart1` -> `chart-1`.
const kebab = (s: string) => s.replace(/[A-Z]|\d+/g, (m) => `-${m.toLowerCase()}`);
const rem = (px: number) => (px === 0 ? "0" : `${px / 16}rem`);
const bezier = (p: readonly number[]) => `cubic-bezier(${p.join(", ")})`;

/** Every colour variable of a theme, by CSS name (without `--`). */
export function colorVars(colors: ThemeColors): Vars {
  const vars: Vars = SHADCN_COLOR_KEYS.map((key) => [kebab(key), colors[key]]);
  for (const sev of SEVERITY_KEYS) {
    vars.push([`${sev}-bg`, colors.severity[sev].bg], [`${sev}-fg`, colors.severity[sev].fg]);
  }
  for (const st of STATUS_KEYS) {
    vars.push([`status-${st}-bg`, colors.status[st].bg], [`status-${st}-fg`, colors.status[st].fg]);
  }
  return vars;
}

function radiusValue(px: number): string {
  if (px === radius.full) return "9999px";
  const offset = px - radius.lg;
  if (offset === 0) return "var(--radius)";
  return `calc(var(--radius) ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}px)`;
}

const durationVars = (durations: Record<string, number>): Vars =>
  Object.entries(durations).map(([k, ms]) => [`brigade-duration-${k}`, `${ms}ms`]);

function scaleVars(): Vars {
  const vars: Vars = [["radius", rem(radius.lg)]];
  const steps = Object.entries(spacing).sort(([a], [b]) => Number(a) - Number(b));
  for (const [k, px] of steps) vars.push([`brigade-space-${k.replace(".", "_")}`, rem(px)]);
  for (const [k, v] of Object.entries(fontFamily.web)) vars.push([`brigade-font-${k}`, v]);
  for (const [k, v] of Object.entries(fontSize)) {
    vars.push(
      [`brigade-text-${k}`, rem(v.size)],
      [`brigade-text-${k}-line-height`, rem(v.lineHeight)],
    );
  }
  for (const [k, w] of Object.entries(fontWeight)) vars.push([`brigade-font-weight-${k}`, w]);
  for (const [k, px] of Object.entries(radius)) vars.push([`brigade-radius-${k}`, radiusValue(px)]);
  vars.push(...durationVars(motion.duration));
  for (const [k, p] of Object.entries(motion.easing)) {
    vars.push([`brigade-ease-${kebab(k)}`, bezier(p)]);
  }
  vars.push(["brigade-motion-travel", motion.travel]);
  vars.push(["brigade-motion-press-scale", motion.pressScale]);
  return vars;
}

const block = (selector: string, vars: Vars, indent = "", extra: string[] = []) =>
  [
    `${indent}${selector} {`,
    ...vars.map(([n, v]) => `${indent}  --${n}: ${v};`),
    ...extra.map((line) => `${indent}  ${line}`),
    `${indent}}`,
  ].join("\n");

/** `tokens.css`: light values on `:root`, dark on `.dark`, reduced motion drops travel and press scale. */
export function tokensCss(): string {
  const reduced: Vars = [
    ...durationVars(motion.reduced.duration),
    ["brigade-motion-travel", motion.reduced.travel],
    ["brigade-motion-press-scale", motion.reduced.pressScale],
  ];
  return (
    [
      HEADER,
      block(":root", [...colorVars(themes.light), ...scaleVars()], "", ["color-scheme: light;"]),
      block(".dark", colorVars(themes.dark), "", ["color-scheme: dark;"]),
      `@media (prefers-reduced-motion: reduce) {\n${block(":root", reduced, "  ")}\n}`,
    ].join("\n\n") + "\n"
  );
}

/** `theme.css`: Tailwind v4 mapping of the variables in `tokens.css` to utilities. */
export function themeCss(): string {
  const vars: Vars = SHADCN_COLOR_KEYS.map((key) => [
    `color-${kebab(key)}`,
    `var(--${kebab(key)})`,
  ]);
  for (const sev of SEVERITY_KEYS) {
    vars.push(
      [`color-${sev}`, `var(--${sev}-bg)`],
      [`color-${sev}-foreground`, `var(--${sev}-fg)`],
    );
  }
  for (const st of STATUS_KEYS) {
    vars.push(
      [`color-status-${st}`, `var(--status-${st}-bg)`],
      [`color-status-${st}-foreground`, `var(--status-${st}-fg)`],
    );
  }
  vars.push(["spacing", rem(spacing[1])]);
  for (const k of Object.keys(fontFamily.web)) vars.push([`font-${k}`, `var(--brigade-font-${k})`]);
  for (const [k, v] of Object.entries(fontSize)) {
    vars.push(
      [`text-${k}`, `var(--brigade-text-${k})`],
      [`text-${k}--line-height`, `calc(${v.lineHeight} / ${v.size})`],
    );
  }
  for (const k of Object.keys(radius)) vars.push([`radius-${k}`, `var(--brigade-radius-${k})`]);
  for (const k of Object.keys(motion.easing)) {
    vars.push([`ease-${kebab(k)}`, `var(--brigade-ease-${kebab(k)})`]);
  }
  return (
    [HEADER, "@custom-variant dark (&:where(.dark, .dark *));", block("@theme inline", vars)].join(
      "\n\n",
    ) + "\n"
  );
}
