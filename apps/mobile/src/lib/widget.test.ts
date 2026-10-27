import type { OverrideRow, ScheduleLayer, ScheduleRow } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  WIDGET_STALE_MS,
  widgetSnapshot,
  widgetState,
  widgetTimeline,
  type WidgetSnapshot,
} from "./widget";

const ME = "usr_me";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const layer = (patch: Partial<ScheduleLayer> = {}): ScheduleLayer => ({
  id: "lyr_01JB0000000000000000000001",
  name: "",
  members: [ME, "usr_bia"],
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "days",
  count: 1,
  ...patch,
});

const schedule = (patch: Partial<ScheduleRow> = {}): ScheduleRow => ({
  id: "sch_01JB0000000000000000000001",
  name: "Platform",
  timeZone: "America/Sao_Paulo",
  layers: [layer()],
  createdAt: 0,
  createdBy: ME,
  updatedAt: 0,
  ...patch,
});

const override = (patch: Partial<OverrideRow>): OverrideRow => ({
  id: "ovr_01JB0000000000000000000001",
  scheduleId: "sch_01JB0000000000000000000001",
  userId: ME,
  start: 0,
  end: 0,
  createdAt: 0,
  createdBy: ME,
  ...patch,
});

// Tuesday 2026-10-27, 10:00 in São Paulo (UTC-3). Daily handoffs at 09:00 from Monday Oct 5 (the member's day):
// Oct 27 is day 22, the member's again.
const NOW = Date.UTC(2026, 9, 27, 13);
const nine = (day: number) => Date.UTC(2026, 9, day, 12);

const snap = (patch: Partial<Parameters<typeof widgetSnapshot>[0]> = {}) =>
  widgetSnapshot({
    schedules: [schedule()],
    overrides: [],
    userId: ME,
    now: NOW,
    locale: "pt-BR",
    openIncidents: 2,
    ...patch,
  });

test("the snapshot holds the member's stretches, the app's locale and when it goes stale", () => {
  const snapshot = snap();
  expect(snapshot).toMatchObject({
    v: 1,
    writtenAt: NOW,
    staleAt: NOW + WIDGET_STALE_MS,
    locale: "pt-BR",
    schedules: true,
    openIncidents: 2,
  });
  // Every other day, at 09:00 in São Paulo; the one under way from now.
  expect(snapshot.shifts.slice(0, 3)).toEqual([
    [NOW, nine(28)],
    [nine(29), nine(30)],
    [nine(31), Date.UTC(2026, 10, 1, 12)],
  ]);
  // Nothing in it names anyone or anything but times.
  expect(JSON.stringify(snapshot)).not.toContain("usr_");
  expect(JSON.stringify(snapshot)).not.toContain("Platform");
});

test("on two schedules at once is on call until the last ends; touching stretches are one", () => {
  const other = schedule({ id: "sch_01JB0000000000000000000002", layers: [layer({ count: 2 })] });
  const snapshot = snap({ schedules: [schedule(), other] });
  // Two-day turns from Oct 5: Oct 25 to 27 is the member's, then Oct 29 to 31, which covers the daily schedule's
  // Oct 29 and 31 turns: one stretch until the later end.
  expect(snapshot.shifts.slice(0, 2)).toEqual([
    [NOW, nine(28)],
    [nine(29), Date.UTC(2026, 10, 1, 12)],
  ]);
  // An override that fills the gap to the next day's turn makes one stretch of it.
  const covered = snap({ overrides: [override({ start: nine(28), end: nine(29) })] });
  expect(covered.shifts[0]).toEqual([NOW, nine(30)]);
});

test("no schedules, and a member nobody schedules", () => {
  expect(snap({ schedules: [] })).toMatchObject({ schedules: false, shifts: [] });
  expect(widgetState(snap({ schedules: [] }), NOW)).toEqual({ kind: "no-schedules" });
  const notMe = snap({ schedules: [schedule({ layers: [layer({ members: ["usr_bia"] })] })] });
  expect(notMe.shifts).toEqual([]);
  expect(widgetState(notMe, NOW)).toEqual({ kind: "off", next: null });
});

test("a lone member has no handoff in sight: on call with no end", () => {
  const alone = snap({ schedules: [schedule({ layers: [layer({ members: [ME] })] })] });
  expect(alone.shifts).toEqual([[expect.any(Number), null]]);
  expect(widgetState(alone, NOW + 3 * HOUR)).toEqual({ kind: "on", until: null });
});

test("the state flips at each handoff, then asks to open the app once stale; signed out without one", () => {
  const snapshot = snap();
  expect(widgetState(snapshot, NOW)).toEqual({ kind: "on", until: nine(28) });
  expect(widgetState(snapshot, nine(28))).toEqual({ kind: "off", next: nine(29) });
  expect(widgetState(snapshot, nine(28) - 1)).toEqual({ kind: "on", until: nine(28) });
  expect(widgetState(snapshot, snapshot.staleAt)).toEqual({ kind: "stale" });
  expect(widgetState(null, NOW)).toEqual({ kind: "signed-out" });
});

test("timeline entries: now, every handoff before it goes stale, and the moment it does", () => {
  const snapshot = snap();
  expect(widgetTimeline(snapshot, NOW)).toEqual([NOW, nine(28), NOW + WIDGET_STALE_MS]);
  const later: WidgetSnapshot = { ...snapshot, staleAt: NOW + 3 * DAY };
  expect(widgetTimeline(later, NOW)).toEqual([NOW, nine(28), nine(29), nine(30), NOW + 3 * DAY]);
  expect(widgetTimeline(snapshot, snapshot.staleAt + 1)).toEqual([snapshot.staleAt + 1]);
});

test("it names the open workspace, and says on call in another the phone pages the member for", () => {
  const off = snap({
    schedules: [schedule({ layers: [layer({ members: ["usr_bia"] })] })],
    workspace: "Acme",
    others: [
      { name: "Globex", shifts: [[NOW - HOUR, NOW + 2 * HOUR]], staleAt: NOW + DAY },
      // Gone stale: never shown, nor carried.
      { name: "Initech", shifts: [[NOW - HOUR, null]], staleAt: NOW - 1 },
    ],
  });
  expect(off.workspace).toBe("Acme");
  expect(off.others?.map((other) => other.name)).toEqual(["Globex"]);
  expect(widgetState(off, NOW)).toEqual({
    kind: "on-elsewhere",
    workspace: "Globex",
    until: NOW + 2 * HOUR,
  });
  expect(widgetState(off, NOW + 2 * HOUR)).toEqual({ kind: "off", next: null });
  // Its handoff is in the timeline, so the widget flips back on time.
  expect(widgetTimeline(off, NOW)).toContain(NOW + 2 * HOUR);
  // On call in the open one wins.
  const both = snap({ workspace: "Acme", others: off.others });
  expect(widgetState(both, NOW)).toEqual({ kind: "on", until: nine(28) });
  // No schedules here, on call there.
  const none = snap({ schedules: [], others: off.others });
  expect(widgetState(none, NOW)).toMatchObject({ kind: "on-elsewhere", workspace: "Globex" });
  // A snapshot from before workspaces still reads.
  const { workspace: _w, others: _o, ...older } = off;
  expect(widgetState(older, NOW)).toEqual({ kind: "off", next: null });
});
