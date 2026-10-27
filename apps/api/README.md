# @freecorps/brigade-api

The Brigade API: a Cloudflare Worker (HTTP entry) and its Durable Objects. See
[RFC 0002](../../docs/rfcs/0002-architecture.md) for the runtime map and [RFC 0004](../../docs/rfcs/0004-sync-engine.md)
for the shards.

It has three SQLite-backed Durable Objects: `WorkspaceDO`, the workspace's shard and its sync endpoint (Brigade
Sync, RFC 0004), `ProbeDO`, one per workspace and region, which runs HTTP monitors (RFC 0007), and `WatchdogDO`, the
one object behind the external dead-man switch (below). Every write is a
named mutation from `@freecorps/brigade-schema`, run in the shard.

| Route                                                | Response                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                                        | `200 {"ok":true}` (`HEAD` too)                                                                                                                                                                                                                                                                                                                                              |
| `GET /health/paging`                                 | `200` with the paging pipeline's state (below); `503` if the watchdog cannot answer                                                                                                                                                                                                                                                                                         |
| `/auth/*`                                            | Better Auth (`src/auth.ts`): `POST /auth/sign-up/email`, `/auth/sign-in/email`,                                                                                                                                                                                                                                                                                             |
|                                                      | `/auth/sign-out`, `GET /auth/get-session`, the dashboard's organization routes, …                                                                                                                                                                                                                                                                                           |
|                                                      | `429` past the rate limit; `404` for organization routes that are refused (below)                                                                                                                                                                                                                                                                                           |
| `POST /workspaces`                                   | `201 {"id","name"}`: a workspace owned by the signed-in user, active in the session                                                                                                                                                                                                                                                                                         |
|                                                      | `401` without a session, `400` for a bad name or a body over 4 KiB, `403` from                                                                                                                                                                                                                                                                                              |
|                                                      | another site, `405`; `500` if the shard could not be provisioned (nothing is kept)                                                                                                                                                                                                                                                                                          |
| `GET /workspaces/:id`                                | `200` with the `WorkspaceDO` info read from its SQLite storage (the dashboard's stack check), for a member                                                                                                                                                                                                                                                                  |
|                                                      | `401` without a session, `403 not_a_member` otherwise (the shard is not woken), `400` for a bad id, `405`                                                                                                                                                                                                                                                                   |
|                                                      | `503` if D1 or the object is overloaded or the error is retryable, `500` otherwise                                                                                                                                                                                                                                                                                          |
| `PATCH /workspaces/:id/members/:userId`              | `200 { "ok": true }`: role changed in D1 and the shard's member list (RFC 0003 "Members"); errors as `DELETE`, plus `400` for a bad `role`                                                                                                                                                                                                                                  |
| `DELETE /workspaces/:id/members/:userId`             | `200 { "ok": true }`: removed (own id: left), with their devices; `400` for a bad id, `401`, `403` (other site, not a member, the rules), `404`, `409 last_owner` or `conflict` (D1 changed meanwhile: reload and retry), `503 unavailable` (D1 failed, nothing changed) or `not_applied` (D1 changed, the shard not yet: its alarm repairs it, sending it again is sooner) |
| `GET /sync/:id`                                      | `101`: a Brigade Sync WebSocket to the workspace's shard, as the signed-in member                                                                                                                                                                                                                                                                                           |
|                                                      | `401` without a session, `403` for a non-member or a cross-site `Origin`                                                                                                                                                                                                                                                                                                    |
|                                                      | `426` without `Upgrade: websocket`, `400` for a bad id, `405` for other methods                                                                                                                                                                                                                                                                                             |
| `POST /receipts`                                     | `200 {"ok":true}`: a phone opened a page; body `{"token"}`, the token sealed in that page (403 not genuine, 410 expired, 404 never planned, 429 too many)                                                                                                                                                                                                                   |
| `POST /heartbeat/:t`                                 | `202 {"ok":true}`: a heartbeat monitor's ping; the token names workspace, monitor                                                                                                                                                                                                                                                                                           |
|                                                      | and secret (`404` for any wrong or unknown token or workspace, alike; `405` other)                                                                                                                                                                                                                                                                                          |
| `POST /workspaces/:id/incidents/:i/postmortem/draft` | `202 {"requestId"}`: an AI draft is being written (responders and up; "Postmortem drafts"); `403`, `404`, `409` one is running or members wrote text, `429` over the daily cap, `503 ai_unavailable` without the binding                                                                                                                                                    |
| `POST /workspaces/:id/exports`                       | `201 {"id","expiresAt","incidents","bytes"}`: body `{"scope"}` (owners and admins; "Exports"); `400`, `403`, `404`, `413` too many incidents, `503 exports_unavailable` without the bucket                                                                                                                                                                                  |
| `GET /workspaces/:id/exports/:exportId`              | `200`: the export file as an attachment, streamed from R2 (owners and admins); `404`, `410 expired`, `503` without the bucket                                                                                                                                                                                                                                               |
| `GET /features`                                      | `200 {"ai","exports"}`: whether this deployment has the `AI` and `EXPORTS` bindings, for a signed-in user (the dashboard hides what it lacks)                                                                                                                                                                                                                               |
| other methods                                        | `405` with `Allow: GET, HEAD`                                                                                                                                                                                                                                                                                                                                               |
| anything else                                        | `404`                                                                                                                                                                                                                                                                                                                                                                       |

The public routes, the ones integrations may rely on, are in the OpenAPI 3.1 reference,
[`docs/api/openapi.json`](../../docs/api/openapi.json) (RFC 0002 "Public HTTP API"), with every error code each
answers. It is generated from `src/openapi.ts`: after changing a public route, its body or its answers, run
`vp run openapi` here; `test/openapi.test.ts` fails until the file matches, and calls every documented operation.
Its `webhooks` section documents the outbound webhooks' payloads. `packages/sdk` is the client side of both; after
changing how deliveries are signed or what a payload holds, run `vp run sdk-fixture` here too:
`test/webhooks.test.ts` fails until the SDK's fixture of signed deliveries matches.

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

This Worker never has a public URL (`workers_dev` and `preview_urls` are off in every environment): requests reach it
through the web Worker's `API` binding. **Dev actor:** where `SYNC_DEV_ACTOR` is `"1"` and the request is for `localhost`,
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

| Table               | Holds                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `store_rows`        | Every row of every table in `TABLES` (incidents, counters) as JSON, keyed by (table, id), with the version that last changed it |
| `shard_meta`        | `version` (one bump per committed mutation), `log_start`, the workspace id, and the `epoch` created with the storage            |
| `change_log`        | (version, table, id) of every synced row each version changed; the last 1000 versions                                           |
| `mutation_results`  | The result of each (clientId, mutationId) the shard ran, kept 7 days from the run for de-duplication                            |
| `outbox`            | RFC 0005 event envelopes, written in the mutation's transaction; drained to the `brigade-events` Queue by the shard alarm       |
| `outbox_drain`      | The drain's backoff after a failed send: failures in a row and when to retry                                                    |
| `member_repair`     | When the alarm reconciles the member list with D1 after a member change the shard missed                                        |
| `invitation_sends`  | Each invitation email asked for (sent, held or done) and where the request came from; counts toward the daily invitation cap    |
| `invitation_repair` | Invitation mutations owed after D1 committed and the shard step failed; the member repair alarm runs them again                 |
| `page_deliveries`   | Per event, the devices a page reached (the push notifier's ledger; a redelivery skips them), kept 15 days                       |
| `page_events`       | Events whose page is settled (sent everywhere, or recorded as failed): a redelivery does nothing, kept 15 days                  |
| `receipt_key`       | The shard's own HMAC key for delivery receipt tokens (RFC 0006 "Delivery receipts"): random, made on first use, never sent      |
| `receipt_rate`      | Delivery receipts per device in the current minute (at most 30)                                                                 |
| `probe_pushes`      | Per region, the checks last pushed to its `ProbeDO` and when (monitoring, below)                                                |

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
per device with its key (`packages/push`), posts it to the relay's `POST /send` (through the `RELAY` service binding
when bound, otherwise at `RELAY_URL`; `RELAY_SEND_TOKEN` either way; all optional) and reports back
(`WorkspaceDO.recordPage`). A relay that is unreachable or answers 5xx is retried (5, 10, 20, 40 s); after 5
attempts, or at once when retrying cannot help (no relay configured, Android, a refused request), each member
reached on none of their devices gets a `page_failed` timeline entry and a `notification.failed` event, written by
`sys_notifier`; so does each member the page was for without a device (`no_devices`) or past the 200-device cap
(`over_limit`). A token APNs calls gone (410, `BadDeviceToken`, `Unregistered`) drops the device (`device.expire`,
unless it was registered again with another token meanwhile). Devices are a server-only table (`devices`), written
by `device.register` and `device.unregister` (any member, their own devices only).

A message the shard fails on every time (unreachable, throwing) is retried up to `max_retries` (10); the last
delivery logs `page dead-lettered` and it goes to `brigade-events-dlq`, which the same handler consumes
(`consumeDeadLetters`): it asks the shard once to record the page as `dead_lettered` on the incident's timeline
(`WorkspaceDO.recordDeadLetter`) and acks, whether or not that worked. A lost SEV1 or SEV2 declaration with no
escalation run to page it again is paged again once, 30 s later, from the shard's alarm (`incident.pageAgain` as
`sys_notifier`); owners and admins can page any failed page again from the incident page (RFC 0005 "Notifiers").

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

**To send for real** (owner's call, per environment). Email verification exists now, so the notifier only emails
proven addresses (RFC 0005 "Email", "Abuse").

1. Onboard a sending domain to Cloudflare Email Sending in the account (dashboard: Compute & AI > Email Service >
   Email Sending > Onboard Domain; it adds the SPF and DKIM records). Add a DMARC record if the domain has none.
2. `wrangler secret put EMAIL_FROM` with a sender on that domain, `Brigade <brigade@your-domain>`.
3. `wrangler secret put DASHBOARD_URL` with the dashboard's origin (`https://…`). Required wherever email is set up:
   without it the notifier's emails carry no link to the incident, and no verification, password reset or invitation
   email is sent
   at all (logged), since their link is the whole point and a deployed Worker never builds it from the host a
   request named.
4. Apply `migrations/0003_user_locale.sql`, `migrations/0004_invitations.sql`,
   `migrations/0005_invitation_sends.sql` and `migrations/0007_password_reset.sql` to the environment's D1 before
   deploying (`wrangler d1 migrations apply`): the notifier reads `user.locale`, invitations need the index and the
   sends table, and a password reset writes `user.passwordResetAt` and the takeover notice.

These emails go only to addresses their owners verified (`user.emailVerified`): an unverified member is skipped.
What an email carries is the incident's number, severity and title and the workspace's name. At most 5 emails go to
one user from a workspace in an hour, and 200 from a workspace in a day.

The same sender sends the account emails (RFC 0002 "Auth", RFC 0003 "Invitations"):

- **Email verification**: sent at sign-up and when the dashboard asks again (signed in, for one's own address, at
  most 3 per user in 15 minutes, 5 a day and 3 per IP a minute). It carries the address and the link, never the name
  typed at sign-up. The link opens the dashboard's `/verify-email` page and works for 24 hours. Without a sender,
  asking again answers `503 EMAIL_NOT_CONFIGURED`. An address someone signed up with and never verified stays taken
  until its owner resets the password.
- **Password reset**: "Forgot your password?" on the dashboard's sign-in page (`/forgot-password`; the mobile app
  opens that page). The same answer for any address, with an account or not; at most 3 per address and IP an hour,
  10 per address a day and 3 per IP a minute. The email carries the address and the link, never the name; the link
  opens the dashboard's `/reset-password#token=…` page and works once, for an hour. Saving the new password ends
  every session, signs the account's phones and sockets out of each workspace (retried, then caught up by the
  shard's member reconcile from `user.passwordResetAt`) and marks the address verified, which is how the owner of an
  address someone else signed up with takes the account back (RFC 0002 "Auth"); on such a takeover the monitors of
  the workspaces it is alone in are paused, their heartbeat and alert source URLs revoked, and the dashboard tells the owner once
  (`GET`/`DELETE /account/takeover`). Without a sender, asking answers `503 EMAIL_NOT_CONFIGURED`.
- **Invitations**: `member.invited` from the workspace shard's outbox, sent by the same queue consumer
  (`src/notify-invite.ts`), in the invitee's language if they have an account, else the inviter's. The link opens the
  dashboard's `/invitations/:id`. Capped per workspace and, counted in D1, per invited address, per inviter and per
  invitation across every workspace (RFC 0003 "Invitations").

Links use `DASHBOARD_URL`. Only the log double falls back on the origin the request came through (the dashboard's,
under `vp run dev`). Under `vp run dev` the log double prints each email, link included, so a local sign-up is verified by
opening the link from the terminal.

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

## Alert sources

RFC 0005 "Alert sources". `POST /alerts/:token` (`src/index.ts` `receiveAlerts`, also under the dashboard's `/api`):
the token is `<workspace id>.<source id>.<secret>`. The Worker checks the workspace in D1, holds the workspace to
`ALERT_WORKSPACE_LIMIT`, reads at most 256 KiB, and calls `WorkspaceDO.alert()` with the bytes; the shard
(`src/alert-intake.ts`) checks the secret's hash, the source's header and the provider's signature, then holds the
source to `ALERT_LIMIT`, normalizes the payload and runs `alert.ingest` as `sys_alerts`, which routes each alert and
opens incidents through `incident.declare`. Refused requests are counted apart (`ALERT_REFUSED_LIMIT`). The three
limits are Workers Rate Limiting (wrangler.jsonc, one namespace per environment: `4111`/`4121`/`4131` production (the
top-level config, also what local runs use), `4113`/`4123`/`4133` dev, `4112`/`4122`/`4132` staging), and over one is `503` with `Retry-After`. Every refusal is the
same 404; an unreadable payload is accepted and pages through the default route. To try one locally after creating a generic
source in the dashboard:

```bash
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"title":"Disk almost full on web-1","dedup_key":"disk-web-1","severity":"high"}' \
  http://localhost:5173/api/alerts/<token>
```

## Ended sessions

RFC 0004 "Session revocation" (`src/session-end.ts`). Every session that ends is written to D1's `session_end`, one
row per workspace of its user, before Better Auth deletes it (`migrations/0012_session_end.sql`: apply it before
deploying, or every sign-out answers `503 SIGN_OUT_FAILED`). The session hook then has each shard close the session's
sockets and take the phone that signed out off the member's devices, deleting the row of each that did. What is left
(a shard unreachable for all 3 tries) is acted on by the shard before a phone registers in it and after its next sync
upgrade, or by the cron (every minute, rows older than a minute; dropped after 30 days). The same cron deletes
rate-limit counters past every window once an hour (minute 23).

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

## Deploying dev

The `dev` environment (`brigade-api-dev`, `brigade-web-dev`, `brigade-relay-dev`) is for testing on a real phone.
The dashboard Worker has a public URL, `https://brigade-web-dev.<subdomain>.workers.dev`, and so does the relay
(`brigade-relay-dev`, bearer token on every send); the API Worker has none. `<subdomain>` is the account's
workers.dev subdomain, which names the account, so it is never committed (code, docs, fixtures, `eas.json`).
The API needs nothing for that origin: Better Auth takes its base URL from the request (the web Worker forwards the
browser's URL), trusts its own origin and the app's `brigade://`, and sets `Secure` cookies over HTTPS. No
`BETTER_AUTH_URL` or cookie domain is set.

In order, from `apps/api` unless noted:

1. **Migrations.** `wrangler d1 migrations apply DB --remote --env dev` (every file in `migrations/` not yet
   applied to `brigade-db-dev`).
2. **API secrets**, each with `wrangler secret put <NAME> --env dev`:

   | Secret               | Needed for                                                                                                                                                                                                                                                                                                                                                                    |
   | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `BETTER_AUTH_SECRET` | Required: sessions (`openssl rand -base64 32`)                                                                                                                                                                                                                                                                                                                                |
   | `RELAY_SEND_TOKEN`   | Push: the relay's send token (apps/relay); without it every page is recorded as failed                                                                                                                                                                                                                                                                                        |
   | `DASHBOARD_URL`      | Links in emails and Slack: `https://brigade-web-dev.<subdomain>.workers.dev`                                                                                                                                                                                                                                                                                                  |
   | `EMAIL_FROM`         | Optional: the email sender ("Email" above); without it no email goes out, so addresses cannot be verified or passwords reset                                                                                                                                                                                                                                                  |
   | `SLACK_TOKEN_KEY`    | Optional until Slack: seals bot tokens ("Slack" below)                                                                                                                                                                                                                                                                                                                        |
   | `WEBHOOK_SECRET_KEY` | Optional: seals webhook signing secrets ("Webhooks" below, `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d =`); without it webhooks are off                                                                                                                                                                                                                               |
   | `DEAD_MAN_URL`       | Optional: the external dead-man check's ping URL ("Dead-man switch" above)                                                                                                                                                                                                                                                                                                    |
   | `MAX_MONITORS`       | Optional: the most monitors any workspace may have on this instance, 1 to 10000 (default 100); owners can set a lower cap for their workspace (RFC 0007 "Limits"). Not secret, but set like the others: no environment has `vars`                                                                                                                                             |
   | `API_TOKEN_KEY`      | Optional: the HMAC key API tokens are hashed under ("API tokens" below, `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d =`); without it they are hashed with SHA-256 alone. Setting it later keeps every token: one minted without it is found by its SHA-256 once and its row moved to the keyed digest. Changing or removing it invalidates every token hashed under it |

   No `RELAY_URL`: the `dev` environment reaches `brigade-relay-dev` through its `RELAY` service binding
   (wrangler.jsonc). A Worker's fetch to another workers.dev Worker on the same account is answered 404, so the
   relay's public URL only works from outside the account (a phone, `curl`, a self-hosted instance); a `RELAY_URL`
   secret left from before is ignored while the binding is there. Deploy the relay before the API: a binding to a
   Worker that does not exist fails the deploy.

3. **API.** `vp run build:dev`, then `wrangler deploy` (the built config already names `brigade-api-dev`).
4. **Web**, from `apps/web`: `vp run build:dev`, then `wrangler deploy`. It needs no secrets; its `dev` environment
   turns on `workers_dev`.
5. **Slack**, later: integrations/slack/README.md, then add the `SLACK` binding to apps/web's `dev` environment and
   deploy the web Worker again.
6. **Exports and AI drafts** (RFC 0013), optional (done for `dev`: `brigade-exports-dev` with its lifecycle rule, and
   both bindings): without them the dashboard hides exporting and "Draft with AI", and
   their routes answer 503. Paging needs neither. From `apps/api`:

   ```bash
   wrangler r2 bucket create brigade-exports-dev
   wrangler r2 bucket lifecycle add brigade-exports-dev expire-exports workspaces/ --expire-days 8 --force
   wrangler r2 bucket lifecycle list brigade-exports-dev
   ```

   The rule deletes every object under `workspaces/` 8 days after it was written, a day after the cron's sweep would
   have (`--force` skips the confirmation prompt); `list` should show `expire-exports` with that prefix and 8 days.

   then add to `env.dev` in `wrangler.jsonc`:

   ```jsonc
   "r2_buckets": [{ "binding": "EXPORTS", "bucket_name": "brigade-exports-dev" }],
   "ai": { "binding": "AI" },
   ```

   run `vp run cf-typegen` (it adds `AI: Ai` to `worker-configuration.d.ts`), commit both files, and deploy the API
   again (step 3). Leave the bucket private: no public access, no custom domain, no `r2.dev` URL. Files are only read
   back through `GET /workspaces/:id/exports/:exportId`. Workers AI bills the account per use ("Postmortem drafts"
   below).

A mobile build points at the dashboard's origin with `EXPO_PUBLIC_BRIGADE_URL`
(`https://brigade-web-dev.<subdomain>.workers.dev`, no path), read at build time (apps/mobile/README.md). Set it in
a gitignored `apps/mobile/.env.local` for a local build, or as an EAS environment variable for an EAS build; never in
`eas.json` or anything committed. The app signs in against `/api/auth` and syncs over `wss://` on that origin.

## Slack

RFC 0011. The Slack Worker (`integrations/slack`) binds to this Worker's `SlackBridge` entrypoint
(`src/slack-bridge.ts`, exported from `src/index.ts`): it reads D1 (`slack_team`, which workspace a Slack team is;
members by verified email and their roles), asks Slack who a user is (`users.info`, with the bot token it opens; the
Slack Worker never gets a token) and runs everything else in the workspace's shard (`src/slack.ts`): one-time
install states, `incident.declare` and `incident.ack` as the member a Slack user maps to (client id `slack`, the same
RBAC and events as the dashboard), and `slack.connect`. `POST /workspaces/:id/slack/install` starts an install for an
owner or admin. The `queue` handler posts and updates each incident's channel message next to push
(`src/notify-slack.ts`, with the renderer and Web API client from `@freecorps/brigade-slack/notifier`), idempotent per
event through the shard's Slack ledger, retried with backoff or Slack's `Retry-After`, and recorded as a `slack_failed`
timeline entry when it gives up. A page never waits on it: Slack gets at most `SLACK_BUDGET_MS` (3 s) per event in
a batch, past which the message is retried for Slack's sake.

Bot tokens are sealed with AES-256-GCM under `SLACK_TOKEN_KEY` (optional secret, 32 bytes base64url;
`src/slack-token.ts`) before the shard stores them; without the key Slack is off. Setup: integrations/slack/README.md.
`migrations/0006_slack_team.sql` is not applied to any deployed database yet.

## Status page

RFC 0012. `PUT /workspaces/:id/status-page` claims the slug in D1 (`migrations/0008_status_slug.sql`) and sets the
page up in the shard (`src/status-page.ts`); components and published updates are sync mutations. Every change to the
page marks its snapshot dirty in the same transaction, and the shard's alarm pushes the sanitized JSON to the `STATUS`
KV namespace (`status:<slug>`), retrying with backoff. `GET /status/:slug` (`src/status-route.ts`, forwarded unchanged
by the web Worker) renders it as HTML (`src/status-html.ts`) from KV behind the edge cache; it needs no session and
never reaches a shard.

`STATUS` is bound at the top level without an `id`, for local runs and the tests, and in `dev` to `brigade-status-dev`.
`staging` has no binding yet: its pages answer 404 while the dashboard still sets them up. To turn it on for an
environment (owner's call for staging and production), as was done for `dev`:

```bash
wrangler kv namespace create brigade-status-dev     # in apps/api; prints the namespace id
```

then add `"kv_namespaces": [{ "binding": "STATUS", "id": "<that id>" }]` to `env.dev` in `wrangler.jsonc` (the same
with `brigade-status-staging` for `staging`, and give production's top-level entry its `id` with `brigade-status`
before its first deploy, or wrangler provisions a namespace on its own), and apply `migrations/0008_status_slug.sql`
to the environment's database. `migrations/0008_status_slug.sql` is applied to `brigade-db-dev` only.

Email subscriptions, uptime bars and scheduled maintenance (RFC 0012, slice 2): visitors subscribe through
`POST /status/:slug/subscribe` and confirm, manage and unsubscribe through `/status/:slug/confirm|manage|unsubscribe`
(`src/status-subscribers.ts`); subscribers are in D1 (`migrations/0009_status_subscriber.sql`, and the per-page domain caps in
`migrations/0010_status_confirmation_caps.sql`), the links are signed
with a key derived from `BETTER_AUTH_SECRET`, and the emails go out from the queue consumer (`src/notify-status.ts`,
the shard's ledger in `src/status-mail.ts`) with links on `DASHBOARD_URL`. The form shows only where email is set up
(`EMAIL_FROM`, or `EMAIL_LOG=1` under `vp run dev`, where each email is logged with its links). Subscribing is
rate-limited by `STATUS_SUBSCRIBE_IP_LIMIT` and `STATUS_SUBSCRIBE_PAGE_LIMIT` (Workers Rate Limiting, namespaces
4161-4163 and 4171-4173, one per environment). Pending subscribers who never confirm are deleted by the cron at minute
37 of every hour, 48 hours after they asked. Apply `migrations/0009_status_subscriber.sql` and
`migrations/0010_status_confirmation_caps.sql` with 0008 wherever the page is turned on (owner's call); they are not
applied anywhere yet. Following components (RFC 0012 "Following components") adds `migrations/0013_status_follows.sql`
(a nullable `follows` column, so every existing row keeps getting everything): apply it with the others, before a
deploy that includes it, since the subscribe, manage and notification queries read the column.

## Webhooks

RFC 0005 "Outbound webhooks". Owners and admins register endpoints on the dashboard's Webhooks card (at most 20 per
workspace). `POST /workspaces/:id/webhooks` and `POST /workspaces/:id/webhooks/:webhookId/rotate`
(`src/webhook-routes.ts`) make the signing secret (`whsec_…`), seal it with AES-256-GCM under `WEBHOOK_SECRET_KEY`
(optional secret, 32 bytes base64url; the same sealing as Slack's tokens, bound to the workspace and the endpoint)
and run `webhook.create` / `webhook.rotateSecret` in the shard as the member; the answer is the only time the secret
is shown. Edits, on and off, delete and "Send test event" are mutations over sync. Without the key, creating answers
503 `not_configured` and nothing is delivered.

The queue consumer delivers (`src/notify-webhooks.ts`): the shard's ledger (`src/webhooks.ts`) plans each event's
endpoints and keeps the payload, the consumer signs it (Standard Webhooks, `src/webhook-sign.ts`), POSTs it under the
monitors' target rules plus https only (no redirects followed, 5 s, at most 1 KB of the answer read) and reports back.
Retries: 30 s, 2 min, 10 min, 1 h, 4 h, then given up. A page never waits on it: webhooks get at most
`WEBHOOK_BUDGET_MS` (3 s) per event in a batch, like Slack. An endpoint failing for a day (10 attempts or more) is
turned off, and its owners are emailed. Locally, an endpoint must be a public https URL (a tunnel to a local
receiver works); pass `WEBHOOK_SECRET_KEY` from the shell to try it under `vp run dev`
(`WEBHOOK_SECRET_KEY=… vp run dev`, like the other optional secrets above).

## Postmortem drafts

RFC 0013. `POST /workspaces/:id/incidents/:incidentId/postmortem/draft` (`src/postmortem.ts`) has the shard mark a
draft pending (`postmortem.requestDraft`, 20 a day per workspace) and answers 202. It then asks Workers AI
(`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, `AI_MODEL`) in `waitUntil`, with at most 25 s, and writes the draft
through `postmortem.writeDraft` as `sys_ai`. The model reads the incident, its timeline's changes and updates and its
follow-ups, with members by name. It never reads addresses, devices or deliveries. A draft costs under one cent. The
`AI` binding is in no environment yet: add `"ai": { "binding": "AI" }` to an environment ("Deploying dev", step 6).
Locally, the binding would call the real Workers AI on your account, so leave it out of the top level; the tests use a
fake model.

## API tokens

RFC 0014. Owners and admins mint tokens in the dashboard's API tokens card (`POST /workspaces/:id/api-tokens`, cookie
only, `src/api-tokens.ts`): the token (`brg_` and 32 random bytes, base64url) is answered once, and D1's `api_token`
(`migrations/0011_api_token.sql`) keeps only its HMAC-SHA-256 under `API_TOKEN_KEY` (or its SHA-256 without one; a token minted before the key was set
is found by its SHA-256 on its next use and its row moved to the HMAC).
Requests send it as `Authorization: Bearer`; the Worker looks the digest up (the row cached 10 s per isolate), reads
the creator's membership and role in D1, and hands the shard a `token` actor. Each token is limited to 300 requests a
minute (`API_TOKEN_LIMIT`, namespaces 4141, 4142 staging, 4143 dev) and its last use is written at most every 5
minutes. `DELETE /workspaces/:id/api-tokens/:tokenId` revokes one: D1 first, then the shard, which refuses it at once
and closes its sockets. For GitHub secret scanning, add a custom pattern `brg_[A-Za-z0-9_-]{43}` (RFC 0014 "The
token").

## Exports

RFC 0013. `POST /workspaces/:id/exports` (owners and admins; `src/exports.ts`) has the shard take one of the
workspace's 10 exports an hour (429 `rate_limited` past it) and build the JSON file one incident at a time, counting
bytes and stopping at 25 MiB (413 `too_large`), yielding between parts so escalations never wait on it. The Worker
streams the parts into the `EXPORTS` R2 bucket at `workspaces/<workspace id>/exports/<exp id>.json`, and has the shard
record it (`export.record`, event `workspace.exported`). `GET /workspaces/:id/exports/:exportId` streams it back to an
owner or admin of that workspace. Files expire after 7 days: a download after that answers 410 and deletes the file,
and the cron sweeps the files uploaded more than 7 days ago hourly (minute 17, paging through the bucket for at most
20 s). The lifecycle rule above (8 days) is the backstop. `EXPORTS` is bound at
the top level without a bucket name, for local runs and the tests (Miniflare simulates it). `dev` gets
`brigade-exports-dev` with step 6 of "Deploying dev". Staging and production need their own bucket
(`brigade-exports-staging`, `brigade-exports`, owner's call) with the same lifecycle rule. Give production's top-level
entry its `bucket_name` before its first deploy.

## Generated types

`worker-configuration.d.ts` is generated by `wrangler types` (`vp run cf-typegen`) and committed, so type checks
run without network or a Cloudflare login. It is excluded from formatting and linting. Regenerate it after every
change to `wrangler.jsonc` or the compatibility date; `vp run test` runs `wrangler types --check` first
(`vp run cf-typegen:check`) and fails if it is stale.

License: AGPL-3.0-only.
