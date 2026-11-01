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

/** How urgent a push is, as the relay takes it (`low`, `high`, `page`). */
export type PushUrgency = "low" | "high" | "page";

export const PUSH_URGENCIES: readonly PushUrgency[] = ["low", "high", "page"];

/**
 * What a version 2 envelope seals besides the content (RFC 0015 section 4), so the relay can neither replay a page
 * for long, raise its urgency, nor have it open as another instance's.
 */
export interface PushSealed {
  /** When the instance sealed it, Unix seconds. */
  iat: number;
  /** Until when it may be shown: `iat` plus the TTL the instance gives the relay. Unix seconds. */
  exp: number;
  /** The instance's origin (`https://brigade.example.com`), as `URL.origin` writes it. */
  origin: string;
  urgency: PushUrgency;
}

/** Longest receipt URL and token the extension accepts; `sealPush` leaves a longer one out instead of sealing it. */
export const PUSH_RECEIPT_MAX_LENGTH = 512;

/** The encrypted push as it travels: HPKE's encapsulated key and ciphertext, base64url. */
export interface PushEnvelopeV1 {
  v: typeof PUSH_ENVELOPE_VERSION;
  enc: string;
  ct: string;
}

/**
 * Version 2 (RFC 0015 section 4): the same HPKE suite under its own `info`, and `k`, the id of the device key it is
 * sealed to (`pushKeyId`), in clear so a phone with one key per instance tries that one only. Its plaintext also
 * seals `PushSealed`.
 */
export interface PushEnvelopeV2 {
  v: typeof PUSH_ENVELOPE_V2;
  k: string;
  enc: string;
  ct: string;
}

/** Any envelope a relay carries and a phone opens. */
export type PushEnvelope = PushEnvelopeV1 | PushEnvelopeV2;

export const PUSH_ENVELOPE_VERSION = 1;
export const PUSH_ENVELOPE_V2 = 2;

/**
 * HPKE `info`: binds every ciphertext to this protocol and version, so a key reused elsewhere cannot be fed a
 * Brigade push or the other way round. The iOS Notification Service Extension uses the same string.
 */
export const PUSH_HPKE_INFO = "app.freecorps.brigade push v1";
/** HPKE `info` of version 2: a v2 ciphertext relabelled as v1 (or the other way round) does not open. */
export const PUSH_HPKE_INFO_V2 = "app.freecorps.brigade push v2";

/** Plaintext limit in UTF-8 bytes: about 2.8 KB once sealed and encoded, leaving room in APNs' 4 KB. */
export const PUSH_PLAINTEXT_MAX_BYTES = 2048;

/** Longest TTL a v2 envelope may seal: APNs keeps an undelivered push about 30 days (apps/relay `MAX_TTL_SECONDS`). */
export const PUSH_MAX_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * How far the phone's clock may be ahead of the instance's before a page counts as expired: the 5 minutes the relay
 * allows a signed request (RFC 0015 "Clock skew"). A page within it is shown; one past it is the fallback text.
 */
export const PUSH_CLOCK_SKEW_SECONDS = 5 * 60;

/** A key id: 8 base64url characters (`pushKeyId`). */
export const PUSH_KEY_ID = /^[A-Za-z0-9_-]{8}$/;

const encoder = new TextEncoder();
const info = encoder.encode(PUSH_HPKE_INFO);
const infoV2 = encoder.encode(PUSH_HPKE_INFO_V2);

/** Encrypts `content` for a device, given its public key as the app reports it (base64url, uncompressed P-256). */
export async function sealPush(
  devicePublicKey: string,
  content: PushContent,
): Promise<PushEnvelopeV1> {
  const plaintext = contentBytes(content, {});
  const { enc, ct } = await seal(parseDevicePublicKey(devicePublicKey), plaintext, { info });
  return { v: PUSH_ENVELOPE_VERSION, enc: toBase64url(enc), ct: toBase64url(ct) };
}

/** Who seals a version 2 envelope and how: what `sealPushV2` puts in `PushSealed`. */
export interface PushSender {
  /** The instance's origin: where the app signs in, as `URL.origin` writes it. Anything else throws. */
  origin: string;
  urgency: PushUrgency;
  /** The TTL the instance sends the relay (`ttlSeconds`, or the relay's default for the urgency), 0 to 30 days. */
  ttlSeconds: number;
  /** Now, in ms since the epoch; `Date.now()` when left out. */
  now?: number;
}

/**
 * Encrypts `content` for a device as a version 2 envelope (RFC 0015 section 4): it seals when it was made, until
 * when it may be shown, the instance's origin and the urgency, and names the device key in clear (`k`). A phone from
 * before version 2 shows the fallback text for it, so an instance sends it only to apps that open it.
 */
export async function sealPushV2(
  devicePublicKey: string,
  content: PushContent,
  sender: PushSender,
): Promise<PushEnvelopeV2> {
  const origin = parseOrigin(sender.origin);
  if (origin === undefined || origin !== sender.origin) {
    throw new Error("sender origin must be an http(s) origin, as URL.origin writes it");
  }
  if (!PUSH_URGENCIES.includes(sender.urgency)) throw new Error("unknown urgency");
  const { ttlSeconds } = sender;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 0 || ttlSeconds > PUSH_MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be an integer from 0 to ${PUSH_MAX_TTL_SECONDS}`);
  }
  const iat = Math.floor((sender.now ?? Date.now()) / 1000);
  const key = parseDevicePublicKey(devicePublicKey);
  const plaintext = contentBytes(content, {
    iat,
    exp: iat + ttlSeconds,
    origin,
    urgency: sender.urgency,
  });
  const { enc, ct } = await seal(key, plaintext, { info: infoV2 });
  return {
    v: PUSH_ENVELOPE_V2,
    k: await pushKeyId(key),
    enc: toBase64url(enc),
    ct: toBase64url(ct),
  };
}

/** The plaintext of a push: only the fields set, in a fixed order. Throws over `PUSH_PLAINTEXT_MAX_BYTES`. */
function contentBytes(content: PushContent, sealed: Partial<PushSealed>): Uint8Array {
  const { title, body, incident, workspace, receipt } = content;
  // One the phone would drop anyway (malformed, or for v2 not on the sealed origin) only costs bytes a page may need.
  const kept =
    receipt &&
    parseReceipt(receipt) &&
    (!sealed.origin || parseOrigin(receipt.url) === sealed.origin)
      ? { url: receipt.url, token: receipt.token }
      : undefined;
  const plaintext = encoder.encode(
    JSON.stringify({ title, body, incident, workspace, receipt: kept, ...sealed }),
  );
  if (plaintext.length > PUSH_PLAINTEXT_MAX_BYTES) {
    throw new Error(`push content is ${plaintext.length} bytes, over ${PUSH_PLAINTEXT_MAX_BYTES}`);
  }
  return plaintext;
}

/**
 * The id of a device key, as a version 2 envelope names it (`k`): base64url of the first 6 bytes of SHA-256 over the
 * uncompressed public key (65 bytes), 8 characters. Short, because it travels in clear in every push; only a hint
 * for which key to try (the AEAD still decides), so 48 bits are plenty among the few keys of one phone. Not the
 * device id (that is the key's x coordinate, apps/mobile `deviceId`), so the relay cannot tie a push to a device row.
 * The iOS extension and the Android service compute it the same way.
 */
export async function pushKeyId(publicKey: string | Uint8Array): Promise<string> {
  const key = typeof publicKey === "string" ? parseDevicePublicKey(publicKey) : publicKey;
  if (key.length !== P256_PUBLIC_KEY_LENGTH || key[0] !== 0x04) {
    throw new Error("device public key must be an uncompressed P-256 point");
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(key)));
  return toBase64url(digest.subarray(0, 6));
}

/**
 * Decrypts an envelope (what the phone does natively; used by tests and non-native clients). Version 2's content
 * comes with what it sealed (`openPushV2`); its time, origin and pairing are not checked here (`openOnPhone` does).
 */
export async function openPush(
  recipient: HpkeRecipient,
  envelope: PushEnvelope,
): Promise<PushContent> {
  if (envelope.v === PUSH_ENVELOPE_V2) return openPushV2(recipient, envelope);
  const plaintext = await open(
    recipient,
    { enc: fromBase64url(envelope.enc), ct: fromBase64url(envelope.ct) },
    { info },
  );
  return parseContent(decodeJson(plaintext));
}

/** A version 2 envelope's content and what it sealed; throws when it does not open or is not well formed. */
export async function openPushV2(
  recipient: HpkeRecipient,
  envelope: PushEnvelopeV2,
): Promise<PushContent & PushSealed> {
  const plaintext = await open(
    recipient,
    { enc: fromBase64url(envelope.enc), ct: fromBase64url(envelope.ct) },
    { info: infoV2 },
  );
  const value = decodeJson(plaintext);
  const content = parseContent(value);
  const sealed = parseSealed(value);
  if (!sealed) throw new Error("push content has no valid { iat, exp, origin, urgency }");
  return { ...content, ...sealed };
}

/** Why a phone shows the fallback text instead of a push (`openOnPhone`). */
export type PushRefusal =
  /** Not an envelope this app opens: another version, a missing or broken field. */
  | "malformed"
  /** v2: no key on this phone has the id it names. */
  | "unknown_key"
  /** The AEAD failed (another key, tampered bytes) or the plaintext is not a push. */
  | "not_opened"
  /** v2: past its sealed `exp` (with `PUSH_CLOCK_SKEW_SECONDS`). */
  | "expired"
  /** v2: sealed for another origin than the one the key that opened it belongs to. */
  | "wrong_origin"
  /**
   * v2: the phone is not paired with the sealed origin: it never registered with that instance, or the member signed
   * out on it (the app clears the pairing when they do; RFC 0015 section 4).
   */
  | "not_paired";

/**
 * One device key on a phone, and the instance origin it belongs to. Null: the key from before keys per instance,
 * which the app has not claimed for an origin yet (it does at its next launch); it counts as the paired instance's.
 */
export interface PhoneKey {
  origin: string | null;
  recipient: HpkeRecipient;
}

export type PhoneOpened =
  | { ok: true; version: 1; content: PushContent }
  | { ok: true; version: 2; content: PushContent & PushSealed }
  | {
      ok: false;
      reason: PushRefusal;
      /**
       * How loud the fallback text may be: the sealed urgency, for a refusal of a page that opened (`wrong_origin`,
       * `not_paired`), so the relay cannot make a `low` push it got refused ring as a page. Absent where nothing
       * sealed can be trusted or where it must stay loud (`malformed`, `unknown_key`, `not_opened`, and `expired`, so
       * a phone clock running ahead never quiets a page): the clear urgency then decides, as before.
       */
      urgency?: PushUrgency;
    };

/**
 * The urgency a phone shows a push at, its content or the fallback text: the sealed one whenever the push opened (a
 * call sealed as anything less than a page is shown at that urgency, not rung), else the clear one (`clear`).
 */
export function fallbackUrgency(opened: PhoneOpened, clear: PushUrgency): PushUrgency {
  if (opened.ok) return opened.version === 2 ? opened.content.urgency : clear;
  return opened.urgency ?? clear;
}

/**
 * What a phone does with a push's envelope (RFC 0015 section 4), the reference the iOS extension
 * (BrigadePushCrypto.swift) and the Android service (PushPayload.kt, Pages.kt) follow:
 *
 * - **v1**: tries its keys, those of `paired` origins first, as before keys per instance.
 * - **v2**: tries only the key whose id is `k`; then refuses one past its sealed `exp` (plus the clock skew), sealed
 *   for an origin other than its key's, or for an origin the phone is not paired with.
 *
 * Every refusal is the fallback text on the phone, never silence (RFC 0006). The sealed urgency only lowers what the
 * phone does for a push that opened (refused or not, `urgency`); one that does not open, or opened expired, keeps the
 * clear urgency. Taking the interruption level from the sealed urgency and posting the receipt only to the sealed
 * origin are the caller's (`content.urgency`, `content.origin`; `fallbackUrgency`).
 */
export async function openOnPhone(
  envelope: unknown,
  keys: readonly PhoneKey[],
  phone: { now: number; paired: (origin: string) => boolean },
): Promise<PhoneOpened> {
  const parsed = parsePushEnvelope(envelope);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.v === PUSH_ENVELOPE_VERSION) {
    const ordered = [
      ...keys.filter((key) => key.origin !== null && phone.paired(key.origin)),
      ...keys.filter((key) => key.origin === null || !phone.paired(key.origin)),
    ];
    for (const key of ordered) {
      try {
        return { ok: true, version: 1, content: await openPush(key.recipient, parsed) };
      } catch {
        // The next key.
      }
    }
    return { ok: false, reason: "not_opened" };
  }
  let key: PhoneKey | undefined;
  for (const candidate of keys) {
    if ((await pushKeyId(candidate.recipient.publicKey)) === parsed.k) {
      key = candidate;
      break;
    }
  }
  if (!key) return { ok: false, reason: "unknown_key" };
  let content: PushContent & PushSealed;
  try {
    content = await openPushV2(key.recipient, parsed);
  } catch {
    return { ok: false, reason: "not_opened" };
  }
  if (Math.floor(phone.now / 1000) > content.exp + PUSH_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }
  // The key from before keys per instance, not yet claimed by the app, belongs to the one paired instance.
  if (key.origin !== null && key.origin !== content.origin) {
    return { ok: false, reason: "wrong_origin", urgency: content.urgency };
  }
  if (!phone.paired(content.origin)) {
    return { ok: false, reason: "not_paired", urgency: content.urgency };
  }
  return { ok: true, version: 2, content };
}

function decodeJson(plaintext: Uint8Array): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
}

function parseContent(value: unknown): PushContent {
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
 * The sealed fields of a v2 plaintext as the phone takes them: whole Unix seconds, `iat <= exp <= iat + 30 days`, an
 * origin already in `URL.origin` form, a known urgency.
 */
function parseSealed(value: unknown): PushSealed | undefined {
  if (!isRecord(value)) return undefined;
  const { iat, exp, origin, urgency } = value;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return undefined;
  const issued = iat as number;
  const expires = exp as number;
  if (issued < 0 || expires < issued || expires - issued > PUSH_MAX_TTL_SECONDS) return undefined;
  if (typeof origin !== "string" || parseOrigin(origin) !== origin) return undefined;
  if (typeof urgency !== "string" || !PUSH_URGENCIES.includes(urgency as PushUrgency)) {
    return undefined;
  }
  return { iat: issued, exp: expires, origin, urgency: urgency as PushUrgency };
}

/**
 * The origin of an http(s) URL (`scheme://host[:port]`, lowercase, the default port left out), as `URL.origin`
 * gives it and the native code compares; undefined for anything else.
 */
export function parseOrigin(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (!parsed.hostname) return undefined;
  return parsed.origin;
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

/** Accepts an envelope (version 1 or 2) from untrusted JSON (a relay request), or returns null. */
export function parsePushEnvelope(value: unknown): PushEnvelope | null {
  if (!isRecord(value) || (value.v !== PUSH_ENVELOPE_VERSION && value.v !== PUSH_ENVELOPE_V2)) {
    return null;
  }
  const { enc, ct, k } = value;
  if (typeof enc !== "string" || typeof ct !== "string") return null;
  try {
    // 16 bytes is the GCM tag alone: an empty plaintext.
    if (fromBase64url(enc).length !== P256_PUBLIC_KEY_LENGTH || fromBase64url(ct).length < 16)
      return null;
  } catch {
    return null;
  }
  if (value.v === PUSH_ENVELOPE_VERSION) return { v: PUSH_ENVELOPE_VERSION, enc, ct };
  if (typeof k !== "string" || !PUSH_KEY_ID.test(k)) return null;
  return { v: PUSH_ENVELOPE_V2, k, enc, ct };
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
