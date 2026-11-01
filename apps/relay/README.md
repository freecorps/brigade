# @freecorps/brigade-relay

The push relay (RFC 0006): a Cloudflare Worker that forwards encrypted pushes to APNs (iPhones) and FCM (Android). It
never sees content, only a device token, an envelope sealed with
[`@freecorps/brigade-push`](../../packages/push/README.md) and an urgency. Two ways in: `/send`, spike S1's route
([write-up](../../docs/spikes/s1-apns-encryption.md)) plus FCM, which takes a raw device token from whoever holds
`RELAY_SEND_TOKEN` (our own instance, until every app sends handles); and the `/v1` instance protocol of RFC 0015:
instance registration (see "Instance registration") and handles, `/v1/send` and the signed deep health (see "Handles
and /v1/send"). Both send routes share the delivery code (`src/send.ts`), so they answer alike.

| Route                | Response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`        | `200 {"ok":true}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /health?deep=1` | `Authorization: Bearer <RELAY_SEND_TOKEN>` (`401` without it); `{ ok, apns, fcm }`, each `{ status: ok \| error \| not_configured, reason?, transient? }` (`transient: true` on an error that may pass: a timeout, a 5xx, Google's token endpoint busy); `503` unless APNs is `ok` and FCM is `ok` or `not_configured` (a relay without `FCM_SERVICE_ACCOUNT` serves iOS only, which is not a failure). APNs: the provider token on a request for a device that cannot exist (`400 BadDeviceToken` and `429 TooManyRequests` are ok, `429 TooManyProviderTokenUpdates` is an error; nothing is pushed), on `APNS_ENVIRONMENT`'s host only (one key signs for both). FCM: a fresh access token for `FCM_SERVICE_ACCOUNT` (RFC 0007 "Watching the watcher") |
| `POST /send`         | `Authorization: Bearer <RELAY_SEND_TOKEN>`; body `{ deviceToken, envelope, urgency?, collapseId?, ttlSeconds?, environment? }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
|                      | A call (RFC 0010): `{ kind: "call", callId, deviceToken: <PushKit token>, envelope }`, see below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
|                      | Android: `platform: "android"` and the FCM token as `deviceToken` (alerts and calls), see "Android (FCM)"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|                      | `200 { status, apnsId, apnsUniqueId, ms }` when APNs accepts; `502` with APNs' `reason` when it does not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|                      | `502 {"error":"apns_unreachable"}` when `fetch` fails; `400` for a bad body; `401` without the token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
|                      | `500 {"error":"relay_misconfigured"}` when `APNS_KEY` cannot sign a provider token                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

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

## Android (FCM)

`platform: "android"` sends through FCM's HTTP v1 API (`src/fcm.ts`) as a data message only: `data` is `{ v, enc, ct,
kind, urgency, callId?, tag? }` (`tag` is `collapseId`, the app's notification tag), `android.priority` is `HIGH`
(`NORMAL` for `low`) and `android.ttl` the same `ttlSeconds` defaults as APNs. The relay signs an RS256 JWT with the
service account's key and exchanges it at Google's token endpoint for an access token, kept until 5 minutes before it
expires (and fetched again if FCM answers 401). Answers: `200 { status, fcmId, ms }`; `502 { status, reason,
tokenInvalid? }` with FCM's error code (`UNREGISTERED`, `QUOTA_EXCEEDED`, `UNAVAILABLE`, …), `tokenInvalid: true`
when the token is gone (the instance drops the device; never for `SENDER_ID_MISMATCH`, which is logged as an error:
`FCM_SERVICE_ACCOUNT` is not the app's Firebase project); `502 {"error":"fcm_unreachable"}` when FCM or the token
endpoint cannot be reached; `500 {"error":"relay_misconfigured"}` without a usable `FCM_SERVICE_ACCOUNT`. FCM speaks
HTTP/1.1, so unlike APNs it also works from `vp dev`.

### Setting up FCM

1. Create a Firebase project (console.firebase.google.com) and add an Android app with the package name
   `app.freecorps.brigade`. Download its `google-services.json` **outside the repository** for the app build
   (apps/mobile/README.md, "Android pages"); never commit it.
2. In Google Cloud's IAM for that project, create a service account for the relay and give it the **Firebase Cloud
   Messaging API Admin** role (`roles/firebasecloudmessaging.admin`), the narrowest predefined role that can send.
   Make sure the "Firebase Cloud Messaging API" (v1) is enabled.
3. Create a JSON key for it and keep the file outside the repository (`~/.config/brigade/…`). Its `project_id` is
   the project the relay sends through.
4. Set it on the relay as the `FCM_SERVICE_ACCOUNT` secret: the whole JSON text, e.g. in the secrets file passed to
   `wrangler deploy --secrets-file` (as a JSON string value) or with `wrangler secret put FCM_SERVICE_ACCOUNT <
   key.json`. A relay without it still serves iPhones.

## Instance registration

RFC 0015 section 1: each instance has an Ed25519 key pair and an id derived from its first public key
(`ins_` + 22 base64url characters of its SHA-256). Every `/v1/` call is signed with it: `Brigade-Instance`,
`Brigade-Key`, `Brigade-Timestamp`, `Brigade-Signature`, made and checked by `signRequest`/`verifyRequest` in
[`@freecorps/brigade-push`](../../packages/push/src/instance.ts), which documents the signed string (method, path
with query, instance id, timestamp, body hash). A bad signature is `401 bad_signature`, a missing header `401
missing_signature`, a timestamp more than 5 minutes off `401 stale_timestamp`. Bodies are JSON, at most 8 KB.

| Route                        | Body                         | Answers                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/instances/contact` | `{ contact }`                | Emails a 6-digit code to `contact` (valid 15 minutes, 5 tries; limits below): `200 { sent, expiresInSeconds }`; `400 invalid_contact`, `409 already_registered`, `429 too_many_codes` (with `Retry-After`), `502 email_failed`, `503 not_configured` without `EMAIL`/`EMAIL_FROM`                                                                                                                                                         |
| `POST /v1/instances`         | `{ terms, contact, code }`   | Registers the original key: `201 { instance, status, terms, termsCurrent }`, `200` when already registered (and `terms`, if current, is recorded as accepted); `409 terms_outdated { terms }` unless `terms` is `RELAY_TERMS_VERSION`; `400 code_invalid { triesLeft }` or `code_expired`; `403 instance_revoked`. On a closed relay, by the admin token instead (below)                                                                  |
| `POST /v1/instances/keys`    | `{ add?, proof?, retire? }`  | Signed with a key in the record. Adds a raw public key (base64url, 32 bytes, at most 3 keys, `409 too_many_keys`) with `proof`, the new key's signature over `"brigade add-key\n" + instance id` (`signKeyProof`; `400 invalid_proof`); retires one other than the signer's (`409 cannot_retire_signer`, `400 unknown_key`); a key retired in the last 10 minutes cannot come back (`409 key_recently_retired`): `200 { instance, keys }` |
| `GET /v1/instances/me`       | none (signed as empty bytes) | `200 { instance, status, terms, termsCurrent }`; `403 instance_unregistered` or `instance_revoked`                                                                                                                                                                                                                                                                                                                                        |

The registry is a Durable Object, `RegistryDO` (`src/registry.ts`): one object per instance holds its record (status,
keys, terms, contact) and its pending code (hashed with the instance id), and one per contact address (named by the
SHA-256 of the address) counts the codes sent to it. Each check-and-change (a code compared and its try counted, a
key added or retired, a registration) is one synchronous call to the object, so parallel requests cannot interleave.
Keys are compared in one encoding (unpadded base64url of the 32 bytes), however a caller wrote them. An alarm an hour
after an instance's last code (a day after an address's) deletes an object with no record, and a registered
instance's spent code.

**Limits on codes.** Instance ids and keys are free, so: per caller IP (`CF-Connecting-IP`), 5 calls a minute on
every `/v1/instances*` route (`429 rate_limited`, the `CODE_LIMIT` rate limiting binding); per instance, 3 codes an
hour; per address (lowercased), 3 an hour and 10 a day from every instance together. An instance refused for itself
(revoked, already registered, over its own limit) costs the address nothing, and a slot is given back when no code
went (the instance lost a race for its last code, or the email failed). The address limit bounds one address string,
not a mailbox: plus-addressing and aliases count apart, which the per-IP limit covers.

**Known limit:** since instance ids are free, anyone can use up an address's 10 codes for the day. Its owner may then
have to register with another address, or a plus-address of the same mailbox, until the day passes; the per-IP limit
slows such an attacker but does not stop one with many addresses.

A key missing from a cached record is looked up again before it is refused (another isolate may have added it); if
that lookup fails, the answer is `503 registry_unavailable` (except on `/v1/send` with the original key, below).

Every `/v1/` path answers `503 not_configured` without the `REGISTRY` binding, and `503 registry_unavailable` when
the object cannot be reached: registration and anything that grants a capability fail closed. Only the send path's
check of the original key (`checkSender`, on `/v1/send`) fails open, so a registry outage never stops a page: when the
read fails, it skips the revoked and retired-key checks. A rotated key still fails closed. Records that
exist are cached per isolate for 60 s (a revocation takes up to a minute to apply); a missing one is never cached.
`/send` and `/health` do not use any of this.

Nothing to create by hand: the binding, its migration and `CODE_LIMIT` are in `wrangler.jsonc` (top level and
`env.dev`), and the deploy creates the class. `CODE_LIMIT` may be dropped from the config (an own relay, say): the code
treats it as optional and then limits nothing per IP. For the hosted relay's contact code, the `send_email` binding
(`"send_email": [{ "name": "EMAIL" }]`) and `EMAIL_FROM`, a bare address on a domain onboarded to Cloudflare Email
Sending (as `apps/api`), are still to be added; until then `/v1/instances/contact` answers `503 not_configured`.
`RELAY_TERMS_VERSION` is a var (`draft-2026-11`, RFC 0015 decision D5).

**Closed registration** (`RELAY_REGISTRATION=closed`, a company's own relay, RFC 0015 section 8): no terms, no
emailed codes. `/v1/instances/contact` answers `403 registration_closed`. `POST /v1/instances`, still signed with the
instance key, registers the signer's original key only when it also carries the relay's admin secret,
`Authorization: Bearer <RELAY_ADMIN_TOKEN>` (compared in constant time, `src/auth.ts`): `201 { instance, status,
terms: "none", termsCurrent: true }`, with `contact` optional (`400 invalid_contact` if malformed) and the body's
`terms` and `code` ignored. Without the header it is `403 registration_closed`; with a wrong token, or any token while
`RELAY_ADMIN_TOKEN` is unset, `401 admin_unauthorized`; a key that is not the instance id's original one `403
instance_unregistered`. A registered instance gets its record (`200`) with or without the token. A closed relay does
not need `RELAY_TERMS_VERSION`. An open relay ignores the header. `vp run setup:relay` (choice "your own relay",
apps/api README "Push relay") deploys the relay with `RELAY_REGISTRATION=closed`, makes the admin token and
registers the instance with it, then deletes it (`RELAY_ADMIN_TOKEN` unset: nothing more registers); running it again
makes a new one. It also sets `BRIGADE_OWN_RELAY`, a marker with nothing secret in it: a relay Worker without it was
not set up by the script, and the script does not deploy over it without `--take-over-relay`.

## Handles and /v1/send

RFC 0015 sections 2 and 3 (`src/handles.ts`, `src/v1.ts`). The app asks the relay for a **handle**, its tokens sealed
for one instance, and gives the instance only that; the instance sends with the handle, signed with its key. Nothing
is stored: the relay opens the handle on each send.

| Route                   | Who                               | Body                                                                           | Answers                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/handles`      | The app, unsigned                 | `{ instance, platform, environment, pushToken, voipToken? }`                   | `200 { handle, tag }`; `400 invalid_body`; `403 instance_unregistered` or `instance_revoked`; `503 registry_unavailable` (fails closed: an unknown id never gets a handle); `429 rate_limited { limit: "ip" }`                                                                                                                                                                                    |
| `POST /v1/send`         | The instance, signed              | `/send`'s body with `handle` instead of `deviceToken`/`platform`/`environment` | As `/send` (`200`, `502` with the provider's reason, `400 invalid_body`, `500 relay_misconfigured`), plus `401 bad_signature`/`missing_signature`/`stale_timestamp`, `400 bad_handle`, `403 handle_not_yours`, `403 instance_revoked`, `429 rate_limited { limit }` with `Retry-After`, `503 registry_unavailable` (a rotated key the registry cannot confirm)                                    |
| `GET /v1/health?deep=1` | The instance, signed (empty body) | none                                                                           | `/health?deep=1`'s `{ ok, apns, fcm }` plus `handles` (whether the handle keys are set and parse) and `instance`; `503` unless all are ok; `429 rate_limited { limit: "ip" }` (before the registry is read), `401` for a bad signature, `403 instance_unregistered`/`instance_revoked`, `503 registry_unavailable`, `429 rate_limited { limit: "instance" }`. Without `deep=1`, `200 {"ok":true}` |

**Minting.** `platform` is `ios` or `android`. On iOS `environment` (`sandbox` or `production`) is required and
`pushToken` (and `voipToken`, the PushKit token, for calls) are hex APNs tokens, lowercased before sealing; on
Android `pushToken` is the FCM token, `environment` optional, and there is no `voipToken` (a call rings through the FCM
token). Unknown fields are ignored, so a newer app still gets a handle. The handle is
`<key id>.<base64url(nonce ‖ AES-256-GCM ciphertext ‖ tag)>`, sealing `{ v: 1, instance, platform, environment,
pushToken, voipToken }` with the key id as additional data. The **tag** is base64url(HMAC-SHA-256(`RELAY_TAG_KEY`,
instance ‖ 0x00 ‖ pushToken)): the same for one token at one instance however many times it is sealed and whatever key
sealed it, different at every other instance. The instance compares tags where it compared tokens.

**Sending.** The signature is checked first (so no one spends another instance's limits), then the handle, with local
crypto only: one that does not open (tampered, sealed by another relay, a retired key id) is `400 bad_handle`; one
sealed for another instance `403 handle_not_yours`, which the instance treats like `BadDeviceToken`. Only then the
registry, so a made-up instance id (free to make) never forces a read. On the instance's original key the record is
read through the cache: revoked is `403 instance_revoked`; a record that no longer lists the key (retired after a leak)
is read again fresh and, if still missing it, `401 bad_signature`; a registry that does not answer is logged and
**fails open** (the handle could only have been minted for a registered instance). A rotated key must be confirmed by
the registry, else `503 registry_unavailable`, which the instance retries. Calls and Critical Alerts are still a page's
only, as on `/send`; a call to an iPhone handle without a VoIP token is `400 invalid_body`.

**Limits** (decision D4, Workers Rate Limiting, each binding optional): `SEND_LIMIT` 600 sends a minute per instance
id, `CALL_LIMIT` 60 calls a minute per instance id on top, `PHONE_LIMIT` 30 a minute per phone keyed by the tag (every
handle of one token counts together; not the handle, which differs on every sealing), `HANDLE_LIMIT` 60 handles a minute
per caller IP, `HEALTH_LIMIT` 120 signed deep health checks a minute per caller IP. A page is never exempt.

What counts: a binding cannot check without counting, so on `/v1/send` the limits are taken only after every other
check passed (signature, handle, registry, body), narrowest first: `PHONE_LIMIT`, then `CALL_LIMIT` (calls only), then
`SEND_LIMIT`. A send refused by one has counted against the ones before it and none after: refused for its phone, it
costs nothing else; refused as a call, it has counted for its phone; refused for the instance, it has counted for its
phone and, if a call, the calls. A send that passed all of them counts against all of them even when APNs or FCM then
refuses it or cannot be reached. A signed deep health counts against `HEALTH_LIMIT` (before the registry is read,
whatever the answer) and, once the instance is admitted, as one send against `SEND_LIMIT` (it asks APNs).
`HANDLE_LIMIT` counts every mint request, a malformed one included.

`429 { error: "rate_limited", limit: "instance" | "calls" | "phone" | "ip" }`, always
`Retry-After: 60` (the binding does not say when its window ends). A limiter that throws lets the call through, logged.
Workers Rate Limiting counts per Cloudflare location and settles eventually, so the limits are approximate (Q28).

**The handle keys.** `RELAY_HANDLE_KEYS` is a JSON keyring, `{ "current": "<id>", "keys": { "<id>": "<32 random bytes,
base64url>" } }` (ids: 1 to 16 letters or digits). The current key seals; every key listed opens. To rotate, add a key
and make it `current`; keep the old one listed for at least 13 months (a phone opened once a year still works; each
registration re-seals with the current key). Drop a key early only if it leaked: then every phone must open the app once
to be paged again. `RELAY_TAG_KEY` is at least 32 random bytes, base64url, and **never rotates** (a new one changes every
tag, and the instance would take every phone for a new one). Without either secret `/v1/handles` and `/v1/send` answer
`503 not_configured` (and the deep health `handles: false`); one that does not parse is `500 relay_misconfigured`.
`/send` needs neither.

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

Optional, for Android: `FCM_SERVICE_ACCOUNT`, the Google service account's JSON key (see "Setting up FCM"). Not in
`secrets.required`, so a relay without it still deploys and serves iPhones.

Optional, for handles and `/v1/send` (see "Handles and /v1/send"): `RELAY_HANDLE_KEYS` (the keyring) and
`RELAY_TAG_KEY`. Not in `secrets.required` either, so `/send` keeps deploying without them.

Optional, for a company's own relay: `RELAY_ADMIN_TOKEN` (the secret that authorizes closed registration) and the var
`RELAY_REGISTRATION=closed` (see "Closed registration" above). `vp run setup:relay` sets both, with `APNS_TOPIC` as the
company's bundle id, passing the two vars as `wrangler deploy --var`; keep them in a copy's `wrangler.jsonc` `vars` so
a later deploy does not put the defaults back. Make each key with
`openssl rand -base64 32 | tr '+/' '-_' | tr -d '='` (32 random bytes in base64url) into the secrets file outside
the repository, never into this repository or a shell history.

The rate limits (`CODE_LIMIT`, `HANDLE_LIMIT`, `HEALTH_LIMIT`, `SEND_LIMIT`, `CALL_LIMIT`, `PHONE_LIMIT`) are config only, declared in
`wrangler.jsonc` for both environments with their own namespace ids; nothing to create.

```bash
vp run build:dev                                                          # builds the dev environment into dist/
bunx wrangler deploy --secrets-file ~/.config/brigade/relay-dev-secrets.json  # deploys it with its secrets
vp test                                                                   # JWTs, request builders, /send and /v1 (Node, fetch stubbed)
```

## The setup script

`scripts/setup-relay/` is `vp run setup:relay` (run from the root; apps/api README "Push relay" is the guide). It
lives here because it signs with `@freecorps/brigade-push/instance` and deploys this Worker; `flow.ts` is the flow,
with wrangler, fetch, files and the terminal passed in, and `index.ts` wires the real ones. `test/setup-relay.test.ts`
runs every flow against this relay's own `handle` (over the fake registry) and a fake wrangler: nothing reaches
Cloudflare, Apple or Google.

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
