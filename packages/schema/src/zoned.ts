// Wall-clock time in an IANA time zone with `Intl` alone (no Temporal: Workers, browsers and Hermes differ in
// what they ship). On-call handoffs happen at a local wall-clock time (RFC 0003 "Schedules"), so a schedule needs
// two conversions: an instant to its local wall-clock minute, and a local wall-clock minute back to an instant.
//
// A "local minute" counts minutes since 1970-01-01T00:00 on the zone's wall clock, as if the zone were UTC: one
// local day is always 1440 local minutes, whatever the zone's offset did that day.

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// Keyed on canonical names only (what `canonicalTimeZone` returns and schedules store), so odd spellings sent to
// the validator ("america/sao_paulo") cannot grow it past the runtime's list of zones.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    era: "short",
  });
  const canonical = format.resolvedOptions().timeZone;
  const known = formatters.get(canonical);
  if (known) return known;
  if (canonical === timeZone) formatters.set(canonical, format);
  return format;
}

/**
 * The runtime's own spelling of `value` as an IANA time zone (or "UTC"): "america/sao_paulo" is
 * "America/Sao_Paulo". Undefined if the runtime does not know it.
 */
export function canonicalTimeZone(value: string): string | undefined {
  try {
    return formatter(value).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Whether the runtime knows `value` as an IANA time zone (or "UTC"). */
export function isTimeZone(value: string): boolean {
  return canonicalTimeZone(value) !== undefined;
}

/** The zone's offset from UTC at `instant`, in milliseconds (east positive). */
export function zoneOffset(instant: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const part of formatter(timeZone).formatToParts(instant)) parts[part.type] = part.value;
  const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
  const wall = Date.UTC(
    year,
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  // `Date.UTC` maps years 0-99 to 1900-1999; nothing here comes near them.
  return wall - (instant - (((instant % 1000) + 1000) % 1000));
}

/** The zone's wall-clock minute at `instant` (seconds dropped). */
export function localMinute(instant: number, timeZone: string): number {
  return Math.floor((instant + zoneOffset(instant, timeZone)) / MINUTE_MS);
}

/**
 * The instant the zone's wall clock shows `minute`. Like Temporal's `"compatible"` disambiguation: a time that
 * happens twice (clocks set back) is the earlier one; a time that never happens (clocks set forward) is moved
 * forward by the gap (02:30 in a 02:00 → 03:00 gap is 03:30).
 */
export function zonedInstant(minute: number, timeZone: string): number {
  const wall = minute * MINUTE_MS;
  // Zones change offset at most once in a day around any wall time, and no jump is longer than a day. The
  // longest is Pacific/Apia's: it skipped 2011-12-30 whole (-10:00 to +14:00, across the date line), so every
  // minute of that day is a gap and lands a day later, on the 31st at the same wall time.
  const before = zoneOffset(wall - DAY_MS, timeZone);
  const after = zoneOffset(wall + DAY_MS, timeZone);
  const valid = [before, after]
    .map((offset) => wall - offset)
    .filter((instant) => localMinute(instant, timeZone) === minute);
  if (valid.length > 0) return Math.min(...valid);
  // A gap: read the wall time with the offset from before the jump, which lands as far past it.
  return wall - before;
}

/** `YYYY-MM-DD` and `HH:MM` as a local minute; undefined if either is not a real date or time. */
export function wallMinute(date: string, time: string): number | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return undefined;
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  if (hour > 23 || minute > 59) return undefined;
  const utc = Date.UTC(year, month - 1, day);
  const back = new Date(utc);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  )
    return undefined;
  return utc / MINUTE_MS + hour * 60 + minute;
}

/** A local minute as `{ date: "YYYY-MM-DD", time: "HH:MM", weekday: 0 (Sunday) to 6 }`. */
export function wallParts(minute: number): { date: string; time: string; weekday: number } {
  const at = new Date(minute * MINUTE_MS);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return {
    date: `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`,
    time: `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}`,
    weekday: at.getUTCDay(),
  };
}
