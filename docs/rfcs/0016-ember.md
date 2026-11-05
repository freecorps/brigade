# RFC 0016 — Brigade on Ember

- Status: Draft

## Problem

Brigade built its own real-time engine on Durable Objects (RFC 0004, "Brigade Sync"), its own transactional outbox and
Queue consumer (RFC 0005), its own push relay (RFC 0006, RFC 0015) and its own monitoring placement (RFC 0007). Freecorps
has since built [Ember](https://github.com/freecorps/ember) ("Convex on Cloudflare", MIT, `@freecorps/ember-*` on npm):
typed shards on Durable Objects with reactive queries, optimistic mutations, a scheduler, components, Better Auth,
files and direct APNs/FCM push with end-to-end encrypted envelopes, much of it modelled on what Brigade learned. Two
goals follow:

1. **Brigade becomes the real-world notification-delivery example for Ember.** Brigade already has an App ID with push,
   Critical Alerts and an App Group, an APNs key, a Firebase project, a dev, staging and production environment and an
   app in TestFlight, so it is where Ember's direct push transport (Ember plan R12: a real `.p8`, delivery, topic rules,
   provider-token reuse, FCM on a real Android phone) gets proven.
2. **Brigade moves onto Ember**, so the engine, scheduler, outbox and transport are maintained once, in an MIT project,
   and Brigade keeps only its domain.

Brigade is a paging product. The migration is acceptable only if no step can stop someone from being paged: every
step keeps a fallback and a test (AGENTS.md), and the old path stays deployable until the new one has run in production.

## What does not change

- **The rules.** The server is the authority: every write is a named mutation with RBAC (RFC 0004). Every state change
  emits an event atomically with it (RFC 0005). Paging paths have a fallback and a test. `packages/*` stay MIT; apps
  stay AGPL (RFC 0009).
- **The licence boundary, in both directions.** Brigade depends on Ember from npm; nothing from Brigade's AGPL apps is
  copied into Ember. A gap found here is described in Ember's terms (what, why, a proposed API) and built there
  clean-room (section "Ember gaps").
- **The public contract.** `docs/api/openapi.json`, the SDK, webhooks, the status page and the Slack app keep their
  shapes. What runs behind a route changes; the route does not.
- **The paging semantics of RFC 0006** (who is paged, escalation, fallbacks, delivery rows, receipts, held pushes,
  Critical Alerts, calls) and the sealed envelope the phones open (RFC 0006 "Encryption", RFC 0015 section 4). The
  apps in the field keep working against every instance they talk to, migrated or not.

## Map

| Brigade today                                                        | On Ember                                                                                                                                         | When      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| Relay and API's APNs/FCM code (provider token, OAuth, error mapping) | `@freecorps/ember-push`'s transport, Brigade's payload and envelope unchanged ("Push")                                                           | Step 1    |
| Relay hop for an instance that holds the app's credentials           | The API sends directly through the same transport; the relay is its fallback                                                                     | Step 2    |
| `WorkspaceDO` (`store_rows`, change log, version, epoch)             | An Ember shard kind `workspace`, keyed by the workspace id, typed tables from `packages/schema` `TABLES`                                         | Steps 3–5 |
| Named mutations (`packages/schema` `defineMutation`, `runMutation`)  | Ember `mutation`s that call the same `apply` over an Ember-backed `Store`, the actor from `ctx.auth` and the shard's member row                  | Step 3    |
| Named queries (`defineQuery`, one table, `filter`/`sort`)            | Ember `query`s over `withIndex`, the same rows and permission check                                                                              | Step 3    |
| Brigade Sync protocol and client (`packages/sync`)                   | Ember's protocol and `@freecorps/ember-client` / `-react` / `-react-native`; `packages/sync` keeps the pure parts (`whyPaged`, timeline folding) | Steps 4–5 |
| Outbox → `brigade-events` Queue → consumer; `page_pending` fallback  | Scheduler jobs written in the mutation's transaction; pages delivered from the shard's alarm when the Queue stalls ("Events")                    | Step 3    |
| Escalation timers on the shard's alarm                               | Scheduler jobs (`ctx.scheduler.runAt`), one per level, de-duplicated by the run and its step                                                     | Step 3    |
| Better Auth on D1 (sessions, organizations, rate limits)             | **Kept on D1** for now; Ember's `ctx.auth` verifies a short-lived JWT minted from the D1 session ("Auth")                                        | Step 3    |
| `ProbeDO` × regions, `WatchdogDO`, Worker Cron Triggers              | Probes as an Ember shard kind with a per-key location hint (gap); the watchdog and its Cron Trigger **stay outside Ember** ("Monitoring")        | Step 6    |
| `status-edge`, KV `STATUS` snapshot, `StatusPages` entrypoint        | Unchanged; the snapshot push becomes a scheduler job of the workspace shard                                                                      | Step 6    |
| Slack Worker and the `SlackBridge` entrypoint                        | Unchanged; the bridge's methods call the shard's Ember functions as the Slack actor                                                              | Step 6    |
| D1 (members, invitations, cross-workspace reads, `session_end`)      | Unchanged                                                                                                                                        | —         |

The steps are under "Order of work". Each is its own PR or stack, green on its own, and the old path is removed only
in the last step.

## Push

### What Ember's push gives, and what a page needs that it does not have yet

`@freecorps/ember-push` sends straight to APNs (ES256 provider token, reused 40 minutes, shared by concurrent sends,
signed again after `ExpiredProviderToken`) and FCM HTTP v1 (an RS256 service-account assertion exchanged for an access
token, kept until 5 minutes before it expires, concurrent exchanges shared). Its behaviour was modelled on Brigade's
relay as RFC 0006 describes it. Its higher layers (`sendApns`, `sendFcm`, `sendToDevices`, the `push` component) build
the payload themselves: an `ember` envelope sealed under Ember's own HPKE `info`, with `{ title, subtitle, body, data }`
inside. A Brigade page cannot go out through them today:

- the phones in the field (iOS Notification Service Extension, Android `FirebaseMessagingService`) open Brigade's
  envelope under `brigade`, version 1 or 2, with Brigade's `info` and plaintext (`iat`, `exp`, `origin`, `urgency`,
  the receipt token, RFC 0015 section 4); changing the format means a new app build on every phone and breaks every
  instance not yet updated (RFC 0015: one store app for every instance);
- a Critical Alert needs `sound: { critical: 1, name, volume }`, which `PushMessage.sound` cannot carry;
- an Android page is a data message with Brigade's keys (`v`, `k`, `enc`, `ct`, `kind`, `urgency`, `callId`, `tag`)
  that the native service reads before JavaScript loads;
- a call is a VoIP push whose body is `{ call: { id }, brigade }` (RFC 0010).

**Decision.** Brigade uses Ember's push as a **transport**: the credential layer (`apnsProviderToken`,
`clearApnsTokenCache`, `fcmAccessToken`, `clearFcmTokenCache`) and Ember's error vocabulary where it applies, around
Brigade's own payload builders. The envelope, the payloads, the phones and the NSE do not change, so the app already
on a phone receives and decrypts a page sent this way. The higher layers become usable once Ember takes an app-owned
payload (gap G1); until then the component is not on the paging path.

### Step 1: the relay sends through Ember's transport

`apps/relay` gets its APNs provider token from `apnsProviderToken` and its FCM access tokens from `fcmAccessToken`
(`retries: 0`, the relay's own `fetch` and its 4 s exchange deadline), in place of its `ApnsTokenCache` and
`GoogleTokenCache` (`apps/relay/src/provider-tokens.ts`). Everything else is as RFC 0006 says: the same `/send`,
`/v1/send` and deep health, the same answers, timeouts and logs. It needs no new secret: the relay already holds
`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `FCM_SERVICE_ACCOUNT`, so deploying it to `dev` exercises Ember's
transport with the real `.p8` and service account, which is Ember's R12 (section "Real-device check").

- **Provider tokens.** Reused for 40 minutes per isolate and per key (team, key id, key text), shared by concurrent
  signings. `ExpiredProviderToken` signs a new one only if the cached token is still the one that was refused, so
  concurrent sends that saw it refresh once, and the instance retries the page. A key no signer can import is
  `500 relay_misconfigured`, as before.
- **Access tokens.** Reused until 5 minutes before they expire, one exchange at a time. An exchange Google refuses
  (4xx but 429) is `500 relay_misconfigured`; anything else (unreachable, 5xx, 429, past the 4 s) is `502
  fcm_unreachable`, retried by the instance, as before. A 401 from FCM fetches a new token unless another send already
  did, and sends once more within the call's 9 s.
- **Fallback (paging path).** The relay's own signers stay. When APNs refuses a token Ember signed as
  `InvalidProviderToken`, when Ember cannot import the key, or when Google refuses Ember's assertion, the isolate
  switches to the relay's own signer for an hour and the same send (or deep health check) goes again at once with it.
  The switch is sticky so the two signers never alternate on one key (APNs answers that with
  `TooManyProviderTokenUpdates`); a key that is simply wrong fails both and answers as before. Logged as
  `Ember's push transport was refused`, and every `APNs response` line names its `signer`. Removed in step 8, once
  Ember's tokens have run in production.
- **Tests.** The relay's suites (fake APNs, fake Google token endpoint and FCM) run unchanged against Ember's code;
  `apps/relay/test/provider-tokens.test.ts` checks the tokens (verifiable with the keys, reused), the fallback and its
  stickiness, the expired-token rule and the deep health check's fallback.

### Step 2: the instance sends directly, the relay as fallback

For an instance that holds the app's credentials (Freecorps' hosted instance, or a company with its own build, RFC
0015 "Your own relay"), the relay is a hop that can fail on its own. The API gains a third route next to `/send` and
`/v1/send` (`apps/api/src/notify.ts` `RelayRoutes`): `direct`, the same payload builders and the same Ember transport,
called in the notifier's own invocation, chosen when the API Worker has `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`
(and `FCM_SERVICE_ACCOUNT` for Android) and the device has a raw token.

- **Fallback, per device.** A direct send that fails as a transport or a configuration (unreachable, 5xx, 429,
  `InvalidProviderToken`, a bad key, `relay_misconfigured`-like answers, a token of another topic or Firebase project)
  goes on through the relay route the device would have used, in the same attempt; one APNs or FCM refuses for the
  device itself (`BadDeviceToken`, `Unregistered`, `UNREGISTERED`) is handled as today (the device dropped, the page
  retried). A device with only a relay handle (RFC 0015) always goes through the relay: its raw token is the relay's.
- **Tests.** The notifier's suite runs every page case with the direct route on a fake APNs and FCM, and the fallback
  cases (direct unreachable, refused credentials, wrong topic) reach the fake relay with the same envelope.
- **Owner action.** The API Worker's secrets cannot be read from the relay's (Worker secrets are write-only), so
  step 2 needs the owner to set the four secrets on `brigade-api-dev` from their own copy of the files (section
  "Real-device check"). Until then the route is off and pages go through the relay as today.

### The push component, later

Brigade's device registry (`device.register` and its rules: ten per member, sessions, `taken`, password resets,
removal watch, summaries) and its delivery ledger are domain rules, not a generic registry: they stay Brigade's
tables in its workspace shard (step 3), with Ember's transport underneath. The component's job model (send
enqueued atomically from a mutation, delivered by a job) is what step 3 builds for pages anyway, with a fallback the
component does not have (G2). Revisit once G1 and G2 are in Ember.

## Data and sync

### The workspace shard

`WorkspaceDO` becomes an Ember shard kind `workspace` (`defineShard({ key: v.string() })`, the key the workspace id),
and its tables are Ember tables (`defineTable`) generated from `packages/schema` `TABLES` (the synced ones and the
server-only ones: `devices`, `counters`, `receipt_key`, …) with Brigade's own `id` as a field and an index (Ember's
`_id` is its own; client-made Brigade ids keep working). `packages/schema` gains an Ember-backed `Store` (`get`,
`insert`, `update`, `delete`, `scan`, `transaction`) over `ctx.db`, so **every mutation's `apply` runs unchanged**:

```ts
// apps/api/ember/incidents.ts (AGPL app code)
export const declare = brigadeMutation("incident.declare"); // validates, resolves the actor, runs runMutation
```

- **Actor and RBAC.** `brigadeMutation(name)` builds an Ember `mutation` whose handler resolves the actor from
  `ctx.auth` (a member: their role from the shard's member row; a token: its scopes, RFC 0014; system actors only
  through `internalMutation`) and calls `runMutation` with Brigade's `can(role, permission)` check, exactly as the
  shard does today. Refusals keep their codes (`forbidden`, `conflict`, …) as Ember errors with `data.code`.
- **Determinism.** Brigade's mutations already take time from `ctx.now`; `ctx.now` comes from Ember's seeded clock.
- **Events.** `commit(events)` writes each event to an `events` table (the timeline and webhooks read it) and schedules
  its delivery (below), in the mutation's transaction.
- **Queries.** Each `defineQuery` becomes an Ember `query` that reads its table through an index and keeps
  `filter`/`sort` in JavaScript (Brigade's tables are small per workspace); reactivity is Ember's read sets.
- **Restores.** Ember's bookmarks (`ember restore`) replace the epoch hook (RFC 0004 "Epoch"): Ember's protocol
  already resnapshots a client after a restore.

### Events and paging (the outbox)

Today a mutation writes its events to `outbox` and pages to `page_pending`; the alarm drains the outbox to the Queue
and sends a page the Queue has not brought within 60 s itself (RFC 0005 "A page the Queue does not bring"). On Ember a
mutation schedules `internal.notify.deliver({ event })` with `ctx.scheduler.runAfter(0, …)`, atomically. Ember sends an
action job to its `EMBER_ACTIONS` Queue and **deletes the job row as soon as the Queue accepted it**, so a Queue that
accepts and then stalls (seen in production: seven minutes, no error) loses the page until it recovers. That is not
acceptable for pages:

- **Pages keep their own lease.** A page's event also writes `page_pending` (a Brigade table) in the mutation, as
  today; `deliver` clears it once the plan went through; a mutation job scheduled 60 s later (`ctx.scheduler.runAfter`)
  finds it still there and runs the page from the shard's alarm (Ember runs action jobs in the alarm when no Queue is
  bound; Brigade needs that per job, gap G2). Until G2, the page action is dispatched through `dispatchAction` with the
  shard-local path for page events.
- **Everything else** (Slack, webhooks, email, status page snapshots) is an ordinary action job with Ember's retries.
- **Idempotency** stays Brigade's: the page ledger and the delivery rows de-duplicate by event id, so a job run twice
  pages nobody twice.

### Clients

The dashboard moves to `@freecorps/ember-react` (or `-react-query`) and the app to `@freecorps/ember-react-native`.
Brigade's optimistic updates run the same `apply` on the client today; Ember's client applies registered optimistic
updates to query results, and running mutations on the client is not in Ember yet (gap G5), so step 4 registers one
optimistic update per mutation that runs `apply` over the cached rows.

**The store app talks to many instances** (RFC 0015), some self-hosted and not migrated. So the app keeps the Brigade
Sync client and picks the protocol from the instance's `GET /config` (`sync: "ember"` once migrated), for as long as
supported instances run the old engine; the dashboard is served by its own instance and switches with it.

## Auth

**Decision: Better Auth stays on D1 for now**, and Ember's `ctx.auth` trusts it. Moving to Ember's `Auth` Durable
Object is possible later (Ember runs Better Auth too) but not part of this migration, because:

- Brigade's auth carries a lot of its own behaviour on D1 (RFC 0002 "Auth": per-address and per-IP limits in
  `rateLimit`, sign-up modes, the first owner, `session_end` and session hooks that sign phones out of every shard,
  takeovers, QR sign-in through the internal adapter, the Expo plugin, the organization plugin with most routes
  refused). Each would need re-testing on a new store at the same time as the engine changes under it.
- D1's `member` table answers the cross-workspace questions a shard cannot (which workspaces a user is in, device
  registration in every workspace at once); it stays either way.
- Moving the users and sessions table means either signing every phone out (and with it every page, RFC 0006) or a
  live session migration. Neither is worth doing in the same step as the engine.

**How.** Better Auth's `jwt` plugin on the D1 instance mints a short-lived token (5 minutes) for a session; the
clients get it from `/auth/token` and send it in Ember's `hello`; the Ember hook verifies it against the instance's
JWKS (Ember's `remoteAuth({ from })` shape) and its `sensitive` mutations (removing a member, changing a role,
acknowledging from a notification) check the session in D1. A revoked session closes the socket with
`authExpired` (RFC 0004 "Session revocation", now Ember's). Revisit (Q33) once the migration is done.

## Monitoring, crons and the edges

- **Probes** (RFC 0007 "Placement") are one Durable Object per workspace and region with that region's
  `locationHint`. Ember's location hint is per shard kind; probes need one per key (gap G3). Until then `ProbeDO`
  stays a plain Durable Object and reports results by calling the workspace shard's Ember mutation.
- **The watchdog and its Cron Trigger stay outside Ember.** The dead-man switch exists to notice when the paging
  machinery stops (RFC 0007 "Watching the watcher"); running it on the machinery it watches (Ember's System DO and its
  crons) would remove that independence. The API Worker keeps its own `scheduled` handler for the watchdog and the
  D1 sweeps (`sweepSessionEnds`, `pruneRateLimits`) and hands Ember's System its tick.
- **Status page.** `status-edge` and the KV snapshot stay; the workspace shard's "snapshot out of date" flag and its
  push become a mutation that schedules an action.
- **Slack.** The Slack Worker keeps binding the API's `SlackBridge` entrypoint (RFC 0011 "Shape"); the bridge calls the
  shard's Ember functions as the Slack actor.

## Running Ember inside Brigade

Brigade deploys with Wrangler and its own workflows (RFC 0002 "Environments"), not `ember deploy`. Ember's runtime is
a library (`createEmberWorker`, the `Shard` and `System` classes), so the API Worker exports `Shard` and `System` next
to its own Durable Objects, binds them (`SHARD`, `SYSTEM`) and its Queue, and hands requests under `/ember/*` to the
Ember worker's `fetch` (the dashboard's Worker forwards `/api/*` as today). Ember's schema migrations run on each
shard's first wake, as with `ember deploy`. What `ember deploy` would provision (the actions Queue, the catalog) is
added to `wrangler.jsonc` by hand; the catalog and dashboard are optional. Mounting under a prefix and the binding
names are not a documented contract yet (gap G4).

## Data migration

Per workspace, in the shard that owns it, never as a bulk job:

1. **Ready.** The API Worker ships both engines; D1 gains `workspace.engine` (`brigade` or `ember`, default
   `brigade`). Nothing reads Ember yet.
2. **Copy.** An operator route (`POST /admin/workspaces/:id/migrate`, owner-only, `dev` first) asks `WorkspaceDO` to
   migrate. It refuses while the outbox or `page_pending` has rows, or a due escalation timer is minutes away, and
   then, in one turn of the object: stops taking writes (they answer `503 migrating`, which the apps and the API's
   clients retry), writes every row, counter, device, delivery row, member and pending escalation timer to the
   Ember shard through one internal mutation per batch (idempotent by row id), and checks counts and a hash per
   table on both sides.
3. **Switch.** D1's `workspace.engine` flips to `ember` and `WorkspaceDO` keeps a `forwarded` mark: every request it
   gets from then on (an old socket, the Queue's late event, an alert route) is forwarded to the Ember shard or
   refused with `410 moved`. Escalation runs continue from the copied timers (jobs at the same due time).
4. **Rollback.** Flipping `engine` back to `brigade` within the keep window (30 days) makes `WorkspaceDO` the owner
   again after copying back what changed since (the Ember shard keeps a change log of its own rows); after that window
   the old storage is deleted by a later PR.

Freecorps' own workspaces go first, on `dev`, then `staging`, then production. **Running the migration against
production data needs the owner's approval**, as does every deploy to staging or production (AGENTS.md).

## Real-device check

What proves Ember's push on real hardware, with what the steps above built:

1. **Relay on Ember (step 1), no new secrets.** Deploy `dev` (the Deploy workflow run by hand with `environment: dev`
   on the branch, which deploys `brigade-relay-dev` and the Workers that bind it). Install a development build of the app pointed at the `dev`
   instance on an iPhone (`expo run:ios --device`, sandbox token) and on an Android phone with
   `google-services.json`. Sign in, allow notifications (and Critical Alerts on a store build), declare a SEV1 from
   the dashboard as another member. Expected: the page on the locked iPhone with the incident's title (the NSE opened
   it), the Android page on the "Pages" channel with the app swiped away, a `delivered` row for each phone in the
   incident's "Who was paged". The relay's logs (`APNs response`, `FCM response`) show the provider's answer; many
   pages in a row must never show `TooManyProviderTokenUpdates`.
2. **Topic and environment rules.** A production-signed build's token registered against the sandbox environment is
   refused (`BadDeviceToken`) and the device dropped; a token for another topic is `DeviceTokenNotForTopic`, the
   device dropped too (RFC 0006 `TOKEN_GONE`).
3. **Direct (step 2).** With the four secrets set on `brigade-api-dev`, the same page goes out without the relay
   (the API's log says `direct`), and with `APNS_KEY_ID` set wrong it still arrives (the relay fallback).

## Ember gaps

What Brigade needs that Ember does not have, each worked around here and proposed for Ember, clean-room:

- **G1 — App-owned payloads in the direct transport.** `sendApns`/`sendFcm`/`sendToDevices` always build the payload
  and the envelope. Proposed: `AddressedPushMessage.payload?: { apns?: Record<string, unknown>; fcmData?:
  Record<string, string> }` sent as given (Ember still sets headers, priority, expiration, collapse id, the provider
  token, retries and error mapping), plus a `PushTransports.seal?(device, message) → { apns, fcmData }` hook so an app
  with its own envelope can use `sendToDevices` and the component; and `sound` taking APNs' critical-sound object with
  `interruptionLevel: "critical"`. Workaround: Brigade builds its payload and uses only the token layer.
- **G2 — Action jobs that must not depend on the Queue.** A dispatched action job's row is deleted once the Queue took
  it. Proposed: per function `action({ dispatch: "shard" })` (run in the shard's alarm, as without a Queue) or a
  lease (`_jobs` keeps the row as `dispatched` until the action reports back, and runs it locally past a grace time).
  Workaround: Brigade's `page_pending` lease and a delayed check job.
- **G3 — A location hint per shard key.** `defineShard({ locationHint })` is per kind. Proposed: `locationHint: (key)
  => string | undefined`. Workaround: `ProbeDO` stays a plain Durable Object.
- **G4 — Embedding the runtime in an existing Worker.** Proposed: document `createEmberWorker` as an embeddable entry
  (binding names, `EMBER_PROJECT`/`EMBER_ENV`, the queues it expects) and a `basePath` option, so an app deployed with
  Wrangler mounts it under `/ember`. Workaround: Brigade rewrites the path before calling it.
- **G5 — Mutations run on the client.** Ember's optimistic updates are hand-written per query; Brigade runs the same
  mutation code on both sides (RFC 0004). Proposed: the "run mutations on the client" item already in Ember's plan
  (§10, "Fica para depois"), with a seeded `ctx.random`. Workaround: one optimistic update per mutation running
  Brigade's `apply` over cached rows.
- **G6 — Error detail from the transport.** `fcmErrorCode` and `apnsErrorCode` map to Ember's codes but Brigade needs the
  provider's raw reason (`DeviceTokenNotForTopic`, FCM's `INVALID_ARGUMENT` about the token, `tokenInvalid`) for its
  delivery rows and its rule that a token of another Firebase project is never dropped. Proposed: keep `reason`
  (the provider's string) on error tickets next to `error`. Workaround: Brigade keeps its own error parsing.
- **G7 — Timeouts on the token layer.** `fcmAccessToken` retries the exchange with backoff and has no deadline; a
  caller with a budget wraps it and the exchange runs on. Proposed: `signal` or `timeoutMs` in `FcmOptions` and
  `ApnsOptions`. Workaround: `retries: 0` and Brigade's own deadline around the call.

## Order of work

1. **Relay on Ember's transport**. Proves Ember's provider-token and access-token layer with the
   real credentials on `dev`.
2. **Direct sends from the API** with the relay as fallback, off until the API has the credentials.
3. **The workspace shard on Ember behind `workspace.engine`**: tables, the Ember-backed `Store`, mutations and
   queries through `brigadeMutation`/`brigadeQuery`, events and pages as scheduler jobs with the page lease, the
   auth hook. Brigade's existing mutation and paging tests run against both engines.
4. **Dashboard on Ember's React client**, switched by `/config`.
5. **App on Ember's React Native client** next to Brigade Sync, picked per instance.
6. **Monitoring, status page and Slack** calling the Ember shard; the watchdog unchanged.
7. **Migration route and per-workspace cutover** on `dev`, then staging and production with the owner's approval.
8. **Removal** of `WorkspaceDO`'s engine, `packages/sync`'s protocol and server parts and the Queue consumer's page path,
   once every workspace of an environment has run on Ember for the keep window.

Open questions: Q33 (when, if ever, auth moves to Ember's `Auth`), Q34 (whether the hosted instance stops using the
relay once direct sends are proven).
