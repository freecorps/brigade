# @freecorps/brigade-ui

Brigade's design tokens: colour (light and dark), spacing, type, radius and motion. One source of
truth, `src/tokens.ts`, shared by the web dashboard and the mobile app. Tokens only: components live
in each app (see [open questions](../../docs/open-questions.md), Q5).

License: MIT.

## The palette

Warm graphite neutrals and a petrol-teal brand hue. Colour marks state, not chrome. SEV1 is the only
solid badge fill in either theme, so a SEV1 badge reads from across the room; SEV2 to SEV4 step down in
prominence, and SEV2 is louder than every status; on the dark card SEV2 stands at least 2:1 off it.
Each status has a hue of its own (triage magenta, the loudest status because it needs a person;
investigating teal, fixing violet, monitoring blue, resolved green, declined a quiet grey), and every
pair of fills stays at least ΔE 10 apart with normal vision. With protanopia or deuteranopia pale
tints converge, so there the badge as a whole (fill or text) stays ΔE 10 apart and the fills at least
2.5: don't rely on a status fill alone (a dot with no label) to tell two statuses apart. Destructive is a
deep crimson on light (a light salmon on dark) in a different lightness band from SEV1 under the same
simulations, so a SEV1 badge never reads as a Delete button. Chart colours stay apart under the same
simulations and avoid green, which means "resolved". Dark is designed on its own (a true neutral
ground, surfaces lifted by lightness, badges as light text on a dark tint of their hue), not inverted
from light. The tests enforce all of this, plus WCAG AA (4.5:1) for every text pair and 3:1 for
inputs, focus rings and chart colours, in both themes.

## Web (Tailwind v4 + shadcn/ui)

```css
@import "tailwindcss";
@import "@freecorps/brigade-ui/tokens.css"; /* variables: :root (light) and .dark */
@import "@freecorps/brigade-ui/theme.css"; /* @theme inline mapping + class-based dark variant */
```

`tokens.css` defines shadcn/ui's variables (`--background`, `--primary`, `--chart-1`…`5`,
`--sidebar-*`, `--radius`, …) plus Brigade's own: `--sev1-bg`/`--sev1-fg` to `--sev4-*`, `--status-<status>-bg`/`-fg`, and `--brigade-*` for
spacing, type, radius, durations and easing. Toggle dark mode with the `dark` class on `<html>`.
`theme.css` turns them into utilities: `bg-sev1 text-sev1-foreground`,
`bg-status-fixing text-status-fixing-foreground`, `rounded-lg`, `text-sm`, `ease-out`, and durations
through Tailwind's variable syntax: `duration-(--brigade-duration-fast)`.

- Type sizes use Tailwind's names and values (xs to 3xl); radii, including 2xl to 4xl, are derived
  from `--radius` with `calc()`, as in shadcn. Tailwind's `text-4xl` and up and its full spacing
  scale stay available but are off-system: reach for them only with a reason.
- **Destructive Button and Badge:** restyle shadcn's destructive variant. In dark, shadcn's
  `dark:bg-destructive/60` and `hover:bg-destructive/90` draw a muddy red that, under colour-blind
  simulation, matches SEV1 and carries white text at about 3:1. No single colour can be readable as
  `text-destructive` on dark surfaces and also dark enough for white text, so dark draws a tint with
  red text instead. Keep `bg-destructive text-white` and replace the rest with:

  ```
  hover:bg-destructive/95 dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/20
  ```

  The alphas are `destructiveFill` in the tokens, and the tests check the colour actually drawn
  over background, card and popover, at rest and on hover: text at 4.5:1 and a 1.5:1 lightness step
  from SEV1 with normal vision, protanopia and deuteranopia. `--destructive-foreground` is a Brigade
  extra for full-opacity fills only.

- **Focus:** components restyled for Brigade, destructive buttons included, draw focus with an opaque
  `ring-ring`, not shadcn's `ring-ring/50` or `focus-visible:ring-destructive/*`; only the opaque ring
  is tested at 3:1 against every surface.

## Mobile (Expo)

No CSS. Import the objects and pick the theme from the colour scheme:

```ts
import { Platform, useColorScheme } from "react-native";
import { themes, spacing, fontFamily, fontSize, radius, motion } from "@freecorps/brigade-ui";

const scheme = useColorScheme(); // inside a component
const colors = themes[scheme === "dark" ? "dark" : "light"];
const badge = { backgroundColor: colors.severity.sev1.bg, color: colors.severity.sev1.fg };
const code = { fontFamily: Platform.select(fontFamily.native.mono) };
```

`themes` is frozen. Fonts: `fontFamily.web` holds CSS stacks; `fontFamily.native` holds single family
names per platform, where `undefined` means the system font.

Sizes are px numbers (the web gets them as rem). Easing curves are cubic-bezier control points, ready
for `Easing.bezier(...motion.easing.out)`.

## Motion

Durations stay under 300ms. Every animation must respect `prefers-reduced-motion` (the OS setting on
mobile). Under it, movement goes and short fades stay:

- `tokens.css` shortens `--brigade-duration-*` to 100-150ms and sets `--brigade-motion-travel` to `0`.
  Write distances as `calc(8px * var(--brigade-motion-travel))` and they collapse on their own.
- Pressed controls scale to `--brigade-motion-press-scale` (0.97; `1` under reduced motion), e.g.
  `active:scale-(--brigade-motion-press-scale)`, so press feedback needs no `motion-reduce:` variant.
- Any `transform` that is not written that way must be removed by the app under reduced motion.
  Opacity and colour transitions may stay.
- **Tailwind's `duration-*`, `animate-*` and tw-animate-css utilities are not covered
  automatically.** Use `motion-reduce:` variants (`motion-reduce:transform-none`,
  `motion-reduce:animate-none`) wherever they move something.
- On mobile, read `motion.reduced` when the OS setting is on (`useReducedMotion` in Reanimated).

## Rules

- **No one-off values in apps.** Colours, spacing, font sizes, radii and durations come from here. If
  an app needs a value that does not exist, add a token here (with both themes and a passing contrast
  test), not a literal in the app.
- **Edit `src/tokens.ts`, never the CSS.** Then run `vp run generate` in this package; a test fails if
  `src/tokens.css` or `src/theme.css` drift from the TS.
- **Framework-light.** No React, no DOM, no Node APIs in `src/` (the generator script is the exception).
