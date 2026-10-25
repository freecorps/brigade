# Spike S1 — APNs from a Worker and payload encryption

- Status: Done on the iOS Simulator; left: verify on a real iPhone
- Roadmap: Phase 0, S1
- Settles: RFC 0006 "Risk: APNs requires HTTP/2" and the encryption choice ("HPKE or Web Push encryption")

## Question

1. Can a Cloudflare Worker deliver to APNs? APNs only speaks HTTP/2, and Workers' outbound `fetch` was said to
   speak HTTP/1.1 to origins.
2. Which payload encryption runs well both in a Worker (WebCrypto) and in the iOS Notification Service Extension,
   and later on Android: HPKE (RFC 9180) or Web Push encryption (RFC 8291)?
3. Can an Expo app carry a Notification Service Extension that decrypts with a device key the app created, and
   show the decrypted title and body?

## What was built

- **`packages/push`** (`@freecorps/brigade-push`, MIT, no dependencies): HPKE base mode, single shot, with one
  suite, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM, on WebCrypto only (about 200 lines). Around it, the
  push envelope `{ v: 1, enc, ct }` (base64url), `sealPush(devicePublicKey, { title, body })`, `openPush`,
  `parsePushEnvelope` for untrusted input, and a 2048-byte plaintext limit so a sealed push stays well inside
  APNs' 4 KB. HPKE `info` is `"app.freecorps.brigade push v1"`, binding every ciphertext to this protocol.
- **`apps/relay`** (`@freecorps/brigade-relay`, AGPL): the relay Worker, reduced to what the spike needs.
  `POST /send` takes `{ deviceToken, envelope, urgency, collapseId?, ttlSeconds? }` behind a bearer token
  (`RELAY_SEND_TOKEN`, compared in constant time), reading at most 8 KB of body, and forwards to APNs. APNs keeps
  trying an offline phone until `ttlSeconds` (default 15 minutes for `page`, 1 hour for `high`, 4 hours for
  `low`; 0 means try once, refused for `page`). A broken `APNS_KEY` answers `500 relay_misconfigured`, not a caller error. Traces are
  off: an outbound fetch span records the URL, which ends in the device token. `src/apns.ts` signs the ES256 provider
  token with WebCrypto, caches it for 40 minutes (APNs wants one between 20 and 60 minutes old), and builds the
  request: `apns-push-type: alert`, priority 10 (5 for `low`), `apns-expiration`, `apns-collapse-id`, and the
  body below. Instance registration, handles, rate limits and FCM are not part of the spike.

  ```json
  {
    "aps": {
      "alert": { "title-loc-key": "push_fallback_title", "loc-key": "push_fallback_body" },
      "mutable-content": 1,
      "sound": "default",
      "interruption-level": "time-sensitive"
    },
    "brigade": { "v": 1, "enc": "…", "ct": "…" }
  }
  ```

  The alert is made of localization keys, so the relay needs neither the recipient's language nor any content.
  Only `page` is `time-sensitive`; `low` and `high` are `active`.

- **`apps/mobile`**:
  - `modules/brigade-push`, a local Expo module (iOS only for now). `getPublicKey()` creates a P-256 key with
    CryptoKit on first use and returns its public key (65-byte uncompressed point, base64url). The key is stored
    in the Keychain as a generic password, `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (readable while the
    phone is locked, never synced or restored to another device), in the access group
    `group.app.freecorps.brigade`. App Groups double as Keychain access groups, so the extension reads the key with
    no Keychain Sharing entitlement and no team id in the code.
  - `modules/brigade-push/extension/NotificationService.swift`, the extension. It opens the `brigade` field with
    `HPKE.Recipient` (iOS 17+) and replaces the title and body. If anything fails (no key, malformed envelope,
    authentication failure, iOS 16, out of time), it shows the fallback from its own `Localizable.strings` ("New
    alert / Open Brigade to see it.", "Novo alerta / Abra o Brigade para ver."), never nothing. It logs the failing
    step, never content. `BrigadePushCrypto.swift` is shared: the module's pod and the extension target compile
    the same file.
  - `plugins/notification-service.ts`, the config plugin. It adds the entitlements (`aps-environment`, the App
    Group, `com.apple.developer.usernotifications.time-sensitive`), a `BrigadeNotificationService` app extension
    target (bundle id `app.freecorps.brigade.NotificationService`, iOS 16.4, embedded in the app) and its Info.plist
    and entitlements. It generates `en.lproj` and `pt-BR.lproj` `Localizable.strings` from
    `packages/i18n/messages` for both targets. The app needs them for the payload's `loc-key`s when the extension
    cannot run at all; the extension uses them for its fallback. It also declares the extension to EAS Build
    (`extra.eas.build.experimental.ios.appExtensions`) so EAS can sign it.
  - `aps-environment` is `development` for local builds and `production` when `EAS_BUILD` is set (EAS builds are
    ad hoc or App Store signed). `ios.appleTeamId` comes from `APPLE_TEAM_ID` when set, for local automatic
    signing, so the team id stays out of the repository.
  - `expo-notifications` (58.1.6) asks for permission and returns the native device token
    (`getDevicePushTokenAsync`). A development-only `/push` screen shows the permission, the APNs device token and
    the device public key, and logs them to Metro.
- **`apps/relay/scripts/send-test-push.ts`** plays the instance: it seals `{ title, body }` for a device's public
  key and posts it to a relay (`vpx scripts/send-test-push.ts <device token> <public key> [title] [body] [urgency]`
  from `apps/relay`, with `RELAY_URL`, `RELAY_TOKEN_FILE` and `NODE_OPTIONS=--conditions=@freecorps/source` set; see
  its README).

Versions: Wrangler 4.152.0, workerd 1.20261019.1 (compatibility date 2026-10-19), Expo SDK 58, React Native 0.88,
Xcode 27.0 beta 6, iPhone 17 Simulator on iOS 27.0, macOS 27.2 on Apple silicon.

## Result

### A Worker can deliver to APNs, from Cloudflare's edge only

| From                                             | To APNs sandbox                   | Result                                                                                                 |
| ------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Deployed Worker (`brigade-relay-dev`), `fetch`   | 3 random 32-byte device tokens    | `400 {"reason":"BadDeviceToken"}` with an `apns-id`, 169–311 ms                                        |
| Deployed Worker, `fetch`                         | the Simulator's real device token | `200` with `apns-id` and `apns-unique-id`, delivered, 96–348 ms over 8 sends (2 sealed to another key) |
| Local `vp dev` (workerd), the same code and keys | the Simulator's real device token | `fetch` throws `Network connection lost.`                                                              |

APNs only speaks HTTP/2, and its replies reached the deployed Worker: answers to a bad token (which also prove the
JWT was accepted, or APNs would have answered `403 InvalidProviderToken`) and delivered pushes. So outbound
`fetch` from a deployed Worker gets to APNs over HTTP/2. Local workerd does not. A workerd maintainer explains why
in [cloudflare/workerd#4841](https://github.com/cloudflare/workerd/issues/4841) (August 2025, still open):
workerd has no HTTP/2, and in production subrequests go through Cloudflare's proxy stack, which "(apparently)
upgrades to HTTP/2 before talking to the origin". There are no active plans to add HTTP/2 to workerd. Cloudflare's
`fetch` documentation does not mention HTTP versions at all. This is observed behaviour, not a documented
contract.

What that means:

- **The relay stays a plain Worker.** No Container or VM in front of APNs is needed today, and the Sockets API
  (`connect()` with a hand-written HTTP/2 client) was not needed.
- **Keep the fallback in the RFC, and alert on it.** If the edge stopped upgrading, every APNs send would fail with
  a network error. The relay must treat `apns_unreachable` as a paging-path failure: alert on it (not built yet;
  the spike only logs it), and keep the
  RFC's fallback (a small APNs sender in Cloudflare Containers or a VM) ready. This follows the rule that a paging
  path has a fallback and a test.
- **Local development cannot reach APNs.** Test against a deployed `dev` Worker, or put an HTTP/2-speaking proxy in
  front of APNs as the workerd issue suggests. Unit tests stub `fetch`.

### Encryption: HPKE with P-256

| Criterion          | HPKE (RFC 9180), P-256 + AES-128-GCM                                      | Web Push encryption (RFC 8291)                                        |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Worker (WebCrypto) | ECDH, HMAC and AES-GCM, all standard WebCrypto: ~200 lines, no dependency | Same primitives; ~150 lines                                           |
| iOS extension      | **One CryptoKit call** (`HPKE.Recipient`, iOS 17+)                        | No CryptoKit API: ECDH + HKDF + the `aes128gcm` record format by hand |
| Android (later)    | Tink's `HybridDecrypt` (HPKE, P-256)                                      | Hand-written, or a Web Push library meant for servers                 |
| Test vectors       | RFC 9180 appendix A.3 (this suite)                                        | RFC 8291 appendix A                                                   |
| Fit                | General-purpose public-key encryption to one recipient                    | Built for browsers' push services; also needs a shared auth secret    |

**Decision: HPKE**, base mode, single shot, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM. It is one
standard call on iOS and on Android, and a small WebCrypto module on the server. RFC 8291 would mean
hand-rolling the same primitives in Swift and Kotlin. X25519 + ChaCha20-Poly1305 works in CryptoKit too, but P-256
was picked so the device key can later move into hardware: the Secure Enclave (`SecureEnclave.P256.KeyAgreement`)
and Android's StrongBox do key agreement on P-256 only. AES-128-GCM is CryptoKit's
`AES_GCM_128`, WebCrypto's `AES-GCM` with a 16-byte key, and hardware-accelerated on every phone.

Verified:

- RFC 9180 test vector A.3.1 (sequence 0): `seal` with the vector's ephemeral key reproduces its `enc` and
  ciphertext, and `open` recovers its plaintext. This was run in Node's WebCrypto (`packages/push/tests`) and, once
  by hand, in local workerd (vector matches; 100 `sealPush`/`openPush` round trips in 26 ms).
- Round trips with fresh keys; failure on another key, other `info` or `aad`, a flipped bit; compressed or
  off-curve public keys rejected (`packages/push/tests`).
- **Interoperability: iOS CryptoKit opens what `packages/push` seals.** In the end-to-end run below, the extension
  decrypted pushes sealed in Node, including "São Paulo" (non-ASCII). A push sealed to another key logged
  `push not decrypted: authenticationFailure` and showed the fallback.

### End to end on the iOS Simulator

Apple-silicon Simulators receive real remote pushes from the APNs sandbox. The path verified:

```
send-test-push (seals for the device key) ──▶ brigade-relay-dev (Worker, JWT) ──HTTP/2──▶ APNs sandbox
  ──▶ iPhone 17 Simulator (iOS 27) ──▶ BrigadeNotificationService decrypts ──▶ time-sensitive banner
```

1. Local Debug build with automatic signing (commands below). The app and the `.appex` each carry `en.lproj` and
   `pt-BR.lproj`; the entitlements are embedded for the Simulator.
2. `/push` showed `granted`, an 80-byte sandbox device token (Simulator tokens are longer than a device's 32
   bytes; the relay accepts 32 to 100 bytes) and the device public key, which the app created in the shared
   Keychain.
3. `send-test-push` → relay → APNs: `200`. The extension logged `push decrypted`, and SpringBoard showed a **Time
   Sensitive** banner with the decrypted title "SEV1 · Checkout down" and body "Decrypted on the device: 502s from
   payments in São Paulo" (`test-results/pr-media/s1-worker-apns-decrypted.png`, cropped to the banner;
   `-full.png` has the whole screen).
4. A push sealed to a different key: `200` from APNs, the extension logged `authenticationFailure`, and the
   banner read "New alert / Open Brigade to see it." (`test-results/pr-media/s1-fallback.png`).

Banners from pushes delivered while another app (Settings) was in front were logged by SpringBoard as shown, and
the extension decrypted them, but no recording caught one on screen. The screenshots above are of the app in the
foreground, where its handler asks for a banner.

How it was driven on this beta Simulator, where taps do not work (see S4):

- **Opening the bundle:** `xcrun simctl launch booted app.freecorps.brigade --initialUrl http://127.0.0.1:8081`.
  `expo-dev-launcher` reads `--initialUrl` from the process arguments and skips the launcher, and the "Open in
  Brigade?" prompt that `simctl openurl` raises.
- **Reaching `/push`:** a temporary `<Redirect href="/push" />` in `src/app/index.tsx`, not committed.
- **Notification permission:** `simctl privacy` has no notifications service, and the permission prompt cannot be
  tapped. The Simulator was shut down and an authorized entry for `app.freecorps.brigade` was written into its
  `data/Library/BulletinBoard/VersionedSectionInfo.plist` (a copy of Messages' archived `BBSectionInfo`). After
  boot, `requestPermissionsAsync` returned `granted` without a prompt. This is a test-harness stand-in for tapping
  "Allow".
- **Screenshots:** `simctl io screenshot` never shows notification banners on this runtime, though SpringBoard
  logs them as on screen. Frames were taken from `simctl io recordVideo`.
- **Logs:** `xcrun simctl spawn booted log show --predicate 'subsystem == "app.freecorps.brigade.NotificationService"'`.

Not verified: the `pt-BR` fallback on screen (the strings files are generated and tested, and the built bundles
have both, but the Simulator ran in English); `xcrun simctl push` with a sealed payload (the real APNs path made it
unnecessary); a cold extension on a locked device (the Keychain item's accessibility is meant for it).

### Building locally

No EAS cloud build was used. From `apps/mobile`:

```bash
export DEVELOPER_DIR=/Applications/Xcode-27.0.0-Beta.6.app/Contents/Developer  # the Xcode with a matching Simulator runtime (S4)
export APPLE_TEAM_ID=<Freecorps team id>                                      # automatic signing; never committed
bunx expo prebuild --platform ios
xcodebuild -workspace ios/Brigade.xcworkspace -scheme Brigade -configuration Debug \
  -destination 'id=<simulator udid>' -derivedDataPath <dir> -allowProvisioningUpdates build
xcrun simctl install booted <dir>/Build/Products/Debug-iphonesimulator/Brigade.app
bunx expo start --dev-client
xcrun simctl launch booted app.freecorps.brigade --initialUrl http://127.0.0.1:8081
```

For a device, use `-destination 'generic/platform=iOS'`. Automatic signing then registers
`app.freecorps.brigade.NotificationService` and the App Group on the team and creates development profiles; with
`APPLE_TEAM_ID` set, prebuild writes it as `DEVELOPMENT_TEAM` for both targets.

## Decision

- **APNs from a Worker: yes.** The relay is a Worker that `fetch`es APNs. Production relies on Cloudflare's edge
  speaking HTTP/2 to APNs, which is observed, not documented, so the production relay must alert on
  `apns_unreachable` (the spike only logs it) and the Containers/VM sender stays the documented fallback (RFC 0006).
- **Encryption: HPKE** (RFC 9180), base mode, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM, `info`
  `"app.freecorps.brigade push v1"`, envelope `{ v: 1, enc, ct }`, in `packages/push` (MIT, WebCrypto only).
  iOS 17+ decrypts in the extension; iOS 16.4 shows the fallback.
- **The device key** lives in the Keychain under the App Group, readable after first unlock, this device only.
- **The extension** is built by our own config plugin (no community plugin), with fallback strings generated from
  `packages/i18n`.

Left for the real iPhone (needs the device):

1. Register it (`bunx eas-cli@latest device:create`, or let Xcode's automatic signing add it), build with
   `-destination 'generic/platform=iOS' -allowProvisioningUpdates`, and install.
2. Repeat the end-to-end run with the device's sandbox token, the app in the background and the phone **locked**.
   The extension must read the Keychain item while locked, and the banner must break through a Focus mode
   (time-sensitive).
3. Check the `pt-BR` fallback with the phone in Portuguese.

## Open questions

- **What the relay can still do with content it cannot read.** The sealed plaintext is only `{ title, body }`,
  base mode does not authenticate the sender, and nothing binds a ciphertext to a time, an instance or an urgency.
  A malicious relay (which already holds device tokens and past envelopes) can replay an old SEV1 days later, or
  turn a `low` push into a time-sensitive page, since `interruption-level` travels in clear; anyone with a device's
  public key and access to the relay can forge content. Confidentiality holds. Planned fix (RFC 0006): seal `iat`,
  the instance id and the urgency inside the plaintext; the extension sets the interruption level from the
  decrypted urgency and shows the fallback for stale pushes; then sender authentication (HPKE auth mode, or a
  signature with the instance's Ed25519 key).
- **One provider token for the whole relay.** Each isolate signs and caches its own JWT. With many isolates APNs
  may answer `TooManyProviderTokenUpdates`; the production relay should share one token (a Durable Object or KV).
- **APNs environment per device, not per relay.** Ad hoc and store builds (every EAS build, including
  `development`) get production device tokens, so the sandbox `dev` relay answers `BadDeviceToken` for them; Xcode
  debug builds get sandbox tokens. Device registration should record the token's environment. Done: devices register
  their `environment` and the relay takes it per push (RFC 0006 "Device registration").
- **Extension build number on EAS.** The plugin writes the extension's `CFBundleVersion` from
  `ios.buildNumber` at prebuild; with `appVersionSource: remote` and `autoIncrement`, check on the first EAS
  production build that it matches the app's, which App Store Connect requires.
- **A later push replaces a stored page.** APNs keeps one undelivered push per app and device, so a page waiting
  for a phone in a lift is dropped if a `low` push follows it. Plan in RFC 0006 ("Offline phones"): re-sync open
  pages on reconnect, and hold back or re-send around pages.
- **Secure Enclave key.** `SecureEnclave.P256.KeyAgreement.PrivateKey` would keep the private key out of memory.
  Whether CryptoKit's HPKE accepts it, and whether the extension can use a key the app created there, needs a
  device: the Simulator has no Secure Enclave.
- **APNs from the edge in production.** Decide on the alert for `apns_unreachable`, and whether to run the
  Containers fallback warm or only document it, when the production relay is built.
- **Key rotation and multi-instance pairing.** One device key for every instance a phone pairs with, or one per
  instance? Rotation re-pairs, and pushes sealed to the old key show the fallback.

## Resources created

- Worker `brigade-relay-dev` (workers.dev, the `dev` environment of `apps/relay/wrangler.jsonc`), with the secrets
  `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` and `RELAY_SEND_TOKEN`, set with `wrangler deploy --secrets-file` from
  a file outside the repository. `/send` needs the bearer token.
- Nothing on the Apple team: Simulator builds are signed ad hoc (`codesign` shows `Signature=adhoc`), so no App
  ID or profile was needed. The extension's App ID and the App Group get registered when the first device build is
  signed (automatic signing, or EAS syncing capabilities).
