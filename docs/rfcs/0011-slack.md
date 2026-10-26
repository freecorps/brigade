# RFC 0011 — Slack

- Status: Draft

The first chat integration (RFC 0001 goal 6, RFC 0005 "Slack (first ChatProvider)"). This RFC covers the first
slice: installing the app into a Slack workspace, `/inc declare`, `/inc ack` and an Acknowledge button, and one
message per incident in a channel that follows the incident. What is left is at the end ("Not in this slice").

## Shape

```
Slack ──HTTPS──▶ web Worker (/slack/* forwarded, service binding SLACK)
                   └─▶ slack Worker (integrations/slack): verifies, parses, answers in 3 s
                          └─(service binding API, entrypoint SlackBridge)─▶ api Worker
                                 ├─ D1: which Brigade workspace a Slack team is, who a Slack user is
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

## Requests from Slack

Every request to `/slack/commands` and `/slack/interactions` is verified before anything else reads it:

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
  the shard answers a mutation id it has seen with the stored result (RFC 0004). A replay outside the window is
  refused.

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
   token and runs `slack.connect` as the member. A refusal after Slack issued the token revokes it (`auth.revoke`).
5. The browser lands on the dashboard with `?slack=connected` (or the refusal's code), shown on the card.

Bot scopes: `commands`, `chat:write`, `chat:write.public` (post in public channels without being invited),
`users:read`, `users:read.email` (map users by email). No user token is requested.

**Disconnecting** is `slack.disconnect` from the card (owners and admins): it deletes the token and the
connection; the D1 row is left and treated as stale (a lookup that finds the shard on another team, or none,
ignores it and the next install overwrites it). The token is not revoked in Slack: Brigade no longer has it, and
removing the app in Slack's own settings revokes it there (open question Q21).

## Where the token lives

In the workspace shard, in the server-only table `slack_tokens` (never synced, no query reads it), next to a synced
`slack` row without it (team id and name, channel, locale, who connected it and when), which the dashboard card
subscribes to. D1 holds only the routing row, since a slash command names a Slack team and the Worker needs the
Brigade workspace before it can reach a shard; the shard stays the authority.

The token is encrypted at rest with AES-256-GCM under `SLACK_TOKEN_KEY` (a secret on the **API** Worker, 32 random
bytes, base64url), with a random 96-bit IV per write and the workspace and team ids as additional data, so a
ciphertext moved to another workspace's row does not decrypt. Stored as `v1.<iv>.<ciphertext>` so a key rotation
can add `v2`. The slack Worker never holds the key: the bridge decrypts for the one request that needs the token
(`users.info`) and the queue consumer for a message. Without `SLACK_TOKEN_KEY` the API refuses to install
(`not_configured`) and sends no Slack messages.

## Who a Slack user is

- The slack Worker reads the user with `users.info` (`include_locale`) and keeps, per isolate, the email, whether
  Slack confirmed it (`is_email_confirmed`) and the user's locale for 5 minutes (at most 2000 users), so a burst of
  commands is not a burst of Tier 4 calls. A deleted user, a bot, an unconfirmed email or no email maps to nobody.
- The API finds the Brigade member with that email (case-insensitive) in D1, in the workspace the team is
  connected to, and reads their role there, on every request (never cached: a role change applies at once). A
  member removed within the last minute is refused by the shard's tombstone, as for a sync upgrade (RFC 0003).
- **Unmapped users cannot act.** They get an ephemeral reply saying their Slack email is not a member's of the
  workspace, and nothing runs. The mutation runs as the member (`{ kind: "user", id, role }`, client id `slack`),
  so RBAC is the dashboard's: a viewer cannot declare or acknowledge (`forbidden`), and the timeline and events
  name the member, not Slack.
- Brigade does not verify email addresses yet (RFC 0002 "Auth"), so a member who signed up with someone else's
  address would be acted as by that address's Slack user. Slack's side is confirmed; Brigade's is not. Like
  `EMAIL_FROM`, no deployed environment should get a Slack app before email verification lands (Q21).

## Commands

`/inc` (the command name is the manifest's; any name reaches the same handler):

- `/inc declare <title> [sev1|sev2|sev3|sev4]`: `incident.declare` with a new `inc_` id made by the shard; the
  severity is a last word `sev1` to `sev4` (any case), else SEV3, the dashboard's default. The title is the rest,
  checked by the mutation's own rules (1 to 200 characters, no invisible characters). It pages like any
  declaration: the event goes through the outbox to push and escalation (RFC 0006).
- `/inc ack [INC-12 | 12]`: `incident.ack`, which stops the escalation run. Without a number it acknowledges the
  only active, unacknowledged incident; with several it lists up to five numbers and asks which.
- `/inc` or `/inc help`: the usage. Anything else: the usage with "Unknown command".

Answers are ephemeral, in the member's language: their Brigade `user.locale`, else Slack's locale for the user,
else the connection's. They cover: declared (with the number), acknowledged, already acknowledged, no longer
active, not found, which incident, nothing to acknowledge, not allowed (viewer), not a member, Slack not connected
to a Brigade workspace, and a generic "try again" for anything else (`unavailable`, `internal`).

**Acknowledge button.** The incident message carries an Acknowledge button (`action_id` `brigade_ack`, value the
incident id) while the incident is active and unacknowledged. A click is a `block_actions` interaction, run like
`/inc ack` on that id in the team's workspace (an id from another workspace is simply `not_found` there). The
message updates through the notifier when `incident.acknowledged` comes through, not from the click, so every route
(dashboard, phone, Slack) updates it the same way.

## The incident message

One message per incident in the workspace's configured channel (`slack.configure`: a channel id typed on the card,
`C…` or `G…`, and the language of channel messages). Public channels need no invitation (`chat:write.public`);
private ones need the bot invited.

- **Posted** on `incident.declared`; **updated** with `chat.update` on `incident.acknowledged`,
  `incident.status_changed` and `incident.severity_changed`, when the incident has a message in that channel (an
  incident declared before Slack was connected, or whose post failed, gets none).
- **Rendered from the incident as it is now** (number, severity, status, title, who declared it, who acknowledged
  it), not from the event, so events handled out of order still leave the latest state. Titles and names are user
  text: `&`, `<` and `>` are escaped for Slack's mrkdwn, so a title cannot mention `@channel` or forge a link.
  The language is the connection's (RFC 0008: shared channels use the workspace's locale; until workspaces have one,
  Q15, it is set on the card and defaults to the connecting member's).
- **Idempotent per event.** The shard keeps a Slack ledger: events handled (`slack_events`, with attempts and the
  earliest retry) and each incident's message (`slack_messages`: channel, `ts`). A redelivered event that is done
  does nothing. A plan claims the incident for 30 s, so two events of one incident in a batch never both post: the
  second is `held` and retried after the claim, and then updates the message the first posted. A post whose result
  could not be recorded (the shard unreachable right after Slack answered) is posted again on the retry: at least
  once, like every delivery here. The ledger lives 15 days, like the page ledger.
- **Failures.** A 429 waits for Slack's `Retry-After` (at least our own backoff); a 5xx, a network failure or a
  timeout (10 s) retries at 5, 10, 20, 40 s; after 5 attempts, or at once for what retrying cannot fix
  (`channel_not_found`, `not_in_channel`, `is_archived`, `invalid_auth`, `token_revoked`, `account_inactive`,
  `missing_scope`, `invalid_blocks`), the shard runs `notification.failSlack`: a `slack_failed` timeline entry
  ("Couldn't post to Slack: …") and `notification.failed` with `channel: "slack"`, which no notifier acts on. An
  update whose message is gone (`message_not_found`) posts a new one.
- **Push first.** The consumer runs the Slack notifier next to push for the same event, never before it, and a
  Slack failure, a slow Slack or a missing configuration never delays or retries a page that went out: the page
  ledger makes the redelivery a no-op for push (tested).

Rate limits: `chat.postMessage` allows about one message per second per channel, `chat.update` is Tier 3 (50+ a
minute) and `users.info` Tier 4. One message per incident and one update per change stays far inside them; the
429 path covers bursts.

## Strings

Every Slack-visible string is in `packages/i18n` (`slack_text`, en and pt-BR), the dashboard card's in
`slack_card`. The slash command's name and description in the manifest are English (Slack apps have one manifest).

## Secrets and configuration

| Where        | Name                   | What                                                                         |
| ------------ | ---------------------- | ---------------------------------------------------------------------------- |
| slack Worker | `SLACK_SIGNING_SECRET` | Verifies every request from Slack                                             |
| slack Worker | `SLACK_CLIENT_ID`      | OAuth (not secret, kept with the others so no app id is in the repo)          |
| slack Worker | `SLACK_CLIENT_SECRET`  | OAuth code exchange                                                           |
| slack Worker | `DASHBOARD_URL`        | The public origin: redirect URI, links back                                   |
| api Worker   | `SLACK_TOKEN_KEY`      | AES-256-GCM key for bot tokens (32 bytes, base64url)                          |
| api Worker   | `DASHBOARD_URL`        | Already there (email links); the message's "Open in Brigade"                  |

Only `-dev` names are configured (`brigade-slack-dev`, its bindings to `brigade-api-dev`, and `brigade-web-dev`'s
`SLACK` binding); staging and production follow with their deploys (owner's call). `integrations/slack/README.md`
lists the steps.

## Not in this slice

- A channel per incident (create, invite responders, archive on resolve).
- Mirroring the timeline both ways (updates to the channel, messages to the timeline).
- `/inc` subcommands beyond `declare` and `ack` (`update`, `severity`, `resolve`, `status`), Escalate, and modals.
- App Home, link unfurls, Events API (`app_uninstalled`, `tokens_revoked`: today a revoked token shows as
  `slack_failed` entries until someone reconnects).
- Distribution beyond one app per instance (Slack Marketplace, Enterprise Grid org installs).
- A channel picker (the card takes a channel id), and revoking the token on disconnect (Q21).
