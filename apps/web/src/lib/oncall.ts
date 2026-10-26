// The On-call card's logic, string-free where it can be (RFC 0003 "Schedules"): drafts for the schedule and
// override forms, checked the way `schedule.create`, `schedule.update` and `schedule.addOverride` will check them,
// and the wall-clock conversions in a schedule's own time zone.
import { formatDateTime, m, type Locale } from "@freecorps/brigade-i18n";
import { offsetLabel, zoneLabel } from "@freecorps/brigade-i18n/oncall";
import {
  canonicalTimeZone,
  LAYER_NAME_MAX,
  layerShiftAt,
  localMinute,
  MAX_LAYER_MEMBERS,
  MAX_LAYERS_PER_SCHEDULE,
  MAX_OVERRIDE_MS,
  MAX_SCHEDULES_PER_WORKSPACE,
  MAX_SHIFT_COUNT,
  newId,
  ROTATION_UNITS,
  SCHEDULE_NAME_MAX,
  trimSpace,
  wallMinute,
  wallParts,
  zonedInstant,
  type MemberRow,
  type OnCallSegment,
  type RotationUnit,
  type ScheduleLayer,
  type ScheduleRow,
} from "@freecorps/brigade-schema";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How far ahead the card looks for handoffs. */
export const UPCOMING_MS = 28 * 24 * HOUR;
/** Handoffs shown per schedule. */
export const UPCOMING_SHOWN = 4;
/** People of a rotation shown before "+N more": who has the shift now and the next three. */
export const ROTATION_SHOWN = 4;

export type LayerDraft = Omit<ScheduleLayer, "count"> & { count: string };
export type ScheduleDraft = { name: string; timeZone: string; layers: LayerDraft[] };

/** Every field a schedule draft can get wrong; layer fields carry the layer's index. */
export type ScheduleErrors = {
  name?: true;
  timeZone?: true;
  layers: {
    name?: true;
    members?: "empty" | "too_many";
    startDate?: true;
    handoffTime?: true;
    count?: true;
  }[];
};

/** The browser's time zone, as the runtime spells it, or UTC when it has none the runtime knows. */
export function browserTimeZone(): string {
  try {
    return canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** The runtime's time zones (with UTC), each in the runtime's own spelling; just UTC without a list. */
export function timeZones(): string[] {
  let zones: string[] = [];
  try {
    zones =
      (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ??
      [];
  } catch {
    zones = [];
  }
  return [...new Set(["UTC", ...zones])].sort();
}

/** Today's date on `timeZone`'s wall clock, `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: number): string {
  return wallParts(localMinute(now, timeZone)).date;
}

/** A new layer, unnamed: it reads as "Primary", "Layer 2" in each reader's language (`layerName`). */
export function newLayer(timeZone: string, now: number): LayerDraft {
  return {
    id: newId("lyr", now, random),
    name: "",
    members: [],
    startDate: todayIn(timeZone, now),
    handoffTime: "09:00",
    unit: "weeks",
    count: "1",
  };
}

export function emptySchedule(now: number): ScheduleDraft {
  const timeZone = browserTimeZone();
  return { name: "", timeZone, layers: [newLayer(timeZone, now)] };
}

/**
 * The draft with its time zone changed. A layer still starting "today" in the old zone starts today in the new
 * one (in Tokyo it may already be tomorrow); a date someone picked stays.
 */
export function withTimeZone(draft: ScheduleDraft, timeZone: string, now: number): ScheduleDraft {
  const before = todayIn(draft.timeZone, now);
  const after = todayIn(timeZone, now);
  return {
    ...draft,
    timeZone,
    layers: draft.layers.map((layer) =>
      layer.startDate === before ? { ...layer, startDate: after } : layer,
    ),
  };
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

/**
 * The draft without anyone who can no longer hold a shift: viewers and people gone from `members` (the shard's
 * list), which the shard would refuse. A schedule normally has none (a member made a viewer or removed leaves the
 * rotations in the same change), but one left behind would make every save fail, so the editor drops them when it
 * opens and says so. `members` must be the loaded list: an empty one drops nobody.
 */
export function draftMembers(
  draft: ScheduleDraft,
  members: readonly MemberRow[],
): { draft: ScheduleDraft; dropped: boolean } {
  if (members.length === 0) return { draft, dropped: false };
  const able = new Set(
    members.filter((member) => member.role !== "viewer").map((member) => member.id),
  );
  let dropped = false;
  const layers = draft.layers.map((layer) => {
    const kept = layer.members.filter((id) => able.has(id));
    if (kept.length === layer.members.length) return layer;
    dropped = true;
    return { ...layer, members: kept };
  });
  return { draft: dropped ? { ...draft, layers } : draft, dropped };
}

/** A layer's name, or "Primary" / "Layer 2" (by position) in the reader's language when it has none. */
export function layerName(layer: Pick<ScheduleLayer, "name">, index: number): string {
  return layer.name.trim() || m.oncall_layer_name({ number: String(index + 1) });
}

export type CheckedSchedule =
  | {
      ok: true;
      args: { id: string; name: string; timeZone: string; layers: ScheduleLayer[] };
    }
  | { ok: false; errors: ScheduleErrors };

const hasErrors = (errors: ScheduleErrors) =>
  errors.name || errors.timeZone || errors.layers.some((layer) => Object.keys(layer).length > 0);

/**
 * The draft as `schedule.create` / `schedule.update` arguments, or what is wrong with it. Who may be in a layer is
 * settled when the editor opens (`draftMembers`) and by the picker (`rotationChoices`), so here only an empty or
 * overfull layer is wrong.
 */
export function checkSchedule(id: string, draft: ScheduleDraft): CheckedSchedule {
  const errors: ScheduleErrors = { layers: draft.layers.map(() => ({})) };
  const name = trimSpace(draft.name);
  if (name.length === 0 || name.length > SCHEDULE_NAME_MAX) errors.name = true;
  const timeZone = canonicalTimeZone(draft.timeZone);
  if (!timeZone) errors.timeZone = true;
  const layers: ScheduleLayer[] = draft.layers.map((layer, index) => {
    const issues: ScheduleErrors["layers"][number] = {};
    errors.layers[index] = issues;
    if (trimSpace(layer.name).length > LAYER_NAME_MAX) issues.name = true;
    if (layer.members.length === 0) issues.members = "empty";
    else if (layer.members.length > MAX_LAYER_MEMBERS) issues.members = "too_many";
    const date = wallMinute(layer.startDate, "00:00");
    if (date === undefined || layer.startDate < "2000-01-01" || layer.startDate > "2099-12-31") {
      issues.startDate = true;
    }
    if (wallMinute("2000-01-01", layer.handoffTime) === undefined) issues.handoffTime = true;
    const count = Number(layer.count);
    if (!/^\d+$/.test(layer.count.trim()) || count < 1 || count > MAX_SHIFT_COUNT[layer.unit]) {
      issues.count = true;
    }
    return { ...layer, name: trimSpace(layer.name), count };
  });
  if (hasErrors(errors) || !timeZone) return { ok: false, errors };
  return { ok: true, args: { id, name, timeZone, layers } };
}

/**
 * For each layer, whether a later one has someone at every moment it could: a later layer with people that starts
 * no later than this one hides it for good (layers stack, RFC 0003 "Schedules").
 */
export function hiddenLayers(
  layers: readonly Pick<ScheduleLayer, "members" | "startDate" | "handoffTime">[],
): boolean[] {
  const start = (layer: (typeof layers)[number]) => wallMinute(layer.startDate, layer.handoffTime);
  return layers.map((layer, index) => {
    const own = start(layer);
    if (own === undefined) return false;
    return layers.slice(index + 1).some((later) => {
      const from = start(later);
      return later.members.length > 0 && from !== undefined && from <= own;
    });
  });
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

export const newScheduleId = (now: number) => newId("sch", now, random);
export const newOverrideId = (now: number) => newId("ovr", now, random);

export const canAddSchedule = (count: number) => count < MAX_SCHEDULES_PER_WORKSPACE;
export const canAddLayer = (count: number) => count < MAX_LAYERS_PER_SCHEDULE;
export const canAddMember = (count: number) => count < MAX_LAYER_MEMBERS;
export { MAX_LAYER_MEMBERS, ROTATION_UNITS, type RotationUnit };
// The wording the app's on-call screen shares (`@freecorps/brigade-i18n/oncall`).
export {
  fromNow,
  handoffTime,
  memberLabel,
  offsetLabel,
  scheduleRefusal,
  text,
  viewerTime,
  zoneLabel,
} from "@freecorps/brigade-i18n/oncall";

// ---- A layer on the dashboard -------------------------------------------------------------------------------------

export type LayerNow =
  | { state: "empty" }
  | { state: "starts"; at: number }
  | { state: "active" | "hidden" | "overridden"; userId: string; shift: number };

/**
 * Who `layer` has on call at `now`, and whether that is who is on call: `current` is the schedule's segment at
 * `now` (from `nextHandoffs`). A layer with someone that does not win is hidden by a later layer or covered by an
 * override.
 */
export function layerNow(
  layer: ScheduleLayer,
  timeZone: string,
  now: number,
  current: OnCallSegment | undefined,
): LayerNow {
  if (layer.members.length === 0) return { state: "empty" };
  const shift = layerShiftAt(layer, timeZone, now);
  if (!shift) {
    const start = wallMinute(layer.startDate, layer.handoffTime);
    return start === undefined
      ? { state: "empty" }
      : { state: "starts", at: zonedInstant(start, timeZone) };
  }
  const userId = layer.members[shift.k % layer.members.length] ?? "";
  const source = current?.source;
  const state =
    source?.kind === "override"
      ? "overridden"
      : source?.kind === "layer" && source.layerId === layer.id
        ? "active"
        : "hidden";
  return { state, userId, shift: shift.k };
}

/** The rotation from the member holding shift `k` on, wrapping around: who is on now, then who is next. */
export function rotationFrom(members: readonly string[], k: number): string[] {
  if (members.length === 0) return [];
  const first = k % members.length;
  return [...members.slice(first), ...members.slice(0, first)];
}

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

/**
 * Starts at the next whole hour on the schedule's wall clock (10:00 in Kathmandu, not 09:15 there because it is a
 * whole hour in UTC) and runs 12 hours: covering a night.
 */
export function emptyOverride(userId: string, timeZone: string, now: number): OverrideDraft {
  const minute = (Math.floor(localMinute(now, timeZone) / 60) + 1) * 60;
  const start = zonedInstant(minute, timeZone);
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

/**
 * "Weekly, hands off Monday at 9:00 AM", in the schedule's own words. Hourly shifts that fit a day evenly a few
 * times list each time ("Every 12 hours, hands off at 8:00 AM and 8:00 PM"); others drift across the day, so they
 * say when they start ("Every 5 hours, starting Oct 5 at 8:00 AM").
 */
export function layerRhythm(layer: ScheduleLayer, locale: Locale): string {
  const length = m.oncall_shift_length({ unit: layer.unit, count: layer.count }, { locale });
  const minute = wallMinute(layer.startDate, layer.handoffTime);
  if (minute === undefined) return length;
  // The wall clock as if it were UTC: the time and weekday the layer says, whatever the zone.
  const clock = (at: number) => formatDateTime(at * MINUTE, locale, "UTC", { timeStyle: "short" });
  const day = formatDateTime(minute * MINUTE, locale, "UTC", { weekday: "long" });
  let handoff: string;
  if (layer.unit !== "hours" || layer.count % 24 === 0) {
    handoff = m.oncall_handoff({ unit: layer.unit, day, time: clock(minute) }, { locale });
  } else if (24 % layer.count === 0 && 24 / layer.count <= 4) {
    const times = Array.from({ length: 24 / layer.count }, (_, i) => minute + i * layer.count * 60)
      .map((at) => ({ at, of: at % 1440 }))
      .sort((a, b) => a.of - b.of)
      .map(({ at }) => clock(at));
    const time = new Intl.ListFormat(locale, { type: "conjunction" }).format(times);
    handoff = m.oncall_handoff({ unit: "hours", day, time }, { locale });
  } else {
    const date = formatDateTime(minute * MINUTE, locale, "UTC", { month: "short", day: "numeric" });
    handoff = m.oncall_handoff({ unit: "from", day: date, time: clock(minute) }, { locale });
  }
  return `${length}, ${handoff}`;
}

export type ZoneChoice = { value: string; label: string; offset: string; search: string };
export type ZoneGroup = { value: "suggested" | "all"; items: ZoneChoice[] };

/**
 * Lowercased, without accents, with `_` and `/` as spaces: "São_Paulo" and "sao paulo" match. `-` stays, since it
 * is an offset's sign ("utc-3"); a hyphenated name ("Port-au-Prince") is found by any of its parts.
 */
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[_/]+/g, " ");

/**
 * The time zone picker's choices at `now`: the viewer's zone and the zones the workspace's schedules already use
 * first, then every zone the runtime knows, each once, with its UTC offset and its current name (`zoneLabel`).
 */
export function zoneGroups(now: number, viewerZone: string, used: readonly string[]): ZoneGroup[] {
  const choice = (zone: string): ZoneChoice => {
    const offset = offsetLabel(zone, now);
    const label = zoneLabel(zone);
    // The label has the current name, `zone` the runtime's (older) one: either finds it.
    return { value: zone, label, offset, search: fold(`${label} ${zone} ${offset}`) };
  };
  // In this runtime's spelling, so each zone is listed once: V8 lists "Asia/Calcutta" (shown as "Asia/Kolkata")
  // and resolves "Asia/Kolkata" to it, so a schedule saved elsewhere as "Asia/Kolkata" matches the same entry.
  const suggested = [
    ...new Set(
      [viewerZone, ...used].flatMap((zone) => {
        const canonical = canonicalTimeZone(zone);
        return canonical ? [canonical] : [];
      }),
    ),
  ];
  // By the name shown, so "Asia/Kolkata" sits among the K's, not where "Asia/Calcutta" would.
  const rest = timeZones()
    .filter((zone) => !suggested.includes(zone))
    .map(choice)
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  return [
    { value: "suggested", items: suggested.map(choice) },
    { value: "all", items: rest },
  ];
}

/**
 * Whether a zone matches what was typed, anywhere in its name: "paulo", "new york", "kolkata", or an offset
 * ("+05:45", "utc-3", "-03").
 */
export function matchZone(zone: ZoneChoice, query: string): boolean {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => {
    if (zone.search.includes(word)) return true;
    // "utc-3" / "-3" / "+5:45" against "utc-03:00" / "utc+05:45".
    const offset = /^(?:utc|gmt)?([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(word);
    if (!offset) return false;
    const [, sign, hours = "", minutes] = offset;
    const wanted = `utc${sign}${hours.padStart(2, "0")}${minutes ? `:${minutes}` : ""}`;
    return zone.search.includes(wanted);
  });
}
