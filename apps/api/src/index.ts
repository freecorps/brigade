export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET") return notFound();

    if (pathname === "/health") return Response.json({ ok: true });

    const match = WORKSPACE_PATH.exec(pathname);
    if (match) {
      // Checked before any decoding: the charset has no `%`, so encoded or malformed input is rejected.
      const workspace = match[1]!;
      if (!WORKSPACE_ID.test(workspace)) {
        return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
      }
      const info = await env.WORKSPACE.getByName(workspace).info();
      return Response.json({ workspace, ...info });
    }

    return notFound();
  },
} satisfies ExportedHandler<Env>;

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}
