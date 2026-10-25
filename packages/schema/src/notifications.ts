// What notifiers report back (RFC 0005 "Notifiers"). A page that reached nobody is a state change: it goes on the
// incident's timeline, where responders look, and out as `notification.failed`, like every change.

import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { appendTimeline } from "./timeline.ts";
import { v } from "./validate.ts";

/**
 * Why a page reached nobody (or not one member):
 * - `no_devices`: the member has no device registered (with `userId: null`, no one the page was for has one);
 * - `undelivered`: the relay or the push service kept failing for every device of the member;
 * - `unsupported`: the member's devices are all on a platform the relay cannot reach yet (Android until FCM);
 * - `not_configured`: this instance has no push relay set up;
 * - `over_limit`: the page went to more devices than one page sends to (`MAX_PAGE_DEVICES`), and none of the
 *   member's were among them;
 * - `dead_lettered`: the event kept failing before anything was recorded (the shard was unreachable or threw) and
 *   the Queue gave up on it, so whether anyone was paged is unknown (`userId: null`).
 */
export const PAGE_FAILURES = [
  "no_devices",
  "undelivered",
  "unsupported",
  "not_configured",
  "over_limit",
  "dead_lettered",
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
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(
      store,
      incident,
      { kind: "page_failed", userId: args.userId, reason: args.reason },
      ctx,
    );
    const event: NotificationFailed = {
      type: "notification.failed",
      subject: incident.id,
      data: { ...args, channel: "push" },
    };
    return ok(event);
  },
});
