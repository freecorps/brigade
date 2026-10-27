// Reminders of follow-ups due (RFC 0013 "Reminders"): once a day, each member who owns open follow-ups due that day
// or overdue gets one email listing them, at `REMINDER_HOUR` on their own clock (their devices' time zone, else UTC).
// The shard's alarm asks `remindersDue` who is due and runs `followUp.remind` for each, which keeps the day in a
// server-only ledger (at most one per member per day) and emits `follow_up.reminder_due` through the outbox; the queue
// consumer's email path sends it. Nothing here is on a paging path.

import { byDue, isDueDate } from "./followups.ts";
import { memberEmailOf } from "./member-email.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import type { Store } from "./store.ts";
import type { BrigadeTables, FollowUpRow, MemberSettingsRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";
import { canonicalTimeZone, localMinute, wallMinute, wallParts, zonedInstant } from "./zoned.ts";

/** The hour of the member's day a reminder goes out (09:00), in their time zone, or UTC without one. */
export const REMINDER_HOUR = 9;
/** The most follow-ups one reminder lists; the rest are counted ("and 3 more"). */
export const REMINDER_MAX_LISTED = 20;

type ReadStore = Pick<Store<BrigadeTables>, "scan" | "get">;

/** The time zone a member's reminders follow: the one their devices sent, if the runtime still knows it, else UTC. */
export function reminderTimeZone(
  settings: Pick<MemberSettingsRow, "timeZone"> | undefined,
): string {
  const zone = settings?.timeZone;
  return (zone && canonicalTimeZone(zone)) || "UTC";
}

/** The calendar day (`YYYY-MM-DD`) `at` falls on in `timeZone`. */
export function localDate(at: number, timeZone: string): string {
  return wallParts(localMinute(at, timeZone)).date;
}

/** The day after `date` (`YYYY-MM-DD`). */
function nextDay(date: string): string {
  return wallParts(wallMinute(date, "00:00")! + 24 * 60).date;
}

/** A member's open follow-ups due on `date` or before it, soonest due first. */
export function followUpsDue(
  rows: readonly FollowUpRow[],
  userId: string,
  date: string,
): FollowUpRow[] {
  return rows
    .filter(
      (row) =>
        row.status === "open" &&
        row.ownerId === userId &&
        row.dueDate !== null &&
        row.dueDate <= date,
    )
    .sort(byDue);
}

/**
 * Per owner of an open follow-up with a due date who wants reminders, the earliest due date among theirs. Members
 * who turned reminders off are left out.
 */
function owners(store: ReadStore): Map<string, string> {
  const settings = store.scan("member_settings");
  const earliest = new Map<string, string>();
  for (const row of store.scan("follow_ups")) {
    if (row.status !== "open" || row.ownerId === null || row.dueDate === null) continue;
    const known = earliest.get(row.ownerId);
    if (known === undefined || row.dueDate < known) earliest.set(row.ownerId, row.dueDate);
  }
  for (const userId of earliest.keys()) {
    if (!memberEmailOf(settings, userId).followUpReminders) earliest.delete(userId);
  }
  return earliest;
}

/**
 * When the member's next reminder is due: `REMINDER_HOUR` on the first day that is today or later, not before their
 * earliest due date, and after the last day they were reminded.
 */
function reminderAt(store: ReadStore, userId: string, earliest: string, now: number): number {
  const zone = reminderTimeZone(store.get("member_settings", userId));
  const today = localDate(now, zone);
  const last = store.get("follow_up_reminders", userId)?.date;
  let day = earliest > today ? earliest : today;
  if (last !== undefined && last >= day) day = nextDay(last);
  const hour = `${String(REMINDER_HOUR).padStart(2, "0")}:00`;
  return zonedInstant(wallMinute(day, hour)!, zone);
}

/** The members whose reminder is due at `now`, each with the day (their calendar) it is for. */
export function remindersDue(store: ReadStore, now: number): { userId: string; date: string }[] {
  const due: { userId: string; date: string }[] = [];
  for (const [userId, earliest] of owners(store)) {
    if (reminderAt(store, userId, earliest, now) > now) continue;
    due.push({
      userId,
      date: localDate(now, reminderTimeZone(store.get("member_settings", userId))),
    });
  }
  return due;
}

/** When the next reminder in the workspace is due (now or earlier when one is due already), or null for none. */
export function nextReminderAt(store: ReadStore, now: number): number | null {
  let next: number | null = null;
  for (const [userId, earliest] of owners(store)) {
    const at = reminderAt(store, userId, earliest, now);
    if (next === null || at < next) next = at;
  }
  return next;
}

export type FollowUpReminderDue = DomainEvent<
  "follow_up.reminder_due",
  { userId: string; date: string; count: number }
>;

const day: Validator<string> = (input, path = "") =>
  isDueDate(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a date as YYYY-MM-DD" }] };

/**
 * Server only, from the shard's alarm: records that `userId` is reminded for `date` and emits
 * `follow_up.reminder_due`, which the email path turns into the email. A member already reminded that day (or a later
 * one), who turned reminders off, or with nothing due is a `conflict`.
 */
export const remindFollowUps = defineMutation({
  name: "followUp.remind",
  args: v.object({ userId: v.string({ min: 1, max: 64 }), date: day }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "system") return fail("forbidden", "Only Brigade sends reminders");
    if (!memberEmailOf(store.scan("member_settings"), args.userId).followUpReminders) {
      return fail("conflict", "Reminders are off");
    }
    const due = followUpsDue(store.scan("follow_ups"), args.userId, args.date);
    if (due.length === 0) return fail("conflict", "Nothing is due");
    const last = store.get("follow_up_reminders", args.userId);
    if (last && last.date >= args.date) return fail("conflict", "Already reminded");
    const row = { id: args.userId, date: args.date, at: ctx.now };
    if (last) store.update("follow_up_reminders", args.userId, row);
    else store.insert("follow_up_reminders", row);
    const event: FollowUpReminderDue = {
      type: "follow_up.reminder_due",
      subject: args.userId,
      data: { userId: args.userId, date: args.date, count: due.length },
    };
    return ok(event);
  },
});
