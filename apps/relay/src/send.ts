// Delivery to APNs and FCM, shared by `/send` (a raw device token, `RELAY_SEND_TOKEN`) and `/v1/send` (a handle,
// signed by the instance, src/v1.ts): both validate the same push fields with `parsePush` and answer with `deliver`,
// so the two routes cannot drift.

import { parsePushEnvelope, type PushEnvelope } from "@freecorps/brigade-push";
import {
  ApnsTokenCache,
  buildApnsRequest,
  CALL_ID,
  type ApnsCredentials,
  type ApnsEnvironment,
  type PushKind,
  type Urgency,
} from "./apns.ts";
import { deepHealth, type DeepHealth } from "./deep-health.ts";
import {
  buildFcmRequest,
  checkFcmPush,
  GoogleAuthError,
  GoogleTokenCache,
  parseFcmError,
  parseServiceAccount,
  type ServiceAccount,
} from "./fcm.ts";
import { sendWithin, within } from "./deadline.ts";

/** What delivery reads of the environment. */
export type ProviderEnv = {
  APNS_ENVIRONMENT: string;
  APNS_TOPIC: string;
  APNS_KEY: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  /**
   * The Google service account's JSON key, for FCM (Android). Optional: a relay without it serves iOS only and
   * answers an Android send `500 relay_misconfigured`.
   */
  FCM_SERVICE_ACCOUNT?: string;
};

export type Send = (request: Request) => Promise<Response>;

export type Platform = "ios" | "android";
export const PLATFORMS: readonly Platform[] = ["ios", "android"];
export const ENVIRONMENTS: readonly ApnsEnvironment[] = ["sandbox", "production"];

const URGENCIES: readonly Urgency[] = ["low", "high", "page"];
const KINDS: readonly PushKind[] = ["alert", "call"];
/**
 * How long APNs keeps trying a phone that is offline, by urgency, unless the sender sets `ttlSeconds`. A page
 * that only tries once is lost to a phone in a lift; one that arrives an hour late is noise.
 */
const DEFAULT_TTL_SECONDS: Record<Urgency, number> = {
  page: 15 * 60,
  high: 60 * 60,
  low: 4 * 60 * 60,
};
/**
 * A call rings now or not at all: a phone that comes online minutes later should get the stored alert push (step
 * 1 of the ladder, RFC 0010), not a call for a page that may be acknowledged already.
 */
const CALL_TTL_SECONDS = 60;
const MAX_CALL_TTL_SECONDS = 5 * 60;
/** APNs keeps an undelivered push for at most about 30 days. */
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
/**
 * How long APNs or FCM gets to answer one send: under the API's own 10 s for the whole call (apps/api
 * `RELAY_TIMEOUT_MS`), token exchange included, so a provider that hangs is a 502 the API can retry, not a call it
 * abandons.
 */
const PROVIDER_TIMEOUT_MS = 5000;
/**
 * The whole of one APNs send, its answer's body included: headers get `PROVIDER_TIMEOUT_MS`, the body what is left,
 * so a provider that answers and then stalls is still a 502 inside the API's 10 s.
 */
const APNS_CALL_BUDGET_MS = 9000;
/**
 * The whole of one FCM send, the retry after a 401 included (another token exchange and send): each step gets what is
 * left of it, so the call stays under the API's 10 s.
 */
const FCM_CALL_BUDGET_MS = 9000;
/** The least of that budget worth a retry after a 401; with less, the instance retries instead. */
const FCM_RETRY_MIN_MS = 1000;

// One per isolate: the provider token is the same for every request (APNs throttles frequent refreshes).
const tokens = new ApnsTokenCache();
// Likewise Google's access token for FCM, reused until shortly before it expires.
const googleTokens = new GoogleTokenCache();

/** A push as both routes take it, validated; where it goes (`Target`) comes from the route. */
export type Push = {
  kind: PushKind;
  urgency: Urgency;
  callId?: string;
  critical: boolean;
  /** Already defaulted by urgency and kind. */
  ttlSeconds: number;
  collapseId?: string;
  envelope: PushEnvelope;
};

/** The device: its platform, the token the push goes to, and for iOS the token's APNs environment when known. */
export type Target = { platform: Platform; token: string; environment?: ApnsEnvironment };

/**
 * The push fields of a send body (`kind`, `urgency`, `callId`, `critical`, `ttlSeconds`, `collapseId`, `envelope`),
 * or null when any is invalid for this platform. Only a page rings, and a Critical Alert is an iOS page's alert.
 */
export function parsePush(body: Record<string, unknown>, platform: Platform): Push | null {
  const envelope = parsePushEnvelope(body.envelope);
  const kind = body.kind ?? "alert";
  const call = kind === "call";
  // Only a page rings: a call for anything less would be the misuse Apple terminates apps for.
  const urgency = body.urgency ?? (call ? "page" : "high");
  if (
    envelope === null ||
    !KINDS.includes(kind as PushKind) ||
    !URGENCIES.includes(urgency as Urgency) ||
    (call &&
      (urgency !== "page" ||
        typeof body.callId !== "string" ||
        !CALL_ID.test(body.callId) ||
        (body.ttlSeconds !== undefined &&
          (typeof body.ttlSeconds !== "number" || body.ttlSeconds > MAX_CALL_TTL_SECONDS)))) ||
    (!call && body.callId !== undefined) ||
    // A Critical Alert is a page's alert push, never a call or anything less urgent.
    (body.critical !== undefined &&
      (typeof body.critical !== "boolean" ||
        (body.critical && (call || urgency !== "page" || platform !== "ios")))) ||
    (body.collapseId !== undefined && typeof body.collapseId !== "string") ||
    (body.ttlSeconds !== undefined &&
      (typeof body.ttlSeconds !== "number" ||
        !Number.isInteger(body.ttlSeconds) ||
        body.ttlSeconds < 0 ||
        body.ttlSeconds > MAX_TTL_SECONDS ||
        // A page is never "try once": a phone in a lift would miss it.
        (body.ttlSeconds === 0 && urgency === "page")))
  ) {
    return null;
  }
  return {
    kind: kind as PushKind,
    urgency: urgency as Urgency,
    ...(call ? { callId: body.callId as string } : {}),
    critical: body.critical === true,
    ttlSeconds:
      (body.ttlSeconds as number | undefined) ??
      (call ? CALL_TTL_SECONDS : DEFAULT_TTL_SECONDS[urgency as Urgency]),
    ...(body.collapseId === undefined ? {} : { collapseId: body.collapseId as string }),
    envelope,
  };
}

/**
 * Sends one push and answers as `/send` always has: `200 { status, apnsId, apnsUniqueId, reason, ms }` (APNs) or
 * `200 { status, fcmId, ms }` (FCM) when the provider took it, `502` with the provider's status and reason when it did
 * not, `502 apns_unreachable`/`fcm_unreachable`, `500 relay_misconfigured`, `400 invalid_body` for a token or collapse
 * id the provider's request cannot carry. `log` is added to the provider log line (never a token).
 */
export async function deliver(
  target: Target,
  push: Push,
  env: ProviderEnv,
  send: Send,
  log: Record<string, string> = {},
): Promise<Response> {
  if (target.platform === "android") {
    return sendFcm(
      {
        token: target.token,
        kind: push.kind,
        ...(push.callId === undefined ? {} : { callId: push.callId }),
        envelope: push.envelope,
        urgency: push.urgency,
        ...(push.collapseId === undefined ? {} : { collapseId: push.collapseId }),
        ttlSeconds: push.ttlSeconds,
      },
      env,
      send,
      log,
    );
  }

  // The device's own APNs environment when the sender knows it (the instance records it at registration: Xcode
  // builds get sandbox tokens, EAS builds production ones), else the relay's default. One provider token signs for
  // both.
  const environment: ApnsEnvironment =
    target.environment ?? (env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox");
  // Signing fails only on a broken APNS_KEY: the relay's fault, not the caller's.
  let jwt: string;
  try {
    jwt = await tokens.get(credentials(env), Date.now());
  } catch (error) {
    console.error(JSON.stringify({ message: "APNs token signing failed", error: String(error) }));
    return json({ error: "relay_misconfigured" }, 500);
  }
  let apnsRequest: Request;
  try {
    apnsRequest = buildApnsRequest(
      {
        deviceToken: target.token,
        envelope: push.envelope,
        urgency: push.urgency,
        kind: push.kind,
        ...(push.callId === undefined ? {} : { callId: push.callId }),
        ...(push.critical ? { critical: true } : {}),
        // 0 keeps APNs' "try once"; otherwise an absolute time.
        expiration: push.ttlSeconds === 0 ? 0 : Math.floor(Date.now() / 1000) + push.ttlSeconds,
        ...(push.collapseId === undefined ? {} : { collapseId: push.collapseId }),
      },
      { environment, topic: env.APNS_TOPIC, jwt },
    );
  } catch (error) {
    return json({ error: "invalid_body", detail: String(error) }, 400);
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await sendWithin(send, apnsRequest, PROVIDER_TIMEOUT_MS);
  } catch (error) {
    // Never logs the device token or the envelope.
    console.error(JSON.stringify({ message: "APNs fetch failed", ...log, error: String(error) }));
    return json({ error: "apns_unreachable", detail: String(error) }, 502);
  }
  // APNs answers 200 with an empty body, or an error status with `{ "reason": "..." }`.
  let text: string;
  try {
    text = await readWithin(
      response,
      APNS_CALL_BUDGET_MS - (Date.now() - started),
      "APNs body not read in time",
    );
  } catch (error) {
    console.error(
      JSON.stringify({ message: "APNs body read failed", ...log, error: String(error) }),
    );
    return json({ error: "apns_unreachable", detail: String(error) }, 502);
  }
  const reason = response.ok ? undefined : parseReason(text);
  if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") tokens.clear();
  const result = {
    status: response.status,
    apnsId: response.headers.get("apns-id"),
    // Sandbox only: the id to look the push up in Apple's Push Notifications Console.
    apnsUniqueId: response.headers.get("apns-unique-id"),
    reason,
    ms: Date.now() - started,
  };
  console.log(
    JSON.stringify({ message: "APNs response", ...log, environment, kind: push.kind, ...result }),
  );
  return json(result, response.ok ? 200 : 502);
}

/** A provider's answer body, or a rejection once `ms` passed; the body is cancelled then, so the stream is let go. */
async function readWithin(response: Response, ms: number, late: string): Promise<string> {
  try {
    return await within(response.text(), Math.max(0, ms), () => new Error(late));
  } catch (error) {
    response.body?.cancel().catch(() => {});
    throw error;
  }
}

/** `GET /health?deep=1` and the signed `GET /v1/health?deep=1`: whether each provider would take a page now. */
export function providerHealth(env: ProviderEnv, send: Send): Promise<DeepHealth> {
  return deepHealth(
    {
      credentials: credentials(env),
      environment: env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox",
      topic: env.APNS_TOPIC,
      tokens,
      fcmServiceAccount: env.FCM_SERVICE_ACCOUNT,
    },
    send,
  );
}

function credentials(env: ProviderEnv): ApnsCredentials {
  return { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID };
}

/**
 * Sends to FCM (Android). Answers like the APNs path: `200 { status, fcmId, ms }` when FCM took it, `502` with
 * FCM's `status` and `reason` (its error code) when it did not, plus `tokenInvalid` when the token is done, and
 * `502 fcm_unreachable` when FCM or Google's token endpoint cannot be reached. An access token FCM refuses (401) is
 * fetched again and the send tried once more.
 */
async function sendFcm(
  push: Parameters<typeof buildFcmRequest>[0],
  env: ProviderEnv,
  send: Send,
  log: Record<string, string>,
): Promise<Response> {
  let account: ServiceAccount;
  try {
    account = parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
  } catch (error) {
    console.error(JSON.stringify({ message: "FCM is not configured", error: String(error) }));
    return json({ error: "relay_misconfigured" }, 500);
  }
  try {
    checkFcmPush(push);
  } catch (error) {
    return json({ error: "invalid_body", detail: String(error) }, 400);
  }
  const started = Date.now();
  const left = () => Math.max(0, FCM_CALL_BUDGET_MS - (Date.now() - started));
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let accessToken: string;
    try {
      accessToken = await within(
        googleTokens.get(account, Date.now(), send),
        left(),
        () => new GoogleAuthError("unreachable", "token exchange: out of time"),
      );
    } catch (error) {
      const unreachable = error instanceof GoogleAuthError && error.kind === "unreachable";
      // Never the assertion or a token.
      console.error(
        JSON.stringify({ message: "Google access token failed", error: String(error) }),
      );
      return unreachable
        ? json({ error: "fcm_unreachable", detail: "token endpoint" }, 502)
        : json({ error: "relay_misconfigured" }, 500);
    }
    let request: Request;
    try {
      request = buildFcmRequest(push, { projectId: account.projectId, accessToken });
    } catch (error) {
      return json({ error: "invalid_body", detail: String(error) }, 400);
    }
    try {
      response = await sendWithin(send, request, Math.min(PROVIDER_TIMEOUT_MS, left()));
    } catch (error) {
      // Never logs the registration token or the envelope.
      console.error(JSON.stringify({ message: "FCM fetch failed", ...log, error: String(error) }));
      return json({ error: "fcm_unreachable", detail: String(error) }, 502);
    }
    if (response.status !== 401) break;
    await googleTokens.clear(accessToken);
    if (attempt === 1) break;
    await response.body?.cancel();
    // Too little time left for another exchange and send. Not the 401 itself, which the instance takes as a refusal
    // for good: the token was dropped above, so the instance's retry gets a fresh one.
    if (left() < FCM_RETRY_MIN_MS) {
      return json(
        { error: "fcm_unreachable", detail: "access token refused, no time left to retry" },
        502,
      );
    }
  }
  const answer = response!;
  let text: string;
  try {
    text = await readWithin(answer, left(), "FCM body not read in time");
  } catch (error) {
    console.error(
      JSON.stringify({ message: "FCM body read failed", ...log, error: String(error) }),
    );
    return json({ error: "fcm_unreachable", detail: String(error) }, 502);
  }
  let result: Record<string, unknown>;
  if (answer.ok) {
    let name: unknown;
    try {
      name = (JSON.parse(text) as { name?: unknown }).name;
    } catch {}
    // `projects/<project>/messages/<id>`: only the id, so the project stays out of the instance's logs.
    result = {
      status: answer.status,
      fcmId: typeof name === "string" ? (name.split("/").pop() ?? null) : null,
    };
  } else {
    const { reason, tokenInvalid } = parseFcmError(text);
    if (reason === "SENDER_ID_MISMATCH") {
      // Every Android page fails until it is fixed, so say it loudly; the devices are kept.
      console.error(
        JSON.stringify({
          message:
            "FCM refused the sender: FCM_SERVICE_ACCOUNT is not the Firebase project the app was built with",
        }),
      );
    }
    result = { status: answer.status, reason, ...(tokenInvalid ? { tokenInvalid: true } : {}) };
  }
  result.ms = Date.now() - started;
  console.log(JSON.stringify({ message: "FCM response", ...log, kind: push.kind, ...result }));
  return json(result, answer.ok ? 200 : 502);
}

function parseReason(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && typeof value.reason === "string") return value.reason;
  } catch {}
  return "unknown";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
