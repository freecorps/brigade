// Postmortems (RFC 0013 "Postmortems"): one document per incident in plain-text sections, edited by responders and
// up. Its sections come from a template (RFC 0013 "Templates"): its incident type's, else the workspace's default,
// else the seven built-in ones. The postmortem keeps the template as it was when it was made (`layout`), so later
// template edits and type changes never rewrite it. Saving is last-writer-wins with a conflict check: a save names the revision it was written over, and one
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
import { isId } from "./id.ts";
import { defineQuery } from "./query.ts";
import type {
  IncidentRow,
  PostmortemDraftFailure,
  PostmortemRevisionRow,
  PostmortemRow,
  PostmortemSections,
  PostmortemTemplateRow,
  PostmortemTemplateSection,
} from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Issue } from "./validate.ts";
import { aiDraftsEnabled } from "./workspaces.ts";

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
/** The custom sections a template may add, by key; a template has at most this many. */
export const CUSTOM_POSTMORTEM_SECTIONS = ["custom1", "custom2", "custom3"] as const;
export type CustomPostmortemSection = (typeof CUSTOM_POSTMORTEM_SECTIONS)[number];
export const POSTMORTEM_SECTION_KEYS = [
  ...POSTMORTEM_SECTIONS,
  ...CUSTOM_POSTMORTEM_SECTIONS,
] as const;
export type PostmortemSectionKey = (typeof POSTMORTEM_SECTION_KEYS)[number];
export const isBuiltinSection = (key: string): key is PostmortemSection =>
  (POSTMORTEM_SECTIONS as readonly string[]).includes(key);

/** One section, in UTF-16 code units after trimming. */
export const POSTMORTEM_SECTION_MAX = 3000;
/**
 * The whole document, every section together: what seven full sections held before templates. It keeps a save (and
 * its JSON escapes) inside the client frame limit of RFC 0004 however many sections a template has.
 */
export const POSTMORTEM_TOTAL_MAX = 7 * POSTMORTEM_SECTION_MAX;
/** Sections in a template: every built-in and every custom one. */
export const MAX_TEMPLATE_SECTIONS = POSTMORTEM_SECTION_KEYS.length;
/** A section's title, its hint and its starter text in a template. */
export const TEMPLATE_TITLE_MAX = 60;
export const TEMPLATE_HINT_MAX = 300;
export const TEMPLATE_STARTER_MAX = 1000;
/** The workspace's own template, for incidents with no type or a type without one. */
export const DEFAULT_TEMPLATE_ID = "default";
/** Revisions of each postmortem the shard keeps (decided, Q24); the oldest is dropped when another is written. */
export const POSTMORTEM_REVISIONS_KEPT = 20;
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

export type PostmortemTemplateUpdated = DomainEvent<
  "postmortem_template.updated",
  { id: string; typeId: string | null; sections: number; custom: number }
>;
export type PostmortemTemplateReset = DomainEvent<
  "postmortem_template.reset",
  { id: string; typeId: string | null }
>;

const characters = (sections: PostmortemSections) =>
  Object.values(sections).reduce((sum, text) => sum + (text?.length ?? 0), 0);

/** The seven built-in sections, in their order: the layout of a postmortem with no template. */
export const BUILTIN_LAYOUT: readonly PostmortemTemplateSection[] = POSTMORTEM_SECTIONS.map(
  (key) => ({
    key,
    title: "",
    hint: "",
    starter: "",
  }),
);

export const EMPTY_SECTIONS: Required<Pick<PostmortemSections, PostmortemSection>> = {
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
  return !row || Object.values(row.sections).every((text) => !text);
}

/**
 * Whether nobody wrote in it beyond its template: every section of its layout empty or still its starter text (RFC
 * 0013 "Templates"). Such a postmortem follows its incident's new type (`incident.setType`); one with text keeps its
 * sections.
 */
export function isUnwrittenPostmortem(row: Pick<PostmortemRow, "sections" | "layout">): boolean {
  return (row.layout ?? BUILTIN_LAYOUT).every(
    ({ key, starter }) => !row.sections[key] || row.sections[key] === starter,
  );
}

/**
 * Lays a postmortem nobody wrote in yet out again on the template of incidents of type `typeId` (decided, Q24), as
 * `incident.setType` changes it. Not while an AI draft is being written: the model was given the sections it had.
 * Its `updatedAt` moves, so an editor opened on the old sections is refused (`conflict`) and offered the new ones.
 */
export function followNewType(
  store: MutationStore,
  incidentId: string,
  typeId: string | null,
  now: number,
): void {
  const row = store.get("postmortems", incidentId);
  if (!row || !isUnwrittenPostmortem(row) || draftRunning(row, now)) return;
  const template = templateFor((id) => store.get("postmortem_templates", id), typeId);
  if (JSON.stringify(template ?? null) === JSON.stringify(row.layout ?? null)) return;
  store.update("postmortems", row.id, {
    layout: template,
    sections: emptySections(template ?? BUILTIN_LAYOUT),
    updatedAt: now,
  });
}

/**
 * The template for incidents of type `typeId` (null: none): the type's, else the workspace's default; null when
 * neither exists, meaning the built-in sections. `get` reads `postmortem_templates` by id.
 */
export function templateFor(
  get: (id: string) => PostmortemTemplateRow | undefined,
  typeId: string | null | undefined,
): PostmortemTemplateSection[] | null {
  return (typeId ? get(typeId) : undefined)?.sections ?? get(DEFAULT_TEMPLATE_ID)?.sections ?? null;
}

/**
 * The sections of the incident's postmortem, in order: the row's own layout once it exists (whatever the templates
 * or the incident's type became), else the template it would take now.
 */
export function postmortemLayout(
  row: Pick<PostmortemRow, "layout"> | undefined,
  get: (id: string) => PostmortemTemplateRow | undefined,
  incident: Pick<IncidentRow, "typeId">,
): readonly PostmortemTemplateSection[] {
  if (row) return row.layout ?? BUILTIN_LAYOUT;
  return templateFor(get, incident.typeId) ?? BUILTIN_LAYOUT;
}

/** Empty text for every section of `layout`. */
export function emptySections(layout: readonly PostmortemTemplateSection[]): PostmortemSections {
  return Object.fromEntries(layout.map((section) => [section.key, ""]));
}

/** `sections` without the keys left out (`undefined`). */
const given = (sections: PostmortemSections): PostmortemSections =>
  Object.fromEntries(Object.entries(sections).filter(([, text]) => text !== undefined));

/** Whether `sections` holds exactly the keys of `layout`. */
function fitsLayout(sections: PostmortemSections, layout: readonly PostmortemTemplateSection[]) {
  const keys = Object.keys(sections);
  return keys.length === layout.length && layout.every((section) => section.key in sections);
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

const revisionId = (incidentId: string, revision: number) => `${incidentId}:${revision}`;

/**
 * Keeps the revision `row` now holds in `postmortem_revisions` and drops the one `POSTMORTEM_REVISIONS_KEPT` before
 * it. Revisions go up by one per write, so that is always the oldest kept: one read, no scan.
 */
function keepRevision(store: MutationStore, row: PostmortemRow, savedBy: string, ai: boolean) {
  store.insert("postmortem_revisions", {
    id: revisionId(row.id, row.revision),
    incidentId: row.id,
    revision: row.revision,
    sections: { ...row.sections },
    savedAt: row.updatedAt,
    savedBy,
    ai,
  });
  const oldest = revisionId(row.id, row.revision - POSTMORTEM_REVISIONS_KEPT);
  if (store.get("postmortem_revisions", oldest)) store.delete("postmortem_revisions", oldest);
}

/** The revisions kept of the incident's postmortem, newest first (at most `POSTMORTEM_REVISIONS_KEPT` reads). */
export function postmortemRevisions(
  store: Pick<MutationStore, "get">,
  incidentId: string,
): PostmortemRevisionRow[] {
  const latest = store.get("postmortems", incidentId)?.revision ?? 0;
  const kept: PostmortemRevisionRow[] = [];
  for (
    let revision = latest;
    revision > 0 && revision > latest - POSTMORTEM_REVISIONS_KEPT;
    revision--
  ) {
    const row = store.get("postmortem_revisions", revisionId(incidentId, revision));
    if (row) kept.push(row);
  }
  return kept;
}

/**
 * A kept revision's text laid over `layout`, the postmortem's sections now: what restoring it saves. A section the
 * revision did not have is empty.
 */
export function restoredSections(
  revision: Pick<PostmortemRevisionRow, "sections">,
  layout: readonly PostmortemTemplateSection[],
): PostmortemSections {
  return Object.fromEntries(layout.map(({ key }) => [key, revision.sections[key] ?? ""]));
}

// ---- Validation ---------------------------------------------------------------------------------------------------

const section = v.omittable(
  v.string({ max: POSTMORTEM_SECTION_MAX, multiline: true, joiners: true }),
);
/** The text of each section of the postmortem's layout; the keys must be the layout's (checked by the mutation). */
export const postmortemSections = v.refine(
  v.object(
    Object.fromEntries(POSTMORTEM_SECTION_KEYS.map((key) => [key, section])) as Record<
      PostmortemSectionKey,
      typeof section
    >,
  ),
  (value, path) =>
    characters(value) > POSTMORTEM_TOTAL_MAX
      ? { path, message: `Expected at most ${POSTMORTEM_TOTAL_MAX} characters in all` }
      : null,
);
const incidentId = v.id("inc");
const requestId = v.id("drf");

// ---- Mutations ----------------------------------------------------------------------------------------------------

/**
 * Saves the whole document over `baseRevision` and `baseUpdatedAt`, the revision the editor opened and when the server
 * wrote it (0 and 0: none yet). Saving clears the AI marker: a member who saves has read it. Each save is kept as a
 * revision (`postmortem_revisions`, the last `POSTMORTEM_REVISIONS_KEPT`); restoring one from the dashboard is a save
 * of its text, with the same check.
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
    const sections = given(args.sections);
    // A new postmortem takes its template now; an editor opened on another one (edited since) is refused, and keeps
    // its text.
    const template = row
      ? null
      : templateFor((id) => store.get("postmortem_templates", id), incident.typeId);
    const layout = row ? (row.layout ?? BUILTIN_LAYOUT) : (template ?? BUILTIN_LAYOUT);
    if (!fitsLayout(sections, layout)) {
      // A postmortem nobody wrote in may have followed a new type since the editor opened.
      return row && !isUnwrittenPostmortem(row)
        ? fail("invalid_args", "Expected the postmortem's own sections", [
            { path: "sections", message: "Expected the postmortem's own sections" },
          ])
        : fail("conflict", "The postmortem template changed since this edit started");
    }
    if (row && row.ai == null && layout.every(({ key }) => row.sections[key] === sections[key])) {
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
        layout: template,
        revision: next,
        ai: null,
        draft: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        updatedBy: ctx.actor.id,
      });
    }
    keepRevision(store, store.get("postmortems", args.id)!, ctx.actor.id, false);
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
 * Server only (`WorkspaceDO.requestPostmortemDraft`, as the member who asked): marks a draft as pending. Refused when
 * an owner turned AI drafts off for the workspace (`forbidden`), while one runs (`conflict`), over a member's own text (`conflict`), and past `AI_DRAFTS_PER_DAY` (`limit_reached`), counted
 * in the server-only `ai_drafts` ledger.
 */
export const requestPostmortemDraft = defineMutation({
  name: "postmortem.requestDraft",
  args: v.object({ id: incidentId, requestId }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    if (!aiDraftsEnabled(store.scan("workspace")[0])) {
      return fail("forbidden", "AI drafts are off for this workspace");
    }
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
      // The draft fills the template the incident takes now, kept as the postmortem's own.
      const template = templateFor((id) => store.get("postmortem_templates", id), incident.typeId);
      store.insert("postmortems", {
        id: args.id,
        sections: emptySections(template ?? BUILTIN_LAYOUT),
        layout: template,
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
    const sections = given(args.sections);
    if (!fitsLayout(sections, row.layout ?? BUILTIN_LAYOUT)) {
      return fail("invalid_args", "Expected the postmortem's own sections", [
        { path: "sections", message: "Expected the postmortem's own sections" },
      ]);
    }
    const revision = row.revision + 1;
    store.update("postmortems", row.id, {
      sections,
      revision,
      ai: { at: ctx.now, model: args.model, by: draft.requestedBy },
      draft: null,
      updatedAt: ctx.now,
      updatedBy: ctx.actor.id,
    });
    keepRevision(store, store.get("postmortems", args.id)!, draft.requestedBy, true);
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

// ---- Templates ----------------------------------------------------------------------------------------------------

const templateId = v.refine(v.string({ min: 1, max: 40 }), (value, path) =>
  value === DEFAULT_TEMPLATE_ID || isId("typ", value)
    ? null
    : { path, message: `Expected "${DEFAULT_TEMPLATE_ID}" or an incident type id` },
);
const templateSection = v.object({
  key: v.picklist(POSTMORTEM_SECTION_KEYS),
  title: v.string({ max: TEMPLATE_TITLE_MAX }),
  hint: v.string({ max: TEMPLATE_HINT_MAX, multiline: true, joiners: true }),
  starter: v.string({ max: TEMPLATE_STARTER_MAX, multiline: true, joiners: true }),
});

/** What the store refuses in a template's sections: a key twice, a custom section without a title. */
export function checkTemplateSections(sections: readonly PostmortemTemplateSection[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  sections.forEach((section, index) => {
    if (seen.has(section.key)) {
      issues.push({ path: `sections[${index}].key`, message: "Listed twice" });
    }
    seen.add(section.key);
    if (!isBuiltinSection(section.key) && section.title === "") {
      issues.push({ path: `sections[${index}].title`, message: "A custom section needs a title" });
    }
  });
  return issues;
}

const typeOf = (id: string) => (id === DEFAULT_TEMPLATE_ID ? null : id);

/**
 * Sets the workspace's default template (`default`) or an incident type's: the sections new postmortems of it take,
 * in order. Postmortems already made keep theirs.
 */
export const setPostmortemTemplate = defineMutation({
  name: "postmortemTemplate.set",
  args: v.object({
    id: templateId,
    sections: v.array(templateSection, { min: 1, max: MAX_TEMPLATE_SECTIONS }),
  }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const typeId = typeOf(args.id);
    if (typeId && !store.get("incident_types", typeId)) return fail("not_found", "Type not found");
    const issues = checkTemplateSections(args.sections);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for postmortemTemplate.set", issues);
    }
    const sections: PostmortemTemplateSection[] = args.sections.map(
      (one: PostmortemTemplateSection) => ({ ...one }),
    );
    const row = store.get("postmortem_templates", args.id);
    if (row && JSON.stringify(row.sections) === JSON.stringify(sections)) {
      return fail("conflict", "Template is unchanged");
    }
    const next = { sections, updatedAt: ctx.now, updatedBy: ctx.actor.id };
    if (row) store.update("postmortem_templates", args.id, next);
    else store.insert("postmortem_templates", { id: args.id, ...next });
    const event: PostmortemTemplateUpdated = {
      type: "postmortem_template.updated",
      subject: args.id,
      data: {
        id: args.id,
        typeId,
        sections: sections.length,
        custom: sections.filter((one) => !isBuiltinSection(one.key)).length,
      },
    };
    return ok(event);
  },
});

/**
 * Takes the template out: a type's incidents fall back to the workspace's default, and the default to the built-in
 * sections. Postmortems already made keep theirs.
 */
export const resetPostmortemTemplate = defineMutation({
  name: "postmortemTemplate.reset",
  args: v.object({ id: templateId }),
  permission: "catalog:manage",
  apply(store, args) {
    if (!store.get("postmortem_templates", args.id)) return fail("not_found", "Template not found");
    store.delete("postmortem_templates", args.id);
    const event: PostmortemTemplateReset = {
      type: "postmortem_template.reset",
      subject: args.id,
      data: { id: args.id, typeId: typeOf(args.id) },
    };
    return ok(event);
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

export const allPostmortemTemplates = defineQuery({
  name: "postmortemTemplates.all",
  args: v.object({}),
  permission: "catalog:read",
  table: "postmortem_templates",
  filter: () => true,
});

export const postmortemMutations = [
  savePostmortem,
  setPostmortemTemplate,
  resetPostmortemTemplate,
] as const;
export const postmortemServerMutations = [
  requestPostmortemDraft,
  writePostmortemDraft,
  failPostmortemDraft,
] as const;
