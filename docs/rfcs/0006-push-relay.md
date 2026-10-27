# RFC 0006 — Push notifications and the relay

- Status: Draft

## Problem

APNs and FCM only accept pushes signed with credentials of the account that published the app. If Freecorps
publishes "Freecorps Brigade" on the stores, a self-hosted instance cannot push to it directly.

## Design: encrypted relay (same family as Bitwarden / ntfy)

```
App ──(1) register native APNs/FCM token──▶ Relay ──▶ opaque handle
App ──(2) pair via QR: handle + device public key──▶ Instance
Instance ──(3) encrypt payload with device key; (4) push(handle, ciphertext, urgency), signed──▶ Relay ──▶ APNs/FCM
Device ──(5) iOS Notification Service Extension / Android data message decrypts and displays
```

- **Relay sees no content.** Only a handle, a ciphertext and an urgency level.
- **Handles are bound to an instance.** Instance X cannot push to devices paired with instance Y.
- **Instances self-register** with an Ed25519 key pair (no account). The relay enforces per-instance rate limits and can revoke.
- **Fallback text:** if decryption fails (rotated key, corrupted payload), show "New alert — open Brigade". Never silent.
  The payload carries it as localization keys (`title-loc-key: push_fallback_title`, `loc-key: push_fallback_body`),
  so the relay needs neither content nor the recipient's language; the app bundle carries the strings from
  `packages/i18n`. The extension shows the same strings when it cannot decrypt.
- **Encryption: HPKE (RFC 9180)**, base mode, single shot, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM,
  `info` = `"app.freecorps.brigade push v1"` (decided in spike S1, [write-up](../spikes/s1-apns-encryption.md)). It is
  one CryptoKit call in the iOS extension (`HPKE.Recipient`, iOS 17+; iOS 16 shows the fallback) and Tink's HPKE on
  Android, and `packages/push` implements it on WebCrypto with no dependency (RFC 9180 test vector A.3.1 in its
  tests). Web Push encryption (RFC 8291) was rejected: no native API on either platform. P-256 rather than X25519 so
  the device key can move into the Secure Enclave or StrongBox later. The APNs payload is
  `{ aps: { alert: <fallback keys>, mutable-content: 1, … }, brigade: { v: 1, enc, ct } }`, with `enc` and `ct`
  base64url and at most 2048 bytes of plaintext.
- **Device key:** created by the app on first use; on iOS a Keychain item in the App Group
  `group.app.freecorps.brigade` (which is also its Keychain access group), readable after first unlock, this device
  only, so the extension can read it while the phone is locked.
- **What the relay can still do.** It cannot read content, but in the spike's base-mode envelope it could replay
  an old push or raise its urgency (`interruption-level` is in clear), and anyone with a device public key and
  relay access could forge one. Before production: seal `iat`, the instance id and the urgency inside the
  plaintext, let the extension take the interruption level from the decrypted urgency and fall back on stale
  pushes, then authenticate the sender (HPKE auth mode or the instance's Ed25519 signature).
- **Offline phones:** pushes carry an `apns-expiration` by urgency (pages 15 minutes; the relay refuses "try once"
  for a page). APNs keeps only the latest undelivered push per app and device, so a later push (even a `low`
  status update) replaces a stored page. Before production: the app re-syncs open pages when it reconnects or comes
  to the foreground, and the instance holds back lower-urgency pushes to a device while a page to it may be
  undelivered (or re-sends the page after them). This is a paging path: it needs a fallback and a test.
- **Calls (RFC 0010).** `POST /send` with `kind: "call"` sends a PushKit VoIP push (`apns-push-type: voip`, topic
  `<bundle id>.voip`, priority 10) whose body is only `{ call: { id }, brigade: <envelope> }`. The relay refuses a call
  that is not a `page` or has no lowercase UUID id, and keeps it 60 seconds by default (at most 5 minutes), because
  iOS terminates an app that receives a VoIP push and reports no call. Devices register a separate PushKit token for
  calls (spike S6, [write-up](../spikes/s6-voip-call-screen.md)).
- **The relay is part of this repo** (`apps/relay`). Anyone can run their own with their own store credentials.
- **How the instance reaches it.** An instance whose relay runs on the same Cloudflare account binds it as a service
  (`RELAY`, apps/api wrangler.jsonc): Cloudflare answers a Worker's fetch to another workers.dev Worker on the same
  account with 404. Any other instance, such as a self-hosted one using Freecorps' hosted relay, posts to `RELAY_URL`
  over the internet. Either way every send carries the bearer token.

## Device registration

Built before instance registration and handles exist (the instance still holds raw device tokens and sends with the
relay's bearer token):

- **`device.register`** (`packages/schema`, permission `device:register`, every role): the app sends its device id
  (`dev_<ULID>`), `platform` (`ios`, `android`), the token's APNs `environment` (`sandbox` for Xcode builds,
  `production` for EAS builds; S1 found the sandbox relay refuses production tokens), the push token, the PushKit
  token for calls (or null) and the HPKE public key. A member registers only their own devices (another member's id
  is `forbidden`), at most 10 per workspace; the same token under a new id (a reinstall) replaces the old device.
  `device.unregister` removes one's own device; `device.expire` (server only) drops one APNs said is gone, only if
  its token is still the one the push went to (a device registered again with a new token meanwhile is kept).
- **Server-only.** Devices live in the workspace shard's `devices` table, which is never synced: no member sees
  another's tokens or key, and the `device.*` events carry neither.
- **The app** registers the phone on the signed-in member's workspace each time a session opens it (sign-in, or a
  launch already signed in), once it has permission, a token and a key, through Brigade Sync as that member. Its
  device id is derived from the device key, so a relaunch registers the same id (a no-op, `conflict`). Sign out
  unregisters it first (`device.unregister`, given up after 5 s so signing out offline still works; the device then
  stays registered until someone signs out on it online or APNs drops its token), then ends the session. The account
  section says whether the phone is paged: on, notifications off, no device key yet (Android until FCM), taken by the
  last member signed in on it, or failed.
- **Several workspaces (decided).** The app registers the phone in each workspace the member opens on it and keeps
  the earlier registrations when they switch: switching to look at another workspace must never stop the pages of
  the one they are on call in, since "Who is paged" resolves targets per workspace and a phone missing from one is
  `no_devices` there. So a member in two workspaces gets both's pages on the phone once they have opened each on it.
  The app keeps the list of those workspaces per member in secure storage (`apps/mobile/src/lib/phone-workspaces.ts`,
  forgotten on sign-out) and every registration goes to all of them at once with `POST /devices/register` (`{ device,
  workspaces }`, `apps/api/src/device-route.ts`): the Worker checks the session and the member's role in each
  workspace in D1 (one query), and each shard runs `device.register` as the member, with its RBAC and its outbox event
  (`WorkspaceDO.registerDevice`), answering per workspace. So whatever registers again (launch, the foreground, a new
  APNs or PushKit token, Critical Alerts or notifications turned on in Settings, which the foreground picks up, Try
  again) reaches every workspace, not only the one open: a new token that reached only that one left the others with
  a dead one (`BadDeviceToken`, the device dropped, `no_devices`). A workspace the member left answers
  `not_a_member` and the app forgets it; a workspace still failing is tried again on the backoff. An instance from
  before the route (404) registers the open workspace over its socket, as before. The account section lists, under
  each workspace, whether this phone gets its pages (on, setting up, a failure, or not opened on the phone yet), and
  the incident list's notice names a workspace whose registration failed.
  Sign-out takes the phone off all of them: the app unregisters it from the workspace it has open, as before, and
  names its device on Better Auth's `/sign-out` (`Brigade-Device`), whose session hook takes it off every other
  workspace of the member before answering (`device.signOut` with `deviceId`, a `device.unregistered`
  `unregistered`; RFC 0002 "Auth"). A sign-out kept from offline sends the same header when it is finished. The
  phone gives the server 8 s to answer a sign-out (`SIGN_OUT_TIMEOUT_MS`); unanswered, it is kept and finished later.
  If the session hook cannot reach a shard (3 tries), the end is recorded in D1 (`session_end`) and acted on later:
  before whoever signs in on the phone next registers it there (so it is not `taken`), after the shard's next sync
  upgrade, or by the Worker's cron within a minute or two. If D1 cannot record it, the sign-out answers 503 and the
  app keeps it to finish later. Leaving a workspace or being removed drops the member's devices there (RFC 0003
  "Members"). The "I'm on call" widget names the open workspace, and says "On call in <workspace>" when the member is
  off call there but on call in another this phone pages them for, from their stretches there as the app last saw
  them while it was open (kept with the list, each for 24 hours); the on-call screen says the same.
- **The relay** takes the device's `environment` with each push and picks the APNs host from it (one provider token
  signs for both).

## Who is paged

An incident pages through an escalation policy picked in a fixed order, below; with none, the **interim rule** pages,
unchanged since Phase 1. The policy is read when a run starts: changing an incident's type mid-run changes nothing
until its next run.

**Which policy (decided).** A run takes the first of these that names a policy that still exists (`incidentPolicy`):

1. the **alert route** an alert source opened the incident through (RFC 0005 "Alert sources"; the run records it as
   `route`, and the incident page says "set on the alert route …");
2. the incident's **type** (RFC 0003 "Incident types");
3. the **monitor** that opened it (`monitor`);
4. the workspace's **default** policy (RFC 0003 "Escalation policies");
5. else the **interim rule** below.

A route, type or monitor naming none, deleted since, or naming a deleted policy falls through to the next, so a
deletion never leaves an incident paged by nothing. An alert's incident opened by the default route has no route
policy and goes straight to the default. The route is read from `incident_routes`, written as the route declares
the incident, not from its alert rows, which `MAX_ALERT_ROWS` prunes, and replaced when a flap reopens the incident
(one row per incident; deleted when the default route matches now), so the reopen pages through the route that
matches the alert then, not the one that first opened it. Tests: `packages/schema/tests/alert-sources.test.ts`
("the route's policy pages the incident", "the route's policy outlives its alert rows", "a flap reopens through the
route that matches now").

**Alerts that page again (decided).** Besides a declared incident, two things alert sources do page (RFC 0005 "Alert
sources"). An alert that comes back more urgent raises its incident's severity as `sys_alerts`
(`incident.severity_changed`), which pages under the rule for any raise into SEV1 or SEV2: the level paged last
again while a run is under way, else a new run. And a flapping alert, firing again within 10 minutes of its
incident resolving by itself, reopens that incident as `sys_alerts`; `asksForPage` counts an
`incident.status_changed` from a closed status to an active one by `sys_alerts` as a page (a member reopening an
incident still pages nobody), and since the reopen cleared the acknowledgement, it starts a new run. A flap that comes
back more urgent raises the incident just before reopening it; that `incident.severity_changed` carries
`reopening: true` and pages nothing, so the flap is one page, at the raised severity. Tests:
`apps/api/test/notify.test.ts` ("an incident the alerts reopen … pages"), `apps/api/test/alerts.test.ts` ("a flapping
alert reopens its incident and pages again").

**Through the policy.** The first page of an incident (`incident.declared`, or a severity raised into SEV1 or SEV2
while no run is under way) starts an escalation run in the shard (`escalation.start`) and pages level 1 on that same
event. A level's targets are resolved when it fires: a schedule to whoever is on call at that instant (`onCallAt`,
overrides first), a member to themselves; each person once, on every registered device. Whoever caused the event is
not pushed (they know) but counts as reached, so declaring an incident while on call does not page the next level
at once. If nobody acknowledges within the level's timeout, the shard's alarm fires the next level
(`escalation.advance`, `escalation.paged`), and after the last level starts over `repeat` more times; then the run is
`exhausted`: nobody acknowledged, so everyone who can respond is paged once (below) and the run ends, said on the
timeline. `incident.ack` or resolving stops it. A severity raised into SEV1 or SEV2 while a
run is under way pages the level paged last again, at `page` urgency.

**Fallbacks** (the paging path's; tests in `apps/api/test/escalation.test.ts`). A level must never quietly end the
chain:

- A level none of whose targets can be reached (a schedule with nobody on call, `nobody_on_call`; a schedule since
  deleted, `schedule_missing`; a member no longer in the workspace or a viewer, `not_a_member`; people with no
  registered device, `no_devices`; a level emptied by removals) is recorded on the timeline ("Couldn't page …") and
  the **next level fires at once**, in the same transaction.
- When no level from there to the last can be reached, the run falls back to the **interim rule** (commander, then
  everyone who can respond), recorded as level "everyone who can respond", and ends there (`exhausted`): there is
  nothing left to escalate to. Its own failures are recorded as the interim rule's always were.
- **A run that ends unacknowledged** (every level and repeat paged, nobody acknowledged) pages everyone who can
  respond once, then ends: every member who can respond, the commander included and not asked first (they had
  their chance), except whoever caused the run's first page. This also covers a run whose only reach was whoever
  declared it (on call and counted as reached, so nobody was pushed): it must not end silently, so everyone else who
  can respond is paged at the last level's timeout. When nobody else can respond, that is recorded ("Nobody else was
  paged: only the person who declared it can respond", `nobody_else`).
- **A level that cannot fire** (`escalation.advance` refusing it while the run is due and still running: a bug, or a
  row it cannot read) is never dropped. Its first failure goes on the timeline ("An escalation level couldn't fire",
  `escalation_stalled`), it is tried again every minute, and 3 minutes after its first failure (stored on its timer, so
  an alarm that came late still retries first) the shard pages everyone who can respond, as for a run that ends
  unacknowledged, through a mutation that does not read the levels (`escalation.fallback`, `reason: "stalled"`), and
  the run ends. An "ok" that left the level due (a stored result the run did not move past) counts as a failure, so
  the alarm never comes straight back to it.
- **A level nobody could be reached on by push escalates early.** When a level's page settles (`Pager.record` with
  its last result: every push answered, retries spent) and no device took any of its pushes (each refused or failed
  for good: `token_invalid`, `undelivered` after the last try, `unsupported`, `not_configured`; or none of its members
  had a device left when it was planned), the shard fires the next level of the same round that reaches someone now
  (`escalation.unreached`, as `sys_escalation`), on that level's own timeout from then. It never crosses into the next
  round or ends the run: on the round's last level (or with no later level of the round reaching anyone) it is refused,
  and the level's timeout fires what comes next as before (level 1 of the next round, or everyone who can respond once
  and the run ends), so a relay that refuses every push, or none there at all, spends at most one round's worth of
  levels early and every repeat still waits its timeout. The page and its timeline entry
  say why ("Nobody on level 1 could be reached, so level 2 was paged now", `reason: undelivered`, `unreached: 1`).
  Only refusals count: a push APNs accepted counts as reached whether or not a receipt came back (receipts are best
  effort), so one device that took it, on any member of the level, keeps the level waiting for its timeout; so does
  whoever caused the run's first page being on level 1 (reached without a push), and a device that took a severity
  raise paging the level again (the shard's ledger remembers each planned page's run and step, `page_steps`, so this
  holds even when its delivery rows could not be written). Only the level's own page settling escalates: not a
  severity raise paging it again, and not a page the Queue gave up on (that one is paged again instead, "A lost
  page"; a page made again for it does count). It is de-duplicated by the run and its step
  (`unreached:<run>:<step>`) and refused once the run moved on, was acknowledged or resolved, so a redelivered or
  dead-lettered result never advances twice. Never in the way: if it cannot run, it is logged and the level's timeout
  fires the next level as before, and a result that never arrives (the consumer still retrying, or gone) leaves it to
  the alarm. Tests: `apps/api/test/escalation.test.ts` ("escalating early when every push of a level fails"),
  `packages/schema/tests/escalation.test.ts`.
- **Timers survive restarts.** The run and its timer are in the shard's storage; the alarm is set whenever a run
  starts or advances, and the object re-arms it from the earliest timer every time it wakes, so an eviction or a
  deploy mid-escalation resumes on time (or at once, if the level was due meanwhile). The alarm fires due levels
  **before** monitor upkeep, the outbox drain and the member repair (each level is a synchronous mutation, at most
  50 per run, the rest right after), and the drain that follows sends their events; no level ever waits on D1.
- **Idempotency.** Each level is its own event, so the page ledger (RFC 0005) de-duplicates it like any page; the
  start is de-duplicated by the event that asked for it (`start:<event id>`), and a level by its run and the run's page
  count (`advance:<run event id>:<page count>`, likewise `fallback:`, `repage:` and the stall's entry), so a
  redelivered event or a repeated alarm never pages a level twice, and a later run on the same incident (reopened)
  never meets the first run's results. A level's event carries its run and page count: one from a run that has
  stopped (acknowledged and then reopened, or replaced by a new run) sends nothing, while any page of the run under
  way, or of a run that ended by paging everyone, still sends (a level's event the Queue is still retrying when a
  later level ended the run is not dropped). Acknowledging or resolving closes an ended run too (keeping when it
  ended), so after a reopen none of its pages sends. A redelivery of the event that started a run after the run moved
  past the pages the incident row keeps sends nothing, and so does an event older than the run that has ended since
  (a SEV3 declaration still being retried after a severity raise started the run): it starts no new run.
- **A lost page.** A dead-lettered page is recorded like any dead-lettered page (`dead_lettered`). A dead-lettered
  **first** page (the shard never planned it, so no run started) starts the run when it is recorded, so the next
  levels still fire on time. When the lost page is still the run's last, nothing would page its members until the
  next level's timeout, or ever when the run ended on it, so the shard pages it again on an event of its own, once:
  a level's members (`escalation.repage`; whoever caused the run's first page still counts as reached, and the next
  level keeps its time) or everyone who can respond, as that page would have (`escalation.fallback` on the ended
  run, with its reason, and the run keeps when it ended). That event names the lost one (`lost`): devices the lost
  page reached before the Queue gave up are not pushed again, and if it is lost too it is only recorded, never paged
  a third time. The timeline says so ("Level 2 paged again: the earlier page was lost"). A lost page the run has
  moved past (a later level fired meanwhile) is only recorded, and so is a severity raised mid-run whose page (the
  level paged last, again) is lost: that level was already paged once. Another event's page lost meanwhile (an
  incident declared before a later event started the run) is recorded on no page of the run, and starts no run once
  that one ended. A failed page is recorded with the run and page it belongs to, so the incident page puts a slow
  failure on the right level.

**The interim rule** (no default policy, and the last fallback above): the incident commander if one is assigned,
can still respond (not a viewer), did not cause the event and has a registered device; otherwise every member who
can respond (owners, admins, responders; viewers only read), except whoever caused it. Each of them on every
registered device. A commander without a device does not leave the incident unpaged: everyone who can respond is
paged instead. Every member the page was for who has no device (the commander included) is recorded as not paged
(`no_devices`, "Couldn't page Ana: no registered device"), and so is one none of whose devices fit in a page's 200
(`over_limit`); RFC 0005 "Notifiers".

Members are the shard's member list (RFC 0003), a copy of D1's that `member.sync` fills when a member opens a sync
socket, so someone who never opened Brigade is not paged (they have no device either). The page path never reads
D1: a D1 outage must not become a reason a page is late or missing. How the copy follows D1 (RFC 0003 "Members"):

- **Through Brigade** (the dashboard's Members section): D1 first, then, in one shard transaction, the role changes
  (`member.role_changed`; demoted to viewer, they are no longer paged) or the member's row and every device of theirs
  are deleted (`member.removed`, `device.unregistered` with `member_removed` each), so no page planned after that
  reaches them. If the shard step fails after D1 committed, the request answers `not_applied` and the shard's alarm
  reconciles with D1 within 10 s (again every 30 s while D1 fails), with no socket needed; sending the request again
  (the leaver included, though D1 no longer has them) or the next sync upgrade repairs it sooner. Until then the
  member is still paged as before (the API said so: never silent). A workspace over 1000 members
  (`MAX_RECONCILED_MEMBERS`) is never reconciled whole: the shard catches up only on the members whose change it
  recorded as missed (`member.remove` or `member.changeRole` each, as `sys_members`), and logs an error (`too many
  members to reconcile`) since edits made outside Brigade are not repaired there (accepted: far past any workspace
  today; a paged reconcile comes with paged member lists, RFC 0003). The same goes for a removed member's stale
  upgrade arriving after the 60 s tombstone (RFC 0003 "Stale upgrades"): it restores their copy and nothing there
  removes it, and a role changed outside Brigade closes none of that member's sockets. A sync upgrade whose
  reconcile fails arms the same alarm. The alarm drains the outbox before it runs a due repair (and again after, if
  the repair wrote events), so a page never waits behind the repair's D1 read; and it waits at most 5 s for the
  repair (`REPAIR_BUDGET_MS`), which then finishes in the background, so a hanging D1 call never holds the next alarm.
- **Password reset** (RFC 0002 "Auth"): the reset's own `device.signOut` drops the member's devices in each shard.
  If a shard fails it, its repair alarm is armed, and every reconcile (`member.reconcile`, which reads
  `user.passwordResetAt` with each member) drops the member's devices last registered before the reset
  (`device.unregistered`, `password_reset`) and closes their sockets opened before it, so the phone of whoever held
  the account is not paged for good. The member's own next sync upgrade drops those devices before its socket opens
  (`device.signOut` with the reset's time), so the app's register after signing in again, even one that changes
  nothing (same device id and tokens), never precedes the drop: the phone it registers stays. If that drop fails,
  the upgrade is refused (503) and the repair alarm is armed.
- **Edits made outside Brigade** (straight in D1): reconciled on the next sync upgrade into the workspace by anyone
  (`member.reconcile`): a removed member's row and devices go, a changed role is copied, and their open sockets
  close. Until somebody opens Brigade, a member removed or demoted outside it is still paged (Q18).
- Tests: `apps/api/test/members.test.ts` ("a removed member is deleted from D1 and the shard with every device, and is
  no longer paged", "a demoted member stops being paged at once", the "when one side fails" cases (among them "a
  failed leave: the leaver's own retry stops their pages", "a failed change is repaired by the shard's alarm" and "an
  alarm whose due repair hangs on D1 still drains the outbox first"),
  "rules come before any repair" and "edits made outside Brigade").
- **A handed-over phone** (same install, so the same device id, signed in as another member) keeps paging the first
  member until it unregisters: `device.register` refuses another member's device id (`forbidden`). Signing out
  unregisters it, so the next member's sign-in registers it for them. Signing out does not wait for a registration
  already under way (asking for the key, permission or token, which can take forever without APNs): it stops the
  registration first, which then sends nothing when it gets them, and one already sent is queued ahead of the
  unregister on the same sync client and socket, so the shard drops it again.
  - **Signed out offline** (`device.unregister` did not answer within 5 s): the app signs out on the phone only and
    keeps the member's session, unrevoked, in secure storage with their user and workspace ids, the auth server it
    belongs to and when the session expires (`brigade_signed_out`, a list with one record per session,
    apps/mobile/src/lib/sign-out.ts), and tells them the phone may still get their pages until it is back online.
    The list holds at most 10: past that, the oldest record already off its shard (only its revoke left) is
    dropped; one still on its shard never is, so an eleventh such sign-out is not kept and the app says the phone
    may keep paging them (below).
    A sign-out whose `/sign-out` went unanswered is kept the same way, already off the shard. Every record is
    changed in turn and by its own session, so a second member's sign-out kept before the first is finished never
    replaces or clears it. At launch, whenever the phone reconnects or the app comes to the foreground, before any
    member's `device.register`, and while one is left on a backoff (30 s, 2 min, then every 10 min,
    apps/mobile/src/lib/paging.ts), the app finishes each: `/get-session?disableRefresh=true` with that cookie (the
    check itself does not extend the session, and it says when the session expires), `device.unregister` over a
    socket of its own as that member, then `/sign-out`, and only then forgets it. The socket's upgrade does extend
    the session (Better Auth renews one last renewed over a day ago on any use, and the upgrade is checked like
    every other request), so before opening it the record's expiry moves to a full lifetime
    (`SESSION_LIFETIME_S`, Better Auth's `expiresIn`) from then; it also takes any later expiry `/get-session`
    reports. A record is finished only against the server it was kept for (a development build's server moves with
    the Metro host); one kept for another server does not hold up registering for this one. A record is dropped
    once past its expiry, when the server has forgotten the session, and in any case a lifetime after it was kept
    (`keptAt`), however often its session was renewed meanwhile: then the app tries `/sign-out` with it once (best
    effort, and only against its own server) so the session goes with it. Not renewing on the upgrade instead would let
    a member whose app keeps its socket open but rarely asks `/get-session` be signed out under them. The session
    is not revoked first because only it can say
    whose device this is. Until it finishes, a next member who signs in sees "taken" (the phone still pages the
    other one), with Try again, instead of a claim that it pages them; once finished, the phone registers for
    them. If the session could not be read or stored either, nothing can finish it: the app says the phone may
    keep paging them and that signing in and out again with a connection stops it.
  - **Reinstalled with a record kept**: iOS Keychain items survive an uninstall, so the reinstalled app (a new
    device key, so a new device id) finishes the record with `not_found` from `device.unregister`, treats that as
    done and revokes the session, and the old device row goes only when that member registers the same APNs token
    again or a page finds the token gone (`token_invalid`).
  - **The kept session is gone** (it expired, or was revoked from elsewhere, before the phone came back): nothing
    can take the device off as that member, so the leftover is dropped and the device stays theirs on that shard.
    Taking over a device id on proof of the device key (a signature over a server nonce) would close this, but the
    key is HPKE-only today (P-256 key agreement in the Keychain) and Android has none; it waits for FCM. Removing the
    member from the workspace (above) drops their devices, which frees the phone for the next member.
  - **Removed from the workspace before the phone came back**: the removal already deleted every device of theirs
    in the shard (above), so the phone no longer pages them and the next member's `device.register` for the same
    device id succeeds. The kept record still cannot finish (the socket's upgrade answers 403 `not_a_member`, so
    `device.unregister` never reaches the shard; a socket that closes before it ever opens ends that try at once),
    and stays pending on the backoff. Each try still renews the session (`/get-session` sees it alive and the
    upgrade renews it before the 403), so its expiry never comes: the record is dropped a lifetime after it was
    kept, revoking the session on the way out, which bounds both the record (one of the 10) and the removed
    member's credential. Meanwhile the app shows the next member "taken" although the shard would accept them;
    treating a 403 `not_a_member` as finished (the device is gone with the membership) would end that sooner and
    is left for the app. A removal made outside Brigade takes effect at the next sync upgrade into the workspace.

Content: title `SEV1 · INC-142` (codes, so no locale is needed), body the incident's title, the incident id, its
workspace id (for the Acknowledge action) and the page's receipt token and URL ("Delivery receipts"), sealed per
device; urgency `page` for SEV1 and SEV2; `apns-collapse-id` is the incident id, so a repeat replaces
the notification. What happens when a page fails is RFC 0005 "Notifiers".

## Acting from the notification

A page that names its incident and the incident's workspace (both sealed in the content, `PushContent.incident` and
`.workspace`) shows an **Acknowledge** action. Tapping it acknowledges without opening the app, with the same
mutation, RBAC and event as acknowledging in the app (RFC 0004 "Acknowledging from a notification").

- **Category, set on the phone.** The Notification Service Extension sets the category `brigade_page` and the ids
  (`page: { incident, workspace }` in the user info) on a page it decrypted (`modules/brigade-push/ios/BrigadePage.swift`),
  and so does the notification posted when CallKit refuses a call. The fallback text has no category: there is no
  incident to acknowledge by, so the page only says to open Brigade. The relay never sees or sets the category.
- **Localized title.** The app registers the category from JavaScript at launch and whenever its language changes
  (`setNotificationCategoryAsync`, the title from `packages/i18n`), so the action reads in the app's language. Not in
  `Localizable.strings`: a category's actions are registered by the app at run time anyway, and the extension cannot
  register categories for it. Until the app has run once there is no category (it must run to sign in, so a phone
  that is paged has run it).
- **Runs in the app, in the background.** The session cookie is in the app's secure storage, which the extension
  cannot read, so the ack runs in the app process. The action is not `opensAppToForeground`; iOS launches or resumes
  the app in the background. expo-notifications tells iOS it is done with the tap at once (on a cold launch before
  JavaScript has loaded), so the BrigadePush module joins its delegate list at launch and holds a background task from
  the tap until JavaScript reports the ack finished, or iOS takes the time back (about 30 s). The app's handler
  (`apps/mobile/src/lib/page-action.ts`, tested in Node) sends the request with one idempotency key, tries 3 times
  (at once, after 2 s, after 5 s, 6 s each), and stays under 25 s.
- **Authentication required on a locked phone** (`isAuthenticationRequired`). expo-secure-store keeps the session
  readable only while the phone is unlocked, and a locked phone must not let whoever holds it acknowledge as its
  owner. Face ID makes it one glance. The extension's device key stays readable after first unlock, so pages still
  decrypt on a locked phone.
- **What the phone says after**, as a quiet notification (no sound, `passive`) under the page's title:
  acknowledged; already acknowledged (by anyone); no longer active; not found; can no longer acknowledge in this
  workspace (a viewer, or removed); sign in first. The app does not open.
- **Offline (the fallback).** When every try failed, the notification says Brigade could not be reached and is a page
  again (`active`, the same category and ids), so trying again is one tap away. Nothing waits on the phone: an
  unacknowledged page keeps escalating on the instance (its run fires the next level at its timeout, "Who is paged").
  An ack that gets through is `incident.ack`, which ends the run, so a level already queued pages nobody. A tap in the foreground is handled the same way,
  but pages show no banner while Brigade is open (it sets no foreground handler), and the incident on screen shows
  the ack.
- **Calls** (`kind: "call"`, RFC 0010) keep their own ack: 1 on CallKit's keypad or the call screen, over Brigade
  Sync. Only the notification posted when CallKit refuses a call has the action.
- **Android** gets the same JavaScript path (`page-action.ts`, `use-page-actions.ts`) with a notification action
  button once pages reach Android (FCM); the hook registers nothing there yet. Its background time comes from the
  notification's broadcast receiver, not a background task.

## Delivery receipts

What each page did on each phone, so a member (or whoever is on call with them) can see why they were or were not
paged, without logs.

**Stages**, per page (the event that asked for it) and device, one synced row each (`deliveries`, id
`<incident>:<event>:<device>`, packages/schema `deliveries.ts`):

1. **planned**: the shard picked the device for the page (`delivery.plan`, in `Pager.plan`), with the escalation run
   and step it belongs to. A retry keeps the first plan.
2. **sent**: the notifier handed it to the relay (`delivery.report`, with how long the relay took, so the time is
   the hand-over's, never before the plan) and **accepted**: the relay answered that APNs took it. A failed attempt
   records why: `not_configured`, `unsupported`, `seal_failed`, `relay_unreachable`, `relay_refused`,
   `token_invalid` (APNs `BadDeviceToken`, `Unregistered`: the device is dropped), `apns_refused`, `apns_unavailable`
   (429, 5xx), with APNs' own reason when it gave one; an accepted retry clears it. `attempts` counts them.
3. **delivered**: the phone's extension opened (decrypted) the page and said so (`delivery.confirm`), once.

Shown and acted on (the person saw it, tapped Acknowledge) are not stages yet: the ack is on the incident already,
and "shown" needs the app, not the extension. Each write emits its event through the outbox (RFC 0005), actor
`sys_notifier`. **Retention**: rows are kept with the incident, like its timeline, but an incident keeps at most 20
rows per device (`MAX_DELIVERIES_PER_DEVICE`, the pages an escalation run keeps): planning a page past that drops
that device's oldest rows on the incident (`notification.planned` says how many, `dropped`). The timeline still
records every page and every miss. Tests: `packages/schema/tests/deliveries.test.ts`.

**How the phone reports, without a session.** The extension has the device key (App Group Keychain) but not the
member's session cookie, and must not need one. So the page carries its own proof: when the shard plans a page it
mints a token per device, `v1.<key id>.<workspace>.<incident>.<event>.<device>.<expiry>.<mac>`, the MAC an
HMAC-SHA256 (over every field before it) under a random key only that shard holds (`receipt_key`, made on first use,
never sent anywhere, key id `k1`), and the notifier seals the
token inside that device's page with the receipt URL (`DASHBOARD_URL` + `/api/receipts`; no URL, no receipt). Only
that device can open the page, so only it ever sees the token; the relay sees ciphertext. The extension posts
`{ "token" }` to the URL; the Worker reads at most 1 KiB of body (a longer one, declared or streamed, is `413`) and
only the workspace the token names, checks it exists in D1 (a made-up one costs a D1 read, no Durable Object; a D1
outage asks the shard anyway), holds the workspace and the caller's address (`cf-connecting-ip`) to 120 receipts a
minute with a Workers Rate Limiting binding (`RECEIPT_LIMIT`, wrangler.jsonc, one namespace per environment;
`429` before the shard wakes; a limiter that fails lets the receipt through) and hands the token to that shard, which
checks the MAC (constant time), the expiry (30 minutes, `RECEIPT_TTL_MS`: APNs keeps a page 15), a per-device rate
(30 a minute) and that the page was planned for that device. So a token cannot be forged or altered, names one
page on one device (another page, device or workspace is refused, `403`), expires (`410`), and records once: a
replay answers `200` and changes nothing. Answers say only whether it was recorded. A key never rotates today; a
restore keeps it with the shard's storage. The key id is in the token (and under its MAC) so a later rotation can
tell keys apart; until then a token naming any key but `k1`, or none, is refused. Tests:
`apps/api/test/receipts.test.ts`.

**Accepted residual risk: junk that wakes a shard.** A well-formed token for a real workspace looks like a genuine
one until its shard checks the MAC, so junk can wake that shard. The Worker's rate limit bounds it per workspace and
address, but Workers Rate Limiting is approximate and counted per Cloudflare location, and many addresses are many
keys: a distributed caller who knows a workspace id can still wake its shard repeatedly. Each wake costs one MAC check
and no write (an invalid token records nothing), and the shard serves paging regardless. The same exposure exists on
`POST /heartbeat/:token` (RFC 0007), which has no rate limit yet. Accepted for now; a strict limit would need a
Durable Object of its own per workspace, which is what a flood would wake anyway.

**The extension posts only to the registered instance.** A page names its own receipt URL, and anyone holding the
device's public key could seal a page. So when the app registers the phone (`registerPhone`,
apps/mobile/src/lib/device.ts) it keeps the instance's origin in the App Group (`setReceiptOrigin`, user defaults
`receipt-origin-v1`), and the extension posts a receipt only when its URL has that origin (scheme, host, port); a
phone registered before this sends none until the app registers it again (every launch). Tests:
`apps/mobile/src/lib/device.test.ts` (the JavaScript side; the Swift is type-checked, not unit tested).

**Never in a page's way** (the paging path's rule). Minting a token, recording a plan or an outcome each fail
open: logged, and the page goes out without a token or a row (tested: a shard that cannot mint still pages). The
token rides in the sealed plaintext only when it fits; a page that would not fit with it is sealed again without
it (tested: one envelope reaches the relay, with no receipt inside, and the row reaches `accepted`). The
extension starts the receipt request and shows the page at once, without waiting for it (5 s timeout, ephemeral
session, no cookies, no retry, the token never logged), and only for a page it decrypted: the fallback text has no
token. So receipts are **best effort**: iOS may end the extension before the request leaves, a phone offline after
showing the page never reports, and VoIP call pushes (RFC 0010) and Android send none yet. A missing receipt means
"not confirmed", never "not shown", and the dashboard says so.

**Privacy.** A receipt says when a phone was reachable. Rows and device summaries are synced only within the
workspace (every member, viewers included, as for the timeline): **every member sees each colleague's phones and when
Brigade last heard from each**. Decided acceptable within a workspace (it is what tells a team why someone was not
paged), and the dashboard says so under the explanation. They carry no token, key or content, and the event
data names only ids. Devices themselves stay server-only; a token-free summary of each (`member_devices`: platform,
APNs environment, whether it takes calls, registered, last heard from: the latest registration or receipt) is kept
with it by `device.register` and dropped with it. A device registered before summaries gets one the next time the
app registers it.

**"Why wasn't I paged?"** The dashboard's incident page lists everyone who can respond (and anyone a page touched)
with the outcome in a word, and `/incidents/<n>?why=<member>` explains one member step by step from what members
already hold (`whyPaged` in packages/sync, pure; wording in en and pt-BR). The list puts whoever needs a look first
(failed, couldn't page, stuck, sending, accepted, delivered, then the rest). A page planned and not sent within 2
minutes (`PAGE_STUCK_MS`; the notifier sends within seconds) is `stuck`, "Planned but never sent", not "Sending"
forever. Pages to the same level with the same outcome in a row fold into the latest. The view says: whether they can be paged (a viewer, gone),
which rule paged (the policy, or the interim rule), each page (were they on it, and if not why: not on call for its
schedule and who was, a level that names others, the commander paged first, they declared it), each device's stages
with times and errors, the phones they have now and when each was last heard from, the email about a missed page
(expected, failed, capped, off) and who acknowledged. The mobile app's own view of it comes later.

## Driver abstraction

```ts
interface PushDriver {
  send(
    target: DeviceTarget,
    msg: EncryptedPush,
    opts: { urgency: "low" | "high" | "page" },
  ): Promise<Result>;
}
```

Drivers: `relay` (default), `apns-direct`, `fcm-direct` (own app build), `unifiedpush` (Android without Google),
`expo-push` (local development only).

## Paging semantics per platform

| Need                      | iOS                                             | Android                                           |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| Break through Focus / DND | `interruption-level: time-sensitive`            | High-importance channel + DND access (user grant) |
| Ring on silent            | Critical Alerts (built, behind the entitlement) | Alarm-sound channel                               |
| Act from the notification | Category actions: Ack (built) / Escalate        | Action buttons                                    |
| Collapse repeats          | `apns-collapse-id`                              | Notification `tag`                                |
| Full-screen alarm         | n/a                                             | `USE_FULL_SCREEN_INTENT` (Play policy review)     |

## Critical Alerts

Built and off: Freecorps has applied for `com.apple.developer.usernotifications.critical-alerts` and not been
granted it yet (open question Q8). Everything that does not need the entitlement is in place, so turning it on is a
build flag:

- **The app.** `BRIGADE_CRITICAL_ALERTS=1` at build time (app.config.ts) adds the entitlement to the app
  (`plugins/notification-service.ts`) and has it ask for `.criticalAlert` with the notification permission. Unset
  (the default) the entitlement is not there and nothing asks: an App ID or profile without it would fail the build.
- **Registration.** `device.register` takes an optional `criticalAlerts` (true when the member allows them, read
  from the permission each time the app registers, so turning them off in Settings is picked up). The app sends it
  only when true: an instance from before it refuses unknown keys. Left out, or a device row from before it, reads
  as not allowed.
- **Who gets one.** A SEV1 page's alert push (`page` urgency), to an iPhone that allows them (`sendsCritical`,
  apps/api src/paging.ts). Everything else, a SEV2 page included, stays `time-sensitive`, unchanged. The relay takes
  `critical: true` only on a `page` alert (anything else is `invalid_body`) and sends
  `sound: { critical: 1, name: "default", volume: 1 }` with `interruption-level: critical`. The Notification Service
  Extension edits a copy of the delivered content, so the sound and level survive decryption and the fallback alike.
- **Fallback (paging path).** A critical push the relay (400) or APNs (its 400) refuses as a request is sent again at
  once without `critical`, the time-sensitive page every phone gets; tested in apps/api `notify.test.ts`. A device
  that registered the capability but whose build lost the entitlement is not a risk: iOS plays the push as a
  time-sensitive alert.
- **The relay can raise urgency.** Like `interruption-level`, `critical` is in clear in the payload the relay builds;
  the hardening above (urgency sealed in the plaintext, the extension deciding the level) covers it too.

**Once Apple grants it:** enable Critical Alerts on the App ID `app.freecorps.brigade` in the developer portal (the
extensions do not need it), regenerate the provisioning profiles (`bunx eas-cli@latest credentials`, or Xcode for
local builds), set `BRIGADE_CRITICAL_ALERTS=1` in the EAS build profiles' `env` (eas.json) and in local build
environments, and build. Then check on an iPhone: allow Critical Alerts when asked (or in Settings), sign in, put the
phone on silent with a Focus on, declare a SEV1 and hear it ring; a SEV2 must stay time-sensitive. Self-hosters with
their own app build need their own grant from Apple.

## Expo specifics

- Development builds only (no Expo Go) — native modules + NSE.
- NSE added by our own config plugin (`apps/mobile/plugins/notification-service.ts`): the extension target, the push,
  App Group and time-sensitive entitlements (and Critical Alerts with `BRIGADE_CRITICAL_ALERTS=1`), and the fallback
  strings for both targets. The extension compiles
  `BrigadePushCrypto.swift` and `BrigadePage.swift` from the app's module.
- Use `getDevicePushTokenAsync()` (native token), not Expo push tokens.

## APNs requires HTTP/2

APNs only speaks HTTP/2. **Spike S1 measured it** ([write-up](../spikes/s1-apns-encryption.md)): a deployed Worker's
`fetch` reaches APNs (sandbox answered `200` and delivered, or `400 BadDeviceToken` for a bad token), because
Cloudflare's edge speaks HTTP/2 to the origin. Local workerd (`wrangler dev`, `vp dev`) has no HTTP/2 and gets
`Network connection lost.` ([cloudflare/workerd#4841](https://github.com/cloudflare/workerd/issues/4841)). So the
relay is a plain Worker. This behaviour is observed, not documented, so it stays a risk: the relay must alert on
`apns_unreachable` (not built yet; the spike only logs it), and the fallback stays ready, a tiny APNs sender in
Cloudflare Containers (or any small VM) behind the relay, with the rest of the design unchanged. Develop against a deployed `dev` relay. FCM HTTP v1 works
over HTTP/1.1.

## Terms of the hosted relay

The Freecorps-operated relay has its own terms of service (fair-use limits, abuse policy). Running a competing
paid service on top of the official relay requires an agreement; anyone can self-host a relay with their own app build.
