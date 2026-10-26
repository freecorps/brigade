import { TOKEN } from "@freecorps/brigade-sync/protocol";
import {
  isId,
  isRole,
  parseHeartbeatToken,
  workspaceName,
  type MemberChange,
  type Role,
} from "@freecorps/brigade-schema";
import { ACTOR_HEADER, MEMBER_NAME_HEADER, memberRole, resolveActor } from "./actor.ts";
import {
  AUTH_BASE_PATH,
  createAuth,
  WORKSPACE_LIMIT_CODE,
  type Auth,
  type AuthBindings,
} from "./auth.ts";
import type { MemberChangeResult } from "./members.ts";
import { consumeDeadLetters, consumeEvents } from "./notify.ts";
import { WATCHDOG_NAME, type PagingHealth } from "./watchdog.ts";
import {
  IDEMPOTENCY_KEY_HEADER,
  ORGANIZATION_ID,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  type AckResult,
} from "./workspace.ts";

export { ProbeDO } from "./probe.ts";
export { WatchdogDO } from "./watchdog.ts";
export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;
const MEMBER_PATH = /^\/workspaces\/([^/]+)\/members\/([^/]+)$/;
/** A user id as Better Auth makes them here (`usr_<ULID>`), or older plain ids: no encoding, bounded. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ACK_PATH = /^\/workspaces\/([^/]+)\/incidents\/([^/]+)\/ack$/;
const SYNC_PATH = /^\/sync\/([^/]+)$/;
const HEARTBEAT_PATH = /^\/heartbeat\/([^/]+)$/;
const READ_METHODS = ["GET", "HEAD"];
/** Largest `POST /workspaces` body read, in bytes. */
const MAX_BODY_LENGTH = 4096;

/**
 * The organization plugin's routes the dashboard calls. Every other `/auth/organization/*` route (update, delete,
 * member roles, removing or adding members, invitations, teams, leaving) is refused: Better Auth would change D1
 * without the shard's copy of the members or a `workspace.*` / `member.*` event in its outbox (RFC 0005). Creating
 * goes through `POST /workspaces`; member roles, removing and leaving through `/workspaces/:id/members/:userId`.
 */
const ORGANIZATION_ROUTES = new Set([
  "/organization/get-full-organization",
  "/organization/get-active-member",
  "/organization/set-active",
  "/organization/list",
]);

/**
 * Other Better Auth routes refused. `/expo-authorization-proxy` (the `expo()` plugin's) redirects to any HTTPS URL it
 * is given, for social sign-in through the system browser; until that sign-in exists it would only be an open
 * redirect on Brigade's host.
 */
const REFUSED_ROUTES = new Set(["/expo-authorization-proxy"]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    // One Better Auth instance per request (its cookies depend on the request's protocol), made only once the
    // request needs it, so other routes skip its initialisation. test/auth.test.ts checks that a later request
    // never waits on an earlier one's instance.
    const auth = () => workerAuth(env, ctx, request);
    if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
      const route = pathname.slice(AUTH_BASE_PATH.length);
      if (
        (route.startsWith("/organization/") && !ORGANIZATION_ROUTES.has(route)) ||
        REFUSED_ROUTES.has(route)
      ) {
        return json({ error: "not_found" }, 404);
      }
      return auth().handler(request);
    }
    const sync = SYNC_PATH.exec(pathname)?.[1];
    if (sync !== undefined) return openSync(request, env, auth, sync);
    if (pathname === "/workspaces") return createWorkspace(request, auth);
    const member = MEMBER_PATH.exec(pathname);
    if (member) return changeMember(request, env, auth, member[1]!, member[2]!);
    const ack = ACK_PATH.exec(pathname);
    if (ack) return acknowledgeIncident(request, env, auth, ack[1]!, ack[2]!);
    const heartbeat = HEARTBEAT_PATH.exec(pathname)?.[1];
    if (heartbeat !== undefined) return receiveHeartbeat(request, env, heartbeat);

    if (pathname === "/health/paging") return pagingHealth(request, env, auth);

    const workspace = WORKSPACE_PATH.exec(pathname)?.[1];
    if (pathname !== "/health" && workspace === undefined) return json({ error: "not_found" }, 404);
    if (!READ_METHODS.includes(request.method)) {
      return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
    }

    if (workspace === undefined) return json({ ok: true });
    // Checked before any decoding: the charset has no `%`, so encoded or malformed input is rejected.
    if (!WORKSPACE_ID.test(workspace)) return json({ error: "invalid_workspace_id" }, 400);
    // Dev-only placeholder with no auth: it must sit behind auth (or be removed) before any route
    // or workers_dev is enabled.
    try {
      const info = await env.WORKSPACE.getByName(workspace).info();
      return json({ workspace, ...info });
    } catch (error) {
      return failed("WorkspaceDO.info failed", workspace, error);
    }
  },

  /**
   * `brigade-events` (RFC 0005): the shards' drained outboxes, routed to notifiers (src/notify.ts); and its
   * dead-letter queue, `brigade-events-dlq`, where what the first gave up on is recorded.
   */
  async queue(batch, env): Promise<void> {
    if (batch.queue.startsWith("brigade-events-dlq")) await consumeDeadLetters(batch, env);
    else await consumeEvents(batch, env);
  },

  /**
   * The dead-man switch's clock (RFC 0007 "Watching the watcher"): one heartbeat a minute into the watchdog's outbox
   * (src/watchdog.ts). A failure throws, so the Cron Trigger's past events show it, and the silence it leaves trips
   * the external check.
   */
  async scheduled(_controller, env): Promise<void> {
    await env.WATCHDOG.getByName(WATCHDOG_NAME).beat();
  },
} satisfies ExportedHandler<Env>;

/**
 * `GET /health/paging`: whether the paging pipeline proved itself lately (src/watchdog.ts), for the dashboard. Never a
 * URL or an id, and trimmed by who asks (`pagingHealthFor`). Answers 503 when the watchdog itself cannot be reached,
 * which is also degraded.
 */
export async function pagingHealth(
  request: Request,
  env: Env,
  auth: () => Auth,
): Promise<Response> {
  if (!READ_METHODS.includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
  }
  let health: PagingHealth;
  try {
    health = await env.WATCHDOG.getByName(WATCHDOG_NAME).health();
  } catch (error) {
    console.error(JSON.stringify({ message: "WatchdogDO.health failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  // D1 or the session failing degrades the answer to `{ status }`, the same as no session, rather than a 500.
  let roles: Role[] = [];
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (session) roles = await memberRoles(env.DB, session.user.id);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "paging health: session lookup failed", error: String(error) }),
    );
  }
  return json(pagingHealthFor(health, roles), 200, {
    // Varies by the session's cookie, so no shared cache may keep it.
    "Cache-Control": "private, no-store",
  });
}

/**
 * What `GET /health/paging` shows, by the asker's roles across workspaces. The pipeline is one per instance, so no
 * single workspace owns it:
 * - no session, or no workspace: `{ status }` only, like `/health`; why and since when would tell an outsider when
 *   pages stop going out;
 * - any member: the reasons and times too, since a responder needs to know they may not be paged.
 * `external` (whether the dead-man check is set up and answering) is never sent: it is the instance operator's
 * business, and with open sign-up any user can own a workspace, so no workspace role can stand in for that operator
 * (Q19). Operators read it in the logs.
 */
export function pagingHealthFor(
  health: PagingHealth,
  roles: readonly Role[],
): Pick<PagingHealth, "status"> & Partial<PagingHealth> {
  if (roles.length === 0) return { status: health.status };
  const { external: _external, ...rest } = health;
  return rest;
}

/** The user's Brigade roles in every workspace they belong to (empty when none). */
async function memberRoles(db: D1Database, userId: string): Promise<Role[]> {
  const { results } = await db
    .prepare(`select role from member where "userId" = ?`)
    .bind(userId)
    .all<{ role: string }>();
  // Better Auth stores several roles comma-separated; Brigade gives each member one, as `memberRole` reads it.
  return results.map((row) => row.role).filter(isRole);
}

/**
 * Better Auth on this Worker's D1 for one request; a new workspace gets its shard provisioned right away.
 * `onWorkspaceCreated` replaces the provisioning (the tests make it fail).
 */
export function workerAuth(
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  request: Request,
  onWorkspaceCreated?: AuthBindings["onWorkspaceCreated"],
): Auth {
  return createAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    waitUntil: (promise) => ctx.waitUntil(promise),
    // The web Worker forwards with the browser's URL, so this is the protocol the browser used.
    secureCookies: new URL(request.url).protocol === "https:",
    onWorkspaceCreated: onWorkspaceCreated ?? provisionWith(env),
  });
}

function provisionWith(env: Env): NonNullable<AuthBindings["onWorkspaceCreated"]> {
  return async ({ id, name, ownerId }) => {
    const result = await env.WORKSPACE.getByName(id).provision(
      { id, name },
      { kind: "user", id: ownerId, role: "owner" },
    );
    if (!result.ok) throw new Error(`Provisioning workspace ${id} failed: ${result.code}`);
  };
}

/**
 * `POST /workspaces` `{ name }`: creates a workspace for the signed-in user, who becomes its owner, and makes
 * it the session's active workspace. Better Auth writes the organization and the membership to D1; its
 * `afterCreateOrganization` hook provisions the shard (`workspace.created` in its outbox); if that fails, the
 * workspace is deleted again and this answers 500.
 */
export async function createWorkspace(request: Request, lazyAuth: () => Auth): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  // A cookie-authenticated write: refuse other sites (Better Auth does the same on its own routes).
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const auth = lazyAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  const text = await readBounded(request, MAX_BODY_LENGTH);
  if (text === undefined) return json({ error: "invalid_args" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_args" }, 400);
  }
  const name = workspaceName(
    typeof body === "object" && body !== null ? Reflect.get(body, "name") : undefined,
    "name",
  );
  if (!name.ok) return json({ error: "invalid_args", issues: name.issues }, 400);

  try {
    const workspace = await auth.api.createOrganization({
      // The slug is only a unique handle for now; the id names the shard.
      body: { name: name.value, slug: `ws-${crypto.randomUUID()}` },
      headers: request.headers,
    });
    if (!workspace) return json({ error: "internal" }, 500);
    return json({ id: workspace.id, name: workspace.name }, 201);
  } catch (error) {
    if (Reflect.get(Object(Reflect.get(Object(error), "body")), "code") === WORKSPACE_LIMIT_CODE) {
      return json({ error: "workspace_limit" }, 403);
    }
    console.error(JSON.stringify({ message: "Creating a workspace failed", error: String(error) }));
    return json({ error: "internal" }, 500);
  }
}

/**
 * `PATCH /workspaces/:id/members/:userId` `{ role }` changes a member's role; `DELETE` removes them, or, for one's
 * own id, leaves the workspace (RFC 0003 "Members"). The Worker checks the origin, the session and that the caller
 * is a member; the workspace's shard checks the rules against D1, writes D1, then its own copy and the outbox, and
 * closes the member's sockets (src/members.ts). `not_applied` (503): D1 has the change and the shard not yet; the
 * shard's alarm reconciles it within seconds, and the same request again finishes it sooner.
 */
export async function changeMember(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "PATCH, DELETE" });
  }
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  if (!USER_ID.test(userId)) return json({ error: "not_found" }, 404);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  let change: MemberChange = { kind: "remove" };
  if (request.method === "PATCH") {
    const text = await readBounded(request, MAX_BODY_LENGTH);
    let body: unknown;
    try {
      body = text === undefined ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    const role = typeof body === "object" && body !== null ? Reflect.get(body, "role") : undefined;
    if (!isRole(role)) return json({ error: "invalid_args" }, 400);
    change = { kind: "role", role };
  }

  // Checked here first, so a made-up workspace or an outsider never wakes (or creates) a shard. One exception: a
  // leave D1 already has but the shard missed (`not_applied`) may be sent again by the leaver, so they stop being
  // paged without waiting for the shard's repair; the shard finishes it only if it still has their copy or devices.
  // Every other answer to a non-member is the same 403, whether or not the workspace exists (open question Q16).
  // The leave retry does take longer for a workspace that exists (it asks the shard); that is safe only because a
  // workspace id is a ULID nobody can guess, which `ORGANIZATION_ID` holds this route to.
  let member: boolean;
  try {
    member = (await memberRole(env.DB, workspaceId, session.user.id)) !== undefined;
    if (!member) {
      const retryingLeave =
        request.method === "DELETE" &&
        userId === session.user.id &&
        (await workspaceExists(env.DB, workspaceId));
      if (!retryingLeave) return json({ error: "not_a_member" }, 403);
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  let result: MemberChangeResult;
  try {
    const shard = env.WORKSPACE.getByName(workspaceId);
    result = member
      ? await shard.changeMember(workspaceId, session.user.id, userId, change)
      : await shard.finishLeave(workspaceId, session.user.id);
  } catch (error) {
    return failed("WorkspaceDO.changeMember failed", workspaceId, error);
  }
  if (result.ok) return json({ ok: true });
  if (!member && (result.code === "not_found" || result.code === "forbidden")) {
    return json({ error: "not_a_member" }, 403);
  }
  const status = {
    forbidden: 403,
    not_found: 404,
    last_owner: 409,
    conflict: 409,
    unavailable: 503,
    not_applied: 503,
  }[result.code];
  return json({ error: result.code }, status);
}

/**
 * `POST /workspaces/:id/incidents/:incidentId/ack` with an `Idempotency-Key`: acknowledges the incident as the
 * signed-in member, for the app's notification action (RFC 0004 "Clients": plain HTTPS, since iOS suspends sockets
 * in the background). Authenticated like the sync upgrade (the session's cookie, then the member's role in D1) and
 * refused from another site like every cookie-authenticated write; the shard runs `incident.ack` as that member,
 * with its RBAC and its event through the outbox (`WorkspaceDO.acknowledge`). The same key again answers what the
 * first request did, so a retry after a lost answer is not reported as someone else's ack. Answers:
 * 200 acknowledged; 409 `conflict` already acknowledged (by anyone); 409 `invalid_transition` the incident is no
 * longer active; 404 no such incident; 403 `forbidden` (a viewer) or `not_a_member`; 401 without a session.
 */
export async function acknowledgeIncident(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  incidentId: string,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  // The charset has no `%`, so nothing here is decoded.
  if (!isId("inc", incidentId)) return json({ error: "not_found" }, 404);
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (key === null || !TOKEN.test(key)) return json({ error: "invalid_args" }, 400);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  // Checked here first, so a made-up workspace or an outsider never wakes (or creates) a shard.
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (role === undefined) return json({ error: "not_a_member" }, 403);

  let result: AckResult;
  try {
    result = await env.WORKSPACE.getByName(workspaceId).acknowledge(
      workspaceId,
      { kind: "user", id: session.user.id, role },
      incidentId,
      key,
    );
  } catch (error) {
    return failed("WorkspaceDO.acknowledge failed", workspaceId, error);
  }
  if (result.ok) return json({ ok: true });
  const status = ACK_STATUS[result.code];
  return json({ error: status === undefined ? "internal" : result.code }, status ?? 500);
}

/** The answer for each refusal of an ack; anything else (`internal`, `unknown_mutation`) is a 500. */
const ACK_STATUS: Partial<Record<Exclude<AckResult, { ok: true }>["code"], number>> = {
  conflict: 409,
  invalid_transition: 409,
  not_found: 404,
  forbidden: 403,
  not_a_member: 403,
  invalid_args: 400,
};

/**
 * `GET /sync/:workspaceId` with `Upgrade: websocket`: hands the socket to the workspace's shard (RFC 0004
 * "Socket topology"). The Worker authenticates the upgrade (`resolveActor`: 401 without a session, 403 for a
 * non-member or another site's page) and forwards a request it builds itself, carrying only the upgrade, the
 * workspace id and the verified actor (with the member's name), so no client header reaches the shard.
 */
async function openSync(
  request: Request,
  env: Env,
  auth: () => Auth,
  workspace: string,
): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!WORKSPACE_ID.test(workspace)) return json({ error: "invalid_workspace_id" }, 400);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "upgrade_required" }, 426, { Upgrade: "websocket" });
  }
  const resolved = await resolveActor(request, env, auth, workspace);
  if (!resolved.ok) return resolved.response;
  // The shard is named by the workspace id alone; entity shards will be `${workspaceId}:${entityId}`.
  const headers = new Headers({
    Upgrade: "websocket",
    [WORKSPACE_HEADER]: workspace,
    [ACTOR_HEADER]: JSON.stringify(resolved.actor),
  });
  if (resolved.name !== undefined) {
    headers.set(MEMBER_NAME_HEADER, encodeURIComponent(resolved.name));
  }
  try {
    return await env.WORKSPACE.getByName(workspace).fetch(request.url, { headers });
  } catch (error) {
    return failed("WorkspaceDO sync upgrade failed", workspace, error);
  }
}

/**
 * `POST /heartbeat/:token`: a heartbeat monitor's ping (RFC 0007). The token names the workspace and the monitor
 * and carries the secret; the shard compares the secret's SHA-256 with the stored one in constant time. The
 * workspace is looked up in D1 first (`workspaceExists`), so a token for a made-up workspace never wakes, let alone
 * creates, a shard (open question Q16); if D1 itself fails, the ping goes to the shard anyway. Every refusal is the same 404, so a caller cannot tell a wrong secret from a
 * missing monitor or workspace. The body is never read.
 */
export async function receiveHeartbeat(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const parsed = parseHeartbeatToken(token);
  if (!parsed || !WORKSPACE_ID.test(parsed.workspaceId)) return json({ error: "not_found" }, 404);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed.secret));
  try {
    if (!(await workspaceExists(env.DB, parsed.workspaceId))) {
      return json({ error: "not_found" }, 404);
    }
  } catch (error) {
    // Fail open: a D1 outage must not drop a real ping and page someone for a missed beat. The shard still
    // checks the secret, so the worst a made-up workspace costs meanwhile is one empty shard.
    console.error(
      JSON.stringify({
        message: "workspace lookup failed; asking the shard",
        workspace: parsed.workspaceId,
        error: String(error),
      }),
    );
  }
  try {
    const accepted = await env.WORKSPACE.getByName(parsed.workspaceId).heartbeat(
      parsed.monitorId,
      digest,
    );
    return accepted ? json({ ok: true }, 202) : json({ error: "not_found" }, 404);
  } catch (error) {
    return failed("WorkspaceDO.heartbeat failed", parsed.workspaceId, error);
  }
}

/** Workspaces seen in D1, per isolate, until the time they expire: a ping a minute is not a D1 read a minute. */
const knownWorkspaces = new Map<string, number>();
const KNOWN_WORKSPACE_MS = 10 * 60 * 1000;
const KNOWN_WORKSPACES_MAX = 10_000;

/**
 * Whether a Better Auth organization (a workspace) has this id. Only a hit is cached: a made-up id costs one
 * indexed D1 read, and no Durable Object.
 */
export async function workspaceExists(
  db: D1Database,
  id: string,
  now = Date.now(),
): Promise<boolean> {
  const expires = knownWorkspaces.get(id);
  if (expires !== undefined && expires > now) return true;
  const row = await db
    .prepare('select 1 as found from "organization" where "id" = ?')
    .bind(id)
    .first();
  if (!row) {
    knownWorkspaces.delete(id);
    return false;
  }
  // Oldest first: a Map iterates in insertion order.
  if (knownWorkspaces.size >= KNOWN_WORKSPACES_MAX) {
    knownWorkspaces.delete(knownWorkspaces.keys().next().value!);
  }
  knownWorkspaces.delete(id);
  knownWorkspaces.set(id, now + KNOWN_WORKSPACE_MS);
  return true;
}

/**
 * The body as text, or undefined once it passes `max` bytes: a declared `Content-Length` over the limit is refused
 * unread, and a stream (no length, or a wrong one) is read only up to the limit.
 */
async function readBounded(request: Request, max: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function failed(message: string, workspace: string, error: unknown): Response {
  const retryable = flag(error, "retryable");
  const overloaded = flag(error, "overloaded");
  console.error(
    JSON.stringify({ message, workspace, retryable, overloaded, error: String(error) }),
  );
  return retryable || overloaded
    ? json({ error: "unavailable" }, 503)
    : json({ error: "internal" }, 500);
}

/** Durable Object errors carry boolean `retryable` / `overloaded` properties. */
function flag(error: unknown, name: "retryable" | "overloaded"): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    name in error &&
    Reflect.get(error, name) === true
  );
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
