// The operator routes of the migration to Ember (RFC 0016 "Data migration"; src/ember-migration.ts), served only when
// the `MIGRATION_TOKEN` secret is set and sent as `Authorization: Bearer`; otherwise every path here is a 404, as if
// the routes did not exist. Not for members: no workspace role stands in for the instance's operator.
//
//   GET  /admin/ember/workspaces?after=<id>   every workspace in D1 with its engine, 500 at a time, in id order
//   POST /admin/ember/copy/:workspaceId       copy and check (can run again)
//   POST /admin/ember/switch/:workspaceId     freeze the DO, copy again, arm the ticks, then D1 says `ember`
//   POST /admin/ember/back/:workspaceId       D1 says `brigade` again, and the DO holds the workspace as at the copy

import { same } from "./alert-intake.ts";
import { backWorkspace, copyWorkspace, switched, switchWorkspace } from "./ember-migration.ts";
import { WORKSPACE_ID } from "./workspace.ts";

export const ADMIN_BASE = "/admin/ember";
const ACTION = /^\/admin\/ember\/(copy|switch|back)\/([^/]+)$/;
const LIST_LIMIT = 500;

type AdminEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD"> & { MIGRATION_TOKEN?: string };

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const notFound = () => json({ error: "not_found" }, 404);

async function authorized(request: Request, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const sent = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!sent) return false;
  const digest = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return same(await digest(sent), await digest(token));
}

/** Serves `/admin/ember/*`. */
export async function serveMigration(
  request: Request,
  env: AdminEnv,
  pathname: string,
): Promise<Response> {
  if (!(await authorized(request, env.MIGRATION_TOKEN))) return notFound();
  const log = (message: string, fields: Record<string, unknown>) =>
    console.error(JSON.stringify({ message, ...fields }));
  if (pathname === `${ADMIN_BASE}/workspaces`) {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    const after = new URL(request.url).searchParams.get("after") ?? "";
    const { results } = await env.DB.prepare(
      `select o.id as id, coalesce(e.engine, 'brigade') as engine
       from organization o left join workspace_engine e on e."workspaceId" = o.id
       where o.id > ? order by o.id limit ?`,
    )
      .bind(after, LIST_LIMIT)
      .all<{ id: string; engine: string }>();
    return json({
      workspaces: results,
      next: results.length === LIST_LIMIT ? results.at(-1)!.id : null,
    });
  }
  const match = ACTION.exec(pathname);
  if (!match) return notFound();
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const [, action, workspaceId] = match as unknown as [string, "copy" | "switch" | "back", string];
  if (!WORKSPACE_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  try {
    if (action === "copy") {
      // On Ember already: its shard is live, and a copy would overwrite what was written there since.
      if (await switched(env, workspaceId)) return json({ error: "already_switched" }, 409);
      return json(await copyWorkspace(env, workspaceId));
    }
    if (action === "switch") {
      const result = await switchWorkspace(env, workspaceId);
      log("workspace switch to Ember", { workspace: workspaceId, ok: result.ok });
      return json(result, result.ok ? 200 : result.code === "not_found" ? 404 : 409);
    }
    await backWorkspace(env, workspaceId);
    log("workspace turned back to WorkspaceDO", { workspace: workspaceId });
    return json({ ok: true });
  } catch (error) {
    log("migration step failed", { action, workspace: workspaceId, error: String(error) });
    return json({ error: "unavailable", message: String(error) }, 503);
  }
}
