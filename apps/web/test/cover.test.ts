// The overview's cover strip (src/lib/cover.ts): each schedule's next 24 hours as segments placed in percent of the
// window, a gap where nobody is on call, hour marks on the viewer's clock, and a stable tint per member.
import type { ScheduleLayer, ScheduleRow } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import { COVER_MS, coverLane, coverTicks, memberTint } from "../src/lib/cover";

const HOUR = 60 * 60 * 1000;
const layer = (members: string[], startDate: string, handoffTime = "09:00"): ScheduleLayer => ({
  id: "lyr_01JB0000000000000000000001",
  name: "",
  members,
  startDate,
  handoffTime,
  unit: "days",
  count: 1,
});
const schedule = (layers: ScheduleLayer[]): ScheduleRow => ({
  id: "sch_1",
  name: "Payments",
  timeZone: "America/Sao_Paulo",
  layers,
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
});
// 14:00 in São Paulo (UTC-3) on a Wednesday.
const NOW = Date.UTC(2026, 9, 28, 17, 0);

describe("coverLane", () => {
  test("a daily rotation hands off at 09:00 and the segments fill the window edge to edge", () => {
    const lane = coverLane(schedule([layer(["usr_ana", "usr_bia"], "2026-10-05")]), [], NOW);
    expect(lane.map((segment) => segment.userId)).toEqual(["usr_bia", "usr_ana"]);
    // The handoff is 09:00 tomorrow, 19 hours from now.
    expect(lane[1]!.start - NOW).toBe(19 * HOUR);
    expect(lane[0]!.left).toBe(0);
    expect(lane[0]!.width).toBeCloseTo((19 / 24) * 100);
    expect(lane.at(-1)!.end).toBe(NOW + COVER_MS);
    expect(lane.reduce((sum, segment) => sum + segment.width, 0)).toBeCloseTo(100);
  });

  test("before a layer starts, nobody is on call: the lane opens with a gap", () => {
    const lane = coverLane(schedule([layer(["usr_ana"], "2026-10-29", "08:00")]), [], NOW);
    expect(lane[0]).toMatchObject({ userId: null, left: 0 });
    expect(lane[0]!.width).toBeCloseTo((18 / 24) * 100);
    expect(lane[1]).toMatchObject({ userId: "usr_ana" });
  });

  test("a layer with nobody in it is one gap across the window", () => {
    const lane = coverLane(schedule([layer([], "2026-10-05")]), [], NOW);
    expect(lane).toHaveLength(1);
    expect(lane[0]).toMatchObject({ userId: null, left: 0, width: 100 });
  });
});

test("an hourly two-person rotation with many overrides still reaches the window's edge", () => {
  const hourly: ScheduleLayer = {
    ...layer(["usr_ana", "usr_bia"], "2026-10-05", "00:00"),
    unit: "hours",
  };
  const overrides = Array.from({ length: 30 }, (_, index) => ({
    id: `ovr_${index}`,
    scheduleId: "sch_1",
    userId: "usr_cai",
    start: NOW + index * 40 * 60_000 + 10 * 60_000,
    end: NOW + index * 40 * 60_000 + 20 * 60_000,
    createdAt: 0,
    createdBy: "usr_ana",
  }));
  const lane = coverLane(schedule([hourly]), overrides, NOW);
  expect(lane.length).toBeGreaterThan(48);
  expect(lane.at(-1)!.end).toBe(NOW + COVER_MS);
});

describe("coverTicks", () => {
  test("hourly marks keep every hour, and a clock turning back marks its repeated hour once", () => {
    expect(coverTicks(NOW, "America/Sao_Paulo", COVER_MS, 1)).toHaveLength(24);
    // New York falls back at 02:00 on 2026-11-01 (06:00 UTC): 01:00 comes twice, an hour apart.
    const before = Date.UTC(2026, 10, 1, 4, 30);
    const hours = coverTicks(before, "America/New_York", 4 * HOUR, 1).map((tick) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(tick.at),
    );
    expect(hours).toEqual(["01", "02", "03"]);
  });

  test("marks 00:00, 06:00, 12:00 and 18:00 on the viewer's clock", () => {
    const ticks = coverTicks(NOW, "America/Sao_Paulo");
    // 18:00 and 00:00 today, 06:00 and 12:00 tomorrow.
    expect(ticks.map((tick) => (tick.at - NOW) / HOUR)).toEqual([4, 10, 16, 22]);
    expect(ticks[0]!.left).toBeCloseTo((4 / 24) * 100);
  });

  test("a half-hour zone gets its own whole hours", () => {
    // 22:30 in Kolkata (UTC+5:30): the next mark is midnight, 90 minutes away.
    const ticks = coverTicks(NOW, "Asia/Kolkata");
    expect((ticks[0]!.at - NOW) / HOUR).toBe(1.5);
    expect(ticks).toHaveLength(4);
  });
});

test("a member keeps one tint, and the four tints all occur", () => {
  expect(memberTint("usr_ana")).toBe(memberTint("usr_ana"));
  const seen = new Set(Array.from({ length: 40 }, (_, index) => memberTint(`usr_${index}`)));
  expect(seen).toEqual(new Set([0, 1, 2, 3]));
});
