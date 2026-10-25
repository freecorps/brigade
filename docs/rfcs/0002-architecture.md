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

| State                                                                             | Owner                                             | Why                                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| Workspace config, services catalog, schedules, escalation policies, incident list | `WorkspaceDO`                                     | Single-threaded, strongly consistent, live subscriptions |
| One incident's timeline, roles, fields, follow-ups, pending escalations (alarms)  | `IncidentDO`                                      | Hot spot during a SEV1; isolates load per incident       |
| Alert dedupe window                                                               | `AlertGroupDO` (keyed by workspace + fingerprint) | Serializes bursts of the same alert                      |
| Probe schedule and recent results per region                                      | `ProbeDO` (keyed by workspace + region)           | Placed with `locationHint`                               |
| Users, sessions, workspace membership, cross-workspace search and reports         | D1                                                | Global queries DOs cannot answer                         |
| Attachments, postmortem exports, DO backups                                       | R2                                                | Blobs                                                    |

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
  request, created only when the request needs it. D1 schema changes are checked-in SQL in `apps/api/migrations/`
  (`wrangler d1 migrations apply`); `apps/api/test/migrations.test.ts` fails, printing the SQL, when Better Auth
  needs more than they create. The secret `BETTER_AUTH_SECRET` comes from `wrangler secret put` or a local
  `apps/api/.dev.vars`.
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
