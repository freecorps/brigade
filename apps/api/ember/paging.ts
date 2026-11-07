// Paging on a workspace's Ember shard (RFC 0005 "Notifiers", RFC 0006 "Who is paged", RFC 0016 "Parity"): the
// queue consumer's calls into the shard (`planPage`, `recordPage`), run by `WorkspaceDO`'s own `Pager` unchanged,
// over an Ember mutation (ember/shard-facade.ts): its rows through the store, its page ledger in Ember's private SQL
// tables, its mutations (`notification.fail`, escalation steps, …) through `run()` like every other one.
//
// `paging:tick` and `paging:remind` are the synchronous part of the Durable Object's alarm, each its own job and
// transaction (ember/ticks.ts): the tick fires escalation levels (`Escalations.fireDue`), replays lost pages
// (`replayDue`) and releases held pushes (`releaseDue`); the reminder sends follow-up reminders (`followUp.remind`).
// Each schedules itself again at its next due time. `paging:acknowledge` is the app's notification action and
// `paging:receipt` a delivery receipt the Worker checked (src/ember-receipts.ts). `paging:overdue` and
// `paging:localDone` are the shard side of a page the Queue is late with, sent by ember/local.ts.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  deliveryId,
  NOTIFIER_ACTOR,
  nextReminderAt,
  remindersDue,
  type Actor,
} from "@freecorps/brigade-schema";
import type { AckResult } from "../src/workspace.ts";
import { allowReceipt, type ReceiptResult } from "../src/receipts.ts";
import {
  asksForPage,
  PAGE_LOCAL_TRIES,
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
import { holdTicks, tickAt, type TickKey } from "./ticks.ts";

export { TICK_LEASE_MS, TICK_RETRY_MS } from "./ticks.ts";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * A `Pager` over this mutation; `wake` schedules tick `wakes` at `at`: the paging tick, or the shard's own send for
 * the mutations whose wakes are the leases of late pages (`overdue`, `localDone`).
 */
function pager(
  ctx: MutationCtx,
  wakes: TickKey = "paging",
): {
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
    wake: (at) => tickAt(ctx, at, wakes),
  });
  return { pager: p, workspace: shard.workspace(), check: () => shard.check(), shard };
}

/**
 * Schedules the next tick at the earliest the pager needs one (replays, held pushes) or an escalation level falls due,
 * if any does. Reminders have their own tick (`remind`): no follow-up is read here.
 */
function scheduleTick(ctx: MutationCtx, p: Pager, shard: EmberShard): void {
  const due = [p.replayAt(), p.releaseAt(ctx.now), escalations(shard).nextAt()].filter(
    (at): at is number => at !== null,
  );
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
  args: { event, repair: v.optional(v.boolean()), local: v.optional(v.boolean()) },
  handler: (
    ctx,
    { event: e, repair, local }: { event: BrigadeEvent; repair?: boolean; local?: boolean },
  ): PagePlan => {
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
    // Brought by the Queue: the shard need not send it. Not for its own send (`local`, ember/local.ts), which ends
    // the watch itself once the page went (`localDone`).
    if (asksForPage(e) && !local) p.arrived(e.id);
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
 * lost pages replayed (`replayDue`) and held pushes released (`releaseDue`); then the next tick, at the earliest any of
 * them needs one.
 */
export const tick = internalMutationGeneric({
  args: {},
  handler: (ctx): { fired: number; released: number; replayed: number } => {
    const c = ctx as MutationCtx;
    // Whatever this tick schedules goes `TICK_RETRY_MS` out at the soonest.
    holdTicks(c);
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace === undefined) return { fired: 0, released: 0, replayed: 0 };
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
    scheduleTick(c, p, shard);
    // A storage failure anywhere above (caught by the orchestrators, as `releaseDue` does) fails the whole tick
    // instead, as the DO's alarm does, and the scheduler runs it again.
    check();
    return { fired, released, replayed };
  },
});

/**
 * The DO's `remind`, in a transaction of its own, so a large follow-up history never weighs on a page's: each
 * member's reminder of follow-ups due (`followUp.remind`, each on its own), then this tick again at the next reminder.
 * Armed by any mutation that wrote a reminder's tables (ember/ticks.ts `armUpkeep`).
 */
export const remind = internalMutationGeneric({
  args: {},
  handler: (ctx): { reminded: number } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return { reminded: 0 };
    c.sql.exec("delete from ember_ticks where key = 'reminders'");
    let reminded = 0;
    const next = nextReminderAt(shard.store, c.now);
    if (next !== null && next <= c.now) {
      for (const reminder of remindersDue(shard.store, c.now)) {
        const { result } = shard.mutate({
          clientId: "api",
          mutationId: `remind:${reminder.userId}:${reminder.date}`,
          actor: ACCOUNT_ACTOR,
          name: "followUp.remind",
          args: reminder,
          now: c.now,
          internal: true,
        });
        if (result.ok) reminded++;
        else if (result.error.code !== "conflict") {
          log("reminding of follow-ups failed", { code: result.error.code });
        }
      }
    }
    const after = nextReminderAt(shard.store, c.now);
    if (after !== null) tickAt(c, after, "reminders");
    shard.check();
    return { reminded };
  },
});

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
    const actor = shard.tokenActor(input.actor, c.now);
    if (!actor) return { ok: false, code: "unauthenticated" };
    // Removed just now, after the route read D1: refused, as the DO's tombstone refuses it.
    if (shard.gone(actor.by ?? actor.id, c.now)) return { ok: false, code: "not_a_member" };
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

/**
 * `WorkspaceDO.receipt`'s shard side (RFC 0006 "Delivery receipts"): the Worker checked the token's MAC and expiry
 * (src/ember-receipts.ts); here the device's rate (`allowReceipt`), the delivery recorded once (`delivery.confirm`, a
 * replay `already`) and, for a first receipt, the pushes that page held back released at once.
 */
export const receipt = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    incidentId: v.string(),
    eventId: v.string(),
    deviceId: v.string(),
  },
  handler: (
    ctx,
    claim: { workspaceId: string; incidentId: string; eventId: string; deviceId: string },
  ): ReceiptResult => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check, shard } = pager(c);
    if (workspace !== claim.workspaceId) return "invalid";
    const exec = (query: string, ...params: (string | number)[]) =>
      c.sql.exec(query, ...params) as Record<string, unknown>[];
    if (!allowReceipt(exec, claim.deviceId, c.now)) return "rate_limited";
    const id = deliveryId(claim.incidentId, claim.eventId, claim.deviceId);
    const mutationId = `receipt:${id}`;
    const stored = shard.storedResult(NOTIFIER_ACTOR.id, "receipts", mutationId, c.now);
    let result: ReceiptResult;
    if (stored) result = stored.ok ? "already" : receiptAnswer(stored.error.code);
    else {
      const out = shard.mutate({
        clientId: "receipts",
        mutationId,
        actor: NOTIFIER_ACTOR,
        name: "delivery.confirm",
        args: { id },
        now: c.now,
        internal: true,
      }).result;
      result = out.ok ? "recorded" : receiptAnswer(out.error.code);
    }
    // The page the phone confirmed no longer holds a lower-urgency push back from it: that goes out now.
    if (result === "recorded") p.releaseDue(c.now);
    scheduleTick(c, p, shard);
    check();
    return result;
  },
});

function receiptAnswer(code: string): ReceiptResult {
  if (code === "conflict") return "already";
  if (code === "not_found") return "not_found";
  log("receipt refused", { code });
  return "invalid";
}

/**
 * The pages the Queue has not brought in time, leased to the shard's own send (`local:send`, ember/local.ts): see
 * `Pager.overdue`. Each is due again a lease later, so a send that never finishes comes back; the next send is
 * scheduled at the earliest still watched.
 */
export const overdue = internalMutationGeneric({
  args: {},
  handler: (ctx): { event: BrigadeEvent; tries: number }[] => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check } = pager(c, "local");
    if (workspace === undefined) return [];
    c.sql.exec("delete from ember_ticks where key = 'local'");
    const leased = p.overdue(c.now);
    const next = p.pendingAt();
    if (next !== null) tickAt(c, next, "local");
    check();
    return leased;
  },
});

/**
 * How the shard's own send of a page ended (`WorkspaceDO.pageOneLocally`): sent (`sent`), or out of tries, ends the
 * watch (`arrived`); the relay's `Retry-After` holds it back until `until` (`postpone`); otherwise its lease brings it
 * back.
 */
export const localDone = internalMutationGeneric({
  args: {
    eventId: v.string(),
    tries: v.number(),
    sent: v.boolean(),
    until: v.optional(v.number()),
  },
  handler: (
    ctx,
    input: { eventId: string; tries: number; sent: boolean; until?: number },
  ): null => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace, check } = pager(c, "local");
    if (workspace === undefined) return null;
    if (input.sent) p.arrived(input.eventId);
    else if (input.tries >= PAGE_LOCAL_TRIES) {
      p.arrived(input.eventId);
      log("page sent from the shard still failing; left to the queue", { event: input.eventId });
    } else if (input.until !== undefined) p.postpone(input.eventId, input.until);
    const next = p.pendingAt();
    if (next !== null) tickAt(c, next, "local");
    check();
    return null;
  },
});
