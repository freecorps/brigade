export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;
const READ_METHODS = ["GET", "HEAD"];

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
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
      const retryable = flag(error, "retryable");
      const overloaded = flag(error, "overloaded");
      console.error(
        JSON.stringify({
          message: "WorkspaceDO.info failed",
          workspace,
          retryable,
          overloaded,
          error: String(error),
        }),
      );
      return retryable || overloaded
        ? json({ error: "unavailable" }, 503)
        : json({ error: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

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
