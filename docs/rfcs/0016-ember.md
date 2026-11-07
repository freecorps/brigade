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

| Brigade today                                                        | On Ember                                                                                                                                                       | When      |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Relay and API's APNs/FCM code (provider token, OAuth, error mapping) | `@freecorps/ember-push`'s transport, Brigade's payload and envelope unchanged ("Push")                                                                         | Step 1    |
| Relay hop for an instance that holds the app's credentials           | The API sends directly through the same transport; the relay is its fallback                                                                                   | Step 2    |
| `WorkspaceDO` (`store_rows`, change log, version, epoch)             | An Ember shard kind `workspace`, keyed by the workspace id, typed tables from `packages/schema` `TABLES`                                                       | Steps 3–5 |
| Named mutations (`packages/schema` `defineMutation`, `runMutation`)  | Ember `mutation`s that call the same `apply` over an Ember-backed `Store`, the actor from `ctx.auth` and the shard's member row                                | Step 3    |
| Named queries (`defineQuery`, one table, `filter`/`sort`)            | Ember `query`s over `withIndex`, the same rows and permission check                                                                                            | Step 3    |
| Brigade Sync protocol and client (`packages/sync`)                   | Ember's protocol and `@freecorps/ember-client` / `-react` / `-react-native`; `packages/sync` keeps the pure parts (`whyPaged`, timeline folding)               | Steps 4–5 |
| Outbox → `brigade-events` Queue → consumer; `page_pending` fallback  | Scheduler jobs written in the mutation's transaction; pages delivered from the shard's alarm when the Queue stalls ("Events")                                  | Step 3    |
| Escalation timers on the shard's alarm                               | Scheduler jobs (`ctx.scheduler.runAt`), one per level, de-duplicated by the run and its step                                                                   | Step 3    |
| Better Auth on D1 (sessions, organizations, rate limits)             | **Kept on D1** for now; Ember's `ctx.auth` verifies a short-lived JWT minted from the D1 session ("Auth")                                                      | Step 3    |
| `ProbeDO` × regions, `WatchdogDO`, Worker Cron Triggers              | Probes as an Ember shard kind with a per-key location hint (gap), per workspace on its `workspace.engine`; the watchdog **stays outside Ember** ("Monitoring") | Step 6    |
| `status-edge`, KV `STATUS` snapshot, `StatusPages` entrypoint        | Unchanged; the snapshot push becomes a scheduler job of the workspace shard                                                                                    | Step 6    |
| Slack Worker and the `SlackBridge` entrypoint                        | Unchanged; the bridge's methods call the shard's Ember functions as the Slack actor                                                                            | Step 6    |
| D1 (members, invitations, cross-workspace reads, `session_end`)      | Unchanged                                                                                                                                                      | —         |

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

### Step 1: the relay sends through Ember's transport (built)

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
  `InvalidProviderToken`, when Ember cannot import the key, or when Google refuses Ember's assertion (or Ember's
  exchange fails in any way but Google being out of reach), the same send (not the deep health check, which keeps a
  cache of its own for Google) goes again at once with the relay's own signer. If that one can sign, the isolate keeps
  to it for at least an hour, and goes back to Ember's only once the relay's APNs token is due for renewal anyway, so
  the two signers never make two token updates on one key within APNs' 20 minutes (`TooManyProviderTokenUpdates`). If
  the relay's own signer cannot read the key either, or APNs refuses its token too, nothing switches and the answer
  is as before. Logged as `Ember's push transport was refused`, and every `APNs response` line names its `signer`.
  Removed in step 8, once Ember's tokens have run in production.
- **Tests.** The relay's suites (fake APNs, fake Google token endpoint and FCM) run unchanged against Ember's code;
  `apps/relay/test/provider-tokens.test.ts` checks the tokens (verifiable with the keys, reused, one signing for
  concurrent sends), the fallback, its stickiness and the way back, a key only Ember can read, both signers refused,
  the expired-token rule, a refused access token never reused, and the deep health check's fallback.

### Step 2: the instance sends directly, the relay as fallback (built, off until configured)

For an instance that holds the app's credentials (Freecorps' hosted instance, or a company with its own build, RFC
0015 "Your own relay"), the relay is a hop that can fail on its own. The API has a third route next to `/send` and
`/v1/send` (`apps/api/src/notify.ts` `RelayRoutes`): `direct` (`apps/api/src/direct-push.ts`), which runs the relay's
own `/send` code in the notifier's invocation (`sendBody`, exported by `apps/relay` as `@freecorps/brigade-relay/send`:
the same validation, payloads and envelopes, Ember's transport for the tokens, the same answers), so the rest of the
notifier (refusals, retries, the Critical Alert fallback, calls, delivery rows) reads a direct send exactly as a
relay's. It is on when the API Worker has `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_TOPIC` (the relay's
names), and taken for a device with a raw token; Android goes direct only with `FCM_SERVICE_ACCOUNT` too.

- **Fallback, per device, inside the route.** A direct send settles by itself only when the provider took it or said
  the device's token is gone (`BadDeviceToken`, `Unregistered`, `410`, FCM's `UNREGISTERED`, or a token FCM marks
  done): then the device is dropped and the page retried, as today. Anything else (a key APNs refuses, APNs or Google
  out of reach or slower than `DIRECT_BUDGET_MS`, 6 s, 5xx, 429, a body refused, a topic or Firebase project that is
  not the app's) goes to the relay's `/send` with the same body in the same attempt, and the relay's answer is the
  route's; when that fails too, or there is no `/send`, the device's relay handle takes it, as before direct sends.
  Answers the instance gave itself carry `Brigade-Sent-By: direct`, and on those a `DeviceTokenNotForTopic` never
  drops a device (a mistyped `APNS_TOPIC` would otherwise drop every phone): with nothing to fall back on it is a
  failure on the timeline (`apns_refused`). An Android phone on an instance without a Firebase service account goes
  straight to the relay. A device with only a relay handle (RFC 0015) always goes through the relay. An instance with
  no relay at all pages directly, with the instance's own retries as its only fallback, as a relay-only instance has
  today. A send that runs past the budget may still reach the phone and the relay's copy follows it: the page's
  collapse id (a call's id) makes it replace it rather than stack.
- **Tests.** `apps/api/test/direct-push.test.ts`: a page reaches APNs from the instance with the envelope the phone
  opens and never the relay; a refused key, APNs out of reach and a wrong topic page through the relay with the same
  envelope and drop no phone; APNs that never answers hands over within the budget; a token gone is settled directly;
  without a relay, a wrong topic keeps the phone and a gone token drops it; a Critical Alert goes direct; Android
  without the service account, and an instance without all four secrets, page through the relay as before; an
  instance without a relay retries. Not covered yet: calls and the handle fallback through the direct route. The relay's suites
  run the same `sendBody`.
- **Not yet.** The watchdog's beat (RFC 0007 "Watching the watcher") still proves the relay's providers, not the
  instance's own key; a broken direct key costs nothing (pages fall back) but is only seen in the logs (`direct send
  failed, paging the device through the relay`). Proving it in the beat comes with turning direct sends on in
  production (Q34).
- **Owner action.** The API Worker's secrets cannot be read from the relay's (Worker secrets are write-only), so
  turning it on needs the owner to set the four secrets (and `FCM_SERVICE_ACCOUNT`) on `brigade-api-dev` from their own
  copy of the files (section "Real-device check"). Until then the route is off and pages go through the relay as today.

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

**The store (built).** `createEmberStore(ctx.db)` (`packages/schema/src/ember-store.ts`) keeps each row as
`{ id, data }`: Brigade's id, indexed `by_row_id` (Ember reserves `by_id`), and the row as JSON text, like
`store_rows` today, so no row Brigade has written is refused (Ember refuses `$`-prefixed field names) and adding a
field needs no Ember migration. It imports nothing from Ember (`ctx.db` is typed structurally), so the package stays
framework-light.

- **Rollback inside a mutation.** Ember's `ctx.db` has no savepoints, and `runMutation` undoes a failed `apply`
  without failing the Ember mutation that ran it. The store keeps an undo log (each write's row before it) and
  replays it backwards on a throw, nested as `transaction` requires; if replaying fails (Ember's write limit,
  say), the store refuses every later call and `undoFailure()` returns the error, which the handler rethrows so Ember
  rolls the whole mutation back rather than commit a half-undone one (`runMutation` alone would turn it into an
  `internal` result).
- **Ember's read limit.** Ember refuses a transaction that reads more than 16,384 rows, and Brigade's mutations scan
  tables and look rows up again and again (an `alert.ingest` of 50 alerts in a workspace with a few hundred alerts
  went past it). The store holds what one call has read and written, so in one mutation or query a scanned table is
  read from Ember once, a row once, and an id range once (a range inside one already read is not read again; one
  that only partly overlaps it is); that keeps every mutation of today's suite under the limit. A workspace with more than 16,384
  rows in a table some mutation scans needs that mutation's reads narrowed to an index first.
- **Tested on both stores.** `packages/schema`'s tests run twice: as they are, and with `createMemoryStore` backed by
  a real Ember shard engine (`vite.ember.config.ts`, on `node:sqlite`), so every mutation and query test runs its
  `apply` over Ember's `ctx.db` too.

**The functions (built, `apps/api/ember/`).** Brigade's registries stay the one list of mutations and queries, so
the shard exposes them by name rather than one Ember export each: `workspace:mutate({ name, args })` runs a client
mutation (`mutations`), the internal `workspace:serverMutate({ name, args, actor })` a server-only one
(`serverMutations`: provisioning, `member.sync`, monitor reports) with the actor the API resolved, and
`workspace:query({ name, args })` a named query. That is the shape of a Brigade Sync `mutate` frame and subscription,
which the adapter ("Clients") needs anyway.

- **Actor and RBAC.** The handler resolves the actor from `ctx.auth` and calls `runMutation`/`runQuery` with
  Brigade's `can(role, permission)` check, exactly as the shard does today. A member's role is the identity's `role`
  claim: D1's, as the auth hook checked it at admission and again on every token refresh ("Auth"), so at most 5
  minutes old, lowered to the shard's member copy as `WorkspaceDO.tokenActor` does, so a demotion the shard ran holds at once. (The shard's
  member row cannot be the source: a member's first `member.sync` runs before it exists, and the row is a copy of
  D1.) An API token's identity carries `kind: "token"` and its creator's role; its scopes, revocation and expiry come
  from its `api_tokens` row in the shard. System actors exist only through `serverMutate`. The instance's caps (`MAX_MONITORS`) reach mutations through `setWorkspaceLimits`, called once by the Worker's entry, since Ember mutations have no `env`.
- **Results are values.** `{ ok: true }` or `{ ok: false, error }` with Brigade's `MutationError` (`forbidden`,
  `conflict`, `invalid_args` with its issues, …), not thrown errors: Ember's wire carries a thrown error's code and
  message only, and a refused mutation has already written nothing (the store's undo log).
- **Determinism.** Brigade's mutations already take time from `ctx.now`; `ctx.now` comes from Ember's seeded clock.
- **Events.** `commit(events)` writes each event's `BrigadeEvent` envelope (the one `writeOutbox` builds, RFC 0005)
  to an `events` table in the mutation's transaction (built); scheduling its delivery is the next step (below). The
  rows go straight to `ctx.db`, outside the store's undo log, so a mutation whose events fail to write fails as a
  whole instead of committing them next to its rolled-back rows.
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
  today. `deliver` clears it only once **every push of the plan is settled**: sent, or written as undelivered in its
  delivery row (refused, no device, gone). That is stricter than RFC 0005's Queue path, which clears the row after
  `planPage`, and the same as its alarm path, which clears after the sends: an action that stops between the plan and
  a send leaves the lease, so nothing that wakes someone up depends on the action finishing. A mutation job scheduled
  60 s later (`ctx.scheduler.runAfter`) finds a lease still there and runs the page from the shard's alarm (Ember runs
  action jobs in the alarm when no Queue is bound; Brigade needs that per job, gap G2). Until G2, the page action is
  dispatched through `dispatchAction` with the shard-local path for page events.
- **The check repeats while the lease lasts.** The check job, in the same mutation that finds the lease still there,
  schedules the next check 60 s later, so a lease is never left without a durable job to look at it again: a run the
  check started that stops too (or skips a live claim whose action then stopped) is looked at once more a minute
  later, until every push is settled and `deliver` clears the lease. It ends as RFC 0005's alarm path does today:
  once the page went, or after `PAGE_LOCAL_TRIES` (3) local tries, left to the Queue's copy of the action job. Test:
  the claiming action stops after its claim and before its send, and the next check sends the push.
- **A second run while the first is still sending** (the 60 s check, a Queue redelivery) sends only what the first has
  not: before each push, `deliver` claims its delivery row (event id and device) for 30 s in a mutation, the way RFC
  0005's email ledger holds a send for 60 s. A run that finds a row sent skips it; one that finds a live claim skips it
  and leaves the lease, so the next check sees whether that push settled; one that finds an expired claim takes it
  over and sends. A page's collapse id (APNs) and tag (Android) are its incident (RFC 0006), so a send that went out
  just as its claim expired replaces the banner already on the phone: a repeat, never a missed page.
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

**App versions that only speak Brigade Sync** stay installed on phones after a workspace moves, and they only know
how to reconnect and replay Brigade frames. So `/sync/:workspace` of a migrated workspace is served by a **Brigade Sync
adapter** on the Ember shard: it answers `hello`, `mutate` and the subscription frames of RFC 0004 by running the same
named mutations and queries as Ember functions and sending their results as Brigade `snapshot` and `patch` frames.
Both sides run the same `apply` and the same queries, so the adapter translates frames, not rules. It stays until
`/config`'s `minApp` is past the last release without the Ember client and no supported instance runs the old engine
(step 8); the adapter's tests are RFC 0004's protocol tests run against it.

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

**How.** The API mints a short-lived token for a caller it resolved as it resolves a sync upgrade (the session, or an
API token, then the member in D1): `POST /ember-token/:workspace` (src/ember.ts, src/ember-token.ts). It is an HS256
JWT signed with a key derived from `BETTER_AUTH_SECRET`, so an instance needs no new secret and no JWKS, and it
carries the user (`sub`), the one workspace it is for (`ws`: the shard refuses a token for another), the role, the
session id (`sid`, the id, never the token) and, for an API token, `kind: "token"`. Its `exp` is the earlier of 5
minutes and the session's own expiry, so a token never outlives its session and an admitted socket stops at the
session's expiry as RFC 0004 requires; a session already past its expiry gets no token. The clients send it in
Ember's `hello`, and again in `{t:"auth"}` before it expires (Ember's client refreshes 30 s ahead). The auth hook
reads D1 through the module's `env` (`cloudflare:workers`), since the runtime calls it in the Worker and in each
Shard without one.

- **Admission.** The Ember auth hook verifies the token's signature and expiry **and** checks D1 that the session
  is still there (its row: a sign-out, reset or takeover deletes it; `session_end` is only the queue of shard work
  after that, RFC 0002 "Auth") and that the member still backs the actor, with D1's role, as today's upgrade does (RFC 0004 "Session revocation"). A revoked session never opens a socket,
  with or without an unexpired token.
- **An admitted socket.** Every refresh runs the same hook, so a socket keeps access only while its session does.
  Ember already stops a socket's patches and refuses its frames once its token expires, until a fresh one arrives
  (`authExpired`); so the worst case after a revocation is the token's 5 minutes, and only when the close below fails.
- **Session end.** Better Auth's session-delete hook, which today asks each of the user's shards to close the
  session's sockets (`WorkspaceDO.endSession`), calls the Ember shard instead: it closes every socket whose identity
  carries that `sid` (gap G8), with the same 3 tries and `session_end` sweep as today. A password reset and a member
  removal close the same way (by user id). An expired session ends an Ember socket at its token's `exp`, which is
  never later than the session's expiry.
- **Old apps on the adapter.** An app version that only speaks Brigade Sync sends no JWT: its upgrade is
  authenticated by the Worker from the session cookie, as today, and the Worker passes the session id and expiry to
  the adapter (`Brigade-Session`, `Brigade-Session-Expires`, RFC 0004). The adapter checks `session_end` and the
  member at the upgrade, gives the socket an identity carrying the same `sid` and an expiry equal to the session's,
  and refuses an upgrade carrying a session it was told ended. Adapter sockets have no token to refresh, so the
  adapter gives each one the same 5-minute bound itself: it checks the socket's session and member in D1 again every
  5 minutes and before every mutation it runs, and closes the socket (`1012`, as RFC 0004 does) when the session
  ended or the member is gone. Once G8 exists the session-end close above reaches adapter sockets at once by the same
  `sid` and user id; until then the bound is those 5 minutes. An adapter socket still open closes at the session's
  expiry. No socket, adapter or Ember, outlives its session by more than 5 minutes, or at all once G8 is in.
- **Sensitive mutations** (removing a member, changing a role, acknowledging from a notification) also check the
  session in D1 at the moment they run, as today.

Revisit (Q33) once the migration is done.

## Monitoring, crons and the edges

- **Probes** (RFC 0007 "Placement") are one Durable Object per workspace and region with that region's
  `locationHint`. Ember's location hint is per shard kind; probes need one per key (gap G3). Until then `ProbeDO`
  stays a plain Durable Object and reports results to the workspace's owner of record: the Ember shard's mutation
  when D1's `workspace.engine` is `ember`, `WorkspaceDO` as today when it is `brigade`. The same choice, per workspace
  and per call, routes the status page snapshot and the Slack bridge below, so nothing writes to an Ember shard that
  does not own the workspace yet (a probe failure there would page nobody).
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

**As built** (src/ember.ts). The runtime is mounted at `/ember` (`basePath`, Ember 0.3.0), and the API exports `Shard`
and `System` (bindings `SHARD`, `SYSTEM`, Durable Object migration `v4`). Brigade hands it only the three paths its
clients use, `/ember/ws`, `/ember/api/query` and `/ember/api/mutation`, and only for a `workspace:<id>` shard whose
workspace D1 has on `ember`; everything else under `/ember` (admin, storage, actions, health) answers 404. The
instance's monitor cap reaches mutations through `setWorkspaceLimits`, set from the module's `env` when the module
loads, in the Worker and in each Shard alike.

## Data migration

**Decision (owner, 2026-11-07): one copy of every workspace, then one switch, then the old engine goes.** Brigade
says it is not for production use yet and no team pages through it, so the migration need not keep every write made
while it runs. That replaces the per-workspace fenced copy and 30-day rollback this section described before, which
were built for a deployment people depend on.

1. **Both engines ship.** The API Worker runs `WorkspaceDO` and Ember side by side; D1's `workspace_engine`
   (migrations/0017) says which one holds each workspace, `brigade` when it has no row. Nothing reaches an Ember shard
   until its workspace says `ember`: the API mints no Ember token for it and `/ember` answers 404 for its shard
   (src/ember.ts).
2. **Copy.** An operator route asks every `WorkspaceDO` for its rows, counters, members, devices and pending
   escalation timers, and writes them to the workspace's Ember shard through internal mutations in batches,
   idempotent by row id, so the copy can run again and overwrite the last one. It checks counts and a hash per table
   on both sides. Writes made to `WorkspaceDO` after a workspace's copy are lost at the switch: accepted.
   The copy ends by arming the shard's upkeep ticks (`paging:tick` at the earliest escalation timer, replay or held
   push; `paging:remind` once), since rows written by the copy are not a mutation that arms them (ember/ticks.ts).
3. **Switch.** D1's `workspace_engine` turns to `ember` for every copied workspace. `WorkspaceDO` then forwards what
   still reaches it (a late Queue event, an alert route, a probe) to the Ember shard, and closes its sockets so the
   apps reconnect through the Brigade Sync adapter ("Clients").
4. **Back.** Until the old engine is deleted, writing `brigade` again turns a workspace back to its `WorkspaceDO`,
   with its rows as they were at the copy; what was written on Ember since is lost. Accepted for the same reason.
5. **Delete.** Once every environment has run on Ember for some days, a PR removes `WorkspaceDO`'s engine, the Queue
   consumer's page path and the old sync code, and a later migration drops their storage.

`dev` goes first, then `staging`, then production. The owner approved running the copy against staging and
production data for this migration.

### Parity: what `WorkspaceDO` does, on Ember

No workspace is switched until every row below is on Ember. The API reaches a workspace's shard through
`src/ember-workspace.ts`, which picks the engine from D1 for each call; each area moves there with its Ember functions
(`apps/api/ember/`) and tests on both engines.

| Area                         | `WorkspaceDO` calls                                                                                                            | On Ember                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client mutations and queries | sync frames, `restRead`, `restWrite`, `apiTokenRun`, `apiTokenUsed`                                                            | `workspace:mutate`, `workspace:query` (#184); REST and API tokens: `rest:read`, `rest:write`, `rest:tokenRun`, `rest:tokenUsed` (ember/rest.ts) run src/rest.ts over the shard facade, the request keys in Ember's private SQL tables; the routes reach them through src/ember-rest.ts (`keySeed` and `requestDigest` computed in the Worker, a revoked token's sockets closed with `revokeSockets`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sessions                     | `endSession`, `signOutUser`, `catchUpSessionEnds`                                                                              | `sessions:*` (this step), sockets closed with `revokeSockets`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Events delivery              | the outbox drain (`OutboxDrain`, from the alarm)                                                                               | `events:*` (ember/events.ts): every mutation with events schedules one drain job (a lease mark keeps it to one), which sends `seq`-ordered batches to `brigade-events` and deletes them after the send; the queue consumer's calls back into the shard (`plan*`, `record*`) move with their areas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Members                      | `changeMember`, `finishLeave`, the repair alarm                                                                                | `members:*` and src/ember-members.ts: D1's conditional writes stand in for the member lock, a failed shard step schedules `members:repair` (reads D1, reconciles); sockets close by user and by API token creator (`by` claim); before a page, a member list older than `MEMBER_STALE_MS` is reconciled first (`members:reconciledAt`, src/ember-paging.ts `freshMembers`). Still to do: the reconcile after activity (`periodic`), `reconcileMembers` on a sync upgrade (with the adapter)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Provisioning and invitations | `provision`, `invite`, `resendInvitation`, `revokeInvitation`, `acceptInvitation`, `declineInvitation`, invitation email plans | `invitations:*` (ember/invitations.ts): the shard's side of `Invitations` (`InvitationLedger`, src/invitation-ledger.ts: the email ledger, the server-only mutation, what a failed one owes) over the shard facade, repaired by the `invitations:repair` action; the orchestration with D1 is the DO's own `Invitations`, run in the Worker without the member lock (src/ember-invitations.ts: D1's conditional writes are the guard). `provision`: a new workspace goes to Ember once `NEW_WORKSPACE_ENGINE` is `ember` (set at the switch), with `workspace_engine` written for it. Area done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Devices                      | `registerDevice`                                                                                                               | `devices:register` (ember/devices.ts) and src/ember-devices.ts: the Worker catches up D1's `session_end` first, checks a member tombstone against D1, and looks up the session another member registered the phone with before the shard frees it (`free`); `device.touch` runs after a registration that went through or changed nothing, over HTTP and over a socket (`workspace:mutate`, with the token's `sid`). Done                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Paging and escalation        | `planPage`, `recordPage`, `receipt`, `acknowledge`, reminders, rotation emails, email plans, escalation timers                 | `paging:plan`, `paging:record`, `paging:deadLettered`, `paging:acknowledge`, `paging:tick` and `paging:remind` (ember/paging.ts), `mailer:*` (ember/mailer.ts): `WorkspaceDO`'s own `Pager`, `Escalations` and `Mailer` over the mutation (ember/shard-facade.ts), their ledgers in Ember's private SQL tables (G9). Two scheduler jobs do the synchronous part of the DO's alarm, each in its own transaction: `paging:tick` (escalation levels, replays, held pushes), armed by the pager and by any mutation that writes `escalation_timers`, and `paging:remind` (follow-up reminders), armed by any mutation that writes `follow_ups` or `member_settings`, so no page transaction reads the follow-ups (ember/ticks.ts). The consumer and the ack route reach it through src/ember-paging.ts and `workspace_engine` (with D1 out, the engine last known, or `WorkspaceDO`: its forwarding of page calls to the shard is a precondition of the switch, #191). Receipts: the Worker mints and checks the tokens under a per-workspace key derived from `BETTER_AUTH_SECRET` (key id `k2`, src/ember-receipts.ts), the shard records them (`paging:receipt`); a token the DO minted before the switch is refused. A page the Queue is late with: every page a mutation writes is watched (`page_pending`) and `local:send` (ember/local.ts, an action) sends it through the relay after `PAGE_QUEUE_GRACE_MS`, without the member check against D1 (the shard cannot call itself; the check fails open anyway). Area done. |
| Alerts and monitors          | `report`, `heartbeat`, `alert`, `alertTooLarge`, the alert engine's reroute (needed by a takeover's routes too)                | to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Status page                  | `configureStatusPage`, subscriptions, domain, status emails, the snapshot push                                                 | to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Slack and webhooks           | `slack*`, `planSlack`, `recordSlack`, webhook plans                                                                            | to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Export and postmortems       | `buildExport`, `recordExport`, postmortem drafts and revisions                                                                 | to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Clients                      | Brigade Sync sockets                                                                                                           | the adapter ("Clients"): to do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

**Result, step 1 (2026-11-06).** `dev` running this step, release builds of the app pointed at it, a workspace with
one declaring member and three paged ones:

- **iPhone 15 Pro Max (iOS 27.2), locked:** a SEV1 rang through CallKit and its alert showed the incident's title (the
  extension opened the envelope); answering acknowledged the incident. A SEV2 with the app closed arrived as an alert
  only, and opened the incident when tapped.
- **iOS Simulator:** the same alert, opened by the extension, `Delivered` in "Who was paged". With no CallKit there,
  the call ends as `failed` and the app posts the page again (RFC 0010, Q14), as designed.
- **Android emulator (Google APIs image, FCM):** a SEV1 rang (Answer / Decline) and its alert arrived opened in the
  background, with the app swiped away (no process, not force-stopped) and in the foreground.
- **The relay's logs:** every `APNs response` signed by Ember (`signer: ember`) and answered 200, sandbox; every `FCM
  response` 200 with Ember's access token; 12 pages in a minute (26 pushes) reused the token, with no
  `TooManyProviderTokenUpdates`, `ExpiredProviderToken` or fallback to the relay's own signers.
- **Not checked:** a Critical Alert (Xcode's development profile cannot carry the entitlement; it needs an ad hoc or
  store build), item 2's refusals, and `Unregistered` after an uninstall, which APNs reports only some time later.

**Result, step 2 (2026-11-06).** `dev` running step 2, with the four APNs secrets and the Firebase service account on
the API Worker:

- **Direct:** a SEV1 rang the iPhone and the Android emulator and both showed `Delivered · Call sent`, with no
  `/send` reaching the relay in that time (only the watchdog's deep health checks).
- **Fallback:** with `APNS_KEY_ID` set wrong on the API, a SEV2 reached the iPhone through the relay's `/send`
  (`APNs response` 200 there) and was acknowledged from the notification; Android, which does not use the APNs key,
  still went direct. The right key id was put back afterwards.

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
  `fcmAccessToken(options, force)` takes no token, unlike `apnsProviderToken`'s `force`, so a send FCM answered 401
  forces an exchange even when another send already replaced the token. Proposed: `force` may be the refused token.
  Workaround: the relay remembers the refused token and forces only while the cache still holds it.
- **G8 — Closing an identity's sockets from the server.** Ember ends a socket's access when its token expires, but
  nothing outside the socket can close it sooner. Proposed: an internal call on the shard that closes (or marks
  `authExpired`) every socket whose identity matches a claim (`sid`, `sub`), used by an app's session-end hook.
  Workaround: the 5-minute token and the D1 check on every refresh ("Auth").

## Order of work

1. **Relay on Ember's transport** (built). Proves Ember's provider-token and access-token layer with the
   real credentials on `dev`.
2. **Direct sends from the API** with the relay as fallback (built), off until the API has the credentials.
3. **The workspace shard on Ember behind `workspace.engine`**: tables, the Ember-backed `Store`, mutations and
   queries through `brigadeMutation`/`brigadeQuery`, events and pages as scheduler jobs with the page lease, the
   auth hook. Brigade's existing mutation and paging tests run against both engines.
4. **Dashboard on Ember's React client**, switched by `/config`.
5. **App on Ember's React Native client** next to Brigade Sync, picked per instance.
6. **Monitoring, status page and Slack** calling the Ember shard of a workspace whose `workspace.engine` is `ember`,
   `WorkspaceDO` otherwise; the watchdog unchanged.
7. **Migration route, one copy of every workspace and the switch** ("Data migration") on `dev`, then staging and
   production (approved by the owner).
8. **Removal** of `WorkspaceDO`'s engine and the Queue consumer's page path, once every workspace of an environment
   has run on Ember for some days. The Brigade Sync protocol (`packages/sync`'s client and the adapter) is
   removed separately, and only once `minApp` is past every app release without the Ember client **and** no supported
   self-hosted instance runs the old engine; until then the app keeps both clients.

Open questions: Q33 (when, if ever, auth moves to Ember's `Auth`), Q34 (whether the hosted instance stops using the
relay once direct sends are proven).
