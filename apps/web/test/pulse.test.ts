// The overview's pulse (src/lib/pulse.ts): the counts the first screen leads with and the series its charts draw.
import type { MonitorSample } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import {
  ALERT_HOURS,
  alertsByHour,
  incidentsBySeverity,
  latencySeries,
  latestLatencies,
  monitorsByState,
  recentUpShare,
} from "../src/lib/pulse";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 28, 14, 20);
const sample = (at: number, up: boolean, latencyMs: number | null): MonitorSample => ({
  source: "weur",
  at,
  up,
  latencyMs,
});

test("incidents by severity: every severity, zero included, most severe first", () => {
  const counts = incidentsBySeverity([
    { severity: "sev2" },
    { severity: "sev2" },
    { severity: "sev4" },
  ]);
  expect(counts).toEqual([
    { severity: "sev1", count: 0 },
    { severity: "sev2", count: 2 },
    { severity: "sev3", count: 0 },
    { severity: "sev4", count: 1 },
  ]);
});

test("monitors by state: a paused monitor counts as paused, whatever its last status", () => {
  const counts = monitorsByState([
    { paused: false, status: "up" },
    { paused: false, status: "down" },
    { paused: true, status: "up" },
    { paused: false, status: "pending" },
  ]);
  expect(counts).toEqual({ down: 1, unknown: 0, pending: 1, up: 1, paused: 1 });
});

describe("a monitor's recent checks", () => {
  test("the latency line leaves out checks without a latency instead of drawing them as zero", () => {
    const history = [sample(1, true, 120), sample(2, false, null), sample(3, true, 140)];
    expect(latencySeries(history)).toEqual([
      { at: 1, latency: 120 },
      { at: 3, latency: 140 },
    ]);
    expect(latencySeries(undefined)).toEqual([]);
  });

  test("the up share rounds down, so a single down sample never reads as 100%", () => {
    const history = [
      ...Array.from({ length: 2999 }, (_, index) => sample(index, true, 100)),
      sample(3000, false, null),
    ];
    expect(recentUpShare(history)).toBe(99.9);
    expect(recentUpShare([])).toBeNull();
    expect(recentUpShare(undefined)).toBeNull();
  });

  test("the latest latency per source skips a source that has none", () => {
    expect(
      latestLatencies({
        checks: [
          {
            source: "weur",
            at: 1,
            up: true,
            latencyMs: 90,
            colo: "CDG",
            httpStatus: 200,
            error: null,
          },
          {
            source: "wnam",
            at: 1,
            up: false,
            latencyMs: null,
            colo: null,
            httpStatus: null,
            error: "timeout",
          },
        ],
      }),
    ).toEqual([{ source: "weur", latency: 90, up: true }]);
  });
});

test("alerts by hour: 24 whole hours ending with the current one, counted where they fired", () => {
  const current = Math.floor(NOW / HOUR) * HOUR;
  const buckets = alertsByHour(
    [
      { firedAt: NOW },
      { firedAt: current + 1 },
      { firedAt: current - HOUR },
      // A day and more ago: outside the window.
      { firedAt: current - ALERT_HOURS * HOUR },
    ],
    NOW,
  );
  expect(buckets).toHaveLength(ALERT_HOURS);
  expect(buckets.at(-1)).toEqual({ hour: current, count: 2 });
  expect(buckets.at(-2)).toEqual({ hour: current - HOUR, count: 1 });
  expect(buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
});
