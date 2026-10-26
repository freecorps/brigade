// The on-call screen's logic (RFC 0003 "Schedules"): the member's own shifts and overrides, and who each schedule
// has now, from the shard's schedules and overrides through `nextHandoffs`. String-free except `statusTime`; the
// wording shared with the dashboard is in `@freecorps/brigade-i18n/oncall`.
import { formatDateTime, type Locale } from "@freecorps/brigade-i18n";
import { nextHandoffs, type OverrideRow, type ScheduleRow } from "@freecorps/brigade-schema";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How far ahead the screen looks for shifts, as the dashboard's card does. */
export const UPCOMING_MS = 28 * DAY;
/** Handoffs worked out per schedule: enough to find the member's next few in a fast rotation. */
const SEGMENTS = 60;
/** The member's next shifts shown, across every schedule. */
export const NEXT_SHOWN = 8;
/** Overrides a responder can add for themselves from the app, in hours from now. */
export const COVER_HOURS = [1, 4, 12, 24] as const;

/**
 * A stretch on call: `end` is the handoff that ends it, or null when there is none within `UPCOMING_MS` (only the
 * screen's look-ahead ends it, which is no time to show). `override`: an override puts them there.
 */
export type Shift = { schedule: ScheduleRow; start: number; end: number | null; override: boolean };

/** Who a schedule has on call now (null: nobody, a gap), and until when. */
export type ScheduleNow = {
  schedule: ScheduleRow;
  userId: string | null;
  override: boolean;
  until: number | null;
};

export type OnCallView = {
  /** Every schedule, in the shard's order (by name). */
  schedules: ScheduleNow[];
  /** The member's shifts now, the one ending first first. */
  current: Shift[];
  /** The member's next shifts, soonest first, at most `NEXT_SHOWN`. */
  next: Shift[];
  /** The member's overrides that have not ended, soonest first, with their schedule. */
  overrides: { row: OverrideRow; schedule: ScheduleRow }[];
};

/** The member's on-call picture at `now`. Overrides of a schedule the shard no longer has are left out. */
export function onCallView(
  schedules: readonly ScheduleRow[],
  overrides: readonly OverrideRow[],
  userId: string,
  now: number,
): OnCallView {
  const view: OnCallView = { schedules: [], current: [], next: [], overrides: [] };
  for (const schedule of schedules) {
    const segments = nextHandoffs(schedule, overrides, now, now + UPCOMING_MS, SEGMENTS);
    // The last segment ends where the look-ahead (or the walk) stopped, not at a handoff.
    const end = (index: number) =>
      index < segments.length - 1 ? (segments[index]?.end ?? null) : null;
    const first = segments[0];
    view.schedules.push({
      schedule,
      userId: first?.userId ?? null,
      override: first?.source?.kind === "override",
      until: end(0),
    });
    segments.forEach((segment, index) => {
      if (segment.userId !== userId) return;
      const shift: Shift = {
        schedule,
        start: segment.start,
        end: end(index),
        override: segment.source?.kind === "override",
      };
      (index === 0 ? view.current : view.next).push(shift);
    });
  }
  const ends = (shift: Shift) => shift.end ?? Infinity;
  view.current.sort((a, b) => ends(a) - ends(b));
  view.next.sort((a, b) => a.start - b.start);
  view.next = view.next.slice(0, NEXT_SHOWN);
  const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  view.overrides = overrides
    .filter((row) => row.userId === userId && row.end > now)
    .flatMap((row) => {
      const schedule = byId.get(row.scheduleId);
      return schedule ? [{ row, schedule }] : [];
    })
    .sort((a, b) => a.row.start - b.row.start || a.row.end - b.row.end);
  return view;
}

/**
 * What the incident list says about the member: on call (until the last of their current shifts ends, or with no
 * end in sight), off with a next shift, off with none coming, or no schedules at all.
 */
export type OnCallStatus =
  | { kind: "on"; until: number | null; schedules: number }
  | { kind: "off"; next: number | null }
  | { kind: "none" };

export function onCallStatus(view: OnCallView): OnCallStatus {
  if (view.schedules.length === 0) return { kind: "none" };
  if (view.current.length > 0) {
    const open = view.current.some((shift) => shift.end === null);
    const until = open ? null : Math.max(...view.current.map((shift) => shift.end ?? 0));
    return { kind: "on", until, schedules: view.current.length };
  }
  return { kind: "off", next: view.next[0]?.start ?? null };
}

/**
 * A time on the viewer's clock, as short as still clear: "9:00 AM" today, "Tue 9:00 AM" within the week,
 * "Nov 3, 9:00 AM" beyond.
 */
export function statusTime(at: number, now: number, locale: Locale, timeZone: string): string {
  const day = (instant: number) =>
    formatDateTime(instant, locale, timeZone, {
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });
  const time = formatDateTime(at, locale, timeZone, { timeStyle: "short" });
  if (day(at) === day(now)) return time;
  const date =
    at - now < 6 * DAY
      ? formatDateTime(at, locale, timeZone, { weekday: "short" })
      : formatDateTime(at, locale, timeZone, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

/**
 * `schedule.addOverride`'s arguments for the member covering `scheduleId` from now (on a whole minute, as the shard
 * wants) for `hours`.
 */
export function coverArgs(scheduleId: string, userId: string, now: number, hours: number) {
  const start = Math.floor(now / MINUTE) * MINUTE;
  return { scheduleId, userId, start, end: start + hours * HOUR };
}
