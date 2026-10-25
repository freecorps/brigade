# RFC 0006 — Push notifications and the relay

- Status: Draft

## Problem

APNs and FCM only accept pushes signed with credentials of the account that published the app. If Freecorps
publishes "Freecorps Brigade" on the stores, a self-hosted instance cannot push to it directly.

## Design: encrypted relay (same family as Bitwarden / ntfy)

```
App ──(1) register native APNs/FCM token──▶ Relay ──▶ opaque handle
App ──(2) pair via QR: handle + device public key──▶ Instance
Instance ──(3) encrypt payload with device key; (4) push(handle, ciphertext, urgency), signed──▶ Relay ──▶ APNs/FCM
Device ──(5) iOS Notification Service Extension / Android data message decrypts and displays
```

- **Relay sees no content.** Only a handle, a ciphertext and an urgency level.
- **Handles are bound to an instance.** Instance X cannot push to devices paired with instance Y.
- **Instances self-register** with an Ed25519 key pair (no account). The relay enforces per-instance rate limits and can revoke.
- **Fallback text:** if decryption fails (rotated key, corrupted payload), show "New alert — open Brigade". Never silent.
  The payload carries it as localization keys (`title-loc-key: push_fallback_title`, `loc-key: push_fallback_body`),
  so the relay needs neither content nor the recipient's language; the app bundle carries the strings from
  `packages/i18n`. The extension shows the same strings when it cannot decrypt.
- **Encryption: HPKE (RFC 9180)**, base mode, single shot, DHKEM(P-256, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM,
  `info` = `"app.freecorps.brigade push v1"` (decided in spike S1, [write-up](../spikes/s1-apns-encryption.md)). It is
  one CryptoKit call in the iOS extension (`HPKE.Recipient`, iOS 17+; iOS 16 shows the fallback) and Tink's HPKE on
  Android, and `packages/push` implements it on WebCrypto with no dependency (RFC 9180 test vector A.3.1 in its
  tests). Web Push encryption (RFC 8291) was rejected: no native API on either platform. P-256 rather than X25519 so
  the device key can move into the Secure Enclave or StrongBox later. The APNs payload is
  `{ aps: { alert: <fallback keys>, mutable-content: 1, … }, brigade: { v: 1, enc, ct } }`, with `enc` and `ct`
  base64url and at most 2048 bytes of plaintext.
- **Device key:** created by the app on first use; on iOS a Keychain item in the App Group
  `group.app.freecorps.brigade` (which is also its Keychain access group), readable after first unlock, this device
  only, so the extension can read it while the phone is locked.
- **What the relay can still do.** It cannot read content, but in the spike's base-mode envelope it could replay
  an old push or raise its urgency (`interruption-level` is in clear), and anyone with a device public key and
  relay access could forge one. Before production: seal `iat`, the instance id and the urgency inside the
  plaintext, let the extension take the interruption level from the decrypted urgency and fall back on stale
  pushes, then authenticate the sender (HPKE auth mode or the instance's Ed25519 signature).
- **Offline phones:** pushes carry an `apns-expiration` by urgency (pages 15 minutes; the relay refuses "try once"
  for a page). APNs keeps only the latest undelivered push per app and device, so a later push (even a `low`
  status update) replaces a stored page. Before production: the app re-syncs open pages when it reconnects or comes
  to the foreground, and the instance holds back lower-urgency pushes to a device while a page to it may be
  undelivered (or re-sends the page after them). This is a paging path: it needs a fallback and a test.
- **The relay is part of this repo** (`apps/relay`). Anyone can run their own with their own store credentials.

## Driver abstraction

```ts
interface PushDriver {
  send(
    target: DeviceTarget,
    msg: EncryptedPush,
    opts: { urgency: "low" | "high" | "page" },
  ): Promise<Result>;
}
```

Drivers: `relay` (default), `apns-direct`, `fcm-direct` (own app build), `unifiedpush` (Android without Google),
`expo-push` (local development only).

## Paging semantics per platform

| Need                      | iOS                                          | Android                                           |
| ------------------------- | -------------------------------------------- | ------------------------------------------------- |
| Break through Focus / DND | `interruption-level: time-sensitive`         | High-importance channel + DND access (user grant) |
| Ring on silent            | Critical Alerts entitlement (apply to Apple) | Alarm-sound channel                               |
| Act from the notification | Category actions: Ack / Escalate             | Action buttons                                    |
| Collapse repeats          | `apns-collapse-id`                           | Notification `tag`                                |
| Full-screen alarm         | n/a                                          | `USE_FULL_SCREEN_INTENT` (Play policy review)     |

## Expo specifics

- Development builds only (no Expo Go) — native modules + NSE.
- NSE added by our own config plugin (`apps/mobile/plugins/notification-service.ts`): the extension target, the push,
  App Group and time-sensitive entitlements, and the fallback strings for both targets.
- Use `getDevicePushTokenAsync()` (native token), not Expo push tokens.

## APNs requires HTTP/2

APNs only speaks HTTP/2. **Spike S1 measured it** ([write-up](../spikes/s1-apns-encryption.md)): a deployed Worker's
`fetch` reaches APNs (sandbox answered `200` and delivered, or `400 BadDeviceToken` for a bad token), because
Cloudflare's edge speaks HTTP/2 to the origin. Local workerd (`wrangler dev`, `vp dev`) has no HTTP/2 and gets
`Network connection lost.` ([cloudflare/workerd#4841](https://github.com/cloudflare/workerd/issues/4841)). So the
relay is a plain Worker. This behaviour is observed, not documented, so it stays a risk: the relay must alert on
`apns_unreachable` (not built yet; the spike only logs it), and the fallback stays ready, a tiny APNs sender in
Cloudflare Containers (or any small VM) behind the relay, with the rest of the design unchanged. Develop against a deployed `dev` relay. FCM HTTP v1 works
over HTTP/1.1.

## Terms of the hosted relay

The Freecorps-operated relay has its own terms of service (fair-use limits, abuse policy). Running a competing
paid service on top of the official relay requires an agreement; anyone can self-host a relay with their own app build.
