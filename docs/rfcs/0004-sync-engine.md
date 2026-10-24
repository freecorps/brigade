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

type MutationContext = { actor: { kind: "user" | "system" | "integration"; id; role }; now: number; server: boolean };

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
  (`unknown_mutation`, `forbidden`, `invalid_args`, `not_found`, `invalid_transition`, `conflict`); an unexpected
  exception becomes `internal`, whose cause goes only to `onError` (server logs), never over the wire. Neither
  `runMutation` nor `runQuery` throws, whatever arrives off the wire (a non-string name is an unknown one; args
  that throw while being read are `internal`). System and integration actors carry a role and pass the same check.
- **Events and the outbox**: a successful mutation returns its domain events (`type`, `subject`, `data`). The
  server writes them to the outbox in `commit`, inside the mutation's transaction (RFC 0005); if `commit` throws,
  the rows roll back too. Clients drop the events. Every success must emit an event: one with none is a bug in
  the mutation and becomes `internal`. So "no change" (setting the current status or severity) is one code for
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
  `UNICODE_PROPERTY_ESCAPES` tells which path is active; S4 checks it is `true` on device: it is on Android
  (Hermes in React Native 0.88), and iOS is pending. Unassigned (`Cn`) depends on each engine's
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

server → client
  snapshot   { subId, epoch, version, rows }
  patch      { epoch, version, subs: { [subId]: { upserts, deletes } } }
  mutationResult { mutationId, ok: true, version } | { mutationId, ok: false, error }
  error      { code, message, subId?, mutationId? }
```

- `protocol` is `PROTOCOL_VERSION` (1). `token` is reserved and unused: the Worker authenticates the upgrade
  ("Socket topology"). The shard handles a socket's frames one at a time, in arrival order. `hello` comes first:
  any frame before it (a `mutate` included) gets a `protocol` error, and a compliant client never sends one.
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
- **Transactions:** `sql.exec` refuses `SAVEPOINT`, but `ctx.storage.transactionSync` nests and the runtime runs
  the nested call as a savepoint (inner rollback undoes only its writes, outer rollback undoes everything;
  `apps/api/test/store.test.ts`). The store's `transaction` is `transactionSync`.
- **Version and change log:** in `runMutation`'s `commit` hook, inside the mutation's transaction, the shard
  bumps `version` once, records (version, table, id) for every synced row whose value changed, stamps those rows,
  writes the outbox and stores the result. The log keeps the last 1000 versions (`CHANGE_LOG_VERSIONS`); a
  resume from before them, or from a version ahead of the shard, gets a snapshot.
- **Patches** are computed from each changed row's value before and after the mutation: a row that matches a
  subscription's `filter` now is an upsert, one that matched before and no longer does is a delete. No per-socket
  result sets are kept, so nothing about a socket lives in memory.
- **De-duplication:** the result of every `mutate` (ok or not) is stored by (clientId, mutationId) for 7 days
  (`RESULT_RETENTION_MS`); an ok result commits with the mutation's rows, so a retry after a crash between commit
  and send still gets it. Clients drop pending mutations older than that. Results older than the window are
  pruned on the next mutation.
- **Sockets:** Hibernation API. The attachment holds the client id, the actor and each subscription's query,
  validated args and last version (at most 32 subscriptions and 8 KiB per socket). Handlers are synchronous, so a
  socket's frames are handled in arrival order and frames from different sockets never interleave.
- **Close policy:** a socket-level protocol error (malformed or binary frame, over 64 KiB, a frame before `hello`,
  a second `hello`, another protocol version) gets `error { code: "protocol" }` and a close with code 1002. A
  refused subscription (`unknown_query`, `forbidden`, `invalid_args`, `internal`, or `limit` past 32) is an error
  with its `subId` and the socket stays open. An unexpected exception is logged, answered with
  `error { code: "internal" }` and the socket closes with 1011; the client reconnects and resumes.
- **Dev only, until auth:** every socket acts as `{ kind: "user", id: "usr_dev", role: "responder" }`, and the
  Worker passes the workspace id to the shard in a header on the upgrade, which the shard records on first use.

## Socket topology

**Decision (v1): one WebSocket per shard, hidden behind the client library.**

```
                       ┌── wss /sync/ws_123            ──▶ WorkspaceDO(ws_123)
SyncClient (web/mobile)┤
  connection pool      └── wss /sync/ws_123/inc_456    ──▶ IncidentDO(ws_123:inc_456)
```

- The `api` Worker authenticates the upgrade request (Better Auth session or bearer token), checks membership and
  role in the workspace, then hands the socket to the shard (`stub.fetch(request)`); the DO accepts it with the
  Hibernation API. Auth context travels as a signed header from the Worker to the DO.
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
- Session revocation: the Worker records active sockets per session in the shard; revoking a session (Better Auth
  hook) broadcasts a close to those sockets.

**Upgrade path (only if spike S3 or production metrics show a need):** a `SessionDO` per client session holding the
single client socket and fanning out to shards over DO RPC, with shards pushing patches back via RPC. It costs an
extra hop and more moving parts, so we start without it.

## Clients

- `packages/sync`: framework-agnostic client + React hooks (`useQuery`, `useMutation`) used by web and mobile.
- Mobile cache: `expo-sqlite` stores the latest snapshot per subscription → the app opens instantly and reads offline.
- Offline mutations are queued and shown as "pending". Paging actions from notifications (ack/escalate) use plain HTTPS,
  not the socket, because iOS suspends sockets in the background.

## Server-side writes

Alarms, alert ingestion, Slack commands and monitors call the same mutations through DO RPC with a system actor.
One code path for every write → one audit trail.
