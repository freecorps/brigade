// Uptime bars on the public status page (RFC 0012 "Uptime"): a component linked to monitors shows 90 daily buckets,
// computed in the shard from its monitors' alerts. An alert is the monitor's own verdict that the target is down
// (after `CONSECUTIVE_CHECKS` alike results, RFC 0007), so a day's downtime is the time any linked monitor had an alert
// firing. Pure: the snapshot calls it with the shard's rows and the time it is built.

import type { AlertRow, MonitorRow } from "./tables.ts";

/** Days a bar covers, today included. */
export const UPTIME_DAYS = 90;
/** Monitors one component may be linked to. */
export const MAX_COMPONENT_MONITORS = 5;
/** A day with at least this much downtime is `down`; less (but some) is `degraded`. */
export const UPTIME_DOWN_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** One day of a bar: `none` when no linked monitor was watching yet. */
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

const overlap = (intervals: readonly Interval[], from: number, to: number) =>
  intervals.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, to) - Math.max(a, from)), 0);

/**
 * The bar for monitors `monitorIds` at `now`: every alert of theirs, firing or resolved, is downtime from when it fired
 * until it resolved (or now). A day counts from when the first linked monitor existed; before that it is `none`.
 * Monitors that no longer exist are left out.
 */
export function uptime(
  monitorIds: readonly string[],
  monitors: readonly Pick<MonitorRow, "id" | "createdAt">[],
  alerts: readonly Pick<AlertRow, "monitorId" | "firedAt" | "resolvedAt">[],
  now: number,
): Uptime {
  const linked = monitors.filter((monitor) => monitorIds.includes(monitor.id));
  const watchedFrom = linked.length
    ? Math.min(...linked.map((monitor) => monitor.createdAt))
    : null;
  const down = union(
    alerts
      .filter((alert) => linked.some((monitor) => monitor.id === alert.monitorId))
      .map((alert): Interval => [alert.firedAt, alert.resolvedAt ?? now]),
  );
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const days: UptimeDay[] = [];
  let watched = 0;
  let lost = 0;
  for (let index = UPTIME_DAYS - 1; index >= 0; index--) {
    const start = today - index * DAY_MS;
    const end = Math.min(start + DAY_MS, now);
    const date = new Date(start).toISOString().slice(0, 10);
    if (watchedFrom === null || watchedFrom >= end) {
      days.push({ date, state: "none", down: 0 });
      continue;
    }
    const from = Math.max(start, watchedFrom);
    const ms = overlap(down, from, end);
    watched += end - from;
    lost += ms;
    const state: UptimeState = ms === 0 ? "up" : ms >= UPTIME_DOWN_MS ? "down" : "degraded";
    days.push({ date, state, down: Math.ceil(ms / 60_000) });
  }
  const percent = watched > 0 ? Math.floor(((watched - lost) / watched) * 10_000) / 100 : null;
  return { percent, days };
}
