// Ember inside the API Worker (RFC 0016 "Running Ember inside Brigade"): the runtime mounted at `/ember`, its `Shard`
// and `System` Durable Objects exported next to Brigade's (src/index.ts), the auth hook that trusts Brigade's own
// tokens (src/ember-token.ts) and D1, and which engine holds each workspace (`workspace_engine`, migrations/0017).
//
// Until a workspace is switched to `ember` none of this is reached: the API mints no token for it, and `/ember`
// answers 404 for its shard, so no Ember shard of a workspace still on `WorkspaceDO` is ever woken or written.

import { env as moduleEnv } from "cloudflare:workers";
import { createEmberWorker, type EmberAuthHook } from "@freecorps/ember-runtime";
import type { Identity } from "@freecorps/ember-server";
import schema from "../ember/schema.ts";
import * as workspace from "../ember/workspace.ts";
import { memberRole, resolveActor } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { mintEmberToken, verifyEmberToken } from "./ember-token.ts";
import { json } from "./member-route.ts";
import { instanceMonitorCap, type MonitorEnv } from "./monitors.ts";
import { WORKSPACE_ID } from "./workspace.ts";

/** Where the runtime is mounted in the API Worker. */
export const EMBER_BASE_PATH = "/ember";

/** The engine holding a workspace: its `WorkspaceDO` (`brigade`) or its Ember shard (`ember`). */
export type WorkspaceEngine = "brigade" | "ember";

/** Which engine holds `workspaceId`: `brigade` unless `workspace_engine` says `ember`. */
export async function workspaceEngine(
  db: D1Database,
  workspaceId: string,
): Promise<WorkspaceEngine> {
  const row = await db
    .prepare(`select engine from workspace_engine where "workspaceId" = ?`)
    .bind(workspaceId)
    .first<{ engine: string }>();
  return row?.engine === "ember" ? "ember" : "brigade";
}

/** Records that `workspaceId` is now held by `engine`. */
export async function setWorkspaceEngine(
  db: D1Database,
  workspaceId: string,
  engine: WorkspaceEngine,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `insert into workspace_engine ("workspaceId", engine, "switchedAt") values (?, ?, ?)
       on conflict ("workspaceId") do update set engine = excluded.engine, "switchedAt" = excluded."switchedAt"`,
    )
    .bind(workspaceId, engine, now)
    .run();
}

/** The Ember shard of a workspace. */
export const workspaceShard = (workspaceId: string) => `workspace:${workspaceId}`;

type EmberAuthEnv = { DB: D1Database; BETTER_AUTH_SECRET: string };

/**
 * The identity for `token` (RFC 0016 "Auth"), or null: a token this instance minted, unexpired, whose session has not
 * ended (`session_end`) and whose member is still in the workspace in D1. A member's role is D1's at this moment, so a
 * demotion holds from the socket's next refresh; an API token keeps its creator's role from the mint, and the shard
 * checks the token's own row (revoked, expired, scopes) on every call (ember/workspace.ts `actorOf`).
 */
export async function verifyIdentity(
  env: EmberAuthEnv,
  token: string,
  now = Date.now(),
): Promise<Identity | null> {
  const claims = await verifyEmberToken(env.BETTER_AUTH_SECRET, token, now);
  if (!claims) return null;
  let role = claims.role;
  if (claims.kind !== "token") {
    if (claims.sid !== undefined) {
      const ended = await env.DB.prepare(
        `select 1 from session_end where "workspaceId" = ? and "sessionId" = ? limit 1`,
      )
        .bind(claims.ws, claims.sid)
        .first();
      if (ended) return null;
    }
    const current = await memberRole(env.DB, claims.ws, claims.sub);
    if (current === undefined) return null;
    role = current;
  }
  return {
    subject: claims.sub,
    iat: claims.iat,
    exp: claims.exp,
    claims: {
      role,
      ws: claims.ws,
      ...(claims.kind === undefined ? {} : { kind: claims.kind }),
      ...(claims.sid === undefined ? {} : { sid: claims.sid }),
    },
  };
}

/**
 * The hook the runtime calls in the Worker and in each Shard. Neither passes `env`, so it reads the module's
 * (`cloudflare:workers`), which is the same Worker's bindings in both.
 */
export const brigadeEmberAuth: EmberAuthHook = {
  verify: (token) => verifyIdentity(moduleEnv as unknown as EmberAuthEnv, token),
};

// The instance's monitor cap for every mutation this isolate runs (`MutationContext.limits`), as `WorkspaceDO`
// passes it from its env today.
workspace.setWorkspaceLimits({ monitors: instanceMonitorCap(moduleEnv as unknown as MonitorEnv) });

export const ember = createEmberWorker({
  schema,
  functions: { workspace },
  basePath: EMBER_BASE_PATH,
  auth: brigadeEmberAuth,
});

/** The Ember paths a Brigade client uses: the socket and the HTTP query and mutation calls. Nothing else is served. */
const SERVED = new Set([
  `${EMBER_BASE_PATH}/ws`,
  `${EMBER_BASE_PATH}/api/query`,
  `${EMBER_BASE_PATH}/api/mutation`,
]);

/** The workspace a request to the runtime is for: `?shard=` on the socket, the body's `shard` on an HTTP call. */
async function requestedWorkspace(request: Request, url: URL): Promise<string | undefined> {
  let shard: unknown;
  if (url.pathname === `${EMBER_BASE_PATH}/ws`) shard = url.searchParams.get("shard");
  else {
    try {
      shard = ((await request.clone().json()) as { shard?: unknown } | null)?.shard;
    } catch {
      return undefined;
    }
  }
  if (typeof shard !== "string" || !shard.startsWith("workspace:")) return undefined;
  const id = shard.slice("workspace:".length);
  return WORKSPACE_ID.test(id) ? id : undefined;
}

/**
 * Hands a request under `/ember` to the runtime, only for a workspace whose engine is `ember` (404 otherwise, the
 * same for a path the runtime has but Brigade does not use: admin, storage, actions).
 */
export async function serveEmber(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (!SERVED.has(url.pathname)) return json({ error: "not_found" }, 404);
  const workspaceId = await requestedWorkspace(request, url);
  if (workspaceId === undefined || (await workspaceEngine(env.DB, workspaceId)) !== "ember") {
    return json({ error: "not_found" }, 404);
  }
  return ember.fetch(request, env as never, ctx);
}

/**
 * `POST /ember-token/:workspace`: a token to act in the workspace's Ember shard, for the caller `resolveActor` finds
 * (a member's session, or an API token, as a sync upgrade). `409 not_on_ember` while the workspace is on `brigade`.
 */
export async function issueEmberToken(
  request: Request,
  env: Env,
  auth: () => Auth,
  workspaceId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!WORKSPACE_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  const resolved = await resolveActor(request, env, auth, workspaceId, waitUntil);
  if (!resolved.ok) return resolved.response;
  if ((await workspaceEngine(env.DB, workspaceId)) !== "ember") {
    return json({ error: "not_on_ember" }, 409);
  }
  const { actor } = resolved;
  // The dev actor (local runs only) has no session; neither does an API token, whose row the shard checks.
  const minted = await mintEmberToken(
    env.BETTER_AUTH_SECRET,
    {
      sub: actor.id,
      ws: workspaceId,
      role: actor.role,
      ...(actor.kind === "token" ? { kind: "token" as const } : {}),
      ...(resolved.sessionId === undefined ? {} : { sid: resolved.sessionId }),
    },
    Date.now(),
    resolved.sessionExpiresAt,
  );
  if (!minted) return json({ error: "unauthenticated" }, 401);
  return json(
    { token: minted.token, expiresAt: minted.expiresAt, shard: workspaceShard(workspaceId) },
    200,
    {
      "Cache-Control": "no-store",
    },
  );
}
