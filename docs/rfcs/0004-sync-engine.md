# RFC 0004 — Real-time sync engine ("Brigade Sync")

- Status: Draft

## Goal

Convex-like developer experience on Cloudflare: reactive queries, optimistic mutations, live updates on web
and mobile — with the **server as the authority**.

## Why not an existing engine

| Option                                                    | Model                                     | Why not (for now)                                                      |
| --------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| LiveStore (`@livestore/sync-cf`, Expo adapter)            | Event sourcing, client materializes state | Client-authoritative; pre-1.0 with breaking API changes between minors |
| TinyBase (`WsServerDurableObject`, expo-sqlite persister) | Mergeable store, last-writer-wins         | Any connected client can write anything; no server-side business rules |
| Convex self-hosted                                        | Server-authoritative                      | Does not run on Workers                                                |
| Zero / ElectricSQL / PowerSync                            | Server-authoritative-ish                  | Require Postgres                                                       |

Incident management needs RBAC on every write, server-originated writes (escalation timers, alerts, monitors)
and a trustworthy audit timeline. Brigade's domain is small, so a focused engine on Durable Objects is tractable.
LiveStore's protocol is a good reference.

## Model

- **Shards** are Durable Objects (`WorkspaceDO`, `IncidentDO`). Each owns SQLite tables and a monotonic `version`.
- **Queries** are named, typed, server-defined functions: `incidents.active`, `incident.timeline`, `oncall.now`.
  Clients cannot send arbitrary SQL.
- **Mutations** are named, typed functions in `packages/schema`: `incident.ack`, `incident.setSeverity`, …
  The same code runs optimistically on the client and authoritatively (with RBAC) on the server.

## Shared core (`packages/schema`)

Settled in spike S3. Server and clients run the same pure code; only the store underneath differs.

```ts
interface Store<S> {                         // SQLite in the DO; createMemoryStore() on clients and in tests
  get(table, id); insert(table, row); delete(table, id);
  update(table, id, patch);                  // keys set to undefined are ignored; null clears
  scan(table);                               // rows ordered by id
  transaction(fn);                           // undo every write if fn throws; re-entrant
}

type MutationContext = { actor: { kind: "user" | "system" | "integration" | "token"; id; role; by?; scopes? }; now: number; server: boolean };

defineMutation({ name: "incident.declare", args: v.object({ … }), permission: "incident:declare",
  apply(store, args, ctx) { …; return ok(event) /* or fail("not_found", …) */ } });
defineQuery({ name: "incidents.active", args: v.object({}), permission: "incident:read",
  table: "incidents", filter: (row, args) => …, sort: (a, b) => …, key?: (args) => id });

runMutation(mutations, name, rawArgs, store, ctx, { commit?(events), onError?(error, name) })
  // → { ok: true, events } | { ok: false, error: { code, message, issues? } }
runQuery(queries, name, rawArgs, store, role, { onError? }) // → { ok: true, rows } | { ok: false, error }
```

- **Mutations** are deterministic and side-effect free: they read and write only the store, and time comes from
  `ctx.now` (epoch milliseconds, a safe non-negative integer, else `internal`; the same unit as ULIDs and SQLite
  integers; ISO 8601 only in event envelopes and the UI). `runMutation` checks the role against the access-control
  table (`can(role, permission)`, shaped for Better Auth's `createAccessControl`, RFC 0003), validates args, then
  runs `apply` and then `commit` in one `store.transaction`, so any failure writes nothing. Failures are typed
  (`unknown_mutation`, `forbidden`, `invalid_args`, `not_found`, `invalid_transition`, `conflict` for no change,
  `limit_reached` for a per-member cap); an unexpected
  exception becomes `internal`, whose cause goes only to `onError` (server logs), never over the wire. Neither
  `runMutation` nor `runQuery` throws, whatever arrives off the wire (a non-string name is an unknown one; args
  that throw while being read are `internal`). System and integration actors carry a role and pass the same check.
- **Events and the outbox**: a successful mutation returns its domain events (`type`, `subject`, `data`). The
  server writes them to the outbox in `commit`, inside the mutation's transaction (RFC 0005); if `commit` throws,
  the rows roll back too. Clients drop the events. Every success must emit an event: one with none is a bug in
  the mutation and becomes `internal`, unless the mutation is declared `silent` (see "Server-side writes"; today
  `monitor.report`, whose routine refreshes change synced fields that are not domain facts, and `member.sync`,
  the shard's cache of the members in D1). So "no change" (setting the current status or severity) is one code for
  both, `conflict`, which also covers an existing id; it also makes a rebased mutation the server already applied
  fail locally and drop out of the optimistic view.
- **Transactions are re-entrant.** The server already runs inside its own transaction when it calls
  `runMutation`, so the SQLite store's `transaction` must nest with savepoints: an inner rollback undoes only its
  writes; an outer rollback undoes everything. The in-memory store copies its table
  maps per transaction, O(rows): fine for an incident index, not for large tables.
- **Server-only work** runs when `ctx.server` is true. `INC-n` comes from a `counters` row written in the
  mutation's own transaction, not from an injected callback, so it stays atomic and replayable; the client's
  optimistic row has `number: null` until the server's patch arrives. Tables are marked server-only in data
  (`TABLES`); they are never synced, and `defineQuery` refuses them.
- **Client-generated ids**: the client makes the prefixed ULID (`newId("inc", now, randomBytes)`) and passes it in
  the args, so the optimistic row and the server row share one id. The server checks the format (`isId`), rejects
  an existing id with `conflict`, and rejects an id dated more than 10 minutes in the future of its clock
  (`invalid_args`), so a bad clock cannot pin an incident above newer ones. Any past id time is accepted:
  declaring an incident must never fail because the phone was offline. The row's `declaredAt` is the server's
  `now`, so an old id only affects id order, never the incident's dates.
- **Shard names never come from a client-chosen id alone.** A shard is named from the workspace id and the
  entity id (`${workspaceId}:${incidentId}`), and the Worker checks that the entity belongs to the caller's
  workspace (the `WorkspaceDO` index) before routing. Client-generated ids make this mandatory: otherwise a client
  could pick an id that addresses another workspace's shard.
- **Queries are data over one table** (`table`, `filter`, `sort`, optional `key` for a single-row read). The
  server uses `filter` to tell which subscriptions a changed row touches; clients re-run the query over local rows
  after an optimistic mutation. Limitation: no joins or aggregates; a view that needs them is a projection table
  the shard maintains in its mutations.
- **Validation** is a handful of hand-written validators (`v.object`, `v.string`, `v.picklist`, `v.id`) in
  `packages/schema`: no dependency, nothing engine-specific (runs on Workers, browsers and Hermes). `v.object`
  accepts only plain objects and rejects unknown keys. `v.string` rejects raw input longer than about twice its
  limit before any work, then walks the code points once (linear) and trims an explicit whitespace set (not the
  engine's `trim`). The rule is by Unicode property, not a hand list: reject any code point in `Cc`, `Cf`, `Cs`,
  `Co`, `Cn`, `Default_Ignorable_Code_Point`, `Zl` or `Zp`, with exactly three exceptions: ZWJ between two
  `Extended_Pictographic` code points; one U+FE0E or U+FE0F right after an `Extended_Pictographic` code point or a
  keycap base (`0-9`, `#`, `*`); one U+E0100–U+E01EF right after an `Ideographic` code point. Every other variation
  selector (U+FE00–U+FE0D, or any selector elsewhere) and every tag character (U+E0000–U+E007F, so subdivision
  flags too) is rejected, so no invisible code point can carry a hidden message. Multi-line text may also hold
  `\n` and `\t`. The result must contain at least one letter, number, symbol or punctuation that is not a blank
  look-alike (Braille blank, musical null notehead U+1D159, Hangul fillers), and `min` is checked after all that. Errors carry at most 10 issues, and echoed names and paths are cut to 64 code
  units without splitting a pair, with rejected code points shown as U+FFFD. Valibot is the upgrade if the arg
  shapes outgrow this.
- **Unicode property escapes** (`\p{…}` with the `u` flag) are in V8 (Workers, Chrome, Node) and in Hermes since
  2024 (facebook/hermes#1295, behind a build flag that defaults to on). The regexes are built at runtime: on an
  engine without them, clients fall back to rejecting only controls, separators, bidi overrides/isolates, tag
  characters, U+FE00–U+FE0D and unpaired surrogates, and leave the rest to the server, which always runs the full
  rule.
  `UNICODE_PROPERTY_ESCAPES` tells which path is active; S4 checked it is `true` on the Android emulator and
  the iOS Simulator (Hermes in React Native 0.88). Unassigned (`Cn`) depends on each engine's
  Unicode version, so a code point newer than a client's tables can fail there optimistically while the server
  accepts it; the server's answer wins.
- **In S3 the `WorkspaceDO` incident index is temporarily authoritative** for status and severity. Once
  `IncidentDO` exists it owns them, and the index becomes a projection fed from `IncidentDO`'s outbox (RFC 0002).

## Protocol (WebSocket, JSON; binary later if needed)

Every frame is a JSON object with a `type` field. Types and parsers live in `packages/sync/src/protocol.ts`
(`@freecorps/brigade-sync/protocol`), shared by the client and the shard.

```
client → server
  hello      { protocol, clientId, token? }
  subscribe  { subId, query, args, version?, epoch? }   // version and epoch together
  unsubscribe{ subId }
  mutate     { mutationId, name, args }
  ping       {}                                   // exactly the text {"type":"ping"} (PING_FRAME)

server → client
  snapshot   { subId, epoch, version, rows }
  patch      { epoch, version, subs: { [subId]: { upserts, deletes } } }
  mutationResult { mutationId, ok: true, version } | { mutationId, ok: false, error }
  error      { code, message, subId?, mutationId? }
  pong       {}                                   // exactly {"type":"pong"} (PONG_FRAME)
```

- `protocol` is `PROTOCOL_VERSION` (1). `token` is reserved and unused: the Worker authenticates the upgrade
  ("Socket topology"). The shard handles a socket's frames one at a time, in arrival order. `hello` comes first:
  any frame before it except `ping` (a `mutate` included) gets a `protocol` error, and a compliant client never sends one.
- **Versions** are per shard: monotonic safe integers, one per change (mutation). A subscription's `version` is the
  last one the client received for it.
- **Epoch.** Versions only compare within one epoch: an opaque id (a token) the shard creates when its storage is
  first initialised and keeps for that storage's life. Every `snapshot` and `patch` carries it, and a resuming
  `subscribe` sends back `{ version, epoch }`. **Every restore rotates the epoch**: the restore procedure writes a
  new epoch before the shard accepts sockets, as does re-creating the storage, so a restored shard that is behind
  its clients (or has rewritten versions they hold) always answers them with snapshots. The client notes the
  epoch of every `snapshot` and every `patch`, an empty one included. The client stamps each confirmed mutation
  with the socket its result arrived on (a per-shard connection counter). When it sees data of a new epoch, it
  forgets mutations confirmed on earlier sockets that still wait for their data (their versions belong to the old
  epoch); one confirmed on the current socket ran in the new epoch and waits as usual. When a subscribe answer (a
  `snapshot`, or a `patch` carrying a subscription not yet in sync on this socket) arrives at version V, it is
  the shard's state now: the client forgets every confirmed mutation above V. Such a mutation cannot be in it
  (the shard went back, perhaps to exactly the version the client held), and V+1 onwards will be reused for
  other changes. With the epoch rotated on every restore this should not happen; the rule stays as a safety net
  for a restore that skipped the rotation. It needs no socket check, since the shard never answers on a socket
  below a version it already confirmed there; the socket stamp only serves the epoch rule above.
- **Every `subscribe` is answered by exactly one frame**: a `snapshot`, a `patch` holding only that subscription
  (possibly with empty `upserts` and `deletes`), or an `error` with its `subId`.
- **One data frame per version per socket.** A change reaches a socket as one `patch` whose `subs` holds every
  subscription on that socket the version touched; a version that touches none of them sends nothing there,
  with one exception: **after an ok `mutationResult`, the shard always sends that socket a `patch` for the
  mutation's version**, with empty `subs` if nothing on the socket was touched, so a confirmed mutation that no
  open view shows is still dropped. The rule is for mutations run for this socket: a replayed (de-duplicated)
  result needs no patch, because the subscribe answers that follow it on the new socket are at a later version. Any data frame at a version (a `patch`, or a `snapshot` or resume `patch`
  answering a `subscribe`) means the socket is at that version: the shard sent every earlier change already. So
  the client advances every other subscription in sync on that socket, ready and of the same epoch, to it. The client applies the whole frame, then drops confirmed mutations once
  (see "Ordering"), then re-evaluates, so all of a shard's views move together. `snapshot` stays per
  subscription: it answers a `subscribe`.
- A subscription's changes carry whole rows (`upserts`: the rows that entered or changed in the result) and ids
  that left the result (`deletes`); a row's table is its query's table. A `snapshot` replaces the subscription's
  data whatever its version: the client accepts it whenever the subscription is not yet in sync on the current
  socket (data has not arrived for it on this socket). Data older than what a subscription received on the current
  socket is stale: the client logs and ignores it. A `patch` for data of another epoch is ignored too.
- **Reconnect.** The client sends `hello`, then every unconfirmed `mutate` in order with its original
  `mutationId`, then a `subscribe` per active subscription, with `{ version, epoch }` when it holds data for it.
  The shard resumes **each subscription from its own `subscribe.version`**: a `patch` holding only that
  subscription, with what changed in its result since then (at the shard's current version). It answers with a
  `snapshot` instead when there is no `version`, the epoch is not its own (a restore or a re-created storage),
  the version is ahead of its own, or the version is older than its change log. Mutations go first so their results precede any data
  with their effects.
- **Errors.** `error` with a `subId`: the subscription was refused (`unknown_query`, `forbidden`,
  `invalid_args`, `internal`); `useQuery` reports `status: "error"` with no rows. The client lets go of its
  rows (other subscriptions may still hold them) and its resume point, and does not subscribe it again on
  reconnect; a new listener subscribes it again, from a snapshot. Only `close()` leaves a subscription in an
  error state that keeps its last rows. With a `mutationId`: a final refusal of a `mutate` the shard could parse,
  before running it and without recording a result (so a retry with that id is not de-duplicated), e.g. a
  per-client limit on mutations; the client fails the mutation with that code (`internal` if it is not a
  mutation error code) and never re-sends it. **After `hello`, the shard never answers a parseable `mutate` with
  a `protocol` error**: every one gets a `mutationResult` (domain failures, invalid args and unknown names included, as
  `runMutation` returns them) or an error with its `mutationId`. A frame it cannot parse at all gets a
  `protocol` error without ids; the client never sends one (it checks size and JSON before queueing). With neither: about the socket. On `code: "protocol"`
  (unsupported version, malformed frame, no `hello` first) the client closes the socket and reconnects with the
  normal backoff. A connection that ends this way never resets the backoff count, even if it delivered data
  first, so a shard that keeps refusing is not retried in a tight loop. The shard may close the socket itself too.
  A `send` that throws on the client loses the frame, so the client closes the socket and reconnects the same
  way; the next connection replays `hello`, the unconfirmed mutations and the subscriptions.
- **Heartbeat.** A socket can go half-open: the network goes (a phone changes networks, a NAT forgets the
  flow) without a close reaching either side, and the OS may take minutes to notice, so the socket would stay
  "open" and the UI Live while nothing arrives. So on an open socket the client sends `ping` 25 s after the open
  or the last answer, less up to a fifth of jitter (20 to 25 s, so a fleet does not ping in step, and under the
  common 30 s idle timeouts of proxies), and then waits 10 s for **any** frame: a `pong`, or data that arrived
  meanwhile. A first silent deadline only sends another ping (the pong may be queued behind a large frame); a
  second one in a row counts as a lost connection: the client closes the socket and reconnects with the normal
  backoff (reset, as after any close of a connection that delivered data), so `connectionState` goes to `waiting`
  and lists show reconnecting, not Live. A dead socket is found within about 45 s. While a subscription on the
  socket waits for its snapshot (or resume answer), no deadline runs: a large snapshot on a slow link may take
  longer than the deadline, its pong queued behind it, and dropping the socket would only ask for the same
  snapshot again, in a loop. That list shows loading, not Live, meanwhile; the deadline starts again once nothing
  waits. No pings are sent while no socket is open, and the timers stop with the socket (`close()`, the idle
  close, any drop). `heartbeat: { intervalMs, timeoutMs }` tunes it (both positive, or the constructor throws)
  and `heartbeat: false` turns it off. The client has no foreground/background hook: on a phone, timers stop with
  the app in the background, and on the way back the next ping finds a socket the OS killed. A deadline that
  fires more than twice its length after its ping (the timer ran late while JS was suspended) proves nothing, so
  it sends a fresh ping and waits again instead of dropping the socket. The shard answers `ping` at any time,
  before `hello` too, and the frame never touches the socket's state. It needs no protocol version: a client that
  never pings works as before. An older shard answers `ping` with a `protocol` error and a close; a `protocol`
  error while a ping is unanswered makes the client stop pinging that shard (with a warning) and reconnect with
  the backoff reset, as after a healthy connection, so it degrades to no heartbeat rather than a reconnect loop.
- **Never trust the wire.** `parseServerMessage` and `parseClientMessage` never throw; they return fresh objects
  or a reason, reject unknown fields (in nested objects and issues too), and check every id, version and row
  (a row `id`, and every id in `deletes`, is a non-empty string). Ids (`subId`, `mutationId`, `clientId`) are 1–64 characters of
  `[A-Za-z0-9_:-]`. Query and mutation names are not length-checked by the parser (`runQuery` / `runMutation`
  clip what they echo); the frame limit bounds them. The client logs a malformed frame and ignores it, as it
  does anything arriving on a socket it has left.
- **Frame size.** A client frame is at most `MAX_CLIENT_MESSAGE_LENGTH` = 65 536, measured as the JSON text's
  length in UTF-16 code units (`string.length`, what both sides measure without an encoder; at most 192 KiB of
  UTF-8, under the WebSocket message limit). The client encodes a `mutate` before queueing it and fails it with
  `invalid_args` if it is larger (or not JSON). It encodes a `subscribe` too and refuses the subscription locally
  (`status: "error"`, `invalid_args`) if the frame plus 128 code units of room for a later `version` and
  `epoch` is larger. The shard refuses to parse larger frames.
- Optimistic layer: pending mutations are re-applied on top of every server patch until confirmed or rejected
  (rollback on rejection). Each pending mutation keeps the `MutationContext` (`now`, `actor`) of its first run on
  every re-apply, so re-applying is deterministic. A pending mutation that fails on local re-apply (the server
  state moved under it) is dropped from the optimistic view silently; only a rejection in the server's
  `mutationResult` is shown to the user.
- Ordering: on a socket, the shard sends a mutation's `mutationResult` before any `patch` that contains its
  effects, and the socket delivers in order. A rejection drops the pending mutation at once. An ok result carries
  the shard version holding its effects; the client keeps the mutation in the view until **every subscription on
  the shard that can receive data (all but refused ones) is in sync on the current socket at that version or
  later**, and drops it as that data is applied. A subscription still waiting for its snapshot or resume answer
  blocks the drop, and so does one whose version came from an older socket: after a lost patch, a reconnect or a
  restore, the row never goes missing between the result and the data. So the patch is never re-applied on top of
  its own effects
  (re-applied after them, a mutation can still succeed and show a stale state: Ana's "resolve" applied, Bia
  reopens, a patch-first client would re-resolve), and the row does not flicker back between the result and the
  patch. A `conflict` on re-apply is only a fallback for a lost result, until the reconnect replays it.
- The server de-duplicates `mutate` by `(clientId, mutationId)`: a retry after a lost connection gets the stored
  `mutationResult` instead of running the mutation twice. It keeps each result for 7 days
  (`MUTATION_RETENTION_MS`) after running it. The client stamps every pending mutation with its creation time
  (`ctx.now`) and fails any still unconfirmed after more than 7 days with `expired` instead of re-sending it,
  since the shard might no longer recognise the retry. The sweep needs no socket: it runs on every (re)connect,
  before every retry, and from a timer set for the moment the oldest unconfirmed mutation leaves the window
  (capped at 2 147 483 647 ms, the longest `setTimeout` delay; firing early only sets it again). Both ages use one clock each, and the
  server runs a mutation after the client made it, so a retry the client still sends is one the server still
  remembers.
- Client-side limits: at most 500 unconfirmed mutations per client (`too_many_pending` beyond); `mutate` never
  throws (a throwing actor callback or clock gives `internal`); `close()` fails pending mutations with
  `closed` and leaves every subscription in a final `error` state with the server's last rows; after it, handles
  report that `closed` state and unsubscribing does nothing.
- Shards keep a bounded change log (rows changed per version) to serve resumes cheaply.
- WebSocket Hibernation API on the DO keeps idle connections cheap.

## Shard server (`WorkspaceDO`, settled in spike S3)

- **Store layout:** one `store_rows` table holds every table in `TABLES` as JSON documents keyed by (table, id),
  with the version that last changed each row. Queries filter and sort in JavaScript and rows travel as JSON, so
  real columns would only add a migration per new field; a table that outgrows a scan gets columns and indexes
  then. Server-only tables (`counters`) live there too and never reach the change log.
- **Shard metadata:** `shard_meta` (key, value) holds `version` (the last committed version, 0 before the first
  mutation), `log_start`, `workspace` (recorded on first use) and `epoch`, an `ep_<ULID>` token.
- **Epoch:** created the first time the storage is initialised, and **rotated on every restore**: the procedure
  that restores a shard's storage (point-in-time recovery, or importing the nightly export of open question Q3)
  must call `WorkspaceDO.rotateEpoch()` right after the restore, before the shard is reachable again. It writes a
  new epoch and closes every open socket with 1012, so each client reconnects, resumes with the old epoch and gets
  a snapshot. Without it, a restore landing on exactly the version a client holds, with different contents, would
  look like "nothing changed" and the client would keep rows the shard no longer has. No restore path exists yet;
  whichever is built first calls the hook (`apps/api/test/sync.test.ts` checks that resumes after it get
  snapshots). A re-created storage gets a new epoch on its own.
- **Transactions:** `sql.exec` refuses `SAVEPOINT`, but `ctx.storage.transactionSync` nests and the runtime runs
  the nested call as a savepoint (inner rollback undoes only its writes, outer rollback undoes everything;
  `apps/api/test/store.test.ts`). The store's `transaction` is `transactionSync`.
- **Version and change log:** in `runMutation`'s `commit` hook, inside the mutation's transaction, the shard
  bumps `version` once, records (version, table, id) in `change_log` for every synced row whose value changed,
  stamps those rows, writes the outbox and stores the result. The log keeps the last 1000 versions
  (`CHANGE_LOG_VERSIONS`; `log_start` is the newest version dropped); a resume from before `log_start`, from a
  version ahead of the shard or from another epoch gets a snapshot.
- **Resume patches** hold the rows changed since the client's version that are in the result now, and as deletes
  every other id changed since then in the query's table, since the shard keeps no per-subscription result sets to
  tell which of them the client held. A delete for a row the client lacks is a no-op. So a resume's `deletes` may
  name ids that were never in the subscription, ids of rows the client may not see included; that is harmless
  while every responder reads every incident, and must be fixed (filter the deletes by what the actor may read)
  once row-level access exists.
- **Patches** are computed from each changed row's value before and after the mutation: a row that is in the
  subscription now is an upsert, one that was and no longer is a delete. Membership is `evaluateQuery`'s: the
  query's `filter`, and for a query with a `key`, only the row with that id. No per-socket result sets are kept, so
  nothing about a socket lives in memory, and a version that touches none of a socket's subscriptions costs it no
  attachment write. Every `subscribe` answer and every patch is at the shard's current version, and every version
  that touches a socket's subscriptions reaches it, so a data frame at V is true for the whole socket. If a
  subscription's query can no longer be evaluated (its filter throws, or a deploy removed it), the shard refuses
  it with `error { subId, code: "internal" }` before sending that socket the version's patch, so the patch never
  claims a version for a subscription that missed it. A failure while patching one socket is logged and closes
  that socket alone with 1011 (its client resumes); the other sockets still get their patches.
- **The always-sent patch:** after an ok `mutationResult` the mutating socket gets the patch for that version,
  with `subs: {}` when the mutation touched nothing on it. A retry answered from the stored result gets that result
  and nothing else: the client re-sends only on a new socket, right after `hello` and before its `subscribe`s,
  whose answers are at the current version (at or after the result's) and settle the mutation.
- **De-duplication:** the result of a `mutate` the shard ran is stored by (actor id, clientId, mutationId) in
  `mutation_results` for 7 days from when the shard ran it (`RESULT_RETENTION_MS` = `MUTATION_RETENTION_MS`), so
  one actor can never be answered with another's result. An ok result commits with the mutation's rows, so a retry
  after a crash between commit and send still gets it. Domain failures, invalid args and an exception in the
  mutation's own code (`internal`) are stored too; `unknown_mutation` is not, since a later deploy may know the
  name. Clients stop re-sending a mutation 7 days after creating it, which is never later than the shard's window.
  Results older than the window are pruned before the next mutation runs.
- **Storage failures are not answers:** `SqlStore` turns every SQLite error into a `StorageFailure`. If one
  happens anywhere in the mutation's transaction (a store read or write inside `apply`, the commit hook's version,
  change log, outbox or stored result, or the transaction itself), everything rolls back, nothing is stored, and
  the error is rethrown instead of becoming `runMutation`'s `internal`. The socket closes with 1011 and the client
  replays the mutation on the next one, so a transient storage failure never turns into a permanent,
  de-duplicated `internal`. Only an exception from the mutation's own code (a bug, or a row it cannot read) is
  stored as `internal`. Pruning expired results runs before the mutation and only logs a failure, so once a
  version commits nothing can throw before its result and patches are sent.
- **Outbox:** written in the mutation's transaction (RFC 0005) and not drained yet (no Queue). Until it is, the
  shard logs the outbox's row count each time it grows by 1000 (`outbox not drained`).
- **Sockets:** Hibernation API. The attachment holds the client id, the actor and each subscription's query and
  validated args, at most 32 subscriptions and 8 KiB per socket. The 8 KiB is measured approximately, as the
  UTF-8 length of the state's JSON; the runtime stores the structured-clone encoding, under its 16 KiB limit, and
  the margin covers the difference. Handlers are synchronous, so a socket's frames are handled in arrival order and
  frames from different sockets never interleave.
- **Pings never wake the shard:** the constructor (run on every wake) sets
  `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME))`, so the runtime answers
  an exact `{"type":"ping"}` on every socket itself, hibernated or not, without running `webSocketMessage` or
  billing duration (the pair is at most 2 048 characters each). The auto-replied pings may still count as billed
  incoming WebSocket messages (at 20 messages per request): about 200 requests per socket per day, small but not
  free. The client always sends those exact bytes. A
  `ping` spelled otherwise (spaces, key order) still parses and `webSocketMessage` answers it with `pong`
  (`apps/api/test/sync.test.ts` checks both, and that the runtime recorded the auto-response).
- **Close policy:**
  - Socket-level protocol error: `error { code: "protocol" }` without ids, then a close with code 1002. That covers
    a frame that cannot be parsed and has no readable id (not JSON, binary, unknown type, over 64 KiB without a
    readable id), a second `hello`, another protocol version and any frame before `hello` except `ping`, a `mutate` included
    (see "Protocol"): after the close the client reconnects and replays the mutation behind a `hello`.
  - After `hello`, a frame the parser refuses but whose id is readable is refused alone and the socket stays open:
    a `subscribe` gets `error { subId, code: "invalid_args" }` (its one answer) and, like any `subscribe`,
    replaces an existing subscription with that subId, here by none; a `mutate` (too large, unknown field, a
    non-string name) gets `mutationResult { ok: false, error: { code: "invalid_args" } }`, as invalid args from
    `runMutation` would, but it is not stored, since it never ran.
  - A refused subscription (`unknown_query`, `forbidden`, `invalid_args`, `internal`, or `limit` past 32
    subscriptions or 8 KiB of state) is an error with its `subId`; the socket stays open.
  - The shard sends no `error` with a `mutationId` yet; it is reserved for a final refusal before running (a
    per-client limit).
  - An unexpected exception (a bug, a storage failure as above) is logged as one JSON line,
    answered with `error { code: "internal" }` without ids, and the socket closes with 1011. A `send` that throws
    closes the socket with 1011 too: a lost frame would make the next patch claim a version the socket never fully
    got.
  - `rotateEpoch()` closes every socket with 1012.
  - Whenever the shard closes a socket, it first marks the socket's attachment closed. Frames the client had
    already sent still reach the shard after the close; they are dropped unread (also when the socket is no
    longer open), never run. Otherwise a `mutate` queued behind one that failed on storage would run out of order,
    and its failure (say `not_found`) would be stored and replayed to the client; instead the client re-sends
    both, in order, on its next socket.
- **Actor:** the Worker authenticates the upgrade and the shard trusts only what the Worker sets (see "Socket
  topology"). It reads the actor from a `Brigade-Actor` header and the workspace id from `Brigade-Workspace`, on a
  request the Worker builds itself with only those two headers and `Upgrade`, so nothing the client sent reaches
  the shard; it records the workspace on first use and checks it on every later upgrade. `hello.token` is ignored.
- **API tokens (RFC 0014):** an upgrade with `Authorization: Bearer` acts as `{ kind: "token", id: "tok_…", role,
  by, scopes }`, the creator's role read in D1; the shard refuses it (`401`) once its own list says the token is
  revoked or expired, runs each query and mutation only within its scopes, and closes its sockets when it is revoked
  (`1008`) or its creator's membership changes through Brigade (as the creator's own).
- **Dev actor (local only):** where `SYNC_DEV_ACTOR` is `"1"` and the request is for `localhost`, `127.0.0.1` or
  `[::1]`, an upgrade **without a session** acts as `{ kind: "user", id: "usr_dev", role: "responder" }`
  (`DEV_ACTOR`) on any shard; for any other host it gets `401`, so a deployment that set the variable by mistake
  still refuses it. A private LAN address (10/8, 172.16/12, 192.168/16) counts as local, so a phone on the
  same Wi-Fi can use `vp dev`; Cloudflare's edge never serves a deployed Worker under such a host.
  Only `vp dev` and the tests set
  it, in their Vite configs; no environment in `apps/api/wrangler.jsonc` does (`apps/web/test/worker-config.test.ts`
  checks each one), so every deployed Worker answers such an upgrade with `401`. No app relies on it since the
  mobile app signs in. A request with a session always acts as its member, flag or not.
- **Provisioning:** when Better Auth creates a workspace (D1), the Worker calls `WorkspaceDO.provision()` over RPC.
  It claims the shard for the workspace and runs `workspace.create` as the new owner, so `workspace.created` goes
  through the outbox like any mutation (RFC 0005). It is de-duplicated like a socket's mutation and idempotent.
  `workspace.create` is server-only: it is in `serverMutations`, which only `provision()` runs from, never in the
  `mutations` a socket's `mutate` is looked up in (a socket sending it gets `unknown_mutation`). If provisioning
  fails, the Worker deletes the workspace and its membership from D1 again before Better Auth makes it active, and
  `POST /workspaces` answers `500`, so a workspace never exists without its shard. A Worker that dies between the
  D1 write and the RPC can still leave one behind (roadmap).

## Socket topology

**Decision (v1): one WebSocket per shard, hidden behind the client library.**

```
                       ┌── wss /sync/ws_123            ──▶ WorkspaceDO(ws_123)
SyncClient (web/mobile)┤
  connection pool      └── wss /sync/ws_123/inc_456    ──▶ IncidentDO(ws_123:inc_456)
```

- The `api` Worker authenticates the upgrade request (`apps/api/src/actor.ts`): a cross-site `Origin` gets `403`
  (browsers send cookies on a cross-site WebSocket upgrade and CORS does not apply to it, and a browser always sends
  the page's `Origin` on one), no Better Auth session gets `401`, and a user who is not a member of the workspace with a Brigade
  role gets `403`. Then it hands the socket to the shard (`stub.fetch`); the DO accepts it with the Hibernation
  API. The actor travels in a header on a request the Worker builds from scratch. **Not signed:** a Durable Object
  is reachable only through this Worker's binding, and the Worker never copies client headers onto that request, so
  a signature would protect nothing (decided in the auth slice; it replaces the "signed header" of the first
  draft).
- **The mobile app** authenticates the same way, with no second kind of credential: Better Auth's Expo client keeps
  the session in the phone's secure storage and the app sets it as the upgrade's `Cookie` header itself (React
  Native's WebSocket takes headers). React Native sends either no `Origin` or, by default, the socket URL's own
  origin (`ws://` read as `http://`), and both pass; the app's scheme (`brigade://`) is not accepted as a socket's
  `Origin`, since the app never sends it there. A cookie header a page cannot set is what the app proves itself
  with, so no bearer token is needed (decided in the mobile sign-in slice; the first draft planned bearer tokens).
  The app makes one `SyncClient` per member and workspace and closes it on sign-out or on switching workspaces, so a
  phone signed in as someone else never reuses an open socket.
- **Switching workspaces** (dashboard header, app account section) makes another workspace active in the session
  (`organization/set-active`) and opens its shard; nothing of the old one is shown in the new one (the dashboard
  remounts below the switch, the app makes a new `SyncClient`). Changes not answered yet stay with the workspace they
  were made in, and are still sent: in the dashboard each shard's pending mutations live in the one `SyncClient` and
  are sent and answered on the old shard's socket, which closes idle once they are; in the app the old workspace's
  `SyncClient` stays open in the background until its queue is empty (checked every second, at most 10 minutes;
  `apps/mobile/src/lib/drain.ts`), so an ack made while the socket was reconnecting still reaches the shard and stops
  the escalation. Switching back takes that same client again. What is still unsent after 10 minutes stays in the
  member and workspace's queue on disk (`pending-files`), sent when they switch back; signing out closes every
  draining client and drops the queues.
- For an entity shard, the Worker first checks that the entity belongs to the workspace (`inc_456` is in
  `WorkspaceDO(ws_123)`'s index) and names the shard from both ids (`ws_123:inc_456`), never from the client's id
  alone.
- `SyncClient` owns a pool: it opens a shard connection on the first subscription or mutation for it and
  closes it 5 s (`idleCloseMs`) after the last subscription ends and the last mutation is answered. A
  subscription outlives its last listener by 1 s (`lingerMs`), so a remount (React Strict Mode, a quick
  navigation) keeps it. When a shard socket closes idle, the client forgets that shard's rows; the next
  subscription starts from a snapshot. Apps only see `useQuery` / `useMutation`.
- Typical load is small: web dashboard = workspace + 0–3 open incidents; mobile = workspace + current incident.
- Messages do not carry a shard id: the socket is the shard. A gateway would add a `shard` field to `subscribe`
  and `mutate` (and route replies by `subId` and `mutationId`, unique per client).
- Reconnect: exponential backoff with "equal jitter": retry `n` (from 0) waits a random time in `[cap/2, cap]`
  with `cap = min(30 s, 500 ms × 2^n)`. The count resets when a connection that delivered data (`snapshot`,
  `patch` or `mutationResult`) closes, unless it ended with a `protocol` error. An upgrade refused for auth,
  or a shard answering `protocol` errors, keeps backing off. On reconnect the client replays as described under
  "Protocol".
- Session revocation: member changes made through Brigade close the member's open sockets on that shard (`1008`
  removed, `1012` role changed), and every upgrade's reconcile closes sockets whose actor D1 no longer backs
  (RFC 0003 "Members"), so an open socket never keeps a role or a membership D1 took away for longer than until the
  next change or upgrade into the workspace. A password reset closes every socket of the account in each of its
  workspaces (`1012`; they reconnect without a session and are refused), since it ends every session (RFC 0002
  "Auth"). A session that ends (sign-out, a revoked session, an expired one Better Auth finds) closes its sockets in
  every workspace of the account (`1012`): the Worker passes the upgrade's session id to the shard (`Brigade-Session`,
  the id, never the token), which tags the socket with it (`acceptWebSocket(ws, ["session:<id>"])`), and Better Auth's
  session-delete hook asks each of the user's shards (D1 lists them) to close the sockets with that tag
  (`WorkspaceDO.endSession`), 3 tries each. The end is recorded in D1 first (`session_end`, RFC 0002 "Auth"), so a
  shard that still fails acts on it later: before a phone registers in it, after its next sync upgrade, or from the
  Worker's cron within a minute or two. A shard remembers an ended session for 10 minutes (`ended_session`,
  `ENDED_SESSION_MS`) and refuses an upgrade carrying it (`401`), so an upgrade the Worker authenticated just before
  the session ended, reaching the shard after, never opens a socket nothing would close.
  Better Auth deletes an expired session only when someone next presents it, so no hook fires when one expires: the
  Worker also passes the session's expiry (`Brigade-Session-Expires`), the shard keeps it with the socket, refuses an
  upgrade already past it, and closes the socket at it (`1012`): on its next frame, or by the alarm the upgrade arms
  for it when it is idle (`WorkspaceDO.expireSockets`). The client reconnects with its cookie and gets the session
  Better Auth refreshed meanwhile, if any. Sockets accepted before a deploy that adds a tag or an expiry carry neither;
  a deploy restarts the shards and closes their sockets anyway, so none outlive it. Not built yet: an edit made in D1
  outside Brigade reaching sockets before the next upgrade.

**Upgrade path (only if spike S3 or production metrics show a need):** a `SessionDO` per client session holding the
single client socket and fanning out to shards over DO RPC, with shards pushing patches back via RPC. It costs an
extra hop and more moving parts, so we start without it.

## Clients

- `packages/sync`: framework-agnostic client + React hooks (`useQuery`, `useMutation`) used by web and mobile.
  Settled in spike S3: the same client and hooks run unchanged in the browser and on Hermes (iOS and Android). React
  Native passes `randomBytes` from `expo-crypto`, since Hermes has no `crypto.getRandomValues`; the global
  `WebSocket` needs no adapter. How a list reads the connection (`syncView`, `nextFailed`) lives in `packages/sync`
  so both apps say the same thing; each app draws it with its own components.
- **Pending mutations across a restart:** the client takes an injected `pendingStorage` and calls its `save(shard,
  mutations)` whenever a shard's unconfirmed mutations change (each one's name, args, `mutationId` and creation
  time, oldest first; `[]` once none is left). `restore(shard, saved)` puts them back: applied optimistically again
  as the current actor at their creation time, and re-sent on connect with their own ids. The client id is kept
  with them, since the shard de-duplicates by `(actor, clientId, mutationId)`: one the shard ran before the app was
  killed is answered from its stored result, not run twice. They keep their creation time, so the retention window
  is the same as for any pending mutation: past it, `restore` fails them with `expired` and never sends them, and so
  it does with one dated after the client's clock (the clock moved back, so its window cannot be told).
  Restored mutations resolve like `mutate`'s, so the app shows their refusal or expiry where it shows any other.
  `close()` leaves the saved queue alone; the app decides when to drop it. Entries that are not mutations, or past
  `maxPending`, are skipped or fail with `too_many_pending`.
- **Client ids:** mobile keeps one per member and workspace, in the file with that member's queue (the app's
  document directory via `expo-file-system`, which ships with `expo`; secure storage is for small secrets, and a
  queue holds up to 500 changes). A launch reads only the signed-in member's file in their workspace and deletes
  every other member's; signing out deletes them all, so a phone handed over never sends or shows the last
  member's changes. Device registration is not kept: the app registers again on its own. The app restores the
  queue only once the member's role is known (live, or remembered from the last launch): applied as the `viewer`
  a role still loading reads as, the changes would drop out of the view until the shard answered, and saves made
  before then (a device registration) leave the file as it was. Each change rewrites the file whole, aside first
  and then moved over it; a kill between the move's delete and its rename leaves the copy, which a launch reads. A
  save still waiting its turn takes a newer one's text, so a burst of confirmations is a write or two. Signing out
  says so when changes are still unsent. A launch also deletes the member's queues of other workspaces once
  everything in them is past the retention window. A refusal of a restored change shows on its incident's screen,
  or else on the incident list's row. **Backups:** the queue holds what members wrote about incidents, so it stays
  out of device backups. Android: backup rules (`plugins/pending-backup.ts`, `fullBackupContent` and
  `dataExtractionRules`) exclude only its folder. iOS: the folder is marked `isExcludedFromBackup` by a function of
  the app's `brigade-call` module (`expo-file-system` has none). Not the caches directory, which iOS and Android
  may empty when storage runs low, and a phone low on storage is no reason to lose an incident update. The web keeps an id per
  tab and pending mutations in memory: tabs share `localStorage`, so one queue per tab would need its own
  ownership rules for what a closed tab left behind, and a browser is rarely killed with an update unsent.
- Mobile cache: `expo-sqlite` stores the latest snapshot per subscription → the app opens instantly and reads offline.
- Offline mutations are queued and shown as "pending". Paging actions from notifications (ack/escalate) use plain HTTPS,
  not the socket, because iOS suspends sockets in the background (below).

### Acknowledging from a notification

`POST /api/workspaces/:id/incidents/:incidentId/ack` with an `Idempotency-Key` header (`[\w:-]{1,64}`), built for the
page's Acknowledge action (RFC 0006 "Acting from the notification"). It is a server-side write like any other: the
shard runs the named mutation `incident.ack` as the member, with its RBAC, its event through the outbox and its patch
to every open socket; nothing is applied on the phone first.

- **Authenticated like the sync upgrade:** the Better Auth session from the `Cookie` header (the app sends the one
  `@better-auth/expo` keeps in secure storage), then the member's role read in D1, so a made-up workspace or an outsider
  never wakes a shard. The shard also refuses a member removed within the tombstone (`not_a_member`), as it refuses
  their upgrade. A request with another site's `Origin` is refused (403 `forbidden_origin`), like every
  cookie-authenticated write; the app sends no `Origin`. Only workspace ids (`ws_<ULID>`), never dev shards.
- **Idempotent per tap:** client id `notification`, mutation id the incident id and the key (`<incidentId>:<key>`, so
  the same key on another incident's page is another ack), de-duplicated by the shard like a socket's mutation. The app makes one key per tap and keeps it across its retries, so a retry whose first answer was lost is
  still answered "acknowledged" instead of "someone already did". A second tap, or anyone else's ack, is the
  mutation's `conflict`.
- **Answers:** 200 acknowledged; 409 `conflict` (already acknowledged) or `invalid_transition` (resolved or declined);
  404 no such incident; 403 `forbidden` (a viewer) or `not_a_member`; 401 no session; 503 when D1 or the shard cannot
  be reached. The app tries again on a network failure, a timeout, 429 or 5xx, never on a refusal.
- **Stops the escalation:** it is `incident.ack`, so it ends the incident's escalation run (`acknowledged`, its
  timer cleared) and a level already queued pages nobody (RFC 0006 "Who is paged"). An Escalate action would take the
  same shape. Tests: `apps/api/test/ack.test.ts`.

## Server-side writes

Alarms, alert ingestion, Slack commands and monitors call the same mutations through DO RPC with a system actor.
One code path for every write → one audit trail.

- A system actor is `{ kind: "system", id: "sys_<name>", role }`: it carries one of the member roles and passes the
  same `can()` check. The first is `sys_monitors` (`MONITOR_ACTOR`, role `admin`): probe reports and heartbeats run
  `monitor.report` as it (RFC 0007), and a nested `runMutation` of `incident.declare` inside that mutation opens the
  incident with the same RBAC and validation, in the same transaction.
- Server-only mutations sit in `serverMutations` (`packages/schema/src/registry.ts`), never in `mutations`, so a
  socket gets `unknown_mutation` for them. The shard runs them with `internal: true` and de-duplicates them like a
  socket's: client id `probe:<region>` or `heartbeat`, mutation id the probe's report id. A probe stores a new
  report id with every check result. It sends a report again only after its next check, so a retry carries the
  newer result under a new id: the de-duplication catches a report delivered twice with one id, not a retry, and a
  retried report whose first delivery did land is just a newer result for `monitor.report` (an unchanged verdict
  only refreshes the row). The shard's alarm runs `monitor.evaluate` (client id `monitor`) when results went
  stale.
- A storage failure inside the nested `incident.declare` is caught and thrown again, so the shard rolls the whole
  report back and the probe retries, instead of storing `internal` as the report's answer.
- A mutation may be declared `silent`: it may then succeed without events. Only for writes that refresh observed
  values (a monitor's latency, colo and check time), which are synced but are no domain events (RFC 0005), and
  for `member.sync`, which copies the socket's own member (name and role, as the Worker read them in D1) into the
  shard's `members` table on an upgrade whose copy is missing or stale (RFC 0003 "Members in the shard"): a cache
  of D1, not a change to the workspace. It runs as that member, client id `api`, and refuses any other id or role.
  Also for server-only bookkeeping the domain event comes from elsewhere: `webhook.record` (a delivery log) and
  `export.reserve` (an export's slot in the hourly limit; the export emits `workspace.exported` when recorded).
- Ids and text a server mutation needs (a new incident's and alert's ids, the incident title rendered with
  `packages/i18n`) are made by the shard before it runs the mutation and passed in its args, so `apply` stays
  deterministic.
