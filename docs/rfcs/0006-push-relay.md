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
  one CryptoKit call in the iOS extension (`HPKE.Recipient`, iOS 17+; iOS 16 shows the fallback) and, on Android, the
  key schedule in plain JCA around a Keystore ECDH (`modules/brigade-push/android` `Hpke.kt`: Tink's HPKE needs the raw
  private key, which the Keystore never gives out), and `packages/push` implements it on WebCrypto with no dependency (RFC 9180 test vector A.3.1 in its
  tests). Web Push encryption (RFC 8291) was rejected: no native API on either platform. P-256 rather than X25519 so
  the device key can move into the Secure Enclave or StrongBox later. The APNs payload is
  `{ aps: { alert: <fallback keys>, mutable-content: 1, … }, brigade: { v: 1, enc, ct } }`, with `enc` and `ct`
  base64url and at most 2048 bytes of plaintext.
- **Device key:** created by the app on first use; on iOS a Keychain item in the App Group
  `group.app.freecorps.brigade` (which is also its Keychain access group), readable after first unlock, this device
  only, so the extension can read it while the phone is locked. On Android (decided with FCM, `DeviceKey.kt`), the
  same P-256 key: from Android 12 (API 31) it is made inside the Android Keystore with `PURPOSE_AGREE_KEY` and the
  Keystore does the ECDH, so the private key never leaves it. It is kept only once it has done one ECDH with a
  throwaway key: some Keystores make the key and then fail every agreement with it, and those phones get the software
  key below instead. Android 7 to 11 cannot agree keys with a Keystore key,
  so there (the closest safe option) the key pair is made in software and its private key kept encrypted with
  AES-256-GCM under a Keystore key, in the app's no-backup directory, decrypted in memory only to open a page. Neither
  needs the user to authenticate or the phone to be unlocked (after the first unlock), so pages decrypt on a locked
  phone; neither is in a backup, so a restored phone registers a new device. A phone updated from 11 to 12 keeps the
  key it has. A wrapped key its Keystore key no longer opens (the tag does not match, or it is not a key) is deleted
  with that Keystore key, so the next registration (the app registers when it comes to the foreground) makes and
  registers a new one instead of every page falling back. StrongBox is not asked for yet (not every StrongBox
  agrees keys).
- **What the relay can still do.** It cannot read content, but in the spike's base-mode envelope it could replay
  an old push or raise its urgency (`interruption-level` is in clear), and anyone with a device public key and
  relay access could forge one. Before production: seal `iat`, the instance id and the urgency inside the
  plaintext, let the extension take the interruption level from the decrypted urgency and fall back on stale
  pushes, then authenticate the sender (HPKE auth mode or the instance's Ed25519 signature).
- **Offline phones:** pushes carry an `apns-expiration` by urgency (pages 15 minutes; the relay refuses "try once"
  for a page). APNs keeps only the latest undelivered push per app and device, so a later push (even a `low`
  status update) replaces a stored page. Decided for the same incident: a page's `apns-collapse-id` is the incident
  id and anything less urgent gets its own (`<incident id>:high`), so a lower-urgency push never takes a page's place
  on screen; and the shard holds a lower-urgency push for an incident back from each phone a `page` push of that
  incident may still be waiting on (APNs took it within `PAGE_HOLD_MS`, the page's 15-minute expiration, and the
  phone has not sent its delivery receipt; a missing delivery row counts as unconfirmed). A page counts from the
  moment it is planned, before the relay call (`PAGE_IN_FLIGHT_MS`, 60 s, until the relay answers): messages of one
  batch are handled concurrently, so a lower-urgency push planned while the page is on its way is held back too,
  and one planned before the page goes out first and is replaced by it (the page is the newer word). A page is
  never held back, and a page the relay or APNs refused holds nothing back once its outcome is recorded. Held, not
  dropped: the phone is pending on that push in the shard's ledger (`page_held`), never counted as reached, and its
  member is not recorded as missed meanwhile (not even when another of their phones refused the same push: what the
  released push does says). When the page's receipt arrives (at once, from the receipt) or its
  hold ends (from the shard's alarm), whichever comes first, the latest push held for that phone and incident goes
  out on an event of its own, `notification.released` (`notification.release`, through the outbox), with the
  incident as it is then; older ones held for the same phone are passed over, and nothing goes for an incident
  acknowledged or resolved by then, or to a phone signed in to another member since. Each held push is released once
  per event and device (the release and its rows leaving `held` commit together), the phones soonest due first. A hold that cannot be
  written fails open: the push goes at once. A held push does not make its escalation level escalate early: it is
  pending, not failed. Tests: `apps/api/test/notify.test.ts` ("lower-urgency pushes behind a page"). Still open: a lower-urgency push for
  **another** incident can still replace a stored page (holding it back would delay another incident); the app
  re-syncing open pages when it reconnects or comes to the foreground is the fallback for that, before production.
- **Calls (RFC 0010).** `POST /send` with `kind: "call"` sends a PushKit VoIP push (`apns-push-type: voip`, topic
  `<bundle id>.voip`, priority 10) whose body is only `{ call: { id }, brigade: <envelope> }`. The relay refuses a call
  that is not a `page` or has no lowercase UUID id, and keeps it 60 seconds by default (at most 5 minutes), because
  iOS terminates an app that receives a VoIP push and reports no call. Devices register a separate PushKit token for
  calls (spike S6, [write-up](../spikes/s6-voip-call-screen.md)). A refused call is answered like a refused alert
  (`502` with APNs' `status` and `reason`), which is how the instance knows to clear a VoIP token APNs says is gone.
  On Android a call is an FCM data message of `kind: "call"` (below) to the device's FCM token, which the app also
  registers as its call token (`voipToken`) when it has the call module; the app rings it through its
  `ConnectionService` (RFC 0010).
- **Android: FCM HTTP v1** (`apps/relay/src/fcm.ts`). `POST /send` with `platform: "android"` goes to
  `https://fcm.googleapis.com/v1/projects/<project>/messages:send` instead of APNs; the instance sends it for an
  Android device and leaves it out for an iPhone, so an iPhone's body is what every relay takes. The relay
  authenticates as a Google service account (`FCM_SERVICE_ACCOUNT`, the key file's JSON, a Worker secret; the project
  id is read from it): an RS256 JWT signed with Web Crypto for the `firebase.messaging` scope is exchanged for an
  OAuth2 access token (the JWT bearer flow), cached per isolate until 5 minutes before it expires and fetched again
  when FCM answers 401 (the send is tried once more); neither is ever logged. Every message is **data only** (no
  `notification`, so FCM never shows anything the app did not decrypt): `data` is `{ v, enc, ct, kind, urgency,
  callId?, tag? }`, all strings, at most 4 KB (the 2 KB plaintext seals to about 2.8 KB), with `android.priority:
  HIGH` (`NORMAL` for `low`) and `android.ttl` from the same expirations as APNs (pages 15 minutes, calls 60 s).
  `tag` is the APNs collapse id's role: the app's notification tag, so a repeat replaces it. FCM's refusals are
  answered like APNs' (`502` with FCM's `status` and its error code as `reason`): `UNREGISTERED` and an
  `INVALID_ARGUMENT` about the token add `tokenInvalid: true`, which the instance treats as APNs' `BadDeviceToken`
  (the device dropped, or for a call its call token cleared); `SENDER_ID_MISMATCH` (403) does not: a token of another
  Firebase project is almost always a relay holding the wrong service account, so the relay logs it as an error and
  the instance keeps the device, recording a refusal that is not retried (`apns_refused`), like a misconfiguration;
  `QUOTA_EXCEEDED` (429), `UNAVAILABLE`
  and `INTERNAL` (5xx) are retried, like APNs' 429 and 5xx; FCM or Google's token endpoint out of reach is `502
  fcm_unreachable`, retried; a missing or refused service account is `500 relay_misconfigured`. The delivery rows keep
  their names (`apns_refused`, `apns_unavailable` mean the push service, Apple's or Google's) and FCM's code as the
  reason. Tests: `apps/relay/test/fcm.test.ts` (a fake token endpoint and a fake FCM), `apps/api/test/notify.test.ts`.
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
  is `forbidden`), at most 10 per workspace; the same token under a new id (a reinstall) replaces the old device. A new
  device over the 10 replaces the member's least recently alive ones in the same mutation (registered, or confirmed a
  page with a receipt, whichever is later, so an on-call phone pages reach but nobody opens is kept; `device.unregistered`
  `replaced`, through the outbox), so their newest phone is never locked out by phones long gone: every reinstall is
  a new device id, and a token that changed with it is not caught by the rule before. Only ever the member's own
  devices, so it gives nobody a way to drop anyone else's, and a member's session could already unregister them one
  by one; the limit still bounds a page's fan-out. An instance from before this still answers `limit_reached`, which
  the app shows as its own message (sign out on a phone no longer used) and does not retry on a timer.
  `device.unregister` removes one's own device; `device.expire` (server only) drops one APNs said is gone, only if
  its token is still the one the push went to (a device registered again with a new token meanwhile is kept).
- **Server-only.** Devices live in the workspace shard's `devices` table, which is never synced: no member sees
  another's tokens or key, and the `device.*` events carry neither.
- **The app** registers the phone on the signed-in member's workspace each time a session opens it (sign-in, or a
  launch already signed in), once it has permission, a token and a key, through Brigade Sync as that member. Its
  device id is derived from the device key, so a relaunch registers the same id (a no-op, `conflict`). Registered or
  unchanged, the shard then runs `device.touch` (server only, as the member, `silent`: no event), which records when
  the member last registered it (`updatedAt`), so a sign-out acted on late (`device.signOut` with `before`) never
  drops the phone they registered again since, and the session they registered it with (`sessionId`). Sign out
  unregisters it first (`device.unregister`, given up after 5 s so signing out offline still works; the device then
  stays registered until someone signs out on it online or APNs drops its token), then ends the session. The account
  section says whether the phone is paged: on, notifications off, not on this phone (an Android build without
  Firebase, below), taken by the last member signed in on it, or failed. Android registers like iOS (the same
  triggers: sign-in, the foreground, a new FCM token through `addPushTokenListener`, a workspace opened), with its FCM
  token from `getDevicePushTokenAsync()`, its device key, `environment` `production` (FCM has none) and, with the call
  module, the FCM token again as its call token.
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
  `not_a_member` and the app forgets it; a workspace still failing is tried again on the backoff (5 s, 30 s, 2 min,
  then every 10 min, each give or take a fifth), `taken` every 10 min. The foreground, a reconnect and a new token try
  again at once, but never within 5 s of the last try (`MIN_TRY_GAP_MS`), so the app stays under the route's 30 a
  minute; Try again never waits. A token counts as new only if it is not the one the app last fetched:
  expo-notifications fires its token listener with the token each `getDevicePushTokenAsync` returns, on iOS and
  Android, and taking that as new made every registration ask for the next, about once a second. The route logs each
  answer that is not `ok` (workspace and code, never a token or key), so a phone that is not paged shows in the
  Worker's logs. An instance from
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
  upgrade, or by the Worker's cron within a minute or two. If D1 cannot record it, or Better Auth did not delete the
  session, the sign-out answers 503 and the app keeps it to finish later (RFC 0002 "Auth"). A registration whose
  catch-up could not read D1 answers `unavailable`, tried again, never `taken`. `taken` is not for good either: a
  registration refused as another member's device (`forbidden`) catches up again and, when the session that member
  last registered it with no longer exists or expired (`sessionId`, checked in D1), takes the phone off them
  (`device.signOut`, only if not registered again since) and registers once more. A device registered before
  `sessionId` existed stays its member's until they sign out on it or its token expires. `not_a_member` is answered
  only once D1 confirmed it: a shard whose tombstone of the member D1 could not check answers `unavailable` (the
  Worker had just found them in D1), since the app forgets a workspace it is told it is not in. Leaving a workspace or being removed drops the member's devices there (RFC 0003
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

0. the policy **picked by hand** when the incident was declared (`escalationPolicyId` on `incident.declare`, from the
   dashboard, the app or `POST /workspaces/:id/incidents`; the run records `picked`, and the incident page says
   "picked when the incident was declared"). Decided with Q18. One deleted since, or never there (a declare naming
   a policy that does not exist leaves it out), falls through to the order below. Tests:
   `packages/schema/tests/escalation.test.ts` ("a policy picked when declaring"), `apps/api/test/rest.test.ts`;
1. the **alert route** an alert source opened the incident through (RFC 0005 "Alert sources"; the run records it as
   `route`, and the incident page says "set on the alert route …");
2. the incident's **type** (RFC 0003 "Incident types");
3. the first of the incident's **services**, in the order they were picked, that names a policy (RFC 0003 "Service
   catalog"; `service`, "set on the service …"): the services an alert route opened it with, or a member declared it
   with or added later (`incident.setServices`, a monitor's incident too). A run under way keeps its levels; the
   incident's next run follows the service;
4. the **monitor** that opened it (`monitor`): the one whose alert opened it, firing or not, never one a `group` route
   put onto it later (RFC 0007 "Monitor alerts through the routes"), so a grouped monitor's policy does not take over
   an incident an alert source or another monitor opened. Test: `packages/schema/tests/monitor-alerts.test.ts` ("a
   grouped monitor's policy never pages the incident an alert source opened");
5. the workspace's **default** policy (RFC 0003 "Escalation policies");
6. else the **interim rule** below.

Services come after the type (the type is the more deliberate choice of who handles this kind of incident) and before
the monitor, so a route that names a service for a monitor's alerts (RFC 0007 "Monitor alerts through the routes")
pages the service's people. Decided with the service's policy paging; tests:
`packages/schema/tests/alert-mapping.test.ts` ("a service's policy pages") and
`packages/schema/tests/escalation.test.ts` ("the policy order").

A route, type, service or monitor naming none, deleted since, or naming a deleted policy falls through to the next, so a
deletion never leaves an incident paged by nothing. An alert's incident opened by the default route has no route
policy and goes straight to the default. The route is read from `incident_routes`, written as the route declares
the incident, not from its alert rows, which `MAX_ALERT_ROWS` prunes, and replaced when a flap reopens the incident
(one row per incident; deleted when the default route matches now), so the reopen pages through the route that
matches the alert then, not the one that first opened it. Tests: `packages/schema/tests/alert-sources.test.ts`
("the route's policy pages the incident", "the route's policy outlives its alert rows", "a flap reopens through the
route that matches now").

**Escalating from a severity (decided, Q18).** A policy may say from which severity it escalates (`minSeverity`,
RFC 0003 "Escalation policies"; unset, every severity does, as before). A run whose incident is less severe than that
when it starts (`escalatesAt`) **pages once and does not escalate**, which means precisely:

- it pages the first level that reaches someone, as any run does: a level nobody on it can be reached at is skipped
  ("Couldn't page …"), and with no level reaching anyone everyone who can respond is paged and the run ends as
  `exhausted`, as before, so a page below the threshold is never silently dropped. Unlike a full run, the person who
  caused the page (the declarer) does **not** count as reached on their own: a level that reaches only them is skipped
  too, to the first level that reaches someone else, else everyone who can respond (and, when that reaches nobody on
  any device, the owners and admins are emailed). Otherwise a declarer on call for level 1 would end the run with
  nobody else ever paged;
- then the run ends at once as `paged_once` (`once`: the policy's `minSeverity`), with an `escalation_once` timeline
  entry ("Not escalated further: this policy escalates from SEV2"): no timer, so **no later level at a timeout, no
  repeat, no page to everyone when nobody acknowledges**, no early escalation when every push of the level fails
  (`escalation.unreached` is refused) and no stall fallback;
- a page of it the Queue loses is still paged again once (`escalation.repage` takes a `paged_once` run), and its page
  reaching nobody on any device emails the owners and admins at once (RFC 0005 "Email"), since nothing else will page;
- a responder who asks to escalate it (`escalation.now`: `/inc escalate` in Slack, RFC 0011; the same permission,
  `incident:update`) is heard: the run pages its next level at once and goes on from there as a **full run** (no
  longer `once`, its timer set: timeouts, repeats and the page to everyone after them), as the manual escalation of a
  running run would;
- an ack or a resolve closes it like an ended run. A severity raised afterwards **up to or past the policy's
  `minSeverity`** (the run's `once`; SEV4 to SEV3 on a policy that escalates from SEV3, or anything into SEV1 or SEV2)
  starts a new, full run: `incident.setSeverity` marks that `incident.severity_changed` `escalates: true`, which asks
  for a page whatever the new severity, and the page starts the run on its event (de-duplicated by it, so a
  redelivery or a replay pages nobody twice). A raise that stays below the threshold (SEV4 to SEV3 on a policy that
  escalates from SEV2) pages nothing, as before. (A run never stays `running` below the threshold: it ends as
  `paged_once` in the same transaction that started it.) The threshold is the one the run started with: a policy whose
  `minSeverity` is edited during the incident applies from the next run (a raise into SEV1 or SEV2 always starts
  one).

Tests: `packages/schema/tests/escalation.test.ts` ("escalating from a severity": a declarer alone on the first level,
a raise up to it, `escalation.now` on a run that paged once), `apps/api/test/escalation.test.ts` ("escalating from a
severity": below it level 1 once and the alarm fires nothing; SEV1 on the same policy and SEV4 with it unset escalate
fully; SEV4 raised to SEV3 escalates fully on a SEV3 policy and pages nothing on a SEV2 one; a lost first page paged
again once), `apps/api/test/slack.test.ts` ("escalating a run that paged once"), `apps/api/test/email.test.ts`.

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
  paged: only the person who declared it can respond", `nobody_else`). A member escalating by hand past the last
  level of the last round (`escalation.now`, `reason: "manual"`, RFC 0011) ends the run the same way: everyone who
  can respond, not the commander first.
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
  effort; decided, Q18: a missing receipt never escalates early), so one device that took it, on any member of the level, keeps the level waiting for its timeout; so does
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
(`over_limit`); RFC 0005 "Notifiers". On the timeline (decided, Q18), more than five such members of one page for the
same reason read as one summary line ("Couldn't page 12 people: no registered device", `PAGE_FAILURES_SUMMARY_OVER`
in `packages/sync`), with the names behind Show names; five or fewer read one line each. Each member's own entry, event
and email are unchanged, so why-wasn't-I-paged still says it per member. Test: `apps/web/test/timeline.test.ts`.

Members are the shard's member list (RFC 0003), a copy of D1's that `member.sync` fills when a member opens a sync
socket, so someone who never opened Brigade is not paged (they have no device either). A D1 outage must never become
a reason a page is late or missing: the page path reads D1 only for the bounded check below, and pages with the
shard's copy whenever that check fails. How the copy follows D1 (RFC 0003 "Members"):

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
  close. Without anyone opening Brigade (decided, Q18; the activity-driven reconcile stays, with no extra timer for an
  idle shard), two more things catch up:
  - **Periodically, from the shard's alarm.** The first change with events since the member list last agreed with
    D1 records the shard as active and sets the alarm for `MEMBER_RECONCILE_PERIOD_MS` (10 minutes) after that last
    reconcile; the alarm then asks for the member repair, which reconciles (retrying every 30 s while D1 fails). An
    idle shard reads nothing, an active one D1 once per period at most. A shard never reconciled since this shipped
    waits a period from its first activity.
  - **Just before a page.** When the list last agreed with D1 more than `MEMBER_STALE_MS` (5 minutes) ago, the
    shard reconciles before planning the page (`Membership.fresh`). It fails open: the page waits at most
    `MEMBER_CHECK_BUDGET_MS` (1.5 s; the reconcile finishes in the background), and a D1 that fails or is late leaves
    the page to the shard's copy, logged (`paging with the shard's member list`), with the check skipped for 30 s
    so an outage does not cost every page its wait, and the repair alarm armed.
    So a member removed or demoted outside Brigade is still paged for at most a period of activity, never past a page
    planned while D1 answers, in a workspace of at most `MAX_RECONCILED_MEMBERS` (1000) members. Above that a
    reconcile catches up only on the members whose change the shard recorded as missed (above), so an edit made
    straight in D1 is not caught before a page, or ever, until paged member lists come (RFC 0003). These reads go
    to D1's primary: if D1 read replication is ever turned on, the reconcile's reads (and the member checks in
    front of a page) need a session that starts at `first-primary`, or a replica's older copy could put a removed
    member back. Tests: `apps/api/test/members.test.ts` ("a member deleted in D1 stops being paged at the
    next periodic reconcile", "a page checks a member list not checked against D1 lately first", "a page whose check
    D1 fails or hangs goes with the shard's copy", "a page whose check throws, rejects or never settles goes with the
    shard's copy, within 1.5 s").
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
    key is HPKE-only on both platforms (P-256 key agreement, in the Keychain and the Android Keystore): a signing key
    beside it is left for later. Removing the
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
    is left for the app. A removal made outside Brigade takes effect at the next reconcile (above).

Content: title `SEV1 · INC-142` (codes, so no locale is needed), body the incident's title, the incident id, its
workspace id (for the Acknowledge action) and the page's receipt token and URL ("Delivery receipts"), sealed per
device; urgency `page` for SEV1 and SEV2; `apns-collapse-id` is the incident id for a page, so a repeat replaces
the notification, and `<incident id>:high` for anything less urgent, so it never replaces a page ("Offline phones"). What happens when a page fails is RFC 0005 "Notifiers".

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
- **Android** pages show without the action for now: a tap opens the incident (below). The action button is left:
  the same JavaScript path (`page-action.ts`, `use-page-actions.ts`), its background time from the notification's
  broadcast receiver, not a background task.

## Android pages

Pages reach Android as the FCM data messages above. The app's `FirebaseMessagingService`
(`modules/brigade-push/android` `BrigadeMessagingService.kt`, extending expo-notifications' so every new token still
reaches `addPushTokenListener`, and declared at a higher priority so FCM delivers to it) handles them in native code,
so a page shows with the app killed and before JavaScript loads, as the iOS extension does:

- **Opens** the envelope with the device key (`Hpke.kt`, `DeviceKey.kt`) and checks the plaintext as the extension
  does (`PushPayload.kt`; a receipt only as `packages/push` `parseReceipt` takes it).
- **Shows** a page on the "Pages" channel (`brigade_pages`, from the call module: alarm sound, vibration, high
  importance, lock screen visible) and anything less urgent on "Incident updates" (`brigade_updates`, default sound),
  tagged with `tag` so a repeat replaces it. The pages channel asks Do Not Disturb to let it through
  (`setBypassDnd`), which only takes effect once the member grants Brigade that access in Settings; the app does not
  ask for it.
- **A tap opens the incident**, in its workspace: the notification's intent carries the decrypted incident and
  workspace ids, and the app switches to that workspace when another is open, then opens the incident
  (`src/hooks/use-page-taps.ts`, `src/lib/page-taps.ts`). The launcher activity is exported, so any app could start
  it with the same extras; they are honoured only with their proof (`PageTap.kt`): an HMAC-SHA256 over the ids and
  when the notification was made, under a random key in the app's private preferences, for a day.
- **A call** (`kind: "call"`) rings through the existing ring (`Calls.ring` in `modules/brigade-call`), with its
  fallbacks (RFC 0010).
- **Unreadable** (malformed, another version, not for this key): the fallback text from `packages/i18n`
  (`push_fallback_title`, `push_fallback_body`), on the pages channel for a page or anything unreadable, never
  silent.
- **Receipts** as the extension sends them (below): only for a page it opened, only to the origin the app registered
  with (kept in the app's preferences, `setReceiptOrigin`), 5 s, no retry, the token never logged.
- **No Firebase in the build** (no `google-services.json`, `apps/mobile/README.md`): the app builds without an FCM
  token and says pages are not set up on the phone (`unsupported`), as before.

Tests: the Kotlin crypto and parsing on the JVM (`HpkeTest.kt`: RFC 9180 vector A.3.1 and a page sealed by
`packages/push`; `KeyChecksTest.kt`, `PageTapTest.kt`), the JavaScript in Node (`device.test.ts`, `page-taps.test.ts`).

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

**Calls** (RFC 0010) have rows of their own, `kind: "call"`, id `<incident>:<event>:<device>:call`, planned with the
alert's row for each device the page rings (`delivery.plan` with `call`) and reported in the same `delivery.report`
(`kind: "call"`): planned, sent, accepted by APNs or the error with APNs' reason (`token_invalid` for a call means its
VoIP token was cleared, `device.expireVoip`, and the device stays). A call has no delivered stage (the extension never
sees it), and a receipt can never name its row. A call row whose alert never got through stays planned: the call is
sent only once the relay took the alert. Call rows never count as the page reaching the device: the verdict, the early
escalation (`escalation.unreached`) and "no device left because the push service refused one" read the alert rows
alone. `notification.planned` counts them as `calls`, `notification.sent` as `calls: { accepted, failed }`. Each kind
keeps its own `MAX_DELIVERIES_PER_DEVICE` rows per device.

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
token. Android's `FirebaseMessagingService` does the same after showing the page ("Android pages"). So receipts are
**best effort**: iOS may end the extension before the request leaves, a phone offline after showing the page never
reports, and call pushes (RFC 0010, whose rows stop at accepted) send none. A missing receipt means
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
with times and errors, each call that rang a device after its alert as a line of its own (stages, errors, or "not
rung" when its alert never got through; never the page's outcome), the phones they have now and when each was last
heard from, which pages ring them as a call (their choice, RFC 0010), the email about a missed page (expected,
failed, capped, off) and who acknowledged. The list adds the calls in a word next to the outcome ("Call sent", "Call
failed", "Call not sent"). The mobile app has the same list on its incident screen ("Who was paged", the member's
own "My paging" first) and the same explanation as a screen of its own (`/incidents/<n>/why?member=<member>`, another
member picked from a sheet), from the same `whyPaged` and the same wording (`@freecorps/brigade-i18n/why-paged`).

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
- Use `getDevicePushTokenAsync()` (native token), not Expo push tokens: APNs' on iOS, FCM's on Android.
- Android's Firebase project comes from `google-services.json`, never committed: `app.config.ts` reads its path
  from `GOOGLE_SERVICES_FILE`, else `~/.config/brigade/google-services.json` when it exists, and sets
  `android.googleServicesFile` (`plugins/google-services.ts`).

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
