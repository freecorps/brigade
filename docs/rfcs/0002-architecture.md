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
| Public status page snapshots (a projection of `WorkspaceDO`'s status tables)        | KV (`STATUS`)                                     | Read at the edge by the public; never wakes a shard      |

**Consistency rule:** a DO is the source of truth for what it owns. Anything copied elsewhere (D1 index,
`WorkspaceDO` incident list) is a projection, updated through the transactional outbox described in RFC 0005,
and may lag by milliseconds. Temporary exception: in spike S3 the `WorkspaceDO` incident index is authoritative
for status and severity until `IncidentDO` exists (RFC 0004, "Shared core"). The public status page's snapshot (KV
`STATUS`, RFC 0012) is not fed by the outbox either: the shard marks it out of date in the change's own transaction
and pushes it from its alarm, so it lags by seconds, longer while a push fails and backs off.

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
  sdk/         Webhook verifier, typed API client, payload types (provider interfaces  (MIT)
               for integrations later)
  i18n/        Message catalogs and formatting helpers (RFC 0008)                      (MIT)
  push/        Push payload encryption (HPKE on WebCrypto) and envelope (RFC 0006)     (MIT)
  ui/          Shared design tokens (web + mobile)                                     (MIT)
integrations/
  slack/       Slack app Worker (RFC 0011): binds to the API's SlackBridge entrypoint (AGPL-3.0)
  ...
spikes/        Throwaway spike code: not product, never published, private packages   (AGPL-3.0)
docs/rfcs/     Design documents
```

`spikes/<name>/` holds code a roadmap spike needs that is not the start of an app (S2's probe Worker). It sits in
the workspace (`spikes/*`) so CI checks and tests it. The PR that records the spike's result tears down what the
spike deployed and deletes the folder; the write-up in `docs/spikes/` is what stays.

The `brigade-events` consumer runs in the api Worker for now (its `queue` handler: push, and email for pages that
failed); it becomes the separate notifier Worker of the runtime map later (RFC 0005 "Notifiers", "Email"). Slack's notifier
runs there too, importing its renderer from `integrations/slack`, because the Slack Worker binds to the API and a
binding back would be a cycle Cloudflare cannot deploy from nothing (RFC 0011 "Shape").

Packages are MIT so third parties can build integrations without AGPL concerns; apps are AGPL (RFC 0009).

## Public HTTP API

Most of Brigade is read and changed over Brigade Sync (RFC 0004): incidents, monitors, schedules, escalation
policies and devices have no REST routes, and none are planned while sync covers them. The HTTP routes an integration
may rely on are few, and they are the contract: [`docs/api/openapi.json`](../api/openapi.json), OpenAPI 3.1, served
without auth at `GET /api/openapi.json` by the dashboard's Worker.

| Public (in the reference)                                                            | Why an integration calls it                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `GET /health`, `GET /health/paging`                                                  | Uptime checks; whether pages are going out        |
| `POST /heartbeat/:token`                                                             | Cron jobs and backups pinging a heartbeat         |
| `POST /workspaces`                                                                   | Provisioning                                      |
| `PATCH`, `DELETE /workspaces/:id/members/:userId`                                    | Role changes, offboarding                         |
| `GET`, `POST /workspaces/:id/invitations`, `DELETE …/:invitationId`, `POST …/resend` | Onboarding from a directory                       |
| `GET /invitations/:id`, `POST …/accept`, `POST …/decline`                            | The invitee's side                                |
| `POST /workspaces/:id/incidents/:incidentId/ack`                                     | Acknowledging from outside the apps               |
| `GET /sync/:id`                                                                      | The sync WebSocket: described, frames not modeled |

Internal, not part of the contract, may change without notice: `/auth/*` (Better Auth's; only sign-in, sign-out and
the session are relied on, and the reference says how), `GET /workspaces/:id` (the dashboard's stack check),
`/account/takeover` (the dashboard's notice), `/workspaces/:id/slack/install` (a browser redirect, RFC 0011),
`POST /receipts` (the iOS extension's delivery receipts, RFC 0006), `PUT /workspaces/:id/status-page` (the
dashboard's status page settings), `POST /workspaces/:id/webhooks` and `POST /workspaces/:id/webhooks/:webhookId/rotate`
(the dashboard's Webhooks card: they answer a new signing secret once, RFC 0005 "Outbound webhooks"; public once API
tokens exist) and `/slack/*`. `GET /status/:slug` is the public status page itself (RFC 0012): HTML
for people, not an API. A JSON read of a status page does not exist yet.

**Source of truth.** Request bodies are converted from the `v.*` validators the routes run (`toJsonSchema` in
`packages/schema`), refusal codes from the status maps the routes answer with (`apps/api/src/http.ts`); the route
list, auth and answers are written by hand in `apps/api/src/openapi.ts`. `vp run --filter @freecorps/brigade-api
openapi` writes the file; `apps/api/test/openapi.test.ts` fails when it is stale, when a documented path answers other
methods than documented, and unless every operation answers its documented status, with a body its schema accepts,
for a basic case (and `401` without a session).

**Auth.** Only the Better Auth session cookie today, with cookie-authenticated writes refusing another site's
`Origin`. **API tokens** (per workspace, scoped, revocable, hashed at rest, sent as `Authorization: Bearer`) are the
next item: they need their own design (who may mint them, which roles they carry, how the shard's RBAC sees them as an
actor) before anything outside a browser can call the API comfortably.

**Webhooks.** The reference's OpenAPI 3.1 `webhooks` section describes what Brigade sends to the endpoints a workspace
registers (RFC 0005 "Outbound webhooks"): one entry per payload `type`, its body converted from that type's validator
(`WEBHOOK_PAYLOADS` in `packages/schema`; event types, list values and fields may be added within `version: 1`, so
lists are an `anyOf` of the known values and any string, and objects are open) and the three
Standard Webhooks headers. The same test checks it is current and that payloads the API signs match their type's schema.

**SDK.** `packages/sdk` (`@freecorps/brigade-sdk`, MIT, 0.1.0, not on npm yet: publishing is the owner's call) is the
reference's client side: `verifyWebhook` (Standard Webhooks on Web Crypto, so Workers, Node 20+, Deno, Bun and
browsers; the payload parsed by the schema package's validators into `WebhookPayload`), `createClient` (one method per
operation above except `openSync`, an injectable `fetch`, the session cookie or a per-request headers hook where API
tokens will go, and `BrigadeApiError` with the codes each operation lists) and the payload types. It bundles the schema
package, so it has no runtime dependencies and no app code; its tests hold its methods, paths and codes to
`docs/api/openapi.json`, and check deliveries the API's own signer made (a fixture `apps/api` keeps current). Build
runs `scripts/check-dist.mjs`: the built files import nothing and verify those deliveries in plain Node.

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
  IP from `cf-connecting-ip`: 3 per 10 s for sign-in and sign-up, 3 per minute for asking for a password reset
  and 10 for setting one, 100 per minute for the other routes, `/get-session` exempt. The organization plugin's routes are refused except the ones the dashboard reads
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
    redirect to append a session to. Password reset never redirects either: its link opens the dashboard's
    `/reset-password` page, which posts the token to `/reset-password`; Better Auth's `GET /reset-password/:token`,
    which would redirect the token to any trusted `callbackURL` (`brigade://…` included), is refused in
    `apps/api/src/index.ts`, and `redirectTo` is dropped from every request for a reset. Before OAuth or magic links
    are enabled, those redirects need PKCE or verified App Links / Universal Links instead of a custom scheme. The plugin also trusts `exp://` (Expo
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
    up. **An address someone else signed up with stays taken:** an account
    nobody verified keeps its address (nothing releases or deletes it), and a sign-up with that address is refused
    as for any taken one. Releasing it was tried and dropped: a verification link holds only the address, so after a
    release an old link would verify the newer account; on an instance without email nobody can ever verify, so a
    timed release would let anyone take any account; and deleting a user there skipped the shard and its outbox
    (devices and escalation targets stayed behind). For the same reason Better Auth's user deletion and email change
    stay off (stated in `authOptions`): an address belongs to one account for good, so a link can only ever verify
    that account. The way back is password reset (below): its link proves control of the address, so using it marks
    the address verified and ends every session. **Unverified accounts sign
    in** and create and use their own workspaces (sign-up creates the first one, and an unproven address harms nobody
    there); what needs a verified address is everything that reaches someone else's inbox or depends on owning the
    address: being emailed by the notifier, inviting (and resending), and accepting or declining an invitation. An
    unverified address can be invited (the invitation email is how its owner learns of it); its owner verifies before
    accepting. The dashboard shows a notice with a resend button until the address is verified; the shared sign-in
    wording (`authErrorMessage`, used by the dashboard and the mobile app) explains `EMAIL_NOT_VERIFIED` in case a
    server requires verification to sign in. Each user has a
    `locale` (`en`, `pt-BR`; D1 `user.locale`), the language Brigade writes to them in: set at sign-up (from the
    dashboard, else `Accept-Language`) and by the dashboard's language switch; the mobile app does not send it yet.
  - **Password reset (built):** Better Auth's (`sendResetPassword`, `revokeSessionsOnPasswordReset`), on the same
    sender. "Forgot your password?" on the dashboard's sign-in page opens `/forgot-password`; the mobile sign-in
    screen opens that page in the browser rather than asking from the app, since the email's link lands on the
    dashboard anyway and the whole reset then happens in one place. Asking (`/request-password-reset`) answers the
    same for every address, with an account or not: the before hook counts the limits and answers, and Better
    Auth's lookup, token and email run after the response (`waitUntil`), so neither the answer nor its timing says
    whether an address has an account. It is limited per address and IP (3 an hour) and per address from anywhere
    (10 a day), counted in D1's `rateLimit` table like verification's, for any address, so a 429 says nothing
    either, and per IP (3 a minute). Keyed by address and IP so that someone asking for another person's address
    uses up their own hourly count, not the owner's; only the daily cap is shared (Q21). Without a sender it answers
    `503 EMAIL_NOT_CONFIGURED` for everyone. The email (`email_reset`, en and pt-BR, escaped) carries the address
    and the link, never the name, and the link is the dashboard's `/reset-password#token=…` (from `DASHBOARD_URL`,
    with the same dev-only fallback as verification): in the fragment, which the browser never sends to a server,
    a proxy's log or a `Referer`. The token is Better Auth's: random, bound to the account (a `verification` row
    holding the user id), usable once, for an hour (`RESET_TTL_S`). The page takes it out of the address bar as
    soon as it reads it. Setting the new password (`/reset-password`, Better Auth's 8 to 128 characters) deletes
    every session of the account and its other reset links, marks its address verified (the link reached the
    address, as a verification link would) and records when (`user.passwordResetAt`), all through Better Auth's
    adapter, and signs the account out of every workspace it belongs to: each shard drops its devices
    (`device.signOut`, a server-only mutation with a `device.unregistered` `password_reset` for each, so phones
    stop getting its pages) and closes its open sockets, which reconnect without a session and are refused. The
    sockets close even when the mutation fails. A shard that fails is tried 3 times; one that still fails is
    logged, the reset stands, and its member reconcile catches up: the failure arms the shard's repair alarm, and
    every reconcile (that alarm, or any member's next sync upgrade) drops a member's devices last registered before
    their `passwordResetAt` and closes their sockets opened before it (`member.reconcile`, RFC 0006 "Who is paged").
    The member's own next sync upgrade does the device part first, before the socket opens (the Worker passes
    `passwordResetAt` with the actor): the app registers the same device id with the same tokens after signing in,
    a register that changes nothing is a `conflict` that leaves the device as it was, and a reconcile after it would
    drop a phone the app shows as paged. `passwordResetAt` is the Worker's clock and a device's last registration
    the shard's; both are Cloudflare's, far closer than the time a person takes to sign in again. If the server
    fails after the password may have been saved, the page says so instead of suggesting the link again. The page
    that confirms the new password says the member's phones get no pages until they sign in to the app again. The
    app registers its phone again at the next sign-in; until then a page that would have reached it takes the
    `no_devices` path (the member, now verified, is emailed for SEV1 and SEV2, and the escalation falls
    back as for anyone without a phone).
    **Taking back an address.** This is how the owner of an address someone else signed up with (and never
    verified) gets it back: they reset the password and the account is theirs, with its address verified. A reset
    is a takeover when the address was not verified before it. Whoever signed up loses every session, phone and
    socket at once. An unverified account cannot invite, accept or decline invitations, or be emailed, so it has
    no pending invitations of its own and is a member of no workspace but those it created, where it is the only
    member. Those workspaces are kept (owned by the account, now the owner's): deleting them is not designed (RFC
    0003), and removing the account from them would leave shards with nobody to own them. But what was set up in
    them can still reach the owner: a heartbeat whose URL the other person kept, or an HTTP or TCP check on a host
    they control, would page the owner whenever they chose. So on a takeover, in every workspace where the account
    is the only member (the shard checks its own member list again, in case someone joined since), the shard also
    pauses every monitor and revokes every heartbeat URL (`monitor.takeOver`, server only, as `ACCOUNT_ACTOR`:
    `monitor.paused` with any firing alert resolved, and `monitor.heartbeat_revoked`, whose hash becomes random
    bytes nobody holds a token for), and the dashboard tells the owner once which workspaces came with the account
    and what was paused, or that a shard could not be reached (`takeover_notice` in D1,
    `GET`/`DELETE /account/takeover`, en and pt-BR; two resets at once merge into one notice). The owner resumes what they
    want to keep and gives a heartbeat they keep a new URL (`monitor.rotateHeartbeat`, New URL in its edit form;
    RFC 0007). Schedules and escalation policies stay: they page
    only members, and only for incidents, which in such a workspace only the owner or a monitor can open. What is
    left is in Q21. The account's name and language are whatever the person who signed up chose; the owner changes
    them in the dashboard. A reset of a verified account signs out the same way (a phone or socket someone who
    learned the password left behind) but pauses nothing: the monitors are the owner's own.
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
