# @freecorps/brigade-api

The Brigade API: a Cloudflare Worker (HTTP entry) and its Durable Objects. See
[RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map and [RFC 0004](../../docs/rfcs/0004-sync-engine.md)
for the shards.

It has one SQLite-backed Durable Object, `WorkspaceDO`: the workspace's shard and its sync endpoint (Brigade
Sync, RFC 0004). Every write is a named mutation from `@freecorps/brigade-schema`, run in the shard.

| Route                 | Response                                                                            |
| --------------------- | ----------------------------------------------------------------------------------- |
| `GET /health`         | `200 {"ok":true}` (`HEAD` too)                                                      |
| `/auth/*`             | Better Auth (`src/auth.ts`): `POST /auth/sign-up/email`, `/auth/sign-in/email`,     |
|                       | `/auth/sign-out`, `GET /auth/get-session`, the organization plugin's routes, …      |
| `POST /workspaces`    | `201 {"id","name"}`: a workspace owned by the signed-in user, active in the session |
|                       | `401` without a session, `400` for a bad name, `403` from another site, `405`       |
| `GET /workspaces/:id` | `200` with the `WorkspaceDO` info read from its SQLite storage                      |
|                       | `400` if `:id` is not a workspace id (see `WORKSPACE_ID` in `src/workspace.ts`)     |
|                       | `503` if the object is overloaded or the error is retryable, `500` otherwise        |
| `GET /sync/:id`       | `101`: a Brigade Sync WebSocket to the workspace's shard, as the signed-in member   |
|                       | `401` without a session, `403` for a non-member or a cross-site `Origin`            |
|                       | `426` without `Upgrade: websocket`, `400` for a bad id, `405` for other methods     |
| other methods         | `405` with `Allow: GET, HEAD`                                                       |
| anything else         | `404`                                                                               |

## Auth and workspaces

Better Auth on D1 (`DB`), with email and password and the organization plugin: a workspace is an organization,
and its roles are Brigade's (`owner`, `admin`, `responder`, `viewer`) from `@freecorps/brigade-schema`. Ids are
prefixed ULIDs (`usr_…`, `ws_…`, RFC 0003). `POST /workspaces` creates a workspace with Better Auth; its
`afterCreateOrganization` hook calls `WorkspaceDO.provision()`, which runs `workspace.create` in the new shard so
`workspace.created` lands in its outbox.

A sync upgrade is authenticated by the Worker (`src/actor.ts`): it checks `Origin`, reads the session, looks up the
member's role in D1, and forwards a request it builds itself carrying the actor (`Brigade-Actor`) and the workspace
(`Brigade-Workspace`). The shard trusts those headers: it is only reachable through this Worker. RBAC runs in the
shard on every mutation and query (`runMutation`, `runQuery`).

`/workspaces/:id` is still an unauthenticated dev placeholder (the dashboard's stack check), so `workers_dev` and
`preview_urls` stay off. **Dev actor:** where `SYNC_DEV_ACTOR` is `"1"`, an upgrade without a session acts as
`{ kind: "user", id: "usr_dev", role: "responder" }` (`src/dev-actor.ts`). Only `vp dev` and the tests set it (in
`vite.config.ts` here and in apps/web), never a build or an environment in `wrangler.jsonc`; the mobile app relies
on it until it can sign in. Through the dashboard Worker the endpoints are under `/api` (`/api/auth/*`,
`/api/sync/:id`).

### D1

Schema changes are SQL files in `migrations/`, applied with wrangler. `test/migrations.test.ts` applies them to the
test database and asks Better Auth what is missing; when an upgrade or a plugin needs more, it fails and prints the
SQL for the next migration.

```bash
vp run --filter @freecorps/brigade-web db:migrate      # the local database `vp run dev` uses
wrangler d1 migrations apply DB --remote --env dev     # brigade-db-dev (in apps/api)
```

| Environment | Database             | Status                                                     |
| ----------- | -------------------- | ---------------------------------------------------------- |
| local       | Miniflare's local D1 | `db:migrate` above                                         |
| `dev`       | `brigade-db-dev`     | created on the Freecorps account, migrations applied       |
| `staging`   | `brigade-db-staging` | not created; the first deploy provisions it (owner's call) |
| production  | `brigade-db`         | not created; same                                          |

`BETTER_AUTH_SECRET` is required in every environment (`secrets.required`): `wrangler secret put
BETTER_AUTH_SECRET --env dev` for a deployed Worker, and for local runs a gitignored `apps/api/.dev.vars`:

```bash
printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > apps/api/.dev.vars
```

## Sync server

`src/workspace.ts` speaks the protocol in `@freecorps/brigade-sync/protocol` over the WebSocket Hibernation API;
`src/shard.ts` keeps the shard's state in SQLite. Everything a socket needs (client id, actor, subscriptions with
their args) is in its attachment, so the object can hibernate between frames. Handlers are
synchronous, so frames are handled strictly in arrival order. The details and the reasons are in RFC 0004,
"Shard server".

| Table              | Holds                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `store_rows`       | Every row of every table in `TABLES` (incidents, counters) as JSON, keyed by (table, id), with the version that last changed it |
| `shard_meta`       | `version` (one bump per committed mutation), `log_start`, the workspace id, and the `epoch` created with the storage            |
| `change_log`       | (version, table, id) of every synced row each version changed; the last 1000 versions                                           |
| `mutation_results` | The result of each (clientId, mutationId) the shard ran, kept 7 days from the run for de-duplication                            |
| `outbox`           | RFC 0005 event envelopes, written in the mutation's transaction; not drained yet (no Queue)                                     |

- **Epoch:** created with the storage and rotated by `WorkspaceDO.rotateEpoch()`, which every restore must call
  before the shard is reachable again (it also closes every socket with 1012). A resume from another epoch, from a
  version ahead of the shard or from before the change log gets a snapshot, otherwise a patch.
- **Patches:** one per version per socket, for the subscriptions it touched (a `key` query holds only its row);
  the socket that ran an ok mutation always gets that version's patch, with `subs: {}` if nothing on it changed. A
  retry answered from `mutation_results` gets the stored result only. A resume's `deletes` may name ids the
  subscription never held (fine until row-level access exists).
- **Results:** keyed by (actor id, clientId, mutationId); `unknown_mutation` is not stored. A storage failure
  anywhere in a mutation's transaction (`StorageFailure` from `src/store.ts`) stores nothing and closes the socket
  with 1011, so the client replays the mutation; only an exception from the mutation's own code is stored as
  `internal`. Expired results are pruned before each mutation, and a failure there is only logged.
- **Outbox:** not drained yet; its row count is logged every 1000 rows (`outbox not drained`).
- **Limits:** client frames up to 64 KiB of text (binary frames are refused); 32 subscriptions per socket and
  about 8 KiB of attachment state (measured as JSON).
- **Errors and closes:** any frame before `hello` (a `mutate` too), a second `hello`, another protocol version or a
  frame with no readable id gets `error { code: "protocol" }` and a close with code 1002. After `hello`, a
  malformed `subscribe` or `mutate` with a readable id is refused alone with `invalid_args` (an `error` with its
  `subId`, which also drops a subscription with that subId, or a failed `mutationResult`) and the socket stays
  open, as for any refused subscription. Unexpected failures, and a `send` that throws, are logged as one JSON line
  (`console.error`), answered with `error { code: "internal" }` when possible, and close the socket with 1011; the
  client reconnects and replays. Frames still queued on a socket the shard closed are dropped unread, so nothing runs
  out of order before the replay.

## Run it

```bash
vp dev                                        # in apps/api: Worker + DO locally via the Cloudflare Vite plugin
vp run --filter @freecorps/brigade-api test   # from the root: tests in workerd via @cloudflare/vitest-plugin
vp run --filter @freecorps/brigade-api build  # bundle to dist/brigade_api/ (with a generated wrangler.json)
```

## Environments

`wrangler.jsonc` defines production as the top-level config (`brigade-api`) and the `dev` and `staging`
environments (`brigade-api-dev`, `brigade-api-staging`). With the Vite plugin the environment is chosen at build
time with `CLOUDFLARE_ENV`; do not pass `--env` at deploy:

```bash
vp run build:staging        # CLOUDFLARE_ENV=staging vp build (also build:dev)
wrangler deploy --dry-run   # validates the built output (drop --dry-run to deploy)
```

Durable Object bindings are not inherited by environments, so each one repeats them.

Local secrets go in `apps/api/.dev.vars` (`.dev.vars.<env>` per environment), which is gitignored. Their names
come from `secrets.required` in `wrangler.jsonc`, so `wrangler types` no longer reads `.dev.vars` and the committed
types stay the same with or without one.

## Generated types

`worker-configuration.d.ts` is generated by `wrangler types` (`vp run cf-typegen`) and committed, so type checks
run without network or a Cloudflare login. It is excluded from formatting and linting. Regenerate it after every
change to `wrangler.jsonc` or the compatibility date; `vp run test` runs `wrangler types --check` first
(`vp run cf-typegen:check`) and fails if it is stale.

License: AGPL-3.0-only.
