// Exports to R2 (RFC 0013 "Exports"). `POST /workspaces/:id/exports` (owners and admins) has the shard build the JSON
// file in parts (`WorkspaceDO.buildExport`: the hourly limit, then one incident at a time up to `MAX_EXPORT_BYTES`),
// streams the parts into the `EXPORTS` bucket under the workspace's prefix and has the shard record it
// (`export.record`, its event through the outbox). `GET /workspaces/:id/exports/:exportId` streams it
// back to an owner or admin: the bucket is never public. A file lasts `EXPORT_TTL_MS`: the download refuses an
// expired one and deletes it, the cron's hourly sweep deletes the rest (`sweepExports`), and the bucket's lifecycle
// rule is the backstop (apps/api/README.md "Exports"). Without the binding every route answers 503.

import {
  can,
  EXPORT_TTL_MS,
  exportScope,
  isId,
  MAX_EXPORT_BYTES,
  type ExportScope,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { checkMember, json, readJson } from "./member-route.ts";

export { MAX_EXPORT_BYTES };
/** Objects one R2 list call of the sweep reads (the most R2 lists, and deletes, at once). */
const SWEEP_PAGE = 1000;
/** How long one sweep may page through the bucket; whatever it does not reach waits for the next hour. */
const SWEEP_BUDGET_MS = 20_000;

export type ExportEnv = { EXPORTS?: R2Bucket };

/** The object key of an export: every workspace's files under their own prefix. */
export const exportKey = (workspaceId: string, exportId: string) =>
  `workspaces/${workspaceId}/exports/${exportId}.json`;

/** What `WorkspaceDO.buildExport` answers: the export's id and the file as UTF-8 parts, in order, or why not. */
export type BuiltExport =
  | { ok: true; id: string; parts: Uint8Array[]; bytes: number; incidents: number }
  | { ok: false; code: string };

/** `limit_reached`: a range over `MAX_EXPORT_INCIDENTS`; `rate_limited`: past `EXPORTS_PER_HOUR`. */
const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_a_member: 403,
  limit_reached: 413,
  too_large: 413,
  rate_limited: 429,
  invalid_args: 400,
};

/** `POST /workspaces/:id/exports`, body `{ scope }`: 201 `{ id, expiresAt, incidents, bytes }`. */
export async function createExport(
  request: Request,
  env: Env & ExportEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
): Promise<Response> {
  const member = await checkMember(request, env, lazyAuth, workspaceId, ["POST"]);
  if (!member.ok) return member.response;
  // Checked before the shard wakes: responders and viewers never export.
  if (!can(member.actor.role, "data:export")) return json({ error: "forbidden" }, 403);
  const bucket = env.EXPORTS;
  if (!bucket) return json({ error: "exports_unavailable" }, 503);
  const body = await readJson(request);
  const scope = exportScope((body as { scope?: unknown } | undefined)?.scope, "scope");
  if (!scope.ok) return json({ error: "invalid_args", issues: scope.issues }, 400);
  const shard = env.WORKSPACE.getByName(workspaceId);
  let built: BuiltExport;
  try {
    built = await shard.buildExport(workspaceId, member.actor, scope.value);
  } catch (error) {
    return failed("WorkspaceDO.buildExport failed", workspaceId, error);
  }
  if (!built.ok) return json({ error: built.code }, STATUS[built.code] ?? 500);
  const { id, parts, bytes } = built;
  const key = exportKey(workspaceId, id);
  const expiresAt = Date.now() + EXPORT_TTL_MS;
  try {
    // The parts stream into R2 as they are: the file is never joined into one string or buffer here either.
    const { readable, writable } = new FixedLengthStream(bytes);
    const writing = (async () => {
      const writer = writable.getWriter();
      for (const part of parts) await writer.write(part);
      await writer.close();
    })();
    await Promise.all([
      bucket.put(key, readable, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { expiresAt: String(expiresAt), createdBy: member.actor.id },
      }),
      writing,
    ]);
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    return failed("writing an export failed", workspaceId, error);
  }
  let recorded: { ok: boolean; code?: string };
  try {
    recorded = await shard.recordExport(workspaceId, member.actor, {
      id,
      scope: scope.value,
      incidents: built.incidents,
      bytes,
    });
  } catch (error) {
    recorded = { ok: false, code: String(error) };
  }
  if (!recorded.ok) {
    // Never a file nobody recorded: every export is an event (RFC 0005).
    await bucket.delete(key).catch(() => undefined);
    console.error(
      JSON.stringify({ message: "recording an export failed", workspaceId, code: recorded.code }),
    );
    return json({ error: "unavailable" }, 503);
  }
  return json({ id, expiresAt, incidents: built.incidents, bytes }, 201);
}

/** `GET /workspaces/:id/exports/:exportId`: the file, streamed from R2 as an attachment. */
export async function downloadExport(
  request: Request,
  env: Env & ExportEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  lazyAuth: () => Auth,
  workspaceId: string,
  exportId: string,
): Promise<Response> {
  const member = await checkMember(request, env, lazyAuth, workspaceId, ["GET"]);
  if (!member.ok) return member.response;
  if (!can(member.actor.role, "data:export")) return json({ error: "forbidden" }, 403);
  const bucket = env.EXPORTS;
  if (!bucket) return json({ error: "exports_unavailable" }, 503);
  if (!isId("exp", exportId)) return json({ error: "not_found" }, 404);
  const key = exportKey(workspaceId, exportId);
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch (error) {
    return failed("reading an export failed", workspaceId, error);
  }
  if (!object) return json({ error: "not_found" }, 404);
  if (expired(object, Date.now())) {
    await object.body.cancel().catch(() => undefined);
    ctx.waitUntil(bucket.delete(key).catch(() => undefined));
    return json({ error: "expired" }, 410);
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="brigade-export-${exportId}.json"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Past its `expiresAt` (or, without one, `EXPORT_TTL_MS` after it was uploaded). */
function expired(object: Pick<R2Object, "customMetadata" | "uploaded">, now: number): boolean {
  const at = Number(object.customMetadata?.expiresAt);
  const expiresAt = Number.isFinite(at) && at > 0 ? at : object.uploaded.getTime() + EXPORT_TTL_MS;
  return expiresAt <= now;
}

/**
 * Deletes expired exports (the cron, once an hour): pages through `workspaces/` with R2's cursor, `SWEEP_PAGE` objects
 * a call, for at most `SWEEP_BUDGET_MS`; returns how many it deleted. An object's age is its `uploaded` time, which
 * every listing carries (its `expiresAt` metadata would cost a larger listing). The bucket's lifecycle rule catches
 * whatever it does not reach.
 */
export async function sweepExports(
  bucket: R2Bucket,
  now: number,
  budgetMs = SWEEP_BUDGET_MS,
): Promise<number> {
  const started = Date.now();
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const listed = await bucket.list({ prefix: "workspaces/", limit: SWEEP_PAGE, cursor });
    const gone = listed.objects
      .filter((object) => object.uploaded.getTime() + EXPORT_TTL_MS <= now)
      .map((object) => object.key);
    if (gone.length > 0) await bucket.delete(gone);
    deleted += gone.length;
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor !== undefined && Date.now() - started < budgetMs);
  return deleted;
}

/** Whether this deployment can draft with AI and export, for the dashboard (`GET /features`, signed in). */
export async function features(
  request: Request,
  env: Env & ExportEnv & { AI?: unknown },
  lazyAuth: () => Auth,
): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  try {
    const session = await lazyAuth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
  } catch {
    return json({ error: "unavailable" }, 503);
  }
  return json({ ai: env.AI !== undefined, exports: env.EXPORTS !== undefined }, 200, {
    "Cache-Control": "private, no-store",
  });
}

function failed(message: string, workspaceId: string, error: unknown): Response {
  console.error(JSON.stringify({ message, workspaceId, error: String(error) }));
  return json({ error: "unavailable" }, 503);
}

export type { ExportScope };
