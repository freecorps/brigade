// Handles and tags (RFC 0015 section 2). A handle is the relay's AES-256-GCM sealing of what it needs to reach a phone
// for one instance; nothing is stored, the relay opens the handle on each send. The instance holds handles, never an
// APNs or FCM token.
//
//   handle = keyId + "." + base64url(nonce (12 bytes) ‖ ciphertext ‖ GCM tag (16 bytes))
//
// The plaintext is the JSON `{ v: 1, instance, platform, environment?, pushToken, voipToken? }`, and the additional
// data `"brigade handle\n" + keyId`, so a handle's key id cannot be swapped for another. `RELAY_HANDLE_KEYS` is a
// keyring, JSON `{ "current": "<id>", "keys": { "<id>": "<32 bytes, base64url>", … } }`: the current key seals, every
// key listed opens. Old keys stay listed for at least 13 months after a rotation (a phone opened once a year).
//
//   tag = base64url(HMAC-SHA-256(RELAY_TAG_KEY, instance ‖ 0x00 ‖ pushToken))
//
// `RELAY_TAG_KEY` (at least 32 bytes, base64url) never rotates with the handle keys: the same token at the same
// instance always has the same tag, whatever key sealed the handle, and a different tag at any other instance.

import { fromBase64url, toBase64url } from "@freecorps/brigade-push";
import type { ApnsEnvironment } from "./apns.ts";
import type { Platform } from "./send.ts";

export type Sealed = {
  v: 1;
  instance: string;
  platform: Platform;
  environment?: ApnsEnvironment;
  pushToken: string;
  voipToken?: string;
};

/** A keyring or tag key that does not parse: the relay's configuration, never the caller's fault. */
export class HandleConfigError extends Error {}

const KEY_ID = /^[A-Za-z0-9]{1,16}$/;
const NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
/** Far above any real handle (an FCM token of 512 characters and a VoIP token make about 1.3 KB). */
export const MAX_HANDLE_LENGTH = 4096;

type Keyring = { current: string; keys: Map<string, CryptoKey> };

// Per isolate, by the secret's text: importing keys is async and the same for every request. A rotated secret is a
// new text, so a new entry; the old one is dropped.
let keyringCache: { text: string; keyring: Promise<Keyring> } | undefined;
let tagKeyCache: { text: string; key: Promise<CryptoKey> } | undefined;

function keyring(text: string | undefined): Promise<Keyring> {
  if (!text) return Promise.reject(new HandleConfigError("RELAY_HANDLE_KEYS is not set"));
  if (keyringCache?.text !== text) {
    const promise = parseKeyring(text);
    keyringCache = { text, keyring: promise };
    // A broken secret is not kept: a fixed one is read at once.
    promise.catch(() => {
      if (keyringCache?.keyring === promise) keyringCache = undefined;
    });
  }
  return keyringCache.keyring;
}

async function parseKeyring(text: string): Promise<Keyring> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HandleConfigError("RELAY_HANDLE_KEYS is not JSON");
  }
  const { current, keys } = (value ?? {}) as { current?: unknown; keys?: unknown };
  if (typeof current !== "string" || typeof keys !== "object" || keys === null) {
    throw new HandleConfigError("RELAY_HANDLE_KEYS needs `current` and `keys`");
  }
  const imported = new Map<string, CryptoKey>();
  for (const [id, raw] of Object.entries(keys)) {
    if (!KEY_ID.test(id) || typeof raw !== "string") {
      throw new HandleConfigError("RELAY_HANDLE_KEYS has a bad key id or key");
    }
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = fromBase64url(raw);
    } catch {
      throw new HandleConfigError(`RELAY_HANDLE_KEYS key ${id} is not base64url`);
    }
    if (bytes.length !== 32)
      throw new HandleConfigError(`RELAY_HANDLE_KEYS key ${id} is not 32 bytes`);
    imported.set(
      id,
      await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]),
    );
  }
  if (!imported.has(current)) {
    throw new HandleConfigError("RELAY_HANDLE_KEYS `current` is not one of its keys");
  }
  return { current, keys: imported };
}

function tagKey(text: string | undefined): Promise<CryptoKey> {
  if (!text) return Promise.reject(new HandleConfigError("RELAY_TAG_KEY is not set"));
  if (tagKeyCache?.text !== text) {
    const promise = (async () => {
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = fromBase64url(text);
      } catch {
        throw new HandleConfigError("RELAY_TAG_KEY is not base64url");
      }
      if (bytes.length < 32) throw new HandleConfigError("RELAY_TAG_KEY is under 32 bytes");
      return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
      ]);
    })();
    tagKeyCache = { text, key: promise };
    promise.catch(() => {
      if (tagKeyCache?.key === promise) tagKeyCache = undefined;
    });
  }
  return tagKeyCache.key;
}

/** Checks both secrets parse, so a route can answer `500 relay_misconfigured` before doing anything else. */
export async function checkHandleConfig(keys: string | undefined, tag: string | undefined) {
  await Promise.all([keyring(keys), tagKey(tag)]);
}

/** Seals with the current key. Throws `HandleConfigError` on a broken keyring. */
export async function sealHandle(sealed: Sealed, keys: string | undefined): Promise<string> {
  const ring = await keyring(keys);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: additionalData(ring.current) },
      ring.keys.get(ring.current)!,
      new TextEncoder().encode(JSON.stringify(sealed)),
    ),
  );
  const bytes = new Uint8Array(NONCE_BYTES + ciphertext.length);
  bytes.set(nonce);
  bytes.set(ciphertext, NONCE_BYTES);
  return `${ring.current}.${toBase64url(bytes)}`;
}

/**
 * Opens a handle with the key its id names: what was sealed, or null for anything that is not a handle this relay
 * sealed (malformed, an unknown or retired key id, tampered, a foreign relay's). Throws `HandleConfigError` on a
 * broken keyring.
 */
export async function openHandle(
  handle: unknown,
  keys: string | undefined,
): Promise<Sealed | null> {
  const ring = await keyring(keys);
  if (typeof handle !== "string" || handle.length > MAX_HANDLE_LENGTH) return null;
  const dot = handle.indexOf(".");
  if (dot === -1) return null;
  const id = handle.slice(0, dot);
  const key = KEY_ID.test(id) ? ring.keys.get(id) : undefined;
  if (!key) return null;
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64url(handle.slice(dot + 1));
  } catch {
    return null;
  }
  if (bytes.length < NONCE_BYTES + GCM_TAG_BYTES) return null;
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES), additionalData: additionalData(id) },
      key,
      bytes.subarray(NONCE_BYTES),
    );
  } catch {
    return null;
  }
  // Only this relay seals, so a handle that opens is well formed; checked anyway, so a bug can never send elsewhere.
  try {
    const value = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<Sealed>;
    if (
      value.v !== 1 ||
      typeof value.instance !== "string" ||
      (value.platform !== "ios" && value.platform !== "android") ||
      typeof value.pushToken !== "string" ||
      (value.voipToken !== undefined && typeof value.voipToken !== "string") ||
      (value.environment !== undefined &&
        value.environment !== "sandbox" &&
        value.environment !== "production")
    ) {
      return null;
    }
    return value as Sealed;
  } catch {
    return null;
  }
}

/** base64url(HMAC-SHA-256(RELAY_TAG_KEY, instance ‖ 0x00 ‖ pushToken)). Throws `HandleConfigError` without the key. */
export async function handleTag(
  instance: string,
  pushToken: string,
  key: string | undefined,
): Promise<string> {
  const encoder = new TextEncoder();
  const a = encoder.encode(instance);
  const b = encoder.encode(pushToken);
  const message = new Uint8Array(a.length + 1 + b.length);
  message.set(a);
  message.set(b, a.length + 1);
  return toBase64url(new Uint8Array(await crypto.subtle.sign("HMAC", await tagKey(key), message)));
}

function additionalData(id: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`brigade handle\n${id}`));
}
