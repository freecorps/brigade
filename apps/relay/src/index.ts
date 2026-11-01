import type { ApnsEnvironment } from "./apns.ts";
import { readJson } from "./body.ts";
import { instanceRoutes, type InstanceEnv } from "./instances.ts";
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
import { V1_PATHS, v1Routes, type V1Env } from "./v1.ts";

export { RegistryDO } from "./registry.ts";
export type { Platform } from "./send.ts";

/**
 * The push relay (RFC 0006, RFC 0015). `POST /send` takes a device token and an already encrypted envelope and
 * forwards it to APNs, or to FCM for an Android device (`platform: "android"`); its only caller is whoever holds
 * `RELAY_SEND_TOKEN` (our own instance, until every app sends handles). `/v1/` is the instance protocol: registration
 * (src/instances.ts), and handles, `POST /v1/send` and the signed deep health (src/v1.ts). Both send routes share the
 * delivery code in src/send.ts.
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
> &
  ProviderEnv &
  InstanceEnv &
  V1Env;

export default {
  fetch: (request, env) => handle(request, env, fetch),
} satisfies ExportedHandler<Env>;

export async function handle(request: Request, env: RelayEnv, send: Send): Promise<Response> {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname === "/health" && searchParams.get("deep") === "1") {
    // Says which provider fails, so only the send token's holder (the instance's watchdog) may ask.
    if (!(await authorized(request, env.RELAY_SEND_TOKEN))) {
      return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
    }
    const health = await providerHealth(env, send);
    if (!health.ok) console.error(JSON.stringify({ message: "deep health failed", ...health }));
    return json(health, health.ok ? 200 : 503);
  }
  if (pathname === "/health") return json({ ok: true });
  // The instance protocol (RFC 0015); `/send` below keeps working without its bindings.
  if (V1_PATHS.has(pathname)) return v1Routes(request, env, send, Date.now());
  if (pathname.startsWith("/v1/")) return instanceRoutes(request, env, Date.now());
  if (pathname !== "/send") return json({ error: "not_found" }, 404);
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!(await authorized(request, env.RELAY_SEND_TOKEN))) {
    return json({ error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" });
  }

  const body = await readJson(request);
  if (!isRecord(body)) return json({ error: "invalid_body" }, 400);
  const platform = body.platform ?? "ios";
  if (
    typeof body.deviceToken !== "string" ||
    !PLATFORMS.includes(platform as Platform) ||
    (body.environment !== undefined && !ENVIRONMENTS.includes(body.environment as ApnsEnvironment))
  ) {
    return json({ error: "invalid_body" }, 400);
  }
  const push = parsePush(body, platform as Platform);
  if (push === null) return json({ error: "invalid_body" }, 400);
  return deliver(
    {
      platform: platform as Platform,
      token: body.deviceToken,
      ...(body.environment === undefined
        ? {}
        : { environment: body.environment as ApnsEnvironment }),
    },
    push,
    env,
    send,
  );
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
