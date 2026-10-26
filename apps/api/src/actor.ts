// Who a sync socket acts as (RFC 0004 "Socket topology"): the Worker authenticates the upgrade with the Better
// Auth session, checks the user's membership and role in the workspace, and hands the shard a verified actor.

import { isRole, type Actor } from "@freecorps/brigade-schema";
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

/** `name`: the member's name from Better Auth; absent for the dev actor, which has no user. */
export type ActorResult =
  | { ok: true; actor: Actor; name?: string }
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
 * the dev actor is on), 403 when the user is not a member with a Brigade role.
 */
export async function resolveActor(
  request: Request,
  env: { DB: D1Database },
  auth: () => Auth,
  workspaceId: string,
): Promise<ActorResult> {
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

  const role = await memberRole(env.DB, workspaceId, session.user.id);
  if (role === undefined) return refuse(403, "not_a_member");
  return { ok: true, actor: { kind: "user", id: session.user.id, role }, name: session.user.name };
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
  const { kind, id, role } = value as Record<string, unknown>;
  if (kind !== "user" && kind !== "system" && kind !== "integration") return undefined;
  if (typeof id !== "string" || id.length === 0 || !isRole(role)) return undefined;
  return { kind, id, role };
}

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
