import { toBase64url, type PushEnvelope } from "@freecorps/brigade-push";
import { pemToDer, type PushKind, type Urgency } from "./apns.ts";

/**
 * Firebase Cloud Messaging over its HTTP v1 API, for Android (RFC 0006). The relay authenticates as a Google service
 * account: an RS256 JWT it signs with the account's key is exchanged for an OAuth2 access token (the JWT bearer flow),
 * which is cached until shortly before it expires. Every message is a data message: the app's
 * FirebaseMessagingService decrypts it and shows the page (or rings, for a call) itself, so FCM never shows anything
 * the device did not decrypt, and never content.
 */

/** The fields of a service account's JSON key file the relay uses. */
export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKeyId: string;
  /** PKCS #8 PEM, RSA. */
  privateKey: string;
  tokenUri: string;
}

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
/** The narrowest scope that sends FCM messages. */
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Reads `FCM_SERVICE_ACCOUNT` (the key file's JSON text). Throws on anything else, never echoing the key. */
export function parseServiceAccount(text: string | undefined): ServiceAccount {
  if (!text) throw new Error("FCM_SERVICE_ACCOUNT is not set");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("FCM_SERVICE_ACCOUNT is not JSON");
  }
  if (typeof value !== "object" || value === null)
    throw new Error("FCM_SERVICE_ACCOUNT is not an object");
  const account = value as Record<string, unknown>;
  const field = (name: string): string => {
    const found = account[name];
    if (typeof found !== "string" || found === "") {
      throw new Error(`FCM_SERVICE_ACCOUNT has no ${name}`);
    }
    return found;
  };
  const tokenUri = typeof account.token_uri === "string" ? account.token_uri : DEFAULT_TOKEN_URI;
  if (!tokenUri.startsWith("https://"))
    throw new Error("FCM_SERVICE_ACCOUNT token_uri is not https");
  const projectId = field("project_id");
  // It goes into the send URL's path.
  if (!/^[a-z0-9-]{1,64}$/.test(projectId))
    throw new Error("FCM_SERVICE_ACCOUNT project_id is malformed");
  return {
    projectId,
    clientEmail: field("client_email"),
    privateKeyId: field("private_key_id"),
    privateKey: field("private_key"),
    tokenUri,
  };
}

/** The signed assertion the token endpoint exchanges for an access token, valid for an hour (Google's maximum). */
export async function signGoogleAssertion(
  account: ServiceAccount,
  issuedAt: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const encoder = new TextEncoder();
  const iat = Math.floor(issuedAt / 1000);
  const header = toBase64url(
    encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid: account.privateKeyId })),
  );
  const claims = toBase64url(
    encoder.encode(
      JSON.stringify({
        iss: account.clientEmail,
        scope: FCM_SCOPE,
        aud: account.tokenUri,
        iat,
        exp: iat + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${toBase64url(new Uint8Array(signature))}`;
}

/**
 * Why getting an access token failed: `unreachable` (the token endpoint did not answer, or failed: try again) or
 * `refused` (it refused the assertion, or the key does not sign: the relay's configuration).
 */
export class GoogleAuthError extends Error {
  constructor(
    readonly kind: "unreachable" | "refused",
    message: string,
  ) {
    super(message);
  }
}

/** A token is reused until this long before Google says it expires. */
export const ACCESS_TOKEN_MARGIN_MS = 5 * 60 * 1000;

/**
 * One access token per isolate and service account, fetched once at a time and reused until
 * `ACCESS_TOKEN_MARGIN_MS` before it expires. The token is never logged.
 */
export class GoogleTokenCache {
  #token: { value: Promise<{ token: string; expiresAt: number }>; account: string } | undefined;

  async get(
    account: ServiceAccount,
    now: number,
    send: (request: Request) => Promise<Response>,
  ): Promise<string> {
    // A rotated key (another key id) or another account gets a token of its own.
    const id = `${account.clientEmail}\n${account.privateKeyId}`;
    const cached = this.#token;
    if (cached !== undefined && cached.account === id) {
      const token = await cached.value.catch(() => undefined);
      if (token && now < token.expiresAt - ACCESS_TOKEN_MARGIN_MS) return token.token;
      if (this.#token === cached) this.#token = undefined;
    }
    if (this.#token === undefined || this.#token.account !== id) {
      const value = fetchAccessToken(account, now, send);
      this.#token = { value, account: id };
      // A failed exchange must not stay cached.
      value.catch(() => {
        if (this.#token?.value === value) this.#token = undefined;
      });
    }
    return (await this.#token.value).token;
  }

  /** After FCM answers 401: the token was revoked or the key rotated. */
  clear(): void {
    this.#token = undefined;
  }
}

async function fetchAccessToken(
  account: ServiceAccount,
  now: number,
  send: (request: Request) => Promise<Response>,
): Promise<{ token: string; expiresAt: number }> {
  let assertion: string;
  try {
    assertion = await signGoogleAssertion(account, now);
  } catch (error) {
    throw new GoogleAuthError("refused", `signing failed: ${String(error)}`);
  }
  let response: Response;
  try {
    response = await send(
      new Request(account.tokenUri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }).toString(),
      }),
    );
  } catch (error) {
    throw new GoogleAuthError("unreachable", String(error));
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    // `error` is Google's code (`invalid_grant`, …); never the assertion.
    const kind = response.status >= 500 || response.status === 429 ? "unreachable" : "refused";
    throw new GoogleAuthError(kind, `token endpoint ${response.status} ${String(body.error)}`);
  }
  if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
    throw new GoogleAuthError("unreachable", "token endpoint answered without a token");
  }
  return { token: body.access_token, expiresAt: now + body.expires_in * 1000 };
}

export interface FcmPush {
  /** The registration token from `getDevicePushTokenAsync()` on Android. */
  token: string;
  kind: PushKind;
  /** For a call: the call id the app rings under (repeats of one page share it). */
  callId?: string;
  envelope: PushEnvelope;
  urgency: Urgency;
  /** The notification's tag on the phone, so a repeat replaces it (the APNs collapse id's role). */
  collapseId?: string;
  /** How long FCM keeps trying an offline phone; 0 means now or never. */
  ttlSeconds: number;
}

/** FCM's limit on a data message's payload. */
export const FCM_DATA_MAX_BYTES = 4096;
/** Registration tokens are about 160 characters of base64url and `:`; Google says not to rely on the form. */
const FCM_TOKEN = /^[A-Za-z0-9_:-]{16,512}$/;
const COLLAPSE_ID_MAX_BYTES = 64;

/**
 * The `data` of an FCM message (string values only): the envelope, what it is (`kind`, `urgency`) and, for a call,
 * its id; the tag a repeat replaces. Nothing else: the relay never sees content.
 */
export function fcmData(push: Omit<FcmPush, "token" | "ttlSeconds">): Record<string, string> {
  return {
    v: String(push.envelope.v),
    enc: push.envelope.enc,
    ct: push.envelope.ct,
    kind: push.kind,
    urgency: push.urgency,
    ...(push.callId === undefined ? {} : { callId: push.callId }),
    ...(push.collapseId === undefined ? {} : { tag: push.collapseId }),
  };
}

/** Throws on a malformed token or collapse id, a call that is not a page, or a payload over 4 KB. */
export function checkFcmPush(push: FcmPush): void {
  if (!FCM_TOKEN.test(push.token)) throw new Error("invalid registration token");
  if (push.kind === "call" && (push.callId === undefined || push.urgency !== "page")) {
    throw new Error("only a page rings, under a call id");
  }
  if (
    push.collapseId !== undefined &&
    new TextEncoder().encode(push.collapseId).length > COLLAPSE_ID_MAX_BYTES
  ) {
    throw new Error("collapse id over 64 bytes");
  }
  const data = fcmData(push);
  if (new TextEncoder().encode(JSON.stringify(data)).length > FCM_DATA_MAX_BYTES) {
    throw new Error("data message over 4 KB");
  }
}

/** The FCM HTTP v1 send request; throws like `checkFcmPush`. */
export function buildFcmRequest(
  push: FcmPush,
  options: { projectId: string; accessToken: string },
): Request {
  checkFcmPush(push);
  const data = fcmData(push);
  return new Request(`https://fcm.googleapis.com/v1/projects/${options.projectId}/messages:send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: push.token,
        data,
        android: {
          // HIGH wakes the phone at once, out of Doze, which is what a page needs. FCM lowers the priority of an
          // app whose high-priority messages show nothing; the app shows every one (the fallback text when it
          // cannot decrypt), so that never happens here.
          priority: push.urgency === "low" ? "NORMAL" : "HIGH",
          ttl: `${push.ttlSeconds}s`,
        },
      },
    }),
  });
}

/**
 * What an FCM error says: its `errorCode` (FcmError details) or else its `status`, and whether the token itself is
 * done (`UNREGISTERED`, a token FCM calls invalid, or one from another Firebase project): the instance drops the device,
 * as for APNs' `BadDeviceToken`.
 */
export function parseFcmError(text: string): { reason: string; tokenInvalid: boolean } {
  let error: Record<string, unknown> = {};
  try {
    const value = JSON.parse(text) as { error?: unknown };
    if (typeof value.error === "object" && value.error !== null) {
      error = value.error as Record<string, unknown>;
    }
  } catch {}
  const details = Array.isArray(error.details) ? (error.details as Record<string, unknown>[]) : [];
  const code = details.find((detail) => typeof detail?.errorCode === "string")?.errorCode;
  const reason =
    typeof code === "string" ? code : typeof error.status === "string" ? error.status : "unknown";
  const aboutToken =
    details.some(
      (detail) =>
        Array.isArray(detail?.fieldViolations) &&
        (detail.fieldViolations as { field?: unknown }[]).some(
          (violation) => violation?.field === "message.token",
        ),
    ) ||
    (typeof error.message === "string" && /registration token/i.test(error.message));
  const tokenInvalid =
    reason === "UNREGISTERED" ||
    reason === "SENDER_ID_MISMATCH" ||
    (reason === "INVALID_ARGUMENT" && aboutToken);
  return { reason, tokenInvalid };
}
