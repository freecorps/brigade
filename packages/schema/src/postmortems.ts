// Postmortems (RFC 0013 "Postmortems"): one document per incident in fixed plain-text sections, edited by responders
// and up. Saving is last-writer-wins with a conflict check: a save names the revision it was written over, and one
// written over an older revision is refused, so nobody overwrites a teammate's edit unseen. A first draft can come from
// Workers AI (the API Worker, off the request path); it is written through `postmortem.writeDraft` and marked as an AI
// draft until a member saves the document.
//
// The base a save names is the revision and `updatedAt` the server confirmed, not the revision alone: a client that
// applied its own save optimistically holds the next revision number too, stamped with its own clock, so a save queued
// behind a refused one cannot pass as written over a teammate's.

import {
  defineMutation,
  fail,
  ok,
  type Actor,
  type DomainEvent,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { PostmortemDraftFailure, PostmortemRow, PostmortemSections } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v } from "./validate.ts";

export const POSTMORTEM_SECTIONS = [
  "summary",
  "impact",
  "timeline",
  "rootCause",
  "wentWell",
  "wentPoorly",
  "followUps",
] as const;
export type PostmortemSection = (typeof POSTMORTEM_SECTIONS)[number];

/**
 * One section, in UTF-16 code units after trimming. Seven of them keep a save (and its JSON escapes) inside the
 * client frame limit of RFC 0004.
 */
export const POSTMORTEM_SECTION_MAX = 3000;
/** AI drafts a workspace may ask for in any 24 hours. */
export const AI_DRAFTS_PER_DAY = 20;
export const AI_DRAFT_WINDOW_MS = 24 * 60 * 60 * 1000;
/**
 * How long a draft may stay pending. The Worker gives the model less than this; a draft still pending after it was
 * lost (the Worker was stopped before it could write a failure), so it reads as failed and may be asked for again.
 */
export const AI_DRAFT_STALE_MS = 2 * 60 * 1000;

/** The actor AI drafts are written as (RFC 0004 "Server-side writes"); its mutations are server-only. */
export const AI_ACTOR: Actor = { kind: "system", id: "sys_ai", role: "admin" };

export const POSTMORTEM_DRAFT_FAILURES = ["failed", "timeout", "edited", "unavailable"] as const;

// ---- Events -------------------------------------------------------------------------------------------------------

/** Never the text: sizes only, so notifiers and logs never carry the document. */
type PostmortemSummary = { incidentId: string; revision: number; characters: number };
export type PostmortemSaved = DomainEvent<"postmortem.saved", PostmortemSummary>;
export type PostmortemDraftRequested = DomainEvent<
  "postmortem.draft_requested",
  { incidentId: string; requestId: string; by: string }
>;
export type PostmortemDrafted = DomainEvent<
  "postmortem.drafted",
  PostmortemSummary & { requestId: string; model: string }
>;
export type PostmortemDraftFailed = DomainEvent<
  "postmortem.draft_failed",
  { incidentId: string; requestId: string; reason: PostmortemDraftFailure }
>;

const characters = (sections: PostmortemSections) =>
  POSTMORTEM_SECTIONS.reduce((sum, key) => sum + sections[key].length, 0);

export const EMPTY_SECTIONS: PostmortemSections = {
  summary: "",
  impact: "",
  timeline: "",
  rootCause: "",
  wentWell: "",
  wentPoorly: "",
  followUps: "",
};

/** Whether nobody wrote anything in it yet. */
export function isBlankPostmortem(row: Pick<PostmortemRow, "sections"> | undefined): boolean {
  return !row || POSTMORTEM_SECTIONS.every((key) => row.sections[key] === "");
}

/** A draft that is still running: pending and not past `AI_DRAFT_STALE_MS`. */
export function draftRunning(row: Pick<PostmortemRow, "draft"> | undefined, now: number): boolean {
  const draft = row?.draft;
  return !!draft && draft.status === "pending" && now - draft.requestedAt < AI_DRAFT_STALE_MS;
}

/**
 * Whether an AI draft may be asked for: the document is blank, or holds an AI draft nobody saved since (asking again
 * replaces it). Never over a member's own text.
 */
export function canDraftPostmortem(row: PostmortemRow | undefined): boolean {
  return isBlankPostmortem(row) || row?.ai != null;
}

// ---- Validation ---------------------------------------------------------------------------------------------------

const section = v.string({ max: POSTMORTEM_SECTION_MAX, multiline: true, joiners: true });
export const postmortemSections = v.object({
  summary: section,
  impact: section,
  timeline: section,
  rootCause: section,
  wentWell: section,
  wentPoorly: section,
  followUps: section,
});
const incidentId = v.id("inc");
const requestId = v.id("drf");

// ---- Mutations ----------------------------------------------------------------------------------------------------

/**
 * Saves the whole document over `baseRevision` and `baseUpdatedAt`, the revision the editor opened and when the server
 * wrote it (0 and 0: none yet). Saving clears the AI marker: a member who saves has read it.
 */
export const savePostmortem = defineMutation({
  name: "postmortem.save",
  args: v.object({
    id: incidentId,
    sections: postmortemSections,
    baseRevision: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    baseUpdatedAt: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const row = store.get("postmortems", args.id);
    const revision = row?.revision ?? 0;
    // Revision 0 holds no text (only a draft was asked for), so only a written revision is matched on its time too.
    if (revision !== args.baseRevision || (revision > 0 && row!.updatedAt !== args.baseUpdatedAt)) {
      return fail("conflict", "The postmortem changed since this edit started");
    }
    const sections: PostmortemSections = args.sections;
    if (
      row &&
      row.ai == null &&
      POSTMORTEM_SECTIONS.every((key) => row.sections[key] === sections[key])
    ) {
      return fail("conflict", "Nothing changed");
    }
    const next = revision + 1;
    if (row) {
      store.update("postmortems", row.id, {
        sections,
        revision: next,
        ai: null,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.id,
      });
    } else {
      store.insert("postmortems", {
        id: args.id,
        sections,
        revision: next,
        ai: null,
        draft: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.id,
      });
    }
    // The first save starts it on the timeline; later saves are edits of a document, not incident changes.
    if (isBlankPostmortem(row)) {
      appendTimeline(store, incident, { kind: "postmortem", change: "started" }, ctx);
    }
    const event: PostmortemSaved = {
      type: "postmortem.saved",
      subject: args.id,
      data: { incidentId: args.id, revision: next, characters: characters(sections) },
    };
    return ok(event);
  },
});

/**
 * Server only (`WorkspaceDO.requestPostmortemDraft`, as the member who asked): marks a draft as pending. Refused while
 * one runs (`conflict`), over a member's own text (`conflict`), and past `AI_DRAFTS_PER_DAY` (`limit_reached`), counted
 * in the server-only `ai_drafts` ledger.
 */
export const requestPostmortemDraft = defineMutation({
  name: "postmortem.requestDraft",
  args: v.object({ id: incidentId, requestId }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const row = store.get("postmortems", args.id);
    if (draftRunning(row, ctx.now)) return fail("conflict", "A draft is already being written");
    if (!canDraftPostmortem(row)) {
      return fail("conflict", "The postmortem already has text a member wrote");
    }
    if (ctx.server) {
      const ledger = store.scan("ai_drafts");
      for (const old of ledger) {
        if (ctx.now - old.at >= AI_DRAFT_WINDOW_MS) store.delete("ai_drafts", old.id);
      }
      const recent = ledger.filter((one) => ctx.now - one.at < AI_DRAFT_WINDOW_MS).length;
      if (recent >= AI_DRAFTS_PER_DAY) {
        return fail("limit_reached", `At most ${AI_DRAFTS_PER_DAY} AI drafts a day`);
      }
      store.insert("ai_drafts", { id: args.requestId, at: ctx.now });
    }
    const draft = {
      id: args.requestId,
      status: "pending" as const,
      requestedAt: ctx.now,
      requestedBy: ctx.actor.id,
      baseRevision: row?.revision ?? 0,
      reason: null,
    };
    if (row) store.update("postmortems", row.id, { draft });
    else {
      store.insert("postmortems", {
        id: args.id,
        sections: EMPTY_SECTIONS,
        revision: 0,
        ai: null,
        draft,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.id,
      });
    }
    const event: PostmortemDraftRequested = {
      type: "postmortem.draft_requested",
      subject: args.id,
      data: { incidentId: args.id, requestId: args.requestId, by: ctx.actor.id },
    };
    return ok(event);
  },
});

function failDraftIn(store: MutationStore, row: PostmortemRow, reason: PostmortemDraftFailure) {
  store.update("postmortems", row.id, { draft: { ...row.draft!, status: "failed", reason } });
  const event: PostmortemDraftFailed = {
    type: "postmortem.draft_failed",
    subject: row.id,
    data: { incidentId: row.id, requestId: row.draft!.id, reason },
  };
  return ok(event);
}

/**
 * Server only, as `AI_ACTOR`: writes the model's draft for request `requestId`. If a member saved the document since
 * the draft was asked for, their text stays and the draft fails as `edited`.
 */
export const writePostmortemDraft = defineMutation({
  name: "postmortem.writeDraft",
  args: v.object({
    id: incidentId,
    requestId,
    sections: postmortemSections,
    model: v.string({ min: 1, max: 100 }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    const row = store.get("postmortems", args.id);
    if (!incident || !row) return fail("not_found", "Postmortem not found");
    const draft = row.draft;
    if (!draft || draft.id !== args.requestId || draft.status !== "pending") {
      return fail("conflict", "No such draft is pending");
    }
    if (row.revision !== draft.baseRevision) return failDraftIn(store, row, "edited");
    // Past `AI_DRAFT_STALE_MS` the draft already reads as failed and may have been asked for again: a late result
    // never lands.
    if (ctx.now - draft.requestedAt >= AI_DRAFT_STALE_MS) return failDraftIn(store, row, "timeout");
    const sections: PostmortemSections = args.sections;
    const revision = row.revision + 1;
    store.update("postmortems", row.id, {
      sections,
      revision,
      ai: { at: ctx.now, model: args.model, by: draft.requestedBy },
      draft: null,
      updatedAt: ctx.now,
      updatedBy: ctx.actor.id,
    });
    appendTimeline(store, incident, { kind: "postmortem", change: "ai_drafted" }, ctx);
    const event: PostmortemDrafted = {
      type: "postmortem.drafted",
      subject: args.id,
      data: {
        incidentId: args.id,
        revision,
        characters: characters(sections),
        requestId: args.requestId,
        model: args.model,
      },
    };
    return ok(event);
  },
});

/** Server only, as `AI_ACTOR`: the draft for `requestId` could not be written. */
export const failPostmortemDraft = defineMutation({
  name: "postmortem.failDraft",
  args: v.object({
    id: incidentId,
    requestId,
    reason: v.picklist(POSTMORTEM_DRAFT_FAILURES),
  }),
  permission: "incident:update",
  apply(store, args) {
    const row = store.get("postmortems", args.id);
    if (!row) return fail("not_found", "Postmortem not found");
    const draft = row.draft;
    if (!draft || draft.id !== args.requestId || draft.status !== "pending") {
      return fail("conflict", "No such draft is pending");
    }
    return failDraftIn(store, row, args.reason);
  },
});

// ---- Queries ------------------------------------------------------------------------------------------------------

export const incidentPostmortem = defineQuery({
  name: "incident.postmortem",
  args: v.object({ id: incidentId }),
  permission: "incident:read",
  table: "postmortems",
  key: (args) => args.id,
  filter: (row, args) => row.id === args.id,
});

export const postmortemMutations = [savePostmortem] as const;
export const postmortemServerMutations = [
  requestPostmortemDraft,
  writePostmortemDraft,
  failPostmortemDraft,
] as const;
