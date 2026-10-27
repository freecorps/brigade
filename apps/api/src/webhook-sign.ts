// Signing outbound webhooks (RFC 0005 "Signatures"), as the Standard Webhooks specification has it
// (https://www.standardwebhooks.com, `spec/standard-webhooks.md`): a secret `whsec_<base64 key>`, and for each delivery
// `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature: v1,<base64 HMAC-SHA256>` over
// `<id>.<timestamp>.<body>`, one `v1,…` per secret in use, space separated. Any Standard Webhooks library verifies it.

/** Key bytes per secret: 32, so 256 bits of HMAC key. */
const SECRET_BYTES = 32;
export const SECRET_PREFIX = "whsec_";
/** A secret as `newWebhookSecret` makes it: the prefix and standard base64 of 32 bytes. */
const SECRET = /^whsec_[A-Za-z0-9+/]{43}=$/;

/** A new signing secret: `whsec_` and 32 random bytes in standard base64. */
export function newWebhookSecret(
  random = (n: number) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = random(SECRET_BYTES);
  if (bytes.length < SECRET_BYTES) throw new RangeError(`Need ${SECRET_BYTES} random bytes`);
  return SECRET_PREFIX + toBase64(bytes.subarray(0, SECRET_BYTES));
}

/** Whether `secret` is one `newWebhookSecret` makes. */
export function isWebhookSecret(secret: string): boolean {
  return SECRET.test(secret);
}

/** The headers a delivery carries, signed with every secret in `secrets` (the current one first). */
export async function signatureHeaders(
  secrets: readonly string[],
  id: string,
  timestamp: number,
  body: string,
): Promise<Record<string, string>> {
  const signatures = await Promise.all(secrets.map((secret) => sign(secret, id, timestamp, body)));
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signatures.map((signature) => `v1,${signature}`).join(" "),
  };
}

/** The base64 HMAC-SHA256 of `<id>.<timestamp>.<body>` under the key `secret` holds (its base64 after `whsec_`). */
export async function sign(
  secret: string,
  id: string,
  timestamp: number,
  body: string,
): Promise<string> {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return toBase64(new Uint8Array(mac));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
