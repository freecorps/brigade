import type { OverrideRow, ScheduleLayer, ScheduleRow } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import { coverArgs, NEXT_SHOWN, onCallStatus, onCallView, statusTime } from "./oncall";

const ME = "usr_me";
const HOUR = 3_600_000;

const layer = (patch: Partial<ScheduleLayer> = {}): ScheduleLayer => ({
  id: "lyr_01JB0000000000000000000001",
  name: "",
  members: [ME, "usr_bia"],
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "weeks",
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

// Tuesday 2026-10-27, 09:00 in São Paulo (UTC-3): week 3 of the rotation, so Bia's; the member's starts Monday.
const NOW = Date.UTC(2026, 9, 27, 12);

test("on call now: until the handoff, in the schedule's own zone, and the next shift after it", () => {
  // Weeks run from Monday Oct 5, the member's first: Oct 19 is theirs again.
  const now = Date.UTC(2026, 9, 20, 12);
  const view = onCallView([schedule()], [], ME, now);
  expect(view.current).toHaveLength(1);
  // Monday Oct 26, 09:00 in São Paulo.
  expect(view.current[0]?.end).toBe(Date.UTC(2026, 9, 26, 12));
  expect(view.next.map((shift) => shift.start)).toEqual([
    Date.UTC(2026, 10, 2, 12),
    Date.UTC(2026, 10, 16, 12),
  ]);
  expect(onCallStatus(view)).toEqual({ kind: "on", until: Date.UTC(2026, 9, 26, 12), schedules: 1 });
  expect(view.schedules[0]).toMatchObject({ userId: ME, override: false });
});

test("not on call: the next shift, or none in the next four weeks", () => {
  const view = onCallView([schedule()], [], ME, NOW);
  expect(view.current).toEqual([]);
  expect(onCallStatus(view)).toEqual({ kind: "off", next: Date.UTC(2026, 10, 2, 12) });
  expect(view.schedules[0]).toMatchObject({ userId: "usr_bia", until: Date.UTC(2026, 10, 2, 12) });

  const elsewhere = onCallView([schedule({ layers: [layer({ members: ["usr_bia"] })] })], [], ME, NOW);
  expect(onCallStatus(elsewhere)).toEqual({ kind: "off", next: null });
  // One person holds every shift: no handoff to end theirs.
  expect(elsewhere.schedules[0]).toMatchObject({ userId: "usr_bia", until: null });
  expect(onCallStatus(onCallView([], [], ME, NOW))).toEqual({ kind: "none" });
});

test("nobody on call: a layer with nobody is a gap, said as nobody", () => {
  const view = onCallView([schedule({ layers: [layer({ members: [] })] })], [], ME, NOW);
  expect(view.schedules[0]).toEqual({
    schedule: expect.objectContaining({ name: "Platform" }),
    userId: null,
    override: false,
    until: null,
  });
  expect(onCallStatus(view)).toEqual({ kind: "off", next: null });
});

test("an override puts the member on call, shows as theirs, and one that ended or is someone else's does not", () => {
  const mine = override({ start: NOW - HOUR, end: NOW + 4 * HOUR });
  const theirs = override({ id: "ovr_01JB0000000000000000000002", userId: "usr_bia", start: NOW + 5 * HOUR, end: NOW + 6 * HOUR });
  const ended = override({ id: "ovr_01JB0000000000000000000003", start: NOW - 3 * HOUR, end: NOW - 2 * HOUR });
  const orphan = override({ id: "ovr_01JB0000000000000000000004", scheduleId: "sch_gone", start: NOW, end: NOW + HOUR });
  const view = onCallView([schedule()], [mine, theirs, ended, orphan], ME, NOW);
  expect(view.current).toEqual([
    expect.objectContaining({ end: NOW + 4 * HOUR, override: true }),
  ]);
  expect(view.schedules[0]).toMatchObject({ userId: ME, override: true, until: NOW + 4 * HOUR });
  expect(view.overrides.map((item) => item.row.id)).toEqual([mine.id]);
});

test("on call on several schedules: until the last one hands off; one with no end keeps it open", () => {
  const other = schedule({
    id: "sch_01JB0000000000000000000002",
    name: "Database",
    layers: [layer({ unit: "hours", count: 12, startDate: "2026-10-27", handoffTime: "08:00" })],
  });
  const view = onCallView([schedule({ layers: [layer({ startDate: "2026-10-26" })] }), other], [], ME, NOW);
  // Database: 08:00-20:00 São Paulo is the member's; Platform runs the week to Monday.
  expect(view.current.map((shift) => shift.schedule.name)).toEqual(["Database", "Platform"]);
  expect(onCallStatus(view)).toEqual({ kind: "on", until: Date.UTC(2026, 10, 2, 12), schedules: 2 });

  const solo = schedule({ id: "sch_01JB0000000000000000000003", layers: [layer({ members: [ME] })] });
  expect(onCallStatus(onCallView([solo, other], [], ME, NOW))).toEqual({
    kind: "on",
    until: null,
    schedules: 2,
  });
});

test("handoffs follow the schedule's clock across a daylight saving change, and a far zone's calendar", () => {
  // New York leaves daylight time on Sunday, Nov 1 2026: 09:00 is 13:00 UTC before and 14:00 UTC after.
  const daily = schedule({
    timeZone: "America/New_York",
    layers: [layer({ unit: "days", members: [ME, "usr_bia"], startDate: "2026-10-30" })],
  });
  const view = onCallView([daily], [], ME, Date.UTC(2026, 9, 30, 15));
  expect(view.current[0]?.end).toBe(Date.UTC(2026, 9, 31, 13));
  expect(view.next.slice(0, 2).map((shift) => shift.start)).toEqual([
    Date.UTC(2026, 10, 1, 14),
    Date.UTC(2026, 10, 3, 14),
  ]);
  // Kiritimati is UTC+14: its Tuesday 09:00 is Monday 19:00 UTC, so its week ends on a Monday in UTC.
  const far = schedule({ timeZone: "Pacific/Kiritimati", layers: [layer({ startDate: "2026-10-27" })] });
  expect(onCallView([far], [], ME, NOW).current[0]?.end).toBe(Date.UTC(2026, 10, 2, 19));
});

test("a fast rotation lists only the member's next few shifts", () => {
  const hourly = schedule({ layers: [layer({ unit: "hours", count: 1, startDate: "2026-10-27" })] });
  const view = onCallView([hourly], [], ME, NOW);
  expect(view.next).toHaveLength(NEXT_SHOWN);
  expect(view.next.every((shift) => shift.end !== null && shift.end - shift.start === HOUR)).toBe(true);
});

test("status times are as short as still clear, on the viewer's clock", () => {
  const zone = "America/Sao_Paulo";
  expect(statusTime(NOW + 3 * HOUR, NOW, "en", zone)).toBe("12:00 PM");
  expect(statusTime(NOW + 24 * HOUR, NOW, "en", zone)).toBe("Wed, 9:00 AM");
  expect(statusTime(NOW + 10 * 24 * HOUR, NOW, "en", zone)).toBe("Nov 6, 9:00 AM");
  expect(statusTime(NOW + 24 * HOUR, NOW, "pt-BR", zone)).toBe("qua., 09:00");
  // The day is the viewer's: midnight UTC is already Wednesday morning in Tokyo, where it is Tuesday night now.
  expect(statusTime(NOW + 12 * HOUR, NOW, "en", "Asia/Tokyo")).toBe("Wed, 9:00 AM");
});

test("covering a schedule starts now on a whole minute and ends hours later", () => {
  const at = NOW + 37_123;
  expect(coverArgs("sch_x", ME, at, 12)).toEqual({
    scheduleId: "sch_x",
    userId: ME,
    start: NOW,
    end: NOW + 12 * HOUR,
  });
});
