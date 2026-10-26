# @freecorps/brigade-api

The Brigade API: a Cloudflare Worker (HTTP entry) and its Durable Objects. See
[RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map and [RFC 0004](../../docs/rfcs/0004-sync-engine.md)
for the shards.

It has three SQLite-backed Durable Objects: `WorkspaceDO`, the workspace's shard and its sync endpoint (Brigade
Sync, RFC 0004), `ProbeDO`, one per workspace and region, which runs HTTP monitors (RFC 0007), and `WatchdogDO`, the
one object behind the external dead-man switch (below). Every write is a
named mutation from `@freecorps/brigade-schema`, run in the shard.

| Route                                    | Response                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                            | `200 {"ok":true}` (`HEAD` too)                                                                                                                                                                                                                                                                                                                                              |
| `GET /health/paging`                     | `200` with the paging pipeline's state (below); `503` if the watchdog cannot answer                                                                                                                                                                                                                                                                                         |
| `/auth/*`                                | Better Auth (`src/auth.ts`): `POST /auth/sign-up/email`, `/auth/sign-in/email`,                                                                                                                                                                                                                                                                                             |
|                                          | `/auth/sign-out`, `GET /auth/get-session`, the dashboard's organization routes, …                                                                                                                                                                                                                                                                                           |
|                                          | `429` past the rate limit; `404` for organization routes that are refused (below)                                                                                                                                                                                                                                                                                           |
| `POST /workspaces`                       | `201 {"id","name"}`: a workspace owned by the signed-in user, active in the session                                                                                                                                                                                                                                                                                         |
|                                          | `401` without a session, `400` for a bad name or a body over 4 KiB, `403` from                                                                                                                                                                                                                                                                                              |
|                                          | another site, `405`; `500` if the shard could not be provisioned (nothing is kept)                                                                                                                                                                                                                                                                                          |
| `GET /workspaces/:id`                    | `200` with the `WorkspaceDO` info read from its SQLite storage                                                                                                                                                                                                                                                                                                              |
|                                          | `400` if `:id` is not a workspace id (see `WORKSPACE_ID` in `src/workspace.ts`)                                                                                                                                                                                                                                                                                             |
|                                          | `503` if the object is overloaded or the error is retryable, `500` otherwise                                                                                                                                                                                                                                                                                                |
| `PATCH /workspaces/:id/members/:userId`  | `200 { "ok": true }`: role changed in D1 and the shard's member list (RFC 0003 "Members"); errors as `DELETE`, plus `400` for a bad `role`                                                                                                                                                                                                                                  |
| `DELETE /workspaces/:id/members/:userId` | `200 { "ok": true }`: removed (own id: left), with their devices; `400` for a bad id, `401`, `403` (other site, not a member, the rules), `404`, `409 last_owner` or `conflict` (D1 changed meanwhile: reload and retry), `503 unavailable` (D1 failed, nothing changed) or `not_applied` (D1 changed, the shard not yet: its alarm repairs it, sending it again is sooner) |
| `GET /sync/:id`                          | `101`: a Brigade Sync WebSocket to the workspace's shard, as the signed-in member                                                                                                                                                                                                                                                                                           |
|                                          | `401` without a session, `403` for a non-member or a cross-site `Origin`                                                                                                                                                                                                                                                                                                    |
|                                          | `426` without `Upgrade: websocket`, `400` for a bad id, `405` for other methods                                                                                                                                                                                                                                                                                             |
| `POST /heartbeat/:t`                     | `202 {"ok":true}`: a heartbeat monitor's ping; the token names workspace, monitor                                                                                                                                                                                                                                                                                           |
|                                          | and secret (`404` for any wrong or unknown token or workspace, alike; `405` other)                                                                                                                                                                                                                                                                                          |
| other methods                            | `405` with `Allow: GET, HEAD`                                                                                                                                                                                                                                                                                                                                               |
| anything else                            | `404`                                                                                                                                                                                                                                                                                                                                                                       |

## Auth and workspaces

Better Auth on D1 (`DB`), with email and password and the organization plugin: a workspace is an organization,
and its roles are Brigade's (`owner`, `admin`, `responder`, `viewer`) from `@freecorps/brigade-schema`. Ids are
prefixed ULIDs (`usr_…`, `ws_…`, RFC 0003). `POST /workspaces` creates a workspace with Better Auth; its
`afterCreateOrganization` hook calls `WorkspaceDO.provision()`, which runs `workspace.create` in the new shard so
`workspace.created` lands in its outbox. If that fails, the hook deletes the workspace and its membership again
before Better Auth makes it active, and the request answers `500`. `workspace.create` is server-only
(`serverMutations` in the schema): a socket cannot run it.

Workers never set `NODE_ENV`, so `src/auth.ts` sets what Better Auth would derive from it: cookies are `Secure` and
`__Secure-` prefixed when the request came over HTTPS, and rate limiting is on, counted per client IP
(`cf-connecting-ip`) and path in D1's `rateLimit` table so every isolate shares the counts: 3 per 10 s for sign-in
and sign-up, 100 per minute for the rest, `/get-session` exempt. The organization plugin's routes are refused
(`404`) except `get-full-organization`, `get-active-member`, `list` and `set-active`: the others (update, member
roles and removal, invitations, …) would change D1 without the shard's member list or a `workspace.*` / `member.*`
event in the outbox (RFC 0005). Member roles, removal and leaving go through `/workspaces/:id/members/:userId`
(below); deleting a workspace is off.

A user also has a `locale` (`en` or `pt-BR`, Better Auth's `additionalFields`): the language Brigade writes to them
in, emails included (RFC 0008). Sign-up takes it from the body, or else from the first `Accept-Language`;
`/update-user` changes it (the dashboard's language switch does). Anything else is `400 INVALID_LOCALE`.

A sync upgrade is authenticated by the Worker (`src/actor.ts`): it checks `Origin`, reads the session, looks up the
member's role in D1, and forwards a request it builds itself carrying the actor (`Brigade-Actor`) and the workspace
(`Brigade-Workspace`). The shard trusts those headers: it is only reachable through this Worker. RBAC runs in the
shard on every mutation and query (`runMutation`, `runQuery`).

`/workspaces/:id` is still an unauthenticated dev placeholder (the dashboard's stack check), so `workers_dev` and
`preview_urls` stay off. **Dev actor:** where `SYNC_DEV_ACTOR` is `"1"` and the request is for `localhost`,
`127.0.0.1`, `[::1]` or a private LAN address (a phone on the same Wi-Fi), an upgrade without a session acts as
`{ kind: "user", id: "usr_dev", role: "responder" }` (`src/dev-actor.ts`). Only `vp dev` and the tests set it (in
`vite.config.ts` here and in apps/web), never a build or an environment in `wrangler.jsonc`; no app relies on it
since the mobile app signs in. Through the dashboard Worker the endpoints are under `/api` (`/api/auth/*`,
`/api/sync/:id`).

### D1

Schema changes are SQL files in `migrations/`, applied with wrangler. `test/migrations.test.ts` applies them to the
test database and asks Better Auth what is missing; when an upgrade or a plugin needs more, it fails and prints the
SQL for the next migration.

```bash
vp run --filter @freecorps/brigade-web db:migrate      # the local database `vp run dev` uses
wrangler d1 migrations apply DB --remote --env dev     # brigade-db-dev (in apps/api)
```

| Environment | Database             | Status                                              |
| ----------- | -------------------- | --------------------------------------------------- |
| local       | Miniflare's local D1 | `db:migrate` above                                  |
| `dev`       | `brigade-db-dev`     | created on the Freecorps account, 0001-0002 applied |
| `staging`   | `brigade-db-staging` | created on the Freecorps account, 0001-0002 applied |
| production  | `brigade-db`         | created on the Freecorps account, 0001-0002 applied |

`0003_user_locale.sql` (the user's language, for emails) is not applied to the deployed databases yet: apply it
before the API that reads it is deployed there (owner's call).

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
| `outbox`           | RFC 0005 event envelopes, written in the mutation's transaction; drained to the `brigade-events` Queue by the shard alarm       |
| `outbox_drain`     | The drain's backoff after a failed send: failures in a row and when to retry                                                    |
| `member_repair`    | When the alarm reconciles the member list with D1 after a member change the shard missed                                        |
| `page_deliveries`  | Per event, the devices a page reached (the push notifier's ledger; a redelivery skips them), kept 15 days                       |
| `page_events`      | Events whose page is settled (sent everywhere, or recorded as failed): a redelivery does nothing, kept 15 days                  |
| `probe_pushes`     | Per region, the checks last pushed to its `ProbeDO` and when (monitoring, below)                                                |

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
- **Outbox:** every mutation that wrote events arms the shard alarm, which drains the outbox to the `EVENTS` Queue
  (`src/outbox.ts`): oldest first, at most 100 events or 200 KB per `sendBatch`, 10 batches per run, rows deleted
  only after a send resolves. A failed send backs off from 1 s, doubling to 5 minutes, with jitter; the backlog is
  logged on every failure (`outbox send failed`, then `outbox backlog growing` past 1000 rows). The alarm is shared
  with monitoring: it runs the monitor tick, then the drain, and moves to the earliest either needs. The API's tests
  pause the drain (`OUTBOX_DRAIN=paused`, test-only) to read events from the table; `test/outbox.test.ts` drives it.

## Paging

RFC 0005 "Notifiers", RFC 0006 "Who is paged". The Worker's `queue` handler consumes `brigade-events`
(`src/notify.ts`). For an event that pages (`incident.declared`, a severity raised into SEV1 or SEV2) it asks the
shard for a plan (`WorkspaceDO.planPage`: the incident, the urgency and the devices still to reach), seals one push
per device with its key (`packages/push`), posts it to the relay's `POST /send` (`RELAY_URL`, `RELAY_SEND_TOKEN`,
both secrets, both optional) and reports back (`WorkspaceDO.recordPage`). A relay that is unreachable or answers
5xx is retried (5, 10, 20, 40 s); after 5 attempts, or at once when retrying cannot help (no relay configured,
Android, a refused request), each member reached on none of their devices gets a `page_failed` timeline entry and a
`notification.failed` event, written by `sys_notifier`; so does each member the page was for without a device
(`no_devices`) or past the 200-device cap (`over_limit`). A token APNs calls gone (410, `BadDeviceToken`,
`Unregistered`) drops the device (`device.expire`, unless it was registered again with another token meanwhile).
Devices are a server-only table (`devices`), written by `device.register` and `device.unregister` (any member, their
own devices only).

A message the shard fails on every time (unreachable, throwing) is retried up to `max_retries` (10); the last
delivery logs `page dead-lettered` and it goes to `brigade-events-dlq`, which the same handler consumes
(`consumeDeadLetters`): it asks the shard once to record the page as `dead_lettered` on the incident's timeline
(`WorkspaceDO.recordDeadLetter`) and acks, whether or not that worked.

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

## Email

RFC 0005 "Email". The same `queue` handler routes each `notification.failed` from push to the email notifier
(`src/notify-email.ts`): the shard plans who is emailed (`WorkspaceDO.planEmail`, `src/mailer.ts`), the Worker reads
their addresses and languages from D1 (`user.email`, `user.locale`), renders each email in the recipient's language
(`src/email-templates.ts`, `email_text` in packages/i18n, escaped HTML and plain text) and sends it through an
`EmailSender` (`src/email.ts`), then reports back (`WorkspaceDO.recordEmail`). Two emails, both on by default
(`workspace.setEmail`, owners and admins):

- **A member a page missed** (no phone, every push failed, Android, no relay, the device cap): SEV1 and SEV2 only,
  once per incident.
- **The owners, when nobody could be paged**: a page that settled having reached nobody, when nothing else will page
  on its own (no escalation run, or the last page of a run that ended).

Neither once the incident is acknowledged or resolved. A failed send is retried (30 s, 1, 2, 4 minutes); after 5
attempts, or at once when the service refuses the message or address, it is an `email_failed` timeline entry and a
`notification.failed` with `channel: "email"`. Push never waits on any of this: email only acts on failures push
already recorded, and a page in the same batch is handled in parallel.

Which sender is used:

| Set                             | Sender                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `EMAIL_FROM` (and the binding)  | Cloudflare Email Sending through the `EMAIL` binding (`send_email` in wrangler.jsonc) |
| `EMAIL_LOG=1` (local runs only) | Logs each email (one JSON line with the text) and sends nothing                       |
| neither                         | No email; failed pages are still on the timeline                                      |

`vp run dev` sets `EMAIL_LOG`, so the terminal shows what would be sent. Setting `EMAIL_FROM` in the shell
(`EMAIL_FROM="Brigade <brigade@example.com>" vp run dev`) uses the binding instead, which wrangler simulates locally:
it logs the message and writes it to a local file, and never sends. Never set `remote: true` on the binding.

**To send for real** (owner's call, per environment):

1. Onboard a sending domain to Cloudflare Email Sending in the account (dashboard: Compute & AI > Email Service >
   Email Sending > Onboard Domain; it adds the SPF and DKIM records). Add a DMARC record if the domain has none.
2. `wrangler secret put EMAIL_FROM` with a sender on that domain, `Brigade <brigade@your-domain>`.
3. Optionally `wrangler secret put DASHBOARD_URL` with the dashboard's origin (`https://…`), so emails link to the
   incident; without it they carry no link.
4. Apply `migrations/0003_user_locale.sql` to the environment's D1 before deploying (`wrangler d1 migrations apply`):
   the notifier reads `user.locale`.

Emails go to the address each user signed up with: email verification does not exist yet (RFC 0002), so an address
is not proven to be theirs. What an email carries is the incident's number, severity and title and the workspace's
name.

## Monitoring

RFC 0007. Monitors live in the workspace shard (`monitors`, `alerts`, and the server-only `heartbeats` with each
heartbeat token's SHA-256); `monitor.*` mutations need `monitor:manage` (owners and admins).

- **Probes** (`src/probe.ts`): one `ProbeDO` per workspace and region (`<workspace>:<region>`, created with that
  `locationHint`; only regions where objects spawn are offered, spike S2). The shard pushes each region's HTTP
  checks (`configure`); `alarm()` sets the next alarm first, then runs the due checks (`src/check.ts`: the target
  rules again, no redirects followed, at most 64 KiB of body read, a timeout) and fetches
  `/cdn-cgi/trace` once to record the colo it really ran from. A region's verdict flips after 2 alike checks; the
  probe reports it to `WorkspaceDO.report()` on a change and otherwise every 5 minutes, de-duplicated by report id.
- **Quorum → alert → incident:** each report is `monitor.report`, a server-only mutation run as the system actor
  `sys_monitors` (role `admin`). A monitor is down when a majority of its fresh regions is down (1 of 1, 2 of 3);
  that fires one alert per monitor and opens an incident through `incident.declare` in the same transaction.
  Recovery resolves the alert and leaves the incident to people. With too few fresh regions it is `unknown` ("No
  data"), which keeps a firing alert and pages nobody (RFC 0007). An unchanged verdict's 5-minute refresh writes no
  outbox event.
- **Heartbeats:** `POST /heartbeat/:token` checks the workspace in D1 (no Durable Object for a made-up one; if D1 fails it asks the shard anyway), hashes
  the secret, and the shard compares it with the stored hash in constant time. The shard's alarm (at least every minute while monitors exist) marks a heartbeat that missed its
  interval plus grace as down, re-pushes probe configs every 10 minutes or when a region stops reporting (which
  re-arms a probe whose alarm was lost), turns monitors whose results went stale `unknown` (`monitor.evaluate`), and
  retries failed pushes.

## Dead-man switch

RFC 0007 "Watching the watcher" (`src/watchdog.ts`). A Cron Trigger (`* * * * *`, `scheduled`) asks the one
`WatchdogDO` for a beat: a `brigade.heartbeat` event in its own `outbox`, drained by its alarm through the same
`OutboxDrain` to `brigade-events`. The consumer sends the watchdog's events (`workspaceId` `_system`) to
`proveHeartbeat` instead of a shard: it proves the relay takes the send token (`POST /send` with the token and no
body: `400 invalid_body` is accepted, `401` refused) and reports to `WatchdogDO.proved()`, which pings `DEAD_MAN_URL`
(in `waitUntil`, 5 s timeout) when the beat is the newest yet, took at most 2 minutes and the relay took the token. The external check
(any service or self-hosted checker that alerts on a missed URL ping; period 1 minute, grace about 5) pages the
operators when the pings stop.

`GET /health/paging` answers `{ status }` without a session (or to a user in no workspace); `{ status, reasons,
lastBeatAt, lastProvedAt, lastOkAt }` to a member; never `external` (operators read the logs).
`degraded` after 3 minutes with no beat (`no_beat`), with the newest proved beat older than 3 minutes
(`pipeline_stalled`), with the last proof over 2 minutes late (`pipeline_slow`), or with the relay
`relay_unauthorized`, `relay_unreachable` or `relay_not_configured` on the last proof; `unknown` before the first
proof. The dashboard shows a notice while it is not `ok`. Changes of status or reasons write `brigade.status_changed`
and log `paging pipeline degraded`.

`DEAD_MAN_URL` is an optional secret (`wrangler secret put DEAD_MAN_URL --env dev`; `https:` only, `http:` on
loopback). Locally the cron never fires on its own, and `secrets.required` keeps optional secrets out of `.dev.vars`,
so pass them from the shell (apps/web's `vite.config.ts` hands them to the local API) and run the cron by hand:

```bash
RELAY_SEND_TOKEN=local node scripts/dead-man-double.mjs   # from the root: the check's (and relay's) stand-in, port 8790
DEAD_MAN_URL=http://127.0.0.1:8790/ping RELAY_URL=http://127.0.0.1:8790 RELAY_SEND_TOKEN=local vp run dev
# The cron, by hand: the Vite plugin's local explorer (GET /cdn-cgi/handler/scheduled reaches the web Worker instead).
curl -X POST "http://localhost:5173/cdn-cgi/local/explorer/api/local/scheduled?worker=brigade-api" \
  -H 'Content-Type: application/json' -d '{"cron":"* * * * *"}'
```

Each run pings the double; start `vp run dev` with another `RELAY_SEND_TOKEN` and the next run shows
`relay_unauthorized` on the dashboard and pings nothing.

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

Durable Object and `send_email` bindings are not inherited by environments, so each one repeats them.

Local secrets go in `apps/api/.dev.vars` (`.dev.vars.<env>` per environment), which is gitignored. Their names
come from `secrets.required` in `wrangler.jsonc`, so `wrangler types` no longer reads `.dev.vars` and the committed
types stay the same with or without one.

## Generated types

`worker-configuration.d.ts` is generated by `wrangler types` (`vp run cf-typegen`) and committed, so type checks
run without network or a Cloudflare login. It is excluded from formatting and linting. Regenerate it after every
change to `wrangler.jsonc` or the compatibility date; `vp run test` runs `wrangler types --check` first
(`vp run cf-typegen:check`) and fails if it is stale.

License: AGPL-3.0-only.
