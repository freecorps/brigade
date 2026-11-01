# RFC 0015 — One store app for every instance

- Status: Accepted (decisions D1–D5 below); the relay side and envelope version 2 on the phone (steps 1 and 2 of
  "Order of work") are built, and of step 3 the API side (handles in `device.register`, the notifier on `/v1/send`,
  `/config`, the watchdog's signed check) and `vp run setup:relay` with the relay's closed registration (section 8);
  of step 4 the app's data layer (instances, storage per instance, handles, page routing; section 5); the rest is not
- Builds on: RFC 0006 (push relay), RFC 0002 (auth, environments), RFC 0010 (calls)

## Problem

The store app talks to one Brigade: the origin baked in at build time (`EXPO_PUBLIC_BRIGADE_URL`,
`apps/mobile/src/lib/auth-client.ts`). And only an instance that holds `RELAY_SEND_TOKEN` can push to it, because APNs and
FCM accept only pushes signed by whoever published the app, and the relay trusts that token alone. The token can never
be given to a self-hoster: the instance receives raw APNs/FCM tokens, and with the send token it could push to any phone
with the app.

So today a self-hoster must build their own app, with their own Apple and Google accounts, and run their own relay.
That stays possible, but "self-host Brigade" must not mean "publish a mobile app". The goal:

> Someone installs Brigade from the App Store or Play Store, enters (or scans) their instance's address, signs in, and
> is paged, with no build, no Apple or Google account, and no secret from Freecorps.

## What stays as it is

- Encryption end to end (HPKE to the device key, RFC 0006): the relay never sees content.
- Device registration flows (`POST /devices/register`, `device.register`, several workspaces, sign-out); only what
  identifies the phone to the relay changes.
- Our own instance keeps its `RELAY` service binding.
- Running your own relay with your own app build: still supported, and made a choice in the setup script (section 8).

## Design

```
             (1) GET /api/config (the API's GET /config) → { brigade, relay }
App ───────────────────────────────────────────────────────────────────────────▶ Instance
App ──(2) POST /v1/handles { instance, platform, environment, pushToken, voipToken } ──▶ Relay
App ◀─(3) { handle, tag } ──────────────────────────────────────────────────────── Relay
App ──(4) device.register { id, handle, tag, publicKey, … } ────────────────────▶ Instance
Instance ──(5) POST /v1/send { handle, envelope, … }, signed with the instance key ─▶ Relay ──▶ APNs/FCM
```

### 1. Instance identity on the relay

Built (apps/relay `src/instances.ts`, `src/registry.ts`; signing in `packages/push` `src/instance.ts`): the signed
`/v1/instances` routes, the registry in `RegistryDO`, codes by email and the limits below. Handles, `/v1/send` and the
signed deep health are built too (sections 2 and 3, `src/handles.ts`, `src/v1.ts`).

- **The instance key.** Each instance has an Ed25519 key pair; the private key is a secret
  (`RELAY_INSTANCE_KEY`, PKCS#8, base64url), made by the setup script. Workers' WebCrypto signs with Ed25519.
- **The instance id** is derived from the first public key: `ins_` + base64url(SHA-256(publicKey))[0..22]. Stable for
  the instance's life, even after a key rotation (below).
- **Every call is signed.** Headers `Brigade-Instance`, `Brigade-Key` (the public key), `Brigade-Timestamp` (Unix
  seconds) and `Brigade-Signature` (Ed25519, base64url) over
  `METHOD \n path-with-query \n instance \n timestamp \n hex(SHA-256(body))`: the method in upper case, the path
  with its query string (`/v1/health?deep=1`), the instance id (so a request cannot be re-addressed to another
  instance that lists the same key), the timestamp in decimal Unix seconds, and the lower-case hex SHA-256 of the exact
  body bytes (of no bytes for a request without a body). The relay refuses a timestamp more than 5 minutes off. Replays inside that window only repeat a push and stay under the rate limits; no nonce
  store.
- **Checking a signature needs no storage on the paging path.** If SHA-256 of the presented key gives the instance
  id, the key is the original one: the signature proves who signed, and the send path only asks the registry (through
  the 60 s cache) whether that key was retired since, the same read as revocation. A record that no longer lists it
  (retired after a leak) is read again fresh, and the key is refused (`401 bad_signature`) if it is still missing; a
  read that fails lets the send through (fail open, logged), so a registry outage never stops the pages of an instance
  on its original key. A rotated key needs a lookup to be accepted at all
  (below): the instance's key list, cached per isolate for 60 s. A key missing from the cached list is looked up again
  in the registry before it is refused, so a key added a moment ago works at once; only the registry's own answer
  refuses it. On a send, a rotated key the registry cannot confirm (not in a cached list, and no answer) is
  `503 registry_unavailable`, which the instance retries like any relay error: a
  registry outage delays the pages of an instance that rotated its key, and never lets an unconfirmed key through. An
  instance on its original key is not affected.
- **Registration** (`POST /v1/instances`, signed): records the instance in the relay's registry (a Durable Object per instance, `RegistryDO`, so a check and its update are one atomic
  step: the code's tries, key changes and revocation never race) with the
  terms version accepted and a contact address (where Freecorps writes before limiting or revoking). **Decided
  (D3):** an instance must register, and so accept the terms, before it can mint handles or send: an unknown id
  answers `403 instance_unregistered`. Registering, minting a handle and rotating keys read the registry and **fail
  closed** when the registry cannot answer (`503 registry_unavailable`): an unknown id never gets a handle. A send needs no
  registration read, because the handle it carries could only have been minted for a registered instance; it checks
  only revocation (below) and that the key was not retired. The handle is opened and matched to the signed instance
  first (local crypto), so a made-up instance id never reaches the registry.
- **Revocation** is a registry entry (`revoked`), read through a per-isolate cache of 60 s. On a send, a registry
  read that fails is _fail open_ (not revoked, logged): a registry outage must not stop every self-hosted page. Everything
  else fails closed.
- **Key rotation.** `POST /v1/instances/keys`, signed with a key the instance already has and carrying a signature by
  the new key over the instance id (proof that the caller holds it), adds a new key (and later retires the
  old one). A rotated key is looked up in the registry (cached). Losing the key without rotating means a new instance
  id: every phone pairs again the next time it opens the app (see "Dead ends").

### 2. Handles

- **What a handle is.** The relay seals `{ v, instance, platform, environment, pushToken, voipToken }` with its own
  AES-256-GCM key (`RELAY_HANDLE_KEYS`, a keyring with key ids) and answers it as an opaque string. Nothing is stored:
  the relay opens the handle on each send. The instance never sees an APNs or FCM token.
- **Bound to the instance.** A send whose signed instance is not the one sealed in the handle is
  `403 handle_not_yours`. A handle taken from one instance is useless to another.
- **The tag.** Since every sealing uses a fresh nonce, two handles of the same token differ. The relay also answers
  `tag` = HMAC-SHA-256(`RELAY_TAG_KEY`, instance ‖ 0x00 ‖ pushToken), base64url: a key of its own that never
  rotates with `RELAY_HANDLE_KEYS` (a rotation must not change every tag), the same for the same token at the same instance and nothing at
  another. The instance uses it where it compares tokens today: "the same token under a new id replaces the old
  device", and `device.expire` "only if its token is still the one the push went to".
- **Who asks for it.** The app, straight to the relay. Never through the instance, which must not see the token. The
  relay learns the phone's IP address when it does; the terms say so.
- **When (decided, Q30).** The app keeps the handle it was given, per instance, with the tokens it was sealed for and
  when it got it, and asks the relay for a new one only when its push or VoIP token changed (APNs, PushKit or FCM; the
  APNs environment too), the instance's relay origin or instance id changed (`/config`), or the kept handle is older
  than 30 days. So a new token always comes with a new handle, a VoIP token that arrives later gets a new handle with
  both tokens, and a relay key rotation reaches every phone within 30 days of its next registrations without the app
  knowing the key id (the relay keeps old keys at least 13 months); a registration with nothing changed (launch,
  foreground, Try again) sends the handle it has, the same row, and emits no `device.registered`. A relay that does
  not answer when a handle is only too old keeps the old one in use (it still opens) and is asked again on the next
  registration. `device.register` refuses a handle only with `invalid_args` (the instance never opens a handle); the
  app then drops it, registers the raw tokens in the same try and asks for a new handle next time. The relay's own
  refusals come at send time (section 7): `handle_not_yours` expires the device, which the app sees as its device
  leaving the open workspace's shard and drops the kept handle before registering again.
- **Abuse of minting.** Anyone may ask for a handle for any token, for their own instance only. That is harmless
  without a real token, which only the phone and the relay ever see (and our own instance until migration, below).
  Rate limited per IP.
- **Rotating the relay's key.** Handles carry the key id; the relay keeps old keys to open handles for at least 13
  months (a phone opened once a year still works), and the phone asks for a handle again once its own is 30 days old
  (Q30), which the current key seals. Only a leaked
  key is retired early, and then every phone needs opening once (the same as a lost instance key).

### 3. Sending

- `POST /v1/send` takes `handle` where `/send` takes `deviceToken`/`platform`/`environment`; everything else (kind,
  urgency, call id, critical, TTL, collapse id, envelope) is unchanged, and so are the answers, plus `403
  handle_not_yours`, `401 bad_signature`, `403 instance_revoked`, `429 rate_limited` (with `Retry-After`).
- `GET /v1/health?deep=1` is signed the same way, so the watchdog's deep check (RFC 0007) works for a self-hosted
  instance.
- **Limits.** The real risk is shared fate: an instance flooding APNs can get the whole app throttled by Apple, for
  everyone. So: per instance (Workers Rate Limiting, keyed by instance id) a generous limit (proposal: 600 sends a
  minute, calls 60 a minute), and per phone 30 a minute from each instance, keyed by the tag (instance and token),
  not by the handle, which differs on every sealing. A page is never exempt, since every caller can say `page`;
  the limits are well above any real incident. **Decided (D4)**, raised on request. As built: each limit answers
  `429 rate_limited` with `limit` (`instance`, `calls`, `phone`) and `Retry-After: 60`. A binding cannot check without
  counting, so the limits are taken narrowest first, each only after every other check passed: per phone, then calls,
  then per instance. A send refused by one limit has counted against the narrower ones before it, never the wider ones
  after (a send refused for one phone costs the instance nothing; one refused as a call has counted for its phone); a
  send that passed all three counts against all three even if APNs or FCM then refuses it. A signed deep health counts
  as one send (it asks APNs) and, before it reads the registry, against a per-IP limit (`HEALTH_LIMIT`, 120 a
  minute). Minting is 60 a minute per IP (`HANDLE_LIMIT`, Q28). A limiter that fails lets the call through.
- **The old `/send`** stays for our instance with `RELAY_SEND_TOKEN`, until no supported app version sends raw
  tokens (below), then goes.

### 4. The sealed page says who sent it

RFC 0006 already says the envelope must, before production, seal the time, the instance and the urgency. This is the
moment, and it is what makes several instances on one phone safe:

- Plaintext gains `iat`, `exp` (`iat` plus the TTL the instance sends to the relay, so a custom `ttlSeconds` is
  sealed too), `origin` (the instance's origin) and `urgency`. The extension and the Android service take the
  interruption level from the sealed urgency (not from the clear `aps` field), treat a page opened after its sealed
  `exp` as the fallback, and post the receipt and the Acknowledge only to the sealed origin, and only if the phone is paired with it.
- **One device key per instance** (keyed by the instance's origin, App Group Keychain and Android Keystore aliases).
  Then instance A, which holds only its own device key, cannot seal a page that opens as instance B's. The clear part
  of the payload names which key (`brigade.k`, a short key id) so the extension tries one key. Since the device id
  comes from the key, the phone is a different device at each instance, which is what they should see.

**Built (step 2): envelope version 2 and keys per instance on the phone.** The instance (step 3, section 7) seals
version 2 for a device registered with `envelope: 2`, version 1 for any other; the app opens both.

- **The envelope.** `{ v: 2, k, enc, ct }` (packages/push `sealPushV2`, `PushEnvelopeV2`): the same HPKE suite under
  its own `info`, `"app.freecorps.brigade push v2"`, so a v2 ciphertext relabelled v1 (or the other way round) does
  not open. The plaintext is v1's plus `iat` (Unix seconds), `exp` (`iat` + the TTL the instance gives the relay, 0 to
  30 days), `origin` (the instance's origin as `URL.origin` writes it: where the app signs in, the dashboard's) and
  `urgency`. A receipt not on that origin is left out at sealing. The relay carries it as it is (`parsePushEnvelope`
  takes both versions; FCM's `data` gains `k`).
- **The key id** (`pushKeyId`): base64url of the first 6 bytes of SHA-256 over the uncompressed device public key
  (65 bytes), 8 characters. Only a hint (the AEAD decides), so 48 bits are plenty among a phone's few keys; not the
  device id (the key's x coordinate), so the relay cannot tie a push to a device row. One test vector is checked by
  packages/push's and the Kotlin tests (in CI) and by the Swift script below (by hand, on a Mac).
- **What the phone does** (packages/push `openOnPhone` is the reference; `BrigadePushCrypto.swift`,
  `PushPayload.kt`/`Pages.kt` follow it): v1 is tried with each key, the paired instance's first, as before. v2 is
  tried with the key `k` names only; then refused if opened more than 5 minutes (clock skew) past its `exp`, if
  sealed for another origin than its key's, or if the phone is not paired with that origin (today: the instance the
  app registered with, `setReceiptOrigin`, which the app forgets on an explicit sign-out, `clearReceiptOrigin`; a
  list with step 4). **Every refusal, an unknown key id included, shows the fallback text, never silence**; a VoIP
  call already reported to CallKit keeps its fallback name. The sealed urgency sets the interruption level (iOS) or
  channel (Android) of **a push that opens**: shown, or refused for another origin or pairing (the fallback, then no
  louder than sealed, so the relay cannot make a refused `low` push ring as a page or a Critical Alert). A page is
  time-sensitive and keeps a Critical Alert, anything less is `active` with the default sound (Android: the updates
  channel). A push that does not open (unknown key, AEAD failure, malformed) or opened expired keeps the level the
  relay set in clear: loud, so a phone clock running ahead never quiets a page, and the relay still decides those.
  A call push whose sealed urgency is not a page does not ring: iOS still reports it to CallKit first (iOS stops
  delivering VoIP pushes to an app that does not), ends it as soon as CallKit has it and shows the fallback text,
  `active`; Android shows the fallback text at the sealed urgency. The receipt goes only to the sealed origin, and the
  Acknowledge action only there (`page.origin` in the notification, the page CallKit's fallback posts included,
  checked by `page-action.ts` against the app's instance). Origins compare
  as `URL.origin` writes them on every side (an IPv6 host keeps its brackets; Android reads the authority itself, so a
  host with `_` works), and an origin the native side refuses falls back to the key from before.
- **Keys per instance.** The app asks for the key of its instance's origin (`getInstancePublicKey`, `devicePublicKey`
  in `src/lib/device.ts`). iOS keeps one Keychain item per origin (account `device-key-v2 <origin>`, App Group,
  after first unlock, this device only); the key from before (`device-key-v1`) is moved to the paired instance's
  origin (any first origin asked for when none is paired) in one `SecItemUpdate`, so it is the same key and the same
  device id (an update that fails is an error, never a new key that would change the device id). Android cannot
  rename a Keystore alias: each origin gets its own slot (alias `…device-key.v2.<slot>`, or the wrapped file,
  `<slot>` from SHA-256 of the origin), and the paired instance (any first origin when none is paired) claims the
  old key (`legacy-key-origin` in the app's preferences). Another origin gets a new key, so the instance the phone is
  registered with keeps the key it holds. Either way phones in the field keep paging, and the device id still comes
  from the key.
- **Tests:** packages/push `tests/envelope-v2.test.ts` (round trip, tampering, versions not crossing, expired, wrong
  origin, not paired, unknown key, how loud each fallback is, the key id); the Kotlin on the JVM
  (`EnvelopeV2Test.kt`, a page sealed by packages/push, the channel rule, origins). **The Swift is not tested in
  CI** (CryptoKit's HPKE needs an Apple OS): `apps/mobile/modules/brigade-push/ios/tests/main.swift` opens the same
  sealed page and covers each refusal, the fallback's level, the key id and origins, run by hand on a Mac (the
  commands are in the file; the pod compiles `ios/*.swift` only, so it stays out of the app). In CI,
  `apps/mobile/src/lib/envelope-v2.test.ts` only checks the Swift and Kotlin sources against packages/push (constants,
  each refusal leading to the fallback). Open points: Q29.

### 5. Instances in the app

- **Adding one.** The first sign-in screen, and later "Add an instance" in the account section, offer the hosted
  Brigade (default) and "Another instance": an address field, or a QR code from the dashboard's "Use the app" page
  (address only, or address and sign-in: section 6).
- **Checking the address.** HTTPS only (development builds also allow `http://` on a private address). The app reads
  `GET /api/config` on the dashboard's origin (the API's `GET /config`, which the dashboard serves under `/api`, as the
  app's `brigadeServer` already does) and needs `brigade` (the API version and the oldest app it supports) and `relay`
  (`{ origin, instance }`). Answers:
  - not a Brigade → "This address is not a Brigade instance";
  - `relay.origin` not this build's relay → "This instance uses its own app build" (its pages could never reach this
    app; it would sign in and never be paged);
  - no `relay` (no push set up, or an instance from before this) → sign-in allowed, with "This instance cannot page
    this phone" in the account section and no device registration;
  - the app older than the instance supports → "Update the app".
- **Before signing in**, the screen names the host in full ("You are signing in to brigade.example.com"), so a QR
  from a stranger is visible as such.
- **Several at once (decided, D1).** A phone is signed in to several instances and paged by all of them, as a
  consultant or an MSP on call for two companies needs. Looking at one never stops the others' pages, the rule the app
  already follows for several workspaces (RFC 0006 "Several workspaces").
  - **Storage is per instance.** Each instance has its own Better Auth client and session (secure storage prefix
    `brigade:<instance id>`), its own Brigade Sync clients, its own list of workspaces this phone is registered in,
    its own device key and its own pending sign-out. Nothing of one instance is sent to another.
  - **Registration runs per instance**, each on its own backoff: a failing instance never holds back another.
  - **Opening a page.** The sealed `origin` (section 4) says which instance a notification is from: a tap, the
    Acknowledge action, a call answered and the receipt all go to that instance, with its session, whichever one is
    open in the app. A page from an instance the phone is no longer signed in to shows the fallback text and sends
    nothing.
  - **The switcher.** Instance and workspace are one list ("Freecorps · Production", "Acme · Ops"), grouped by
    instance, each with its paging state. The incident list shows the open one; a notice names any other where this
    phone is not paged or where a page is unacknowledged.
  - **The widget and "I'm on call"** say where the member is on call across instances ("On call in Acme · Ops").
  - **Removing one** signs out of it (which unregisters the phone there, as today) after a warning when the member is
    on call there now. The others are untouched.
  - **At most 5 instances** per phone: each costs sockets, battery and a device key.
- **What follows the instance.** The Better Auth client, Brigade Sync, the device routes, the receipt origins (a list
  in the App Group and Android preferences instead of one), the Acknowledge, "Forgot your password?"
  (`brigadeServer`) all take the instance's origin instead of the build's.

**Built (step 4, first slice): the data layer.** apps/mobile `src/lib/instances.ts`, `src/lib/instance-clients.ts`,
`src/lib/relay.ts`, `src/components/session.tsx`; the native lists in `BrigadePushCrypto.swift` and `Pages.kt`/
`PushPayload.kt`. The screens to add, switch and remove instances, the address checks and QR sign-in come next; until
then the app shows the build's default instance. As built:

- **The list** (`brigade.instances` in secure storage): at most 5, one active. With nothing stored (every install from
  before), it is the build's default instance alone (id `default`, origin `EXPO_PUBLIC_BRIGADE_URL`, or the dev
  server), and reading it writes nothing. The default instance keeps the keys from before (`brigade` as Better Auth's
  prefix, `brigade.workspaces`, `brigade_workspace`, the pending-change folder), so an existing install stays signed
  in with its workspaces, queue and device key; every other instance has `brigade:<id>` and keys and a folder of its
  own. The default instance's origin follows the build, as before. A list that cannot be read is never overwritten.
- **Sessions.** The active instance is shown (its own Better Auth client, sync clients, queue, kept workspace).
  Every other instance with a signed-in member registers in the background: its own `POST /devices/register` (or the
  open workspace's shard over a socket of its own, for an instance from before the route), its own registration cycle
  and backoff, and the kept sign-outs of its origin finished. A new APNs or FCM token, heard by the one token listener
  or fetched first by any instance's registration, nudges every instance's cycle. Signing out of one forgets only its
  workspaces, queue, draining clients and receipt origin.
- **Handles** (`src/lib/relay.ts`). Each registration reads the instance's `/config`: no `relay` (or an instance from
  before step 3) gets the raw tokens, as before, with `envelope: 2` when `/config` has `brigade`; `relay.origin` this
  build's relay gets `handle`, `tag`, `voip` and `envelope: 2`, no raw token; another relay is `foreign`: nothing is
  registered and the paging state says "This instance pages through its own app" (the build's default instance is never
  foreign). A relay that refuses or does not answer gets the raw tokens, unless the kept handle is for the same relay,
  instance id and tokens and only old, which is kept; a `/config` that does not answer keeps the handle for these
  tokens. Refused forms (`invalid_args`) fall back in the same try: the raw tokens instead of a handle, then without
  `criticalAlerts` and `envelope` for an older instance. The device leaving the open workspace's shard drops the kept
  handle, so a handle the relay refused at send time (`handle_not_yours`, the device expired) is minted anew.
- **This build's relay** (Q32): `EXPO_PUBLIC_BRIGADE_RELAY_URL`; unset, the store build (default instance
  `https://brigade.freecorps.com.br`, or none) uses `https://relay.brigade.freecorps.com.br`, any other build its
  default instance's `/config` `relay.origin`, asked again while it does not answer (meanwhile another instance with a
  relay gets the raw tokens).
- **Opening a page.** The native side keeps the paired origins as a list (`receipt-origins-v2`, the origin from before
  first, so it alone may claim the key from before keys per instance); `setReceiptOrigin` adds, `clearReceiptOrigin`
  removes one; an older binary without the list (no `receiptOriginList`) is paired with the build's default instance
  only. A v2 page opens and sends its receipt only for a paired origin; a v1 page, which seals no origin, sends its
  receipt only to the first paired origin (the instance from before several instances, the only one that can be
  sealing v1 for this build's phones; an older instance added later loses receipts, not pages). The Acknowledge goes to the instance at
  the sealed origin with its session (nothing when the phone has none there); an answered call's ack goes over the
  socket for the shown instance and workspace, else over HTTPS to its own (the call carries `workspace` and `origin`
  now); an Android tap switches to the sealed instance, then the workspace (the tap's proof signs the origin).
- **Tests:** apps/mobile `instances.test.ts`, `relay.test.ts` (each handle trigger, the fallbacks, `foreign`, the
  build's relay), `registration.test.ts` (handles against the real `device.register`, refusals, backoff per instance),
  `page-routing.test.ts`, `page-taps.test.ts`, `auth-client.test.ts` (the default instance's session, prefixes);
  `EnvelopeV2Test.kt`/`PageTapTest.kt` and `ios/tests/main.swift` for several paired origins.

### 6. Signing in with a QR code (decided, D2)

A signed-in member opens "Use the app" on the dashboard and gets a QR code that adds the instance **and** signs the
phone in as them, with no password typed on the phone. It is a credential on a screen, so it is built as a device
approval, not as a token anyone holding the picture can use.

1. The dashboard asks for a code (`POST /api/app-sign-in`, with the session). The server keeps a 128-bit random code,
   hashed, for **2 minutes**, single use, bound to that user and session. The QR is
   `brigade://connect?server=<origin>&code=<code>`.
2. The phone scans it **in the app** (the scanner on the sign-in screen), shows "Sign in to <host>?" and, once
   confirmed, claims it (`POST /api/app-sign-in/claim` with the code and its device name). The claim answers a
   **2-digit number** and the code is spent: a second claim fails.
3. The dashboard, waiting on the same request, shows "<device name> wants to sign in as you" and asks the member to
   **type the number the phone shows**, or Deny. The dashboard never shows the number, so there is no blind
   "Approve": whoever took the picture has the number on their own phone, and the member, whose phone shows none,
   has nothing to type. One wrong number ends the claim.
4. Approved, the phone's next poll (`GET /api/app-sign-in/claim/:id`, with a secret the claim gave only to it) gets
   a new Better Auth session, made server side for that user; denied or 2 minutes passed, it gets `expired`.

Threats and what answers each:

- **A photo or screenshot of the QR** (shoulder surfing, a screen share, a "support" request): the 2-minute life and
  the approval with the typed number. The page says "Never share this code, nor the number your phone shows". A
  member talked into reading the number to someone is phished; nothing on a screen can prevent that, the same as a
  one-time password read aloud.
- **Another app catching the link** (a custom scheme can be claimed by any app on Android): the code is useless
  without the member typing the number, which only the phone that claimed it shows. Scanning with the system camera
  opens the app the same way and gets the same check.
- **A QR planted by an attacker** (signing the victim into the attacker's account on the attacker's instance, to page
  them with made-up incidents or collect what they type): the phone names the host and the account before it
  finishes ("Signed in to evil.example as …") and the instance is listed in the switcher like any other, removable.
  The same risk exists with the address alone; nothing more is exposed.
- **Brute force on the code**: 128 bits, single use, the claim route rate limited per IP.
- **Second factor**: the dashboard session passed whatever sign-in the account requires; the phone gets a session of
  the same strength, made only with the member's approval.
- **The session made** is an ordinary one, listed and revocable like any other; the approval is written to the
  account's sessions with the device name.

The address-only QR (`brigade://connect?server=<origin>`) stays for an instance whose sign-in happens elsewhere
(SSO later, RFC 0002), and the address field for everyone else.

### 7. The instance side

- `device.register` takes `handle` and `tag` instead of `pushToken` and `voipToken` (`voip: true|false` says whether
  the handle can ring). The `devices` table gains `handle`, `tag`; `push_token`/`voip_token` stay nullable for old
  apps.
- The notifier sends `handle` to `/v1/send` when the device has one, `deviceToken` to `/send` otherwise.
- `GET /config` adds `brigade` (versions) and `relay` (`origin`, `instance`, and `app`, the own build's store link
  when there is one; nothing secret).
- Config: `RELAY_URL` (the hosted relay, or the instance's own) and `RELAY_INSTANCE_KEY`, both set by
  `vp run setup:relay` (section 8).
- The watchdog (RFC 0007) treats `instance_registration_pending`, `instance_unregistered`, `instance_revoked`, `bad_signature`
  and `rate_limited` from the relay's deep health as `degraded`, with the reason, so the operators are emailed.

**Built (step 3, the API side).** apps/api `src/relay-instance.ts`, `src/notify.ts`, `src/watchdog.ts`; packages/schema
`src/devices.ts`; `importInstanceKey` in packages/push `src/instance.ts`. As built:

- **`device.register`** takes `handle`, `tag`, `voip` and `envelope: 2` (Q29) next to the raw tokens, which stay
  accepted (our instance's phones in the field). At least one of `pushToken` and `handle`; a handle with its tag;
  `voip` only with a handle, a VoIP token only with a push token. Both at once are accepted, for an instance moving
  (section 9). Every field is written on each registration (null when not given), so a phone moving from raw tokens
  to a handle keeps nothing of its tokens. Rows are JSON documents in the shard (apps/api `src/store.ts`), so the new
  fields need no migration; `pushToken` is null for a handle alone. The same tag under a new id replaces the old
  device; a raw token never matches a tag. `device.expire` takes the `handle` the push went to (or the token, as
  before), not the tag: a phone that registered again mid-flight has a new handle for the same token and tag, and is
  kept. With `handleOnly` (`handle_not_yours`) a device that also has a raw token keeps it and loses only its handle
  (`device.handle_cleared`). `device.expireVoip` takes the `handle` a call went to, since a registration with a new PushKit token
  keeps the tag, and turns `voip` off. `envelope` takes any whole number from 2 (a later app may open more) and is
  stored as 2, the newest this instance seals.
- **The notifier** sends a handle device to `/v1/send`, signed with `RELAY_INSTANCE_KEY` (through the `RELAY`
  binding or at `RELAY_URL`), and a raw-token device to `/send` with `RELAY_SEND_TOKEN`. A device with both goes
  through `/send` when `/v1/send` refuses the instance itself, so a broken instance key never costs a page `/send`
  can still deliver (and on `handle_not_yours` its handle is dropped). A handle device on an instance without the key
  is `not_configured`. After a key rotation `RELAY_INSTANCE_ID` names the first id, which the API signs as and
  `/config` gives (section 1: the id never changes). For `envelope: 2` it seals
  v2 with the dashboard's origin (`DASHBOARD_URL`; v1 without it) and sends the relay the TTL it sealed (15 minutes
  for a page, an hour for less, 60 s for a call). Answers: `403 handle_not_yours` expires the handle (the device,
  with a handle alone) by the handle the push went to; `401`, any other `403`, `404` (a relay without `/v1`), `500
  relay_misconfigured`, `503` and `400 bad_handle` are the instance's or the relay's, not the phone's: through `/send`
  for a device with a raw token, else retried within the page's attempts, never expiring anything, then recorded as
  not paged (`notification.failed`), so the email notifier and the rest of the ladder go on; `429` is retried no
  sooner than its `Retry-After` (at most 300 s). **`bad_handle` is not taken as proof the phone is gone** (a
  deviation from "Dead ends"): a handle the relay minted stops opening only when the relay lost a key from
  `RELAY_HANDLE_KEYS`, and on the hosted relay one bad deploy would otherwise drop every instance's phones; a phone
  that moved to another relay registers a new handle when it opens.
- **`GET /config`** adds `brigade: { api, minApp }` (`api` 1, `minApp` the oldest app version supported, `0.1.0`)
  and, with the instance key and a public `RELAY_URL` (https), `relay: { origin, instance, app? }`, `app` from
  `RELAY_APP_URL`. With the `RELAY` binding, `RELAY_URL` is only that address.
- **The watchdog** asks the signed `GET /v1/health?deep=1` when the instance key is set: `relay_bad_signature` (also
  for a key that does not read), `relay_instance_unregistered`, `relay_instance_revoked`, `relay_rate_limited` and
  `relay_handles_unavailable` (the relay answers `handles: false`), each but the limits degrading at once; a relay without `/v1`
  is `relay_handles_unavailable` too, with the send token's old check for the providers and the raw-token phones. With `RELAY_SEND_TOKEN` set too, the send token's cheap check runs beside it
  and both reasons count (section 9: most phones still page through `/send`). `rate_limited` degrades only on the 3rd
  beat in a row: the signed check is limited per caller IP (`HEALTH_LIMIT`), and instances on Workers may share
  Cloudflare's egress addresses (Q28). The relay has no pending state to answer (registration completes with the
  emailed code), so `instance_registration_pending` is not a reason: an instance not registered yet is
  `instance_unregistered`.
- **What the phone sees of a refused handle.** `device.register` never opens a handle, so it refuses one only by its
  form (`invalid_args`). At send time `handle_not_yours` expires a handle-only device (`device.unregistered`, its
  summary gone from `member_devices`), which the app sees for the open workspace and answers by dropping its kept
  handle and registering anew. Not seen: the same in a workspace or instance the app does not show (no synced device
  list there; the app's handle is replaced at its 30-day refresh, or when it next opens that workspace), and `bad_handle`,
  which the instance deliberately never treats as the phone's (above): a relay that lost a key leaves those phones
  unpaged until their handle's 30-day refresh. Closing this needs the instance to tell the phone (a field in the
  `/devices/register` answer, say); not built.
- Decided, Q30: the instance keeps storing the handle it is given (the newest carries a relay key rotation); the
  churn is avoided on the phone, which asks for a new handle only when its push or VoIP token changed, the instance's
  relay origin or instance id changed, or its handle is older than 30 days, and drops a handle `device.register`
  refuses (section 2; built with step 4, section 5).

### 8. Which relay: Freecorps' or your own

A self-hoster picks one of two relays, and both run the same `apps/relay` code and the same `/v1` protocol:

- **Freecorps' relay (the default).** Works with the store app. Registration and terms are required (D3, D5).
- **The company's own relay.** For a company that does not want any third party on the paging path. **It only works
  with the company's own app build:** APNs and FCM accept a push only when it is signed with the credentials of
  whoever published the app, so a relay with the company's Apple and Firebase keys can reach only an app the company
  built and signed (its own bundle id, App Group, extensions). The store app cannot be paged by it, whatever we build.
  The script and the docs say this before anyone picks it.

**The setup script** (`vp run setup:relay`, the "relay registration" step of the self-host wizard, roadmap Phase 4)
asks which, and can be run again later:

1. **Freecorps' relay (recommended).**
   - Shows the terms' address and summary and asks to accept them.
   - Asks for a contact address. The relay emails it a 6-digit code (valid 15 minutes, 5 tries; at most 3 codes an hour
     per instance and per address, so free instance ids buy neither more mail to one address nor more guesses), which the script
     asks for: the contact is real, and it is the "sign-in" to the relay. No API key to copy or leak: the instance's
     key pair is its credential.
   - Makes the instance key, registers it (`POST /v1/instances` with the terms version, the contact and the code),
     sets `RELAY_INSTANCE_KEY` and `RELAY_URL`, and runs the relay's deep health to show it works.
2. **Your own relay.**
   - Lists what it needs first, and stops if any is missing: an Apple Developer account with an APNs key (`.p8`, key
     id, team id), a Firebase project and its service account JSON for Android, and the bundle id of the company's app
     build.
   - Deploys `apps/relay` to the same Cloudflare account, sets its secrets (`APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`,
     `RELAY_APNS_TOPIC`, `FCM_SERVICE_ACCOUNT`, `RELAY_HANDLE_KEYS`) and turns its registration to this instance only
     (`RELAY_CLOSED=1`, also a secret; the instance registered directly by the script, no terms or email).
   - Binds the relay to the API as `RELAY` (no hop over the internet, as on our instance) and sets the instance key.
   - Points to "Your own app" in the docs (apps/mobile README): the EAS build with the company's bundle id, App
     Group, relay address and store accounts. That build is the company's to publish (or to hand out through
     TestFlight, an MDM or an internal store). The bundle id and Android package are the build variable
     `BRIGADE_APP_ID` (default `app.freecorps.brigade`, apps/mobile `plugins/app-id.ts`), and the App Group is derived
     from it, `group.<BRIGADE_APP_ID>`, written into each target's Info.plist for the Swift code (Q32). The relay
     address is `EXPO_PUBLIC_BRIGADE_RELAY_URL` when set; unset, a build whose default instance
     (`EXPO_PUBLIC_BRIGADE_URL`) is not Freecorps' hosted Brigade takes that instance's `/config` `relay.origin`, and
     the store build Freecorps' relay (Q32, built with step 4, section 5).
   - Asks for the build's store link (optional, `RELAY_APP_URL`), so the store app can send people there (below).
3. **Not now.** No push; the email notifier still pages, and the dashboard says phones are not paged.

**Switching relays** changes where every handle came from: each phone must open the app once to be paged again, and
a switch to an own relay leaves the store app unable to page at all. The script says so and asks again before it
does it.

**Built (step 3): the setup script and closed registration.** `vp run setup:relay` (apps/relay
`scripts/setup-relay/`, a root task in vite.config.ts; apps/api README "Push relay"); closed registration in apps/relay
`src/instances.ts` and `src/registry.ts` (README "Closed registration"). As built:

- **Closed registration.** With the secret `RELAY_CLOSED=1` (or an older relay's var `RELAY_REGISTRATION=closed`),
  `POST /v1/instances`, still signed, registers the
  signer's original key only with `Authorization: Bearer <RELAY_ADMIN_TOKEN>` (constant-time compare), with no terms
  (`terms: "none"`) and no code; codes are refused (`403 registration_closed`), a wrong token is `401
  admin_unauthorized`. An open relay ignores the header.
- **The script** is interactive on a terminal, every answer also a flag (`--non-interactive` for CI and the tests).
  It reads Worker secret names (never values) to tell a first setup from a switch, and stops when wrangler cannot
  list them for any reason but "this Worker does not exist" (error 10007): read as "no secrets", a failure would make
  new keys over ones phones depend on. Whenever the API already has `RELAY_INSTANCE_KEY` it asks again before going on
  (`--yes`), a reused key file included, since names cannot prove it is the same key. Whenever it installs a key it
  removes `RELAY_INSTANCE_ID`: it registers and checks the key as the id the key gives, so a leftover id would have the
  API sign as another instance (an API with an id and no key has nothing working to confirm). It gives wrangler every secret on stdin (`wrangler secret bulk`), never in arguments, output or a file in
  the repository. The new instance key is saved before it is used, outside the repository (symlinks resolved) and
  readable only by its owner, so the operator can keep it in a password manager and a stopped run can finish with the
  same id (`--instance-key-file`). Without a terminal, Freecorps' relay takes two runs: the first sends the code, the
  second (`--code`) registers.
- **Freecorps' relay:** terms (address, version `draft-2026-11`, marked a preliminary template) then contact, code,
  key, registration, `RELAY_INSTANCE_KEY` and `RELAY_URL`, and the signed deep health, reported as "reachable and
  registered", not as paging working: the API prefers a `RELAY` binding (the production build's `PRODUCTION_BINDINGS`)
  over `RELAY_URL`, so removing that binding and deploying the API is a required step, which the script says (and
  detects from vite.config.ts or wrangler.jsonc). A switch from an own relay (marked by `RELAY_APP_URL`) also removes
  that link and its `RELAY_SEND_TOKEN`; an API without `RELAY_APP_URL` keeps its send token. The script says that
  phones on the app as released are not paged this way (raw tokens need Freecorps' send token): they are once an app
  release mints handles (step 4). Its public address is `https://relay.brigade.freecorps.com.br`
  (`FREECORPS_RELAY_URL`, the default; `--relay-url` or `BRIGADE_RELAY_URL` overrides it). The Custom Domain is
  attached to `brigade-relay` in the Cloudflare dashboard, not in wrangler.jsonc, so a deploy creates no route; until
  it is attached (Q31) the script stops with "Could not reach the relay": it asks the relay's `/health` before it makes
  the instance key, so a run that cannot reach it leaves no key file.
- **Your own relay:** also needs a hostname on a zone of the account, deployed as the relay's custom domain (waited
  for, at most 5 minutes), since phones and the registration reach it there. It refuses a relay Worker it did not set
  up (no `BRIGADE_OWN_RELAY` marker secret; Freecorps' own, say) without `--take-over-relay`. It keeps the relay's
  `RELAY_HANDLE_KEYS` and `RELAY_TAG_KEY` when it has them (new ones would void every handle), and its APNs and
  Firebase credentials unless told to replace them (`--replace-credentials`, or asked; the files are checked locally
  first: an EC P-256 key, an RSA service account key). `RELAY_SEND_TOKEN` lets the company's app page through `/send`
  until it mints handles (step 4). Since only names can be read, a marker set on both Workers in the same step as the
  token (`BRIGADE_SEND_PAIR_<id>`) shows the two tokens match: with the same marker on both they are kept; otherwise
  a new token and marker go on both only after the registration, one right after the other, so a run that stops at any
  step (build, secrets, deploy, the domain, the registration) leaves the API as it was (not the relay, whose secrets
  are live once set, which a stop then says), and the next run puts tokens
  that drifted apart right. The admin token
  is deleted once the instance is registered. The topic and closed registration are secrets set before the deploy,
  `RELAY_APNS_TOPIC` (the company's bundle id; it takes precedence over the `APNS_TOPIC` var) and `RELAY_CLOSED=1`,
  so every later deploy without flags (CI, by hand) keeps them (Q32); the deploy passes no `--var`. A secret may not
  share a deployed var's name, so neither is named like the vars the script used to deploy (`APNS_TOPIC`,
  `RELAY_REGISTRATION`): a relay set up that way gets the secrets on its next run, stays closed by its old var until
  the deploy drops it, and by the secret after. The bundle id must suit both stores (letters and digits, each part
  starting with a letter), the same rule as the app's `BRIGADE_APP_ID`. It does not deploy the API: the production build already binds
  `RELAY` to `brigade-relay`, so the operator builds and deploys the API again.
- **Tests:** apps/relay `test/registry.test.ts` (closed registration) and `test/setup-relay.test.ts`, which runs every
  flow against the relay's own `handle` and a fake wrangler: the terms refused, a wrong code, codes rate limited, the
  relay unreachable, the default relay address and an empty one, a missing prerequisite, the switch confirmation,
  non-interactive runs, a secret list that fails, a relay not set up by the script, the topic and closed registration
  as secrets (an old `--var` relay included), a stop at each own-relay step with paging left working, the
  `RELAY` binding found, the key file kept out of the repository, and no secret value in the output or a command's
  arguments.

**Showing which relay is in use.**

- **Dashboard.** In the workspace settings, under "Phones and pages" (owners and admins): "Pages go through
  Freecorps' relay" or "Pages go through your company's own relay (relay.acme.example)", with its state from the
  watchdog's deep check (working, registration pending, refused, unreachable) and, for an own relay, the app link. The
  "Use the app" page says which app to install: the store app, or the company's build with its link.
- **App.** Each instance in the switcher has a details sheet with "Pages through Freecorps' relay" or "through
  <company>'s relay", and the paging state per workspace. When the store app is pointed at an instance with its own
  relay, adding it stops with "<host> pages through its own app: install it", with the link from `/config`
  (`relay.app`) when there is one.
- Every string in en and pt-BR (RFC 0008).

**Built (step 3): the dashboard.** apps/web `src/components/phones-pages-card.tsx` (settings),
`src/components/use-app-card.tsx` (account), `src/lib/relay.ts`; apps/api `relaySetup` in `src/relay-instance.ts`. As
built:

- **Which relay** comes from the server, not from the relay's origin: built before Freecorps' relay had a public
  address (Q31), and an own relay may sit behind any hostname, so the server says. `GET /health/paging`, which the dashboard already asks every minute, gives
  members `relay: { kind: "none" | "freecorps" | "own", host?, app? }`. `none` when phones cannot be paged at all (no
  relay to reach, or neither `RELAY_SEND_TOKEN` nor `RELAY_INSTANCE_KEY`; unlike `/config`'s `relay` it counts the send
  token, which pages raw-token phones today). A key that does not read still counts, so the card shows the watchdog's
  "refused" rather than "set one up", whose new key would orphan every handle. `own` when `RELAY_KIND` (`own` or unset,
  nothing else) or `RELAY_APP_URL` is set: the link is optional, so `vp run setup:relay` now marks an own relay with
  `RELAY_KIND=own`, and its switch to Freecorps' relay removes it with the link and the own relay's send token. The
  script reads only secret names, so any `RELAY_KIND` counts as own there, and the API agrees. An own relay set up
  before the marker, with no link, shows as Freecorps' until `RELAY_KIND=own` is set by hand (not by running the
  script again, which would remove `RELAY_INSTANCE_ID`; apps/api README "Push relay").
  Anything else is Freecorps'. Only an own relay has `host` (`RELAY_URL`'s; none with the binding alone) and `app` (the
  https link, never one with credentials). Not sent without a session or to a user in no workspace, like the reasons;
  a member's `503` (the watchdog down) still has it, so "Use the app" does not depend on the watchdog.
- **"Phones and pages"** (workspace settings, owners and admins): the relay ("Pages go through Freecorps' relay", "…
  your company's own relay (host)", or "No relay: phones aren't paged" with email as the fallback and the command to
  set one up), its state, and for an own relay the app link or how to add one. The host is `RELAY_URL`'s even with the
  `RELAY` binding: the setup script points both at the same relay (with the binding, `RELAY_URL` is only its address,
  section 7). The state is one per card, from the watchdog's reasons, most telling first: beats that stopped
  (`no_beat`, `pipeline_stalled`: "held up in Brigade", since the relay's reasons are then from its last proof and
  stale); refused (`relay_bad_signature`, `relay_instance_revoked`, `relay_unauthorized`); not registered;
  unreachable; handles unavailable; push service failing (`apns_failing`, `fcm_failing`); rate limited; a slow pipeline;
  the database (`d1_failing`, its own hint: the relay answered). `ok` is working, `unknown` not checked yet, an API that
  does not answer "Couldn't check", and an answer without the session's details (an expired session) says so. With no
  relay the state row shows only Brigade's own trouble (beats stopped, the database). Each hint differs where the fix
  is the operator's (an own relay) or Freecorps' (a revoked instance: write to Freecorps rather than register again; a
  refused send token: the same `RELAY_SEND_TOKEN` on both, since Freecorps' flow never sets one), and when the API did
  not say which relay, it says so and points to the overview's notice instead of guessing. The command shows only when
  it fixes the state (`vp run setup:relay`, or with `--replace-credentials`); never for a bad signature, since setting
  a key up again removes `RELAY_INSTANCE_ID` and a rotated instance would sign as another id, orphaning every handle.
  Registration pending is "not registered": the relay has no pending state (section 7).
- **"Use the app"** is a card on the member's account page, above "Your phones", until the page with the QR
  (section 6, step 4) exists: the Brigade app from the stores on Freecorps' relay; the company's own build, with "Get
  your company's app" when the link is set ("Ask an owner or admin" otherwise), on an own relay; the store app with
  nothing about pages when there is no relay.

### 9. Moving our instance and the apps in the field

1. The relay ships `/v1/*` next to `/send`.
2. Our instance gets an instance key and registers; it accepts both kinds of registration.
3. An app release asks for handles and registers with them; each phone moves on its next launch.
4. Once the oldest supported app version (`/config` `brigade.minApp`) sends handles, our instance drops the raw
   tokens of devices that have a `handle` (a migration nulls `push_token`/`voip_token` on those only). A phone not
   opened since keeps its raw token and stays paged through `/send`; the relay drops `/send` and `RELAY_SEND_TOKEN`
   only once no device has a raw token left (those left expire on their own: a reinstall, `BadDeviceToken`).

## Dead ends (what this does not solve, and what we do instead)

- **A lost instance key** (overwritten secret, an instance rebuilt from scratch) is a new instance id: every handle is
  useless and every phone must open the app once to be paged again. Phones that do not open it are not paged. The
  relay answers each send to an old handle `403 handle_not_yours`; the instance treats that answer like APNs'
  `BadDeviceToken` and expires the device (`device.expire`, on the handle the push went to), so the old rows do not
  linger even though the new tags never match them. From then on its member is `no_devices` there: the incident's
  "Couldn't page …" line and the "a page reached nobody" email (RFC 0006 "Who is paged") say so, the phone drops off
  "Your phones", and the app registers it again (new handle, new tag) the next time it opens. Visible, but an outage
  of paging. Mitigation: the setup script says to keep the key in a password manager; rotation (above)
  covers the planned case. A recovery by email to the registered contact would let Freecorps move an id to a new
  key, at the cost of a manual process: **not proposed** for now.
- **The relay is a shared single point of failure** for every instance using it. Same as today for our instance;
  RFC 0006's APNs fallback (a sender outside Workers) still applies. The fallback for a self-hoster is the email
  notifier and running their own relay with their own app.
- **An instance behind Cloudflare Access (or any login in front of it).** The app cannot sign in through it. Push
  still arrives (the instance calls out), but the app cannot sync or acknowledge. Not supported in the first version;
  the error says why. Later: Access service tokens or an Access login in the system browser.
- **An instance reachable only on a private network.** Pages arrive anywhere; the Acknowledge from a notification and
  the app need the network. The page keeps escalating until someone acknowledges from a place that reaches it. Said in
  the docs.
- **Android without Google Play services.** No FCM, no pages. UnifiedPush is on the roadmap (Phase 4) and fits the
  same handle shape later.
- **Changing an instance's address** changes its origin: sessions, device keys and receipts are tied to it, so every
  phone signs in again. Same as moving a web dashboard.
- **App Store review** needs the hosted instance as the default and a demo account; a server field is accepted
  (Mattermost, Bitwarden, Home Assistant do it).

## Edge cases

- **A phone restored from a backup to a new phone.** Device keys are never in a backup: the app makes new ones and
  registers new devices; the old ones end with `BadDeviceToken`. Unchanged from today.
- **The app reinstalled.** New key, new device id, same token: the tag matches and the instance replaces the old device
  (the rule that compared raw tokens).
- **FCM token refreshed while the app is closed.** The old handle keeps failing until the app opens. Today the same
  happens with the raw token. Better: `onNewToken` in the Android service asks for a handle and registers from the
  background. **Proposed** for the Android work, not a blocker.
- **Two instances that are really one** (staging and production of the same company) are two instance ids and two
  pairings. Fine.
- **The same person in the same instance with two accounts.** Unchanged: "taken by the last member signed in on it".
- **A sealed page whose origin the phone is not paired with** (a removed instance still sending): the extension shows
  the fallback text and sends no receipt. The instance's next send gets `BadDeviceToken`-like answers only when the
  token dies, so the phone should also unregister when signing out (it does) and the relay could answer
  `410 handle_retired` for a pairing the app retired (needs storage: **not proposed**).
- **The relay's handle key leaks.** It opens tokens, not content. Retire it, re-seal on each registration; phones not
  opened are not paged until they open.
- **An app version that does not know `brigade.k`** gets a page sealed for a key it does not have: it shows the
  fallback text, never silence (RFC 0006 rule).
- **Clock skew** on a self-hosted instance: Workers' clocks are fine; the 5-minute window covers the rest.
- **Critical Alerts and calls from any instance.** The entitlement is the app's: every paired instance can use it.
  The relay keeps refusing a critical or a call push that is not a `page` (as today), and the app reports every VoIP
  push to CallKit, so no instance can make iOS cut the app's VoIP pushes.

## Decisions

- **D1 — Several instances on one phone**, with the UI for it from the first release (section 5).
- **D2 — The QR signs in too**, as a device approval: 2-minute single-use code, claimed in the app, approved on the
  dashboard by typing the number the phone shows (section 6). The address-only QR stays.
- **D3 — Registration is required** to mint handles and send, with the terms accepted and a contact address
  confirmed by email (sections 1 and 8).
- **D4 — Limits:** 600 sends a minute per instance, 60 calls a minute, 30 a minute per phone (the tag: instance and
  token, section 3), raised on request.
- **D5 — Terms of the hosted relay:** free for any instance within the limits; a paid service built on it needs an
  agreement (RFC 0006 "Terms of the hosted relay"). A template, marked as a preliminary version, is in
  [docs/legal/relay-terms.md](../legal/relay-terms.md) (and pt-BR) so registration has a text and a version
  (`draft-2026-11`) to point at; the final text, reviewed by counsel, replaces it on the project's site before
  self-hosters are pointed at the relay.
- **Own relay, made easy** (section 8): the same code and protocol, deployed and configured by the setup script,
  for the company's own app build; the dashboard and the app say which relay an instance uses.

## Order of work

1. Relay: `/v1/instances` (with the emailed code and closed registration), signatures and the registry in a
   Durable Object; then `/v1/handles`, `/v1/send`, the signed `/v1/health?deep=1` and their limits, tested with fake
   APNs/FCM (built; apps/relay README "Handles and /v1/send"), and closed-mode registration by the relay admin secret
   (built, section 8). The `send_email` binding for the contact code is bound too (`EMAIL_FROM` is `relay@brigade.freecorps.com.br`).
2. Envelope v2 (sealed `iat`, `origin`, `urgency`; key id) in `packages/push`, the iOS extension and Android; the
   app accepts v1 and v2 (built, section 4, with one key per instance on the phone).
3. Instance: `device.register` with `handle`/`tag`, the notifier on `/v1/send`, `/config` additions, watchdog
   reasons, `vp run setup:relay` (both relays), the dashboard's "Phones and pages". The notifier switches to
   `sealPushV2` (origin: the dashboard's, TTL: the one it gives the relay) only for apps that open v2: an older app
   shows the fallback text for every v2 page. Built: the API side (`device.register`, the notifier, `/config`, the
   watchdog; section 7), `vp run setup:relay` and the dashboard's "Phones and pages" and "Use the app" (section 8).
4. App: handles and per-instance keys and storage; the instance switcher, address field, QR and link, address
   checks, which relay; QR sign-in (with its API routes and the dashboard's approval). Built: handles, storage per
   instance, background registration and page routing (section 5).
5. Our instance moves (section 9); then the docs for self-hosters ("Your own app" included) and the terms.

Each step is a paging path: it keeps the old path working until the next one ships, and comes with its tests
(AGENTS.md).
