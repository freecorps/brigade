// A postmortem's AI draft and revisions on a workspace's Ember shard (RFC 0013, RFC 0016 "Parity"):
// `WorkspaceDO.requestPostmortemDraft`, `readPostmortemRevisions` and `finishPostmortemDraft`, with the same checks
// and mutations, over the shard facade. The Worker asks the model in between, as with the DO (src/postmortem.ts).

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  AI_ACTOR,
  aiDraftsEnabled,
  allows,
  BUILTIN_LAYOUT,
  isRole,
  newId,
  postmortemRevisions,
  workspaceLocale,
  type Actor,
  type PostmortemDraftFailure,
  type PostmortemRevisionRow,
  type PostmortemSections,
} from "@freecorps/brigade-schema";
import { AI_MODEL, draftSource, type DraftSource } from "../src/postmortem-source.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";

const ws = { workspaceId: v.string() };

type Refused = { ok: false; code: string };

/** The shard's checks before a postmortem call: the workspace, the API token backed, the member not removed. */
function acting(
  shard: EmberShard,
  workspaceId: string,
  actor: Actor,
  now: number,
): Actor | Refused {
  if (shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
  const backed = shard.tokenActor(actor, now);
  if (!backed) return { ok: false, code: "unauthenticated" };
  if (shard.gone(backed.by ?? backed.id, now)) return { ok: false, code: "not_a_member" };
  return backed;
}

/**
 * Asks for an AI draft (`WorkspaceDO.requestPostmortemDraft`): `postmortem.requestDraft` as the member (RBAC, the rate
 * limit, its event), then what the model may read and the sections the draft fills.
 */
export const requestDraft = internalMutationGeneric({
  args: { ...ws, actor: v.any(), incidentId: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; incidentId: string },
  ):
    | {
        ok: true;
        requestId: string;
        source: DraftSource;
        layout: { id: string; title: string; hint: string | null }[];
      }
    | Refused => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    const actor = acting(shard, input.workspaceId, input.actor, c.now);
    if ("ok" in actor) return actor;
    const workspace = shard.store.scan("workspace")[0];
    // An owner turned AI drafts off for the workspace (Q24): refused before anything else counts.
    if (!aiDraftsEnabled(workspace)) return { ok: false, code: "ai_disabled" };
    const source = draftSource(shard.store as never, input.incidentId, workspaceLocale(workspace));
    if (!source) return { ok: false, code: "not_found" };
    const requestId = newId("drf", c.now, (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(c.random() * 256);
      return bytes;
    });
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: requestId,
      actor,
      name: "postmortem.requestDraft",
      args: { id: input.incidentId, requestId },
      now: c.now,
      internal: true,
    });
    shard.check();
    if (!result.ok) return { ok: false, code: result.error.code };
    const layout = shard.store.get("postmortems", input.incidentId)?.layout ?? BUILTIN_LAYOUT;
    return {
      ok: true,
      requestId,
      source,
      layout: layout.map((section) => ({ ...section })) as never,
    };
  },
});

/** The kept revisions of the incident's postmortem, newest first (`WorkspaceDO.readPostmortemRevisions`). */
export const revisions = internalMutationGeneric({
  args: { ...ws, actor: v.any(), incidentId: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; incidentId: string },
  ): { ok: true; revisions: PostmortemRevisionRow[] } | Refused => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    const actor = acting(shard, input.workspaceId, input.actor, c.now);
    if ("ok" in actor) return actor;
    if (!isRole(actor.role) || !allows(actor, "incident:read")) {
      return { ok: false, code: "forbidden" };
    }
    if (!shard.store.get("incidents", input.incidentId)) return { ok: false, code: "not_found" };
    return { ok: true, revisions: postmortemRevisions(shard.store as never, input.incidentId) };
  },
});

/** Writes the model's draft, or why there is none, as `sys_ai` (`WorkspaceDO.finishPostmortemDraft`). */
export const finishDraft = internalMutationGeneric({
  args: { ...ws, incidentId: v.string(), requestId: v.string(), outcome: v.any() },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      incidentId: string;
      requestId: string;
      outcome:
        | { ok: true; sections: PostmortemSections }
        | { ok: false; reason: PostmortemDraftFailure };
    },
  ): { ok: boolean; code?: string } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const run = (name: string, args: unknown) =>
      shard.mutate({
        clientId: "ai",
        mutationId: `${input.requestId}:${name}`,
        actor: AI_ACTOR,
        name,
        args,
        now: c.now,
        internal: true,
      });
    const { incidentId, requestId, outcome } = input;
    let { result } = outcome.ok
      ? run("postmortem.writeDraft", {
          id: incidentId,
          requestId,
          sections: outcome.sections,
          model: AI_MODEL,
        })
      : run("postmortem.failDraft", { id: incidentId, requestId, reason: outcome.reason });
    // A draft the text rules still refuse is a failed draft, not a pending one.
    if (!result.ok && outcome.ok && result.error.code === "invalid_args") {
      console.error(
        JSON.stringify({ message: "an AI draft was refused", issues: result.error.issues }),
      );
      ({ result } = run("postmortem.failDraft", { id: incidentId, requestId, reason: "failed" }));
    }
    shard.check();
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  },
});
