// The overview's pulse (components/overview-pulse.tsx): what the dashboard's first screen counts and charts, from the
// rows the shard already syncs. Pure, so the counts and the series are tested apart from the charts that draw them.
import type {
  IncidentRow,
  MonitorRow,
  MonitorSample,
  Severity,
  SourceAlertRow,
} from "@freecorps/brigade-schema";
import { SEVERITIES } from "@freecorps/brigade-schema";
import { monitorBadge, type MonitorBadge } from "@/lib/monitors";

/** Active incidents by severity, every severity present (zero included), most severe first. */
export function incidentsBySeverity(
  rows: readonly Pick<IncidentRow, "severity">[],
): { severity: Severity; count: number }[] {
  return SEVERITIES.map((severity) => ({
    severity,
    count: rows.filter((row) => row.severity === severity).length,
  }));
}

/** The order monitors are counted and listed in: what needs someone first. */
export const MONITOR_STATES = [
  "down",
  "unknown",
  "pending",
  "up",
  "paused",
] as const satisfies readonly MonitorBadge[];

/** Monitors by what their badge says, every state present. */
export function monitorsByState(
  rows: readonly Pick<MonitorRow, "paused" | "status">[],
): Record<MonitorBadge, number> {
  const counts = Object.fromEntries(MONITOR_STATES.map((state) => [state, 0])) as Record<
    MonitorBadge,
    number
  >;
  for (const row of rows) counts[monitorBadge(row)] += 1;
  return counts;
}

/** One point of a monitor's latency line: the check's time and its latency. */
export type LatencyPoint = { at: number; latency: number };

/**
 * The monitor's recent latency, oldest first, every source on one line (the samples are already in check-time order).
 * A check with no latency (a heartbeat, a timeout) is left out rather than drawn as zero.
 */
export function latencySeries(history: readonly MonitorSample[] | undefined): LatencyPoint[] {
  return (history ?? []).flatMap((sample) =>
    sample.latencyMs === null ? [] : [{ at: sample.at, latency: sample.latencyMs }],
  );
}

/**
 * The share of the recent samples that were up, in percent rounded down to one decimal (so 99.96 never shows as
 * 100.0), or null with nothing to count. A chart's figure, not the status page's uptime: it covers only the samples
 * the row keeps.
 */
export function recentUpShare(history: readonly MonitorSample[] | undefined): number | null {
  const samples = history ?? [];
  if (samples.length === 0) return null;
  const up = samples.filter((sample) => sample.up).length;
  return Math.floor((up / samples.length) * 1000) / 10;
}

/** The latest latency each source reported, in the monitor's source order; sources without one are left out. */
export function latestLatencies(
  row: Pick<MonitorRow, "checks">,
): { source: string; latency: number; up: boolean }[] {
  return row.checks.flatMap((check) =>
    check.latencyMs === null
      ? []
      : [{ source: check.source, latency: check.latencyMs, up: check.up }],
  );
}

const HOUR_MS = 60 * 60 * 1000;
export const ALERT_HOURS = 24;

/**
 * Alerts that started firing in each of the last 24 hours, oldest hour first, the current hour last. `hour` is the
 * start of the bucket (epoch ms, whole hours ending at `now`'s hour). Alerts are counted where they fired, whatever
 * happened to them since.
 */
export function alertsByHour(
  rows: readonly Pick<SourceAlertRow, "firedAt">[],
  now: number,
): { hour: number; count: number }[] {
  const current = Math.floor(now / HOUR_MS) * HOUR_MS;
  const first = current - (ALERT_HOURS - 1) * HOUR_MS;
  const buckets = Array.from({ length: ALERT_HOURS }, (_, index) => ({
    hour: first + index * HOUR_MS,
    count: 0,
  }));
  for (const row of rows) {
    const index = Math.floor((row.firedAt - first) / HOUR_MS);
    if (index >= 0 && index < ALERT_HOURS) buckets[index]!.count += 1;
  }
  return buckets;
}
