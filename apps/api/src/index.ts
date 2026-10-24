import { syncActor, syncUnavailable, WORKSPACE_HEADER, WORKSPACE_ID } from "./workspace.ts";

export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;
const SYNC_PATH = /^\/sync\/([^/]+)$/;
const READ_METHODS = ["GET", "HEAD"];

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    const sync = SYNC_PATH.exec(pathname)?.[1];
    if (sync !== undefined) return openSync(request, env, sync);

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
 * `GET /sync/:workspaceId` with `Upgrade: websocket`: hands the socket to the workspace's shard (RFC 0004).
 * Dev-only placeholder with no auth, like `/workspaces/:id`: every socket acts as `DEV_ACTOR`, and only where
 * `SYNC_DEV_ACTOR` is "1" (the `dev` environment, local runs); elsewhere the upgrade gets 501.
 *
 * TODO(auth, RFC 0003): before any route or workers_dev is enabled, authenticate the upgrade (Better Auth session
 * or bearer token), check membership and role in the workspace, and pass the actor to the shard in a signed
 * header. Browsers send cookies on a cross-site WebSocket upgrade and CORS does not apply to it, so a
 * cookie-authenticated upgrade must also check `Origin` against the dashboard's origins (cross-site WebSocket
 * hijacking).
 */
async function openSync(request: Request, env: Env, workspace: string): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!WORKSPACE_ID.test(workspace)) return json({ error: "invalid_workspace_id" }, 400);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "upgrade_required" }, 426, { Upgrade: "websocket" });
  }
  if (!syncActor(env)) return syncUnavailable();
  // The shard is named by the workspace id alone; entity shards will be `${workspaceId}:${entityId}`.
  const headers = new Headers(request.headers);
  headers.set(WORKSPACE_HEADER, workspace);
  try {
    return await env.WORKSPACE.getByName(workspace).fetch(new Request(request, { headers }));
  } catch (error) {
    return failed("WorkspaceDO sync upgrade failed", workspace, error);
  }
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
