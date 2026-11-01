import { toBase64url, type PushEnvelope } from "@freecorps/brigade-push";

/**
 * APNs over its HTTP/2 provider API with token-based authentication (an ES256 JWT signed with the team's `.p8`
 * key). A Worker's `fetch` reaches it from Cloudflare's edge, which speaks HTTP/2 to APNs; local workerd does
 * not (spike S1).
 */

export type ApnsEnvironment = "sandbox" | "production";

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: "api.sandbox.push.apple.com",
  production: "api.push.apple.com",
};

export type Urgency = "low" | "high" | "page";

/**
 * `alert`: a regular push, decrypted by the Notification Service Extension. `call`: a PushKit VoIP push that
 * rings the phone through CallKit (RFC 0010). Apple terminates an app that receives a VoIP push and does not
 * report a call, so a call push carries nothing the app could decide to ignore: only a call id and the sealed
 * envelope, and the app reports the call before it decrypts.
 */
export type PushKind = "alert" | "call";

export interface ApnsCredentials {
  /** The `.p8` file's PEM text (PKCS #8, P-256). */
  key: string;
  keyId: string;
  teamId: string;
}

export interface ApnsPush {
  /** The device token from `getDevicePushTokenAsync()`, hex; for a call, the PushKit token. */
  deviceToken: string;
  /** Defaults to `alert`. */
  kind?: PushKind;
  /** For a call: the CallKit call UUID, lowercase. Repeats of one page share it, so they ring once. */
  callId?: string;
  envelope: PushEnvelope;
  urgency: Urgency;
  /**
   * A Critical Alert (RFC 0006 "Critical Alerts"): rings through silent mode and Do Not Disturb. Only for an alert
   * at `page` urgency, and only to a device whose member allowed Critical Alerts in an app build with the entitlement
   * (the instance knows from registration). Without the permission iOS plays it as a time-sensitive alert.
   */
  critical?: boolean;
  /** `apns-collapse-id`: a repeat replaces the notification on screen (64 bytes at most). */
  collapseId?: string;
  /** Seconds since the epoch after which APNs drops an undelivered push; 0 means try once. Required, so no
   * caller gets "try once" by forgetting it. */
  expiration: number;
}

/**
 * The `alert` APNs shows when the Notification Service Extension cannot run (iOS 16 and older, or no time
 * left). Localization keys, so the relay never needs the recipient's language and never sees content: the app
 * bundle carries the strings in every locale (`push_fallback_*` in packages/i18n). The extension replaces them
 * with the decrypted text, or keeps them if decryption fails. Never silent (RFC 0006).
 */
export const FALLBACK_ALERT = {
  "title-loc-key": "push_fallback_title",
  "loc-key": "push_fallback_body",
} as const;

/** CallKit identifies a call by UUID; the relay only checks the form. */
export const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** VoIP pushes go to the app's `.voip` topic, which needs the VoIP Services capability on the App ID. */
export function voipTopic(topic: string): string {
  return `${topic}.voip`;
}

/** Device tokens are 32 bytes today; Apple says to treat the length as variable. */
export const DEVICE_TOKEN = /^[0-9a-f]{64,200}$/i;
const COLLAPSE_ID_MAX_BYTES = 64;

/** The APNs request, ready for `fetch`. Throws on a malformed device token or collapse id. */
export function buildApnsRequest(
  push: ApnsPush,
  options: { environment: ApnsEnvironment; topic: string; jwt: string },
): Request {
  if (!DEVICE_TOKEN.test(push.deviceToken)) throw new Error("invalid device token");
  const call = push.kind === "call";
  if (call && (push.callId === undefined || !CALL_ID.test(push.callId))) {
    throw new Error("a call needs a lowercase UUID call id");
  }
  if (call && push.urgency !== "page") throw new Error("only a page rings");
  if (push.critical && (call || push.urgency !== "page")) {
    throw new Error("only a page alert is critical");
  }
  const headers = new Headers({
    authorization: `bearer ${options.jwt}`,
    "apns-topic": call ? voipTopic(options.topic) : options.topic,
    "apns-push-type": call ? "voip" : "alert",
    // 10: deliver now (alerts, calls). 5: may be delayed to save power.
    "apns-priority": push.urgency === "low" ? "5" : "10",
    "apns-expiration": String(push.expiration),
    "content-type": "application/json",
  });
  if (push.collapseId !== undefined) {
    if (new TextEncoder().encode(push.collapseId).length > COLLAPSE_ID_MAX_BYTES) {
      throw new Error("collapse id over 64 bytes");
    }
    headers.set("apns-collapse-id", push.collapseId);
  }
  const host = APNS_HOSTS[options.environment];
  return new Request(`https://${host}/3/device/${push.deviceToken.toLowerCase()}`, {
    method: "POST",
    headers,
    body: JSON.stringify(apnsPayload(push)),
  });
}

/** The sound of a Critical Alert: the default sound at full volume, played even on silent (`critical: 1`). */
export const CRITICAL_SOUND = { critical: 1, name: "default", volume: 1 } as const;

/**
 * The JSON body. An alert: a localized fallback alert, `mutable-content` so the extension runs, and the envelope.
 * A call: the call id and the envelope, no `aps` (PushKit hands the whole payload to the app, which reports the
 * call to CallKit at once and decrypts afterwards).
 */
export function apnsPayload(
  push: Pick<ApnsPush, "envelope" | "urgency" | "kind" | "callId" | "critical">,
): Record<string, unknown> {
  if (push.kind === "call") return { call: { id: push.callId }, brigade: push.envelope };
  const page = push.urgency === "page";
  const critical = page && push.critical === true;
  const aps: Record<string, unknown> = {
    alert: FALLBACK_ALERT,
    "mutable-content": 1,
    sound: critical ? CRITICAL_SOUND : "default",
    // Pages break through Focus (RFC 0006, "Paging semantics"); needs the time-sensitive entitlement. A Critical
    // Alert also rings on silent; it needs the critical-alerts entitlement and the member's permission.
    "interruption-level": critical ? "critical" : page ? "time-sensitive" : "active",
  };
  return { aps, brigade: push.envelope };
}

/**
 * Signs a provider token. APNs rejects tokens older than an hour and throttles ones refreshed more often than
 * every 20 minutes (`TooManyProviderTokenUpdates`), so callers reuse one through `ApnsTokenCache`.
 */
export async function signApnsJwt(credentials: ApnsCredentials, issuedAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(credentials.key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const header = toBase64url(
    encoder.encode(JSON.stringify({ alg: "ES256", kid: credentials.keyId })),
  );
  const claims = toBase64url(
    encoder.encode(JSON.stringify({ iss: credentials.teamId, iat: Math.floor(issuedAt / 1000) })),
  );
  const signingInput = `${header}.${claims}`;
  // WebCrypto's ECDSA signature is r || s, which is already JWS's ES256 form (not DER).
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${toBase64url(new Uint8Array(signature))}`;
}

/** Reuses a token for 40 minutes: inside APNs' hour, and well past its 20-minute refresh floor. */
export const APNS_TOKEN_TTL_MS = 40 * 60 * 1000;

export class ApnsTokenCache {
  #token: { value: Promise<string>; credentials: ApnsCredentials; issuedAt: number } | undefined;

  async get(credentials: ApnsCredentials, now: number): Promise<string> {
    const cached = this.#token;
    // Any change to the key, its id or the team (a rotated secret) signs a new token.
    const same =
      cached !== undefined &&
      cached.credentials.key === credentials.key &&
      cached.credentials.keyId === credentials.keyId &&
      cached.credentials.teamId === credentials.teamId;
    if (same && now - cached.issuedAt < APNS_TOKEN_TTL_MS) {
      return cached.value;
    }
    const value = signApnsJwt(credentials, now);
    this.#token = { value, credentials: { ...credentials }, issuedAt: now };
    // A failed signature must not stay cached.
    value.catch(() => {
      if (this.#token?.value === value) this.#token = undefined;
    });
    return value;
  }

  /** After APNs answers `ExpiredProviderToken` or `InvalidProviderToken`. */
  clear(): void {
    this.#token = undefined;
  }
}

/** A PKCS #8 PEM's DER bytes (the APNs `.p8` key, a Google service account's key). */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
