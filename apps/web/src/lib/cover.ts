// The overview's cover strip: who each schedule pages over the next hours, laid out as a lane of segments. The
// segments are `nextHandoffs` (RFC 0003 "Schedules"), cut to the window and placed in percent of it; a segment
// without a member is a gap, nobody on call.
import { nextHandoffs, type OverrideRow, type ScheduleRow } from "@freecorps/brigade-schema";

const HOUR = 60 * 60 * 1000;

/** How far ahead the strip looks: today's night and tomorrow's morning, the handoffs people plan around. */
export const COVER_MS = 24 * HOUR;

/** Lanes on the overview before "N more": past that, the On call page has them all. */
export const COVER_LANES = 6;

/** At most this many handoffs in one lane: an hourly rotation fills 24, and a lane is never wider than the window. */
const MAX_SEGMENTS = 48;

export type CoverSegment = {
  start: number;
  end: number;
  /** Null: nobody on call. */
  userId: string | null;
  /** Where it starts and how wide it is, in percent of the window. */
  left: number;
  width: number;
};

/** One schedule's lane from `now` to `now + span`. */
export function coverLane(
  schedule: Pick<ScheduleRow, "id" | "timeZone" | "layers">,
  overrides: readonly OverrideRow[],
  now: number,
  span = COVER_MS,
): CoverSegment[] {
  const until = now + span;
  return nextHandoffs(schedule, overrides, now, until, MAX_SEGMENTS).map((segment) => {
    const end = Math.min(segment.end, until);
    return {
      start: segment.start,
      end,
      userId: segment.userId,
      left: ((segment.start - now) / span) * 100,
      width: ((end - segment.start) / span) * 100,
    };
  });
}

/**
 * The strip's hour marks: every `every` hours on the viewer's clock (00:00, 06:00, 12:00, 18:00) inside the window,
 * each with its place in percent. On the viewer's clock (`timeZone`), not UTC's, so 06:00 is when their morning
 * starts; a zone with a half-hour offset still reads its whole hours at a UTC quarter, so the walk steps by 15 minutes.
 */
export function coverTicks(
  now: number,
  timeZone: string,
  span = COVER_MS,
  every = 6,
): { at: number; left: number }[] {
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const quarter = HOUR / 4;
  const ticks: { at: number; left: number }[] = [];
  for (let at = Math.ceil(now / quarter) * quarter; at < now + span; at += quarter) {
    const parts = clock.formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    // A clock that turns back reads the same hour twice: one mark for it.
    const last = ticks.at(-1);
    if (minute !== 0 || hour % every !== 0 || (last && at - last.at < 2 * HOUR)) continue;
    ticks.push({ at, left: ((at - now) / span) * 100 });
  }
  return ticks;
}

/**
 * A member's tint, the same wherever they appear on the overview: one of four, picked from their id, so two people
 * side by side usually differ. Identity, not state: it stays pale, and a gap is never one of them.
 */
export function memberTint(userId: string): 0 | 1 | 2 | 3 {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 4) as 0 | 1 | 2 | 3;
}
