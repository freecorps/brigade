import { describe, expect, test } from "vite-plus/test";
import { MAX_SEGMENTS, stats, summarize, type SampleRow } from "../src/summary.ts";

const T0 = Date.UTC(2026, 9, 25, 12, 0, 0);

function row(minute: number, colo: string | null, overrides: Partial<SampleRow> = {}): SampleRow {
  const ts = T0 + minute * 60_000;
  return {
    ts,
    scheduled: ts - 50,
    retry: 0,
    instance: "a",
    colo,
    loc: colo === null ? null : "US",
    timings: { trace: 10 + minute, "aws-us-east-1": 70 },
    ...overrides,
  };
}

describe("stats", () => {
  test("nearest-rank percentiles", () => {
    expect(stats([5, 1, 4, 2, 3, 6, 7, 8, 9, 10])).toEqual({
      n: 10,
      min: 1,
      p50: 5,
      p95: 10,
      max: 10,
    });
    expect(stats([42])).toEqual({ n: 1, min: 42, p50: 42, p95: 42, max: 42 });
    expect(stats([])).toBeNull();
  });
});

describe("summarize", () => {
  test("empty", () => {
    const summary = summarize([]);
    expect(summary).toMatchObject({
      samples: 0,
      first: null,
      last: null,
      colos: [],
      moves: 0,
      instances: 0,
    });
    expect(summary.gapSeconds).toBeNull();
    expect(summary.latencyMs).toEqual({});
  });

  test("one colo for the whole window", () => {
    const summary = summarize([row(2, "IAD"), row(0, "IAD"), row(1, "IAD")]);
    expect(summary.samples).toBe(3);
    expect(summary.first).toBe("2026-10-25T12:00:00.000Z");
    expect(summary.last).toBe("2026-10-25T12:02:00.000Z");
    expect(summary.colos).toEqual([
      {
        colo: "IAD",
        samples: 3,
        first: "2026-10-25T12:00:00.000Z",
        last: "2026-10-25T12:02:00.000Z",
      },
    ]);
    expect(summary.moves).toBe(0);
    expect(summary.instances).toBe(1);
    expect(summary.countries).toEqual({ US: 3 });
    expect(summary.gapSeconds).toEqual({ n: 2, min: 60, p50: 60, p95: 60, max: 60 });
    expect(summary.lateMs).toMatchObject({ n: 3, p50: 50 });
    expect(summary.latencyMs.trace).toEqual({
      stats: { n: 3, min: 10, p50: 11, p95: 12, max: 12 },
      failures: 0,
    });
  });

  test("counts moves between colos and keeps the runs in order", () => {
    const summary = summarize([
      row(0, "FRA"),
      row(1, "FRA"),
      row(2, "AMS", { instance: "b" }),
      row(3, null),
      row(4, "AMS", { instance: "b" }),
      row(5, "FRA", { instance: "c" }),
    ]);
    expect(summary.colos.map(({ colo, samples }) => [colo, samples])).toEqual([
      ["FRA", 3],
      ["AMS", 2],
    ]);
    expect(summary.noColo).toBe(1);
    expect(summary.moves).toBe(2);
    expect(summary.segments.map(({ colo, samples }) => [colo, samples])).toEqual([
      ["FRA", 2],
      ["AMS", 2],
      ["FRA", 1],
    ]);
    expect(summary.instances).toBe(3);
  });

  test("keeps only the last runs", () => {
    const rows = Array.from({ length: MAX_SEGMENTS + 5 }, (_, i) => row(i, i % 2 ? "AMS" : "FRA"));
    const summary = summarize(rows);
    expect(summary.moves).toBe(MAX_SEGMENTS + 4);
    expect(summary.segments).toHaveLength(MAX_SEGMENTS);
    expect(summary.segments.at(-1)?.from).toBe(new Date(rows.at(-1)!.ts).toISOString());
  });

  test("failed requests, retries and alarms without a scheduled time", () => {
    const summary = summarize([
      row(0, "GRU", { timings: { trace: null, "aws-us-east-1": 120 } }),
      row(1, "GRU", { retry: 2, scheduled: null, timings: { trace: 8, "aws-us-east-1": null } }),
    ]);
    expect(summary.retries).toBe(1);
    expect(summary.lateMs?.n).toBe(1);
    expect(summary.latencyMs).toEqual({
      trace: { stats: { n: 1, min: 8, p50: 8, p95: 8, max: 8 }, failures: 1 },
      "aws-us-east-1": { stats: { n: 1, min: 120, p50: 120, p95: 120, max: 120 }, failures: 1 },
    });
  });
});
