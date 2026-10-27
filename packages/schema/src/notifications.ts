// What notifiers report back (RFC 0005 "Notifiers"). A page that reached nobody is a state change: it goes on the
// incident's timeline, where responders look, and out as `notification.failed`, like every change. So is an email
// about it that could not be sent (RFC 0005 "Email").

import { isActive } from "./lifecycle.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { prefixRange } from "./query.ts";
import type { TimelineRow } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Validator } from "./validate.ts";

/** The schedule's name on an escalation's failed page; absent (older callers) or null on every other. */
const scheduleName: Validator<string | null | undefined> = (input, path = "") =>
  input === undefined
    ? { ok: true, value: undefined }
    : v.nullable(v.string({ max: 80 }))(input, path);

/** The escalation page a failure belongs to; absent outside a run. */
const pageRef: Validator<{ run: string; step: number } | undefined> = (input, path = "") =>
  input === undefined
    ? { ok: true, value: undefined }
    : v.object({ run: v.id("evt"), step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) })(
        input,
        path,
      );

/**
 * Why a page reached nobody (or not one member):
 * - `no_devices`: the member has no device registered (with `userId: null`, no one the page was for has one);
 * - `undelivered`: the relay or the push service kept failing for every device of the member;
 * - `token_invalid`: the push service refused the member's phone token (APNs `BadDeviceToken`, `Unregistered`), so
 *   the phone was dropped and they have none left; recorded instead of `no_devices` when a page of this incident
 *   dropped it;
 * - `unsupported`: the member's devices are all on a platform the relay cannot reach yet (Android until FCM);
 * - `not_configured`: this instance has no push relay set up;
 * - `over_limit`: the page went to more devices than one page sends to (`MAX_PAGE_DEVICES`), and none of the
 *   member's were among them;
 * - `dead_lettered`: the event kept failing before anything was recorded (the shard was unreachable or threw) and
 *   the Queue gave up on it, so whether anyone was paged is unknown (`userId: null`);
 * - `nobody_on_call`: an escalation level's schedule had nobody on call when it fired (`userId: null`, `schedule`);
 * - `schedule_missing`: an escalation level's schedule was deleted after the run started (`userId: null`);
 * - `not_a_member`: an escalation level's member left the workspace or became a viewer;
 * - `escalation_stalled`: an escalation level is due but could not fire (`userId: null`); the shard tries again every
 *   minute, and `ESCALATION_STALL_MS` after the first failure pages everyone who can respond (`escalation.fallback`);
 * - `nobody_else`: everyone who can respond was paged, and the only one who can is whoever declared it (`userId: null`).
 */
export const PAGE_FAILURES = [
  "no_devices",
  "undelivered",
  "token_invalid",
  "unsupported",
  "not_configured",
  "over_limit",
  "dead_lettered",
  "nobody_on_call",
  "schedule_missing",
  "not_a_member",
  "escalation_stalled",
  "nobody_else",
] as const;
export type PageFailure = (typeof PAGE_FAILURES)[number];

/**
 * Why the email notifier could not email a member (RFC 0005 "Email"): `undelivered`, the email service kept failing
 * until the notifier gave up, or refused the message (a suppressed address, a sender the service does not accept);
 * `capped`, not sent because the member or the workspace already got as many emails as Brigade sends in a while.
 */
export const EMAIL_FAILURES = ["undelivered", "capped"] as const;
export type EmailFailure = (typeof EMAIL_FAILURES)[number];

/**
 * Which email it was: `unpaged`, telling a member a page did not reach them; `nobody_paged`, telling an owner a
 * page reached nobody.
 */
export const EMAIL_ABOUT = ["unpaged", "nobody_paged"] as const;
export type EmailAbout = (typeof EMAIL_ABOUT)[number];

export type NotificationFailed = DomainEvent<
  "notification.failed",
  | {
      incidentId: string;
      /** The event that asked for the page, so a consumer can tell which page failed. */
      eventId: string;
      channel: "push";
      /** The member who was not paged; null when the page had nobody to go to. */
      userId: string | null;
      reason: PageFailure;
      /** The schedule nobody was on call for (`nobody_on_call`); null otherwise. */
      schedule: string | null;
      /** The escalation page it belongs to (its run and step); absent outside a run. */
      page?: { run: string; step: number };
    }
  | {
      incidentId: string;
      /** The `notification.failed` event the email was about. */
      eventId: string;
      channel: "email";
      userId: string;
      reason: EmailFailure;
      about: EmailAbout;
    }
>;

/**
 * Server only, as the notifier: records that a page reached nobody, or one member on none of their devices, with
 * a `page_failed` timeline entry and `notification.failed`. The queue consumer runs it once retries are spent.
 */
export const failNotification = defineMutation({
  name: "notification.fail",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    userId: v.nullable(v.string({ min: 1, max: 64 })),
    reason: v.picklist(PAGE_FAILURES),
    schedule: scheduleName,
    page: pageRef,
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(
      store,
      incident,
      {
        kind: "page_failed",
        userId: args.userId,
        reason: args.reason,
        ...(args.schedule == null ? {} : { schedule: args.schedule }),
        ...(args.page && { run: args.page.run, step: args.page.step }),
      },
      ctx,
    );
    const event: NotificationFailed = {
      type: "notification.failed",
      subject: incident.id,
      data: {
        incidentId: args.incidentId,
        eventId: args.eventId,
        channel: "push",
        userId: args.userId,
        reason: args.reason,
        schedule: args.schedule ?? null,
        ...(args.page && { page: args.page }),
      },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier: records that an email about a failed page could not reach `userId`, with an
 * `email_failed` timeline entry and `notification.failed` (`channel: "email"`). The queue consumer runs it once its
 * retries are spent (RFC 0005 "Email"); the email notifier never acts on these.
 */
export const failEmail = defineMutation({
  name: "notification.failEmail",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    userId: v.string({ min: 1, max: 64 }),
    reason: v.picklist(EMAIL_FAILURES),
    about: v.picklist(EMAIL_ABOUT),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(
      store,
      incident,
      { kind: "email_failed", userId: args.userId, reason: args.reason, about: args.about },
      ctx,
    );
    const event: NotificationFailed = {
      type: "notification.failed",
      subject: incident.id,
      data: {
        incidentId: args.incidentId,
        eventId: args.eventId,
        channel: "email",
        userId: args.userId,
        reason: args.reason,
        about: args.about,
      },
    };
    return ok(event);
  },
});

/**
 * The failed pages `incident.pageAgain` takes: a page that may not have gone out (`dead_lettered`), or one whose
 * pushes failed until the notifier gave up or that found no phone (`undelivered`, `token_invalid`, `not_configured`,
 * `no_devices`; the member may have fixed it since). Not the escalation's own misses (nobody on call, a deleted
 * schedule, a member gone), which paging again cannot change.
 */
export const PAGE_AGAIN_REASONS = [
  "dead_lettered",
  "undelivered",
  "token_invalid",
  "not_configured",
  "no_devices",
] as const satisfies readonly PageFailure[];

/** At most this many `page_failed` entries in one `incident.pageAgain` (a grouped line on the timeline). */
export const MAX_PAGE_AGAIN_ENTRIES = 50;

/** Whether `entry` is a failed page `incident.pageAgain` takes. */
export function pagesAgain(
  entry: TimelineRow,
): entry is Extract<TimelineRow, { kind: "page_failed" }> {
  return (
    entry.kind === "page_failed" &&
    (PAGE_AGAIN_REASONS as readonly PageFailure[]).includes(entry.reason)
  );
}

export type IncidentPagedAgain = DomainEvent<
  "incident.paged_again",
  {
    incidentId: string;
    /** The `page_failed` entries it answers. */
    entries: string[];
    /** The members the failed pages were for. */
    userIds: string[];
    /** Also the interim rule (commander, else everyone who can respond): a failed page for nobody in particular. */
    everyone: boolean;
    /** Not pushed, as for the first page: who asked for it (or, done by Brigade, who caused the page that was lost). */
    causedBy: string;
  }
>;

/**
 * "Page again" on a failed page (RFC 0005 "Notifiers"): an owner or admin (`escalation:manage`) asks for the
 * `page_failed` entries `entries` to be paged once more, as a new page with its own event (`incident.paged_again`),
 * never by replaying the old one. It goes to the members those entries name; an entry for nobody in particular (a page
 * the Queue gave up on) goes to the escalation level it belonged to when the incident row still has it, else to the
 * interim rule. Each entry is paged again once (`conflict` after); only while the incident is active and
 * unacknowledged (`conflict`). The shard runs it on its own once, as `sys_notifier`, for a lost SEV1 or SEV2
 * declaration (`causedBy`: who declared it, still not pushed); a member's `causedBy` is always themselves.
 */
export const pageAgain = defineMutation({
  name: "incident.pageAgain",
  args: v.object({
    id: v.id("inc"),
    entries: v.array(v.string({ min: 1, max: 64 }), {
      min: 1,
      max: MAX_PAGE_AGAIN_ENTRIES,
      unique: true,
    }),
    causedBy: v.omittable(v.string({ min: 1, max: 64 })),
  }),
  permission: "escalation:manage",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    if (!isActive(incident.status) || incident.acknowledgedAt != null) {
      return fail("conflict", "Incident is not waiting for a page");
    }
    const failed = [];
    for (const id of args.entries) {
      const entry = store.get("timeline", id);
      if (!entry || entry.incidentId !== incident.id || !pagesAgain(entry)) {
        return fail("not_found", "No such failed page");
      }
      failed.push(entry);
    }
    const { from, to } = prefixRange(`${incident.id}:`);
    const asked = new Set(args.entries);
    for (const entry of store.range("timeline", from, to)) {
      if (entry.kind === "paged_again" && entry.entries.some((id) => asked.has(id))) {
        return fail("conflict", "Already paged again");
      }
    }
    const run = incident.escalation;
    const userIds = new Set<string>();
    let everyone = false;
    for (const entry of failed) {
      if (entry.userId !== null) {
        userIds.add(entry.userId);
        continue;
      }
      // A lost escalation page: the level's members, while the row still keeps that page.
      const kept = run && entry.run === run.eventId && entry.step !== undefined;
      const page = kept ? run.pages[run.pages.length - 1 - (run.paged - entry.step!)] : undefined;
      if (page && page.level !== null) {
        for (const id of page.userIds) if (id !== run!.causedBy) userIds.add(id);
      } else everyone = true;
    }
    const auto = ctx.actor.kind === "system";
    const causedBy = auto ? (args.causedBy ?? ctx.actor.id) : ctx.actor.id;
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(
      store,
      incident,
      {
        kind: "paged_again",
        entries: args.entries,
        userIds: [...userIds],
        everyone,
        ...(auto && { auto }),
      },
      ctx,
    );
    const event: IncidentPagedAgain = {
      type: "incident.paged_again",
      subject: incident.id,
      data: {
        incidentId: incident.id,
        entries: args.entries,
        userIds: [...userIds],
        everyone,
        causedBy,
      },
    };
    return ok(event);
  },
});
