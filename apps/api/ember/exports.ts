// A workspace's data export on its Ember shard (RFC 0014 "Export", RFC 0016 "Parity"): `WorkspaceDO.buildExport` and
// `recordExport`. The file is read in several transactions, since each Ember transaction reads a bounded number of
// rows: `start` checks the caller, takes a slot of the hourly limit (`export.reserve`) and answers the file's opening
// and its incidents' ids; `entries` answers their entries, a batch at a time, as they are then (the DO's build is
// consistent per incident too, never one snapshot). The Worker joins the parts and streams them into R2
// (src/ember-exports.ts), then `record` lists the export and emits its event.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  allows,
  exportEntries,
  exportOpening,
  isRole,
  type Actor,
  type ExportScope,
} from "@freecorps/brigade-schema";
import { emberWorkspace } from "./shard-facade.ts";

const ws = { workspaceId: v.string() };

/**
 * How many incidents' entries one `entries` call reads. One: each entry reads the incident's whole timeline and the
 * follow-ups, and an Ember transaction reads a bounded number of rows, so one incident a call keeps a long one from
 * taking others down with it.
 */
export const EXPORT_ENTRIES_BATCH = 1;

/** The export's checks, its slot of the hourly limit, the file's opening and the incidents' ids. */
export const start = internalMutationGeneric({
  args: { ...ws, actor: v.any(), scope: v.any(), id: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; scope: ExportScope; id: string },
  ): { ok: true; opening: string; incidentIds: string[] } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" };
    if (shard.gone(acting.by ?? acting.id, c.now)) return { ok: false, code: "not_a_member" };
    if (!isRole(acting.role) || !allows(acting, "data:export")) {
      return { ok: false, code: "forbidden" };
    }
    const opened = exportOpening(shard.store, input.scope, c.now);
    if (!opened.ok) return opened;
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: input.id,
      actor: acting,
      name: "export.reserve",
      args: { id: input.id },
      now: c.now,
      internal: true,
    });
    shard.check();
    if (!result.ok) {
      const code = result.error.code;
      return { ok: false, code: code === "limit_reached" ? "rate_limited" : code };
    }
    return opened;
  },
});

/** The entries of up to `EXPORT_ENTRIES_BATCH` incidents, as JSON text each. */
export const entries = internalMutationGeneric({
  args: { ...ws, incidentIds: v.array(v.string()) },
  handler: (ctx, input: { workspaceId: string; incidentIds: string[] }): string[] | null => {
    const { shard } = emberWorkspace(ctx as MutationCtx);
    if (shard.workspace() !== input.workspaceId) return null;
    return exportEntries(shard.store, input.incidentIds.slice(0, EXPORT_ENTRIES_BATCH));
  },
});

/** Records an export the Worker wrote to R2 (`export.record`, as the member): listed, and its event. */
export const record = internalMutationGeneric({
  args: { ...ws, actor: v.any(), args: v.any() },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      args: { id: string; scope: ExportScope; incidents: number; bytes: number };
    },
  ): { ok: boolean; code?: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: input.args.id,
      actor: input.actor,
      name: "export.record",
      args: input.args,
      now: c.now,
      internal: true,
    });
    shard.check();
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  },
});
