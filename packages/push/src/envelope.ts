import { fromBase64url, toBase64url } from "./base64url.ts";
import { open, P256_PUBLIC_KEY_LENGTH, seal, type HpkeRecipient } from "./hpke.ts";

/**
 * What the instance encrypts for one device. The relay and the push service only ever see the envelope. Keep it
 * small: APNs takes 4 KB for the whole payload, and the envelope grows by a third in base64url.
 */
export interface PushContent {
  title: string;
  body: string;
  /** The incident a page is about, so a call's ack can name it (RFC 0010). Sealed like the rest. */
  incident?: string;
  /**
   * The workspace the incident is in, so a notification's Acknowledge action knows where to send it (RFC 0004
   * "Clients"). The app offers the action only on a page that carries both.
   */
  workspace?: string;
  /**
   * Where the extension reports that it opened this page, and the token that proves it (RFC 0006 "Delivery
   * receipts"). Sealed, so only this device ever sees the token.
   */
  receipt?: PushReceipt;
}

/** A delivery receipt's address (`https://…/receipts`) and its single-page token. */
export interface PushReceipt {
  url: string;
  token: string;
}

/** Longest receipt URL and token the extension accepts; `sealPush` leaves a longer one out instead of sealing it. */
export const PUSH_RECEIPT_MAX_LENGTH = 512;

/** The encrypted push as it travels: HPKE's encapsulated key and ciphertext, base64url. */
export interface PushEnvelope {
  v: typeof PUSH_ENVELOPE_VERSION;
  enc: string;
  ct: string;
}

export const PUSH_ENVELOPE_VERSION = 1;

/**
 * HPKE `info`: binds every ciphertext to this protocol and version, so a key reused elsewhere cannot be fed a
 * Brigade push or the other way round. The iOS Notification Service Extension uses the same string.
 */
export const PUSH_HPKE_INFO = "app.freecorps.brigade push v1";

/** Plaintext limit in UTF-8 bytes: about 2.8 KB once sealed and encoded, leaving room in APNs' 4 KB. */
export const PUSH_PLAINTEXT_MAX_BYTES = 2048;

const encoder = new TextEncoder();
const info = encoder.encode(PUSH_HPKE_INFO);

/** Encrypts `content` for a device, given its public key as the app reports it (base64url, uncompressed P-256). */
export async function sealPush(
  devicePublicKey: string,
  content: PushContent,
): Promise<PushEnvelope> {
  const { title, body, incident, workspace, receipt } = content;
  // Only the fields set, in a fixed order.
  const plaintext = encoder.encode(
    JSON.stringify({
      title,
      body,
      incident,
      workspace,
      // One the extension would drop anyway only costs bytes a page may need.
      receipt: receipt && parseReceipt(receipt) && { url: receipt.url, token: receipt.token },
    }),
  );
  if (plaintext.length > PUSH_PLAINTEXT_MAX_BYTES) {
    throw new Error(`push content is ${plaintext.length} bytes, over ${PUSH_PLAINTEXT_MAX_BYTES}`);
  }
  const { enc, ct } = await seal(parseDevicePublicKey(devicePublicKey), plaintext, { info });
  return { v: PUSH_ENVELOPE_VERSION, enc: toBase64url(enc), ct: toBase64url(ct) };
}

/** Decrypts an envelope (what the iOS extension does natively; used by tests and non-native clients). */
export async function openPush(
  recipient: HpkeRecipient,
  envelope: PushEnvelope,
): Promise<PushContent> {
  const plaintext = await open(
    recipient,
    { enc: fromBase64url(envelope.enc), ct: fromBase64url(envelope.ct) },
    { info },
  );
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    (value.incident !== undefined && typeof value.incident !== "string") ||
    (value.workspace !== undefined && typeof value.workspace !== "string")
  ) {
    throw new Error("push content is not { title, body, incident?, workspace?, receipt? }");
  }
  const content: PushContent = { title: value.title, body: value.body };
  if (typeof value.incident === "string") content.incident = value.incident;
  if (typeof value.workspace === "string") content.workspace = value.workspace;
  const receipt = parseReceipt(value.receipt);
  if (receipt) content.receipt = receipt;
  return content;
}

/**
 * A sealed receipt as the extension takes it: an https URL (http only for a loopback development server) and a
 * token, each at most `PUSH_RECEIPT_MAX_LENGTH`. Anything else is no receipt: the page still shows.
 */
export function parseReceipt(value: unknown): PushReceipt | undefined {
  if (!isRecord(value) || typeof value.url !== "string" || typeof value.token !== "string") {
    return undefined;
  }
  const { url, token } = value;
  if (url.length > PUSH_RECEIPT_MAX_LENGTH || token.length > PUSH_RECEIPT_MAX_LENGTH) {
    return undefined;
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) return undefined;
  if (parsed.username || parsed.password) return undefined;
  return { url, token };
}

/** Accepts an envelope from untrusted JSON (a relay request), or returns null. */
export function parsePushEnvelope(value: unknown): PushEnvelope | null {
  if (!isRecord(value) || value.v !== PUSH_ENVELOPE_VERSION) return null;
  const { enc, ct } = value;
  if (typeof enc !== "string" || typeof ct !== "string") return null;
  try {
    // 16 bytes is the GCM tag alone: an empty plaintext.
    if (fromBase64url(enc).length !== P256_PUBLIC_KEY_LENGTH || fromBase64url(ct).length < 16)
      return null;
  } catch {
    return null;
  }
  return { v: PUSH_ENVELOPE_VERSION, enc, ct };
}

/** A device public key from its base64url form; throws unless it is an uncompressed P-256 point. */
export function parseDevicePublicKey(value: string): Uint8Array<ArrayBuffer> {
  const key = fromBase64url(value);
  if (key.length !== P256_PUBLIC_KEY_LENGTH || key[0] !== 0x04) {
    throw new Error("device public key must be an uncompressed P-256 point (65 bytes, base64url)");
  }
  return key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
