// Pieces of the bklit charts (src/components/charts) Brigade fixed in place: the series decimation and ring progress.
import { expect, test } from "vite-plus/test";
import { decimateTimeSeries } from "../src/components/charts/decimate-time-series";
import { ringProgress } from "../src/components/charts/ring-context";

test("decimation keeps the ends once, stays in order, and can keep a point from the first bucket", () => {
  const data = Array.from({ length: 1000 }, (_, index) => ({
    index,
    value: index === 5 ? 1000 : 0,
  }));
  const sampled = decimateTimeSeries(data, 10, ["value"]);
  expect(sampled).toHaveLength(10);
  expect(sampled[0]!.index).toBe(0);
  expect(sampled.at(-1)!.index).toBe(999);
  const indices = sampled.map((point) => point.index);
  // Strictly increasing: the last point is not pushed twice.
  expect(indices.every((index, at) => at === 0 || index > indices[at - 1]!)).toBe(true);
  // The spike sits in the first bucket, which the off-by-one used to skip.
  expect(indices).toContain(5);
});

test("a ring fills between nothing and once round, whatever its maximum", () => {
  expect(ringProgress({ value: 1, maxValue: 4 })).toBe(0.25);
  expect(ringProgress({ value: 3, maxValue: 0 })).toBe(0);
  expect(ringProgress({ value: 9, maxValue: 4 })).toBe(1);
  expect(ringProgress({ value: -1, maxValue: 4 })).toBe(0);
});
