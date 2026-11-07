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
  asksForPage,
  Pager,
  type DeadLetterResult,
  type DeviceOutcome,
  type PagePlan,
  type SkippedMember,
} from "../src/paging.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { emberWorkspace } from "./shard-facade.ts";

const TICK = "paging:tick";

/** How long an overdue tick is waited for before another is scheduled in its place. */
export const TICK_LEASE_MS = 60 * 1000;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * Schedules a tick at `at` unless one is already due by then (`ember_ticks` holds the earliest one scheduled), so
 * the many calls that each want one leave a single job.
 */
function tickAt(ctx: MutationCtx, at: number): void {
  const [row] = ctx.sql.exec("select at from ember_ticks where key = 'paging'") as { at: number }[];
  // An overdue tick is still queued (the scheduler runs late, never skips): keep it. One overdue past the lease is
  // taken for lost (its run threw) and replaced at once, since its work is due already.
  if (row && row.at < ctx.now - TICK_LEASE_MS) at = ctx.now;
  const when = Math.max(ctx.now, at);
  if (row && row.at <= when && row.at >= ctx.now - TICK_LEASE_MS) return;
  ctx.sql.exec(
    "insert into ember_ticks (key, at) values ('paging', ?) on conflict (key) do update set at = excluded.at",
    when,
  );
  ctx.scheduler.runAt(when, TICK, {});
}

/** A `Pager` over this mutation; `wake` schedules a tick at `at`. */
function pager(ctx: MutationCtx): { pager: Pager; workspace: string | undefined } {
  const { shard, storage } = emberWorkspace(ctx);
  const p = new Pager({
    storage,
    shard: shard as never,
    log,
    // Ember's subscriptions follow the rows: nothing to broadcast.
    committed: () => {},
    wake: (at) => tickAt(ctx, at),
  });
  return { pager: p, workspace: shard.workspace() };
}

/** Schedules the next tick at the pager's earliest due time, if it has one. */
function scheduleTick(ctx: MutationCtx, p: Pager): void {
  const due = [p.replayAt(), p.releaseAt(ctx.now)].filter((at): at is number => at !== null);
  if (due.length > 0) tickAt(ctx, Math.min(...due));
}

const event = v.any();

/**
 * `WorkspaceDO.planPage`'s synchronous part: the plan, and (for a page) that the Queue brought it (`arrived`), in
 * one transaction: a plan that throws leaves the page watched, as on the DO.
 */
export const plan = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): PagePlan => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace } = pager(c);
    if (workspace !== e.workspaceId) return { send: false, reason: "not_found" } as PagePlan;
    const out = p.plan(e, c.now);
    if (asksForPage(e)) p.arrived(e.id);
    scheduleTick(c, p);
    return out;
  },
});

/** `WorkspaceDO.recordDeadLetter`: a page the Queue gave up on. */
export const deadLettered = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): DeadLetterResult => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace } = pager(c);
    if (workspace !== e.workspaceId) return "other_workspace";
    const result = p.deadLettered(e, c.now);
    p.arrived(e.id);
    scheduleTick(c, p);
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
    const { pager: p, workspace } = pager(c);
    if (workspace !== input.event.workspaceId) return null;
    p.record(input.event, input.outcomes, input.final, input.skipped ?? [], c.now);
    scheduleTick(c, p);
    return null;
  },
});

/** The pager's due work: held pushes whose hold ran out, and replays; then the next tick. */
export const tick = internalMutationGeneric({
  args: {},
  handler: (ctx): { released: number; replayed: number } => {
    const c = ctx as MutationCtx;
    const { pager: p, workspace } = pager(c);
    if (workspace === undefined) return { released: 0, replayed: 0 };
    // This tick is the one scheduled: the next is whatever the pager wants after it.
    c.sql.exec("delete from ember_ticks where key = 'paging'");
    const released = p.releaseDue(c.now);
    const replayed = p.replayDue(c.now);
    scheduleTick(c, p);
    return { released, replayed };
  },
});
