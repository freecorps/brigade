# RFC 0015 — One store app for every instance

- Status: Accepted (decisions D1–D5 below), not built yet
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
  id, the key is the original one and is checked against the signature alone. Only a rotated key needs a lookup
  (below). So the relay can verify a send while its storage is down.
- **Registration** (`POST /v1/instances`, signed): records the instance in the relay's registry (a Durable Object per instance, `RegistryDO`, so a check and its update are one atomic
  step: the code's tries, key changes and revocation never race) with the
  terms version accepted and a contact address (where Freecorps writes before limiting or revoking). **Decided
  (D3):** an instance must register, and so accept the terms, before it can mint handles or send: an unknown id
  answers `403 instance_unregistered`. Registering, minting a handle and rotating keys read the registry and **fail
  closed** when the registry cannot answer (`503 registry_unavailable`): an unknown id never gets a handle. A send needs no
  registration read, because the handle it carries could only have been minted for a registered instance; it checks
  only revocation, below.
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
- **When.** Each time the app registers today (launch, foreground, new token, Try again) it asks for a handle first,
  so a new APNs, PushKit or FCM token always comes with a new handle. A VoIP token that arrives later gets a new
  handle with both tokens.
- **Abuse of minting.** Anyone may ask for a handle for any token, for their own instance only. That is harmless
  without a real token, which only the phone and the relay ever see (and our own instance until migration, below).
  Rate limited per IP.
- **Rotating the relay's key.** Handles carry the key id; the relay keeps old keys to open handles for at least 13
  months (a phone opened once a year still works), and every registration re-seals with the current key. Only a leaked
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
  the limits are well above any real incident. **Decided (D4)**, raised on request.
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
     `APNS_TOPIC`, `FCM_SERVICE_ACCOUNT`, `RELAY_HANDLE_KEYS`) and turns its registration to this instance only
     (`RELAY_REGISTRATION=closed`, the instance registered directly by the script, no terms or email).
   - Binds the relay to the API as `RELAY` (no hop over the internet, as on our instance) and sets the instance key.
   - Points to "Your own app" in the docs: the EAS build with the company's bundle id, App Group, relay address
     (`EXPO_PUBLIC_BRIGADE_RELAY_URL`) and store accounts. That build is the company's to publish (or to hand out
     through TestFlight, an MDM or an internal store).
   - Asks for the build's store link (optional, `RELAY_APP_URL`), so the store app can send people there (below).
3. **Not now.** No push; the email notifier still pages, and the dashboard says phones are not paged.

**Switching relays** changes where every handle came from: each phone must open the app once to be paged again, and
a switch to an own relay leaves the store app unable to page at all. The script says so and asks again before it
does it.

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
- **D4 — Limits:** 600 sends a minute per instance, 60 calls a minute, 30 a minute per handle, raised on request.
- **D5 — Terms of the hosted relay:** free for any instance within the limits; a paid service built on it needs an
  agreement (RFC 0006 "Terms of the hosted relay"). A template, marked as a preliminary version, is in
  [docs/legal/relay-terms.md](../legal/relay-terms.md) (and pt-BR) so registration has a text and a version
  (`draft-2026-11`) to point at; the final text, reviewed by counsel, replaces it on the project's site before
  self-hosters are pointed at the relay.
- **Own relay, made easy** (section 8): the same code and protocol, deployed and configured by the setup script,
  for the company's own app build; the dashboard and the app say which relay an instance uses.

## Order of work

1. Relay: `/v1/instances` (with the emailed code and closed registration), `/v1/handles`, `/v1/send`, signatures,
   registry in a Durable Object, limits; tests with fake APNs/FCM.
2. Envelope v2 (sealed `iat`, `origin`, `urgency`; key id) in `packages/push`, the iOS extension and Android; the
   app accepts v1 and v2.
3. Instance: `device.register` with `handle`/`tag`, the notifier on `/v1/send`, `/config` additions, watchdog
   reasons, `vp run setup:relay` (both relays), the dashboard's "Phones and pages".
4. App: handles and per-instance keys and storage; the instance switcher, address field, QR and link, address
   checks, which relay; QR sign-in (with its API routes and the dashboard's approval).
5. Our instance moves (section 9); then the docs for self-hosters ("Your own app" included) and the terms.

Each step is a paging path: it keeps the old path working until the next one ships, and comes with its tests
(AGENTS.md).
