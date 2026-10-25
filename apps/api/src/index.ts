import { parseHeartbeatToken, workspaceName } from "@freecorps/brigade-schema";
import { ACTOR_HEADER, resolveActor } from "./actor.ts";
import {
  AUTH_BASE_PATH,
  createAuth,
  WORKSPACE_LIMIT_CODE,
  type Auth,
  type AuthBindings,
} from "./auth.ts";
import { WORKSPACE_HEADER, WORKSPACE_ID } from "./workspace.ts";

export { ProbeDO } from "./probe.ts";
export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;
const SYNC_PATH = /^\/sync\/([^/]+)$/;
const HEARTBEAT_PATH = /^\/heartbeat\/([^/]+)$/;
const READ_METHODS = ["GET", "HEAD"];
/** Largest `POST /workspaces` body read, in bytes. */
const MAX_BODY_LENGTH = 4096;

/**
 * The organization plugin's routes the dashboard calls. Every other `/auth/organization/*` route (update, delete,
 * member roles, removing or adding members, invitations, teams, leaving) is refused until it emits its
 * `workspace.*` / `member.*` event through the shard's outbox (RFC 0005); creating goes through `POST /workspaces`.
 */
const ORGANIZATION_ROUTES = new Set([
  "/organization/get-full-organization",
  "/organization/get-active-member",
  "/organization/set-active",
  "/organization/list",
]);

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    // One Better Auth instance per request (its cookies depend on the request's protocol), made only once the
    // request needs it, so other routes skip its initialisation. test/auth.test.ts checks that a later request
    // never waits on an earlier one's instance.
    const auth = () => workerAuth(env, ctx, request);
    if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
      const route = pathname.slice(AUTH_BASE_PATH.length);
      if (route.startsWith("/organization/") && !ORGANIZATION_ROUTES.has(route)) {
        return json({ error: "not_found" }, 404);
      }
      return auth().handler(request);
    }
    const sync = SYNC_PATH.exec(pathname)?.[1];
    if (sync !== undefined) return openSync(request, env, auth, sync);
    if (pathname === "/workspaces") return createWorkspace(request, auth);
    const heartbeat = HEARTBEAT_PATH.exec(pathname)?.[1];
    if (heartbeat !== undefined) return receiveHeartbeat(request, env, heartbeat);

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
} satisfies ExportedHandler<Env>;

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
 * `GET /sync/:workspaceId` with `Upgrade: websocket`: hands the socket to the workspace's shard (RFC 0004
 * "Socket topology"). The Worker authenticates the upgrade (`resolveActor`: 401 without a session, 403 for a
 * non-member or another site's page) and forwards a request it builds itself, carrying only the upgrade, the
 * workspace id and the verified actor, so no client header reaches the shard.
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
