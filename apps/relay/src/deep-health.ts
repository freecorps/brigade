import {
  GoogleAuthError,
  GoogleTokenCache,
  parseServiceAccount,
  type ServiceAccount,
} from "./fcm.ts";
import {
  APNS_HOSTS,
  type ApnsCredentials,
  type ApnsEnvironment,
  type ApnsTokenCache,
} from "./apns.ts";

/**
 * `GET /health?deep=1` (RFC 0007 "Watching the watcher", Q19): whether each push provider would take a page now,
 * without sending one. Only for whoever holds `RELAY_SEND_TOKEN` (the instance's watchdog): the answer says which
 * provider is broken, which the public `/health` never does.
 *
 * - **APNs**: the relay's provider token (the same cached JWT a page uses) on a request for a device token that
 *   cannot exist (all zeros). APNs checks the provider token first: `400 BadDeviceToken` means it took the token
 *   (nothing is delivered: there is no such device), and so does `429` (too many requests are counted after the token
 *   is checked); `403 InvalidProviderToken` / `ExpiredProviderToken` that the key was revoked or is wrong. A key that
 *   does not sign is an error too. Only `APNS_ENVIRONMENT`'s host is asked: the same key signs for both hosts, so a key
 *   APNs takes on one it takes on the other.
 * - **FCM**: a fresh OAuth access token for the service account in `FCM_SERVICE_ACCOUNT` (the JWT grant the pages
 *   use, src/fcm.ts), never the pages' cached one. A relay without that secret serves iOS only: `not_configured`,
 *   which is not a failure.
 *
 * An error that may pass by itself (`transient`: the provider not answering in time, a 5xx, Google's token endpoint
 * slow or busy) is told apart from one that will not (a refused key or account): the watchdog stops the external
 * check only after a few transient ones in a row, and at once for the others.
 */
export type ProviderCheck =
  | { status: "ok" }
  | { status: "not_configured" }
  | { status: "error"; reason: string; transient?: true };

export type DeepHealth = { ok: boolean; apns: ProviderCheck; fcm: ProviderCheck };

/** How long each provider gets. */
export const DEEP_CHECK_TIMEOUT_MS = 4000;
/** No device has this token: APNs answers `BadDeviceToken` once it accepted the provider token. */
export const NO_DEVICE_TOKEN = "0".repeat(64);

export async function deepHealth(
  options: {
    credentials: ApnsCredentials;
    environment: ApnsEnvironment;
    topic: string;
    tokens: ApnsTokenCache;
    /** The Firebase service account's JSON key, when FCM is set up. */
    fcmServiceAccount: string | undefined;
  },
  send: (request: Request) => Promise<Response>,
  now = Date.now(),
): Promise<DeepHealth> {
  const [apns, fcm] = await Promise.all([
    checkApns(options, send, now),
    checkFcm(options.fcmServiceAccount, send, now),
  ]);
  return { ok: apns.status === "ok" && fcm.status !== "error", apns, fcm };
}

async function checkApns(
  options: {
    credentials: ApnsCredentials;
    environment: ApnsEnvironment;
    topic: string;
    tokens: ApnsTokenCache;
  },
  send: (request: Request) => Promise<Response>,
  now: number,
): Promise<ProviderCheck> {
  let jwt: string;
  try {
    jwt = await options.tokens.get(options.credentials, now);
  } catch {
    return { status: "error", reason: "key_invalid" };
  }
  const request = new Request(
    `https://${APNS_HOSTS[options.environment]}/3/device/${NO_DEVICE_TOKEN}`,
    {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": options.topic,
        "apns-push-type": "background",
        "apns-priority": "5",
        "apns-expiration": "0",
        "content-type": "application/json",
      },
      body: JSON.stringify({ aps: { "content-available": 1 } }),
      signal: AbortSignal.timeout(DEEP_CHECK_TIMEOUT_MS),
    },
  );
  try {
    const response = await send(request);
    const reason = await readReason(response);
    if (response.status === 400 && reason === "BadDeviceToken") return { status: "ok" };
    // Rate limited: APNs checked the provider token before it counted the request.
    if (response.status === 429) return { status: "ok" };
    if (reason === "ExpiredProviderToken" || reason === "InvalidProviderToken") {
      options.tokens.clear();
    }
    return {
      status: "error",
      reason: reason ?? `status_${response.status}`,
      ...(response.status >= 500 && { transient: true as const }),
    };
  } catch {
    return { status: "error", reason: "unreachable", transient: true };
  }
}

async function checkFcm(
  serviceAccount: string | undefined,
  send: (request: Request) => Promise<Response>,
  now: number,
): Promise<ProviderCheck> {
  if (!serviceAccount) return { status: "not_configured" };
  let account: ServiceAccount;
  try {
    account = parseServiceAccount(serviceAccount);
  } catch {
    return { status: "error", reason: "account_invalid" };
  }
  // A cache of its own each time, so the check really asks Google: the pages' cached token would hide a revoked key
  // for up to an hour.
  try {
    await new GoogleTokenCache().get(account, now, (request) =>
      send(new Request(request, { signal: AbortSignal.timeout(DEEP_CHECK_TIMEOUT_MS) })),
    );
    return { status: "ok" };
  } catch (error) {
    // `unreachable`: Google's token endpoint did not answer in time, or answered 5xx or 429.
    if (error instanceof GoogleAuthError && error.kind === "refused") {
      return { status: "error", reason: "refused" };
    }
    return { status: "error", reason: "unreachable", transient: true };
  }
}

async function readReason(response: Response): Promise<string | undefined> {
  const text = await response.text().catch(() => "");
  try {
    const reason = Reflect.get(Object(JSON.parse(text)), "reason");
    return typeof reason === "string" ? reason : undefined;
  } catch {
    return undefined;
  }
}
