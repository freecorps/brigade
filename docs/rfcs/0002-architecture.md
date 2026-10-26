# RFC 0002 — Architecture and repository layout

- Status: Draft

## Runtime overview

```
                       ┌───────────────────────── Cloudflare account ──────────────────────────┐
 Web dashboard ──────▶ │ web Worker: SPA on static assets; /api/* ─(service binding API)─┐     │
                       │   prefix stripped, WebSocket upgrades pass through              │     │
                       │ ┌───────────────────────────────────────────────────────────────┘     │
                       │ ▼                                                                     │
 Mobile (Expo) ──WS──▶ │ api Worker (router, auth, REST/OpenAPI, webhooks in)                  │
 Slack ─────HTTP─────▶ │   ├─▶ WorkspaceDO   (SQLite) services, on-call, incident index        │
 Alert sources ──────▶ │   ├─▶ IncidentDO    (SQLite) timeline, roles, fields, escalation      │
                       │   ├─▶ AlertGroupDO  (SQLite) dedupe/grouping window                   │
                       │   └─▶ D1            cross-workspace index, search, reporting          │
                       │                                                                       │
                       │ ProbeDO × N regions (locationHint) ── alarm ──▶ checks ─▶ AlertGroupDO│
                       │                                                                       │
                       │ Queues: events ─▶ notifier Worker ─▶ push relay / Slack / email / SMS │
                       │ R2: attachments, exports, backups      Workers AI: summaries          │
                       └───────────────────────────────────────────────────────────────────────┘
                                                  │
                         relay Worker (operated by Freecorps, also self-hostable) ─▶ APNs / FCM
```

## Where state lives

| State                                                                               | Owner                                             | Why                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Workspace config, services catalog, schedules, escalation policies, incident list   | `WorkspaceDO`                                     | Single-threaded, strongly consistent, live subscriptions |
| One incident's timeline, roles, fields, follow-ups, pending escalations (alarms)    | `IncidentDO`                                      | Hot spot during a SEV1; isolates load per incident       |
| Alert dedupe window                                                                 | `AlertGroupDO` (keyed by workspace + fingerprint) | Serializes bursts of the same alert                      |
| Probe schedule and recent results per region                                        | `ProbeDO` (keyed by workspace + region)           | Placed with `locationHint`                               |
| The paging pipeline's heartbeat and health (the external dead-man switch, RFC 0007) | `WatchdogDO` (one, named `watchdog`)              | One beat a minute from a Cron Trigger; tiny state        |
| Users, sessions, workspace membership, cross-workspace search and reports           | D1                                                | Global queries DOs cannot answer                         |
| Attachments, postmortem exports, DO backups                                         | R2                                                | Blobs                                                    |

**Consistency rule:** a DO is the source of truth for what it owns. Anything copied elsewhere (D1 index,
`WorkspaceDO` incident list) is a projection, updated through the transactional outbox described in RFC 0005,
and may lag by milliseconds. Temporary exception: in spike S3 the `WorkspaceDO` incident index is authoritative
for status and severity until `IncidentDO` exists (RFC 0004, "Shared core").

## Repository layout (target)

```
apps/
  api/         Cloudflare Worker: HTTP/WS entry, Durable Objects, queue consumers      (AGPL-3.0)
  relay/       Push relay Worker (RFC 0006)                                            (AGPL-3.0)
  web/         Dashboard SPA (React + Vite) on Workers static assets, plus a small     (AGPL-3.0)
               Worker that forwards /api/* to the api Worker (service binding)
  mobile/      Expo app (iOS/Android)                                                  (AGPL-3.0)
  site/        Public website + docs, i18n                                             (AGPL-3.0)
packages/
  schema/      Domain types, validation, mutations shared by server and clients        (MIT)
  sync/        Sync protocol client + React hooks (RFC 0004)                           (MIT)
  sdk/         Typed API client + provider interfaces for integrations                 (MIT)
  i18n/        Message catalogs and formatting helpers (RFC 0008)                      (MIT)
  push/        Push payload encryption (HPKE on WebCrypto) and envelope (RFC 0006)     (MIT)
  ui/          Shared design tokens (web + mobile)                                     (MIT)
integrations/
  slack/       ChatProvider implementation (Worker, bound via service binding)        (AGPL-3.0)
  ...
spikes/        Throwaway spike code: not product, never published, private packages   (AGPL-3.0)
docs/rfcs/     Design documents
```

`spikes/<name>/` holds code a roadmap spike needs that is not the start of an app (S2's probe Worker). It sits in
the workspace (`spikes/*`) so CI checks and tests it. The PR that records the spike's result tears down what the
spike deployed and deletes the folder; the write-up in `docs/spikes/` is what stays.

The `brigade-events` consumer runs in the api Worker for now (its `queue` handler: push, and email for pages that
failed); it becomes the separate notifier Worker of the runtime map with Slack (RFC 0005 "Notifiers", "Email").

Packages are MIT so third parties can build integrations without AGPL concerns; apps are AGPL (RFC 0009).

## Tooling decisions

- **Package manager: Bun.** Pinned via `devEngines` in the root `package.json`.
- **Toolchain: Vite+ (`vp`).** Dev server, build, Vitest, Oxlint, Oxfmt, `tsgo` type checking and library packing in one tool.
- **Task runner: Vite Task (`vp run`), not Turborepo.** Vite+ ships a workspace-aware task runner with caching,
  `dependsOn` and pnpm-style `--filter`. Adding Turborepo on top would duplicate it. Revisit if we need
  remote caching beyond the GitHub Actions cache that Vite+ supports.
- **Workspace packages resolve from source.** `vp pack` (`exports.devExports`) writes a `@freecorps/source`
  condition to the TS entry in each package's `exports` and the `dist`-only map to `publishConfig.exports`.
  Consumers opt in with `"customConditions": ["@freecorps/source"]` in tsconfig and the `workspaceSource()`
  plugin from the root `vite.workspace.ts` in `vite.config.ts`, so check, tests and `vp dev` never need a
  package built. We publish with Bun (it resolves `catalog:` and `workspace:`). Whether or not the
  publisher applies `publishConfig.exports`, the dev map sits under a condition no outside consumer enables, so
  it is harmless.
- **No Next.js.** Dashboard is a client-rendered SPA on Workers static assets; the public site is prerendered.
- **Web dashboard:** React + TanStack Router + shadcn/ui.
- **Site and docs:** Fumadocs on TanStack Start (Vite-based), prerendered, i18n per locale (RFC 0008).
- **Auth:** Better Auth on Workers + D1; Expo client for mobile (OAuth/OIDC with PKCE via system browser, plus QR pairing).
  Built so far: email and password with cookie sessions for the web, and the organization plugin for workspaces
  (`apps/api/src/auth.ts`, served at `/auth/*`, `/api/auth/*` through the dashboard). One Better Auth instance per
  request, created only when the request needs it. Workers never set `NODE_ENV`, so what Better Auth would derive
  from it is set explicitly: cookies are `Secure` (with the `__Secure-` prefix) when the request came over HTTPS,
  and rate limiting is on, counted in D1 (the `rateLimit` table, so every isolate sees the same counts) per client
  IP from `cf-connecting-ip`: 3 per 10 s for sign-in and sign-up, 100 per minute for the other routes,
  `/get-session` exempt. The organization plugin's routes are refused except the ones the dashboard reads
  (`get-full-organization`, `get-active-member`, `list`) and `set-active`, since the others would change D1
  without the shard or an event (RFC 0005); member roles, removal and leaving go through the API's own
  `/workspaces/:id/members/:userId` instead (RFC 0003 "Members"), and invitations through
  `/workspaces/:id/invitations` and `/invitations/:id` (RFC 0003 "Invitations"), so the plugin's invitation routes
  stay refused; deleting a workspace is off. D1 schema changes are checked-in SQL in `apps/api/migrations/`
  (`wrangler d1 migrations apply`); `apps/api/test/migrations.test.ts` fails, printing the SQL, when Better Auth
  needs more than they create. The secret `BETTER_AUTH_SECRET` comes from `wrangler secret put` or a local
  `apps/api/.dev.vars`.
  - **Mobile (email and password, built):** Better Auth's Expo integration, `@better-auth/expo` 1.7.13: the server's
    `expo()` plugin and the app's `expoClient` with `expo-secure-store`. The app keeps the session cookie in secure
    storage and sends it as a `Cookie` header it sets itself, on Better Auth's routes and on the sync upgrade (RFC
    0004 "Socket topology"), so the app and the dashboard share one kind of session and one check; no bearer plugin.
    React Native's fetch sends no `Origin`, so the client sends the app's scheme as `expo-origin` and the plugin copies
    it to `Origin` when there is none; `brigade://` is a trusted origin (`APP_ORIGIN`), so Better Auth's origin check
    passes for the app and still refuses other sites, whose browsers always send their own `Origin`. The plugin's
    `/expo-authorization-proxy` (for social sign-in through the system browser) redirects to any HTTPS URL, so it is
    refused until that sign-in exists. Trusting `brigade://` also makes a `callbackURL` or `redirectTo` to
    `brigade://…` valid, and the plugin's after-hook appends the session as `?cookie=` to redirects from
    `/callback*`, `/magic-link/verify*` and `/verify-email*`; none of those is configured now, so any app on the
    phone that claims the scheme gets nothing. Email verification never redirects there: its link opens the
    dashboard's `/verify-email` page, which calls `verify-email` without a `callbackURL`, so the plugin has no
    redirect to append a session to. Before OAuth, magic links or password reset are enabled, those redirects need
    PKCE or verified App Links / Universal Links instead of a custom scheme. The plugin also trusts `exp://` (Expo
    Go), but only when `NODE_ENV` is `development`. The app signs in against the dashboard's origin
    (`EXPO_PUBLIC_BRIGADE_URL`, or the dev server on the Metro host in development). Still to come: OAuth/OIDC with
    PKCE via the system browser and QR pairing.
  - **Email verification (built):** Better Auth's, sent through the email notifier's `EmailSender` (RFC 0005
    "Email"; templates `email_verify` in `packages/i18n`, en and pt-BR, plain text and escaped HTML) at sign-up and
    when the dashboard asks again. The link is the dashboard's `/verify-email?token=…` (from `DASHBOARD_URL`, never the
    API Worker's own `/auth` path; only the dev log sender falls back on the origin the request came through, so a
    deployed Worker without `DASHBOARD_URL` sends no verification email rather than a link to whatever host a request
    named) and works 24 hours; when the user was answering an invitation it carries `next=/invitations/inv_…`, the
    only place it may lead (`safeNext`), and sign-up from an invitation asks for that too. The email carries nothing
    the person signing up typed except the address (no name). Asking again (`/send-verification-email`) needs a
    session and is for one's own address only (Better Auth would otherwise email any unverified address it is given):
    at most 3 per user in 15 minutes and 5 a day, counted in D1's `rateLimit` table (one upsert per counter, so
    requests at once each count), and 3 per IP a minute; it answers `503 EMAIL_NOT_CONFIGURED` when no sender is set
    up. **A squatted address is released:** a sign-up with the address of an account still unverified 24 hours after
    it was created (`UNVERIFIED_RELEASE_S`, past its link) replaces that account: the old user goes with its
    sessions, accounts and memberships, and a workspace it was alone in is left with no members (its D1 row and shard
    stay, unreachable, since deleting a workspace is not designed). An unverified account in a workspace with anyone
    else is kept, and the sign-up is refused as for any taken address; its owner can still verify it, and password
    reset, once built, is the other way back. **Unverified accounts sign
    in** and create and use their own workspaces (sign-up creates the first one, and an unproven address harms nobody
    there); what needs a verified address is everything that reaches someone else's inbox or depends on owning the
    address: being emailed by the notifier, inviting (and resending), and accepting or declining an invitation. An
    unverified address can be invited (the invitation email is how its owner learns of it); its owner verifies before
    accepting. The dashboard shows a notice with a resend button until the address is verified; the shared sign-in
    wording (`authErrorMessage`, used by the dashboard and the mobile app) explains `EMAIL_NOT_VERIFIED` in case a
    server requires verification to sign in. Password reset is still to come, on the same sender. Each user has a
    `locale` (`en`, `pt-BR`; D1 `user.locale`), the language Brigade writes to them in: set at sign-up (from the
    dashboard, else `Accept-Language`) and by the dashboard's language switch; the mobile app does not send it yet.
- **Workers tooling:** `wrangler` per app, invoked through `vp run` tasks. The Cloudflare Vite plugin
  (`@cloudflare/vite-plugin`) runs Workers inside the Vite dev server; validated with Vite+ in spike S5: the
  api Worker runs as an `auxiliaryWorkers` entry of apps/web in dev; apps/api tests use `@cloudflare/vitest-plugin`
  and apps/web's routing test uses wrangler's test harness (see [docs/spikes/s5-tooling-skeleton.md](../spikes/s5-tooling-skeleton.md)).
- **Mobile:** Expo (development builds, EAS Build/Submit), `apps/mobile`, app id `app.freecorps.brigade`.
  Metro, not Vite. Expo's default Metro config handles the Bun workspace (isolated installs included), and
  `metro.config.js` only adds the `@freecorps/source` condition to `resolver.unstable_conditionNames`, so the
  app imports `packages/*` from source like everything else. Only `import` reads `exports`, so workspace
  packages must not be `require`d. `android/` and `ios/` are generated (Continuous Native Generation) and
  gitignored. CI checks the app with `vp check` and builds JS bundles with `expo export`; native builds run on
  EAS. See [docs/spikes/s4-expo-workspace.md](../spikes/s4-expo-workspace.md).

## Environments

- `dev` — local (`vp dev`, Miniflare for DOs), and a deployable `brigade-<app>-dev` Workers environment for shared
  testing.
- `staging` — the `brigade-<app>-staging` Workers environment.
- `production` — the top-level (unsuffixed) Wrangler config, deployed only with owner approval.
- With the Cloudflare Vite plugin the environment is picked at build time (`CLOUDFLARE_ENV=staging vp build`);
  `wrangler deploy` then deploys what was built and takes no `--env`.
- The mobile app points at staging or production via build profile.
- Self-hosted — one Cloudflare account, one `deploy` command, guided setup (Slack app manifest, relay registration).
