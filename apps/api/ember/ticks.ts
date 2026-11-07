// The shard's upkeep ticks (`paging:tick` and `paging:remind`, ember/paging.ts, and `local:send`, ember/local.ts): what
// `WorkspaceDO`'s alarm does, as scheduler jobs at the earliest each needs one. `ember_ticks` holds the earliest scheduled, so the many calls that
// each want one leave a single job. A module of its own, so `run()` (ember/workspace.ts) can arm it after a mutation
// that moved a timer, without importing the paging functions.

import type { MutationCtx } from "@freecorps/ember-server";
import type { BrigadeTables, Store } from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "../src/outbox.ts";
import { PAGE_QUEUE_GRACE_MS } from "../src/paging.ts";

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
 * The ticks, each its own job and transaction: `paging` (escalation levels, replays, held pushes) and `reminders`
 * (follow-up reminders), apart so a large follow-up history never weighs on a page's transaction (Ember's per-
 * transaction read limit), and a reminder that fails never rolls back a level that fired.
 */
const JOBS = {
  paging: TICK,
  reminders: "paging:remind",
  local: "local:send",
  reroute: "alerts:reroute",
  monitors: "monitors:tick",
} as const;
export type TickKey = keyof typeof JOBS;

/**
 * Schedules tick `key` at `at` unless one is already due by then (`ember_ticks` holds the earliest one scheduled),
 * so the many calls that each want one leave a single job.
 */
export function tickAt(ctx: MutationCtx, at: number, key: TickKey = "paging"): void {
  at = Math.max(at, floors.get(ctx) ?? 0);
  const [row] = ctx.sql.exec("select at from ember_ticks where key = ?", key) as { at: number }[];
  // An overdue tick is still queued (the scheduler runs late, never skips): keep it. One overdue past the lease is
  // taken for lost (its run threw) and replaced at once, since its work is due already.
  if (row && row.at < ctx.now - TICK_LEASE_MS) at = ctx.now;
  const when = Math.max(ctx.now, at);
  if (row && row.at <= when && row.at >= ctx.now - TICK_LEASE_MS) return;
  ctx.sql.exec(
    "insert into ember_ticks (key, at) values (?, ?) on conflict (key) do update set at = excluded.at",
    key,
    when,
  );
  ctx.scheduler.runAt(when, JOBS[key], {});
}

/**
 * After a mutation that wrote `tables`, as the DO's `onCommit` arms its alarm: the paging tick at the next escalation
 * level, and the reminders tick at once when a reminder may have moved (it reads the follow-ups in its own
 * transaction, never in this one). Nothing for a mutation that wrote neither (a page, an acknowledgement).
 */
export function armUpkeep(
  ctx: MutationCtx,
  store: Store<BrigadeTables>,
  tables: ReadonlySet<string>,
  name?: unknown,
): void {
  if (tables.has("escalation_timers")) {
    const due = store.scan("escalation_timers").map((timer) => timer.at);
    if (due.length > 0) tickAt(ctx, Math.min(...due));
  }
  // A follow-up or a member's email choices can make a reminder due. A member change only moves one already planned
  // (a reminders tick is pending): with none, nobody owns a follow-up due, and every member sync stays free.
  const planned = () =>
    (ctx.sql.exec("select 1 from ember_ticks where key = 'reminders'") as unknown[]).length > 0;
  if (
    tables.has("follow_ups") ||
    tables.has("member_settings") ||
    (tables.has("members") && planned())
  ) {
    tickAt(ctx, ctx.now, "reminders");
  }
  // The routes changed: what they kept quiet is routed again now (RFC 0005 "Alert sources"), as the DO's
  // `rerouteAlerts` does, in its own transaction (ember/alerts.ts).
  if (tables.has("alert_routes")) tickAt(ctx, ctx.now, "reroute");
  // A monitor changed: the tick pushes it to its probes (and watches its heartbeats) right away, as the DO's alarm.
  // Not for the monitors' own verdicts (`monitor.report`, `monitor.evaluate`), which run on every probe report.
  if (tables.has("monitors") && name !== "monitor.report" && name !== "monitor.evaluate") {
    tickAt(ctx, ctx.now, "monitors");
  }
}

/**
 * The pages a mutation just wrote (`Pager.expect`, the DO's `outboxed`): each is expected back from the Queue within
 * `PAGE_QUEUE_GRACE_MS`, or the shard sends it itself (`local:send`, ember/local.ts), armed here for then.
 */
export function expectPages(ctx: MutationCtx, pages: readonly BrigadeEvent[]): void {
  if (pages.length === 0) return;
  const due = ctx.now + PAGE_QUEUE_GRACE_MS;
  let watched = false;
  for (const page of pages) {
    // Never in the commit's way: a row that cannot be written leaves the page to the Queue alone, as on the DO.
    try {
      ctx.sql.exec(
        "insert into page_pending (event_id, event, due) values (?, ?, ?) on conflict do nothing",
        page.id,
        JSON.stringify(page),
        due,
      );
      watched = true;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "watching a page for the queue failed",
          event: page.id,
          error: String(error),
        }),
      );
    }
  }
  // Arming is never in the commit's way either: a page left unarmed is the Queue's alone, as on the DO.
  try {
    if (watched) tickAt(ctx, due, "local");
  } catch (error) {
    console.error(
      JSON.stringify({ message: "arming the page watch failed", error: String(error) }),
    );
  }
}
