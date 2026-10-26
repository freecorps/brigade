# @freecorps/brigade-slack

The Slack app (RFC 0011): `/inc declare`, `/inc ack` and the Acknowledge button, installed per Slack workspace with
OAuth v2, and one message per incident in a channel. This package is two things:

- **The Slack Worker** (`src/index.ts`, `brigade-slack-dev`): Slack's requests and the OAuth redirect. It verifies
  every request (`src/verify.ts`), answers Slack within 3 seconds and does the work in `waitUntil`, and reaches
  Brigade only through the API's `SlackBridge` entrypoint (`src/bridge.ts` is the contract).
- **The incident message** (`./notifier`): Block Kit rendering and the Web API calls, imported by the API's queue
  consumer, which posts and updates the message (the API does not bind to this Worker, so there is no binding cycle).

| Route                        | What                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /slack/commands`       | `/inc`: signed by Slack; `200` at once, the answer through `response_url` (ephemeral)           |
| `POST /slack/interactions`   | The Acknowledge button (`block_actions`, `brigade_ack`); other interactions are acknowledged    |
| `GET /slack/install?state=…` | On to Slack's consent page; the state comes from the API's `POST /workspaces/:id/slack/install` |
| `GET /slack/oauth/callback`  | Back from Slack: state checked against the cookie, code exchanged, team connected; back to `/`  |

Slack reaches these on the dashboard's origin: `brigade-web` forwards `/slack/*` here through its `SLACK` binding.

## Setting it up (owner's call; nothing here is deployed yet)

1. **Create the app** at https://api.slack.com/apps → Create New App → From a manifest, with `manifest.yaml` after
   replacing `brigade.example.com` with the dashboard's origin. One app per Brigade instance; it installs into any
   number of Slack workspaces.
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
4. **D1**: apply `apps/api/migrations/0004_slack_team.sql` (`wrangler d1 migrations apply DB --remote --env dev`).
5. **Deploy in order**: the API (it exports `SlackBridge`), then this Worker (`CLOUDFLARE_ENV=dev vp build` here, then
   `wrangler deploy`), then the dashboard (its `SLACK` binding).
6. In the dashboard, an owner or admin presses **Add to Slack** on the Slack card, then sets the channel id.

Until Brigade verifies email addresses, a Slack user maps to whichever member signed up with their email (RFC 0011
"Who a Slack user is", open question Q21), so no deployed environment should get the app before email verification.

## Locally

The unit tests run in Node with a fake Slack and a fake bridge (`vp test`); the API's side, the shard and the queue
consumer are tested in `apps/api/test/slack.test.ts`. `vp run dev` here starts this Worker alone (its `API` binding
shows as not connected); Slack itself cannot reach a local Worker without a tunnel.
