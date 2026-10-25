# @freecorps/brigade-relay

The push relay (RFC 0006): a Cloudflare Worker that forwards encrypted pushes to APNs. It never sees content, only
a device token, an envelope sealed with [`@freecorps/brigade-push`](../../packages/push/README.md) and an urgency.
For now it is spike S1's relay ([write-up](../../docs/spikes/s1-apns-encryption.md)): no instance registration,
handles, rate limits or FCM yet.

| Route         | Response                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /health` | `200 {"ok":true}`                                                                                                              |
| `POST /send`  | `Authorization: Bearer <RELAY_SEND_TOKEN>`; body `{ deviceToken, envelope, urgency?, collapseId?, ttlSeconds?, environment? }` |
|               | A call (RFC 0010): `{ kind: "call", callId, deviceToken: <PushKit token>, envelope }`, see below                               |
|               | `200 { status, apnsId, apnsUniqueId, ms }` when APNs accepts; `502` with APNs' `reason` when it does not                       |
|               | `502 {"error":"apns_unreachable"}` when `fetch` fails; `400` for a bad body; `401` without the token                           |
|               | `500 {"error":"relay_misconfigured"}` when `APNS_KEY` cannot sign a provider token                                             |

`ttlSeconds` is how long APNs keeps trying an offline phone: by default 15 minutes for `page`, 1 hour for `high`,
4 hours for `low`; at most 30 days; 0 means try once, which `page` refuses. A wrong `APNS_KEY_ID` or `APNS_TEAM_ID`
signs fine and comes back as `502` with APNs' `InvalidProviderToken`: check the secrets.

`environment` (`sandbox` or `production`) is the device token's APNs environment, which the instance records when
the device registers (Xcode builds get sandbox tokens, EAS builds production ones); without it the relay uses its
`APNS_ENVIRONMENT`. The API's push notifier always sends it.

`urgency` is `low` (APNs priority 5), `high` or `page` (priority 10; `page` is `time-sensitive`). The payload's
alert is a pair of localization keys, the fallback the app shows when it cannot decrypt.

**APNs needs HTTP/2, which only the deployed Worker has.** Cloudflare's edge speaks HTTP/2 to APNs; local workerd
(`vp dev`) cannot, and its sends fail with `Network connection lost.` Test sends against the deployed `dev`
environment.

**Calls** (`kind: "call"`, spike S6, [write-up](../../docs/spikes/s6-voip-call-screen.md)) are PushKit VoIP pushes:
topic `<APNS_TOPIC>.voip`, `apns-push-type: voip`, body `{ call: { id }, brigade: <envelope> }` and nothing else.
`callId` is a lowercase UUID shared by repeats of one page; `urgency` must be `page` (the default for a call);
`ttlSeconds` defaults to 60 and may not exceed 300. iOS terminates an app that gets a VoIP push and reports no
call, so the relay refuses anything the app could not ring for. The App ID needs the VoIP Services capability; the
same `.p8` token key signs for the `.voip` topic.

## Configuration

`wrangler.jsonc`: production is the top-level config (`brigade-relay`, no workers.dev URL, production APNs); `dev`
is `brigade-relay-dev` on workers.dev with the APNs sandbox. Secrets, from files outside the repository, never in
the config:

| Secret             | What                                   |
| ------------------ | -------------------------------------- |
| `APNS_KEY`         | The `.p8` token-signing key's PEM text |
| `APNS_KEY_ID`      | Its key id                             |
| `APNS_TEAM_ID`     | The Apple team id                      |
| `RELAY_SEND_TOKEN` | The bearer token `/send` requires      |

```bash
vp run build:dev                                                          # builds the dev environment into dist/
bunx wrangler deploy --secrets-file ~/.config/brigade/relay-dev-secrets.json  # deploys it with its secrets
vp test                                                                   # JWT, request builder and /send (Node, fetch stubbed)
```

## Sending a test push

`scripts/send-test-push.ts` plays the instance: it seals a title and body for a device and posts them to a relay.
The device token and public key come from the app's development-only `/push` screen.

```bash
# Directly, not through `vp run`: the task runner does not pass RELAY_URL and RELAY_TOKEN_FILE through.
RELAY_URL=https://brigade-relay-dev.<subdomain>.workers.dev RELAY_TOKEN_FILE=~/.config/brigade/relay-dev-token \
  NODE_OPTIONS=--conditions=@freecorps/source vpx scripts/send-test-push.ts \
  <device token> <device public key> "SEV1 · Checkout down" "502s from payments" page
```

License: AGPL-3.0-only.
