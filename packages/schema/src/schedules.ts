// On-call schedules (RFC 0003 "Schedules"): a schedule's layers (rotations) and overrides, the mutations that
// change them, and the pure functions that say who is on call at an instant (`onCallAt`) and when it changes
// (`nextHandoffs`). Nothing here changes who is paged yet: that waits for escalation policies (RFC 0006 "Who is
// paged").

import { can } from "./access.ts";
import { idTime } from "./id.ts";
import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import {
  defineMutation,
  fail,
  ok,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { OverrideRow, ScheduleLayer, ScheduleRow } from "./tables.ts";
import { v, type Issue, type Validator } from "./validate.ts";
import { canonicalTimeZone, localMinute, wallMinute, zonedInstant } from "./zoned.ts";

/** How a layer's shift length is counted: on the schedule's wall clock, so a day is midnight to midnight there. */
export const ROTATION_UNITS = ["hours", "days", "weeks"] as const;
export type RotationUnit = (typeof ROTATION_UNITS)[number];

/** The longest shift per unit: a week of hours, a month of days, a quarter of weeks. */
export const MAX_SHIFT_COUNT: Record<RotationUnit, number> = { hours: 168, days: 31, weeks: 13 };
const UNIT_MINUTES: Record<RotationUnit, number> = { hours: 60, days: 1440, weeks: 10_080 };

export const SCHEDULE_NAME_MAX = 80;
export const LAYER_NAME_MAX = 60;
export const MAX_SCHEDULES_PER_WORKSPACE = 50;
export const MAX_LAYERS_PER_SCHEDULE = 5;
export const MAX_LAYER_MEMBERS = 50;
/** Overrides that have not ended yet, per schedule. */
export const MAX_OVERRIDES_PER_SCHEDULE = 100;
export const MAX_OVERRIDE_MS = 90 * 24 * 60 * 60 * 1000;
/** An override that ended this long ago is deleted when the next one is added to its schedule. */
export const OVERRIDE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Handoffs and overrides are minutes on a clock; nothing finer. */
const MINUTE_MS = 60_000;
/** Start dates and override instants stay within these years. */
const FIRST = Date.UTC(2000, 0, 1);
const LAST = Date.UTC(2100, 0, 1);

export type ScheduleCreated = DomainEvent<
  "schedule.created",
  { id: string; name: string; timeZone: string; layers: number }
>;
/** `member_removed`: `userId` left the workspace or became a viewer, and was taken out of the rotations. */
export type ScheduleUpdated = DomainEvent<
  "schedule.updated",
  {
    id: string;
    name: string;
    timeZone: string;
    layers: number;
    reason: "edited" | "member_removed";
    userId: string | null;
  }
>;
export type ScheduleDeleted = DomainEvent<"schedule.deleted", { id: string; overrides: number }>;
export type ScheduleOverrideAdded = DomainEvent<
  "schedule.override_added",
  { id: string; scheduleId: string; userId: string; start: number; end: number }
>;
export type OverrideRemoval = "removed" | "member_removed" | "expired";
export type ScheduleOverrideRemoved = DomainEvent<
  "schedule.override_removed",
  { id: string; scheduleId: string; userId: string; reason: OverrideRemoval }
>;

// ---- Who is on call ---------------------------------------------------------------------------------------------

/** The local minute a layer's first shift starts, from its start date and handoff time. */
function startMinute(layer: Pick<ScheduleLayer, "startDate" | "handoffTime">): number | undefined {
  return wallMinute(layer.startDate, layer.handoffTime);
}

const periodMinutes = (layer: Pick<ScheduleLayer, "unit" | "count">) =>
  UNIT_MINUTES[layer.unit] * layer.count;

/** When shift `k` of a layer starts: its local start time plus `k` shift lengths, read on the zone's wall clock. */
function shiftStart(start: number, period: number, k: number, timeZone: string): number {
  return zonedInstant(start + k * period, timeZone);
}

/**
 * The shift of `layer` at `at`: its number `k` (0 is the first), when it starts and ends. Undefined before the
 * layer starts. A shift whose start falls in a skipped hour (clocks set forward) and whose next start falls there
 * too is empty and never returned.
 */
export function layerShiftAt(
  layer: ScheduleLayer,
  timeZone: string,
  at: number,
): { k: number; start: number; end: number } | undefined {
  const start = startMinute(layer);
  if (start === undefined) return undefined;
  const period = periodMinutes(layer);
  let k = Math.floor((localMinute(at, timeZone) - start) / period);
  // The guess comes from `at`'s own wall time, which is never inside a skipped range (not even Pacific/Apia's whole
  // 2011-12-30), so it is off by one at most around a transition; settle it on instants.
  for (let i = 0; i < 4 && k >= 0 && shiftStart(start, period, k, timeZone) > at; i++) k--;
  if (k < 0) {
    if (shiftStart(start, period, 0, timeZone) > at) return undefined;
    k = 0;
  }
  for (let i = 0; i < 4 && shiftStart(start, period, k + 1, timeZone) <= at; i++) k++;
  return {
    k,
    start: shiftStart(start, period, k, timeZone),
    end: shiftStart(start, period, k + 1, timeZone),
  };
}

export type OnCallSource =
  | { kind: "override"; overrideId: string }
  | { kind: "layer"; layerId: string };
export type OnCall = { userId: string; source: OnCallSource };

/** An override covers `[start, end)`. */
const covers = (override: Pick<OverrideRow, "start" | "end">, at: number) =>
  override.start <= at && at < override.end;

/**
 * Who is on call for `schedule` at `at`, or null when nobody is (a gap):
 * 1. an override of this schedule covering `at` wins over everything; of several, the one added last (the
 *    shard's `createdAt`, then the highest id: ids are minted by clients, so they only break a tie);
 * 2. otherwise the last layer that has someone at `at` (layers are stacked: a later layer wins where it has
 *    someone, an earlier one shows through where it does not);
 * 3. in a layer, shift `k` goes to its `k mod n`-th member, in the order listed. A layer before its start or with
 *    no members has nobody.
 */
export function onCallAt(
  schedule: Pick<ScheduleRow, "id" | "timeZone" | "layers">,
  overrides: readonly OverrideRow[],
  at: number,
): OnCall | null {
  let override: OverrideRow | undefined;
  for (const candidate of overrides) {
    if (candidate.scheduleId !== schedule.id || !covers(candidate, at)) continue;
    if (
      !override ||
      candidate.createdAt > override.createdAt ||
      (candidate.createdAt === override.createdAt && candidate.id > override.id)
    ) {
      override = candidate;
    }
  }
  if (override) {
    return { userId: override.userId, source: { kind: "override", overrideId: override.id } };
  }
  for (let index = schedule.layers.length - 1; index >= 0; index--) {
    const layer = schedule.layers[index];
    if (layer.members.length === 0) continue;
    const shift = layerShiftAt(layer, schedule.timeZone, at);
    if (!shift) continue;
    return {
      userId: layer.members[shift.k % layer.members.length],
      source: { kind: "layer", layerId: layer.id },
    };
  }
  return null;
}

/** A stretch of time with the same person on call (or nobody: `userId` null). */
export type OnCallSegment = {
  start: number;
  end: number;
  userId: string | null;
  source: OnCallSource | null;
};

/** At most this many layer handoffs are looked at per layer in one `nextHandoffs` call. */
const MAX_LAYER_BOUNDARIES = 2000;

/** A layer's handoffs after `from`, in order, one at a time. */
type Cursor = { next: number; advance: () => void; seen: number };

/**
 * `layer`'s handoffs after `from` and before `hiddenFrom` (when a later layer with people starts: from then on it
 * always has someone, so this layer never shows again and its handoffs change nothing).
 */
function layerCursor(
  layer: ScheduleLayer,
  timeZone: string,
  from: number,
  hiddenFrom: number,
): Cursor | undefined {
  const start = startMinute(layer);
  if (start === undefined || layer.members.length === 0) return undefined;
  const period = periodMinutes(layer);
  const first = shiftStart(start, period, 0, timeZone);
  const shown = (at: number) => (at < hiddenFrom ? at : Infinity);
  // One member holds every shift: the layer changes hands once, when it starts.
  if (layer.members.length === 1) {
    const cursor: Cursor = {
      next: first > from ? shown(first) : Infinity,
      advance: () => {
        cursor.next = Infinity;
      },
      seen: 0,
    };
    return cursor;
  }
  let k = first > from ? 0 : (layerShiftAt(layer, timeZone, from)?.k ?? -1) + 1;
  const cursor: Cursor = {
    next: shown(shiftStart(start, period, k, timeZone)),
    advance: () => {
      k++;
      cursor.seen++;
      cursor.next = shown(shiftStart(start, period, k, timeZone));
    },
    seen: 0,
  };
  return cursor;
}

/**
 * Who is on call from `from` until `until`, as consecutive segments: the first starts at `from` (with whoever is
 * on call then), each later one at a handoff, where the person on call changes. A layer handoff to the same
 * person (a one-member layer, or a layer hidden by a later one or an override) is no handoff. At most `limit`
 * segments; the last ends at the next handoff or at `until`.
 *
 * Handoffs are walked in order and the walk stops at the `limit`-th change, so the cost follows what is shown,
 * not how many shifts fit before `until`. A layer is not walked past the start of a later one with people: it
 * never shows again. A layer whose handoffs hide otherwise (behind a long override, say) is
 * walked for at most `MAX_LAYER_BOUNDARIES` of them: past that, the last segment ends where the walk stopped, not
 * at `until`.
 */
export function nextHandoffs(
  schedule: Pick<ScheduleRow, "id" | "timeZone" | "layers">,
  overrides: readonly OverrideRow[],
  from: number,
  until: number,
  limit = 10,
): OnCallSegment[] {
  if (!(until > from) || limit < 1) return [];
  // A layer with people has someone at every moment from its start on, so once a later one has started an earlier
  // one never shows again: its handoffs from then on are skipped, which keeps a fast rotation under a one-member
  // layer from walking `MAX_LAYER_BOUNDARIES` hidden handoffs on every call.
  const starts = schedule.layers.map((layer) => {
    const start = startMinute(layer);
    return start === undefined || layer.members.length === 0
      ? Infinity
      : shiftStart(start, periodMinutes(layer), 0, schedule.timeZone);
  });
  const cursors: Cursor[] = [];
  schedule.layers.forEach((layer, index) => {
    const hiddenFrom = Math.min(...starts.slice(index + 1));
    if (hiddenFrom <= from) return;
    const cursor = layerCursor(layer, schedule.timeZone, from, hiddenFrom);
    if (cursor) cursors.push(cursor);
  });
  const edges: number[] = [];
  for (const override of overrides) {
    if (override.scheduleId !== schedule.id) continue;
    for (const edge of [override.start, override.end])
      if (edge > from && edge < until) edges.push(edge);
  }
  edges.sort((a, b) => a - b);
  let edge = 0;

  const first = onCallAt(schedule, overrides, from);
  const segments: OnCallSegment[] = [
    { start: from, end: until, userId: first?.userId ?? null, source: first?.source ?? null },
  ];
  let horizon = until;
  for (;;) {
    let at = edge < edges.length ? edges[edge] : Infinity;
    for (const cursor of cursors) at = Math.min(at, cursor.next);
    if (at >= horizon) break;
    while (edge < edges.length && edges[edge] <= at) edge++;
    for (const cursor of cursors) {
      while (cursor.next <= at) {
        cursor.advance();
        if (cursor.seen >= MAX_LAYER_BOUNDARIES) {
          horizon = Math.min(horizon, cursor.next);
          cursor.next = Infinity;
        }
      }
    }
    const who = onCallAt(schedule, overrides, at);
    const userId = who?.userId ?? null;
    const last = segments[segments.length - 1];
    if (last.userId === userId) continue;
    last.end = at;
    if (segments.length === limit) return segments;
    segments.push({ start: at, end: until, userId, source: who?.source ?? null });
  }
  segments[segments.length - 1].end = horizon;
  return segments;
}

// ---- Validation -------------------------------------------------------------------------------------------------

const scheduleId = v.id("sch");
const layerId = v.id("lyr");
const overrideId = v.id("ovr");
// Better Auth user ids (`usr_<ULID>`), or the local dev actor's; membership is the real check.
const memberId = v.string({ min: 1, max: 64 });

const invalid = (path: string, message: string) => ({
  ok: false as const,
  issues: [{ path, message }],
});

/**
 * An IANA time zone the runtime knows (the schedule's handoffs are read on its wall clock), stored in the
 * runtime's own spelling: "america/sao_paulo" is saved as "America/Sao_Paulo", so one zone has one name.
 */
const timeZone: Validator<string> = (input, path = "") => {
  if (typeof input !== "string" || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(input)) {
    return invalid(path, "Expected an IANA time zone");
  }
  const canonical = canonicalTimeZone(input);
  return canonical ? { ok: true, value: canonical } : invalid(path, "Unknown time zone");
};

/** `YYYY-MM-DD`, a real date from 2000 to 2099. */
const date: Validator<string> = (input, path = "") => {
  const minute = typeof input === "string" ? wallMinute(input, "00:00") : undefined;
  if (minute === undefined || minute * MINUTE_MS < FIRST || minute * MINUTE_MS >= LAST) {
    return invalid(path, "Expected a date (YYYY-MM-DD) from 2000 to 2099");
  }
  return { ok: true, value: input as string };
};

/** `HH:MM`, 00:00 to 23:59. */
const clock: Validator<string> = (input, path = "") =>
  typeof input === "string" && wallMinute("2000-01-01", input) !== undefined
    ? { ok: true, value: input }
    : invalid(path, "Expected a time (HH:MM)");

/** An instant on a whole minute, from 2000 to 2099. */
const instant: Validator<number> = (input, path = "") =>
  typeof input === "number" &&
  Number.isSafeInteger(input) &&
  input % MINUTE_MS === 0 &&
  input >= FIRST &&
  input < LAST
    ? { ok: true, value: input }
    : invalid(path, "Expected a time on a whole minute, from 2000 to 2099");

const layerArgs = v.object({
  id: layerId,
  // Optional: an unnamed layer reads as "Primary", "Layer 2" in each reader's language, not the creator's.
  name: v.string({ max: LAYER_NAME_MAX }),
  members: v.array(memberId, { min: 1, max: MAX_LAYER_MEMBERS, unique: true }),
  startDate: date,
  handoffTime: clock,
  unit: v.picklist(ROTATION_UNITS),
  count: v.integer({ min: 1, max: MAX_SHIFT_COUNT.hours }),
});

const scheduleFields = {
  name: v.string({ min: 1, max: SCHEDULE_NAME_MAX }),
  timeZone,
  layers: v.array(layerArgs, { min: 1, max: MAX_LAYERS_PER_SCHEDULE }),
};

/** What `v.object` cannot say: a shift count within its unit, layer ids once, and rotations of members who can respond. */
function checkLayers(store: MutationStore, layers: readonly ScheduleLayer[]): Issue[] {
  const issues: Issue[] = [];
  const ids = new Set<string>();
  layers.forEach((layer, index) => {
    const at = `layers[${index}]`;
    if (ids.has(layer.id)) issues.push({ path: `${at}.id`, message: "Listed twice" });
    ids.add(layer.id);
    if (layer.count > MAX_SHIFT_COUNT[layer.unit]) {
      issues.push({
        path: `${at}.count`,
        message: `Expected at most ${MAX_SHIFT_COUNT[layer.unit]} ${layer.unit}`,
      });
    }
    layer.members.forEach((userId, position) => {
      const member = store.get("members", userId);
      // Viewers only read, so they never hold a shift (RFC 0003 "Schedules").
      if (!member || member.role === "viewer") {
        const message = member ? "Viewers cannot be on call" : "Not a member";
        issues.push({ path: `${at}.members[${position}]`, message });
      }
    });
  });
  return issues;
}

function checkNewId(id: string, ctx: MutationContext): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  return undefined;
}

// ---- Mutations ----------------------------------------------------------------------------------------------------

type LayerInput = {
  id: string;
  name: string;
  members: string[];
  startDate: string;
  handoffTime: string;
  unit: RotationUnit;
  count: number;
};

const toLayers = (layers: readonly LayerInput[]): ScheduleLayer[] =>
  layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    members: [...layer.members],
    startDate: layer.startDate,
    handoffTime: layer.handoffTime,
    unit: layer.unit,
    count: layer.count,
  }));

export const createSchedule = defineMutation({
  name: "schedule.create",
  args: v.object({ id: scheduleId, ...scheduleFields }),
  permission: "schedule:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const layers = toLayers(args.layers);
    const issues = checkLayers(store, layers);
    if (issues.length) return fail("invalid_args", "Invalid arguments for schedule.create", issues);
    if (store.get("schedules", args.id)) return fail("conflict", "Schedule already exists");
    if (store.scan("schedules").length >= MAX_SCHEDULES_PER_WORKSPACE) {
      return fail(
        "limit_reached",
        `At most ${MAX_SCHEDULES_PER_WORKSPACE} schedules per workspace`,
      );
    }
    const row: ScheduleRow = {
      id: args.id,
      name: args.name,
      timeZone: args.timeZone,
      layers,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("schedules", row);
    const event: ScheduleCreated = {
      type: "schedule.created",
      subject: row.id,
      data: { id: row.id, name: row.name, timeZone: row.timeZone, layers: layers.length },
    };
    return ok(event);
  },
});

/**
 * Replaces the schedule's name, time zone and layers at once, so an edit to several layers is never half applied.
 * Overrides stay: they are instants, whatever the time zone.
 */
export const updateSchedule = defineMutation({
  name: "schedule.update",
  args: v.object({ id: scheduleId, ...scheduleFields }),
  permission: "schedule:manage",
  apply(store, args, ctx) {
    const schedule = store.get("schedules", args.id);
    if (!schedule) return fail("not_found", "Schedule not found");
    const layers = toLayers(args.layers);
    const issues = checkLayers(store, layers);
    if (issues.length) return fail("invalid_args", "Invalid arguments for schedule.update", issues);
    if (
      schedule.name === args.name &&
      schedule.timeZone === args.timeZone &&
      JSON.stringify(schedule.layers) === JSON.stringify(layers)
    ) {
      return fail("conflict", "Schedule is unchanged");
    }
    store.update("schedules", args.id, {
      name: args.name,
      timeZone: args.timeZone,
      layers,
      updatedAt: ctx.now,
    });
    const event: ScheduleUpdated = {
      type: "schedule.updated",
      subject: args.id,
      data: {
        id: args.id,
        name: args.name,
        timeZone: args.timeZone,
        layers: layers.length,
        reason: "edited",
        userId: null,
      },
    };
    return ok(event);
  },
});

/** Deletes the schedule and its overrides (the event counts them). */
export const deleteSchedule = defineMutation({
  name: "schedule.delete",
  args: v.object({ id: scheduleId }),
  permission: "schedule:manage",
  apply(store, args) {
    if (!store.get("schedules", args.id)) return fail("not_found", "Schedule not found");
    store.delete("schedules", args.id);
    let overrides = 0;
    for (const override of store.scan("overrides")) {
      if (override.scheduleId !== args.id) continue;
      store.delete("overrides", override.id);
      overrides++;
    }
    const event: ScheduleDeleted = {
      type: "schedule.deleted",
      subject: args.id,
      data: { id: args.id, overrides },
    };
    return ok(event);
  },
});

const removed = (row: OverrideRow, reason: OverrideRemoval): ScheduleOverrideRemoved => ({
  type: "schedule.override_removed",
  subject: row.id,
  data: { id: row.id, scheduleId: row.scheduleId, userId: row.userId, reason },
});

/**
 * Someone covers `[start, end)` on a schedule, over every layer. Owners and admins add one for anyone who can
 * respond; a responder only for themselves (taking a shift, RFC 0003's "manage own on-call overrides"). Overrides
 * that ended over `OVERRIDE_RETENTION_MS` ago are deleted on the way (`expired`), so the table stays small.
 */
export const addOverride = defineMutation({
  name: "schedule.addOverride",
  args: v.object({
    id: overrideId,
    scheduleId,
    userId: memberId,
    start: instant,
    end: instant,
  }),
  permission: "schedule:override",
  apply(store, args, ctx) {
    if (!can(ctx.actor.role, "schedule:manage") && args.userId !== ctx.actor.id) {
      return fail("forbidden", "Responders add overrides only for themselves");
    }
    const clock = checkNewId(args.id, ctx);
    if (clock) return clock;
    const issues: Issue[] = [];
    if (args.end <= args.start) issues.push({ path: "end", message: "Expected after the start" });
    else if (args.end - args.start > MAX_OVERRIDE_MS) {
      issues.push({ path: "end", message: "Expected at most 90 days after the start" });
    } else if (args.end <= ctx.now) issues.push({ path: "end", message: "Expected in the future" });
    const member = store.get("members", args.userId);
    if (!member || member.role === "viewer") {
      const message = member ? "Viewers cannot be on call" : "Not a member";
      issues.push({ path: "userId", message });
    }
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for schedule.addOverride", issues);
    }
    if (!store.get("schedules", args.scheduleId)) return fail("not_found", "Schedule not found");
    if (store.get("overrides", args.id)) return fail("conflict", "Override already exists");
    const events: DomainEvent[] = [];
    let open = 0;
    for (const row of store.scan("overrides")) {
      if (row.scheduleId !== args.scheduleId) continue;
      if (row.end < ctx.now - OVERRIDE_RETENTION_MS) {
        store.delete("overrides", row.id);
        events.push(removed(row, "expired"));
      } else if (row.end > ctx.now) open++;
    }
    if (open >= MAX_OVERRIDES_PER_SCHEDULE) {
      return fail(
        "limit_reached",
        `At most ${MAX_OVERRIDES_PER_SCHEDULE} upcoming overrides per schedule`,
      );
    }
    const row: OverrideRow = {
      id: args.id,
      scheduleId: args.scheduleId,
      userId: args.userId,
      start: args.start,
      end: args.end,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
    };
    store.insert("overrides", row);
    const added: ScheduleOverrideAdded = {
      type: "schedule.override_added",
      subject: row.id,
      data: {
        id: row.id,
        scheduleId: row.scheduleId,
        userId: row.userId,
        start: row.start,
        end: row.end,
      },
    };
    return ok(added, ...events);
  },
});

/** Owners and admins remove any override; a responder only their own (the one where they cover). */
export const removeOverride = defineMutation({
  name: "schedule.removeOverride",
  args: v.object({ id: overrideId }),
  permission: "schedule:override",
  apply(store, args, ctx) {
    const row = store.get("overrides", args.id);
    if (!row) return fail("not_found", "Override not found");
    if (!can(ctx.actor.role, "schedule:manage") && row.userId !== ctx.actor.id) {
      return fail("forbidden", "Responders remove only their own overrides");
    }
    store.delete("overrides", args.id);
    return ok(removed(row, "removed"));
  },
});

/**
 * Takes `userId` out of every rotation and deletes their overrides, in the transaction that removed them from the
 * workspace or made them a viewer (`member.remove`, `member.changeRole`, `member.reconcile`). The rest of each
 * layer keeps its order and the rotation is counted again from its start, so the shifts after them move up; a
 * layer left with nobody is a gap the dashboard shows ("Nobody on call") until someone edits it.
 */
export function dropFromSchedules(
  store: MutationStore,
  userId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const schedule of store.scan("schedules")) {
    if (!schedule.layers.some((layer) => layer.members.includes(userId))) continue;
    const layers = schedule.layers.map((layer) => ({
      ...layer,
      members: layer.members.filter((member) => member !== userId),
    }));
    store.update("schedules", schedule.id, { layers, updatedAt: ctx.now });
    const event: ScheduleUpdated = {
      type: "schedule.updated",
      subject: schedule.id,
      data: {
        id: schedule.id,
        name: schedule.name,
        timeZone: schedule.timeZone,
        layers: layers.length,
        reason: "member_removed",
        userId,
      },
    };
    events.push(event);
  }
  for (const row of store.scan("overrides")) {
    if (row.userId !== userId) continue;
    store.delete("overrides", row.id);
    events.push(removed(row, "member_removed"));
  }
  return events;
}

// ---- Queries ------------------------------------------------------------------------------------------------------

const byName = (a: ScheduleRow, b: ScheduleRow) =>
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const allSchedules = defineQuery({
  name: "schedules.all",
  args: v.object({}),
  permission: "schedule:read",
  table: "schedules",
  filter: () => true,
  sort: byName,
});

export const allOverrides = defineQuery({
  name: "overrides.all",
  args: v.object({}),
  permission: "schedule:read",
  table: "overrides",
  filter: () => true,
  sort: (a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

/** What members may send. */
export const scheduleMutations = [
  createSchedule,
  updateSchedule,
  deleteSchedule,
  addOverride,
  removeOverride,
] as const;
