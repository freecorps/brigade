// Verifying Brigade's outbound webhooks (RFC 0005 "Outbound webhooks"), as the Standard Webhooks specification has
// it (https://www.standardwebhooks.com, `spec/standard-webhooks.md`): a secret `whsec_<base64 key>`; for each delivery
// `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature`, one `v1,<base64 HMAC-SHA256>` per secret in
// use, space separated, over `<id>.<timestamp>.<body>`. Web Crypto only, so it runs in Workers, Node 20+, Deno, Bun
// and browsers. Written apart from the API's signer (apps/api src/webhook-sign.ts), which its tests check it against.

import {
  isKnownWebhookPayload,
  webhookPayloadValidator,
  type Issue,
  type UnknownWebhookPayload,
  type WebhookPayload,
} from "@freecorps/brigade-schema";

/** How far `webhook-timestamp` may be from now, either way, by default: 5 minutes, as the specification suggests. */
export const DEFAULT_TOLERANCE_SECONDS = 300;
const SECRET_PREFIX = "whsec_";
/** A header longer than this is refused before any work: no real delivery comes close. */
const HEADER_MAX = 4096;

/**
 * Why a delivery was refused:
 * - `missing_header`: no `webhook-id`, `webhook-timestamp` or `webhook-signature` (or one too long);
 * - `invalid_timestamp`: `webhook-timestamp` is not whole Unix seconds;
 * - `timestamp_too_old`, `timestamp_too_new`: further than `toleranceSeconds` from now (a replay, or a wrong clock);
 * - `invalid_secret`: a secret is not `whsec_` and base64 (a mistake on your side: no delivery verifies);
 * - `invalid_option`: `toleranceSeconds` is not a finite number of 0 or more, or `now` is not a finite time (a mistake
 *   on your side too: refused rather than replaced by a default, so the replay check is never quietly off);
 * - `invalid_signature`: no `v1` signature matches any secret;
 * - `invalid_json`: signed, but the body is not JSON;
 * - `invalid_payload`: signed JSON, but no version 1 payload: another `version`, a broken envelope, or a known `type`
 *   with fields that break it (`issues` says why; `body` holds it). A `type` added since is no refusal: see `known`.
 */
export type WebhookVerificationCode =
  | "missing_header"
  | "invalid_timestamp"
  | "timestamp_too_old"
  | "timestamp_too_new"
  | "invalid_secret"
  | "invalid_option"
  | "invalid_signature"
  | "invalid_json"
  | "invalid_payload";

export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
  readonly code: WebhookVerificationCode;
  /** For `invalid_payload`: what the payload's validator found. */
  readonly issues: readonly Issue[];
  /** For `invalid_payload`: the parsed body. Its signature is valid; its shape is not one this SDK knows. */
  readonly body: unknown;

  constructor(
    code: WebhookVerificationCode,
    message: string,
    details: { issues?: readonly Issue[]; body?: unknown } = {},
  ) {
    super(message);
    this.code = code;
    this.issues = details.issues ?? [];
    this.body = details.body;
  }
}

/**
 * Headers as `Request.headers` has them, or a plain object (Node's `IncomingHttpHeaders`, any case). A header sent
 * twice reads as `Headers` reads it, whichever you pass: its values joined with `", "`.
 */
export type WebhookHeaders =
  | { get(name: string): string | null }
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export type VerifyWebhookOptions = {
  /** The endpoint's signing secret (`whsec_…`), or every secret in use while you rotate it. */
  secret: string | readonly string[];
  headers: WebhookHeaders;
  /** The body exactly as received: read it with `request.text()` or as bytes, never re-serialized JSON. */
  body: string | Uint8Array | ArrayBuffer;
  /** Default `DEFAULT_TOLERANCE_SECONDS`; a finite number of 0 or more (`invalid_option` otherwise). */
  toleranceSeconds?: number;
  /** The current time, epoch milliseconds or a `Date`; for tests. Must be finite (`invalid_option` otherwise). */
  now?: number | Date;
};

type Verified = {
  ok: true;
  /** `webhook-id`: the event's id, the same on every retry. De-duplicate by it. */
  webhookId: string;
  /** `webhook-timestamp`: when this attempt was signed, Unix seconds. */
  timestamp: number;
};

/**
 * A delivery whose signature and timestamp hold. `known`: its `type` is one this SDK knows, and `payload` narrows by
 * it. Otherwise it is an event Brigade added since this SDK was built (`UnknownWebhookPayload`: the envelope, and
 * `data` as sent): answer it with a 2xx all the same, or Brigade retries it and may turn the endpoint off.
 */
export type VerifiedWebhook =
  | (Verified & { known: true; payload: WebhookPayload })
  | (Verified & { known: false; payload: UnknownWebhookPayload });

export type WebhookVerification = VerifiedWebhook | { ok: false; error: WebhookVerificationError };

const encoder = new TextEncoder();

/**
 * Checks a delivery's signature and timestamp, then parses its payload. Never throws for a bad delivery: the answer
 * is `{ ok: false, error }`, and a receiver should answer it with a 4xx (Brigade retries anything else). Answer a
 * verified delivery with a 2xx quickly; work that takes longer belongs in a queue.
 */
export async function verifyWebhook(options: VerifyWebhookOptions): Promise<WebhookVerification> {
  const refuse = (...args: ConstructorParameters<typeof WebhookVerificationError>) => ({
    ok: false as const,
    error: new WebhookVerificationError(...args),
  });
  const id = header(options.headers, "webhook-id");
  const stamp = header(options.headers, "webhook-timestamp");
  const signature = header(options.headers, "webhook-signature");
  if (id === undefined || stamp === undefined || signature === undefined) {
    return refuse("missing_header", "Missing a webhook-id, webhook-timestamp or webhook-signature");
  }
  if (!/^\d{1,15}$/.test(stamp)) {
    return refuse("invalid_timestamp", "webhook-timestamp is not Unix seconds");
  }
  const timestamp = Number(stamp);
  const now = options.now ?? Date.now();
  const nowMs = typeof now === "number" ? now : now.getTime();
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  // NaN or Infinity would make both comparisons below false, and so turn the replay check off.
  if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
    return refuse("invalid_option", "toleranceSeconds is not a finite number of 0 or more");
  }
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) {
    return refuse("invalid_option", "now is not a finite time");
  }
  const nowSeconds = Math.floor(nowMs / 1000);
  if (timestamp < nowSeconds - tolerance) {
    return refuse("timestamp_too_old", "webhook-timestamp is too far in the past");
  }
  if (timestamp > nowSeconds + tolerance) {
    return refuse("timestamp_too_new", "webhook-timestamp is too far in the future");
  }

  const secrets = typeof options.secret === "string" ? [options.secret] : [...options.secret];
  const keys: Uint8Array<ArrayBuffer>[] = [];
  for (const secret of secrets) {
    const key = secretKey(secret);
    if (!key) return refuse("invalid_secret", "A secret is not whsec_ and base64");
    keys.push(key);
  }
  if (keys.length === 0) return refuse("invalid_secret", "No secret given");

  const body = bodyBytes(options.body);
  const signed = concat(encoder.encode(`${id}.${stamp}.`), body);
  const expected = await Promise.all(keys.map((key) => hmac(key, signed)));
  let matched = false;
  // Space separated; `, ` too where a header sent twice was joined (a signature never ends in a comma).
  for (const entry of signature.split(/,?\s+/)) {
    const comma = entry.indexOf(",");
    // Other versions (`v1a,…`) are not Brigade's: skipped, as the specification says.
    if (comma < 0 || entry.slice(0, comma) !== "v1") continue;
    const given = fromBase64(entry.slice(comma + 1));
    if (!given) continue;
    // Every candidate is compared, in constant time, so the time taken says nothing about which one matched.
    for (const mac of expected) matched = timingSafeEqual(mac, given) || matched;
  }
  if (!matched) return refuse("invalid_signature", "No signature matches");

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return refuse("invalid_json", "The body is not JSON");
  }
  const parsed = webhookPayloadValidator(json);
  if (!parsed.ok) {
    return refuse("invalid_payload", "Not a version 1 payload", {
      issues: parsed.issues,
      body: json,
    });
  }
  const verified = { ok: true as const, webhookId: id, timestamp };
  return isKnownWebhookPayload(parsed.value)
    ? { ...verified, known: true, payload: parsed.value }
    : { ...verified, known: false, payload: parsed.value };
}

function header(headers: WebhookHeaders, name: string): string | undefined {
  let value: string | readonly string[] | null | undefined;
  if (typeof headers.get === "function") {
    value = (headers as { get(name: string): string | null }).get(name);
  } else {
    const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>;
    const key = Object.keys(record).find((one) => one.toLowerCase() === name);
    value = key === undefined ? undefined : record[key];
  }
  // A repeated header (Node keeps a list): joined as `Headers.get` joins it, so both read the same.
  if (Array.isArray(value)) value = value.join(", ");
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= HEADER_MAX ? trimmed : undefined;
}

/** The HMAC key a secret holds: its base64 after `whsec_` (the prefix is optional, as in the specification). */
function secretKey(secret: string): Uint8Array<ArrayBuffer> | undefined {
  const encoded = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
  const key = fromBase64(encoded);
  return key && key.length > 0 ? key : undefined;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

function bodyBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof body === "string") return encoder.encode(body);
  return body instanceof Uint8Array ? body : new Uint8Array(body);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Standard base64 (padding optional), or undefined for anything else. */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 === 1) return undefined;
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** Whether `a` and `b` hold the same bytes, in time that depends only on their lengths. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
