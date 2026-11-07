// The shard's one upkeep tick (`paging:tick`, ember/paging.ts): the synchronous part of `WorkspaceDO`'s alarm, as one
// scheduler job at the earliest any area needs it. `ember_ticks` holds the earliest scheduled, so the many calls that
// each want one leave a single job. A module of its own, so `run()` (ember/workspace.ts) can arm it after a mutation
// that moved a timer, without importing the paging functions.

import type { MutationCtx } from "@freecorps/ember-server";
import { nextReminderAt, type BrigadeTables, type Store } from "@freecorps/brigade-schema";

export const TICK = "paging:tick";

/**
 * The least wait between one tick and the next it schedules: work still due right after a tick (a release that threw,
 * which `releaseAt` reports due at once, or more phones than one batch) waits this long, so a failing release never
 * spins the shard's alarm.
 */
export const TICK_RETRY_MS = 5 * 1000;

/** How long an overdue tick is waited for before another is scheduled in its place. */
export const TICK_LEASE_MS = 60 * 1000;

/** The soonest a tick may be scheduled from inside the mutation `ctx` (`holdTicks`). */
const floors = new WeakMap<MutationCtx, number>();

/**
 * Inside the tick itself: whatever this mutation schedules (the pager's wakes, a mutation's timers, the next tick)
 * goes `TICK_RETRY_MS` out at the soonest, so work still due right after a tick never spins the alarm.
 */
export function holdTicks(ctx: MutationCtx): number {
  const floor = ctx.now + TICK_RETRY_MS;
  floors.set(ctx, floor);
  return floor;
}

/**
 * Schedules a tick at `at` unless one is already due by then (`ember_ticks` holds the earliest one scheduled), so
 * the many calls that each want one leave a single job.
 */
export function tickAt(ctx: MutationCtx, at: number): void {
  at = Math.max(at, floors.get(ctx) ?? 0);
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

/** The tables whose changes can move the next reminder of follow-ups due (the DO's `REMINDER_TABLES`). */
export const REMINDER_TABLES: ReadonlySet<string> = new Set([
  "follow_ups",
  "member_settings",
  "members",
]);

/**
 * After a mutation that wrote `tables`: a tick at the next escalation level or reminder they may have moved, as the
 * DO's `onCommit` arms its alarm. Nothing for a mutation that wrote neither (a page, an acknowledgement).
 */
export function armUpkeep(
  ctx: MutationCtx,
  store: Store<BrigadeTables>,
  tables: ReadonlySet<string>,
): void {
  const due: number[] = [];
  if (tables.has("escalation_timers")) {
    for (const timer of store.scan("escalation_timers")) due.push(timer.at);
  }
  if ([...tables].some((table) => REMINDER_TABLES.has(table))) {
    const at = nextReminderAt(store, ctx.now);
    if (at !== null) due.push(at);
  }
  if (due.length > 0) tickAt(ctx, Math.min(...due));
}
