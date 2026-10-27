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
- [x] **S1 — APNs from a Worker and payload encryption** (RFC 0006). Pass: push received on a real iPhone from a
      Worker, decrypted in the Notification Service Extension (needs Apple credentials and a device).
  - Done on the iOS Simulator: a deployed Worker reaches APNs over HTTP/2 (local workerd cannot); HPKE (P-256,
    AES-128-GCM) chosen and shared in `packages/push`; a push sent by `brigade-relay-dev` through the APNs sandbox
    was decrypted by the Notification Service Extension and shown as a time-sensitive banner, and a push it could
    not decrypt showed the fallback ([write-up](spikes/s1-apns-encryption.md)).
  - Done on a real iPhone (EAS preview build, production APNs): a SEV2 page from a heartbeat monitor, sent by the
    deployed `dev` API, arrived on the locked phone as a time-sensitive notification decrypted by the extension
    ([write-up](spikes/s1-apns-encryption.md#real-iphone)).
  - Follow-up: the `pt-BR` fallback with the phone in Portuguese (the device ran in English).
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
    owner once on the dashboard (RFC 0002 "Auth"). `/workspaces/:id` (the stack check) requires membership, so
    `workers_dev` could be turned on (#52).
  - Done: switching workspaces (the dashboard's header lists the member's workspaces, switches and creates a new one;
    the app does the same in its account section, registering the phone in every workspace opened on it at once with
    `POST /devices/register` and saying per workspace whether it is paged, RFC 0006 "Device registration"); sign-up in
    the app; a uniform sign-up answer with a capped notice to the address's owner; sockets closed when their session
    ends (sign-out, a revoked session) or expires, upgrades of an ended session refused, and the phone that signs out
    taken off every workspace of the member, recorded in D1 so a shard that cannot be reached catches up (RFC 0004
    "Session revocation"); sign-in limited per account (5 a minute, skipped for 15 minutes from where a password was
    just reset) as well as per IP (30 a minute); a rate limit on `PATCH`/`DELETE /workspaces/:id/members/:userId` (20
    a minute per member and workspace); rate-limit counters pruned hourly; the widget and the on-call screen name the
    workspace and say "On call in" another one.
  - Left: mobile OAuth/OIDC with PKCE via the system browser and QR pairing (mobile email and password sign-in is
    done, see the Mobile item), and the production and staging secrets (owner approval); applying migrations 0003,
    0004, 0005, 0011 and 0012 to the deployed databases; a `baseURL` per environment (`BETTER_AUTH_URL`, the dashboard's
    `/api/auth` origin) once deployed hostnames exist, so email links point at the dashboard rather than the API
    Worker; repairing a workspace whose shard was never provisioned because the Worker died between the D1 write and
    the RPC, or whose undo failed, and a shard that committed `workspace.create` before its RPC failed and was undone
    (it would announce a workspace D1 no longer has: tombstone it with a compensating event); an admin route to
    revoke another user's sessions (the session hook already closes their sockets once it exists); and whether
    sign-in should require a verified address where email is set up (Q21).
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
    (`MAX_MONITORS_PER_WORKSPACE`), refused as `limit_reached` and said in the form. A new heartbeat URL
    (`monitor.rotateHeartbeat`, owners and admins): New URL in the edit form, confirmed, the old URL refused at once,
    the monitor started over with a fresh interval and grace, and the new URL shown once with Copy (RFC 0007).
  - Also done: HTTP check options: statuses and ranges that count as up (`200, 204, 500-599`), a body pattern in a
    restricted syntax run by a linear-time engine (`packages/schema/src/pattern.ts`, never `RegExp`), and up to 10
    request headers, synced like the URL and refusing `Host`, `Authorization`, `Cookie` and anything credential-like;
    per monitor, how many regions must agree, how many failed checks in a row count, and the severity of the incident
    it opens (defaults unchanged for existing monitors, and their probe configs too); a monitor cap per workspace set
    by owners (`monitor.setCap`) under the instance's (`MAX_MONITORS`, default 100); member names for "Paused by"; and
    a notice in the Monitors card when a region's probe stalls (RFC 0007).
  - Left: whether "No data" pages (Q17); TLS expiry, which Workers cannot read (RFC 0007 "Check types": neither
    `fetch` nor the Sockets API exposes the peer certificate); paging, not only a notice, on a stalled probe (RFC 0007
    "Watching the watcher"); `AlertGroupDO` and alert routes, moving monitor alerts out of the workspace shard;
    revisiting the regions with S2's 48-hour result; the workspace default locale for the incident title (Q15).
- [x] Incidents: declare, severity, status, roles, timeline, updates
  - Timeline as its own synced table written by every incident mutation (and the monitor recovery note), written
    updates, three incident roles checked against the shard's member list, and an incident page in the dashboard
    (`/incidents/<number>`) to change status and severity, assign roles and post updates (RFC 0003).
  - Left for later items: editing an update. Role definitions are done (Phase 3 item). Publishing an update to the status page
    is done (Phase 3 item). Members who join by invitation are in the shard's member list from the moment they accept. The mobile incident screen is done (Mobile item).
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
  - Done on an iPhone (2026-10-27, `dev`): signed in and registered, a page received on the locked phone and
    acknowledged from the notification ([write-up](spikes/s1-apns-encryption.md#real-iphone)).
  - Left: the Acknowledge action from a cold background launch; FCM for Android (until then Android
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
  - Done on `dev` (2026-10-27): a real push end to end from the deployed API through the relay to an iPhone
    ([write-up](spikes/s1-apns-encryption.md#real-iphone)).
  - Left: the production and staging queues (owner approval); `RELAY_SEND_TOKEN` on the deployed API (dev reaches
    its relay through the `RELAY` service binding; production and staging add theirs with their relay's first deploy);
    VoIP call pages on a real iPhone (sent since Phase 2, RFC 0010); FCM for Android
    (Android devices are recorded as `unsupported`); a lower-urgency push for another incident can still replace a
    page stored for an offline phone (the app re-syncing open pages is the fallback, RFC 0006 "Offline phones");
    what is left of who is paged (Q18).
  - Done: "Page again" for a failed page (owners and admins, `incident.pageAgain`, a new page through the outbox, never
    the old event) and a lost SEV1 or SEV2 declaration paged again once on its own (RFC 0005 "Notifiers"); a
    lower-urgency push never replaces a page of the same incident (its own collapse id, and held back while the page
    may be undelivered, RFC 0006 "Offline phones"); a member removed or demoted in D1 outside Brigade stops being
    paged without anyone opening Brigade (a periodic reconcile from the shard's alarm and a check before a page that
    fails open, RFC 0006 "Who is paged", Q18).
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
  - Done: a policy per monitor (picked in the monitor form, shown on its row and on the incident's escalation
    progress; a deleted policy puts its monitors back on the default) and escalating early when every push of a level
    failed, with the timeline saying why (RFC 0003 "Escalation policies", RFC 0006 "Who is paged").
  - Left: a policy per alert route (Phase 3); the mobile on-call
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
    the dashboard's Slack card (Add to Slack, channel id, language, Disconnect). en and pt-BR. Then: a channel per
    incident, opt-in per workspace (all incidents or SEV1 and SEV2 only; `#inc-<n>-<slug>` with `conversations.create`,
    the role holders and paged people invited by verified email, the incident message there and linked from the main
    channel, archived on resolve after a delay or kept, public or private); the timeline mirrored both ways (status,
    severity, role, update and ack entries into the channel, or as a thread under the message without one; `!update`
    and the "Post to Brigade timeline" shortcut become updates as the member), one job at a time per event from the
    queue consumer, idempotent, under the side-connection limiter with Slack's own share; the Events API
    (`url_verification`, `app_uninstalled` and `tokens_revoked` mark the connection revoked); `auth.revoke` on
    Disconnect; `/inc update`, `sev`, `resolve`, `role` and `escalate` (`escalation.now`, the next level now) as the
    member through the shard, and a declare form (`views.open`) with severity, type and services; a channel picker on
    the card from `conversations.list` through the API (RFC 0011).
  - Left: creating the Slack app and the secrets, applying migration 0006 and deploying (owner's call,
    integrations/slack/README.md, Q22); App Home; Enterprise Grid and distribution beyond one app per instance;
    staging and production names.
  - Left: test on a real Slack workspace (owner).
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
    when the paging pipeline degrades (Q19) and to owners when rotations change (Q20). The PSTN notifier is still to
    come.
  - Done: in-app VoIP call paging on iOS (RFC 0010 "When a page rings"): a SEV1 page, and an escalation level of a
    SEV1 or SEV2, rings as a call after its alert push, on every iOS device that registered a PushKit token. The
    queue consumer sends the call through the relay (`kind: "call"`, a call id derived from the page's event) only
    once the relay took the alert; a call that fails is logged and never changes the page's retries, delivery rows
    or escalation. The app registers its PushKit token with `device.register` and again when PushKit changes it;
    answering reads the page aloud and 1 acknowledges with `incident.ack`, as in S6.
  - Done since: each call has a delivery row of its own (`kind: "call"`: planned, handed to the relay, accepted by APNs
    or the error with APNs' reason), synced like the alert's, shown next to each member's outcome on the incident page
    and as its own line in `?why=<member>`, never changing the page's outcome; a VoIP token APNs refuses as gone
    (`BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`) is cleared (`device.expireVoip`,
    `device.voip_cleared`) while the phone keeps its alert pushes; each member chooses which pages ring them (SEV1
    pages and SEV2 escalations, the default; SEV1 only; never) with `member.setCalls`, from the dashboard's Calls card
    and the mobile app's account section, and the queue consumer follows it, the alert push going out either way (RFC
    0010 "Who a call rings").
  - Left: trying it on an iPhone (VoIP Services on the App ID); a per-phone choice of calls; Android calls (FCM).
- [ ] Mobile: on-call view, "I'm on call" widget, critical/time-sensitive notification setup
  - Done: the on-call screen (shifts, overrides, who each schedule has now, covering a shift); pages are
    time-sensitive. The iOS "I'm on call" widget (home screen small, lock screen rectangular and inline): on call
    until when, or the next shift, and the open incidents, from a snapshot the app keeps in the App Group and clears
    on sign-out; it flips at each handoff without the app and asks to open Brigade after 24 hours (RFC 0003
    "Schedules"). Critical Alerts are ready behind the entitlement (RFC 0006 "Critical Alerts"): a build flag, the
    device's capability in `device.register`, and SEV1 pages critical only on phones that allow them, falling back
    to time-sensitive.
  - Left: Apple's Critical Alerts grant (Q8), then turning it on; trying the widget and Critical Alerts on an
    iPhone; an Android widget; Android's alarm channel and DND access (FCM first).
- [x] Delivery receipts and "why wasn't I paged" debugging view
  - Each page is a row per device (`deliveries`, synced to members): planned, handed to the relay, accepted by
    APNs (or the error, with APNs' reason), opened on the phone. The iOS Notification Service Extension reports
    the last with a single-page token sealed inside the page (`POST /receipts`, no session), never waiting on it.
    The incident page lists who was paged; `?why=<member>` explains it step by step (RFC 0006 "Delivery receipts").
  - Done since: call rows (RFC 0010), each up to accepted by APNs (a call has no receipt), shown apart from the page's.
  - Left: receipts from Android (FCM); "shown" and "opened by the person" stages;
    escalating early when every push of a level is refused (Q18); the mobile app's own why-not-paged screen.

## Phase 3 — Parity where it matters (6–8 weeks)

- [ ] Alert sources: Grafana, Datadog, Sentry, generic webhook; alert routes
  - Done (RFC 0005 "Alert sources"): per-workspace sources of four kinds with a secret URL shown once and rotatable,
    an optional header and Sentry's and Grafana's HMAC signatures; payloads normalized to a dedup key, title,
    severity, status, link and labels; ordered routes (open with a severity, type, services and policy; group;
    suppress; drop) with a default that always pages; the route's policy first in the policy order (RFC 0006);
    unreadable payloads paging through the default; caps per workspace; the dashboard's Alert sources card with
    setup per provider, a routes editor and the latest alerts.
  - Left: monitor alerts through the routes and `AlertGroupDO` (RFC 0007); whether a service's policy pages; title
    and severity mapping per source; Slack naming the alerts' actor; email ingest.
- [x] Service catalog; custom fields; incident types; role definitions
  - Done: services per workspace (name, description, tier, owners: schedules or members, an optional escalation
    policy), listed on the dashboard with a page each (owners, who of them is on call, active incidents naming it);
    incident types (default severity, the escalation policy their pages use, required fields), picked when declaring;
    custom fields (text, one choice, several choices, number, link) set on the incident page and shown read-only in
    the app; type, services and fields changed as named mutations with timeline entries (RFC 0003); role definitions
    (RFC 0003 "Role definitions"): up to 15 roles per workspace with a description and a checklist of
    responsibilities, the built-ins renamed or described (the commander never removed, so paging is unchanged),
    incident types listing the roles to fill and the ones they require, assigned on the incident page through the same
    `incident.assignRole` by role id, shown read-only in the app when they are the workspace's own.
  - Done: the catalog over the public HTTP API and the SDK (RFC 0002 "Public HTTP API"): services, incident types and
    custom fields listed, read, made and changed (services removed), and incidents listed by status, severity, type
    and service, through the same mutations, with a session or an API token (`catalog:read`, `catalog:manage`;
    `incident:read` for incidents).
  - Left for later items: a monitor naming the service it watches;
    filtering incidents by field; deleting types and fields and editing role definitions over HTTP; alert routes
    paging a service's policy; enforcing required fields
    at a chosen status (opt-in); editing details from the app.
- [ ] Follow-ups; postmortem draft with Workers AI; exports to R2
  - Done (RFC 0013): follow-ups on incidents (title, owner, due date, open or done, optional issue link), changed by
    responders and up with timeline entries and events, overdue on the reader's calendar, an incident's list on its
    page and the workspace's open ones on the overview and `/follow-ups`, 50 per incident and 500 open per workspace;
    a postmortem per incident in seven plain-text sections, saved over the revision its editor opened (a stale save
    is refused and the editor keeps the text); "Draft with AI" (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` through
    the `AI` binding, in `waitUntil` off the request path, written through a mutation as `sys_ai`, 20 a day per
    workspace, never reading addresses or devices, marked "AI draft — review before sharing" until a member saves);
    exports of an incident or a date range to R2 (`EXPORTS`, `workspaces/<id>/`), owners and admins only, downloaded
    through an authenticated route, expiring after 7 days (refused and deleted on download, swept hourly, lifecycle
    rule as the backstop). Without either binding the feature is hidden and its route answers 503.
  - Left: the `brigade-exports-dev` bucket and its `dev` binding, and the `AI` binding in `dev` (manager's call,
    apps/api/README.md "Deploying dev"); staging and production buckets; the mobile app's follow-ups and postmortem;
    reminders for follow-ups due; revision history (Q24); issue-tracker sync; postmortem templates per type.
- [ ] Public status page with email subscriptions
  - Done (RFC 0012): one page per workspace with a name, an address (`/status/<slug>`, unique across the instance,
    claimed in D1) and a language (en, pt-BR), public or a draft; components in optional groups with a status set by
    hand, shown as the worse of that and their open incidents' impact; publishing an update to the page from the
    incident page (public title, status, impact, components and text, never the internal timeline), with a
    `status_published` timeline entry, and correcting or taking down what was published (`status_corrected`);
    owners and admins manage the page, responders publish and correct, events through the
    outbox. The shard pushes a sanitized snapshot to KV on every change (marked in the change's transaction, retried
    with backoff), and `GET /status/:slug` renders it as HTML with no script or session from KV behind the edge
    cache, so no visitor wakes a shard; 90 days of history. The dashboard's Status page card and the incident
    page's Status page panel.
  - Done (slice 2): email subscriptions from a plain form on the page, double opt-in with signed expiring links,
    one-click unsubscribe (RFC 8058) and a manage link in every email, subscribers in D1 (never the shard or the
    snapshot), counts, CSV export and removal for owners and admins; rate limits per caller and per page, a honeypot,
    the same answer for every address, confirmation caps per address and a daily cap per page; notifications for
    published incidents and maintenance from the queue in batches with their own budget, in the page's language;
    uptime bars (90 daily buckets from linked monitors' alerts, with a text alternative); scheduled maintenance
    (planned by responders and up, started and ended by the shard's alarm, shown on the page and the components). The
    dashboard's Scheduled maintenance card.
  - Done (slice 3): components and groups reordered on the dashboard's Status page card with move up and down buttons
    (`statusComponent.reorder`, the whole order checked so a stale one drops nothing); local times on the page (UTC
    text in `<time datetime>`, rewritten in the visitor's zone by one inline script allowed by its hash in the CSP, the
    cached page the same for everyone); Atom and JSON feeds (`/status/<slug>/feed.atom`, `feed.json`) from the same
    KV snapshot and caches, linked from the page; services linked to components (`statusComponent.linkServices`),
    ticking those components on an incident's first publish, as a suggestion only.
  - Done (slice 4): per-component subscriptions ("Following components"): the subscribe form's components and groups
    as plain checkboxes (nothing ticked is everything, as every earlier subscriber stays), followed by keys that are
    not ids, stored with the subscriber in D1 (migration 0013); the manage link changes the choice or goes back to
    everything (`statusSubscriber.follow`), unsubscribing still one click; incidents and maintenance go only to
    those following one of their components or groups, or everything, and to everyone when they name none; a
    subscriber whose components are all gone hears of everything; per-component counts on the dashboard and a
    `follows` column in the CSV.
  - Left: staging's and production's KV namespaces (`dev` binds `brigade-status-dev`), applying migrations 0008 to 0010 and
    0013 to staging's and production's databases, and 0013 to `dev`'s (owner's call, apps/api README "Status page"); custom domains;
    the mobile app's publish and maintenance actions; Q23.
- [ ] Outbound webhooks; OpenAPI reference; `packages/sdk` published
  - Done: outbound webhooks (RFC 0005 "Outbound webhooks"): owners and admins register up to 20 endpoints per
    workspace on the dashboard's Webhooks card (URL, description, event filter from the public catalog, on and off),
    with a signing secret made on the server, shown once, sealed under `WEBHOOK_SECRET_KEY` and rotatable with a
    24-hour overlap; deliveries from the queue consumer, signed per Standard Webhooks (`webhook-id` is the event id),
    under the monitors' target rules plus https only, retried 5 times over about 5 hours by the shard's alarm, with a
    delivery log of the last 10 attempts, "Send test event", and auto-disable after a day of failures with an email
    to the owners. A slow receiver never holds back a page: not its time, its Queue retries or its connections.
    Versioned payload types in `packages/schema`.
  - The OpenAPI 3.1 reference of the public HTTP routes is in `docs/api/openapi.json`, generated from the route list
    in `apps/api/src/openapi.ts` and the schema package's validators, kept honest by tests, and served at
    `GET /api/openapi.json` (RFC 0002 "Public HTTP API").
  - The reference's `webhooks` section: one entry per payload type, converted from the schema package's payload
    validators (`WEBHOOK_PAYLOADS`), checked against what the API signs.
  - `packages/sdk` (`@freecorps/brigade-sdk`, MIT, ready to publish; 0.2.0 below): `verifyWebhook` (Standard Webhooks on Web
    Crypto, typed payloads and errors), a typed client for the reference's operations, and the payload types; no
    runtime dependencies (RFC 0002 "Public HTTP API").
  - Left: publish `@freecorps/brigade-sdk` to npm (owner); setting `WEBHOOK_SECRET_KEY` on the deployed environments
    (owner's call, apps/api/README.md); replaying a given-up delivery; custom headers per endpoint.
  - Done (RFC 0014): API tokens. Per workspace, minted by owners and admins in the dashboard's API tokens card (name,
    scopes, expiry; shown once), hashed in D1 (`API_TOKEN_KEY` optional), sent as `Authorization: Bearer` on the
    members, invitations, ack and sync routes, acting with the creator's current role within their scopes, rate
    limited per token, revoked at once, `apiToken.created` / `apiToken.revoked` through the outbox; `bearerAuth` in
    the reference and `token` in the SDK.
  - Done: incidents and the catalog in the reference and the SDK (`@freecorps/brigade-sdk` 0.2.0): incidents listed
    (status, severity, type and service filters, cursor pages), read, declared (paged exactly as from the dashboard),
    changed (type, services, custom field values, severity, status) and written to; services, incident types and
    custom fields listed, read, made and changed (services removed). Each write is the named mutation the apps send,
    as the member or API token (`incident:read`, `incident:declare`, `incident:update`, `catalog:read`,
    `catalog:manage`), with an `Idempotency-Key`.
  - Left: changing an incident's title or roles over HTTP (no title mutation yet); publishing 0.2.0 to npm (owner).
  - Left: tokens on the dashboard's internal routes (webhooks, status page, exports, drafts); GitHub secret scanning
    partner registration for `brg_` (owner); setting `API_TOKEN_KEY` on deployed environments (owner).

## Phase 4 — Open source launch (ongoing)

- [ ] One-command self-host deploy + setup wizard (Slack manifest, relay registration)
- [ ] Hosted push relay with terms of service
- [ ] App Store / Play Store release (after CLA is in place)
- [ ] Public site + docs (en, pt-BR); contribution guide; community translations
- [ ] More chat providers (Teams, Discord, Mattermost), UnifiedPush
