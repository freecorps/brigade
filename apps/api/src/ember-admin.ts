// The operator routes of the migration to Ember (RFC 0016 "Data migration"; src/ember-migration.ts), served only when
// the `MIGRATION_TOKEN` secret is set and sent as `Authorization: Bearer`; otherwise every path here is a 404, as if
// the routes did not exist. Not for members: no workspace role stands in for the instance's operator.
//
//   GET  /admin/ember/workspaces?after=<id>   every workspace in D1 with its engine, 500 at a time, in id order
//   POST /admin/ember/copy/:workspaceId       copy and check (can run again)
//   POST /admin/ember/switch/:workspaceId     freeze the DO, copy again, arm the ticks, then D1 says `ember`; refused
//                                             (409 `too_large`) past `READ_CAP_GUARD` rows in a table, unless ?force=1
//   POST /admin/ember/back/:workspaceId       D1 says `brigade` again, and the DO holds the workspace as at the copy
//   POST /admin/ember/auth/import?after=<id>  D1's users and accounts into the Auth object (RFC 0017 step 4), up to
//                                             `IMPORT_PAGES` pages; `next` to go on from, also on a failure (can run again)

import { same } from "./alert-intake.ts";
import { importAuthPage } from "./auth-ember.ts";
import {
  AlreadySwitched,
  backWorkspace,
  copyWorkspace,
  switched,
  switchWorkspace,
} from "./ember-migration.ts";
import { WORKSPACE_ID } from "./workspace.ts";

export const ADMIN_BASE = "/admin/ember";
const ACTION = /^\/admin\/ember\/(copy|switch|back)\/([^/]+)$/;
const LIST_LIMIT = 500;
/** Pages of users one import request copies (`IMPORT_PAGE` each), well inside a request's subrequests. */
export const IMPORT_PAGES = 25;

type AdminEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD" | "AUTH"> & { MIGRATION_TOKEN?: string };

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
  if (pathname === `${ADMIN_BASE}/auth/import`) {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    let after = new URL(request.url).searchParams.get("after") ?? "";
    const total = { users: 0, accounts: 0, skipped: 0 };
    try {
      for (let page = 0; page < IMPORT_PAGES; page++) {
        const result = await importAuthPage(env, after);
        if (!result.ok) {
          log("auth import refused", { after, error: result.error });
          // `next`: where to go on from once it is fixed, as every answer names it.
          return json({ ok: false, error: result.error, ...total, next: after }, 422);
        }
        total.users += result.users;
        total.accounts += result.accounts;
        total.skipped += result.skipped;
        if (result.next === null) {
          log("auth import done", total);
          return json({ ok: true, ...total, next: null });
        }
        after = result.next;
      }
      return json({ ok: true, ...total, next: after });
    } catch (error) {
      log("auth import failed", { after, error: String(error) });
      return json({ error: "unavailable", message: String(error), ...total, next: after }, 503);
    }
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
      try {
        return json(await copyWorkspace(env, workspaceId, { standalone: true }));
      } catch (error) {
        if (error instanceof AlreadySwitched) return json({ error: "already_switched" }, 409);
        throw error;
      }
    }
    if (action === "switch") {
      const force = new URL(request.url).searchParams.get("force") === "1";
      const result = await switchWorkspace(env, workspaceId, { force });
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
