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
  - Done: member management: changing roles, removing members and leaving (`/workspaces/:id/members/:userId` and
    the dashboard's Members section), D1 first and then the shard's member list and devices with
    `member.role_changed` / `member.removed`, a reconcile with D1 on every sync upgrade and from the shard's alarm
    after a failed shard step, and the member's open sockets closed on a change (RFC 0003 "Members").
  - Done: email verification (sent at sign-up and on request, rate-limited per user and IP; the dashboard's notice
    and `/verify-email` page) and workspace invitations: owners and admins invite by email with a role, resend and
    revoke from the Members card, and the invitee accepts or declines on `/invitations/:id`, signed in with that
    address and verified. D1 first (prefixed `inv_` rows, one pending per address, migration 0004; the
    cross-workspace send caps, migration 0005), then the shard's
    `member.invited` / `member.added` / `invitation.revoked` / `invitation.declined` with the members' repair, the
    invitation email from the outbox, 7-day expiry and per-workspace caps (RFC 0002 "Auth", RFC 0003 "Invitations").
  - Done: password reset ("Forgot your password?" on the dashboard's sign-in, and on the mobile sign-in screen as a
    link to that page; the same answer for any address, limited per address and IP; the dashboard's
    `/reset-password` page). Saving the new password ends every session, signs the account's devices and sockets out
    of each workspace (`device.signOut`, with the member reconcile as its fallback) and marks the address verified,
    which is how the owner of an address someone else signed up with takes the account back; that takeover also
    pauses the monitors and revokes the heartbeat URLs of the workspaces the account is alone in, and tells the
    owner once on the dashboard (RFC 0002 "Auth").
  - Left: switching workspaces in the
    UI, closing open sockets on sign-out or a revoked session (RFC 0004 "Session revocation"), mobile OAuth/OIDC with PKCE
    via the system browser and QR pairing (mobile email and password sign-in is done, see the Mobile item),
    putting `/workspaces/:id` (the stack check) behind auth before `workers_dev` is turned on, and the production
    and staging secrets (owner approval). Also: a uniform sign-up response (the same answer whether or not the email
    is taken, so sign-up cannot enumerate accounts; until then only rate limiting slows it); applying
    migrations 0003, 0004 and 0005 to the deployed databases; a `baseURL` per environment (`BETTER_AUTH_URL`, the dashboard's `/api/auth` origin)
    once deployed hostnames exist, so email links point at the dashboard rather than the API Worker; repairing a
    workspace whose shard was never provisioned because the Worker died between the D1 write and the RPC, or whose
    undo failed, and a shard that committed `workspace.create` before its RPC failed and was undone (it would
    announce a workspace D1 no longer has: tombstone it with a compensating event); and sign-in limits keyed by
    account as well as IP, since 3 tries per 10 s per IP can briefly lock out a team behind one NAT; and a rate limit
    on `PATCH`/`DELETE /workspaces/:id/members/:userId` (per member and workspace), since each call reads D1 and
    wakes the shard.
- [ ] Monitors (HTTP/TCP/heartbeat) with quorum → alerts → incidents
  - Done: HTTP, TCP and heartbeat monitors as mutations in `packages/schema` (owners and admins manage, everyone reads),
    one `ProbeDO` per workspace and region with `locationHint` (only the six regions where objects spawn, S2), each
    result with the colo it ran from; SSRF rules on save and before every request, no redirects followed, bounded
    body and timeout; `POST /heartbeat/:token` with a hashed secret; majority quorum and 2 consecutive checks per
    region; one alert per monitor opening an incident through `incident.declare` as the system actor `sys_monitors`,
    resolved on recovery; alarm chains that reschedule first, and a shard alarm that re-pushes configs and catches
    missed heartbeats; a Monitors card in the dashboard (create, pause and resume) (RFC 0007).
  - Also done: a separate restart guard (`restartedAt`), fresh-only quorum with a "No data" status, refreshes
    without outbox events, heartbeat routing checked against D1, a port list for checks; in the dashboard, failure
    reasons, waiting and no-data chips, a confirmed pause with who paused it, the down row's incident link, and a
    one-time heartbeat URL with Copy and a `curl` example; editing a monitor in place (owners and admins; the kind
    stays, an edit that changes nothing sends nothing, and the form says when saving starts the checks over) and
    deleting it from the edit form, confirmed with what happens to its firing alert and its incidents and, for a
    heartbeat, its URL. TCP checks with `connect()`: up when the connection opens within the timeout, closed on
    every path, in the probe's pool of six; the same host rules as HTTP, no Cloudflare address, and any port but 25;
    host and port in the dashboard's form and rows (RFC 0007 "Check types"). At most 100 monitors per workspace
    (`MAX_MONITORS_PER_WORKSPACE`), refused as `limit_reached` and said in the form.
  - Left: a per-plan or configurable monitor cap in place of the one 100 for every workspace; regenerating a
    heartbeat URL (no mutation for it yet); whether "No data" pages (Q17); member names for "Paused by" (today "you" or "a teammate"; the shard's member list now has them); regex,
    headers and TLS expiry; configurable quorum and severity; alerting on a stalled probe (RFC 0007 "Watching the
    watcher"; today it is logged and re-pushed); `AlertGroupDO` and alert routes, moving monitor alerts out of the
    workspace shard;
    revisiting the regions with S2's 48-hour result; the workspace default locale for the incident title (Q15).
- [x] Incidents: declare, severity, status, roles, timeline, updates
  - Timeline as its own synced table written by every incident mutation (and the monitor recovery note), written
    updates, three incident roles checked against the shard's member list, and an incident page in the dashboard
    (`/incidents/<number>`) to change status and severity, assign roles and post updates (RFC 0003).
  - Left for later items: publishing an update to a status page (Phase 3), role definitions (Phase 3), editing an
    update. Members who join by invitation are in the shard's member list from the moment they accept. The mobile incident screen is done (Mobile item).
- [ ] Brigade Sync in production for web + mobile
  - Done so far: D1 `brigade-db` and `brigade-db-staging` exist with the migrations applied. Left: production and
    staging queues, the first deploy, and the relay's production secrets.
- [x] Web dashboard: incident list/detail, monitors
  - The incident list, the incident page (`/incidents/<number>`), the Monitors card (create, edit, pause, delete;
    HTTP, TCP and heartbeat) and the Members card.
- [ ] Mobile: login, incident list/detail, push via relay, ack from notification
  - Done: email and password sign-in and sign-out with Better Auth's Expo integration (`@better-auth/expo`: the
    session in secure storage, sent as a `Cookie` header on Better Auth's routes and on the sync upgrade; the app's
    `brigade://` a trusted origin; the plugin's open-redirect proxy refused), one sync client per member and
    workspace, closed on sign-out; the member's workspace as the incident list (read-only for viewers) with an
    account section; an incident screen (`/incidents/<number>`) with severity and status, roles, written updates and
    the timeline, as on the dashboard; the phone registered with `device.register` on sign-in and unregistered on
    sign-out, with whether it is paged shown (a sign-out offline is kept and finished later, and registering that
    found the phone taken or failed is retried on a backoff and from Try again); a sync heartbeat, so a half-open
    socket (the network gone without a close) shows as reconnecting, not Live (RFC 0004 "Heartbeat"); incident and sign-in wording shared with the dashboard through
    `packages/i18n` and `packages/sync` (#20) (RFC 0002 "Auth", RFC 0004 "Socket topology", RFC 0006 "Device
    registration"); changes the shard has not confirmed kept across a restart, in a file per member and workspace
    with the sync client's id, shown again as not sent yet and sent with the same ids once online, and dropped on
    sign-out (RFC 0004 "Clients").
  - Done: ack from the notification on iOS: an Acknowledge action on decrypted pages (Face ID or the passcode on a
    locked phone), sent in the background over HTTPS as `incident.ack` (`POST /api/workspaces/:id/incidents/:id/ack`,
    idempotent per tap, so it stops the escalation run like any ack) and answered with a quiet notification;
    offline, the answer is a page again with the action (RFC 0004 "Acknowledging from a notification", RFC 0006
    "Acting from the notification").
  - Left: ack from the notification on an iPhone (the action, a locked phone, a cold background launch); the iOS end to end on
    a phone (sign in, registered, a page received and opened on its incident); FCM for Android (until then Android
    says it is not paged); OAuth/OIDC with PKCE and QR pairing; switching workspaces in the app (it opens the
    session's active one); creating an account or workspace from the app; editing and deleting updates; a tablet
    layout.
- [ ] Event outbox + queue + push notifier
  - Done: the shard alarm drains the outbox to `brigade-events` (`-dev`, `-staging`) in commit order, in bounded
    batches, deleting rows only after the send, with exponential backoff; a consumer in the API Worker routes events
    to the push notifier, which pages on a declared incident (SEV1 and SEV2 at `page` urgency) or a severity raised
    into SEV1 or SEV2, seals one push per device (HPKE) and sends it through the relay with the device's APNs
    environment; a per-event ledger in the shard makes redeliveries page nobody twice; relay failures retry (5, 10,
    20, 40 s), then `notification.failed` and a "Couldn't page …" entry on the incident's timeline, also for each
    member the page was for without a device (a commander without one falls back to everyone who can respond) and
    for a page the Queue dead-lettered (the same Worker consumes `brigade-events-dlq` once); devices register
    with `device.register` (server-only, own devices only) and the app registers the phone on sign-in
    (RFC 0005 "Notifiers", RFC 0006 "Device registration", "Who is paged"). Queue `brigade-events-dev` and its
    dead-letter queue `brigade-events-dlq-dev` exist; the dead-letter consumer is created on the next deploy.
  - Left: the production and staging queues (owner approval); `RELAY_URL` and `RELAY_SEND_TOKEN` on the deployed API;
    a real push end to end from the deployed API to a device; VoIP call pages (`kind: "call"`, Phase 2 with RFC 0010); FCM for Android
    (Android devices are recorded as `unsupported`); replaying dead-lettered pages (today they are recorded, not
    re-sent); a member removed or demoted in D1 outside Brigade is still paged until the next sync upgrade
    reconciles the shard (RFC 0006 "Who is paged", Q18); holding back lower-urgency pushes while a page may be undelivered (RFC 0006
    "Offline phones"); what is left of who is paged (Q18).
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
- [x] i18n plumbing (en, pt-BR)
  - Paraglide messages in `packages/i18n` with `en` and `pt-BR` for every user-facing string on the dashboard and
    the mobile app, a language switch, and wording shared between them (RFC 0008).

## Phase 2 — On-call (4–6 weeks)

- [ ] Schedules, rotations, overrides; escalation policies with timeouts
  - Done: schedules with stacked layers (members in order, handoff date and time, hours, days or weeks, the
    schedule's IANA time zone, wall-clock handoffs through DST) and overrides, as mutations in the workspace shard
    with `schedule.*` events; `onCallAt` and `nextHandoffs`; owners and admins manage, responders add and remove
    their own overrides; a member removed or made a viewer leaves the rotations and loses their overrides; the
    dashboard's On-call card lists schedules with who is on call now and the next handoffs, edits them and adds
    overrides (RFC 0003 "Schedules").
  - Done: escalation policies (ordered levels of schedules and people, a timeout per level, repeats, one default
    policy) that page whoever is on call instead of the interim rule; runs started by the first page, advanced by
    the shard's alarm, stopped by `incident.ack` or a resolve, with every level an `escalation.paged` event and a
    timeline entry; unreachable levels skipped at once and the interim rule as the last fallback; the dashboard's
    Escalation card and an incident's escalation progress (RFC 0003 "Escalation policies", RFC 0006 "Who is paged").
  - Left: a policy per monitor or alert route; escalating early when a level's pushes all fail; the mobile on-call
    view and "I'm on call" (the Mobile item); schedules on teams (Better Auth teams); layer
    restrictions (only some hours or days); a calendar view and export (iCal); telling someone their shift starts;
    Q20.
- [ ] Slack app: `/inc`, incident channels, timeline mirror, ack buttons
  - Done (RFC 0011): the Slack Worker (`integrations/slack`, `brigade-slack-dev`) behind the dashboard's origin, every
    request verified (signing secret, 5-minute window, raw-body HMAC, constant-time check) and answered within 3 s
    with the work in `waitUntil`; OAuth v2 install per Slack workspace by owners and admins (one-time state bound to
    the browser by a cookie), the bot token sealed (AES-256-GCM, `SLACK_TOKEN_KEY`) in the workspace shard and the
    team routed in D1 (`slack_team`); Slack users mapped to members by Slack-confirmed email (the team's own users,
    a verified Brigade address), unmapped users refused; the bot token kept in the API;
    `/inc declare <title> [sev1-4]` and `/inc ack [INC-n]` and an Acknowledge button, run as the member through the
    shard (`incident.declare`, `incident.ack`: same RBAC, events and escalation stop as the dashboard); one message per
    incident in a configured channel, posted on declare and updated on ack, status and severity by the queue consumer,
    idempotent per event, retried (Slack's `Retry-After` on 429), and a `slack_failed` timeline entry when it gives up;
    the dashboard's Slack card (Add to Slack, channel id, language, Disconnect). en and pt-BR.
  - Left: creating the Slack app and the secrets, applying migration 0006 and deploying (owner's call,
    integrations/slack/README.md, Q22); a channel per incident; mirroring the
    timeline both ways; `/inc` subcommands beyond declare and ack (update, severity, resolve), Escalate and modals;
    App Home; the Events API (`app_uninstalled`, `tokens_revoked`); revoking the token on Disconnect; a channel
    picker; Enterprise Grid and distribution beyond one app per instance; staging and production names.
- [ ] Email notifier; in-app VoIP call paging (RFC 0010); optional PSTN notifier (provider-agnostic)
  - Done: the email notifier (RFC 0005 "Email"): a provider-agnostic `EmailSender`, Cloudflare Email Sending through
    the `send_email` binding (every environment; the sender is the secret `EMAIL_FROM`, so no domain is in the repo),
    and a double that logs what would be sent under `vp run dev`. It emails a member a SEV1 or SEV2 page missed (once
    per incident) and the owners when a page reached nobody and nothing else will page (Q18), both on by default
    (`workspace.setEmail`). Emails are plain text and escaped HTML in each user's language (a new `user.locale`, set
    by the dashboard), go out from the queue consumer with an email ledger in the shard, are retried with backoff,
    and a failure is an `email_failed` entry on the timeline. Push never waits on email. Capped at 5 emails per user
    per hour and 200 per workspace per day.
  - Done since: the notifier emails verified addresses only, and the same sender sends email verification, password
    reset and invitations (RFC 0005 "Email", "Abuse").
  - Left: onboarding a sending domain and setting `EMAIL_FROM` (and `DASHBOARD_URL`) per environment, and applying
    migrations 0003, 0004 and 0005 to the deployed databases (owner's call, apps/api/README.md "Email"); verification no
    longer blocks it. A dashboard switch for the two settings; a per-member opt-out; the mobile app sending the
    user's language. Next on the same sender: an email to operators
    when the paging pipeline degrades (Q19) and to owners when rotations change (Q20). VoIP call paging and the PSTN
    notifier are still to come.
- [ ] Mobile: on-call view, "I'm on call" widget, critical/time-sensitive notification setup
- [x] Delivery receipts and "why wasn't I paged" debugging view
  - Each page is a row per device (`deliveries`, synced to members): planned, handed to the relay, accepted by
    APNs (or the error, with APNs' reason), opened on the phone. The iOS Notification Service Extension reports
    the last with a single-page token sealed inside the page (`POST /receipts`, no session), never waiting on it.
    The incident page lists who was paged; `?why=<member>` explains it step by step (RFC 0006 "Delivery receipts").
  - Left: receipts from VoIP call pushes (RFC 0010) and Android (FCM); "shown" and "opened by the person" stages;
    escalating early when every push of a level is refused (Q18); the mobile app's own why-not-paged screen.

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
