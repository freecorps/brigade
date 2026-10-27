// Exports to R2 (RFC 0013 "Exports"). `POST /workspaces/:id/exports` (owners and admins) has the shard build the JSON
// file (`buildExport`, packages/schema), writes it to the `EXPORTS` bucket under the workspace's prefix and has the
// shard record it (`export.record`, its event through the outbox). `GET /workspaces/:id/exports/:exportId` streams it
// back to an owner or admin: the bucket is never public. A file lasts `EXPORT_TTL_MS`: the download refuses an
// expired one and deletes it, the cron's hourly sweep deletes the rest (`sweepExports`), and the bucket's lifecycle
// rule is the backstop (apps/api/README.md "Exports"). Without the binding every route answers 503.

import {
  can,
  EXPORT_TTL_MS,
  exportScope,
  isId,
  newId,
  type ExportScope,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { checkMember, json, readJson } from "./member-route.ts";

/** The largest file an export writes; a range over it is refused (`too_large`), to be split. */
export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
/** Objects one sweep lists at most (one R2 list call). */
const SWEEP_LIMIT = 1000;

export type ExportEnv = { EXPORTS?: R2Bucket };

/** The object key of an export: every workspace's files under their own prefix. */
export const exportKey = (workspaceId: string, exportId: string) =>
  `workspaces/${workspaceId}/exports/${exportId}.json`;

/** What `WorkspaceDO.buildExport` answers: the file as JSON text, or why not. */
export type BuiltExport =
  | { ok: true; body: string; incidents: number }
  | { ok: false; code: "not_found" | "limit_reached" | "forbidden" | "not_a_member" };

const STATUS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_a_member: 403,
  limit_reached: 413,
  too_large: 413,
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
  const bytes = new TextEncoder().encode(built.body);
  if (bytes.byteLength > MAX_EXPORT_BYTES) return json({ error: "too_large" }, 413);
  const now = Date.now();
  const id = newId("exp", now, (length) => crypto.getRandomValues(new Uint8Array(length)));
  const key = exportKey(workspaceId, id);
  const expiresAt = now + EXPORT_TTL_MS;
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: { expiresAt: String(expiresAt), createdBy: member.actor.id },
    });
  } catch (error) {
    return failed("writing an export failed", workspaceId, error);
  }
  let recorded: { ok: boolean; code?: string };
  try {
    recorded = await shard.recordExport(workspaceId, member.actor, {
      id,
      scope: scope.value,
      incidents: built.incidents,
      bytes: bytes.byteLength,
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
  return json({ id, expiresAt, incidents: built.incidents, bytes: bytes.byteLength }, 201);
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
 * Deletes expired exports (the cron, once an hour): one list call of up to `SWEEP_LIMIT` objects; returns how many
 * it deleted. The bucket's lifecycle rule catches whatever it does not reach.
 */
export async function sweepExports(bucket: R2Bucket, now: number): Promise<number> {
  const listed = await bucket.list({
    prefix: "workspaces/",
    limit: SWEEP_LIMIT,
    include: ["customMetadata"],
  });
  const gone = listed.objects.filter((object) => expired(object, now)).map((object) => object.key);
  if (gone.length > 0) await bucket.delete(gone);
  return gone.length;
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
