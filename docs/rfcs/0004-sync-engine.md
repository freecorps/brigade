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
  `runMutation` nor `runQuery` throws. System and integration actors carry a role and pass the same check.
- **Events and the outbox**: a successful mutation returns its domain events (`type`, `subject`, `data`). The
  server writes them to the outbox in `commit`, inside the mutation's transaction (RFC 0005); if `commit` throws,
  the rows roll back too. Clients drop the events. Since every success emits an event, "no change" (setting the
  current status or severity) is one code for both: `conflict`, which also covers an existing id.
- **Transactions are re-entrant.** The server already runs inside its own transaction when it calls
  `runMutation`, so the SQLite store's `transaction` must nest (savepoints, or flattening into the outer one): an
  inner rollback undoes only its writes; an outer rollback undoes everything. The in-memory store copies its table
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
  accepts only plain objects and rejects unknown keys. `v.string` trims an explicit whitespace set (not the
  engine's `trim`), rejects raw input longer than about twice its limit before any work, and by default rejects
  control characters (NUL and newlines included), U+2028/2029 and bidi overrides/isolates. Errors carry at most
  10 issues, and echoed names and paths are cut to 64 characters. Valibot is the upgrade if the arg shapes outgrow
  this.
- **In S3 the `WorkspaceDO` incident index is temporarily authoritative** for status and severity. Once
  `IncidentDO` exists it owns them, and the index becomes a projection fed from `IncidentDO`'s outbox (RFC 0002).

## Protocol (WebSocket, JSON; binary later if needed)

```
client → server
  hello      { token, clientId, lastVersions: { [shardId]: number } }
  subscribe  { subId, query, args }
  unsubscribe{ subId }
  mutate     { mutationId, name, args }

server → client
  snapshot   { subId, version, rows }
  patch      { subId, version, upserts, deletes }
  mutationResult { mutationId, ok, version? , error? }
```

- On reconnect the client sends `lastVersions`; the shard replies with patches since that version, or a fresh
  snapshot if the change log was compacted.
- Optimistic layer: pending mutations are re-applied on top of every server patch until confirmed or rejected
  (rollback on rejection). Each pending mutation keeps the `MutationContext` (`now`, `actor`) of its first run on
  every re-apply, so re-applying is deterministic. A pending mutation that fails on local re-apply (the server
  state moved under it) is dropped from the optimistic view silently; only a rejection in the server's
  `mutationResult` is shown to the user.
- The server de-duplicates `mutate` by `(clientId, mutationId)`: a retry after a lost connection gets the stored
  `mutationResult` instead of running the mutation twice.
- Shards keep a bounded change log (rows changed per version) to serve resumes cheaply.
- WebSocket Hibernation API on the DO keeps idle connections cheap.

## Socket topology

**Decision (v1): one WebSocket per shard, hidden behind the client library.**

```
                       ┌── wss /sync/ws_123            ──▶ WorkspaceDO(ws_123)
SyncClient (web/mobile)┤
  connection pool      └── wss /sync/ws_123/inc_456    ──▶ IncidentDO(inc_456)
```

- The `api` Worker authenticates the upgrade request (Better Auth session or bearer token), checks membership and
  role in the workspace, then hands the socket to the shard (`stub.fetch(request)`); the DO accepts it with the
  Hibernation API. Auth context travels as a signed header from the Worker to the DO.
- `SyncClient` owns a pool: it opens a shard connection on the first subscription to it and closes it a few
  seconds after the last unsubscribe. Apps only see `useQuery` / `useMutation`.
- Typical load is small: web dashboard = workspace + 0–3 open incidents; mobile = workspace + current incident.
- Every message already carries its shard id, so the protocol does not change if we move to a gateway.
- Reconnect: exponential backoff with jitter; on reconnect, `hello` sends `lastVersions` and each subscription resumes.
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
