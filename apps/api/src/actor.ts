// Who a sync socket acts as (RFC 0004 "Socket topology"): the Worker authenticates the upgrade with the Better
// Auth session, checks the user's membership and role in the workspace, and hands the shard a verified actor.

import { isRole, TOKEN_SCOPES, type Actor, type Permission } from "@freecorps/brigade-schema";
import { bearerToken, resolveBearer, type ApiTokenEnv } from "./api-tokens.ts";
import type { Auth } from "./auth.ts";
import { DEV_ACTOR, DEV_ACTOR_VAR } from "./dev-actor.ts";

/**
 * Set by the Worker on the upgrade it forwards to the shard: the actor as JSON. The Worker builds that request
 * from scratch (no client header is copied), and a Durable Object is only reachable through this Worker's
 * binding, so the shard can trust it without a signature.
 */
export const ACTOR_HEADER = "Brigade-Actor";
/**
 * Set next to `ACTOR_HEADER` when the actor is a signed-in member: their name, URI-encoded (a header value is
 * Latin-1), for the shard's member list (`member.sync`).
 */
export const MEMBER_NAME_HEADER = "Brigade-Member-Name";
/**
 * Set next to `MEMBER_NAME_HEADER` when the member's password was ever reset: when (`user.passwordResetAt`, ms since
 * the epoch, RFC 0002 "Auth"). The shard drops the member's devices from before it ahead of the socket.
 */
export const RESET_AT_HEADER = "Brigade-Reset-At";
/**
 * Set next to `MEMBER_NAME_HEADER`: the Better Auth session the upgrade came with (its id, never its token). The
 * shard tags the socket with it, so ending that session closes it (`WorkspaceDO.endSession`, RFC 0004 "Session
 * revocation").
 */
export const SESSION_HEADER = "Brigade-Session";
/** The tag a shard gives a socket opened with session `sessionId` (`acceptWebSocket`). */
export function sessionTag(sessionId: string): string {
  return `session:${sessionId}`;
}
/**
 * Set next to `SESSION_HEADER`: when that session expires (ms since the epoch). Better Auth deletes an expired session
 * only when someone next presents it, so no hook fires at expiry: the shard closes the socket then itself
 * (`WorkspaceDO.expireSockets`, RFC 0004 "Session revocation").
 */
export const SESSION_EXPIRES_HEADER = "Brigade-Session-Expires";

/**
 * `name`: the member's name from Better Auth; `resetAt`: when their password was last reset, if ever; `sessionId` and
 * `sessionExpiresAt`: the session the upgrade came with and when it expires. All absent for the dev actor, which has
 * no user.
 */
export type ActorResult =
  | {
      ok: true;
      actor: Actor;
      name?: string;
      resetAt?: number;
      sessionId?: string;
      sessionExpiresAt?: number;
    }
  | { ok: false; response: Response };

/** Hosts a local run serves on: the dev actor never applies to a request for any other host. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/**
 * A private IPv4 address (10/8, 172.16/12, 192.168/16): a phone on the same Wi-Fi reaching `vp dev` by the
 * computer's address. Cloudflare's edge never serves a deployed Worker under such a host.
 */
const PRIVATE_IPV4 = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/;

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || PRIVATE_IPV4.test(hostname);
}

/**
 * DEV ONLY: whether an upgrade without a session may act as `DEV_ACTOR`. Both must hold: the variable is set (only
 * local runs and the tests set it, in their Vite configs, never a deployed environment; apps/web
 * test/worker-config.test.ts checks every environment in wrangler.jsonc), and the request is for a local host, so a
 * deployment that sets the variable by mistake still refuses it. A private LAN address counts as local, so a
 * phone can use `vp dev` over Wi-Fi. No app relies on it since the mobile app signs in; it stays for local tools
 * and the tests.
 */
export function devActorEnabled(env: object, request: Request): boolean {
  return Reflect.get(env, DEV_ACTOR_VAR) === "1" && isLocalHost(new URL(request.url).hostname);
}

/**
 * The actor for a sync upgrade to `workspaceId`: 403 for a cross-site `Origin`, 401 without a session (unless
 * the dev actor is on), 403 when the user is not a member with a Brigade role. With `Authorization: Bearer`, the API
 * token alone (RFC 0014): no `Origin` check, since a page cannot set that header on a WebSocket upgrade, and the same
 * 401 for every token refused.
 */
export async function resolveActor(
  request: Request,
  env: ApiTokenEnv,
  auth: () => Auth,
  workspaceId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<ActorResult> {
  const token = bearerToken(request);
  if (token !== undefined) {
    const result = await resolveBearer(token, env, workspaceId, waitUntil);
    return result.ok ? { ok: true, actor: result.actor } : result;
  }
  // Browsers send cookies on a cross-site WebSocket upgrade and CORS does not apply to it, so a page on another
  // site could open a socket as the signed-in user (cross-site WebSocket hijacking). A browser always sends the
  // page's Origin on an upgrade, so this refuses every other site. The mobile app is no browser: it sets the
  // session's `Cookie` header itself (apps/mobile/src/lib/sync-client.ts), and React Native sends either no
  // Origin or, by default, the socket URL's own origin, which passes. No other origin is accepted here, the app's
  // `brigade://` included: it never sends it on a socket.
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return refuse(403, "forbidden_origin");
  }

  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) {
    if (devActorEnabled(env, request)) return { ok: true, actor: DEV_ACTOR };
    return refuse(401, "unauthenticated");
  }

  const member = await env.DB.prepare(
    `select m.role, u."passwordResetAt" as "resetAt" from member m
     left join "user" u on u.id = m."userId"
     where m."organizationId" = ? and m."userId" = ? limit 1`,
  )
    .bind(workspaceId, session.user.id)
    .first<{ role: string; resetAt: number | null }>();
  if (!member || !isRole(member.role)) return refuse(403, "not_a_member");
  return {
    ok: true,
    actor: { kind: "user", id: session.user.id, role: member.role },
    name: session.user.name,
    sessionId: session.session.id,
    ...expiry(session.session.expiresAt),
    ...(member.resetAt !== null ? { resetAt: member.resetAt } : {}),
  };
}

/** The user's Brigade role in the workspace, or undefined if they are not a member (or hold no Brigade role). */
export async function memberRole(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<Actor["role"] | undefined> {
  const row = await db
    .prepare(`select role from member where "organizationId" = ? and "userId" = ? limit 1`)
    .bind(workspaceId, userId)
    .first<{ role: string }>();
  // Better Auth stores several roles comma-separated; Brigade gives each member exactly one.
  return row && isRole(row.role) ? row.role : undefined;
}

/** Reads the actor the Worker set on a forwarded upgrade; undefined if it is missing or malformed. */
export function readActor(headers: Headers): Actor | undefined {
  const raw = headers.get(ACTOR_HEADER);
  if (raw === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const { kind, id, role, by, scopes } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || !isRole(role)) return undefined;
  // An API token (RFC 0014): its creator and its scopes, both required.
  if (kind === "token") {
    if (typeof by !== "string" || by.length === 0 || !Array.isArray(scopes)) return undefined;
    if (!scopes.every((scope) => (TOKEN_SCOPES as readonly unknown[]).includes(scope))) {
      return undefined;
    }
    return { kind, id, role, by, scopes: scopes as Permission[] };
  }
  if (kind !== "user" && kind !== "system" && kind !== "integration") return undefined;
  return { kind, id, role };
}

/** When the member's password was last reset, as the Worker set it on a forwarded upgrade, or undefined. */
export function readResetAt(headers: Headers): number | undefined {
  const raw = headers.get(RESET_AT_HEADER);
  if (raw === null || !/^\d{1,16}$/.test(raw)) return undefined;
  const at = Number(raw);
  return Number.isSafeInteger(at) ? at : undefined;
}

function expiry(expiresAt: Date | string | undefined): { sessionExpiresAt?: number } {
  const at = expiresAt === undefined ? NaN : new Date(expiresAt).getTime();
  return Number.isSafeInteger(at) ? { sessionExpiresAt: at } : {};
}

/** When the upgrade's session expires, as the Worker set it on a forwarded upgrade, or undefined. */
export function readSessionExpiresAt(headers: Headers): number | undefined {
  const raw = headers.get(SESSION_EXPIRES_HEADER);
  if (raw === null || !/^\d{1,16}$/.test(raw)) return undefined;
  const at = Number(raw);
  return Number.isSafeInteger(at) ? at : undefined;
}

/** The session id the Worker set on a forwarded upgrade, or undefined. */
export function readSessionId(headers: Headers): string | undefined {
  const raw = headers.get(SESSION_HEADER);
  return raw !== null && SESSION_ID.test(raw) ? raw : undefined;
}

/** A Better Auth session id as `authId` makes them (`ses_` and a ULID); short enough for a socket tag. */
export const SESSION_ID = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The member name the Worker set on a forwarded upgrade, or undefined. */
export function readMemberName(headers: Headers): string | undefined {
  const raw = headers.get(MEMBER_NAME_HEADER);
  if (raw === null) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

function refuse(status: 401 | 403, error: string): ActorResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}
