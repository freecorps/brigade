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

/** The most reminders one run of the shard's alarm sends; the rest go on the next run, a tick later. */
export const REMINDERS_PER_RUN = 50;

/** A member's email choices from their settings row alone (`memberEmailOf` without scanning the table). */
const choicesOf = (settings: MemberSettingsRow | undefined, userId: string) =>
  memberEmailOf(settings ? [settings] : [], userId);

/**
 * Per owner of an open follow-up with a due date who is still a member and wants reminders, the earliest due date
 * among theirs and their settings row. A removed member's follow-ups remind nobody until someone takes them over.
 */
function owners(
  store: ReadStore,
): Map<string, { earliest: string; settings: MemberSettingsRow | undefined }> {
  const earliest = new Map<string, string>();
  for (const row of store.scan("follow_ups")) {
    if (row.status !== "open" || row.ownerId === null || row.dueDate === null) continue;
    const known = earliest.get(row.ownerId);
    if (known === undefined || row.dueDate < known) earliest.set(row.ownerId, row.dueDate);
  }
  const wanted = new Map<string, { earliest: string; settings: MemberSettingsRow | undefined }>();
  for (const [userId, date] of earliest) {
    if (store.get("members", userId) === undefined) continue;
    const settings = store.get("member_settings", userId);
    if (!choicesOf(settings, userId).followUpReminders) continue;
    wanted.set(userId, { earliest: date, settings });
  }
  return wanted;
}

/**
 * When the member's next reminder is due: `REMINDER_HOUR` on the first day that is today or later, not before their
 * earliest due date, and after the last day they were reminded. With the calendar day it is for.
 */
function reminderAt(
  store: ReadStore,
  userId: string,
  owner: { earliest: string; settings: MemberSettingsRow | undefined },
  now: number,
): { at: number; zone: string } {
  const zone = reminderTimeZone(owner.settings);
  const today = localDate(now, zone);
  const last = store.get("follow_up_reminders", userId)?.date;
  let day = owner.earliest > today ? owner.earliest : today;
  if (last !== undefined && last >= day) day = nextDay(last);
  const hour = `${String(REMINDER_HOUR).padStart(2, "0")}:00`;
  return { at: zonedInstant(wallMinute(day, hour)!, zone), zone };
}

/**
 * The members whose reminder is due at `now`, each with the day (their calendar) it is for: at most `limit`, the
 * longest due first, so a run cut short leaves the rest for the next one. One pass over the follow-ups.
 */
export function remindersDue(
  store: ReadStore,
  now: number,
  limit = REMINDERS_PER_RUN,
): { userId: string; date: string }[] {
  const due: { userId: string; date: string; at: number }[] = [];
  for (const [userId, owner] of owners(store)) {
    const { at, zone } = reminderAt(store, userId, owner, now);
    if (at > now) continue;
    due.push({ userId, date: localDate(now, zone), at });
  }
  return due
    .sort((a, b) => a.at - b.at || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .slice(0, limit)
    .map(({ userId, date }) => ({ userId, date }));
}

/** When the next reminder in the workspace is due (now or earlier when one is due already), or null for none. */
export function nextReminderAt(store: ReadStore, now: number): number | null {
  let next: number | null = null;
  for (const [userId, owner] of owners(store)) {
    const { at } = reminderAt(store, userId, owner, now);
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
 * one), no longer a member, who turned reminders off, or with nothing due is a `conflict`.
 */
export const remindFollowUps = defineMutation({
  name: "followUp.remind",
  args: v.object({ userId: v.string({ min: 1, max: 64 }), date: day }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "system") return fail("forbidden", "Only Brigade sends reminders");
    if (store.get("members", args.userId) === undefined) return fail("conflict", "Not a member");
    if (!choicesOf(store.get("member_settings", args.userId), args.userId).followUpReminders) {
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
