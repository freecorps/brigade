# @freecorps/brigade-push

End-to-end encrypted push payloads for Freecorps Brigade: the instance seals a notification to a device's public key,
the relay and Apple or Google only carry the ciphertext, and the phone opens it (RFC 0006). HPKE
([RFC 9180](https://www.rfc-editor.org/rfc/rfc9180)), base mode, single shot, with one suite: DHKEM(P-256,
HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM. Only WebCrypto, no dependencies: it runs in Workers, browsers and Node.
Why this suite: [spike S1](../../docs/spikes/s1-apns-encryption.md).

```ts
import { parsePushEnvelope, sealPush } from "@freecorps/brigade-push";

// Instance: the device public key is what the app reports (uncompressed P-256, base64url).
const envelope = await sealPush(device.publicKey, {
  title: "SEV1 · Checkout down",
  body: "502s from payments",
});
// → { v: 1, enc: "<base64url>", ct: "<base64url>" }, sent as the `brigade` field of the push.

// Relay: accept only well-formed envelopes from untrusted JSON.
const checked = parsePushEnvelope(body.envelope); // null if malformed
```

| Export                                                            | What                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `sealPush(publicKey, { title, body })`                            | The envelope; throws over `PUSH_PLAINTEXT_MAX_BYTES` (2048 bytes of UTF-8 JSON)                                    |
| `sealPushV2(publicKey, content, { origin, urgency, ttlSeconds })` | Version 2 (RFC 0015 section 4): also seals `iat`, `exp`, `origin`, `urgency`; names the key (`k`)                  |
| `openPush(recipient, envelope)`                                   | `{ title, body }`; what the iOS extension does natively, for tests and other clients                               |
| `openOnPhone(envelope, keys, { now, paired })`                    | What the phone does with either version: the reference the native code follows; every refusal is the fallback text |
| `pushKeyId(publicKey)`                                            | The key id: base64url of SHA-256(uncompressed key)'s first 6 bytes, 8 characters                                   |
| `parsePushEnvelope(value)`, `parseDevicePublicKey(value)`         | Validation of untrusted input                                                                                      |
| `seal`, `open`, `generateRecipient`, `importKeyPair`              | The HPKE layer itself (bytes in, bytes out)                                                                        |
| `PUSH_HPKE_INFO`, `PUSH_ENVELOPE_VERSION`                         | `"app.freecorps.brigade push v1"` and `1`; the native code uses the same values                                    |
| `PUSH_HPKE_INFO_V2`, `PUSH_ENVELOPE_V2`                           | `"app.freecorps.brigade push v2"` and `2`                                                                          |
| `toBase64url`, `fromBase64url`                                    | Unpadded base64url, the encoding of every binary field                                                             |

The other side is native: on iOS, `apps/mobile/modules/brigade-push/ios/BrigadePushCrypto.swift` opens the envelope
with CryptoKit's `HPKE.Recipient` (iOS 17+), and on Android `modules/brigade-push/android` (`Hpke.kt`,
`PushPayload.kt`). Any change to the suite, `info` or the envelope must change all three, and bump `v`.

`tests/` runs RFC 9180's test vector A.3.1 (this suite, sequence 0) in both directions, round trips, tampering,
wrong keys and the envelope's validation. `src/` is type-checked without Node types.

License: MIT.
