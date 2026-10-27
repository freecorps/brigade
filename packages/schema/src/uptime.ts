// Uptime bars on the public status page (RFC 0012 "Uptime"): a component linked to monitors shows 90 daily buckets,
// computed in the shard from its monitors' alerts. An alert is the monitor's own verdict that the target is down
// (after `CONSECUTIVE_CHECKS` alike results, RFC 0007), so a day's downtime is the time any linked monitor had an alert
// firing. A monitor paused now has watched nothing since it was paused (its earlier pauses are not kept, so they count
// as up). Pure: the snapshot calls it with the shard's rows and the time it is built.

import type { AlertRow, MonitorRow } from "./tables.ts";

/** Days a bar covers, today included. */
export const UPTIME_DAYS = 90;
/** Monitors one component may be linked to. */
export const MAX_COMPONENT_MONITORS = 5;
/** A day with at least this much downtime is `down`; less (but some) is `degraded`. */
export const UPTIME_DOWN_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day of a bar: `none` when no linked monitor was watching (not yet, or paused). */
export const UPTIME_STATES = ["up", "degraded", "down", "none"] as const;
export type UptimeState = (typeof UPTIME_STATES)[number];

/** One day, in UTC: its date (`YYYY-MM-DD`), its state and the minutes of downtime it had. */
export type UptimeDay = { date: string; state: UptimeState; down: number };

/**
 * A component's bar: oldest day first, and the share of the watched time that was up over all of them, in percent
 * with two decimals, rounded down so 99.999 never shows as 100 (null when nothing was watched).
 */
export type Uptime = { percent: number | null; days: UptimeDay[] };

type Interval = [number, number];

/** Merges overlapping intervals (two monitors down at once count once). */
function union(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const merged: Interval[] = [];
  for (const [start, end] of sorted) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** The parts of `a` that are also in `b`; both merged (`union`). */
function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const from = Math.max(a0, b0);
      const to = Math.min(a1, b1);
      if (to > from) out.push([from, to]);
    }
  }
  return out;
}

const overlap = (intervals: readonly Interval[], from: number, to: number) =>
  intervals.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

/**
 * The bar for monitors `monitorIds` at `now`: every alert of theirs, firing or resolved, is downtime from when it fired
 * until it resolved (or now). A monitor watches from when it was created until now, or until it was paused while it
 * still is; time no linked monitor watched is `none`, and downtime counts only while one watched. Monitors that no
 * longer exist are left out.
 */
export function uptime(
  monitorIds: readonly string[],
  monitors: readonly Pick<MonitorRow, "id" | "createdAt" | "paused" | "pausedAt">[],
  alerts: readonly Pick<AlertRow, "monitorId" | "firedAt" | "resolvedAt">[],
  now: number,
): Uptime {
  const linked = monitors.filter((monitor) => monitorIds.includes(monitor.id));
  const watching = union(
    linked.map((monitor): Interval => [
      monitor.createdAt,
      monitor.paused && monitor.pausedAt !== null ? monitor.pausedAt : now,
    ]),
  );
  const down = intersect(
    union(
      alerts
        .filter((alert) => linked.some((monitor) => monitor.id === alert.monitorId))
        .map((alert): Interval => [alert.firedAt, alert.resolvedAt ?? now]),
    ),
    watching,
  );
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const days: UptimeDay[] = [];
  let watched = 0;
  let lost = 0;
  for (let index = UPTIME_DAYS - 1; index >= 0; index--) {
    const start = today - index * DAY_MS;
    const end = Math.min(start + DAY_MS, now);
    const date = new Date(start).toISOString().slice(0, 10);
    const span = overlap(watching, start, end);
    if (span === 0) {
      days.push({ date, state: "none", down: 0 });
      continue;
    }
    const ms = overlap(down, start, end);
    watched += span;
    lost += ms;
    const state: UptimeState = ms === 0 ? "up" : ms >= UPTIME_DOWN_MS ? "down" : "degraded";
    days.push({ date, state, down: Math.ceil(ms / 60_000) });
  }
  const percent = watched > 0 ? Math.floor(((watched - lost) / watched) * 10_000) / 100 : null;
  return { percent, days };
}

/** Whether any of `monitorIds` has an alert firing now: its bar moves while the page stands still. */
export function uptimeMoving(
  monitorIds: ReadonlySet<string>,
  alerts: readonly Pick<AlertRow, "monitorId" | "resolvedAt">[],
): boolean {
  return alerts.some((alert) => alert.resolvedAt === null && monitorIds.has(alert.monitorId));
}
