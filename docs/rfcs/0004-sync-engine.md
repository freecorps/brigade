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
  get(table, id); insert(table, row); update(table, id, patch); delete(table, id);
  scan(table);                               // rows ordered by id
  transaction(fn);                           // undo every write if fn throws; may nest
}

type MutationContext = { actor: { kind: "user" | "system" | "integration"; id; role }; now: number; server: boolean };

defineMutation({ name: "incident.declare", args: v.object({ … }), permission: "incident:declare",
  apply(store, args, ctx) { …; return ok(event) /* or fail("not_found", …) */ } });
defineQuery({ name: "incidents.active", args: v.object({}), permission: "incident:read",
  table: "incidents", filter: (row, args) => …, sort: (a, b) => … });

runMutation(mutations, name, rawArgs, store, ctx) // → { ok: true, events } | { ok: false, error: { code, … } }
runQuery(queries, name, rawArgs, store, role)     // → { ok: true, rows }  | { ok: false, error }
```

- **Mutations** are deterministic and side-effect free: they read and write only the store, and time comes from
  `ctx.now` (epoch milliseconds, the same unit as ULIDs and SQLite integers; ISO 8601 only in event envelopes and
  the UI). `runMutation` checks the role against the access-control table (`can(role, permission)`, shaped for
  Better Auth's `createAccessControl`, RFC 0003), validates args, then runs `apply` in `store.transaction`, so a
  failure writes nothing. Failures are typed (`unknown_mutation`, `forbidden`, `invalid_args`, `not_found`,
  `invalid_transition`, `conflict`); an unexpected exception becomes `internal` with no details. System and
  integration actors carry a role and pass the same check.
- **Events**: a successful mutation returns its domain events (`type`, `subject`, `data`); the server wraps them in
  the `BrigadeEvent` envelope and writes them to the outbox in the same transaction (RFC 0005). Clients drop them.
  Since every success emits an event, a no-op (e.g. setting the current severity) is a `conflict`.
- **Server-only work** runs when `ctx.server` is true. `INC-n` comes from a `counters` row written in the
  mutation's own transaction, not from an injected callback, so it stays atomic and replayable; the client's
  optimistic row has `number: null` until the server's patch arrives.
- **Client-generated ids**: the client makes the prefixed ULID (`newId("inc", now, randomBytes)`) and passes it in
  the args, so the optimistic row and the server row share one id; the server checks the format (`isId`) and
  rejects an existing id with `conflict`.
- **Queries are data over one table** (`table`, `filter`, `sort`). The server uses `filter` to tell which
  subscriptions a changed row touches; clients re-run the query over local rows after an optimistic mutation.
  Limitation: no joins or aggregates; a view that needs them is a projection table the shard maintains in its
  mutations.
- **Validation** is a handful of hand-written validators (`v.object`, `v.string`, `v.picklist`, `v.id`) in
  `packages/schema`: no dependency, nothing engine-specific (runs on Workers, browsers and Hermes), and unknown keys
  are rejected so the wire stays tight. Valibot is the upgrade if the arg shapes outgrow them.

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
  (rollback on rejection).
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
