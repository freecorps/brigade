// Scheduled maintenance on the public status page (RFC 0012 "Scheduled maintenance"), and the events of the page's
// email subscriptions (RFC 0012 "Email subscriptions"). A window is planned by whoever tells the public about
// incidents (`status:publish`); the shard's alarm moves it on when it starts and ends (`maintenance.advance`, server
// only), so the page and the subscribers hear of it on time even with nobody signed in.

import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import { UPDATE_BODY_MAX } from "./incidents.ts";
import { MAX_COMPONENTS, PUBLIC_TITLE_MAX, STATUS_PAGE_ID } from "./status.ts";
import type { MaintenancePhase, MaintenanceRow } from "./tables.ts";
import { v } from "./validate.ts";

export const MAINTENANCE_PHASES = ["scheduled", "in_progress", "completed"] as const;
/** The longest one window may last. */
export const MAINTENANCE_MAX_MS = 14 * 24 * 60 * 60 * 1000;
/** How far ahead a window may be planned. */
export const MAINTENANCE_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
/** Windows planned or under way at once; a 21st is `limit_reached`. */
export const MAX_OPEN_MAINTENANCE = 20;
/** A completed window is kept this long (the dashboard lists it), then dropped when another is planned. */
export const MAINTENANCE_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

type Window = Pick<
  MaintenanceRow,
  "id" | "title" | "componentIds" | "startsAt" | "endsAt" | "phase"
>;

export type MaintenanceScheduled = DomainEvent<"maintenance.scheduled", Window>;
export type MaintenanceUpdated = DomainEvent<"maintenance.updated", Window>;
export type MaintenanceStarted = DomainEvent<"maintenance.started", Window>;
export type MaintenanceEnded = DomainEvent<"maintenance.ended", Window & { early: boolean }>;
export type MaintenanceCancelled = DomainEvent<"maintenance.cancelled", Window>;

const windowOf = (row: MaintenanceRow): Window => ({
  id: row.id,
  title: row.title,
  componentIds: row.componentIds,
  startsAt: row.startsAt,
  endsAt: row.endsAt,
  phase: row.phase,
});

/** Where a window stands at `now`. */
export function maintenancePhase(
  row: Pick<MaintenanceRow, "startsAt" | "endsAt">,
  now: number,
): MaintenancePhase {
  if (now >= row.endsAt) return "completed";
  return now >= row.startsAt ? "in_progress" : "scheduled";
}

/** When the alarm should next move a window on, or null when none is open. */
export function nextMaintenanceAt(rows: readonly MaintenanceRow[]): number | null {
  let next: number | null = null;
  for (const row of rows) {
    const at =
      row.phase === "scheduled" ? row.startsAt : row.phase === "in_progress" ? row.endsAt : null;
    if (at !== null && (next === null || at < next)) next = at;
  }
  return next;
}

const maintenanceId = v.id("mnt");
const time = v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const windowArgs = v.object({
  id: maintenanceId,
  title: v.string({ min: 1, max: PUBLIC_TITLE_MAX }),
  body: v.string({ min: 1, max: UPDATE_BODY_MAX, multiline: true, joiners: true }),
  componentIds: v.array(v.id("cmp"), { max: MAX_COMPONENTS, unique: true }),
  startsAt: time,
  endsAt: time,
});
type WindowArgs = {
  title: string;
  componentIds: string[];
  startsAt: number;
  endsAt: number;
};

/** What schedule and update check alike: the page, the components and the times. */
function checkWindow(store: MutationStore, args: WindowArgs, now: number) {
  if (!store.get("status_page", STATUS_PAGE_ID)) {
    return fail("not_found", "The status page is not set up");
  }
  const missing = args.componentIds.findIndex((id) => !store.get("status_components", id));
  if (missing >= 0) {
    const message = "No such component";
    return fail("invalid_args", message, [{ path: `componentIds[${missing}]`, message }]);
  }
  const times = (path: string, message: string) =>
    fail("invalid_args", message, [{ path, message }]);
  if (args.endsAt <= args.startsAt) return times("endsAt", "The window must end after it starts");
  if (args.endsAt - args.startsAt > MAINTENANCE_MAX_MS) {
    return times("endsAt", "A window lasts at most 14 days");
  }
  if (args.endsAt <= now) return times("endsAt", "The window has already ended");
  if (args.startsAt > now + MAINTENANCE_AHEAD_MS) {
    return times("startsAt", "A window starts at most a year ahead");
  }
  return null;
}

/**
 * Plans a maintenance window (owners, admins and responders, `status:publish`): the public title and text, the
 * components it touches and when. One that already started is under way at once. Completed windows past
 * `MAINTENANCE_KEEP_MS` are dropped in the same transaction.
 */
export const scheduleMaintenance = defineMutation({
  name: "maintenance.schedule",
  args: windowArgs,
  permission: "status:publish",
  apply(store, args, ctx) {
    if (store.get("status_maintenance", args.id)) return fail("conflict", "Maintenance exists");
    const problem = checkWindow(store, args, ctx.now);
    if (problem) return problem;
    const rows = store.scan("status_maintenance");
    if (rows.filter((row) => row.phase !== "completed").length >= MAX_OPEN_MAINTENANCE) {
      return fail("limit_reached", `At most ${MAX_OPEN_MAINTENANCE} open maintenance windows`);
    }
    for (const row of rows) {
      if (row.phase === "completed" && row.endsAt + MAINTENANCE_KEEP_MS < ctx.now) {
        store.delete("status_maintenance", row.id);
      }
    }
    const row: MaintenanceRow = {
      ...args,
      phase: maintenancePhase(args, ctx.now),
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("status_maintenance", row);
    const event: MaintenanceScheduled = {
      type: "maintenance.scheduled",
      subject: row.id,
      data: windowOf(row),
    };
    return ok(event);
  },
});

/** Changes a window that has not ended: its text, components or times. Unchanged is a `conflict`. */
export const updateMaintenance = defineMutation({
  name: "maintenance.update",
  args: windowArgs,
  permission: "status:publish",
  apply(store, args, ctx) {
    const current = store.get("status_maintenance", args.id);
    if (!current || current.phase === "completed")
      return fail("not_found", "Maintenance not found");
    const problem = checkWindow(store, args, ctx.now);
    if (problem) return problem;
    if (
      current.title === args.title &&
      current.body === args.body &&
      current.startsAt === args.startsAt &&
      current.endsAt === args.endsAt &&
      current.componentIds.join() === args.componentIds.join()
    ) {
      return fail("conflict", "The window is unchanged");
    }
    const row: MaintenanceRow = {
      ...current,
      ...args,
      phase: maintenancePhase(args, ctx.now),
      updatedAt: ctx.now,
    };
    store.update("status_maintenance", args.id, row);
    const event: MaintenanceUpdated = {
      type: "maintenance.updated",
      subject: row.id,
      data: windowOf(row),
    };
    return ok(event);
  },
});

/** Ends a window under way now, before its planned end (the work finished early). */
export const endMaintenance = defineMutation({
  name: "maintenance.end",
  args: v.object({ id: maintenanceId }),
  permission: "status:publish",
  apply(store, args, ctx) {
    const current = store.get("status_maintenance", args.id);
    if (!current) return fail("not_found", "Maintenance not found");
    if (current.phase !== "in_progress") return fail("conflict", "The window is not under way");
    const row: MaintenanceRow = {
      ...current,
      phase: "completed",
      endsAt: ctx.now,
      updatedAt: ctx.now,
    };
    store.update("status_maintenance", args.id, row);
    const event: MaintenanceEnded = {
      type: "maintenance.ended",
      subject: row.id,
      data: { ...windowOf(row), early: true },
    };
    return ok(event);
  },
});

/** Calls off a window that has not ended: it leaves the page (a window under way ends at once). */
export const cancelMaintenance = defineMutation({
  name: "maintenance.cancel",
  args: v.object({ id: maintenanceId }),
  permission: "status:publish",
  apply(store, args) {
    const current = store.get("status_maintenance", args.id);
    if (!current || current.phase === "completed")
      return fail("not_found", "Maintenance not found");
    store.delete("status_maintenance", args.id);
    const event: MaintenanceCancelled = {
      type: "maintenance.cancelled",
      subject: current.id,
      data: windowOf(current),
    };
    return ok(event);
  },
});

/**
 * Server only, from the shard's alarm: moves a window on to where it stands now. `maintenance.started` when it began,
 * `maintenance.ended` when it ended (only that one when both passed while the shard was away). Nothing to move is a
 * `conflict`.
 */
export const advanceMaintenance = defineMutation({
  name: "maintenance.advance",
  args: v.object({ id: maintenanceId }),
  permission: "status:publish",
  apply(store, args, ctx) {
    const current = store.get("status_maintenance", args.id);
    if (!current) return fail("not_found", "Maintenance not found");
    const phase = maintenancePhase(current, ctx.now);
    if (phase === current.phase || current.phase === "completed") {
      return fail("conflict", "Nothing to move on");
    }
    const row: MaintenanceRow = { ...current, phase, updatedAt: ctx.now };
    store.update("status_maintenance", args.id, row);
    if (phase === "in_progress") {
      const event: MaintenanceStarted = {
        type: "maintenance.started",
        subject: row.id,
        data: windowOf(row),
      };
      return ok(event);
    }
    const event: MaintenanceEnded = {
      type: "maintenance.ended",
      subject: row.id,
      data: { ...windowOf(row), early: false },
    };
    return ok(event);
  },
});

/** Every window, soonest first. */
export const allMaintenance = defineQuery({
  name: "maintenance.all",
  args: v.object({}),
  permission: "status:read",
  table: "status_maintenance",
  filter: () => true,
  sort: (a, b) => a.startsAt - b.startsAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

export const maintenanceMutations = [
  scheduleMaintenance,
  updateMaintenance,
  endMaintenance,
  cancelMaintenance,
] as const;

// ---- Email subscriptions ---------------------------------------------------------------------------------------
// Subscribers live in D1 (`status_subscriber`, apps/api migrations/0009), never in the shard: like every address
// Brigade emails, the shard keeps none (RFC 0005 "Email"). These server-only mutations only carry each change through
// the outbox, with the subscriber's id and never the address.

const subscriberId = v.id("ssb");

export type StatusSubscriberRequested = DomainEvent<
  "status_subscriber.requested",
  { subscriberId: string; send: number }
>;
export type StatusSubscriberConfirmed = DomainEvent<
  "status_subscriber.confirmed",
  { subscriberId: string }
>;
/** Why a subscriber left: they unsubscribed, an owner or admin deleted them, or they never confirmed in time. */
export const SUBSCRIBER_REMOVALS = ["unsubscribed", "deleted", "expired"] as const;
export type StatusSubscriberRemoved = DomainEvent<
  "status_subscriber.removed",
  { subscriberId: string; reason: (typeof SUBSCRIBER_REMOVALS)[number] }
>;
/** A subscriber changed what they follow from their manage link: `follows` keys, 0 for everything. */
export type StatusSubscriberFollowed = DomainEvent<
  "status_subscriber.followed",
  { subscriberId: string; follows: number }
>;
/** More subscribers are left to email about `eventId` (a batch ran out of budget): the notifier picks it up again. */
export type StatusEmailContinue = DomainEvent<"status_email.continue", { eventId: string }>;

/**
 * Someone asked to subscribe on the public page (after the API's rate limits, with the row pending in D1): the
 * confirmation email goes out from the queue (`send`: the subscriber's confirmation count, so each is its own email).
 */
export const requestStatusSubscription = defineMutation({
  name: "statusSubscriber.request",
  args: v.object({ subscriberId, send: v.integer({ min: 1, max: 100 }) }),
  permission: "status:read",
  apply(store, args) {
    if (!store.get("status_page", STATUS_PAGE_ID)?.enabled) {
      return fail("not_found", "The status page is not public");
    }
    const event: StatusSubscriberRequested = {
      type: "status_subscriber.requested",
      subject: args.subscriberId,
      data: args,
    };
    return ok(event);
  },
});

/** The subscriber followed the confirmation link: from now on they get the page's emails. */
export const confirmStatusSubscription = defineMutation({
  name: "statusSubscriber.confirm",
  args: v.object({ subscriberId }),
  permission: "status:read",
  apply(_store, args) {
    const event: StatusSubscriberConfirmed = {
      type: "status_subscriber.confirmed",
      subject: args.subscriberId,
      data: args,
    };
    return ok(event);
  },
});

/**
 * A subscriber unsubscribed, an owner or admin deleted them (`status:manage` checked by the API for that), or their
 * confirmation link expired before they followed it.
 */
export const removeStatusSubscription = defineMutation({
  name: "statusSubscriber.remove",
  args: v.object({ subscriberId, reason: v.picklist(SUBSCRIBER_REMOVALS) }),
  permission: "status:read",
  apply(_store, args) {
    const event: StatusSubscriberRemoved = {
      type: "status_subscriber.removed",
      subject: args.subscriberId,
      data: args,
    };
    return ok(event);
  },
});

/**
 * A subscriber chose the components and groups they follow (`follows`: how many keys, 0 for everything), from the
 * manage link; the keys themselves stay in D1 with the subscriber.
 */
export const followStatusComponents = defineMutation({
  name: "statusSubscriber.follow",
  args: v.object({ subscriberId, follows: v.integer({ min: 0, max: 200 }) }),
  permission: "status:read",
  apply(_store, args) {
    const event: StatusSubscriberFollowed = {
      type: "status_subscriber.followed",
      subject: args.subscriberId,
      data: args,
    };
    return ok(event);
  },
});

/** Server only: brings an unfinished subscriber email back to the queue (src/status-email.ts in the API). */
export const continueStatusEmail = defineMutation({
  name: "statusEmail.continue",
  args: v.object({ eventId: v.id("evt") }),
  permission: "status:read",
  apply(_store, args) {
    const event: StatusEmailContinue = { type: "status_email.continue", data: args };
    return ok(event);
  },
});

export const maintenanceServerMutations = [
  advanceMaintenance,
  requestStatusSubscription,
  confirmStatusSubscription,
  removeStatusSubscription,
  followStatusComponents,
  continueStatusEmail,
] as const;
