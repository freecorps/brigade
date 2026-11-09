// Sending without the relay (RFC 0016 "Push", step 2): an instance that holds the app's own APNs key and Firebase
// service account (Freecorps' hosted instance, or a company with its own app build, RFC 0015) sends each push from its
// own Worker, through the same code the relay runs (apps/relay src/send.ts: the same payloads and envelopes, Ember's
// push transport for the tokens), so the phones see no difference. The relay stays the fallback, per device.

import { providerHealth, sendBody, type ProviderEnv } from "@freecorps/brigade-relay/send";
import type { BeatCheck } from "./watchdog.ts";

/** The API Worker's secrets for direct sends: the relay's names. All four APNs ones, or no direct sends. */
export type DirectPushEnv = {
  /** The APNs token key (`.p8`) text. */
  APNS_KEY?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  /** The app's bundle id (`app.freecorps.brigade` for the store app). */
  APNS_TOPIC?: string;
  /** The Firebase service account's JSON key; without it Android devices go through the relay. */
  FCM_SERVICE_ACCOUNT?: string;
};

export type Fetch = (request: Request) => Promise<Response>;

/** Whether this instance can send to iPhones itself. */
export function directConfigured(env: DirectPushEnv): boolean {
  return [env.APNS_KEY, env.APNS_KEY_ID, env.APNS_TEAM_ID, env.APNS_TOPIC].every(
    (value) => typeof value === "string" && value.trim() !== "",
  );
}

/**
 * The provider's answers that settle a direct send by themselves: delivered, or the device's token is gone
 * (`BadDeviceToken`, `Unregistered`, `410`, FCM's `UNREGISTERED` or a token FCM says is done). Anything else is this
 * instance's own trouble (a key APNs refuses, a topic or Firebase project that is not the app's, APNs or Google out of
 * reach, a body the provider refused) and goes on through the relay. `DeviceTokenNotForTopic` is never taken from a
 * direct send: a mistyped `APNS_TOPIC` would otherwise drop every phone.
 */
export function directSettles(
  status: number,
  answer: { status?: unknown; reason?: unknown; tokenInvalid?: unknown; error?: unknown },
): boolean {
  if (status >= 200 && status < 300) return true;
  if (answer.status === 410) return true;
  if (["BadDeviceToken", "Unregistered", "UNREGISTERED"].includes(answer.reason as string)) {
    return true;
  }
  return answer.tokenInvalid === true && answer.reason !== "SENDER_ID_MISMATCH";
}

/**
 * The header a direct route's answer carries when this instance sent it itself (not the relay it fell back to), so the
 * notifier knows a `DeviceTokenNotForTopic` there is this instance's topic, never the phone's (src/notify.ts).
 */
export const SENT_BY_HEADER = "Brigade-Sent-By";

/**
 * How long a direct send gets before the fallback takes over: under the relay route's own 10 s, so a direct attempt
 * and the relay after it stay near what one relay call took. A send still running then may still reach the phone;
 * the page's collapse id (and a call's id) make the relay's copy replace it rather than stack.
 */
export const DIRECT_BUDGET_MS = 6000;

/**
 * A `post` for the notifier's direct route (src/notify.ts `RelayRoute`): takes the relay's `/send` body and answers
 * as the relay would. A send this instance cannot settle (`directSettles`) is posted to `fallback` (the relay's
 * `/send`, when the instance has one) with the same body and its answer is the route's. An iPhone registered without
 * its APNs environment (none today: registration requires it) goes straight to the fallback, since guessing the host
 * could drop it as `BadDeviceToken`, and so does an Android phone when this instance has no Firebase service account.
 * Answers this instance gave itself carry `SENT_BY_HEADER`. Never logs a token, a key or the envelope.
 */
export function directPost(
  env: DirectPushEnv,
  send: Fetch,
  fallback: ((body: Record<string, unknown>) => Promise<Response>) | undefined,
  log: (message: string, fields: Record<string, unknown>) => void,
): (body: Record<string, unknown>) => Promise<Response> {
  const provider = providerEnv(env);
  const own = async (status: number, answer: Record<string, unknown>) =>
    Response.json(answer, { status, headers: { [SENT_BY_HEADER]: "direct" } });
  return async (body) => {
    const android = body.platform === "android";
    if (android ? !provider.FCM_SERVICE_ACCOUNT : body.environment === undefined) {
      if (fallback) return fallback(body);
      return own(500, { error: "relay_misconfigured" });
    }
    let status: number;
    let answer: Record<string, unknown>;
    try {
      const response = await within(sendBody(body, provider, send), DIRECT_BUDGET_MS);
      status = response.status;
      answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (error) {
      // Out of time (APNs or Google slow from here), or a bug: the relay, or the device's handle, may still deliver.
      log("direct send did not answer", { error: String(error) });
      status = 502;
      answer = { error: android ? "fcm_unreachable" : "apns_unreachable" };
    }
    if (!fallback || directSettles(status, answer)) return own(status, answer);
    log("direct send failed, paging the device through the relay", {
      platform: android ? "android" : "ios",
      kind: body.kind ?? "alert",
      status,
      error: answer.error,
      providerStatus: answer.status,
      reason: answer.reason,
    });
    return fallback(body);
  };
}

/**
 * This instance's own key and account as the relay's code takes them (`sendBody`, `providerHealth`). The environment
 * is only used for a device without one, which never goes direct (`directPost`), and by `directHealth`, which asks the
 * production host: one key signs for both hosts.
 */
function providerEnv(env: DirectPushEnv): ProviderEnv {
  return {
    APNS_ENVIRONMENT: "production",
    APNS_TOPIC: env.APNS_TOPIC ?? "",
    APNS_KEY: env.APNS_KEY ?? "",
    APNS_KEY_ID: env.APNS_KEY_ID ?? "",
    APNS_TEAM_ID: env.APNS_TEAM_ID ?? "",
    ...(env.FCM_SERVICE_ACCOUNT ? { FCM_SERVICE_ACCOUNT: env.FCM_SERVICE_ACCOUNT } : {}),
  };
}

/**
 * The heartbeat's check of this instance's own key and account (RFC 0007 "Watching the watcher", Q34): the relay's
 * deep health (apps/relay src/deep-health.ts) run here with the API's secrets, so a revoked or mistyped key is found
 * within a minute, not when a page first falls back through the relay. APNs takes the provider token on a device that
 * cannot exist; FCM gives an access token (`not_configured` without `FCM_SERVICE_ACCOUNT`). Undefined when direct sends
 * are off. Never throws: a check that did not finish is `transient`.
 */
export async function directHealth(
  env: DirectPushEnv,
  send: Fetch,
): Promise<{ apns: BeatCheck; fcm: BeatCheck } | undefined> {
  if (!directConfigured(env)) return undefined;
  try {
    const health = await providerHealth(providerEnv(env), send);
    const check = (found: (typeof health)["apns"]): BeatCheck =>
      found.status === "error" ? (found.transient ? "transient" : "error") : found.status;
    const result = { apns: check(health.apns), fcm: check(health.fcm) };
    if (result.apns !== "ok" || (result.fcm !== "ok" && result.fcm !== "not_configured")) {
      logCheck("direct push check failed", {
        apns: health.apns.status === "error" ? health.apns.reason : health.apns.status,
        fcm: health.fcm.status === "error" ? health.fcm.reason : health.fcm.status,
      });
    }
    return result;
  } catch (error) {
    logCheck("direct push check failed", { error: String(error) });
    return { apns: "transient", fcm: "transient" };
  }
}

function logCheck(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "direct", ...fields }));
}

/** `promise`, or a rejection once `ms` passed. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
