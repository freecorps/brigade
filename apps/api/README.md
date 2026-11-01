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

**Sign-up** (RFC 0002 "Sign-up modes", `src/sign-up.ts`): the `SIGNUP` variable is `open`, `invite` or `closed`, and
unset (production, staging, a self-hosted instance) is `closed`. Under `invite` and `closed` only an address holding a
pending invitation may sign up; anything else answers `403 SIGN_UP_CLOSED`. An instance without an email sender is
always `closed`, whatever `SIGNUP` says (logged once). `REQUIRE_VERIFIED_EMAIL=true` makes an unverified account's
sign-in answer `403 EMAIL_NOT_VERIFIED` (off by default; ignored without email). `GET /config` (no session) answers
`{ "signUp": "<mode>", "requireVerifiedEmail": <bool> }`, plus `"signUpClosedBy": "no_email"` when `SIGNUP` asked
for more than the instance can do, which the dashboard and the app read to show or hide their sign-up forms.
`EMAIL_DAILY_CEILING` (default 2000) is the most emails the instance sends a day, from every workspace together,
counted in D1's `email_day`; emails about a page that failed are never dropped (RFC 0005 "Abuse"). `dev` sets
`open` in `wrangler.jsonc`, and so do local runs and the tests (`LOCAL_VARS` in `vite.config.ts`). The first account
on a closed instance comes from "First owner" below.

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

Production applies them on its own: `.github/workflows/deploy.yml` runs `wrangler d1 migrations apply DB --remote`
before each API deploy (RFC 0002 "Continuous delivery"). The old API still serves while that runs and until the new
one is live, so a migration keeps it working: add a table or a nullable column now, and drop or rename one only in a
later deploy, once no deployed code reads it.

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

**Relay handles** (RFC 0015 section 7, `src/relay-instance.ts`). A phone may register with a `handle` and `tag` from
the relay (`POST /v1/handles`) instead of raw tokens, `voip` saying whether the handle can ring, or with both while an
instance moves; `envelope: 2` says the app opens envelope version 2. A handle device is paged through `POST /v1/send`,
signed with the instance key (`RELAY_INSTANCE_KEY`, `@freecorps/brigade-push/instance`); a raw-token device through
`POST /send` with `RELAY_SEND_TOKEN`; a device with both goes through `/send` when `/v1/send` refuses the instance.
Pages to a device registered with `envelope: 2` are sealed version 2 (`sealPushV2`: the dashboard's origin from
`DASHBOARD_URL`, the urgency, and the TTL sent to the relay, 15 minutes for a page, an hour for less, 60 s for a call);
version 1 otherwise, or without `DASHBOARD_URL`. The relay's answers: `403 handle_not_yours` (a lost instance key)
drops the handle (`device.expire` with `handleOnly`, by the handle the push went to): a device with a raw token too
keeps it and is paged through `/send` at once (`device.handle_cleared`), one with the handle alone is dropped. A
token the push service calls gone drops the device, by the handle the push went to. `401`, any other `403`
(`instance_revoked`, `instance_unregistered`), `404` (a relay without `/v1`), `500 relay_misconfigured`, `503` and
`400 bad_handle` are the instance's or the relay's, not the phone's (a handle the relay itself minted stops opening
only when its `RELAY_HANDLE_KEYS` lost a key, which on the hosted relay would drop every instance's phones), so they
go through `/send` for a device with a raw token, are retried and never expire anything, and once the retries are
spent the member is recorded as not paged (`notification.failed`, which the email notifier sends on);
`429 rate_limited` is retried after its `Retry-After` (at most 300 s). The tag replaces the token where tokens were
compared: the same tag under a new id replaces the old device. Expiring goes by the handle, not the tag: a phone that
registered again while a push was out has a new handle (a fresh sealing) even for the same token, and is kept. A
call refused as gone stops a handle device ringing (`device.expireVoip` by the handle it went to). Rows are JSON documents in the shard
(`src/store.ts`), so the new fields (`handle`, `tag`, `voip`, `envelope`; `pushToken` null for a handle alone) need
no migration. `GET /config` gives the app `brigade { api, minApp }` and, with the instance key and a public
`RELAY_URL`, `relay { origin, instance, app? }` (`RELAY_APP_URL`, an own app build's store link), so it can mint
handles for this instance.

**Rotating the instance key** (RFC 0015 section 1). The instance id comes from the first key and never changes; every
handle is sealed for it. After a rotation (`POST /v1/instances/keys` on the relay, signed with the old key), set the
new key as `RELAY_INSTANCE_KEY` **and** the first id as `RELAY_INSTANCE_ID` (`ins_…`, what `GET /config` showed as
`relay.instance` before): the API signs as that id and `/config` keeps giving it. Without `RELAY_INSTANCE_ID` the id is
the one the key gives, which after a rotation is another instance's, for which no handle was sealed: every page would
be answered `handle_not_yours`, dropping the phones' handles. Retire the old key on the relay only once the new
secrets are deployed. A malformed `RELAY_INSTANCE_ID` disables the key (logged; the watchdog says
`relay_bad_signature`).

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
(`workspace.setEmail`, owners and admins; a member can turn their own missed-page email off with `member.setEmail`,
never the owners' one):

- **A member a page missed** (no phone, every push failed, Android, no relay, the device cap): SEV1 and SEV2 only,
  once per incident.
- **The owners, when nobody could be paged**: a page that settled having reached nobody, when nothing else will page
  on its own (no escalation run, or the last page of a run that ended).

Neither once the incident is acknowledged or resolved. A failed send is retried (30 s, 1, 2, 4 minutes); after 5
attempts, or at once when the service refuses the message or address, it is an `email_failed` timeline entry and a
`notification.failed` with `channel: "email"`. Push never waits on any of this: email only acts on failures push
already recorded, and a page in the same batch is handled in parallel.

The same path sends the daily reminder of follow-ups due (RFC 0013 "Reminders", `src/notify-reminder.ts`): the shard's
alarm emits `follow_up.reminder_due` at 09:00 on each owner's clock (else UTC), at most once a day, and the consumer
sends it with the same ledger, caps and retries.

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
`proveHeartbeat` instead of a shard: it asks the relay's `GET /health?deep=1` with the send token (`401` refused; an
answer naming `apns` proves the token and says whether APNs took the relay's provider token and FCM gave it an access
token, without a push; a relay without the deep check falls back to `POST /send` with no body, `400 invalid_body`
accepted), reads D1 once (`select 1`, 3 s), and reports to `WatchdogDO.proved()`, which pings `DEAD_MAN_URL`
(in `waitUntil`, 5 s timeout) when the beat is the newest yet, took at most 2 minutes, the relay took the token and
no deeper check (APNs, FCM, D1) failed: a refused key or account at once, a transient failure (a timeout, a 5xx, a D1
read) only on the 3rd proved beat in a row (`TRANSIENT_FAILURES_TO_DEGRADE`). With `RELAY_INSTANCE_KEY` it asks the
relay's signed `GET /v1/health?deep=1` instead (RFC 0015): `401` is `relay_bad_signature` (a key that does not read
too, without asking), `403` `relay_instance_unregistered` or `relay_instance_revoked`, `429` `relay_rate_limited`, an
answer with `handles: false` `relay_handles_unavailable`; a relay without `/v1` (`404`) is `relay_handles_unavailable`, with the send
token's old check for the providers (and its reasons) when there is one. With the send token set too, its check (`POST /send`, no body) runs beside the signed one
and both reasons count, since raw-token phones still page through `/send`. `429` counts only from its 3rd proved beat
in a row (the relay limits the signed check per caller IP, and instances on Workers may share egress addresses, Q28). The external check
(any service or self-hosted checker that alerts on a missed URL ping; period 1 minute, grace about 5) pages the
operators when the pings stop.

`GET /health/paging` answers `{ status }` without a session (or to a user in no workspace); `{ status, reasons,
lastBeatAt, lastProvedAt, lastOkAt, relay }` to a member; never `external` (operators read the logs). `relay` is which
relay pages go through, `{ kind: "none" | "freecorps" | "own", host, app }` (`relaySetup` in src/relay-instance.ts,
RFC 0015 section 8): the dashboard's "Phones and pages" and "Use the app".
`degraded` after 3 minutes with no beat (`no_beat`), with the newest proved beat older than 3 minutes
(`pipeline_stalled`), with the last proof over 2 minutes late (`pipeline_slow`), or with the relay
`relay_unauthorized`, `relay_unreachable` or `relay_not_configured` (or one of the signed check's reasons above) on
the last proof, or with `apns_failing`,
`fcm_failing` or `d1_failing` from its deeper checks; `unknown` before the first proof. The dashboard shows a notice
while it is not `ok`. Changes of status or reasons write `brigade.status_changed` and log `paging pipeline degraded`;
the watchdog emails each to `OPERATOR_EMAILS` (comma-separated, at most 10 addresses, in English) as it happens, not
through the Queue it may be reporting stalled, and tries a failed one again on the next beats (5 times). At most 6
changes an hour, never in a page's way (`src/notify-operators.ts`).

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

Production deploys from CI: `.github/workflows/deploy.yml`, after CI passes on `main`, deploys the relay, this
Worker and the dashboard when their code, or a package they bundle, changed (RFC 0002 "Continuous delivery"). Run it
by hand (Actions, Deploy, "Run workflow") to deploy `dev` or every Worker. It needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the GitHub environment of the same name. The steps below are for a first deploy, or
without CI.

Local secrets go in `apps/api/.dev.vars` (`.dev.vars.<env>` per environment), which is gitignored. Their names
come from `secrets.required` in `wrangler.jsonc`, so `wrangler types` no longer reads `.dev.vars` and the committed
types stay the same with or without one.

## Self-host setup

A new self-hosted instance is one Cloudflare account and the top-level (production) config of each `wrangler.jsonc`.
Before its first deploy, from `apps/api`, create the resources the API binds and put their ids at the top level of
`wrangler.jsonc` (the setup wizard will run these steps; until then they are by hand):

```bash
wrangler d1 create brigade-db                  # its id goes in d1_databases (DB); then apply migrations/ (--remote)
wrangler queues create brigade-events
wrangler queues create brigade-events-dlq
wrangler kv namespace create brigade-status    # the status pages' snapshots: its id goes in kv_namespaces (STATUS)
```

The `STATUS` KV namespace is part of the setup (decided, Q23; RFC 0012 "The snapshot"): without it every status page
answers 404 while the dashboard still sets them up. Give the top-level `STATUS` entry its `id`, or `wrangler deploy`
provisions a namespace of its own. Exports need a bucket too (`wrangler r2 bucket create brigade-exports` and the
lifecycle rule in "Deploying dev" step 6, its name in `r2_buckets`). The production build (`vp run build`) adds two
bindings the top level leaves out because local runs and the tests use it (vite.config.ts `PRODUCTION_BINDINGS`):
`RELAY`, the relay Worker `brigade-relay` on the same account, and `AI`. An instance using another relay removes
`RELAY` there and sets the `RELAY_URL` secret. Then set the secrets ("Deploying dev" lists them), deploy the relay
(only for your own relay), the API and the dashboard, create the first owner ("First owner"), and choose how phones
are paged ("Push relay").

## Push relay

Phones are paged through a push relay (RFC 0006, RFC 0015): APNs and FCM accept a push only when it is signed with the
keys of whoever published the app, so the instance hands every page, sealed for the phone, to a relay that holds them.
There are two, running the same `apps/relay` code and `/v1` protocol:

- **Freecorps' relay** (recommended). Pages the Brigade app from the App Store and Google Play: no app to build, no
  Apple or Google account. The instance registers with it once: accept its terms (a preliminary template for now,
  [docs/legal/relay-terms.md](../../docs/legal/relay-terms.md), version `draft-2026-11`) and confirm a contact
  address with an emailed code. The relay never reads a page; its limits are 600 sends a minute per instance (RFC 0015
  D4).
- **Your company's own relay.** No third party on the paging path, at a price: **only the company's own app build can
  be paged through it**, never the store app. It needs an Apple Developer account with an APNs key (`.p8`, key id,
  team id), a Firebase project and its service account JSON, the bundle id of the company's build, and a hostname on a
  zone of the same Cloudflare account for the relay. Then the app is the company's to build and publish
  (apps/mobile README "Your own app").

Without either, no phone is paged; pages reach people by email only if the API can send email (`EMAIL_FROM`, see
"Email"). With Freecorps' relay, phones are paged once they run an app release that asks the relay for handles (RFC
0015 step 4): the app as released today registers raw device tokens, which Freecorps' relay takes only from Freecorps'
own instance (`RELAY_SEND_TOKEN`).

`vp run setup:relay` (from the root; `apps/relay/scripts/setup-relay/`) sets either up, and can be run again later.
Log in to wrangler first (`wrangler login`, or `CLOUDFLARE_API_TOKEN`); `--env dev` or `--env staging` picks the
Workers of that environment (default production). It asks which relay, then:

- **Freecorps' relay:** shows the terms' address and version and asks to accept them; asks for the contact address and
  has the relay email it a code (valid 15 minutes, 5 tries, 3 an hour); makes the instance key and saves it **outside
  the repository** (symlinks resolved), readable only by you (`~/.config/brigade/relay-instance-key-<worker>-<instance
  id>`, or `--key-out`); asks for the code and registers (`POST /v1/instances`); sets `RELAY_INSTANCE_KEY` and
  `RELAY_URL` on the API Worker; and runs the relay's signed deep health, which shows only that **Freecorps' relay is
  reachable and this instance is registered**. **Required afterwards:** the production build binds `RELAY` to
  `brigade-relay` (vite.config.ts `PRODUCTION_BINDINGS`; dev and staging: `services` in wrangler.jsonc), and the API
  sends through that binding before `RELAY_URL`, to a relay that does not know this instance: remove it and deploy the
  API again. The script reads those files and says when the binding is there. **Freecorps' relay has no public address
  yet** (docs/open-questions.md Q31): pass it with `--relay-url` (or `BRIGADE_RELAY_URL`); without it the script stops
  and says so.
- **Your own relay:** says first that only the company's build can be paged, checks the prerequisites (and stops if any
  is missing; the APNs key must be an EC P-256 key and the service account's an RSA key, checked locally), then:
  1. reads the relay Worker's secret names. A Worker that exists but was not set up by this script (no
     `BRIGADE_OWN_RELAY` secret; Freecorps' own relay, say) is refused unless `--take-over-relay`. If wrangler cannot
     list them for any reason but "this Worker does not exist" (Cloudflare error 10007), the script stops, since new
     handle keys would void every phone's handle; `--assume-new-relay` goes on anyway;
  2. builds `apps/relay` and sets its secrets: `BRIGADE_OWN_RELAY`, a new `RELAY_ADMIN_TOKEN`; `APNS_KEY`,
     `APNS_KEY_ID`, `APNS_TEAM_ID` and `FCM_SERVICE_ACCOUNT` unless the relay has them, which are kept unless
     `--replace-credentials` (or yes to the question; wrong ones stop every page through it); and `RELAY_HANDLE_KEYS`,
     `RELAY_TAG_KEY` and `RELAY_SEND_TOKEN` only if the relay has none;
  3. deploys it as `brigade-relay` (`brigade-relay-dev` for `--env dev`; the relay has no staging) with `APNS_TOPIC`
     the bundle id, `RELAY_REGISTRATION=closed` and the hostname as its custom domain, and waits for the domain (10 s
     apart, at most 5 minutes);
  4. registers the instance with the admin token (no terms, no email);
  5. then, one right after the other: deletes the admin token from the relay (with the relay's new send token if it
     needed one), and sets `RELAY_INSTANCE_KEY`, `RELAY_URL`, `RELAY_SEND_TOKEN` (the relay's, for phones that still
     register raw tokens), `RELAY_KIND=own` (what tells the dashboard's "Phones and pages" this is an own relay) and
     the store link (`RELAY_APP_URL`, optional) on the API.

  **The send token.** Only secret names can be read, so a shared marker, `BRIGADE_SEND_PAIR_<id>`, set on the relay
  and the API in the same step as their token, is what shows the two tokens are the same. With the same marker on
  both, the token is kept, so a rerun opens no gap. Otherwise (no marker, different ones, a run that stopped in
  between, a token set by hand) both get a new token and marker, one right after the other, after the registration.
  Change `RELAY_SEND_TOKEN` by hand only on both Workers, and delete their markers then. A run that stops before step
  5 leaves the API as it was. The API reaches the relay through the `RELAY` binding the production build already has
  (dev: `services` in wrangler.jsonc): build and deploy the API again.

- **Not now:** changes nothing.

**Switching relays**, or setting one up again, gives the instance a new key and id: every handle phones hold stops
working and **every phone must open the app once** to be paged again; a switch to an own relay also leaves the store
app unable to page at all. Whenever the API already has `RELAY_INSTANCE_KEY`, the script says so and asks again
(`--yes` without questions), even with `--instance-key-file`: it can read only secret names, so it cannot prove the
key is the one set. Whenever it installs a key it also removes `RELAY_INSTANCE_ID`: it registers and checks the key as
the id the key gives, so a leftover id (from a rotation, or a key deleted by hand) would make the API sign as another
instance. A switch to Freecorps' relay also removes `RELAY_KIND` and `RELAY_APP_URL` and, with them (either marks an
own relay), the own relay's `RELAY_SEND_TOKEN`; an API with neither keeps its send token. Keep the saved key in a password
manager and delete the file: a lost key is the same as a switch. `--instance-key-file` reuses a saved key, to finish a
run that stopped (a code that expired, secrets wrangler could not set) without a new id.

**`RELAY_KIND`** is `own` or unset, nothing else: the script can read only secret names, so it takes any value as an
own relay (and a switch to Freecorps' relay then drops the API's send token), and the API agrees. **An own relay set
up before the script set `RELAY_KIND`** (and with no app link) shows on the dashboard as Freecorps' relay, and its
members are told to install the store app, which it cannot page: set it by hand, `wrangler secret put RELAY_KIND`
(value `own`) in apps/api, which changes nothing else; or run `vp run setup:relay` again (choice "your own relay")
with `--instance-key-file` and the key you saved, so the instance keeps its id and phones their handles.

Secret values never appear on the screen, in a command's arguments or in a file in the repository: wrangler gets them
on stdin (`wrangler secret bulk`). Without a terminal, or with `--non-interactive`, every answer is a flag (`vp run
setup:relay -- --help`); Freecorps' relay then takes two runs, the first sending the code and the second, with
`--code` and `--instance-key-file`, finishing:

```bash
vp run setup:relay -- --relay freecorps --relay-url https://<relay> --accept-terms draft-2026-11 \
  --contact oncall@example.com
vp run setup:relay -- --relay freecorps --relay-url https://<relay> --accept-terms draft-2026-11 \
  --contact oncall@example.com --instance-key-file ~/.config/brigade/relay-instance-key-… --code 123456
vp run setup:relay -- --relay own --apns-key-file ~/keys/AuthKey_XXXXXXXXXX.p8 --apns-key-id XXXXXXXXXX \
  --apns-team-id XXXXXXXXXX --bundle-id com.example.brigade --fcm-service-account-file ~/keys/fcm.json \
  --relay-domain relay.example.com [--app-url https://apps.apple.com/…]
```

## First owner

A new instance has sign-up closed, so its first owner comes from a one-time, server-side path (RFC 0002 "The first
owner", `src/bootstrap.ts`): `POST /setup/first-user`, which exists only while the `BOOTSTRAP_TOKEN` secret is set,
takes it as `Authorization: Bearer`, and refuses once any user exists. From the repository root:

```bash
export BOOTSTRAP_TOKEN="$(openssl rand -base64 32)"                # 44 characters, only in this shell
printf %s "$BOOTSTRAP_TOKEN" | (cd apps/api && wrangler secret put BOOTSTRAP_TOKEN)   # add --env for dev or staging
vp run setup:first-user -- --url https://brigade.example.com
(cd apps/api && wrangler secret delete BOOTSTRAP_TOKEN); unset BOOTSTRAP_TOKEN        # done: the route is gone
```

`--url` is the dashboard's origin (HTTPS; plain HTTP only for localhost). By default the owner is
`owner@<that host>`, named "Owner", in a workspace named "Brigade"; `--email`, `--name` and `--workspace` choose
otherwise. The script generates a strong password and prints the address and password once: the API stores only
Better Auth's hash, so keep it in a password manager. The address is marked verified. Others join through
invitations (closed and `invite` instances let an invited address sign up). Locally (`vp run dev`, sign-up open)
none of this is needed; to try it, run `SIGNUP=closed BOOTSTRAP_TOKEN=… vp run dev` (apps/web's Vite config passes both from the shell) on an
empty local D1, then the script with `--url http://localhost:5173`.

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
   | `RELAY_INSTANCE_KEY` | Optional: the instance's Ed25519 key (PKCS#8, base64url; RFC 0015), for phones registered with relay handles (`/v1/send`) and the signed deep check; set by `vp run setup:relay` ("Push relay")                                                                                                                                                                               |
   | `RELAY_INSTANCE_ID`  | Optional: the instance's first id on the relay (`ins_…`), set after a key rotation ("Rotating the instance key" above)                                                                                                                                                                                                                                                        |
   | `RELAY_APP_URL`      | Optional: an own app build's store link, given to the app in `GET /config` (`relay.app`, RFC 0015 section 8)                                                                                                                                                                                                                                                                  |
   | `RELAY_KIND`         | Optional: `own` on an own relay (set by `vp run setup:relay`), so the dashboard says so; unset otherwise ("Push relay")                                                                                                                                                                                                                                                       |
   | `DASHBOARD_URL`      | Links in emails and Slack: `https://brigade-web-dev.<subdomain>.workers.dev`                                                                                                                                                                                                                                                                                                  |
   | `EMAIL_FROM`         | Optional: the email sender ("Email" above); without it no email goes out, so addresses cannot be verified or passwords reset                                                                                                                                                                                                                                                  |
   | `SLACK_TOKEN_KEY`    | Optional until Slack: seals bot tokens ("Slack" below)                                                                                                                                                                                                                                                                                                                        |
   | `WEBHOOK_SECRET_KEY` | Optional: seals webhook signing secrets ("Webhooks" below, `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d =`); without it webhooks are off                                                                                                                                                                                                                               |
   | `DEAD_MAN_URL`       | Optional: the external dead-man check's ping URL ("Dead-man switch" above)                                                                                                                                                                                                                                                                                                    |
   | `OPERATOR_EMAILS`    | Optional: the instance operators' addresses, comma-separated, emailed when the paging self-check changes status ("Dead-man switch" above); needs `EMAIL_FROM`                                                                                                                                                                                                                 |
   | `MAX_MONITORS`       | Optional: the most monitors any workspace may have on this instance, 1 to 10000 (default 100); owners can set a lower cap for their workspace (RFC 0007 "Limits"). Not secret, but set like the others: no environment has `vars`                                                                                                                                             |
   | `API_TOKEN_KEY`      | Optional: the HMAC key API tokens are hashed under ("API tokens" below, `openssl rand 32 \| base64 \| tr '+/' '-_' \| tr -d =`); without it they are hashed with SHA-256 alone. Setting it later keeps every token: one minted without it is found by its SHA-256 once and its row moved to the keyed digest. Changing or removing it invalidates every token hashed under it |

   No `RELAY_URL` for paging: the `dev` environment reaches `brigade-relay-dev` through its `RELAY` service binding
   (wrangler.jsonc). A Worker's fetch to another workers.dev Worker on the same account is answered 404, so the
   relay's public URL only works from outside the account (a phone, `curl`, a self-hosted instance); a `RELAY_URL`
   secret is not used for calls while the binding is there, only as the relay address `GET /config` gives the app
   (with `RELAY_INSTANCE_KEY`, so phones can mint handles). Deploy the relay before the API: a binding to a
   Worker that does not exist fails the deploy.

3. **API.** `vp run build:dev`, then `wrangler deploy` (the built config already names `brigade-api-dev`). `dev`
   has `SIGNUP` `open` in `wrangler.jsonc`, so anyone signs up there; production and staging leave it unset
   (`closed`), and their first owner comes from "First owner" above. To change an environment's mode, set its
   `vars.SIGNUP` in `wrangler.jsonc` and deploy.
4. **Web**, from `apps/web`: `vp run build:dev`, then `wrangler deploy`. It needs no secrets; its `dev` environment
   turns on `workers_dev`.
5. **Slack**, later: integrations/slack/README.md, then add the `SLACK` binding to apps/web's `dev` environment and
   deploy the web Worker again.
   Custom domains for status pages, optional and later ("Custom domains" below): after the API, from
   `apps/status-edge`, `vp run build:dev`, then `wrangler deploy` (`brigade-status-edge-dev`), then its route.
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

RFC 0012. `PUT /workspaces/:id/status-page` claims the slug in D1 (`migrations/0008_status_slug.sql`) when the page
is public (a draft's slug is kept on the page alone until it first goes public) and sets the page up in the shard
(`src/status-page.ts`); components and published updates are sync mutations. Every change to the
page marks its snapshot dirty in the same transaction, and the shard's alarm pushes the sanitized JSON to the `STATUS`
KV namespace (`status:<slug>`), retrying with backoff. `GET /status/:slug` (`src/status-route.ts`, forwarded unchanged
by the web Worker) renders it as HTML (`src/status-html.ts`) from KV behind the edge cache; it needs no session and
never reaches a shard. An address with no page counts against the caller in `STATUS_MISS_LIMIT` (Workers Rate
Limiting, 30 a minute per address, namespaces 4181-4183): past it the answer is a 429. A page that exists is never
counted. A snapshot older than 48 hours says the page may be out of date.

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

## Custom domains

RFC 0012 "Custom domains". Optional: a status page served at a workspace's own domain, in either of two ways, or
both:

- **Cloudflare for SaaS custom hostnames**: any domain an owner points a CNAME at. For an instance that serves other
  people's domains; it needs a zone of its own (below).
- **Dedicated hostnames** ("Dedicated hostnames" below): a few hostnames the operator attaches to the edge Worker
  themselves, such as `status.example.com` beside a dashboard at `brigade.example.com`. For an instance a company runs
  for itself; no extra zone, token or Cloudflare API call.

The API keeps the domains (`src/status-domain.ts`, the Cloudflare client in `src/status-domain-cf.ts`, the dedicated
hostnames' check in `src/status-domain-edge.ts`, the alarm's re-checks in `src/status-domain-check.ts`) and renders
the page for the edge (`src/status-pages.ts`, the `StatusPages` entrypoint); a separate Worker,
`brigade-status-edge` ([apps/status-edge](../status-edge/README.md)), takes the custom hostnames' traffic. The API
Worker's own `fetch` never serves a custom hostname. Both ways need `DASHBOARD_URL` (already set for email links; its
hostname is never a page's) and **D1** `migrations/0015_status_custom_host.sql` (which workspace holds each
hostname). Nothing here runs on its own, and Brigade never creates these resources.

### Cloudflare for SaaS

Off until all of these exist; the setup wizard will do the same steps:

1. **A zone of its own for Cloudflare for SaaS** on the instance's account, with Cloudflare for SaaS enabled. Never
   the dashboard's zone or the operator's main zone: step 3 routes every hostname on it (`*/*`) to the edge Worker,
   so any other site on that zone would answer with "No status page here". A spare domain bought for it is enough.
2. **A fallback origin**: a proxied DNS record on that zone, for example `status-origin.example.net` (`AAAA 100::`,
   proxied), set as the zone's fallback origin under Custom Hostnames. Owners point their CNAME at it.
3. **The edge Worker and its route**: deploy the API first, then `apps/status-edge` (its `STATUS` binding takes the
   API's namespace id), then add a Workers route `*/*` on the SaaS zone to `brigade-status-edge` (dashboard: the
   zone's Workers Routes; per environment, `brigade-status-edge-dev` on dev's zone). The route is not in
   `wrangler.jsonc`, so no zone or hostname is in the repository; `wrangler deploy` leaves it alone.
4. **An API token** scoped to "SSL and Certificates: Edit" on that zone alone (custom hostnames need nothing more).
5. **The settings**, each with `wrangler secret put <NAME>` on the API (add `--env` for dev or staging):

   | Secret                    | What                                                     |
   | ------------------------- | -------------------------------------------------------- |
   | `CF_SAAS_TOKEN`           | The token from step 4                                    |
   | `CF_ZONE_ID`              | The zone's id (step 1)                                   |
   | `CF_SAAS_FALLBACK_ORIGIN` | The fallback origin's hostname (step 2), shown to owners |

Owners and admins then add a domain on the dashboard's Custom domain card and create the records it shows; the shard
checks again on its own (pending: from a minute, backing off to hourly, for 7 days; active: daily), and "Check again"
asks at once. Changes and checks are rate-limited per workspace (`STATUS_DOMAIN_LIMIT`, 10 a minute, namespaces
4191-4193). Each active hostname has a `host:<hostname>` key (`{ workspaceId, slug }`) in the `STATUS` KV namespace,
written by the queue consumer and read only by the edge Worker.

A claim the API could not clean up (Cloudflare refused to delete a hostname, or could not say whether it had one) is
kept in `status_custom_host` and logged ("the claim is kept"): the same workspace adopts the hostname on its next add
after 2 minutes; to free the name for another workspace, delete the hostname under Custom Hostnames, then the row.
A domain left pending or failed for more than 7 days is freed on its own: another workspace's add deletes it at
Cloudflare and takes it over (RFC 0012 "Custom domains").

**Turning it off** means removing the `*/*` route (or the edge Worker) as well as the three secrets: with the
secrets gone the dashboard hides the card (unless dedicated hostnames are set), but the route would keep answering
every hostname on the zone. A domain added this way while it was on can then be neither checked nor removed
(`503 not_configured`) until the secrets are back.

### Dedicated hostnames

For each hostname, with its zone active on the instance's Cloudflare account:

1. **Deploy the edge Worker**: the API first, then `apps/status-edge` (its `STATUS` binding takes the API's namespace
   id). CI's deploy workflow does this on a push to `main` that changes it; the first deploy, or one without CI, is
   by hand (apps/status-edge README "Deploying").
2. **Attach the hostname to it as a Custom Domain**: the dashboard's Workers & Pages → `brigade-status-edge` →
   Settings → Domains & Routes → Add → Custom Domain. Cloudflare creates the DNS record and the certificate; the
   hostname must not have a DNS record of its own already. Leave `wrangler.jsonc` without `routes`: with none,
   `wrangler deploy` publishes none and keeps the dashboard's Custom Domains, while a `custom_domain` route there would
   replace them with the file's.
3. **List it** on the API, comma-separated: `wrangler secret put STATUS_HOSTNAMES` (add `--env` for dev). A secret, so
   no hostname is in the repository.

A listed hostname may sit under the instance's own domain (a sibling of the dashboard's hostname), or be the apex of
a domain, since no CNAME is involved; it may never be the dashboard's hostname, anything under it or a parent of it,
nor in the SaaS zone. Entries that break those rules, or are not hostnames, are left out and logged ("a
STATUS_HOSTNAMES entry is left out").

The dashboard's Custom domain card lists the hostnames no other workspace holds, or holds but could have taken over
(pending for more than 7 days); an owner or admin picks one with a press, and the first workspace to pick it holds
it. Every workspace sees the list, so on an instance whose workspaces are not all your own, any of them can pick a
hostname first. Brigade then reaches `https://<hostname>/robots.txt`: the edge
answers that itself with an `X-Brigade-Status-Edge` header, and the domain is active at once. Anything else answering
there (not attached yet, another site, an error page, no answer) leaves it pending ("not attached"), checked again
like a Cloudflare one, and "Check again" asks at once. An active domain is never set back by one answer (a WAF rule's
403, a rate limit, a timeout would take a working page down): the shard's alarm sets it back to pending only after 8
misses in a row, about two hours, which is how a detached Custom Domain shows on the dashboard. Removing it deletes nothing at Cloudflare:
detaching the Custom Domain is the operator's. A hostname left pending for more than 7 days can be taken over like any
other.

Removing a hostname from `STATUS_HOSTNAMES` hides it from the card for new picks; a page that already has it keeps it
until it is removed there, and stops serving once the Custom Domain is detached. **Turning it off** means removing the
pages' domains on the card first, then the secret and the Custom Domains: with no hostname listed (and no Cloudflare
for SaaS) the card is hidden and its routes answer `503 not_configured`, so a domain left on a page could no longer be
removed there.

## Webhooks

RFC 0005 "Outbound webhooks". Owners and admins register endpoints on the dashboard's Webhooks card (at most 20 per
workspace), or a script with an API token (`webhook:manage`). `POST /workspaces/:id/webhooks` and `POST
/workspaces/:id/webhooks/:webhookId/rotate` (`src/webhook-routes.ts`) make the signing secret (`whsec_…`), seal it
with AES-256-GCM under `WEBHOOK_SECRET_KEY` (optional secret, 32 bytes base64url; the same sealing as Slack's tokens,
bound to the workspace and the endpoint) and run `webhook.create` / `webhook.rotateSecret` in the shard as the member
or token; the answer is the only time the secret is shown. Custom headers (up to 5, given on create or with `PUT
…/webhooks/:webhookId/headers`) are sealed the same way, bound to their name too, and never shown back. Edits, on and
off, delete, "Send test event" and "Replay" are mutations over sync. Without the key, creating answers 503
`not_configured` and nothing is delivered.

The queue consumer delivers (`src/notify-webhooks.ts`): the shard's ledger (`src/webhooks.ts`) plans each event's
endpoints and keeps the payload, the consumer signs it (Standard Webhooks, `src/webhook-sign.ts`), POSTs it under the
monitors' target rules plus https only (no redirects followed, 5 s, at most 1 KB of the answer read) and reports back.
Retries: 30 s, 2 min, 10 min, 1 h, 4 h, then given up; a given-up delivery can be replayed from the card (one
attempt, the same `webhook-id`, at most 10 an hour per endpoint). A page never waits on it: webhooks get at most
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
`AI` binding is set for `dev` only ("Deploying dev", step 6); staging and production add `"ai": { "binding": "AI" }`
the same way.
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
