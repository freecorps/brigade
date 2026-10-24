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
- **Encryption:** HPKE (RFC 9180) or Web Push encryption (RFC 8291) — decide in spike S1 based on what runs well in
  WebCrypto (Workers) and in the iOS NSE / React Native.
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
- NSE added via a config plugin (community plugin or our own).
- Use `getDevicePushTokenAsync()` (native token), not Expo push tokens.

## Risk: APNs requires HTTP/2

Workers outbound `fetch` historically speaks HTTP/1.1 to origins, and APNs requires HTTP/2. **Spike S1 must
confirm** whether a Worker can deliver to APNs today. Fallback: a tiny APNs sender in Cloudflare Containers
(or any small VM) behind the relay — the rest of the design is unchanged. FCM HTTP v1 works over HTTP/1.1.

## Terms of the hosted relay

The Freecorps-operated relay has its own terms of service (fair-use limits, abuse policy). Running a competing
paid service on top of the official relay requires an agreement; anyone can self-host a relay with their own app build.
