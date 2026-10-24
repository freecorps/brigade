# @freecorps/brigade-api

The Brigade API: a Cloudflare Worker (HTTP entry) and its Durable Objects. See
[RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map and [RFC 0004](../../docs/rfcs/0004-sync-engine.md)
for the shards.

It has one SQLite-backed Durable Object, `WorkspaceDO`: the workspace's shard and its sync endpoint (Brigade
Sync, RFC 0004). Every write is a named mutation from `@freecorps/brigade-schema`, run in the shard.

| Route                 | Response                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `GET /health`         | `200 {"ok":true}` (`HEAD` too)                                                  |
| `GET /workspaces/:id` | `200` with the `WorkspaceDO` info read from its SQLite storage                  |
|                       | `400` if `:id` is not 1-63 chars of `a-z`, `0-9`, `-`, `_` (starting `a-z0-9`)  |
|                       | `503` if the object is overloaded or the error is retryable, `500` otherwise    |
| `GET /sync/:id`       | `101`: a Brigade Sync WebSocket to the workspace's shard (`Upgrade: websocket`) |
|                       | `426` without `Upgrade: websocket`, `400` for a bad id, `405` for other methods |
|                       | `501` where `SYNC_DEV_ACTOR` is not `"1"` (production, staging: no auth yet)    |
| other methods         | `405` with `Allow: GET, HEAD`                                                   |
| anything else         | `404`                                                                           |

`/workspaces/:id` and `/sync/:id` are dev-only placeholders with no auth. Every sync socket acts as the dev actor
`{ kind: "user", id: "usr_dev", role: "responder" }` (`DEV_ACTOR` in `src/workspace.ts`), and `hello.token` is
ignored. That needs `SYNC_DEV_ACTOR=1`: set in the `dev` environment (`wrangler.jsonc`) and by `vp dev` and the
tests (`vite.config.ts` here and in apps/web, only when serving, never in a build). Production and staging leave it
unset, and there `/sync/:id` answers `501`. Until auth exists, `workers_dev` and `preview_urls` are off, so a deployed Worker has no public URL.
Through the dashboard Worker the endpoint is `/api/sync/:id` (the service binding forwards the upgrade).

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

Local secrets go in `apps/api/.dev.vars` (`.dev.vars.<env>` per environment), which is gitignored. `wrangler types`
reads those files and adds their names to `Env`, so regenerate the committed types without them present, or accept
that the secret names (never the values) end up in `worker-configuration.d.ts`. Until then, `vp run test`
fails its stale-types check while a local `.dev.vars` exists.

## Generated types

`worker-configuration.d.ts` is generated by `wrangler types` (`vp run cf-typegen`) and committed, so type checks
run without network or a Cloudflare login. It is excluded from formatting and linting. Regenerate it after every
change to `wrangler.jsonc` or the compatibility date; `vp run test` runs `wrangler types --check` first
(`vp run cf-typegen:check`) and fails if it is stale.

License: AGPL-3.0-only.
