# Roadmap

Rough sizing assumes 1–2 developers. Each phase ends with something usable internally at Freecorps.

## Instructions for the manager

Run this with the `manager` skill ("use the manager skill and work through `docs/roadmap.md`").

- Work **top to bottom**: take the first unchecked item that is not blocked on Heitor. Re-read this file before each task; Heitor steers by
  editing it (reordering, adding detail, adding items).
- The PR that completes an item ticks its checkbox (`- [x]`). A partly done item stays unchecked, with a
  sub-bullet saying what is left.
- Spikes end with a write-up in `docs/spikes/<id>-<slug>.md` (question, what was tried, result, decision) and
  update the RFC or `docs/open-questions.md` they settle, in the same PR.
- Items marked as needing Heitor (credentials, accounts, deploys) are prepared as far as possible, then he is
  asked; meanwhile, continue with the next unblocked item.
- Stop at the end of each phase and report, so Heitor can review the phase before the next one starts.

## Phase 0 — Spikes (1–2 weeks)

Validate the risky assumptions before writing product code. Each spike produces a short write-up in
`docs/spikes/` and updates the RFC or open question it settles.

- [x] **S5 — Tooling skeleton.** Pass: `vp dev` runs the SPA and the Worker (with a Durable Object) locally;
      `vp check`, `vp run -r test` and `vp run -r build` pass in CI.
  - `apps/api`: Worker + one Durable Object, `wrangler.jsonc`, Cloudflare Vite plugin under Vite+.
  - `apps/web`: React + TanStack Router + Tailwind + shadcn/ui (`shadcn init`), light and dark themes from day one.
  - `packages/ui`: design tokens (color, spacing, type, radius, motion) consumed by `apps/web`; shadcn restyled to them.
  - `packages/i18n`: Paraglide with `en` and `pt-BR`, wired into `apps/web`.
- [x] **S3 — Sync engine prototype** (RFC 0004). Pass: two browser tabs and one Expo client stay in sync;
      reconnect resumes from the last version.
  - One `WorkspaceDO` with `subscribe` / `mutate` / `resume`; `packages/sync` with `useQuery` / `useMutation`.
  - Two dashboard tabs, the iOS Simulator and the Android emulator stayed in sync on one shard, and dropped iOS
    and Android sockets resumed from their last version with a patch ([write-up](spikes/s3-sync-engine.md)).
- [x] **S4 — Expo in the workspace.** Pass: development build runs on the iOS Simulator importing `packages/*`
      through Metro; `eas build` succeeds (needs Heitor's EAS account); Hermes `Intl.PluralRules`,
      `RelativeTimeFormat` and `dateStyle`/`timeStyle` checked (polyfill if missing); Hermes regex Unicode
      property escapes checked (`UNICODE_PROPERTY_ESCAPES` from `packages/schema` is `true`, RFC 0004).
  - Done on Android: `apps/mobile` development build on the emulator, `packages/*` from source through Metro,
    Hermes `Intl` checked and polyfilled, regex Unicode property escapes supported (`UNICODE_PROPERTY_ESCAPES`
    is `true`; an emoji title is accepted, a zero-width space rejected) ([write-up](spikes/s4-expo-workspace.md)).
  - Done on iOS: development build on the iPhone 17 Simulator (iOS 27), the same `Intl` results and regex
    property escapes as Android, except that a medium date and time are joined with " at " instead of ", "; the
    launch screen now uses the splash ground ([write-up](spikes/s4-expo-workspace.md)).
  - `eas build` succeeded for Android and iOS under the Freecorps EAS organisation; the Android build ran on the
    emulator ([write-up](spikes/s4-expo-workspace.md#eas-build)).
- [ ] **S2 — Probe placement** (RFC 0007). Pass: observed colo per `locationHint` over 48h (deploy needs Heitor's approval).
  - Deployed as `brigade-probe-dev` and sampling every hint since 2026-10-25; first samples in the
    [write-up](spikes/s2-probe-placement.md). Left: read the 48-hour result and settle RFC 0007 "Placement".
- [ ] **S1 — APNs from a Worker and payload encryption** (RFC 0006). Pass: push received on a real iPhone from a
      Worker, decrypted in the Notification Service Extension (needs Apple credentials and a device).
  - Done on the iOS Simulator: a deployed Worker reaches APNs over HTTP/2 (local workerd cannot); HPKE (P-256,
    AES-128-GCM) chosen and shared in `packages/push`; a push sent by `brigade-relay-dev` through the APNs sandbox
    was decrypted by the Notification Service Extension and shown as a time-sensitive banner, and a push it could
    not decrypt showed the fallback ([write-up](spikes/s1-apns-encryption.md)).
  - Left: verify on a real iPhone (locked, in the background, in `pt-BR`).
- [ ] **S6 — VoIP call screen** (RFC 0010). Pass: locked iPhone and Android ring natively; answering plays the
      incident and accepts "ack" (needs Apple credentials and devices).
  - Done on the Android emulator (API 36, PIN-locked): a page rang through a self-managed `ConnectionService`, a
    `CallStyle` notification and a full-screen ringing screen over the keyguard; answering read the incident with
    text-to-speech and "1 Acknowledge" sent the new `incident.ack` mutation through Brigade Sync; without
    full-screen intents it fell back to a page notification ([write-up](spikes/s6-voip-call-screen.md)).
  - Done on the iOS Simulator up to CallKit's UI: `brigade-relay-dev` sent a VoIP push (`kind: call`) that reached
    the Simulator, was decrypted in the app and reported to CallKit, which then ended it because the Simulator has
    no call UI.
  - Left: on an iPhone (VoIP Services on the App ID), a locked phone rings through CallKit, answering reads the
    incident and 1 on CallKit's keypad acknowledges; on an Android phone, the same with real audio, Do Not
    Disturb and, once FCM exists, a high-priority data message.

## Phase 1 — Core loop (4–6 weeks)

- [ ] Auth (Better Auth), workspaces, members
  - Done: Better Auth on Workers + D1 (email and password, cookie sessions), a workspace created at sign-up with
    its creator as `owner`, sign-up, sign-in and sign-out in the dashboard, and the sync upgrade authenticated:
    the Worker resolves the session and the member's role and hands the shard a verified actor (401 without a
    session, 403 for a non-member or a cross-site page); the dev actor is local-only (variable and a local host).
    Secure cookies over HTTPS, rate limiting in D1 (sign-in and sign-up 3 per 10 s per IP), organization routes
    that would skip events refused, and a failed shard provision undone. D1 `brigade-db-dev` exists with the
    migrations applied.
  - Left: invitations and member management (roles, removal, with `member.*` events), switching workspaces in the
    UI, closing open sockets on sign-out or role change (RFC 0004 "Session revocation"), mobile sign-in (PKCE via
    the system browser, QR pairing, bearer tokens on the upgrade), password reset (needs the email notifier),
    putting `/workspaces/:id` (the stack check) behind auth before `workers_dev` is turned on, and the production
    and staging D1 databases and secrets (owner approval). Also: email verification (needs the email notifier), then
    a uniform sign-up response (the same answer whether or not the email is taken, so sign-up cannot enumerate
    accounts; until then only rate limiting slows it); invitations, which need verified emails and Brigade's
    prefixed ids on the invitation rows they create, and which re-open the organization routes refused now, each
    with its `member.*` event; a `baseURL` per environment (`BETTER_AUTH_URL`, the dashboard's `/api/auth` origin)
    once deployed hostnames exist, so email links point at the dashboard rather than the API Worker; repairing a
    workspace whose shard was never provisioned because the Worker died between the D1 write and the RPC, or whose
    undo failed, and a shard that committed `workspace.create` before its RPC failed and was undone (it would
    announce a workspace D1 no longer has: tombstone it with a compensating event); and sign-in limits keyed by
    account as well as IP, since 3 tries per 10 s per IP can briefly lock out a team behind one NAT.
- [ ] Monitors (HTTP/TCP/heartbeat) with quorum → alerts → incidents
  - Done: HTTP and heartbeat monitors as mutations in `packages/schema` (owners and admins manage, everyone reads),
    one `ProbeDO` per workspace and region with `locationHint` (only the six regions where objects spawn, S2), each
    result with the colo it ran from; SSRF rules on save and before every request, no redirects followed, bounded
    body and timeout; `POST /heartbeat/:token` with a hashed secret; majority quorum and 2 consecutive checks per
    region; one alert per monitor opening an incident through `incident.declare` as the system actor `sys_monitors`,
    resolved on recovery; alarm chains that reschedule first, and a shard alarm that re-pushes configs and catches
    missed heartbeats; a Monitors card in the dashboard (create, pause and resume) (RFC 0007).
  - Also done: a separate restart guard (`restartedAt`), fresh-only quorum with a "No data" status, refreshes
    without outbox events, heartbeat routing checked against D1, a port list for checks; in the dashboard, failure
    reasons, waiting and no-data chips, a confirmed pause with who paused it, the down row's incident link, and a
    one-time heartbeat URL with Copy and a `curl` example.
  - Left: TCP checks (`connect()`); editing and deleting monitors in the dashboard (the mutations exist); regenerating
    a heartbeat URL; whether "No data" pages (Q17); member names for "Paused by" (today "you" or "a teammate"; the shard's member list now has them); regex,
    headers and TLS expiry; configurable quorum and severity; alerting on a stalled probe (RFC 0007 "Watching the
    watcher"; today it is logged and re-pushed); `AlertGroupDO` and alert routes, moving monitor alerts out of the
    workspace shard;
    revisiting the regions with S2's 48-hour result; the workspace default locale for the incident title (Q15).
- [x] Incidents: declare, severity, status, roles, timeline, updates
  - Timeline as its own synced table written by every incident mutation (and the monitor recovery note), written
    updates, three incident roles checked against the shard's member list, and an incident page in the dashboard
    (`/incidents/<number>`) to change status and severity, assign roles and post updates (RFC 0003).
  - Left for later items: publishing an update to a status page (Phase 3), role definitions (Phase 3), editing an
    update, member names from invitations (members appear once they open Brigade), and the mobile incident detail.
- [ ] Brigade Sync in production for web + mobile
  - Done so far: D1 `brigade-db` and `brigade-db-staging` exist with the migrations applied. Left: production and
    staging queues, the first deploy, and the relay's production secrets.
- [ ] Web dashboard: incident list/detail, monitors
  - Done so far: the incident list, the incident page (`/incidents/<number>`) and the Monitors card.
- [ ] Mobile: login, incident list/detail, push via relay, ack from notification
- [ ] Event outbox + queue + push notifier
  - Done: the shard alarm drains the outbox to `brigade-events` (`-dev`, `-staging`) in commit order, in bounded
    batches, deleting rows only after the send, with exponential backoff; a consumer in the API Worker routes events
    to the push notifier, which pages on a declared incident (SEV1 and SEV2 at `page` urgency) or a severity raised
    into SEV1 or SEV2, seals one push per device (HPKE) and sends it through the relay with the device's APNs
    environment; a per-event ledger in the shard makes redeliveries page nobody twice; relay failures retry (5, 10,
    20, 40 s), then `notification.failed` and a "Couldn't page …" entry on the incident's timeline, also for each
    member the page was for without a device (a commander without one falls back to everyone who can respond) and
    for a page the Queue dead-lettered (the same Worker consumes `brigade-events-dlq` once); devices register
    with `device.register` (server-only, own devices only) and the `/push` dev screen registers the phone
    (RFC 0005 "Notifiers", RFC 0006 "Device registration", "Who is paged"). Queue `brigade-events-dev` and its
    dead-letter queue `brigade-events-dlq-dev` exist; the dead-letter consumer is created on the next deploy.
  - Left: the production and staging queues (owner approval); `RELAY_URL` and `RELAY_SEND_TOKEN` on the deployed API;
    a real push end to end from the deployed API to a device; registering from mobile sign-in (and unregistering on
    sign-out) instead of the dev screen; the local dev actor is not in the shard's member list, so a phone on
    `vp dev` registers but is not paged; VoIP call pages (`kind: "call"`, Phase 2 with RFC 0010); FCM for Android
    (Android devices are recorded as `unsupported`); replaying dead-lettered pages (today they are recorded, not
    re-sent); the `member.*` mutations must update the shard's member cache (role changed; removed: row and devices
    deleted), since until then a member removed or demoted in D1 outside Brigade is still paged (RFC 0006 "Who is
    paged"); a handed-over phone (same install id, another member) keeps paging the first member until mobile
    sign-in and sign-out register and unregister it; delivery receipts
    and "why wasn't I paged" (Phase 2); holding back lower-urgency pushes while a page may be undelivered (RFC 0006
    "Offline phones"); who is paged before schedules (Q18).
- [x] External dead-man switch
  - A Cron Trigger beats once a minute into the `WatchdogDO`'s outbox; the beat goes through the alarm, the outbox
    drain, the `brigade-events` Queue and the consumer, which checks the relay takes its send token; only a beat proved
    end to end, within 2 minutes, with the relay up pings the operator's `DEAD_MAN_URL` (a secret; any healthchecks.io-style
    check outside Cloudflare), so silence anywhere trips the external check. `GET /health/paging` and a dashboard
    notice show `degraded` (no beat, nothing proved for 3 minutes, proofs late, relay refusing the token, down or not
    configured; reasons only to members); status changes are
    `brigade.status_changed` events. Local double: `scripts/dead-man-double.mjs` (RFC 0007 "Watching the watcher").
  - Left: deploying it (the `WatchdogDO` migration `v3` and the cron ship with the next API deploy) and setting
    `DEAD_MAN_URL` on `brigade-api-dev` and later environments (owner's call, an account outside Cloudflare); proving
    each shard's own drain, APNs and D1, telling someone inside Brigade when it degrades, and an instance-operator
    role for `/health/paging`'s `external` (Q19).
- [ ] i18n plumbing (en, pt-BR)

## Phase 2 — On-call (4–6 weeks)

- [ ] Schedules, rotations, overrides; escalation policies with timeouts
- [ ] Slack app: `/inc`, incident channels, timeline mirror, ack buttons
- [ ] Email notifier; in-app VoIP call paging (RFC 0010); optional PSTN notifier (provider-agnostic)
- [ ] Mobile: on-call view, "I'm on call" widget, critical/time-sensitive notification setup
- [ ] Delivery receipts and "why wasn't I paged" debugging view

## Phase 3 — Parity where it matters (6–8 weeks)

- [ ] Alert sources: Grafana, Datadog, Sentry, generic webhook; alert routes
- [ ] Service catalog; custom fields; incident types; role definitions
- [ ] Follow-ups; postmortem draft with Workers AI; exports to R2
- [ ] Public status page with email subscriptions
- [ ] Outbound webhooks; OpenAPI reference; `packages/sdk` published

## Phase 4 — Open source launch (ongoing)

- [ ] One-command self-host deploy + setup wizard (Slack manifest, relay registration)
- [ ] Hosted push relay with terms of service
- [ ] App Store / Play Store release (after CLA is in place)
- [ ] Public site + docs (en, pt-BR); contribution guide; community translations
- [ ] More chat providers (Teams, Discord, Mattermost), UnifiedPush
