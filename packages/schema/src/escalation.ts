// Escalation runs (RFC 0003 "Escalation run", RFC 0006 "Who is paged"): the first page of an incident starts one
// on the policy of its alert route, else its type, else its first service with one, else the monitor that opened it,
// else the workspace's default (`incidentPolicy`); a
// type changed while the run is under way does not change its levels. The shard's alarm fires each next level when
// nobody acknowledged in time; a level every push of which failed fires the next one of its round at once.
// A level is resolved when it fires: schedules to whoever is on call at that instant. A level nobody on it can be
// reached at is skipped at once; when no level is left, when every level and repeat went unacknowledged, or when a
// level keeps failing to fire, the run falls back to the interim rule (everyone who can respond) and ends.
// `incident.ack` and resolving stop a run, and close one that ended (incidents.ts). A run that starts below its
// policy's `minSeverity` pages its first level that reaches someone and ends there (`paged_once`).

import type { Actor } from "./mutation.ts";
import { isActive } from "./lifecycle.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { escalatesAt, incidentPolicy } from "./policies.ts";
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
    /**
     * For a page made again because the run's last page was lost with its event (`escalation.repage`,
     * `escalation.fallback` on the ended run): that event, so devices it reached are not pushed twice. If this one is
     * lost too, it is only recorded, never paged a third time.
     */
    lost?: string;
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
 * when none is left, everyone who can respond (`level: null`) and the run ends. A run that pages once (`once`) skips a
 * level that reaches only `aware` too: they know, and no later level would ever page anyone else. Writes the run, its timer, the
 * timeline entry and the event; the caller writes nothing else to the run.
 */
function fire(
  store: MutationStore,
  incident: IncidentRow,
  run: Escalation,
  from: {
    index: number;
    round: number;
    reason: "started" | "timeout" | "undelivered" | "manual";
    /** For `undelivered`: the level none of whose pushes any device took. */
    unreached?: number;
  },
  ctx: { now: number; actor: Actor; server: boolean },
  aware: string | null,
): DomainEvent[] {
  const missed: EscalationMiss[] = [];
  for (let index = from.index; index < run.levels.length; index++) {
    const resolved = resolveLevel(store, run.levels[index], ctx.now, aware);
    missed.push(...resolved.missed);
    // A run that pages once must reach someone besides whoever caused it: nothing later would page anyone else.
    const reaches = run.once
      ? resolved.userIds.some((userId) => userId !== aware)
      : resolved.userIds.length > 0;
    if (reaches) {
      // Levels skipped after an undelivered one still say why the run left that level early.
      const reason =
        index > from.index && from.reason !== "undelivered" ? "unreachable" : from.reason;
      const page = {
        ...pageOf(index + 1, from.round, resolved.userIds, missed, reason, ctx.now),
        ...(from.unreached !== undefined && { unreached: from.unreached }),
      };
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
  again = false,
): EscalationPage {
  return {
    level,
    round,
    at,
    userIds,
    missed: missed.slice(0, MAX_PAGE_MISSES),
    missedCount: missed.length,
    reason,
    ...(again && { again }),
  };
}

/**
 * Writes `page` to the run (ending it when it is the interim rule's), its timeline entry, and its event, which
 * carries every miss (`missed`; the page keeps the first few). A page made `again` (for `lost`, the event of the page
 * lost) changes nothing else of the run: an ended run keeps when it ended, and the timeline says it was made again.
 */
function paged(
  store: MutationStore,
  incident: IncidentRow,
  run: Escalation,
  page: EscalationPage,
  missed: EscalationMiss[],
  ctx: { now: number; actor: Actor; server: boolean },
  lost?: string,
): DomainEvent[] {
  const ends = page.level === null && !page.again;
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
  if (page.reason === "exhausted" && !page.again) {
    appendTimeline(
      store,
      current,
      {
        kind: "escalation_exhausted",
        levels: run.levels.length,
        rounds: run.repeat + 1,
      },
      ctx,
    );
  } else {
    // Everyone, after a level earlier in the run paged someone (the pages kept, or more than they hold).
    const later =
      page.level === null &&
      (run.pages.some((one) => one.level !== null) || run.paged > run.pages.length);
    appendTimeline(
      store,
      current,
      {
        kind: "escalated",
        level: page.level,
        round: page.round,
        userIds: page.userIds,
        reason: page.reason,
        ...(later && { later }),
        ...(run.paged === 0 && page.userIds.includes(run.causedBy) && { causedBy: run.causedBy }),
        ...(page.again && { again: true }),
        ...(lost !== undefined && { repaged: { run: run.eventId, step: run.paged } }),
        ...(page.unreached !== undefined && { unreached: page.unreached }),
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
      ...(lost !== undefined && { lost }),
    },
  };
  return [event];
}

function setTimer(store: MutationStore, incidentId: string, at: number): void {
  if (store.get("escalation_timers", incidentId))
    store.update("escalation_timers", incidentId, { at, failingSince: null });
  else store.insert("escalation_timers", { id: incidentId, at });
}

/**
 * Server only, as `ESCALATION_ACTOR`: starts a run for the page `eventId` asked for, on the policy of the alert route
 * that opened the incident, else of its type, else of its first service that names one, else of the monitor that
 * opened it, else the default (`incidentPolicy`), and pages its first reachable level (RFC 0006 "Who is
 * paged"). `causedBy` (who caused that event) counts as reached without a push. `not_found` with no policy (the
 * interim rule pages instead); `conflict` while a run is under way, or for an incident already acknowledged or no
 * longer active.
 *
 * Below the policy's `minSeverity` the run does not escalate (Q18 decided): it pages the first level that reaches
 * someone other than `causedBy` (skipping a level nobody else on it can be reached at, or everyone who can respond
 * when no level reaches anyone), and then ends as `paged_once`, with an `escalation_once` timeline entry. So no timer:
 * no later level at a timeout, no repeat, no page to everyone when nobody acknowledges, and no early escalation when
 * its pushes all fail (the owners and admins are emailed instead, RFC 0005 "Email"). A severity raised up to the
 * policy's afterwards (`escalates` on `incident.severity_changed`), or a member's `escalation.now`, starts it again in
 * full.
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
    const chosen = incidentPolicy(store, incident.id);
    if (!chosen) return fail("not_found", "No escalation policy");
    const { policy, monitor, route, service, picked } = chosen;
    const once = escalatesAt(policy, incident.severity) ? undefined : policy.minSeverity!;
    const run: Escalation = {
      policyId: policy.id,
      policyName: policy.name,
      monitor,
      ...(route && { route }),
      ...(service && { service }),
      ...(picked && { picked }),
      ...(once && { once }),
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
    const events = fire(
      store,
      incident,
      run,
      { index: 0, round: 0, reason: "started" },
      ctx,
      args.causedBy,
    );
    const after = store.get("incidents", incident.id)!;
    if (once && after.escalation?.status === "running") {
      // A level paged: the run ends on it. (Everyone who can respond already ended it as `exhausted`.)
      store.update("incidents", incident.id, {
        escalation: { ...after.escalation, status: "paged_once", nextAt: null, endedAt: ctx.now },
      });
      if (store.get("escalation_timers", incident.id)) {
        store.delete("escalation_timers", incident.id);
      }
      appendTimeline(
        store,
        store.get("incidents", incident.id)!,
        { kind: "escalation_once", minSeverity: once },
        ctx,
      );
    }
    return ok(...events);
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
 * Server only, as `ESCALATION_ACTOR`, from the pager when the run's last page settled (RFC 0006 "Who is paged"):
 * every push of that level failed for good (refused, or retries spent) and no device took any, so waiting for its
 * timeout would only wait. The next level of the same round that reaches someone fires at once, saying why
 * (`undelivered`, `unreached`). Never past the round: on its last level (or with no later level reaching anyone) it is
 * refused, and the level's timeout fires what comes next (level 1 of the next round, or everyone who can respond and
 * the run ends), so a relay that refuses everything never spends the run's rounds in moments. `step` is the run's page
 * count with the failed page, so a redelivered result, a dead-lettered one or a repeated call advances once
 * (`conflict` once the run moved on); an acknowledged or resolved run is `not_found`.
 */
export const unreachedEscalation = defineMutation({
  name: "escalation.unreached",
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
    if (!isActive(incident.status) || incident.acknowledgedAt != null) {
      return fail("conflict", "Incident is not waiting for a page");
    }
    const last = run.pages[run.pages.length - 1];
    if (run.paged !== args.step || !last || last.level === null) {
      return fail("conflict", "The run moved on");
    }
    // Only later in the same round, and only to a level that reaches someone: anything else waits for the timeout.
    const index = last.level;
    const later = run.levels
      .slice(index)
      .some((level) => resolveLevel(store, level, ctx.now, null).userIds.length > 0);
    if (!later) return fail("conflict", "No later level in this round");
    return ok(
      ...fire(
        store,
        incident,
        run,
        { index, round: last.round, reason: "undelivered", unreached: index },
        ctx,
        null,
      ),
    );
  },
});

/**
 * Server only, as a member who may update incidents (`/inc escalate` in Slack, RFC 0011): pages the run's next level
 * now instead of at its timeout, as the alarm would (after the last level, level 1 of the next round while repeats
 * are left; past the last repeat everyone who can respond, not the commander first, as after a run nobody
 * acknowledged, and the run ends), with `reason: "manual"`. `step` is the run's page count the person saw: a run
 * that moved past it since (another member escalated, or the level timed out) is `conflict`, never escalated past a
 * level nobody saw. Slack sends the step its button or message carried; a typed command knows none, so Slack sends the
 * run's own unless its last page moved a level too recently to have been seen (`SLACK_ESCALATE_WINDOW_MS`). A run that
 * paged once below its policy's severity (`paged_once`) escalates too: someone asked, so it runs again from its next
 * level as a full run (no longer `once`: timeouts, repeats and the fallback to everyone). `not_found` without a run
 * under way or paged once; `conflict` for an incident acknowledged or no longer active.
 */
export const escalateNow = defineMutation({
  name: "escalation.now",
  args: v.object({
    incidentId: v.id("inc"),
    step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    if (!isActive(incident.status) || incident.acknowledgedAt != null) {
      return fail("conflict", "Incident is not waiting for a page");
    }
    const current = incident.escalation;
    // A run that paged once below its policy's severity escalates when someone asks: from its next level, in full.
    const once = current?.status === "paged_once";
    if (!current || (current.status !== "running" && !once)) {
      return fail("not_found", "No escalation under way");
    }
    const last = current.pages[current.pages.length - 1];
    if (current.paged !== args.step || !last) return fail("conflict", "The run moved on");
    const run: Escalation = once ? { ...current, status: "running", endedAt: null } : current;
    if (once) delete run.once;
    const index = last.level ?? run.levels.length;
    if (index < run.levels.length) {
      return ok(
        ...fire(store, incident, run, { index, round: last.round, reason: "manual" }, ctx, null),
      );
    }
    if (last.round < run.repeat) {
      return ok(
        ...fire(
          store,
          incident,
          run,
          { index: 0, round: last.round + 1, reason: "manual" },
          ctx,
          null,
        ),
      );
    }
    // Past the last repeat the run ends, as the alarm's would: `escalation.exhausted` for whoever acts on it.
    const events = paged(
      store,
      incident,
      run,
      pageOf(null, last.round, [], [], "manual", ctx.now),
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
 * Server only, as `ESCALATION_ACTOR`, from the shard's alarm: `escalation.advance` has been refusing the run's level
 * `step` for `ESCALATION_STALL_MS` (a bug, or a row it cannot read), so everyone who can respond is paged (the interim
 * rule, `reason: "stalled"`) and the run ends. Reads nothing of the run's levels, so whatever stops the level does not
 * stop this. `conflict` once the run moved on.
 *
 * Also from the dead-letter consumer, for a run that ended on a page to everyone who can respond when that page was
 * lost with its event (`lost`; `step` the run's last): everyone who can respond is paged again, as that page would
 * have (its round and reason), on an event of its own, once. `lost` is null from the alarm.
 */
export const fallbackEscalation = defineMutation({
  name: "escalation.fallback",
  args: v.object({
    incidentId: v.id("inc"),
    step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    lost: v.nullable(v.id("evt")),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    const run = incident?.escalation;
    const last = run?.pages[run.pages.length - 1];
    const lost =
      args.lost !== null &&
      run?.status === "exhausted" &&
      args.step === run.paged &&
      last?.level === null;
    if (!incident || !run || (run.status !== "running" && !lost)) {
      return fail("not_found", "No escalation under way");
    }
    if (run.paged !== args.step) return fail("conflict", "The run moved on");
    if (lost) {
      if (!isActive(incident.status) || incident.acknowledgedAt != null) {
        return fail("conflict", "Incident is not waiting for a page");
      }
      return ok(
        ...paged(
          store,
          incident,
          run,
          pageOf(null, last.round, [], [], last.reason, ctx.now, true),
          [],
          ctx,
          args.lost!,
        ),
      );
    }
    const round = run.pages[run.pages.length - 1]?.round ?? 0;
    return ok(
      ...paged(store, incident, run, pageOf(null, round, [], [], "stalled", ctx.now), [], ctx),
    );
  },
});

/**
 * Server only, as `ESCALATION_ACTOR`, from the dead-letter consumer: the running run's last page (a level, `step` the
 * run's page count) was lost with its event (`lost`), so the same members are paged again, on an event of its own,
 * once (that page lost too is only recorded). The next
 * level keeps its time: the re-page is a second chance, not a new timeout. Whoever caused the run's first page was
 * counted as reached without a push, so a re-page of that page leaves them out. `conflict` once the run moved on.
 */
export const repageEscalation = defineMutation({
  name: "escalation.repage",
  args: v.object({
    incidentId: v.id("inc"),
    step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
    lost: v.id("evt"),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    const run = incident?.escalation;
    const last = run?.pages[run.pages.length - 1];
    // A run that paged once (below its policy's severity) is paged again too: its one page was all it had.
    const live = run?.status === "running" || run?.status === "paged_once";
    if (!incident || !run || !live || !last || last.level === null) {
      return fail("not_found", "No escalation under way");
    }
    if (run.paged !== args.step) return fail("conflict", "The run moved on");
    const userIds =
      args.step === 1 ? last.userIds.filter((id) => id !== run.causedBy) : last.userIds;
    if (userIds.length === 0) return fail("conflict", "Nobody to page again");
    return ok(
      ...paged(
        store,
        incident,
        run,
        pageOf(last.level, last.round, userIds, [], last.reason, ctx.now, true),
        [],
        ctx,
        args.lost,
      ),
    );
  },
});
