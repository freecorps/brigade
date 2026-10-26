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
  last member signed in on it, or failed. Registering into one workspace only: the active one.
- **The relay** takes the device's `environment` with each push and picks the APNs host from it (one provider token
  signs for both).

## Who is paged

A workspace with a **default escalation policy** (RFC 0003 "Escalation policies") pages through it; one without
pages by the **interim rule**, unchanged since Phase 1.

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
- **A run that ends unacknowledged** (every level and repeat paged, nobody acknowledged) falls back to the interim
  rule once the same way, then ends. This also covers a run whose only reach was whoever declared it (on call and
  counted as reached, so nobody was pushed): it must not end silently, so everyone else who can respond is paged
  at the last level's timeout.
- **A level that cannot fire** (`escalation.advance` refusing it while the run is due and still running: a bug, or a
  row it cannot read) is never dropped. Its first failure goes on the timeline ("An escalation level couldn't fire",
  `escalation_stalled`), it is tried again every minute, and once it has been due for 3 minutes the shard pages the
  interim rule through a mutation that does not read the levels (`escalation.fallback`, `reason: "stalled"`) and the
  run ends.
- A level reached on some device whose push then fails (relay down, APNs refusing) is recorded when the page
  settles (RFC 0005 "Notifiers") and escalates at its timeout, not before: retries take about 75 s and a level's
  timeout is at least a minute. Escalating early on a failed delivery is left for delivery receipts.
- **Timers survive restarts.** The run and its timer are in the shard's storage; the alarm is set whenever a run
  starts or advances, and the object re-arms it from the earliest timer every time it wakes, so an eviction or a
  deploy mid-escalation resumes on time (or at once, if the level was due meanwhile). The alarm fires due levels
  **before** monitor upkeep, the outbox drain and the member repair (each level is a synchronous mutation, at most
  50 per run, the rest right after), and the drain that follows sends their events; no level ever waits on D1.
- **Idempotency.** Each level is its own event, so the page ledger (RFC 0005) de-duplicates it like any page; the
  start is de-duplicated by the event that asked for it (`start:<event id>`), and a level by the run's page count,
  (`advance:<incident>:<page count>`), so a redelivered event or a repeated alarm never pages a level twice. A level's
  event carries its run
  and page count: one from a run that has stopped (acknowledged and then reopened, or replaced by a new run) sends
  nothing. A dead-lettered level is recorded like any dead-lettered page; a dead-lettered **first** page (the shard
  never planned it, so no run started) starts the run when it is recorded, its first level marked as not paged, so
  the next levels still fire on time.

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

Content: title `SEV1 · INC-142` (codes, so no locale is needed), body the incident's title, and the incident id,
sealed per device; urgency `page` for SEV1 and SEV2; `apns-collapse-id` is the incident id, so a repeat replaces
the notification. What happens when a page fails is RFC 0005 "Notifiers".

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

| Need                      | iOS                                          | Android                                           |
| ------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Break through Focus / DND | `interruption-level: time-sensitive`         | High-importance channel + DND access (user grant) |
| Ring on silent            | Critical Alerts entitlement (apply to Apple) | Alarm-sound channel                               |
| Act from the notification | Category actions: Ack / Escalate             | Action buttons                                    |
| Collapse repeats          | `apns-collapse-id`                           | Notification `tag`                                |
| Full-screen alarm         | n/a                                          | `USE_FULL_SCREEN_INTENT` (Play policy review)     |

## Expo specifics

- Development builds only (no Expo Go) — native modules + NSE.
- NSE added by our own config plugin (`apps/mobile/plugins/notification-service.ts`): the extension target, the push,
  App Group and time-sensitive entitlements, and the fallback strings for both targets.
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
