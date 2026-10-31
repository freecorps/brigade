import { parsePushEnvelope } from "@freecorps/brigade-push";
import {
  ApnsTokenCache,
  buildApnsRequest,
  CALL_ID,
  type ApnsCredentials,
  type ApnsEnvironment,
  type PushKind,
  type Urgency,
} from "./apns.ts";
import {
  buildFcmRequest,
  checkFcmPush,
  GoogleAuthError,
  GoogleTokenCache,
  parseFcmError,
  parseServiceAccount,
  type ServiceAccount,
} from "./fcm.ts";
import { deepHealth } from "./deep-health.ts";
import { sendWithin } from "./deadline.ts";

/**
 * Spike S1 relay (RFC 0006): `POST /send` takes a device token and an already encrypted envelope and forwards
 * it to APNs, or to FCM for an Android device (`platform: "android"`). Instance registration, handles and rate limits come later; until then the only caller is whoever
 * holds `RELAY_SEND_TOKEN`.
 */

/** The bindings `handle` reads, from the generated `Env`, so tests can pass plain values. */
export type RelayEnv = Pick<
  Env,
  | "APNS_ENVIRONMENT"
  | "APNS_TOPIC"
  | "APNS_KEY"
  | "APNS_KEY_ID"
  | "APNS_TEAM_ID"
  | "RELAY_SEND_TOKEN"
> & {
  /**
   * The Google service account's JSON key, for FCM (Android). Optional: a relay without it serves iOS only and
   * answers an Android send `500 relay_misconfigured`.
   */
  FCM_SERVICE_ACCOUNT?: string;
};

export type Platform = "ios" | "android";
const PLATFORMS: readonly Platform[] = ["ios", "android"];

const URGENCIES: readonly Urgency[] = ["low", "high", "page"];
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
const KINDS: readonly PushKind[] = ["alert", "call"];
const ENVIRONMENTS: readonly ApnsEnvironment[] = ["sandbox", "production"];
/** APNs keeps an undelivered push for at most about 30 days. */
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
/** A request body far above any valid send: a device token and a sealed 2 KB plaintext. */
const MAX_BODY_BYTES = 8 * 1024;
/**
 * How long APNs or FCM gets to answer one send: under the API's own 10 s for the whole call (apps/api
 * `RELAY_TIMEOUT_MS`), token exchange included, so a provider that hangs is a 502 the API can retry, not a call it
 * abandons.
 */
const PROVIDER_TIMEOUT_MS = 5000;

// One per isolate: the provider token is the same for every request (APNs throttles frequent refreshes).
const tokens = new ApnsTokenCache();
// Likewise Google's access token for FCM, reused until shortly before it expires.
const googleTokens = new GoogleTokenCache();

export default {
  fetch: (request, env) => handle(request, env, fetch),
} satisfies ExportedHandler<Env>;

export async function handle(
  request: Request,
  env: RelayEnv,
  send: (request: Request) => Promise<Response>,
): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname === "/health" && searchParams.get("deep") === "1") {
    // Says which provider fails, so only the send token's holder (the instance's watchdog) may ask.
    if (!(await authorized(request, env.RELAY_SEND_TOKEN))) {
      return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }
    const health = await deepHealth(
      {
        credentials: { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID },
        environment: env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox",
        topic: env.APNS_TOPIC,
        tokens,
        fcmServiceAccount: env.FCM_SERVICE_ACCOUNT,
      },
      send,
    );
    if (!health.ok) console.error(JSON.stringify({ message: "deep health failed", ...health }));
    return json(health, health.ok ? 200 : 503);
  }
  if (pathname === "/health") return json({ ok: true });
  if (pathname !== "/send") return json({ error: "not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!(await authorized(request, env.RELAY_SEND_TOKEN))) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const body = await readJson(request);
  if (!isRecord(body)) return json({ error: "invalid_body" }, 400);
  const envelope = parsePushEnvelope(body.envelope);
  const kind = body.kind ?? "alert";
  const call = kind === "call";
  // Only a page rings: a call for anything less would be the misuse Apple terminates apps for.
  const urgency = body.urgency ?? (call ? "page" : "high");
  const platform = body.platform ?? "ios";
  if (
    typeof body.deviceToken !== "string" ||
    !PLATFORMS.includes(platform as Platform) ||
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
    (body.environment !== undefined &&
      !ENVIRONMENTS.includes(body.environment as ApnsEnvironment)) ||
    (body.collapseId !== undefined && typeof body.collapseId !== "string") ||
    (body.ttlSeconds !== undefined &&
      (typeof body.ttlSeconds !== "number" ||
        !Number.isInteger(body.ttlSeconds) ||
        body.ttlSeconds < 0 ||
        body.ttlSeconds > MAX_TTL_SECONDS ||
        // A page is never "try once": a phone in a lift would miss it.
        (body.ttlSeconds === 0 && urgency === "page")))
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  const ttl =
    (body.ttlSeconds as number | undefined) ??
    (call ? CALL_TTL_SECONDS : DEFAULT_TTL_SECONDS[urgency as Urgency]);
  if (platform === "android") {
    return sendFcm(
      {
        token: body.deviceToken,
        kind: kind as PushKind,
        ...(call ? { callId: body.callId as string } : {}),
        envelope,
        urgency: urgency as Urgency,
        ...(body.collapseId === undefined ? {} : { collapseId: body.collapseId as string }),
        ttlSeconds: ttl,
      },
      env,
      send,
    );
  }

  // The device's own APNs environment when the sender knows it (the instance records it at registration: Xcode
  // builds get sandbox tokens, EAS builds production ones), else the relay's default. One provider token signs for
  // both.
  const environment: ApnsEnvironment =
    (body.environment as ApnsEnvironment | undefined) ??
    (env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox");
  const credentials: ApnsCredentials = {
    key: env.APNS_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
  };
  // Signing fails only on a broken APNS_KEY: the relay's fault, not the caller's.
  let jwt: string;
  try {
    jwt = await tokens.get(credentials, Date.now());
  } catch (error) {
    console.error(JSON.stringify({ message: "APNs token signing failed", error: String(error) }));
    return json({ error: "relay_misconfigured" }, 500);
  }
  let apnsRequest: Request;
  try {
    apnsRequest = buildApnsRequest(
      {
        deviceToken: body.deviceToken,
        envelope,
        urgency: urgency as Urgency,
        kind: kind as PushKind,
        ...(call ? { callId: body.callId as string } : {}),
        ...(body.critical === true ? { critical: true } : {}),
        // 0 keeps APNs' "try once"; otherwise an absolute time.
        expiration: ttl === 0 ? 0 : Math.floor(Date.now() / 1000) + ttl,
        ...(body.collapseId === undefined ? {} : { collapseId: body.collapseId as string }),
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
    console.error(JSON.stringify({ message: "APNs fetch failed", error: String(error) }));
    return json({ error: "apns_unreachable", detail: String(error) }, 502);
  }
  // APNs answers 200 with an empty body, or an error status with `{ "reason": "..." }`.
  const text = await response.text();
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
  console.log(JSON.stringify({ message: "APNs response", environment, kind, ...result }));
  return json(result, response.ok ? 200 : 502);
}

/**
 * Sends to FCM (Android). Answers like the APNs path: `200 { status, fcmId, ms }` when FCM took it, `502` with
 * FCM's `status` and `reason` (its error code) when it did not, plus `tokenInvalid` when the token is done, and
 * `502 fcm_unreachable` when FCM or Google's token endpoint cannot be reached. An access token FCM refuses (401) is
 * fetched again and the send tried once more.
 */
async function sendFcm(
  push: Parameters<typeof buildFcmRequest>[0],
  env: RelayEnv,
  send: (request: Request) => Promise<Response>,
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
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let accessToken: string;
    try {
      accessToken = await googleTokens.get(account, Date.now(), send);
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
      response = await sendWithin(send, request, PROVIDER_TIMEOUT_MS);
    } catch (error) {
      // Never logs the registration token or the envelope.
      console.error(JSON.stringify({ message: "FCM fetch failed", error: String(error) }));
      return json({ error: "fcm_unreachable", detail: String(error) }, 502);
    }
    if (response.status !== 401) break;
    await googleTokens.clear(accessToken);
    if (attempt === 0) await response.body?.cancel();
  }
  const answer = response!;
  const text = await answer.text();
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
  console.log(JSON.stringify({ message: "FCM response", kind: push.kind, ...result }));
  return json(result, answer.ok ? 200 : 502);
}

/** Compares SHA-256 digests in constant time, so the check leaks neither the token nor its length. */
async function authorized(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get("Authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice("Bearer ".length))),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Reads at most `MAX_BODY_BYTES`, whether or not the request declares its length. */
async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_BODY_BYTES) return null;
  if (request.body === null) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    // The client's stream broke mid-body: a bad request, not a relay error.
    return null;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function parseReason(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isRecord(value) && typeof value.reason === "string") return value.reason;
  } catch {}
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}
