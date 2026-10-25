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

export type ActorResult = { ok: true; actor: Actor } | { ok: false; response: Response };

/**
 * DEV ONLY: whether this deployment lets an upgrade without a session act as `DEV_ACTOR`. Only local runs and
 * the tests set the variable (their Vite configs), never a deployed environment (apps/web
 * test/worker-config.test.ts checks every environment in wrangler.jsonc). The mobile app relies on it until it
 * can sign in.
 */
export function devActorEnabled(env: object): boolean {
  return Reflect.get(env, DEV_ACTOR_VAR) === "1";
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
  // site could open a socket as the signed-in user (cross-site WebSocket hijacking). Native clients send no
  // Origin.
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return refuse(403, "forbidden_origin");
  }

  // Made only now: a Better Auth instance that is created and never used leaves its initialisation running
  // past the request, and the next request that waits on it hangs.
  const session = await auth().api.getSession({ headers: request.headers });
  if (!session) {
    if (devActorEnabled(env)) return { ok: true, actor: DEV_ACTOR };
    return refuse(401, "unauthenticated");
  }

  const role = await memberRole(env.DB, workspaceId, session.user.id);
  if (role === undefined) return refuse(403, "not_a_member");
  return { ok: true, actor: { kind: "user", id: session.user.id, role } };
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

function refuse(status: 401 | 403, error: string): ActorResult {
  return { ok: false, response: Response.json({ error }, { status }) };
}
