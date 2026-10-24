# RFC 0002 — Architecture and repository layout

- Status: Draft

## Runtime overview

```
                       ┌───────────────────────── Cloudflare account ─────────────────────────┐
 Web dashboard ──WS──▶ │ api Worker (router, auth, REST/OpenAPI, webhooks in)                 │
 Mobile (Expo) ──WS──▶ │   ├─▶ WorkspaceDO   (SQLite) services, on-call, incident index       │
 Slack ─────HTTP─────▶ │   ├─▶ IncidentDO    (SQLite) timeline, roles, fields, escalation     │
 Alert sources ──────▶ │   ├─▶ AlertGroupDO  (SQLite) dedupe/grouping window                  │
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
and may lag by milliseconds.

## Repository layout (target)

```
apps/
  api/         Cloudflare Worker: HTTP/WS entry, Durable Objects, queue consumers      (AGPL-3.0)
  relay/       Push relay Worker (RFC 0006)                                            (AGPL-3.0)
  web/         Dashboard SPA (React + Vite), served by Workers static assets           (AGPL-3.0)
  mobile/      Expo app (iOS/Android)                                                  (AGPL-3.0)
  site/        Public website + docs, i18n                                             (AGPL-3.0)
packages/
  schema/      Domain types, validation, mutations shared by server and clients        (MIT)
  sync/        Sync protocol client + React hooks (RFC 0004)                           (MIT)
  sdk/         Typed API client + provider interfaces for integrations                 (MIT)
  i18n/        Message catalogs and formatting helpers (RFC 0008)                      (MIT)
  ui/          Shared design tokens (web + mobile)                                     (MIT)
integrations/
  slack/       ChatProvider implementation (Worker, bound via service binding)        (AGPL-3.0)
  ...
docs/rfcs/     Design documents
```

Packages are MIT so third parties can build integrations without AGPL concerns; apps are AGPL (RFC 0009).

## Tooling decisions

- **Package manager: Bun.** Pinned via `devEngines` in the root `package.json`.
- **Toolchain: Vite+ (`vp`).** Dev server, build, Vitest, Oxlint, Oxfmt, `tsgo` type checking and library packing in one tool.
- **Task runner: Vite Task (`vp run`), not Turborepo.** Vite+ ships a workspace-aware task runner with caching,
  `dependsOn` and pnpm-style `--filter`. Adding Turborepo on top would duplicate it. Revisit if we need
  remote caching beyond the GitHub Actions cache that Vite+ supports.
- **No Next.js.** Dashboard is a client-rendered SPA on Workers static assets; the public site is prerendered.
- **Web dashboard:** React + TanStack Router + shadcn/ui.
- **Site and docs:** Fumadocs on TanStack Start (Vite-based), prerendered, i18n per locale (RFC 0008).
- **Auth:** Better Auth on Workers + D1; Expo client for mobile (OAuth/OIDC with PKCE via system browser, plus QR pairing).
- **Workers tooling:** `wrangler` per app, invoked through `vp run` tasks. The Cloudflare Vite plugin
  (`@cloudflare/vite-plugin`) runs Workers inside the Vite dev server — needs validation with Vite+ (spike S5).
- **Mobile:** Expo (development builds, EAS Build/Submit). Metro, not Vite; it only needs to resolve the
  shared `packages/*` from the Bun workspace (spike S4).

## Environments

- `dev` — local (`vp dev`, Miniflare for DOs), and a deployable `brigade-<app>-dev` Workers environment for shared
  testing.
- `staging` — the `brigade-<app>-staging` Workers environment.
- `production` — the top-level (unsuffixed) Wrangler config, deployed only with owner approval.
- The mobile app points at staging or production via build profile.
- Self-hosted — one Cloudflare account, one `deploy` command, guided setup (Slack app manifest, relay registration).
