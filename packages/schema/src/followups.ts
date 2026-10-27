// Follow-ups (RFC 0013 "Follow-ups"): action items an incident leaves behind, each with an owner, a due date and an
// optional link to an issue elsewhere. Responders and up add, edit, complete and remove them; every change is a
// timeline entry on its incident and an event (RFC 0005).

import { isFieldLink } from "./catalog.ts";
import { idTime } from "./id.ts";
import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import {
  defineMutation,
  fail,
  ok,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { FollowUpRow } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Validator } from "./validate.ts";

export const FOLLOW_UP_STATUSES = ["open", "done"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const FOLLOW_UP_TITLE_MAX = 200;
/** A follow-up's link, like a link field's (RFC 0003 "Custom fields"). */
export const FOLLOW_UP_LINK_MAX = 1000;
/** Follow-ups one incident holds, done ones included. */
export const MAX_FOLLOW_UPS_PER_INCIDENT = 50;
/** Open follow-ups across the workspace: what the "Open follow-ups" view lists at most. */
export const MAX_OPEN_FOLLOW_UPS = 500;

// ---- Events -------------------------------------------------------------------------------------------------------

type FollowUpSummary = Pick<
  FollowUpRow,
  "id" | "incidentId" | "title" | "ownerId" | "dueDate" | "status"
>;
export type FollowUpCreated = DomainEvent<"follow_up.created", FollowUpSummary>;
/** `member_removed`: its owner left the workspace or became a viewer, so it has none now. */
export type FollowUpUpdated = DomainEvent<
  "follow_up.updated",
  FollowUpSummary & { reason: "edited" | "member_removed" }
>;
export type FollowUpCompleted = DomainEvent<"follow_up.completed", FollowUpSummary>;
export type FollowUpReopened = DomainEvent<"follow_up.reopened", FollowUpSummary>;
export type FollowUpDeleted = DomainEvent<"follow_up.deleted", FollowUpSummary>;

const summary = (row: FollowUpRow): FollowUpSummary => ({
  id: row.id,
  incidentId: row.incidentId,
  title: row.title,
  ownerId: row.ownerId,
  dueDate: row.dueDate,
  status: row.status,
});

// ---- Validation ---------------------------------------------------------------------------------------------------

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date `YYYY-MM-DD` that exists (no February 30th), from 2000 to 2099. */
export function isDueDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const dueDate: Validator<string> = (input, path = "") =>
  isDueDate(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a date as YYYY-MM-DD" }] };

const link: Validator<string> = (input, path = "") => {
  const value = typeof input === "string" ? input.trim() : input;
  return isFieldLink(value)
    ? { ok: true, value }
    : { ok: false, issues: [{ path, message: "Expected an http(s) link" }] };
};

const followUpId = v.id("fup");
const fields = {
  title: v.string({ min: 1, max: FOLLOW_UP_TITLE_MAX, joiners: true }),
  // A member's user id; membership (not a viewer) is checked against the store.
  ownerId: v.nullable(v.string({ min: 1, max: 64 })),
  dueDate: v.nullable(dueDate),
  link: v.nullable(link),
};

/** The owner must be a member who may run incidents: viewers only read, as for incident roles. */
function checkOwner(store: MutationStore, ownerId: string | null): MutationResult | undefined {
  if (ownerId === null) return undefined;
  const member = store.get("members", ownerId);
  if (member && member.role !== "viewer") return undefined;
  const message = member ? "Viewers cannot own follow-ups" : "Not a member";
  return fail("invalid_args", message, [{ path: "ownerId", message }]);
}

/** Whether an open follow-up is past its due date on `today` (`YYYY-MM-DD`, the reader's own calendar). */
export function isOverdue(row: Pick<FollowUpRow, "status" | "dueDate">, today: string): boolean {
  return row.status === "open" && row.dueDate !== null && row.dueDate < today;
}

// ---- Mutations ----------------------------------------------------------------------------------------------------

export const createFollowUp = defineMutation({
  name: "followUp.create",
  args: v.object({ id: followUpId, incidentId: v.id("inc"), ...fields }),
  permission: "incident:update",
  apply(store, args, ctx) {
    if (ctx.server && idTime(args.id) - ctx.now > ID_CLOCK_SKEW_MS) {
      return fail("invalid_args", "Follow-up id time is ahead of the server clock", [
        { path: "id", message: "Id time is too far in the future" },
      ]);
    }
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    if (store.get("follow_ups", args.id)) return fail("conflict", "Follow-up already exists");
    const all = store.scan("follow_ups");
    if (
      all.filter((row) => row.incidentId === args.incidentId).length >= MAX_FOLLOW_UPS_PER_INCIDENT
    ) {
      return fail(
        "limit_reached",
        `At most ${MAX_FOLLOW_UPS_PER_INCIDENT} follow-ups per incident`,
      );
    }
    if (all.filter((row) => row.status === "open").length >= MAX_OPEN_FOLLOW_UPS) {
      return fail("limit_reached", `At most ${MAX_OPEN_FOLLOW_UPS} open follow-ups per workspace`);
    }
    const refused = checkOwner(store, args.ownerId);
    if (refused) return refused;
    const row: FollowUpRow = {
      id: args.id,
      incidentId: args.incidentId,
      incidentNumber: incident.number,
      incidentTitle: incident.title,
      title: args.title,
      ownerId: args.ownerId,
      dueDate: args.dueDate,
      link: args.link,
      status: "open",
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      doneAt: null,
      doneBy: null,
      updatedAt: ctx.now,
    };
    store.insert("follow_ups", row);
    appendTimeline(store, incident, { kind: "follow_up", change: "added", title: row.title }, ctx);
    return ok({
      type: "follow_up.created",
      subject: row.id,
      data: summary(row),
    } as FollowUpCreated);
  },
});

/** Changes its title, owner, due date and link at once, as the editor saves them. */
export const updateFollowUp = defineMutation({
  name: "followUp.update",
  args: v.object({ id: followUpId, ...fields }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const row = store.get("follow_ups", args.id);
    if (!row) return fail("not_found", "Follow-up not found");
    if (
      row.title === args.title &&
      row.ownerId === args.ownerId &&
      row.dueDate === args.dueDate &&
      row.link === args.link
    ) {
      return fail("conflict", "Nothing changed");
    }
    // An owner who stays need not still qualify: only a new owner is checked.
    if (args.ownerId !== row.ownerId) {
      const refused = checkOwner(store, args.ownerId);
      if (refused) return refused;
    }
    const next = store.update("follow_ups", row.id, {
      title: args.title,
      ownerId: args.ownerId,
      dueDate: args.dueDate,
      link: args.link,
      updatedAt: ctx.now,
    });
    timeline(store, row.incidentId, { change: "edited", title: next.title }, ctx);
    const event: FollowUpUpdated = {
      type: "follow_up.updated",
      subject: row.id,
      data: { ...summary(next), reason: "edited" },
    };
    return ok(event);
  },
});

export const setFollowUpStatus = defineMutation({
  name: "followUp.setStatus",
  args: v.object({ id: followUpId, status: v.picklist(FOLLOW_UP_STATUSES) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const row = store.get("follow_ups", args.id);
    if (!row) return fail("not_found", "Follow-up not found");
    if (row.status === args.status) return fail("conflict", `Already ${args.status}`);
    if (
      args.status === "open" &&
      store.scan("follow_ups").filter((one) => one.status === "open").length >= MAX_OPEN_FOLLOW_UPS
    ) {
      return fail("limit_reached", `At most ${MAX_OPEN_FOLLOW_UPS} open follow-ups per workspace`);
    }
    const done = args.status === "done";
    const next = store.update("follow_ups", row.id, {
      status: args.status,
      doneAt: done ? ctx.now : null,
      doneBy: done ? ctx.actor.id : null,
      updatedAt: ctx.now,
    });
    timeline(store, row.incidentId, { change: done ? "done" : "reopened", title: row.title }, ctx);
    const event: FollowUpCompleted | FollowUpReopened = {
      type: done ? "follow_up.completed" : "follow_up.reopened",
      subject: row.id,
      data: summary(next),
    };
    return ok(event);
  },
});

export const deleteFollowUp = defineMutation({
  name: "followUp.delete",
  args: v.object({ id: followUpId }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const row = store.get("follow_ups", args.id);
    if (!row) return fail("not_found", "Follow-up not found");
    store.delete("follow_ups", row.id);
    timeline(store, row.incidentId, { change: "removed", title: row.title }, ctx);
    const event: FollowUpDeleted = {
      type: "follow_up.deleted",
      subject: row.id,
      data: summary(row),
    };
    return ok(event);
  },
});

/** A `follow_up` entry on the incident's timeline; none when the incident is gone (incidents are never deleted). */
function timeline(
  store: MutationStore,
  incidentId: string,
  entry: { change: "edited" | "done" | "reopened" | "removed"; title: string },
  ctx: MutationContext,
): void {
  const incident = store.get("incidents", incidentId);
  if (incident) appendTimeline(store, incident, { kind: "follow_up", ...entry }, ctx);
}

/**
 * Takes a member removed from the workspace, or made a viewer, off every open follow-up they own, in the same
 * transaction (wherever `dropFromSchedules` runs). Done ones keep them: they record who did it.
 */
export function dropFollowUpOwner(
  store: MutationStore,
  userId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const row of store.scan("follow_ups")) {
    if (row.ownerId !== userId || row.status !== "open") continue;
    const next = store.update("follow_ups", row.id, { ownerId: null, updatedAt: ctx.now });
    const event: FollowUpUpdated = {
      type: "follow_up.updated",
      subject: row.id,
      data: { ...summary(next), reason: "member_removed" },
    };
    events.push(event);
  }
  return events;
}

// ---- Queries ------------------------------------------------------------------------------------------------------

const byCreation = (a: FollowUpRow, b: FollowUpRow) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Soonest due first; no due date last. */
const byDue = (a: FollowUpRow, b: FollowUpRow) => {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return byCreation(a, b);
};

/** One incident's follow-ups, open and done, in the order they were added. */
export const incidentFollowUps = defineQuery({
  name: "incident.followUps",
  args: v.object({ id: v.id("inc") }),
  permission: "incident:read",
  table: "follow_ups",
  filter: (row, args) => row.incidentId === args.id,
  sort: byCreation,
});

/** Every open follow-up in the workspace, soonest due first. */
export const openFollowUps = defineQuery({
  name: "followUps.open",
  args: v.object({}),
  permission: "incident:read",
  table: "follow_ups",
  filter: (row) => row.status === "open",
  sort: byDue,
});

export const followUpMutations = [
  createFollowUp,
  updateFollowUp,
  setFollowUpStatus,
  deleteFollowUp,
] as const;
export const followUpQueries = [incidentFollowUps, openFollowUps] as const;
