// Escalation runs (RFC 0003 "Escalation run", RFC 0006 "Who is paged"): the first page of an incident starts one
// on the workspace's default policy, and the shard's alarm fires each next level when nobody acknowledged in time.
// A level is resolved when it fires: schedules to whoever is on call at that instant. A level nobody on it can be
// reached at is skipped at once; when no level is left, when every level and repeat went unacknowledged, or when a
// level keeps failing to fire, the run falls back to the interim rule (everyone who can respond) and ends.
// `incident.ack` and resolving stop a run (incidents.ts).

import type { Actor } from "./mutation.ts";
import { isActive } from "./lifecycle.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defaultPolicy } from "./policies.ts";
import { onCallAt } from "./schedules.ts";
import type {
  Escalation,
  EscalationLevel,
  EscalationMiss,
  EscalationPage,
  EscalationReason,
  IncidentRow,
} from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v } from "./validate.ts";

/** Runs escalations: starts them from the page that asked, and fires each next level from the shard's alarm. */
export const ESCALATION_ACTOR: Actor = { kind: "system", id: "sys_escalation", role: "admin" };

/**
 * A run keeps its last this many pages on the incident row (synced to every client); `paged` counts them all. The
 * timeline keeps every one.
 */
export const MAX_ESCALATION_PAGES = 20;
/** A page keeps at most this many misses; `missedCount` says how many there were. Events carry them all. */
export const MAX_PAGE_MISSES = 20;
/**
 * How long a due level may keep failing to fire before the shard pages everyone who can respond instead
 * (`escalation.fallback`). It tries again every minute meanwhile, and the first failure is on the timeline.
 */
export const ESCALATION_STALL_MS = 3 * 60_000;
const MINUTE_MS = 60_000;

export type EscalationPaged = DomainEvent<
  "escalation.paged",
  {
    incidentId: string;
    policyId: string;
    /** 1-based; null: everyone who can respond (the interim rule), for `reason`. */
    level: number | null;
    round: number;
    userIds: string[];
    missed: EscalationMiss[];
    reason: EscalationReason;
    /** The run (its `eventId`) and its page count with this page: a page from an older run, or one the run moved past
     * by stopping, sends nothing (the shard's plan checks). */
    run: string;
    step: number;
    /**
     * True for the page a run started with: it is sent on the event that asked for the page (the shard plans it
     * there), so this one asks for no page of its own.
     */
    started: boolean;
  }
>;
export type EscalationExhausted = DomainEvent<
  "escalation.exhausted",
  { incidentId: string; policyId: string; levels: number; rounds: number }
>;

/**
 * Who `level` reaches at `at`: each target resolved (a schedule to whoever is on call then), each person once.
 * Someone with no registered device is missed (`no_devices`), except `aware` (whoever caused the page: they know, so
 * they count as reached without a push).
 */
export function resolveLevel(
  store: MutationStore,
  level: EscalationLevel,
  at: number,
  aware: string | null,
): { userIds: string[]; missed: EscalationMiss[] } {
  const userIds: string[] = [];
  const missed: EscalationMiss[] = [];
  const seen = new Set<string>();
  const overrides = store.scan("overrides");
  const devices = new Set(store.scan("devices").map((device) => device.userId));
  for (const target of level.targets) {
    let userId = target.id;
    let schedule: string | null = null;
    if (target.kind === "schedule") {
      const row = store.get("schedules", target.id);
      if (!row) {
        missed.push({
          userId: null,
          reason: "schedule_missing",
          scheduleId: target.id,
          schedule: null,
        });
        continue;
      }
      const who = onCallAt(row, overrides, at);
      if (!who) {
        missed.push({
          userId: null,
          reason: "nobody_on_call",
          scheduleId: row.id,
          schedule: row.name,
        });
        continue;
      }
      userId = who.userId;
      schedule = row.name;
    }
    if (seen.has(userId)) continue;
    seen.add(userId);
    const scheduleId = target.kind === "schedule" ? target.id : null;
    const member = store.get("members", userId);
    if (!member || member.role === "viewer") {
      missed.push({ userId, reason: "not_a_member", scheduleId, schedule });
    } else if (devices.has(userId) || userId === aware) {
      userIds.push(userId);
    } else {
      missed.push({ userId, reason: "no_devices", scheduleId, schedule });
    }
  }
  return { userIds, missed };
}

/**
 * Pages the first level from `index` on (in `round`) that reaches someone, skipping the ones that reach nobody;
 * when none is left, everyone who can respond (`level: null`) and the run ends. Writes the run, its timer, the
 * timeline entry and the event; the caller writes nothing else to the run.
 */
function fire(
  store: MutationStore,
  incident: IncidentRow,
  run: Escalation,
  from: { index: number; round: number; reason: "started" | "timeout" },
  ctx: { now: number; actor: Actor; server: boolean },
  aware: string | null,
): DomainEvent[] {
  const missed: EscalationMiss[] = [];
  for (let index = from.index; index < run.levels.length; index++) {
    const resolved = resolveLevel(store, run.levels[index], ctx.now, aware);
    missed.push(...resolved.missed);
    if (resolved.userIds.length > 0) {
      const reason = index > from.index ? "unreachable" : from.reason;
      const page = pageOf(index + 1, from.round, resolved.userIds, missed, reason, ctx.now);
      const nextAt = ctx.now + run.levels[index].timeoutMinutes * MINUTE_MS;
      setTimer(store, incident.id, nextAt);
      return paged(store, incident, { ...run, status: "running", nextAt }, page, missed, ctx);
    }
  }
  // No level from here on reaches anyone: the interim rule pages (the shard resolves it, as without a policy),
  // and there is nothing left to escalate to.
  return paged(
    store,
    incident,
    run,
    pageOf(null, from.round, [], missed, "unreachable", ctx.now),
    missed,
    ctx,
  );
}

function pageOf(
  level: number | null,
  round: number,
  userIds: string[],
  missed: EscalationMiss[],
  reason: EscalationReason,
  at: number,
): EscalationPage {
  return {
    level,
    round,
    at,
    userIds,
    missed: missed.slice(0, MAX_PAGE_MISSES),
    missedCount: missed.length,
    reason,
  };
}

/**
 * Writes `page` to the run (ending it when it is the interim rule's), its timeline entry, and its event, which
 * carries every miss (`missed`; the page keeps the first few).
 */
function paged(
  store: MutationStore,
  incident: IncidentRow,
  run: Escalation,
  page: EscalationPage,
  missed: EscalationMiss[],
  ctx: { now: number; actor: Actor; server: boolean },
): DomainEvent[] {
  const ends = page.level === null;
  const next: Escalation = {
    ...run,
    ...(ends && { status: "exhausted", nextAt: null, endedAt: ctx.now }),
    paged: run.paged + 1,
    pages: [...run.pages, page].slice(-MAX_ESCALATION_PAGES),
  };
  if (ends) store.delete("escalation_timers", incident.id);
  store.update("incidents", incident.id, { escalation: next, updatedAt: ctx.now });
  // `timelineSeq` as it is now: an earlier entry in this transaction moved it.
  const current = store.get("incidents", incident.id)!;
  if (page.reason === "exhausted") {
    appendTimeline(
      store,
      current,
      { kind: "escalation_exhausted", levels: run.levels.length, rounds: run.repeat + 1 },
      ctx,
    );
  } else {
    appendTimeline(
      store,
      current,
      {
        kind: "escalated",
        level: page.level,
        round: page.round,
        userIds: page.userIds,
        reason: page.reason,
      },
      ctx,
    );
  }
  const event: EscalationPaged = {
    type: "escalation.paged",
    subject: incident.id,
    data: {
      incidentId: incident.id,
      policyId: run.policyId,
      level: page.level,
      round: page.round,
      userIds: page.userIds,
      missed,
      reason: page.reason,
      started: run.paged === 0,
      run: run.eventId,
      step: next.paged,
    },
  };
  return [event];
}

function setTimer(store: MutationStore, incidentId: string, at: number): void {
  if (store.get("escalation_timers", incidentId))
    store.update("escalation_timers", incidentId, { at });
  else store.insert("escalation_timers", { id: incidentId, at });
}

/**
 * Server only, as `ESCALATION_ACTOR`: starts a run on the default policy for the page `eventId` asked for, and pages
 * its first reachable level (RFC 0006 "Who is paged"). `causedBy` (who caused that event) counts as reached without
 * a push. `not_found` without a default policy (the interim rule pages instead); `conflict` while a run is under
 * way, or for an incident already acknowledged or no longer active.
 */
export const startEscalation = defineMutation({
  name: "escalation.start",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    causedBy: v.string({ min: 1, max: 64 }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    if (!isActive(incident.status) || incident.acknowledgedAt != null) {
      return fail("conflict", "Incident is not waiting for a page");
    }
    if (incident.escalation?.status === "running") return fail("conflict", "Already escalating");
    const policy = defaultPolicy(store);
    if (!policy) return fail("not_found", "No default escalation policy");
    const run: Escalation = {
      policyId: policy.id,
      policyName: policy.name,
      levels: policy.levels,
      repeat: policy.repeat,
      eventId: args.eventId,
      causedBy: args.causedBy,
      status: "running",
      startedAt: ctx.now,
      endedAt: null,
      nextAt: null,
      paged: 0,
      pages: [],
    };
    return ok(
      ...fire(store, incident, run, { index: 0, round: 0, reason: "started" }, ctx, args.causedBy),
    );
  },
});

/**
 * Server only, as `ESCALATION_ACTOR`, from the shard's alarm: the run's level timed out with nobody acknowledging,
 * so the next level fires; after the last, level 1 again while repeats are left. Past the last repeat the run is
 * exhausted: nobody acknowledged (whoever was reached, the person who declared it included), so everyone who can
 * respond is paged once (the interim rule) and the run ends. `step` is how many pages the run had made when the alarm
 * read it, so a repeated alarm fires a level once (`conflict`).
 */
export const advanceEscalation = defineMutation({
  name: "escalation.advance",
  args: v.object({
    incidentId: v.id("inc"),
    step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    const run = incident?.escalation;
    // Nothing to escalate: the shard's alarm then drops the timer (src/escalation.ts).
    if (!incident || !run || run.status !== "running") {
      return fail("not_found", "No escalation under way");
    }
    const last = run.pages[run.pages.length - 1];
    if (run.paged !== args.step || run.nextAt === null || run.nextAt > ctx.now || !last) {
      return fail("conflict", "Not due");
    }
    const index = last.level ?? run.levels.length;
    if (index < run.levels.length) {
      return ok(
        ...fire(store, incident, run, { index, round: last.round, reason: "timeout" }, ctx, null),
      );
    }
    if (last.round < run.repeat) {
      return ok(
        ...fire(
          store,
          incident,
          run,
          { index: 0, round: last.round + 1, reason: "timeout" },
          ctx,
          null,
        ),
      );
    }
    const events = paged(
      store,
      incident,
      run,
      pageOf(null, last.round, [], [], "exhausted", ctx.now),
      [],
      ctx,
    );
    const exhausted: EscalationExhausted = {
      type: "escalation.exhausted",
      subject: incident.id,
      data: {
        incidentId: incident.id,
        policyId: run.policyId,
        levels: run.levels.length,
        rounds: run.repeat + 1,
      },
    };
    return ok(...events, exhausted);
  },
});

/**
 * Server only, as `ESCALATION_ACTOR`, from the shard's alarm: the run's level `step` has been due for
 * `ESCALATION_STALL_MS` and `escalation.advance` keeps refusing it (a bug, or a row it cannot read), so everyone who
 * can respond is paged (the interim rule, `reason: "stalled"`) and the run ends. Reads nothing of the run's levels, so
 * whatever stops the level does not stop this. `conflict` once the run moved on.
 */
export const fallbackEscalation = defineMutation({
  name: "escalation.fallback",
  args: v.object({
    incidentId: v.id("inc"),
    step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    const run = incident?.escalation;
    if (!incident || !run || run.status !== "running") {
      return fail("not_found", "No escalation under way");
    }
    if (run.paged !== args.step) return fail("conflict", "The run moved on");
    const round = run.pages[run.pages.length - 1]?.round ?? 0;
    return ok(
      ...paged(store, incident, run, pageOf(null, round, [], [], "stalled", ctx.now), [], ctx),
    );
  },
});
