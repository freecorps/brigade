// The export and postmortem calls the API Worker makes into a workspace's shard (RFC 0014 "Export", RFC 0013, RFC
// 0016 "Parity"), sent to the engine D1's `workspace_engine` names: `WorkspaceDO`, or its Ember shard
// (ember/exports.ts, ember/postmortems.ts), with `WorkspaceDO`'s signatures. On Ember the export's file is read a batch
// of incidents at a time and its parts are made here, up to `MAX_EXPORT_BYTES`. The routes read D1 already, so the
// engine is read fresh, within a bound.

import {
  EXPORT_CLOSING,
  MAX_EXPORT_BYTES,
  newId,
  type Actor,
  type ExportScope,
  type PostmortemDraftFailure,
  type PostmortemSections,
} from "@freecorps/brigade-schema";
import { EXPORT_ENTRIES_BATCH } from "../ember/exports.ts";
import { within } from "./deadline.ts";
import { workspaceEngine } from "./ember.ts";
import { emberMutation } from "./ember-workspace.ts";
import type { BuiltExport } from "./exports.ts";
import type { DraftRequestResult } from "./postmortem.ts";
import type { WorkspaceDO } from "./workspace.ts";

/** How long the engine lookup may take before the route answers `unavailable`. */
export const EXPORTS_ENGINE_BUDGET_MS = 5000;

type ShardEnv = Pick<Env, "DB" | "WORKSPACE"> & { SHARD?: Env["SHARD"] };

async function onEmber(env: ShardEnv, workspaceId: string): Promise<boolean> {
  if (!env.SHARD) return false;
  return (
    (await within(
      workspaceEngine(env.DB, workspaceId),
      EXPORTS_ENGINE_BUDGET_MS,
      "engine lookup",
    )) === "ember"
  );
}

/** `WorkspaceDO`'s export calls. */
export type WorkspaceExports = {
  buildExport(workspaceId: string, actor: Actor, scope: ExportScope): Promise<BuiltExport>;
  recordExport(
    workspaceId: string,
    actor: Actor,
    args: { id: string; scope: ExportScope; incidents: number; bytes: number },
  ): Promise<{ ok: boolean; code?: string }>;
};

/** `workspaceId`'s export calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceExports(
  env: ShardEnv,
  workspaceId: string,
): Promise<WorkspaceExports> {
  if (await onEmber(env, workspaceId)) {
    return emberExports({ SHARD: env.SHARD! });
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    buildExport: async (...a) => stub.buildExport(...a) as never,
    recordExport: async (...a) => stub.recordExport(...a),
  };
}

/** The export calls on a workspace's Ember shard. */
export function emberExports(env: { SHARD: Env["SHARD"] }): WorkspaceExports {
  return {
    async buildExport(workspaceId, actor, scope) {
      const id = newId("exp", Date.now(), (n) => crypto.getRandomValues(new Uint8Array(n)));
      const started = await emberMutation<
        { ok: true; opening: string; incidentIds: string[] } | { ok: false; code: string }
      >(env, workspaceId, "exports:start", { workspaceId, actor, scope, id });
      if (!started.ok) return started;
      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];
      let bytes = 0;
      const push = (text: string): boolean => {
        const part = encoder.encode(text);
        bytes += part.byteLength;
        if (bytes > MAX_EXPORT_BYTES) return false;
        parts.push(part);
        return true;
      };
      if (!push(started.opening)) return { ok: false, code: "too_large" };
      let written = 0;
      const ids = started.incidentIds;
      for (let at = 0; at < ids.length; at += EXPORT_ENTRIES_BATCH) {
        const entries = await emberMutation<string[] | null>(env, workspaceId, "exports:entries", {
          workspaceId,
          incidentIds: ids.slice(at, at + EXPORT_ENTRIES_BATCH),
        });
        if (entries === null) return { ok: false, code: "not_found" };
        for (const entry of entries) {
          if (!push(`${written > 0 ? "," : ""}${entry}`)) return { ok: false, code: "too_large" };
          written++;
        }
      }
      if (!push(EXPORT_CLOSING)) return { ok: false, code: "too_large" };
      return { ok: true, id, parts, bytes, incidents: written };
    },
    recordExport: (workspaceId, actor, args) =>
      emberMutation(env, workspaceId, "exports:record", { workspaceId, actor, args }),
  };
}

type Revisions = Awaited<ReturnType<WorkspaceDO["readPostmortemRevisions"]>>;

/** `WorkspaceDO`'s postmortem calls. */
export type WorkspacePostmortems = {
  requestPostmortemDraft(
    workspaceId: string,
    actor: Actor,
    incidentId: string,
  ): Promise<DraftRequestResult>;
  readPostmortemRevisions(
    workspaceId: string,
    actor: Actor,
    incidentId: string,
  ): Promise<Revisions>;
  finishPostmortemDraft(
    workspaceId: string,
    incidentId: string,
    requestId: string,
    outcome:
      | { ok: true; sections: PostmortemSections }
      | { ok: false; reason: PostmortemDraftFailure },
  ): Promise<{ ok: boolean; code?: string }>;
};

/** `workspaceId`'s postmortem calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspacePostmortems(
  env: ShardEnv,
  workspaceId: string,
): Promise<WorkspacePostmortems> {
  if (await onEmber(env, workspaceId)) {
    const shard = { SHARD: env.SHARD! };
    return {
      requestPostmortemDraft: (id, actor, incidentId) =>
        emberMutation(shard, id, "postmortems:requestDraft", {
          workspaceId: id,
          actor,
          incidentId,
        }),
      readPostmortemRevisions: (id, actor, incidentId) =>
        emberMutation(shard, id, "postmortems:revisions", { workspaceId: id, actor, incidentId }),
      finishPostmortemDraft: (id, incidentId, requestId, outcome) =>
        emberMutation(shard, id, "postmortems:finishDraft", {
          workspaceId: id,
          incidentId,
          requestId,
          outcome,
        }),
    };
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    requestPostmortemDraft: async (...a) => stub.requestPostmortemDraft(...a) as never,
    readPostmortemRevisions: async (...a) => stub.readPostmortemRevisions(...a) as never,
    finishPostmortemDraft: async (...a) => stub.finishPostmortemDraft(...a),
  };
}
