// Handles, `/v1/send` and the signed deep health (RFC 0015 sections 2 and 3).
//
// - `POST /v1/handles`, from the app (unsigned: the app is not the instance), seals a phone's tokens for one registered
//   instance (src/handles.ts). Rate limited per IP; fails closed when the registry cannot say the instance is
//   registered and not revoked.
// - `POST /v1/send`, signed by the instance, opens the handle and delivers like `/send` (src/send.ts). A handle sealed
//   for another instance is `403 handle_not_yours`. The revocation check fails open (a registry outage must not stop
//   every self-hosted page); a rotated key the registry cannot confirm is `503 registry_unavailable`. Limits per
//   instance (sends, calls) and per phone (the tag: instance and token, not the handle, which differs on every
//   sealing). A page is never exempt: every caller can say `page`.
// - `GET /v1/health?deep=1`, signed, answers the instance's registration state and then `/health?deep=1`'s answer.

import { verifyRequest, type VerifiedRequest } from "@freecorps/brigade-push/instance";
import { DEVICE_TOKEN, type ApnsEnvironment } from "./apns.ts";
import { readBody, readJson } from "./body.ts";
import { FCM_TOKEN } from "./fcm.ts";
import {
  checkHandleConfig,
  handleTag,
  HandleConfigError,
  openHandle,
  sealHandle,
  type Sealed,
} from "./handles.ts";
import { checkMintable, checkRegistered, checkSender, type RegistryNamespace } from "./registry.ts";
import {
  deliver,
  ENVIRONMENTS,
  isRecord,
  json,
  parsePush,
  PLATFORMS,
  providerHealth,
  type Platform,
  type ProviderEnv,
  type Send,
} from "./send.ts";

/** A Workers Rate Limiting binding, or a test's fake. */
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

export type V1Env = ProviderEnv & {
  /** The registry (src/registry.ts). Without it every `/v1/` route answers `503 not_configured`. */
  REGISTRY?: RegistryNamespace;
  /** The handle keyring (src/handles.ts). Without it handles and `/v1/send` answer `503 not_configured`. */
  RELAY_HANDLE_KEYS?: string;
  /** The tag's HMAC key (src/handles.ts). Without it likewise. */
  RELAY_TAG_KEY?: string;
  /** Handles minted per caller IP (wrangler.jsonc `ratelimits`). Optional, like every limiter here. */
  HANDLE_LIMIT?: Limiter;
  /** Sends per instance, keyed by instance id; a deep health check counts as one. */
  SEND_LIMIT?: Limiter;
  /** Calls per instance, keyed by instance id, on top of `SEND_LIMIT`. */
  CALL_LIMIT?: Limiter;
  /** Sends per phone from one instance, keyed by the tag. */
  PHONE_LIMIT?: Limiter;
};

export const V1_PATHS: ReadonlySet<string> = new Set(["/v1/handles", "/v1/send", "/v1/health"]);

/** Every limiter's window, in seconds (wrangler.jsonc `period`): what `Retry-After` says. */
const LIMIT_PERIOD_SECONDS = 60;
const INSTANCE_ID = /^ins_[A-Za-z0-9_-]{22}$/;

export async function v1Routes(
  request: Request,
  env: V1Env,
  send: Send,
  now: number,
): Promise<Response> {
  const registry = env.REGISTRY;
  if (!registry) return json({ error: "not_configured" }, 503);
  const url = new URL(request.url);
  const method = url.pathname === "/v1/health" ? "GET" : "POST";
  if (request.method !== method) {
    return json({ error: "method_not_allowed" }, 405, { Allow: method });
  }
  if (url.pathname === "/v1/handles") return mint(request, env, registry, now);
  if (url.pathname === "/v1/health" && url.searchParams.get("deep") !== "1") {
    return json({ ok: true });
  }

  // Signed routes: the signature first, so no one can spend another instance's limits.
  const bytes = await readBody(request);
  if (bytes === null) return json({ error: "invalid_body" }, 400);
  const verified = await verifyRequest({
    method: request.method,
    path: url.pathname + url.search,
    headers: request.headers,
    body: bytes,
    now,
  });
  if (!verified.ok) return json({ error: verified.error }, 401);
  if (url.pathname === "/v1/health") return health(verified, env, registry, send, now);
  return sendHandle(verified, bytes, env, registry, send, now);
}

/** `POST /v1/handles { instance, platform, environment?, pushToken, voipToken? }` → `{ handle, tag }`. */
async function mint(
  request: Request,
  env: V1Env,
  registry: RegistryNamespace,
  now: number,
): Promise<Response> {
  // Before anything else: anyone may ask, so only the caller's IP bounds how many registry reads one sender forces.
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await allowed(env.HANDLE_LIMIT, ip, "handles"))) return limited("ip");
  if (!env.RELAY_HANDLE_KEYS || !env.RELAY_TAG_KEY) return json({ error: "not_configured" }, 503);
  const body = await readJson(request);
  const sealed = isRecord(body) ? parseMint(body) : null;
  if (sealed === null) return json({ error: "invalid_body" }, 400);
  const admission = await checkMintable(registry, sealed.instance, now);
  if (!admission.ok) return json({ error: admission.error }, admission.status);
  try {
    const [handle, tag] = await Promise.all([
      sealHandle(sealed, env.RELAY_HANDLE_KEYS),
      handleTag(sealed.instance, sealed.pushToken, env.RELAY_TAG_KEY),
    ]);
    return json({ handle, tag });
  } catch (error) {
    return misconfigured(error);
  }
}

/**
 * The mint body, strictly: a well-formed instance id, `ios` or `android`, an APNs environment (required on iOS, where
 * the token is only good on one host; optional on Android), and tokens in the providers' formats. A VoIP token is
 * iOS only (an Android call rings through the FCM token). iOS tokens are lowercased, so a tag never depends on the
 * case the app wrote. Unknown fields are ignored, so a newer app still gets a handle from this relay.
 */
function parseMint(body: Record<string, unknown>): Sealed | null {
  const { instance, platform, environment, pushToken, voipToken } = body;
  if (typeof instance !== "string" || !INSTANCE_ID.test(instance)) return null;
  if (!PLATFORMS.includes(platform as Platform)) return null;
  if (environment !== undefined && !ENVIRONMENTS.includes(environment as ApnsEnvironment)) {
    return null;
  }
  if (typeof pushToken !== "string") return null;
  if (platform === "ios") {
    if (environment === undefined || !DEVICE_TOKEN.test(pushToken)) return null;
    if (
      voipToken !== undefined &&
      (typeof voipToken !== "string" || !DEVICE_TOKEN.test(voipToken))
    ) {
      return null;
    }
    return {
      v: 1,
      instance,
      platform,
      environment: environment as ApnsEnvironment,
      pushToken: pushToken.toLowerCase(),
      ...(voipToken === undefined ? {} : { voipToken: (voipToken as string).toLowerCase() }),
    };
  }
  if (!FCM_TOKEN.test(pushToken) || voipToken !== undefined) return null;
  return {
    v: 1,
    instance,
    platform: "android",
    ...(environment === undefined ? {} : { environment: environment as ApnsEnvironment }),
    pushToken,
  };
}

/** `POST /v1/send { handle, envelope, kind?, urgency?, callId?, critical?, ttlSeconds?, collapseId? }`. */
async function sendHandle(
  caller: VerifiedRequest,
  bytes: Uint8Array,
  env: V1Env,
  registry: RegistryNamespace,
  send: Send,
  now: number,
): Promise<Response> {
  if (!env.RELAY_HANDLE_KEYS || !env.RELAY_TAG_KEY) return json({ error: "not_configured" }, 503);
  const sender = await checkSender(registry, caller, now);
  if (!sender.ok) return json({ error: sender.error }, sender.status);
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  if (!isRecord(body)) return json({ error: "invalid_body" }, 400);
  let sealed: Sealed | null;
  let tag: string;
  try {
    sealed = await openHandle(body.handle, env.RELAY_HANDLE_KEYS);
    if (sealed === null) return json({ error: "bad_handle" }, 400);
    if (sealed.instance !== caller.instance) return json({ error: "handle_not_yours" }, 403);
    tag = await handleTag(sealed.instance, sealed.pushToken, env.RELAY_TAG_KEY);
  } catch (error) {
    return misconfigured(error);
  }
  const push = parsePush(body, sealed.platform);
  if (push === null) return json({ error: "invalid_body" }, 400);
  const call = push.kind === "call";
  // An iPhone rings through its PushKit token; a handle minted without one cannot ring.
  const token = call && sealed.platform === "ios" ? sealed.voipToken : sealed.pushToken;
  if (token === undefined) {
    return json({ error: "invalid_body", detail: "the handle has no VoIP token" }, 400);
  }
  // Counted only for a send that would go out, so a malformed body never uses up an instance's minute.
  if (!(await allowed(env.SEND_LIMIT, caller.instance, "sends"))) return limited("instance");
  if (call && !(await allowed(env.CALL_LIMIT, caller.instance, "calls"))) return limited("calls");
  if (!(await allowed(env.PHONE_LIMIT, tag, "phone"))) return limited("phone");
  return deliver(
    {
      platform: sealed.platform,
      token,
      ...(sealed.environment === undefined || sealed.platform !== "ios"
        ? {}
        : { environment: sealed.environment }),
    },
    push,
    env,
    send,
    { instance: caller.instance },
  );
}

/**
 * `GET /v1/health?deep=1`: the instance's own state first (`401 bad_signature`, `403 instance_unregistered` or
 * `instance_revoked`, `503 registry_unavailable`, `429 rate_limited`), then the providers', as `/health?deep=1`, plus
 * `instance` and `handles` (whether this relay can mint and open handles).
 */
async function health(
  caller: VerifiedRequest,
  env: V1Env,
  registry: RegistryNamespace,
  send: Send,
  now: number,
): Promise<Response> {
  const admission = await checkRegistered(registry, caller, now);
  if (!admission.ok) return json({ error: admission.error }, admission.status);
  // It asks APNs (and Google) each time: counted as a send, so it cannot be used to flood them.
  if (!(await allowed(env.SEND_LIMIT, caller.instance, "sends"))) return limited("instance");
  let handles = true;
  try {
    await checkHandleConfig(env.RELAY_HANDLE_KEYS, env.RELAY_TAG_KEY);
  } catch {
    handles = false;
  }
  const result = await providerHealth(env, send);
  const ok = result.ok && handles;
  if (!ok) {
    console.error(
      JSON.stringify({
        message: "deep health failed",
        instance: caller.instance,
        handles,
        ...result,
      }),
    );
  }
  return json({ ...result, ok, handles, instance: caller.instance }, ok ? 200 : 503);
}

/** One limiter call. Best effort, like the binding itself: a limiter that throws lets the call through (logged). */
async function allowed(limiter: Limiter | undefined, key: string, name: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "rate limiter failed", limiter: name, error: String(error) }),
    );
    return true;
  }
}

function limited(limit: "ip" | "instance" | "calls" | "phone"): Response {
  return json({ error: "rate_limited", limit }, 429, {
    "Retry-After": String(LIMIT_PERIOD_SECONDS),
  });
}

function misconfigured(error: unknown): Response {
  if (!(error instanceof HandleConfigError)) throw error;
  console.error(JSON.stringify({ message: "handle keys misconfigured", error: error.message }));
  return json({ error: "relay_misconfigured" }, 500);
}
