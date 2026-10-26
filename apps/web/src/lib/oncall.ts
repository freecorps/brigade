// The On-call card's logic, string-free where it can be (RFC 0003 "Schedules"): drafts for the schedule and
// override forms, checked the way `schedule.create`, `schedule.update` and `schedule.addOverride` will check them,
// and the wall-clock conversions in a schedule's own time zone.
import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  isTimeZone,
  LAYER_NAME_MAX,
  localMinute,
  MAX_LAYER_MEMBERS,
  MAX_LAYERS_PER_SCHEDULE,
  MAX_OVERRIDE_MS,
  MAX_SCHEDULES_PER_WORKSPACE,
  MAX_SHIFT_COUNT,
  newId,
  ROTATION_UNITS,
  SCHEDULE_NAME_MAX,
  wallMinute,
  wallParts,
  zonedInstant,
  type MemberRow,
  type RotationUnit,
  type ScheduleLayer,
  type ScheduleRow,
} from "@freecorps/brigade-schema";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const HOUR = 60 * 60 * 1000;

/** How far ahead the card looks for handoffs. */
export const UPCOMING_MS = 28 * 24 * HOUR;
/** Handoffs shown per schedule. */
export const UPCOMING_SHOWN = 4;

export type LayerDraft = Omit<ScheduleLayer, "count"> & { count: string };
export type ScheduleDraft = { name: string; timeZone: string; layers: LayerDraft[] };

/** Every field a schedule draft can get wrong; layer fields carry the layer's index. */
export type ScheduleErrors = {
  name?: true;
  timeZone?: true;
  layers: { name?: true; members?: true; startDate?: true; handoffTime?: true; count?: true }[];
};

/** The browser's time zone, or UTC when it has none the runtime knows. */
export function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/** The time zones to offer: the runtime's list (with UTC and `current`), or just those two without one. */
export function timeZones(current: string): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ??
      [];
  } catch {
    zones = [];
  }
  return [...new Set(["UTC", current, ...zones])].filter(Boolean).sort();
}

/** Today's date on `timeZone`'s wall clock, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: number): string {
  return wallParts(localMinute(now, timeZone)).date;
}

export function newLayer(index: number, timeZone: string, now: number): LayerDraft {
  return {
    id: newId("lyr", now, random),
    name:
      index === 0
        ? m.oncall_layer_default()
        : m.oncall_layer_numbered({ number: String(index + 1) }),
    members: [],
    startDate: todayIn(timeZone, now),
    handoffTime: "09:00",
    unit: "weeks",
    count: "1",
  };
}

export function emptySchedule(now: number): ScheduleDraft {
  const timeZone = browserTimeZone();
  return { name: "", timeZone, layers: [newLayer(0, timeZone, now)] };
}

export function draftFromSchedule(row: ScheduleRow): ScheduleDraft {
  return {
    name: row.name,
    timeZone: row.timeZone,
    layers: row.layers.map((layer) => ({
      ...layer,
      members: [...layer.members],
      count: String(layer.count),
    })),
  };
}

export type CheckedSchedule =
  | {
      ok: true;
      args: { id: string; name: string; timeZone: string; layers: ScheduleLayer[] };
    }
  | { ok: false; errors: ScheduleErrors };

const hasErrors = (errors: ScheduleErrors) =>
  errors.name || errors.timeZone || errors.layers.some((layer) => Object.keys(layer).length > 0);

/** Whether `name` is something the shard will take for a name of up to `max` characters. */
const nameOk = (name: string, max: number) => name.trim().length > 0 && name.trim().length <= max;

/**
 * The draft as `schedule.create` / `schedule.update` arguments, or what is wrong with it. Members are checked
 * against `members` (the shard's list, which the card subscribes to): a viewer or someone gone is dropped from the
 * draft when it opens (`draftMembers`), so here only an empty layer is wrong.
 */
export function checkSchedule(id: string, draft: ScheduleDraft): CheckedSchedule {
  const errors: ScheduleErrors = { layers: draft.layers.map(() => ({})) };
  if (!nameOk(draft.name, SCHEDULE_NAME_MAX)) errors.name = true;
  if (!isTimeZone(draft.timeZone)) errors.timeZone = true;
  const layers: ScheduleLayer[] = draft.layers.map((layer, index) => {
    const issues: ScheduleErrors["layers"][number] = {};
    errors.layers[index] = issues;
    if (!nameOk(layer.name, LAYER_NAME_MAX)) issues.name = true;
    if (layer.members.length === 0 || layer.members.length > MAX_LAYER_MEMBERS)
      issues.members = true;
    const date = wallMinute(layer.startDate, "00:00");
    if (date === undefined || layer.startDate < "2000-01-01" || layer.startDate > "2099-12-31") {
      issues.startDate = true;
    }
    if (wallMinute("2000-01-01", layer.handoffTime) === undefined) issues.handoffTime = true;
    const count = Number(layer.count);
    if (!/^\d+$/.test(layer.count.trim()) || count < 1 || count > MAX_SHIFT_COUNT[layer.unit]) {
      issues.count = true;
    }
    return { ...layer, name: layer.name.trim(), count };
  });
  if (hasErrors(errors)) return { ok: false, errors };
  return { ok: true, args: { id, name: draft.name.trim(), timeZone: draft.timeZone, layers } };
}

/** Only the members who can hold a shift, to pick from: not viewers, by name. */
export function rotationChoices(members: readonly MemberRow[]): MemberRow[] {
  // Unnamed members last.
  const name = (member: MemberRow) => member.name ?? "";
  return members
    .filter((member) => member.role !== "viewer")
    .sort(
      (a, b) =>
        Number(!a.name) - Number(!b.name) ||
        name(a).localeCompare(name(b)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}

export function memberLabel(members: readonly MemberRow[], userId: string): string {
  return members.find((member) => member.id === userId)?.name || m.oncall_unnamed();
}

export const newScheduleId = (now: number) => newId("sch", now, random);
export const newOverrideId = (now: number) => newId("ovr", now, random);

export const canAddSchedule = (count: number) => count < MAX_SCHEDULES_PER_WORKSPACE;
export const canAddLayer = (count: number) => count < MAX_LAYERS_PER_SCHEDULE;
export { ROTATION_UNITS, type RotationUnit };

// ---- Overrides ----------------------------------------------------------------------------------------------------

/** A `datetime-local` value (`YYYY-MM-DDTHH:MM`) on `timeZone`'s wall clock at `instant`. */
export function localInput(instant: number, timeZone: string): string {
  const parts = wallParts(localMinute(instant, timeZone));
  return `${parts.date}T${parts.time}`;
}

/** The instant a `datetime-local` value means on `timeZone`'s wall clock, or undefined. */
export function fromLocalInput(value: string, timeZone: string): number | undefined {
  const [date, time] = value.split("T");
  const minute = date && time ? wallMinute(date, time.slice(0, 5)) : undefined;
  return minute === undefined ? undefined : zonedInstant(minute, timeZone);
}

export type OverrideDraft = { userId: string; start: string; end: string };

/** Starts at the next whole hour and runs 12 hours: covering a night. */
export function emptyOverride(userId: string, timeZone: string, now: number): OverrideDraft {
  const start = Math.ceil((now + 1) / HOUR) * HOUR;
  return {
    userId,
    start: localInput(start, timeZone),
    end: localInput(start + 12 * HOUR, timeZone),
  };
}

export type CheckedOverride =
  | { ok: true; args: { scheduleId: string; userId: string; start: number; end: number } }
  | { ok: false; errors: { userId?: true; start?: true; end?: true } };

export function checkOverride(
  scheduleId: string,
  timeZone: string,
  draft: OverrideDraft,
  now: number,
): CheckedOverride {
  const errors: { userId?: true; start?: true; end?: true } = {};
  if (!draft.userId) errors.userId = true;
  const start = fromLocalInput(draft.start, timeZone);
  const end = fromLocalInput(draft.end, timeZone);
  if (start === undefined) errors.start = true;
  if (
    end === undefined ||
    (start !== undefined && (end <= start || end - start > MAX_OVERRIDE_MS)) ||
    end <= now
  ) {
    errors.end = true;
  }
  if (Object.keys(errors).length > 0 || start === undefined || end === undefined)
    return { ok: false, errors };
  return { ok: true, args: { scheduleId, userId: draft.userId, start, end } };
}

// ---- Wording ------------------------------------------------------------------------------------------------------

/** "Weekly, hands off Monday at 09:00", in the schedule's own words. */
export function layerRhythm(layer: ScheduleLayer, locale: Locale): string {
  const length = m.oncall_shift_length({ unit: layer.unit, count: layer.count }, { locale });
  const minute = wallMinute(layer.startDate, layer.handoffTime);
  if (minute === undefined) return length;
  // The wall clock as if it were UTC: the time and weekday the layer says, whatever the zone.
  const at = minute * 60_000;
  const time = formatDateTime(at, locale, "UTC", { timeStyle: "short" });
  const handoff =
    layer.unit === "weeks"
      ? m.oncall_handoff_weekly(
          { day: formatDateTime(at, locale, "UTC", { weekday: "long" }), time },
          { locale },
        )
      : m.oncall_handoff_daily({ time }, { locale });
  return `${length}, ${handoff}`;
}

/** A handoff time in the schedule's zone: "Mon, Oct 27, 09:00". */
export function handoffTime(instant: number, timeZone: string, locale: Locale): string {
  return formatDateTime(instant, locale, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Why the shard refused a schedule change, in the shared wording, with this card's "gone". */
export function scheduleRefusal(code: string): string {
  if (code === "not_found") return m.oncall_gone();
  return mutationErrorReason(code);
}
