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
    try {
      const info = await env.WORKSPACE.getByName(workspace).info();
      return json({ workspace, ...info });
    } catch (error) {
      console.error(JSON.stringify({ message: "WorkspaceDO.info failed", error: String(error) }));
      // Overloaded objects must not be retried; other retryable errors are transient.
      return isUnavailable(error)
        ? json({ error: "unavailable" }, 503)
        : json({ error: "internal" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function isUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (
    ("retryable" in error && error.retryable === true) ||
    ("overloaded" in error && error.overloaded === true)
  );
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
