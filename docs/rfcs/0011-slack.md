# RFC 0011 — Slack

- Status: Draft

The first chat integration (RFC 0001 goal 6, RFC 0005 "Slack (first ChatProvider)"): installing the app into a
Slack workspace; `/inc` (declare, with a form when no title is given, ack, update, sev, resolve, role, escalate) and
an Acknowledge button; one message per incident in a channel that follows the incident; a channel per incident
(opt-in); the timeline mirrored both ways; the Events API (Slack removing the app, `!update` messages); and the
dashboard's channel picker. What is left is at the end ("Not in this slice").

## Shape

```
Slack ──HTTPS──▶ web Worker (/slack/* forwarded, optional service binding SLACK)
                   └─▶ slack Worker (integrations/slack): verifies, parses, answers in 3 s
                          └─(service binding API, entrypoint SlackBridge)─▶ api Worker
                                 ├─ D1: which Brigade workspace a Slack team is, which member an email is
                                 ├─ Slack users.info with the bot token: who a Slack user is
                                 └─ WorkspaceDO: runs incident.declare / incident.ack as the member

WorkspaceDO outbox ─▶ brigade-events ─▶ api Worker queue consumer
                                          ├─ push (RFC 0006), email (RFC 0005)
                                          └─ Slack notifier: chat.postMessage / chat.update with the bot token
```

- **One Slack app per Brigade instance** (Q6): self-hosters create it from `integrations/slack/manifest.yaml`;
  the hosted version is Freecorps' published app. One instance's app installs into any number of Slack workspaces
  (Slack calls them teams), and each Brigade workspace connects to at most one team.
- **Same origin as the dashboard.** Slack's request URLs, the OAuth redirect and the dashboard share one origin:
  the web Worker forwards `/slack/*` to the slack Worker as it forwards `/api/*` to the API. So the install cookie
  (below) needs no cross-site rules, and an instance has one public hostname (`DASHBOARD_URL`).
- **No binding cycle.** Cloudflare deploys a Worker only once every Worker it binds to exists, so two Workers bound
  to each other cannot be deployed from nothing. The slack Worker binds to the API (`SlackBridge`, a named
  `WorkerEntrypoint`); the API does not bind to it. Outbound messages are sent from the API's existing queue
  consumer (RFC 0002: the consumer stays there until the notifier Worker splits off), with the message renderer and
  the Web API client imported from `integrations/slack` (`@freecorps/brigade-slack/notifier`), so the Slack code
  lives in one place. Deploy order: api, slack, web.
- **The API stays the only writer.** The slack Worker never touches D1 or a shard: every read and write goes through
  `SlackBridge`, and every write is a named mutation run in the workspace shard with RBAC and its outbox event
  (RFC 0004, RFC 0005), as the member the Slack user maps to.
- **The token stays in the API.** `SlackBridge.act` takes the Slack team and user ids as Slack's signed request
  named them; the API opens the token, asks Slack who the user is and runs the action. The slack Worker answers
  through the request's `response_url` (short-lived, needs no token) and never holds a token, so a bug or a
  compromised dependency there cannot read or use one. Its OAuth callback sees the token `oauth.v2.access` returns
  once, on its way to the API.

## Requests from Slack

Every request to `/slack/commands`, `/slack/interactions` and `/slack/events` is verified before anything else reads
it:

- The raw body is read up to 256 KiB (`MAX_BODY_BYTES`; a declared larger `Content-Length` is refused unread), never
  parsed before the check.
- `X-Slack-Request-Timestamp` must be an integer within 5 minutes of the Worker's clock (Slack's window), in either
  direction.
- `X-Slack-Signature` is `v0=` and the hex HMAC-SHA256 of `v0:<timestamp>:<raw body>` under the signing secret
  (`SLACK_SIGNING_SECRET`, a secret). It is checked with WebCrypto's `crypto.subtle.verify`, which compares in
  constant time; a header that is not 64 hex digits is refused without computing anything.
- Anything else is `401` with no body detail. Slack shows its own error; nothing ran.
- **Replays.** A request replayed inside the 5 minutes passes the check, so every write it causes is idempotent: a
  command's mutation id comes from its `trigger_id` (a hash of it), a button's from its `action_ts` and user, and
  the shard answers a mutation id it has seen with the stored result (RFC 0004). A declaration keeps its incident's
  id under the command before its mutation runs, so a replay answers with that incident and never declares a second
  one. A replay outside the window is refused.

**3 seconds.** Slack shows an error when the answer takes longer. The slack Worker answers `200` with an empty body
at once, after the signature check and parsing, and does the work in `ctx.waitUntil`: it looks up the workspace
and the member, runs the mutation, and answers through the request's `response_url` (ephemeral, `replace_original:
false`). `response_url` takes 5 posts in 30 minutes, more than enough for one answer. A Queue is not needed: the
work is a few RPCs and a D1 read, well inside `waitUntil`'s 30 seconds, and a lost answer loses no state (the
mutation either committed or not, and the channel message shows which).

## Installing (OAuth v2)

1. An owner or admin presses **Add to Slack** on the dashboard's Slack card. The dashboard posts
   `/api/workspaces/:id/slack/install` (cookie session, same-origin only). The API checks the session and the role in
   D1 (`workspace:manage`), and the shard stores a one-time state (32 random bytes, kept as its SHA-256, the member's
   id, 10 minutes; at most 20 pending per workspace). The API answers `{ state }` (`<workspace id>.<nonce>`) and sets
   a cookie holding the same state (`brigade_slack_oauth`, `HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS, path
   `/slack/oauth`, 10 minutes).
2. The dashboard navigates to `/slack/install?state=…`; the slack Worker redirects to
   `https://slack.com/oauth/v2/authorize` with its client id, the bot scopes, `redirect_uri`
   `<DASHBOARD_URL>/slack/oauth/callback` and the state.
3. Slack sends the browser back to `/slack/oauth/callback?code&state`. The state must equal the cookie (constant
   time); the cookie is cleared either way. This binds the callback to the browser whose Brigade session started
   the install, so a link someone else started cannot connect their Slack to this workspace or ours to theirs
   (OAuth CSRF). The slack Worker exchanges the code (`oauth.v2.access`, the client id and secret in the body),
   requires a bot token for a team (Enterprise Grid org installs are refused for now) and hands the result to
   `SlackBridge.completeInstall`.
4. The API takes the state from the shard (deleted on first use, so a state works once), checks the member is still
   an owner or admin in D1, claims the team in D1 (`slack_team`: team id → workspace id; a team already connected to
   another Brigade workspace is refused, `team_taken`, unless that workspace's shard no longer has it), encrypts the
   token and runs `slack.connect` as the member. The claim is a compare-and-set on the row as it was read, so of two
   installs racing for one team only one routes it. A refusal after Slack issued the token revokes it
   (`auth.revoke`), unless a workspace may hold that very token: Slack can answer a reinstall with the bot token the
   team already has, and revoking it would cut the holder off. The API says to revoke only when no workspace holds
   the team, or the token it holds opens and differs; when it cannot tell (or does not answer), the token is kept.
5. The browser lands on the dashboard with `?slack=connected` (or the refusal's code), shown on the card.

Bot scopes: `commands` (`/inc` and the message shortcut), `chat:write`, `chat:write.public` (post in public channels
without being invited), `users:read`, `users:read.email` (map users by email, and members to the Slack users an
incident channel invites), `channels:read` and `groups:read` (the channel picker), `channels:manage` and
`groups:write` (create, invite to and archive incident channels; `groups:write` for private ones), `channels:history`
and `groups:history` (the `message.channels` and `message.groups` events that carry `!update`). No user token is
requested. A workspace that installed before these were added must reinstall (Add to Slack again) to grant them;
until then the new calls fail with `missing_scope`, recorded as `slack_failed` (`not_authorized`).

**Disconnecting** is `slack.disconnect` from the card (owners and admins): it deletes the connection and moves the
sealed token to the server-only `slack_revocations` table (one per team). The D1 row is left and treated as stale (a
lookup that finds the shard on another team, or none, ignores it and the next install overwrites it). On
`slack.disconnected` the Slack notifier opens the kept token and gives it back with `auth.revoke`, then
`slack.forgetToken` deletes it (`slack.token_forgotten`). A token Slack no longer takes (`invalid_auth`,
`token_revoked`) counts as revoked; one the workspace holds again for the same team (Slack can answer a reinstall
with the same token) is kept, not revoked; after the retries it is forgotten anyway. `slack.connect` to another
team keeps the replaced team's token the same way, revoked on that `slack.connected`.

**Slack removing the app** ("Events API" below): `app_uninstalled`, or `tokens_revoked` naming the workspace's bot
user, runs `slack.markRevoked` as the notifier: the token is deleted (it no longer works), the connection is marked
`revokedAt` and `revokedReason` (`uninstalled`, `tokens_revoked`), nothing more is planned or sent, and the card says
so with Connect again. Connecting again clears it.

## Where the token lives

In the workspace shard, in the server-only table `slack_tokens` (never synced, no query reads it), next to a synced
`slack` row without it (team id and name, channel, locale, who connected it and when), which the dashboard card
subscribes to. D1 holds only the routing row, since a slash command names a Slack team and the Worker needs the
Brigade workspace before it can reach a shard; the shard stays the authority.

The token is encrypted at rest with AES-256-GCM under `SLACK_TOKEN_KEY` (a secret on the **API** Worker, 32 random
bytes, base64url), with a random 96-bit IV per write and the workspace and team ids as additional data, so a
ciphertext moved to another workspace's row does not decrypt. Stored as `v1.<iv>.<ciphertext>` so a key rotation
can add `v2`. Neither the key nor the opened token leaves the API: the bridge opens it for `users.info` and the queue
consumer for a message. Without `SLACK_TOKEN_KEY` the API refuses to install (`not_configured`) and sends no Slack
messages. A token that no longer opens (the key changed) is answered as `unreadable`, logged, and tells the Slack
user an owner or admin must reconnect, rather than that Slack is not connected.

## Who a Slack user is

- The API's bridge reads the user with `users.info` (`include_locale`) and keeps, per isolate, the email, whether
  Slack vouches for it and the user's locale for 5 minutes (at most 2000 users), so a burst of commands is not a
  burst of Tier 4 calls. The cost of that cache: for up to 5 minutes after a change in Slack (an email changed, a
  user deactivated or moved to another team), a command from that user still maps by the old answer. The role is
  not cached, so a member removed or demoted in Brigade is refused at once.
- Slack vouches for an email only for the connected team's own users: `team_id` must be the team's, `is_stranger`
  (a Slack Connect guest) is refused, and so are deleted users, bots, no email, and an email Slack has not confirmed
  (`is_email_confirmed`). They map to nobody and are told Slack has not confirmed who they are.
- The API finds the Brigade member with that email (case-insensitive) in D1, in the workspace the team is
  connected to, **only if that address is verified** (`emailVerified`, RFC 0002 "Auth"): anyone can sign up with
  someone else's address, and only verification proves it is theirs. Their role is read there on every request
  (never cached: a role change applies at once). A member removed within the last minute is refused by the shard's
  tombstone, as for a sync upgrade (RFC 0003).
- **Unmapped users cannot act.** They get an ephemeral reply saying their Slack email is not a member's confirmed
  email in the workspace, and nothing runs. The mutation runs as the member (`{ kind: "user", id, role }`, client
  id `slack`), so RBAC is the dashboard's: a viewer cannot declare or acknowledge (`forbidden`), and the timeline and
  events name the member, not Slack.
- **Connecting a team trusts that team's admins with identity.** Whoever administers the Slack team can set a
  user's email there; Slack confirms addresses, but a Slack admin can create or change accounts. So a Slack team's
  admins can act in the connected Brigade workspace as any member whose verified email they give one of their users.
  Only an owner or admin of the Brigade workspace can connect a team, and they should connect only a team whose
  admins they would trust with the members' accounts.

## Commands

`/inc` (the command name is the manifest's; any name reaches the same handler). The manifest asks Slack to escape the
text (`should_escape: true`), so a user arrives as `<@U…|name>`; what people wrote is read back as plain text (`@name`,
`#channel`, a link's address, `&`, `<`, `>`), and the notifier escapes it again wherever it shows it.

- `/inc declare <title> [sev1|sev2|sev3|sev4]`: `incident.declare` with a new `inc_` id made by the shard; the
  severity is a last word `sev1` to `sev4` (any case), else SEV3, the dashboard's default. The title is the rest,
  checked by the mutation's own rules (1 to 200 characters, no invisible characters). It pages like any
  declaration: the event goes through the outbox to push and escalation (RFC 0006).
- `/inc declare` alone (or with only a severity): a form (`views.open`, while the command's `trigger_id` is still
  good) with the title, the severity, the incident type and the affected services (the workspace's, at most 100 of
  each, by name). The API opens it: it holds the token and reads the shard's catalog, and it first checks that the
  person maps to a member who may declare, so a viewer is told why without a form. The submission (`view_submission`,
  `callback_id` `brigade_declare`) is answered with an empty 200, which closes the form, and declares in `waitUntil`
  with the type and services (ids the shard no longer has are left out, as for the dashboard). The form carries the
  command's `response_url` in its `private_metadata`, signed back with the submission, so the answer goes there; a
  URL not on hooks.slack.com answers nobody. One form declares once: the key is the view's id.
- `/inc ack [INC-12 | 12]`: `incident.ack`, which stops the escalation run.
- `/inc update [INC-12] <text>`: `incident.postUpdate`. Only `INC-12` names an incident here, so `update 12 servers
  are back` is an update. Line breaks are kept.
- `/inc sev [INC-12] <1-4>` (or `sev1` to `sev4`): `incident.setSeverity`.
- `/inc resolve [INC-12]`: `incident.setStatus` to `resolved`.
- `/inc role [INC-12] <role> @someone`: `incident.assignRole`. The role is matched by its id, by its name (without
  case, accents or punctuation), or by `ic`, `comms`, `ops` for the built-ins, among the roles the workspace offers; an
  unknown one is answered with the list. The person is mapped as the requester is (Slack's confirmed email, a verified
  member); a viewer cannot hold a role, as on the dashboard.
- `/inc escalate [INC-12]`: `escalation.now`, a server-only mutation run as the member (`incident:update`), which
  pages the escalation's next level at once instead of at its timeout (after the last level, level 1 of the next
  round while repeats are left; past the last repeat everyone who can respond, and the run ends), with
  `reason: "manual"` on the page and the timeline. It takes the run's page count as the shard read it, so two people
  asking at once escalate once. No run under way (no policy, acknowledged, resolved) is answered as such.
- `/inc` or `/inc help`: the usage. Anything else: the usage with "Unknown command".

**Which incident.** A number names one. Without one: the incident whose channel the command was typed in (an
incident's own channel, below), else the only active incident (for `ack`, the only one nobody acknowledged); with
several, the answer lists up to five numbers and gives the subcommand to repeat with one.

Every action runs as the member, through the shard, under client id `slack`, de-duplicated by the command's key: the
same RBAC (a viewer gets `forbidden`), mutations, events and timeline entries as the dashboard.

Answers are ephemeral, in the member's language: their Brigade `user.locale`, else Slack's locale for the user,
else the connection's. They cover each action done; already so (acknowledged, the same severity or holder); no
longer active; not found; which incident; nothing active; no escalation under way; an unknown role; a person who maps
to no member or is a viewer; not allowed (viewer); not a member; Slack not connected to a Brigade workspace; the form
not opening; and a generic "try again" for anything else (`unavailable`, `internal`). The wording lives in
`integrations/slack/src/replies.ts`, shared by this Worker and the API, which answers Events API messages itself.

**Acknowledge button.** The incident message carries an Acknowledge button (`action_id` `brigade_ack`, value the
incident id) while the incident is active and unacknowledged. A click is a `block_actions` interaction, run like
`/inc ack` on that id in the team's workspace (an id from another workspace is simply `not_found` there). The
message updates through the notifier when `incident.acknowledged` comes through, not from the click, so every route
(dashboard, phone, Slack) updates it the same way.

## The incident message

One message per incident in the workspace's configured channel (`slack.configure`: a channel picked on the card,
`C…` or `G…`, with its name, and the language of channel messages). Public channels need no invitation (`chat:write.public`);
private ones need the bot invited.

- **Posted** on `incident.declared`; **updated** with `chat.update` on `incident.acknowledged`,
  `incident.status_changed` and `incident.severity_changed`, when the incident has a message in that channel (an
  incident declared before Slack was connected, or whose post failed, gets none).
- **Rendered from the incident as it is now** (number, severity, status, title, who declared it, who acknowledged
  it), not from the event, so events handled out of order still leave the latest state. Titles and names are user
  text: `&`, `<` and `>` are escaped for Slack's mrkdwn, so a title cannot mention `@channel` or forge a link.
  The language is the connection's (RFC 0008: shared channels use the workspace's locale; until workspaces have one,
  Q15, it is set on the card and defaults to the connecting member's).
- **Idempotent per event.** The shard keeps a Slack ledger: events handled (`slack_events`), each job of an event
  (`slack_jobs`, with attempts and the earliest retry; "Jobs" below) and each incident's message (`slack_messages`:
  channel, `ts`). A redelivered event that is done
  does nothing. A plan claims the incident for 30 s, so two events of one incident in a batch never both post: the
  second is `held` and retried after the claim, and then updates the message the first posted. A post whose result
  could not be recorded (the shard unreachable right after Slack answered) is posted again on the retry: at least
  once, like every delivery here. The ledger lives 15 days, like the page ledger; an incident's message is kept 15
  days from its last use, and for as long as the incident is active.
- **Failures.** A 429 waits for Slack's `Retry-After` (at least our own backoff); a 5xx, a network failure or a
  timeout (2.5 s per call in the consumer) retries at 5, 10, 20, 40 s; after 5 attempts, or at once for what retrying cannot fix
  (`channel_not_found`, `not_in_channel`, `is_archived`, `invalid_auth`, `token_revoked`, `account_inactive`,
  `missing_scope`, `invalid_blocks`), the shard runs `notification.failSlack`: a `slack_failed` timeline entry
  ("Couldn't post to Slack: …") and `notification.failed` with `channel: "slack"`, which no notifier acts on. An
  update whose message is gone (`message_not_found`) posts a new one.
- **Push first.** The consumer runs the Slack notifier next to push for the same event, never before it, and a
  Slack failure, a slow Slack or a missing configuration never delays or retries a page that went out: the page
  ledger makes the redelivery a no-op for push (tested). A batch settles only when its slowest message does, and
  the next batch's pages wait for that, so the consumer gives Slack at most 3 s per event: past it the message is
  retried for Slack's sake (the claim makes the retry wait for it, then re-plan) and the batch moves on. Slack's
  retries stop with the Queue's (`max_retries`): the last delivery is acked rather than dead-lettered.

Rate limits: `chat.postMessage` allows about one message per second per channel, `chat.update` is Tier 3 (50+ a
minute), `users.info` Tier 4, `conversations.create` and `conversations.list` Tier 2 (20+ a minute),
`users.lookupByEmail` and `conversations.invite` Tier 3. A handful of calls per incident change stays far inside
them; the 429 path covers bursts.

## Jobs

What the notifier does for one event is a list of jobs, in order, planned by the shard from the incident and its
Slack state as they are now (`SlackDesk.plan`). The consumer plans, does one job, records it (`recordSlack`) and plans
again, until nothing is left (at most 8 per delivery; the rest come with the retry). Each job is done once per event
(`slack_jobs`), retried on its own with the backoff above, and when it gives up it is recorded as `slack_failed` on
the incident's timeline (`notification.failSlack`, once per job), so a failed invite does not stop the message. The
incident's claim covers every job, so two events of one incident never create a channel or post at once.

| Event                              | Jobs                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `incident.declared`                | create the channel (when asked for), invite, post in it, post in the main one |
| `incident.acknowledged`            | update both messages, mirror                                                  |
| `incident.status_changed`          | update both messages, mirror; a closed incident's channel comes due           |
| `incident.severity_changed`        | update both messages, mirror                                                  |
| `incident.update_posted`           | mirror (not an update that came from a Slack message)                         |
| `incident.role_assigned`           | invite the new holder, mirror                                                 |
| `escalation.paged`                 | invite whoever was paged                                                      |
| `slack.archive_due`                | archive the channel, if the incident is still closed                          |
| `slack.disconnected`, `.connected` | give back the token let go of (`auth.revoke`)                                 |

**Budget.** Slack's calls run under the side-connection limiter (src/side-connections.ts) with their own share:
Slack holds at most `SLACK_CONNECTIONS` (2) of the 3 side slots, so it never takes every slot from the webhooks, and
the relay always has 3 of the invocation's 6. The Slack side of an event still gets `SLACK_BUDGET_MS` (3 s) in the
batch; past it the jobs carry on under `waitUntil` and the message is retried for Slack's sake. Pages are never
delayed: push runs first and its own retry wins (tested).

## A channel per incident

Opt-in per workspace (`slack.configure`): `incidentChannels` is `off` (the default), `all`, or `major` (SEV1 and SEV2
only, by the severity at declaration); `privateChannels` makes them private (`groups:write`); `archiveAfterHours` is
how long after the incident closes its channel is archived (0: at once; the card offers 0, 1, 24 and 168 hours), or
null to keep it. A workspace without a main channel can still have incident channels.

- **Created** on `incident.declared` with `conversations.create`, named `inc-<number>-<title as a slug>` (lowercase
  letters, digits and hyphens, accents dropped, at most 80 characters), with `-2` to `-4` when the name is taken. The
  bot that creates it is in it. The channel's id is kept in the shard (`slack_channels`), not in a synced row.
- **Invited**: who declared it, its role holders and whoever its escalation paged so far (`conversations.invite` with
  `force`, at most 50), and later each new role holder (`incident.role_assigned`) and each person paged
  (`escalation.paged`). A member maps to a Slack user by their **verified** Brigade email (`users.lookupByEmail`, the
  connected team's own users, cached per isolate for 5 minutes): the same rule as who a Slack user is, the other way.
  Someone Slack does not know is left out; someone already in the channel is fine.
- **The incident message** is posted there too, and the main channel's message links to the channel ("Incident
  channel: #inc-12-…"). Both are updated on every change.
- **Archived** after the delay: a status change that closes the incident sets when (`slack_channels.archive_at`) and
  brings the shard's alarm forward; one that reopens it clears it. The alarm runs `slack.archiveDue` as the notifier
  (refused with `conflict` for an incident reopened meanwhile), whose `slack.archive_due` event goes through the
  outbox to the notifier, which archives the channel (`conversations.archive`; one archived already counts). The alarm
  asks again 10 minutes later if nothing archived it.

`/inc` typed in an incident's channel acts on that incident without a number.

## Timeline mirror

**Brigade to Slack.** Status, severity, role, update and acknowledgement entries are posted as a line in the incident's
channel ("Ana changed the severity to SEV2 · High", "Update from Ana" and the text), or, without an incident channel,
as a reply in the thread of the incident's message in the main channel. Rendered from the event (who did it, to
what) in the connection's language, with people's text escaped, and idempotent per event like the rest (the `entry`
job).

**Slack to Brigade.** A person's message in an incident's channel (or in the thread of an incident's message) that
starts with `!update ` becomes `incident.postUpdate` as the member they map to; so does the message shortcut "Post to
Brigade timeline" (`callback_id` `brigade_post_update`) on any message there. The key is the message (`channel` and
`ts`), so the same message posted twice, by anyone or by a retried event, is one update. Anywhere else it is refused
("This isn't an incident's channel"). Such an update is not mirrored back (the shard keeps its entry id in
`slack_inbound`): it is in the channel already. An `!update` has no `response_url`, so the API answers the person
with `chat.postEphemeral` in that channel and thread; the shortcut answers through its own `response_url`.

## Events API

`POST /slack/events`, verified like every request. `url_verification` is answered with its `challenge` (plain text,
at most 256 characters). Every `event_callback` is answered with an empty 200 at once and done in `waitUntil`; Slack
retries an event it got no 200 for within 3 s, and every write here is keyed, so a retry changes nothing.

- `app_uninstalled`, and `tokens_revoked` whose `tokens.bot` names the workspace's bot user (a user token's is
  ignored: Brigade holds none): `SlackBridge.revoked`, which marks the connection revoked (above).
- `message` (`message.channels`, `message.groups`) with no `subtype` and no `bot_id` (not an edit, a join or a bot's
  message) that starts with `!update `: the update above.

## The channel picker

The card lists channels from Slack instead of asking for an id: `GET /api/workspaces/:id/slack/channels` (cookie
session, owners and admins) opens the token in the API and calls `conversations.list` (public and private channels,
not archived, 200 a page, at most 5 pages), keeps private channels only when Brigade is in them, and sorts them by
name. The token never reaches the browser. The card keeps the channel's name with its id (`channelName`) and shows
`#name`, keeps a saved channel Slack no longer lists as a choice, and falls back to typing an id when the list cannot
be read (`not_connected`, `slack_failed`, `unavailable`).

## Strings

Every Slack-visible string is in `packages/i18n` (`slack_text`, en and pt-BR: replies, the message, the mirror and
the form), the dashboard card's in `slack_card`. The slash command's and the shortcut's names and descriptions in the
manifest are English (Slack apps have one manifest).

## Secrets and configuration

| Where        | Name                   | What                                                                 |
| ------------ | ---------------------- | -------------------------------------------------------------------- |
| slack Worker | `SLACK_SIGNING_SECRET` | Verifies every request from Slack                                    |
| slack Worker | `SLACK_CLIENT_ID`      | OAuth (not secret, kept with the others so no app id is in the repo) |
| slack Worker | `SLACK_CLIENT_SECRET`  | OAuth code exchange                                                  |
| slack Worker | `DASHBOARD_URL`        | The public origin: redirect URI, links back                          |
| api Worker   | `SLACK_TOKEN_KEY`      | AES-256-GCM key for bot tokens (32 bytes, base64url)                 |
| api Worker   | `DASHBOARD_URL`        | Already there (email links); the message's "Open in Brigade"         |

Only `-dev` names are configured (`brigade-slack-dev` and its binding to `brigade-api-dev`); staging and production
follow with their deploys (owner's call). The dashboard's `SLACK` binding is optional and not committed: a service
binding to a Worker that does not exist yet fails the dashboard's deploy, so it is added to `apps/web/wrangler.jsonc`
with the Slack Worker's first deploy, and without it `/slack/*` answers 404. `integrations/slack/README.md` lists
the steps.

## Not in this slice

- App Home and link unfurls.
- A channel for an incident whose severity is raised to SEV1 or SEV2 after it was declared (Q22).
- Distribution beyond one app per instance (Slack Marketplace, Enterprise Grid org installs).
- A test on a real Slack workspace: every Slack call here is tested against a fake Web API only (owner's call).
