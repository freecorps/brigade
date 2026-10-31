// An instance's identity on the relay (RFC 0015 section 1): an Ed25519 key pair, an id derived from the first public
// key, and a signature on every call. The instance signs with `signRequest`, the relay checks with `verifyRequest`;
// both sides use this module so the signed string can never drift between them.
//
// Headers: `Brigade-Instance` (the id), `Brigade-Key` (the signing key, raw 32 bytes, base64url), `Brigade-Timestamp`
// (decimal Unix seconds) and `Brigade-Signature` (Ed25519, base64url) over the UTF-8 string, exactly:
//
//   METHOD + "\n" + pathWithQuery + "\n" + timestamp + "\n" + hex(SHA-256(rawBodyBytes))
//
// METHOD uppercase; the path with its query string when there is one (`/v1/health?deep=1`), no scheme or host; the
// hash lowercase hex over the exact body bytes sent (SHA-256 of no bytes for a request without a body). A timestamp
// more than 5 minutes off the relay's clock is refused; a replay inside that window only repeats a call.

import { fromBase64url, toBase64url } from "./base64url.ts";

const ED25519 = { name: "Ed25519" } as const;
/** The most a signed timestamp may be off the relay's clock, either way. */
export const MAX_CLOCK_SKEW_SECONDS = 300;

/** `ins_` + the first 22 base64url characters of SHA-256 of the raw public key (132 bits). */
export async function instanceId(publicKeyRaw: Uint8Array): Promise<string> {
  return "ins_" + toBase64url(await sha256(publicKeyRaw)).slice(0, 22);
}

/** A new instance key: the private key as PKCS#8, the public key raw (32 bytes), both base64url, and its id. */
export async function generateInstanceKey(): Promise<{
  privateKey: string;
  publicKey: string;
  instance: string;
}> {
  const pair = (await crypto.subtle.generateKey(ED25519, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: toBase64url(
      new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
    ),
    publicKey: toBase64url(publicKey),
    instance: await instanceId(publicKey),
  };
}

export type SignRequestInput = {
  /** An Ed25519 private `CryptoKey`, or the PKCS#8 key as base64url (`RELAY_INSTANCE_KEY`). */
  privateKey: CryptoKey | string;
  /** The signing key's raw public key, as bytes or base64url. */
  publicKey: Uint8Array | string;
  instance: string;
  method: string;
  /** The URL's path and query (`/v1/health?deep=1`), without scheme or host. */
  path: string;
  /** The exact bytes sent; an empty body (a GET) is the empty string. */
  body: Uint8Array | string;
  /** Milliseconds since the epoch, like `Date.now()`. */
  now: number;
};

/** The four `Brigade-*` headers for one call. */
export async function signRequest(input: SignRequestInput): Promise<Record<string, string>> {
  const privateKey =
    typeof input.privateKey === "string"
      ? await crypto.subtle.importKey("pkcs8", fromBase64url(input.privateKey), ED25519, false, [
          "sign",
        ])
      : input.privateKey;
  const timestamp = String(Math.floor(input.now / 1000));
  const signature = await crypto.subtle.sign(
    ED25519,
    privateKey,
    await signedBytes(input.method, input.path, timestamp, input.body),
  );
  return {
    "Brigade-Instance": input.instance,
    "Brigade-Key":
      typeof input.publicKey === "string" ? input.publicKey : toBase64url(input.publicKey),
    "Brigade-Timestamp": timestamp,
    "Brigade-Signature": toBase64url(new Uint8Array(signature)),
  };
}

export type VerifyRequestInput = {
  method: string;
  /** The request's path and query, as received (`url.pathname + url.search`). */
  path: string;
  headers: { get(name: string): string | null };
  body: Uint8Array | string;
  now: number;
};

/**
 * `original`: SHA-256 of the key gives the instance id, so the key is the instance's first and needs no lookup. Any
 * other key only proves who signed: the relay must find it in the instance's registry record.
 */
export type VerifiedRequest = { ok: true; instance: string; key: string; original: boolean };
export type VerifyFailure = {
  ok: false;
  error: "missing_signature" | "bad_signature" | "stale_timestamp";
};

export async function verifyRequest(
  input: VerifyRequestInput,
): Promise<VerifiedRequest | VerifyFailure> {
  const instance = input.headers.get("Brigade-Instance");
  const key = input.headers.get("Brigade-Key");
  const timestamp = input.headers.get("Brigade-Timestamp");
  const signature = input.headers.get("Brigade-Signature");
  if (!instance || !key || !timestamp || !signature)
    return { ok: false, error: "missing_signature" };
  if (!/^\d{1,12}$/.test(timestamp) || !/^ins_[A-Za-z0-9_-]{22}$/.test(instance)) {
    return { ok: false, error: "bad_signature" };
  }
  if (Math.abs(Number(timestamp) - input.now / 1000) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, error: "stale_timestamp" };
  }
  let valid: boolean;
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = fromBase64url(key);
    const sig = fromBase64url(signature);
    if (raw.length !== 32 || sig.length !== 64) return { ok: false, error: "bad_signature" };
    const publicKey = await crypto.subtle.importKey("raw", raw, ED25519, false, ["verify"]);
    valid = await crypto.subtle.verify(
      ED25519,
      publicKey,
      sig,
      await signedBytes(input.method, input.path, timestamp, input.body),
    );
  } catch {
    // Not base64url, or not a point on the curve.
    return { ok: false, error: "bad_signature" };
  }
  if (!valid) return { ok: false, error: "bad_signature" };
  return { ok: true, instance, key, original: (await instanceId(raw)) === instance };
}

/** The signed string (module comment), UTF-8. */
async function signedBytes(
  method: string,
  path: string,
  timestamp: string,
  body: Uint8Array | string,
): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const digest = [...(await sha256(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${timestamp}\n${digest}`);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}
