# @freecorps/brigade-i18n

The one message catalog for the API (Workers), the web dashboard and the mobile app, compiled with
[Paraglide JS](https://paraglidejs.com) into typed message functions, plus `Intl` formatting helpers.
Locales: `en` (source) and `pt-BR`. See [RFC 0008](../../docs/rfcs/0008-i18n.md).

License: MIT.

**Rule:** every user-facing string lives here, with `en` and `pt-BR` both filled in. Domain values stay
canonical in data and APIs (`sev1`, `investigating`); only the UI translates them. Severity codes (`SEV1`) are
not translated either: `severityLabels.sev1()` is the name ("Critical", "Crítica") and the UI shows both.

## Usage

```ts
// Server (Worker): import messages by name.
import { formatDateTime, resolveLocale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import { incidents_active_count } from "@freecorps/brigade-i18n/messages";

const locale = resolveLocale(user.locale); // "pt", "pt-PT" → "pt-BR"; unknown → "en"
incidents_active_count({ count: 3 }, { locale }); // "3 incidentes ativos"
incidentStatusLabels[incident.status]({}, { locale }); // "Investigando"
formatDateTime(incident.createdAt, locale, user.timeZone); // "5 de mar. de 2026, 11:30"
```

```tsx
// Web (Vite): `m` is fine, Rolldown keeps only the messages used.
import { m } from "@freecorps/brigade-i18n";
<span>{m.theme_dark()}</span>;
```

Entry points:

- `.`: `m` (every message), `locales`, `baseLocale`, `resolveLocale`, `isLocale`, `toLocale`, `assertIsLocale`,
  `getLocale`, `setLocale`, `overwriteGetLocale`, `overwriteSetLocale`, `formatDateTime`, `formatNumber`,
  `formatRelativeTime`, `toTimeZone`.
- `./messages`: every message by name, and `m`.
- `./labels`: `severityLabels` and `incidentStatusLabels`, keyed by the canonical values.
- `./incident`: how incidents read in a UI, shared by the dashboard and the app: `entryText` (a timeline entry),
  `personName`, `severityName`, `formatAge`, `entryTime`, and refused changes (`noticeFor`, `noticeText`,
  `mutationErrorReason`, `queryErrorReason`). It reads `@freecorps/brigade-schema`'s rows, which makes schema a
  dependency of this package (the other entries import nothing from it).
- `./oncall`: how on-call schedules read, shared by the dashboard's On-call card and the app's on-call screen:
  `memberLabel`, `handoffTime` (in the schedule's zone), `viewerTime` (the viewer's, when it reads differently),
  `fromNow`, `zoneLabel`, `offsetLabel`, `text` and `scheduleRefusal`. Like `./incident`, it reads schema's rows.
- `./why-paged`: "Why wasn't I paged?" worded, shared by the dashboard's paging card and `?why=` view and the app's
  paging list and screen: `verdictText`, `shortVerdict`, `pageLabel`, `targetedText`, `stageTimes`, `deliveryError`,
  `pagingMembers`, `byUrgency` and the rest. It words `whyPaged`'s result from `@freecorps/brigade-sync`, which makes
  sync a dependency of this package (types only).
- `./auth`: the sign-in form's checks (`checkSignIn`, `checkEmail`, `checkPassword`) and `authErrorMessage`.

Messages are shipped one module per message and `m` is a real ESM namespace. Vite (Rolldown) tree-shakes
`m.x` down to the messages used; **esbuild (Wrangler) does not**: it keeps every message reachable through
`m` and only drops unused named imports. So server and Worker code imports messages by name from
`@freecorps/brigade-i18n/messages`. Metro does not tree-shake by default, so the mobile bundle carries the whole
catalog.

The helpers take the locale (and `formatDateTime` the recipient's IANA time zone) explicitly and use standard
`Intl` only. Workers and browsers support everything used here. Hermes (React Native) has no `PluralRules`,
which every plural message relies on, and no `RelativeTimeFormat` or `Locale`. A plural message then throws
while rendering, so the mobile app loads `@formatjs` polyfills before importing this package
(`apps/mobile/src/intl/polyfills.ts`, spike S4).

The helpers never throw, because pushes, emails and Slack messages are rendered with them and a throw could
stop someone from being paged: an unknown locale formats as `en`, an unknown time zone as `"UTC"` (`toTimeZone`
validates one up front), and an invalid date returns `""`. `formatRelativeTime` uses fixed buckets, not
calendar units: "yesterday" means 24 to 48 hours ago, a month is 30 days and a year 365.

Paraglide types plural inputs as `NonNullable<unknown>` (`{ count: NonNullable<unknown> }`). Pass a number; no
wrapper is needed.

## Server: always pass `{ locale }`

Slack DMs, emails and push are rendered per recipient. Pass the recipient's profile locale through
`resolveLocale(value)` first (exact match, then language prefix, then `en`). **On the server every call must
pass `{ locale }` and must never call `setLocale`**: the current locale is a single variable per isolate, so
setting it for one request leaks into every concurrent request handled by the same isolate. The same goes for
`formatDateTime`: pass the recipient's time zone, since Workers default to UTC.

## UIs: the current locale

The runtime is compiled with `strategy: ["globalVariable", "baseLocale"]` and `disableAsyncLocalStorage: true`:
the current locale is a module variable that defaults to `en`. Nothing reads cookies, `localStorage`,
`navigator` or the URL, and nothing needs `AsyncLocalStorage`, so importing the package is safe in a Worker, in
React Native and in tests. Our `setLocale` never reloads the page (Paraglide's own does by default, which would
reset the locale to `en`). `setLocale` does not re-render: the app keys its root on locale state. Apps persist the
choice themselves, or plug a store in with `overwriteGetLocale`; an app that overrides `getLocale` must also
override `setLocale` with `overwriteSetLocale`, otherwise `setLocale` has no visible effect.

`package.json` declares `sideEffects: false` even though the runtime initialises `globalThis.__paraglide` at
import. That write is idempotent and only feeds Paraglide's SSR helpers, which we do not use, so a bundler
dropping an unused runtime import changes nothing.

## Adding or changing a message

1. Add the key to `messages/en.json` **and** `messages/pt-BR.json`. Keys are semantic and snake case (JS
   identifiers): `incident_status_investigating`. The syntax is inlang message-format: `{name}` parameters, and
   `declarations`/`selectors`/`match` for plurals (see `incidents_active_count` and
   [Paraglide's variants docs](https://paraglidejs.com/variants)). Format numbers with a
   `local xFormatted = x: number` declaration.
2. Run `vp run --filter @freecorps/brigade-i18n compile` and commit `src/paraglide` with the change.
3. Run `vp test`: it fails if a key, parameter, selector or variant differs between locales, or if
   `src/paraglide` is stale.

## How compilation works

`scripts/compile.ts` loads the inlang project (`project.inlang`, with the message-format plugin from
`node_modules` so it works offline) and writes the compiled functions, runtime and `.d.ts` files to
`src/paraglide`. `build` compiles, then `vp pack` bundles our own modules and copies `src/paraglide` to `dist`
unchanged. Consumers import plain JS and never run the Paraglide Vite plugin (the same output works in Vite,
Wrangler and Metro). `dev` (`scripts/dev.ts`) watches `messages/` and `project.inlang/settings.json`,
recompiles, and runs `vp pack --watch` alongside so `dist` stays current for consumers.

**`src/paraglide` is committed** (and excluded from format and lint in the root `vite.config.ts`). CI runs
`vp check` (type-aware lint and type check) before any package build, and tests import the sources directly,
so the generated code has to exist on a clean checkout. Committing it is simpler and sturdier than ordering
tasks so compilation always runs first; a test recompiles in memory and fails when the committed files differ
from the message sources.

`src` is type-checked without Node types (`src/tsconfig.json`, used by `vp check` and the declaration
build); scripts and tests use `tsconfig.json`. Tests import `@freecorps/brigade-schema` from its sources through
the `@freecorps/source` export condition (RFC 0002, Tooling decisions), so they do not need schema built first.
