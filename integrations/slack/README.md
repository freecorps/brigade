# @freecorps/brigade-slack

The Slack app (RFC 0011): `/inc` (declare and its form, ack, update, sev, resolve, role, escalate), the Acknowledge
button, the "Post to Brigade timeline" shortcut and `!update` messages, installed per Slack workspace with OAuth v2;
one message per incident in a channel, a channel per incident (opt-in), and the timeline mirrored there. This package
is two things:

- **The Slack Worker** (`src/index.ts`, `brigade-slack-dev`): Slack's requests and the OAuth redirect. It verifies
  every request (`src/verify.ts`), answers Slack within 3 seconds and does the work in `waitUntil`, and reaches
  Brigade only through the API's `SlackBridge` entrypoint (`src/bridge.ts` is the contract).
- **What the API sends** (`./notifier`, `./modal`, `./replies`, `./web-api`): Block Kit rendering, the declare form,
  the answers' wording and the Web API calls, imported by the API: its queue consumer posts the messages, creates and
  archives incident channels and mirrors the timeline, and its bridge opens the form (the API does not bind to this
  Worker, so there is no binding cycle).

| Route                        | What                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /slack/commands`       | `/inc`: signed by Slack; `200` at once, the answer through `response_url` (ephemeral)           |
| `POST /slack/interactions`   | The Acknowledge button, the message shortcut and the declare form; others are acknowledged      |
| `POST /slack/events`         | Events API: `url_verification`, `app_uninstalled`, `tokens_revoked`, `!update` messages         |
| `GET /slack/install?state=…` | On to Slack's consent page; the state comes from the API's `POST /workspaces/:id/slack/install` |
| `GET /slack/oauth/callback`  | Back from Slack: state checked against the cookie, code exchanged, team connected; back to `/`  |

Slack reaches these on the dashboard's origin: `brigade-web` forwards `/slack/*` here through its `SLACK` binding.

## Setting it up (owner's call; deployed on `dev`)

1. **Create the app** at https://api.slack.com/apps → Create New App → From a manifest, with `manifest.yaml` after
   replacing `brigade.example.com` with the dashboard's origin. One app per Brigade instance; it installs into any
   number of Slack workspaces. Slack checks the Events API request URL when the manifest is saved, and this Worker
   can only answer that check once it has its signing secret: create the app first without
   `settings.event_subscriptions`, deploy (steps 2 to 6), then paste the whole manifest under App Manifest.
2. **Secrets on the Slack Worker** (from the app's Basic Information page):
   ```bash
   wrangler secret put SLACK_SIGNING_SECRET   # Signing Secret
   wrangler secret put SLACK_CLIENT_ID        # Client ID
   wrangler secret put SLACK_CLIENT_SECRET    # Client Secret
   wrangler secret put DASHBOARD_URL          # https://<dashboard origin>, the same as in the manifest
   ```
3. **The token key on the API** (`apps/api`), 32 random bytes that encrypt bot tokens at rest:
   ```bash
   openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=' | wrangler secret put SLACK_TOKEN_KEY --env dev
   ```
   Without it Slack is off: no install starts and no message is sent. Losing or changing it means every workspace
   reconnects Slack (no `v2` rotation exists yet).
4. **D1**: apply `apps/api/migrations/0006_slack_team.sql` (`wrangler d1 migrations apply DB --remote --env dev`).
5. **Deploy in order**: the API (it exports `SlackBridge`), then this Worker (`vp build` here, then `wrangler deploy`;
   the top-level config is already `brigade-slack-dev`, and `CLOUDFLARE_ENV=dev` would deploy it as
   `brigade-slack-dev-dev`), then the dashboard. `wrangler deploy --secrets-file <file outside the repo>` sets the
   step 2 secrets in the same go.
6. **The dashboard's `SLACK` binding**: `env.dev.services` in `apps/web/wrangler.jsonc` binds `brigade-slack-dev`
   (committed now that the Worker exists on `dev`). Another environment adds its own entry once its Slack Worker is
   deployed: a service binding to a Worker that does not exist fails the dashboard's deploy, and without it
   `/slack/*` answers 404.
7. In the dashboard, an owner or admin presses **Add to Slack** on the Slack card, then picks the channel and, if they
   want them, turns on incident channels.

A workspace that connected before the incident-channel scopes were added (`channels:read`, `groups:read`,
`channels:manage`, `groups:write`, `channels:history`, `groups:history`) presses **Add to Slack** again to grant them;
the app's manifest must be updated in Slack first (App Manifest, paste `manifest.yaml`), which also adds the Events
API request URL (`/slack/events`, which Slack checks with `url_verification` when it is saved) and the shortcut.

A Slack user maps to the member whose verified Brigade email is the one Slack confirmed for them, and only for the
connected team's own users (RFC 0011 "Who a Slack user is"). Connecting a team trusts its Slack admins with that
mapping: connect only a Slack team whose admins you would trust with the members' accounts.

The bot token never reaches this Worker: the API's `SlackBridge` opens it, asks Slack who a user is and runs the
action; this Worker answers through each request's `response_url`.

## Locally

The unit tests run in Node with a fake Slack and a fake bridge (`vp test`); the API's side, the shard and the queue
consumer are tested in `apps/api/test/slack.test.ts`, against a fake Web API. Both fakes refuse a JSON body on the
read methods (`users.info`, `users.lookupByEmail`, `conversations.list`), as Slack does: those read a form only. `dev`
runs against a real Slack workspace. `vp run dev` here starts this Worker alone (its `API` binding
shows as not connected); Slack itself cannot reach a local Worker without a tunnel.
