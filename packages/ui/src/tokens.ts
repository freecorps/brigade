// Brigade design tokens: the single source of truth for web (CSS custom properties, generated from
// this file) and mobile (these objects, used directly). Plain data, no runtime dependencies.

export type Hex = `#${string}`;
export type ThemeName = "light" | "dark";

/** A badge: text colour on its own background. */
export interface BadgeColors {
  readonly bg: Hex;
  readonly fg: Hex;
}

// These mirror SEVERITIES and INCIDENT_STATUSES in packages/schema.
export const SEVERITY_KEYS = ["sev1", "sev2", "sev3", "sev4"] as const;
export const STATUS_KEYS = [
  "triage",
  "investigating",
  "fixing",
  "monitoring",
  "resolved",
  "declined",
] as const;

/** shadcn/ui's theme colours, in camelCase (`cardForeground` is `--card-foreground`). */
export const SHADCN_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "sidebar",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
] as const;

export type ThemeColors = Readonly<Record<(typeof SHADCN_COLOR_KEYS)[number], Hex>> & {
  readonly severity: Readonly<Record<(typeof SEVERITY_KEYS)[number], BadgeColors>>;
  readonly status: Readonly<Record<(typeof STATUS_KEYS)[number], BadgeColors>>;
};

function deepFreeze<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (typeof child === "object" && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}

// Warm graphite neutrals with a petrol-teal brand hue. Colour is for state, not chrome: SEV1 is the
// only solid badge fill in either theme, so it reads from across the room; every other badge is a
// tint, and SEV2-4 step down in prominence. Destructive is a dark oxblood (a light salmon on dark), a
// lightness band away from SEV1 even under protanopia and deuteranopia, so a SEV1 badge never reads as
// a Delete button. Charts avoid green so a series never reads as "resolved". The sidebar sits on the
// page ground.
const light = {
  background: "#f7f7f5",
  foreground: "#161615",
  card: "#ffffff",
  cardForeground: "#161615",
  popover: "#ffffff",
  popoverForeground: "#161615",
  primary: "#0b6467",
  primaryForeground: "#ffffff",
  secondary: "#ecece8",
  secondaryForeground: "#161615",
  muted: "#ecece8",
  mutedForeground: "#5b5b55",
  accent: "#e2efed",
  accentForeground: "#0a4f52",
  destructive: "#651a15",
  destructiveForeground: "#ffffff",
  border: "#e2e2dd",
  input: "#85857d",
  ring: "#0f8a87",
  chart1: "#0b6467",
  chart2: "#2f6db0",
  chart3: "#a8620a",
  chart4: "#1d3557",
  chart5: "#8e8d85",
  sidebar: "#f7f7f5",
  sidebarForeground: "#161615",
  sidebarPrimary: "#0b6467",
  sidebarPrimaryForeground: "#ffffff",
  sidebarAccent: "#e9e9e4",
  sidebarAccentForeground: "#161615",
  sidebarBorder: "#e2e2dd",
  sidebarRing: "#0f8a87",
  severity: {
    sev1: { bg: "#d0141e", fg: "#ffffff" },
    sev2: { bg: "#fbc9a6", fg: "#7a2c00" },
    sev3: { bg: "#f5e3a3", fg: "#5c4300" },
    sev4: { bg: "#eef1f3", fg: "#3d4850" },
  },
  status: {
    triage: { bg: "#e6e4dc", fg: "#22221f" },
    investigating: { bg: "#dcefed", fg: "#0a4f52" },
    fixing: { bg: "#d8eeeb", fg: "#063f41" },
    monitoring: { bg: "#e2ebf6", fg: "#1d4673" },
    resolved: { bg: "#dcf2e2", fg: "#145c2e" },
    declined: { bg: "#ecece8", fg: "#5b5b55" },
  },
} as const satisfies ThemeColors;

// Dark is designed for a phone at 3 a.m.: a true neutral ground (no navy), surfaces lifted by
// lightness alone, and every badge but SEV1 as light text on a dark tint of its hue.
const dark = {
  background: "#121211",
  foreground: "#ededea",
  card: "#1a1a19",
  cardForeground: "#ededea",
  popover: "#1f1f1d",
  popoverForeground: "#ededea",
  primary: "#4cc3b8",
  primaryForeground: "#06201f",
  secondary: "#262624",
  secondaryForeground: "#ededea",
  muted: "#262624",
  mutedForeground: "#a3a39b",
  accent: "#163533",
  accentForeground: "#9fe0d8",
  // Light enough to read as text on dark surfaces, so dark destructive fills are a faint tint of it
  // with destructive-coloured text (see destructiveFill). destructiveForeground (a Brigade extra) is
  // for full-opacity fills only.
  destructive: "#e8877c",
  destructiveForeground: "#260806",
  border: "#2c2c2a",
  input: "#6e6e68",
  ring: "#4cc3b8",
  chart1: "#4cc3b8",
  chart2: "#6fa3e6",
  chart3: "#e0a24a",
  chart4: "#f0f2f8",
  chart5: "#74746c",
  sidebar: "#121211",
  sidebarForeground: "#ededea",
  sidebarPrimary: "#4cc3b8",
  sidebarPrimaryForeground: "#06201f",
  sidebarAccent: "#262624",
  sidebarAccentForeground: "#ededea",
  sidebarBorder: "#2c2c2a",
  sidebarRing: "#4cc3b8",
  severity: {
    sev1: { bg: "#d81b24", fg: "#ffffff" },
    sev2: { bg: "#5a2a0f", fg: "#ffc29b" },
    sev3: { bg: "#332a0d", fg: "#ecc65c" },
    sev4: { bg: "#23282c", fg: "#b3bec6" },
  },
  status: {
    triage: { bg: "#2b2b27", fg: "#ededea" },
    investigating: { bg: "#123331", fg: "#8fd9d0" },
    fixing: { bg: "#15302e", fg: "#a6ece3" },
    monitoring: { bg: "#16263a", fg: "#a9c7ee" },
    resolved: { bg: "#13301d", fg: "#86d9a2" },
    declined: { bg: "#262624", fg: "#a3a39b" },
  },
} as const satisfies ThemeColors;

export const themes: Readonly<Record<ThemeName, ThemeColors>> = deepFreeze({ light, dark });

/**
 * How destructive buttons and badges are drawn: the destructive colour at `rest`/`hover` opacity over
 * the surface, with `text` on top. Light keeps shadcn's white-on-red; dark is a tint with red text,
 * because no single colour is both readable as text on dark surfaces and dark enough for white text.
 * On the web: `hover:bg-destructive/95 dark:bg-destructive/15 dark:text-destructive
 * dark:hover:bg-destructive/20`.
 */
export const destructiveFill = deepFreeze({
  light: { rest: 1, hover: 0.95, text: "#ffffff" },
  dark: { rest: 0.15, hover: 0.2, text: themes.dark.destructive },
} as const satisfies Record<ThemeName, { rest: number; hover: number; text: Hex }>);

/** Spacing in px on a 4px grid. Keys match Tailwind's numeric scale (`p-4` is 16px). */
export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * `web` holds CSS font stacks. `native` holds single family names for React Native, where a stack is
 * not valid: `undefined` means the system font; pick the platform entry with `Platform.select`.
 */
export const fontFamily = {
  web: {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"',
    mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace',
  },
  native: {
    sans: { ios: undefined, android: undefined },
    mono: { ios: "Menlo", android: "monospace" },
  },
} as const;

/**
 * Font size and line height in px, with Tailwind's names and values so `text-xl` means the same
 * everywhere. App type, not display type: nothing above 30px.
 */
export const fontSize = {
  xs: { size: 12, lineHeight: 16 },
  sm: { size: 14, lineHeight: 20 },
  base: { size: 16, lineHeight: 24 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 28 },
  "2xl": { size: 24, lineHeight: 32 },
  "3xl": { size: 30, lineHeight: 36 },
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/**
 * Corner radii in px. Tight and chosen once (sm-lg for controls and cards); `full` is for pills and
 * avatars. On the web `lg` is shadcn's `--radius` and the others are derived from it with calc().
 * 2xl-4xl keep Tailwind's values so its utilities still follow `--radius`.
 */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  "3xl": 24,
  "4xl": 32,
  full: 9999,
} as const;

/**
 * Durations in ms and easing curves; feedback stays under 300ms. `travel` multiplies every movement
 * distance (translate, scale offset). `pressScale` is the scale of a pressed control (buttons,
 * pressable rows). Under prefers-reduced-motion use `reduced`: movement is removed (travel 0, no
 * press scale, and apps drop transforms), while short opacity and colour fades remain.
 */
export const motion = {
  duration: {
    fast: 120, // press, toggle, hover
    base: 180, // popovers, dropdowns, tooltips
    slow: 260, // dialogs, sheets, drawers
  },
  easing: {
    out: [0.23, 1, 0.32, 1], // default for anything entering or responding
    inOut: [0.77, 0, 0.175, 1], // something moving across the screen
    drawer: [0.32, 0.72, 0, 1], // sheets and drawers
  },
  travel: 1,
  pressScale: 0.97,
  reduced: {
    duration: { fast: 100, base: 120, slow: 150 },
    travel: 0,
    pressScale: 1,
  },
} as const satisfies {
  duration: Record<string, number>;
  easing: Record<string, readonly [number, number, number, number]>;
  travel: number;
  pressScale: number;
  reduced: { duration: Record<string, number>; travel: number; pressScale: number };
};

export const tokens = {
  themes,
  spacing,
  fontFamily,
  fontSize,
  fontWeight,
  radius,
  motion,
  destructiveFill,
} as const;
