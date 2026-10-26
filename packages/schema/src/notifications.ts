// What notifiers report back (RFC 0005 "Notifiers"). A page that reached nobody is a state change: it goes on the
// incident's timeline, where responders look, and out as `notification.failed`, like every change.

import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Validator } from "./validate.ts";

/** The schedule's name on an escalation's failed page; absent (older callers) or null on every other. */
const scheduleName: Validator<string | null | undefined> = (input, path = "") =>
  input === undefined
    ? { ok: true, value: undefined }
    : v.nullable(v.string({ max: 80 }))(input, path);

/**
 * Why a page reached nobody (or not one member):
 * - `no_devices`: the member has no device registered (with `userId: null`, no one the page was for has one);
 * - `undelivered`: the relay or the push service kept failing for every device of the member;
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
 *   minute, and past `ESCALATION_STALL_MS` pages everyone who can respond (`escalation.fallback`).
 */
export const PAGE_FAILURES = [
  "no_devices",
  "undelivered",
  "unsupported",
  "not_configured",
  "over_limit",
  "dead_lettered",
  "nobody_on_call",
  "schedule_missing",
  "not_a_member",
  "escalation_stalled",
] as const;
export type PageFailure = (typeof PAGE_FAILURES)[number];

export type NotificationFailed = DomainEvent<
  "notification.failed",
  {
    incidentId: string;
    /** The event that asked for the page, so a consumer can tell which page failed. */
    eventId: string;
    channel: "push";
    /** The member who was not paged; null when the page had nobody to go to. */
    userId: string | null;
    reason: PageFailure;
    /** The schedule nobody was on call for (`nobody_on_call`); null otherwise. */
    schedule: string | null;
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
      },
    };
    return ok(event);
  },
});
