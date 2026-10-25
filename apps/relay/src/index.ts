import { parsePushEnvelope } from "@freecorps/brigade-push";
import {
  ApnsTokenCache,
  buildApnsRequest,
  type ApnsCredentials,
  type ApnsEnvironment,
  type Urgency,
} from "./apns.ts";

/**
 * Spike S1 relay (RFC 0006): `POST /send` takes a device token and an already encrypted envelope and forwards
 * it to APNs. Instance registration, handles and rate limits come later; until then the only caller is whoever
 * holds `RELAY_SEND_TOKEN`.
 */

export interface RelayEnv {
  APNS_ENVIRONMENT: string;
  APNS_TOPIC: string;
  APNS_KEY: string;
  APNS_KEY_ID: string;
  APNS_TEAM_ID: string;
  RELAY_SEND_TOKEN: string;
}

const URGENCIES: readonly Urgency[] = ["low", "high", "page"];
/** A request body far above any valid send: a device token and a sealed 2 KB plaintext. */
const MAX_BODY_BYTES = 8 * 1024;

// One per isolate: the provider token is the same for every request (APNs throttles frequent refreshes).
const tokens = new ApnsTokenCache();

export default {
  fetch: (request, env) => handle(request, env, fetch),
} satisfies ExportedHandler<Env>;

export async function handle(
  request: Request,
  env: RelayEnv,
  send: (request: Request) => Promise<Response>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
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
  const urgency = body.urgency ?? "high";
  if (
    typeof body.deviceToken !== "string" ||
    envelope === null ||
    !URGENCIES.includes(urgency as Urgency) ||
    (body.collapseId !== undefined && typeof body.collapseId !== "string")
  ) {
    return json({ error: "invalid_body" }, 400);
  }

  const environment: ApnsEnvironment =
    env.APNS_ENVIRONMENT === "production" ? "production" : "sandbox";
  const credentials: ApnsCredentials = {
    key: env.APNS_KEY,
    keyId: env.APNS_KEY_ID,
    teamId: env.APNS_TEAM_ID,
  };
  let apnsRequest: Request;
  try {
    const jwt = await tokens.get(credentials, Date.now());
    apnsRequest = buildApnsRequest(
      {
        deviceToken: body.deviceToken,
        envelope,
        urgency: urgency as Urgency,
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
    response = await send(apnsRequest);
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
  console.log(JSON.stringify({ message: "APNs response", environment, ...result }));
  return json(result, response.ok ? 200 : 502);
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

async function readJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text);
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
