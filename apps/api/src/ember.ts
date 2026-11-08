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
import * as alerts from "../ember/alerts.ts";
import * as clients from "../ember/clients.ts";
import * as devices from "../ember/devices.ts";
import * as events from "../ember/events.ts";
import * as dataExports from "../ember/exports.ts";
import * as integrations from "../ember/integrations.ts";
import * as local from "../ember/local.ts";
import * as invitations from "../ember/invitations.ts";
import * as mailer from "../ember/mailer.ts";
import * as rest from "../ember/rest.ts";
import * as members from "../ember/members.ts";
import * as monitors from "../ember/monitors.ts";
import * as paging from "../ember/paging.ts";
import * as postmortems from "../ember/postmortems.ts";
import * as sessions from "../ember/sessions.ts";
import * as status from "../ember/status.ts";
import * as workspace from "../ember/workspace.ts";
import type { Role } from "@freecorps/brigade-schema";
import { memberRole, resolveActor } from "./actor.ts";
import { creatorNow, withinLimit } from "./api-tokens.ts";
import { readBounded } from "./body.ts";
import type { Auth } from "./auth.ts";
import { admitToEmber } from "./ember-clients.ts";
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

/**
 * Records that `workspaceId` is now held by `engine`. Outside the tests only a new workspace provisioned on Ember
 * (`NEW_WORKSPACE_ENGINE`, src/ember-invitations.ts) calls it; the migration route that switches existing ones (RFC
 * 0016 "Data migration") ships with what a switch needs first, `WorkspaceDO` forwarding the requests that still reach
 * it after `ember`, and the Ember shard's sockets revoked and its writes fenced before `brigade` again.
 */
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
 * The identity for `token` (RFC 0016 "Auth"), or null: a token this instance minted and unexpired, whose subject D1
 * still backs. A member's: their session is still in D1 (a member's token always names one) and they are still in the
 * workspace, with D1's role at this moment, so a demotion holds from the socket's next refresh. An API token's: its
 * row is in D1 for this workspace, neither revoked nor expired, and its creator is still a member since before it
 * (`creatorNow`, as on REST), with the creator's role now. The shard checks the token's own copy (scopes, revocation) on every call too (ember/workspace.ts
 * `actorOf`).
 */
export async function verifyIdentity(
  env: EmberAuthEnv,
  token: string,
  now = Date.now(),
): Promise<Identity | null> {
  const claims = await verifyEmberToken(env.BETTER_AUTH_SECRET, token, now);
  if (!claims) return null;
  let role: Role | undefined;
  let by: string | undefined;
  if (claims.kind === "token") {
    const row = await env.DB.prepare(
      `select created_by as createdBy, created_at as createdAt, expires_at as expiresAt from api_token
       where id = ? and workspace_id = ? and revoked_at is null limit 1`,
    )
      .bind(claims.sub, claims.ws)
      .first<{ createdBy: string; createdAt: number; expiresAt: number | null }>();
    if (!row || (row.expiresAt !== null && row.expiresAt <= now)) return null;
    by = row.createdBy;
    // As on REST (`resolveBearer`): the creator's role now, and a membership newer than the token (they left and came
    // back) does not revive it.
    role = (await creatorNow(env.DB, { ...row, workspaceId: claims.ws }))?.role;
  } else {
    // The session must still be in D1: a sign-out, a password reset or a takeover deletes its row (`session_end` is
    // only a queue of the shard work left after that, and is emptied once done, so it cannot say a session ended).
    if (claims.sid === undefined) return null;
    const session = await env.DB.prepare(
      `select 1 as found from "session" where id = ? and "userId" = ? limit 1`,
    )
      .bind(claims.sid, claims.sub)
      .first();
    if (!session) return null;
    role = await memberRole(env.DB, claims.ws, claims.sub);
  }
  if (role === undefined) return null;
  return {
    subject: claims.sub,
    iat: claims.iat,
    exp: claims.exp,
    claims: {
      role,
      ws: claims.ws,
      ...(claims.kind === undefined ? {} : { kind: claims.kind }),
      ...(claims.sid === undefined ? {} : { sid: claims.sid }),
      // An API token's creator, so the shard can close the sockets of every token acting for a member it changes.
      ...(by === undefined ? {} : { by }),
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
  functions: {
    workspace,
    sessions,
    members,
    events,
    paging,
    mailer,
    local,
    rest,
    invitations,
    devices,
    alerts,
    monitors,
    status,
    integrations,
    exports: dataExports,
    postmortems,
    clients,
  },
  basePath: EMBER_BASE_PATH,
  auth: brigadeEmberAuth,
});

/** The Ember paths a Brigade client uses: the socket and the HTTP query and mutation calls. Nothing else is served. */
const SERVED = new Set([
  `${EMBER_BASE_PATH}/ws`,
  `${EMBER_BASE_PATH}/api/query`,
  `${EMBER_BASE_PATH}/api/mutation`,
]);

/**
 * The most an HTTP call's body may hold: a Brigade mutation's arguments are a few kilobytes, and the shard is read from
 * the body before anything checks the caller, so the Worker never buffers more than this for anyone.
 */
export const EMBER_BODY_MAX = 256 * 1024;

/** The token the runtime will read from `request`, parsed as it does: `Authorization: Bearer` (any case), else `?token=`. */
function emberBearer(request: Request, url: URL): string | null {
  const header = request.headers.get("Authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() || null;
  return url.searchParams.get("token");
}

/** The workspace `shard` names (`workspace:<id>`), or undefined. */
function shardWorkspace(shard: unknown): string | undefined {
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
  const notFound = () => json({ error: "not_found" }, 404);
  if (url.pathname === `${EMBER_BASE_PATH}/ws`) {
    const workspaceId = shardWorkspace(url.searchParams.get("shard"));
    if (workspaceId === undefined || (await workspaceEngine(env.DB, workspaceId)) !== "ember") {
      return notFound();
    }
    return ember.fetch(request, env as never, ctx);
  }
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const body = await readBounded(request, EMBER_BODY_MAX);
  if (body === undefined) return json({ error: "payload_too_large" }, 413);
  let shard: unknown;
  try {
    shard = (JSON.parse(body) as { shard?: unknown } | null)?.shard;
  } catch {
    return notFound();
  }
  const workspaceId = shardWorkspace(shard);
  if (workspaceId === undefined || (await workspaceEngine(env.DB, workspaceId)) !== "ember") {
    return notFound();
  }
  // An API token's HTTP calls spend its per-token budget (RFC 0014), as its REST calls do. A socket's frames do not:
  // a socket is one exchange, as a Brigade Sync socket is today.
  const bearer = emberBearer(request, url);
  if (bearer !== null) {
    const claims = await verifyEmberToken(env.BETTER_AUTH_SECRET, bearer, Date.now());
    if (claims?.kind === "token" && !(await withinLimit(env.API_TOKEN_LIMIT, claims.sub))) {
      return json({ error: "rate_limited" }, 429, { "Retry-After": "60" });
    }
  }
  return ember.fetch(new Request(request, { method: "POST", body }), env as never, ctx);
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
  // A member's token names their session, which the hook checks in D1; only the dev actor (local runs) has none,
  // and it is not a member D1 backs, so it gets no token rather than one every call would refuse.
  if (actor.kind !== "token" && resolved.sessionId === undefined) {
    return json({ error: "unauthenticated" }, 401);
  }
  // The shard's own checks and upkeep, as a sync upgrade runs them on the DO (ember/clients.ts).
  let admitted: Awaited<ReturnType<typeof admitToEmber>>;
  try {
    admitted = await admitToEmber(
      env,
      workspaceId,
      {
        actor,
        ...(resolved.name !== undefined ? { name: resolved.name } : {}),
        ...(resolved.resetAt !== undefined ? { resetAt: resolved.resetAt } : {}),
      },
      waitUntil,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "admitting a client to Ember failed",
        workspaceId,
        error: String(error),
      }),
    );
    return json({ error: "unavailable" }, 503);
  }
  if (!admitted.ok) {
    const status = { not_found: 404, not_a_member: 403, unauthenticated: 401, unavailable: 503 };
    return json({ error: admitted.code }, status[admitted.code]);
  }
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
