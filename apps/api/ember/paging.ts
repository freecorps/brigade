// Paging on a workspace's Ember shard (RFC 0005 "Notifiers", RFC 0006 "Who is paged", RFC 0016 "Parity"): the
// queue consumer's calls into the shard (`planPage`, `recordPage`), run by `WorkspaceDO`'s own `Pager` unchanged,
// over an Ember mutation (ember/shard-facade.ts): its rows through the store, its page ledger in Ember's private SQL
// tables, its mutations (`notification.fail`, escalation steps, …) through `run()` like every other one.
//
// `paging:tick` is the part of the Durable Object's alarm that is the pager's and synchronous: held pushes released
// once their hold ran out (`releaseDue`) and pages replayed (`replayDue`); each call schedules the next tick at the
// pager's next due time. Not here yet: the page the shard sends itself when the Queue is late (`overdue`, the DO's
// `pageLocally`), which sends through the relay and moves with the notifiers' side (RFC 0016 "Parity").

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  nextReminderAt,
  remindersDue,
  ROLES,
  type Actor,
} from "@freecorps/brigade-schema";
import type { AckResult } from "../src/workspace.ts";
import {
  asksForPage,
  Pager,
  type DeadLetterResult,
  type DeviceOutcome,
  type PagePlan,
  type SkippedMember,
} from "../src/paging.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { EMBER_MEMBER_REPAIR_DELAY_MS } from "./members.ts";
import { Escalations } from "../src/escalation.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

export { TICK_LEASE_MS, TICK_RETRY_MS } from "./ticks.ts";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** A `Pager` over this mutation; `wake` schedules a tick at `at`. */
function pager(ctx: MutationCtx): {
  pager: Pager;
  workspace: string | undefined;
  check: () => void;
  shard: EmberShard;
} {
  const { shard, storage } = emberWorkspace(ctx);
  const p = new Pager({
    storage,
    shard: shard as never,
    log,
    // Ember's subscriptions follow the rows: nothing to broadcast.
    committed: () => {},
    wake: (at) => tickAt(ctx, at),
  });
  return { pager: p, workspace: shard.workspace(), check: () => shard.check(), shard };
}

/**
 * Schedules the next tick at the earliest the pager needs one (replays, held pushes), or an escalation level or a
 * reminder of follow-ups falls due, if any does.
 */
function scheduleTick(ctx: MutationCtx, p: Pager, shard: EmberShard): void {
  const due = [
    p.replayAt(),
    p.releaseAt(ctx.now),
    escalations(shard).nextAt(),
    nextReminderAt(shard.store, ctx.now),
  ].filter((at): at is number => at !== null);
  if (due.length > 0) tickAt(ctx, Math.min(...due));
}

/** `WorkspaceDO`'s `Escalations` over this mutation's shard. */
const escalations = (shard: EmberShard) =>
  new Escalations({ shard: shard as never, log, committed: () => {} });

const event = v.any();

/**
 * `WorkspaceDO.planPage`'s synchronous part: the plan, and (for a page) that the Queue brought it (`arrived`), in
 * one transaction: a plan that throws leaves the page watched, as on the DO.
 */
export const plan = internalMutationGeneric({
  args: { event, repair: v.optional(v.boolean()) },
  handler: (ctx, { event: e, repair }: { event: BrigadeEvent; repair?: boolean }): PagePlan => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace !== e.workspaceId) return { send: false, reason: "not_found" } as PagePlan;
    // The member check before this page failed or was late (src/ember-paging.ts): a durable repair reads D1 again
    // later, so the copy catches up even with no other activity, as the DO's repair alarm does.
    if (repair) {
      c.scheduler.runAfter(EMBER_MEMBER_REPAIR_DELAY_MS, "members:repair", {
        workspaceId: e.workspaceId,
      });
    }
    const out = p.plan(e, c.now);
    if (asksForPage(e)) p.arrived(e.id);
    scheduleTick(c, p, shard);
    check();
    return out;
  },
});

/** `WorkspaceDO.recordDeadLetter`: a page the Queue gave up on. */
export const deadLettered = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): DeadLetterResult => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace !== e.workspaceId) return "other_workspace";
    const result = p.deadLettered(e, c.now);
    p.arrived(e.id);
    scheduleTick(c, p, shard);
    check();
    return result;
  },
});

/** `WorkspaceDO.recordPage`: what a page did. */
export const record = internalMutationGeneric({
  args: { event, outcomes: v.any(), final: v.boolean(), skipped: v.optional(v.any()) },
  handler: (
    ctx,
    input: {
      event: BrigadeEvent;
      outcomes: DeviceOutcome[];
      final: boolean;
      skipped?: SkippedMember[];
    },
  ): null => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace !== input.event.workspaceId) return null;
    p.record(input.event, input.outcomes, input.final, input.skipped ?? [], c.now);
    scheduleTick(c, p, shard);
    check();
    return null;
  },
});

/**
 * The synchronous part of `WorkspaceDO`'s alarm, in its order: escalation levels that came due (`Escalations.fireDue`),
 * lost pages replayed (`replayDue`), held pushes released (`releaseDue`) and reminders of follow-ups due
 * (`followUp.remind`, the DO's `remind`); then the next tick, at the earliest any of them needs one.
 */
export const tick = internalMutationGeneric({
  args: {},
  handler: (ctx): { fired: number; released: number; replayed: number; reminded: number } => {
    const c = ctx as MutationCtx;
    // Whatever this tick schedules goes `TICK_RETRY_MS` out at the soonest.
    holdTicks(c);
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace === undefined) return { fired: 0, released: 0, replayed: 0, reminded: 0 };
    // This tick is the one scheduled: the next is whatever is due after it.
    c.sql.exec("delete from ember_ticks where key = 'paging'");
    // A level that throws is logged and left due (its timer): the rest of the tick still runs, as on the DO.
    let fired = 0;
    try {
      fired = escalations(shard).fireDue(c.now).fired;
    } catch (error) {
      log("escalation failed", { error: String(error) });
    }
    const replayed = p.replayDue(c.now);
    const released = p.releaseDue(c.now);
    const reminded = remind(c, shard);
    scheduleTick(c, p, shard);
    // A storage failure anywhere above (caught by the orchestrators, as `releaseDue` does) fails the whole tick
    // instead, as the DO's alarm does, and the scheduler runs it again.
    check();
    return { fired, released, replayed, reminded };
  },
});

/** The DO's `remind`: each member's reminder of follow-ups due (`followUp.remind`), each on its own. */
function remind(ctx: MutationCtx, shard: EmberShard): number {
  const next = nextReminderAt(shard.store, ctx.now);
  if (next === null || next > ctx.now) return 0;
  let reminded = 0;
  for (const reminder of remindersDue(shard.store, ctx.now)) {
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: `remind:${reminder.userId}:${reminder.date}`,
      actor: ACCOUNT_ACTOR,
      name: "followUp.remind",
      args: reminder,
      now: ctx.now,
      internal: true,
    });
    if (result.ok) reminded++;
    else if (result.error.code !== "conflict") {
      log("reminding of follow-ups failed", { code: result.error.code });
    }
  }
  return reminded;
}

/** The client id of a notification action's mutations (src/workspace.ts `NOTIFICATION_CLIENT_ID`). */
const NOTIFICATION_CLIENT_ID = "notification";

/**
 * `WorkspaceDO.acknowledge`: the app's notification action (`POST …/incidents/:id/ack`, whose route read the member's
 * role in D1 already). An API token acts only while this shard backs it, with its creator's role here when higher
 * (`tokenActor`); the same idempotency key on the same incident answers what the first did (a stored result).
 */
export const acknowledge = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: v.any(),
    incidentId: v.string(),
    mutationId: v.string(),
  },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; incidentId: string; mutationId: string },
  ): AckResult => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const actor = tokenActor(shard, input.actor, c.now);
    if (!actor) return { ok: false, code: "unauthenticated" };
    // The key names a tap on one incident's page: the same key for another incident is another ack.
    const id = `${input.incidentId}:${input.mutationId}`;
    const result =
      shard.storedResult(actor.id, NOTIFICATION_CLIENT_ID, id, c.now) ??
      shard.mutate({
        clientId: NOTIFICATION_CLIENT_ID,
        mutationId: id,
        actor,
        name: "incident.ack",
        args: { id: input.incidentId },
        now: c.now,
      }).result;
    shard.check();
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  },
});

/** `WorkspaceDO.tokenActor`: an API token while this shard backs it, with its creator's role here when higher. */
function tokenActor(shard: EmberShard, actor: Actor, now: number): Actor | undefined {
  if (actor.kind !== "token") return actor;
  const row = shard.store.get("api_tokens", actor.id);
  if (!row || row.revokedAt !== null || row.createdBy !== actor.by) return undefined;
  if (row.expiresAt !== null && row.expiresAt <= now) return undefined;
  const copy = shard.store.get("members", row.createdBy);
  return copy && ROLES.indexOf(copy.role) > ROLES.indexOf(actor.role)
    ? { ...actor, role: copy.role }
    : actor;
}
