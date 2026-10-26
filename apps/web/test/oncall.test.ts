import type { MemberRow, ScheduleLayer } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  checkOverride,
  checkSchedule,
  draftFromSchedule,
  fromLocalInput,
  layerRhythm,
  localInput,
  rotationChoices,
  type ScheduleDraft,
} from "@/lib/oncall";

const SCH = "sch_01JB0000000000000000000001";
const layer: ScheduleLayer = {
  id: "lyr_01JB0000000000000000000001",
  name: "Primary",
  members: ["usr_ana", "usr_bia"],
  startDate: "2026-10-05",
  handoffTime: "09:00",
  unit: "weeks",
  count: 1,
};
const draft = (patch: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  name: " Platform ",
  timeZone: "America/Sao_Paulo",
  layers: [{ ...layer, count: "1" }],
  ...patch,
});

test("a schedule draft becomes the mutation's arguments, trimmed and with a numeric count", () => {
  expect(checkSchedule(SCH, draft())).toEqual({
    ok: true,
    args: { id: SCH, name: "Platform", timeZone: "America/Sao_Paulo", layers: [layer] },
  });
  const row = { id: SCH, name: "Platform", timeZone: "America/Sao_Paulo", layers: [layer] };
  expect(draftFromSchedule({ ...row, createdAt: 0, createdBy: "", updatedAt: 0 })).toEqual(
    draft({ name: "Platform" }),
  );
});

test("a schedule draft reports every wrong field, per layer", () => {
  const checked = checkSchedule(
    SCH,
    draft({
      name: "  ",
      timeZone: "Nowhere/Land",
      layers: [
        {
          ...layer,
          members: [],
          startDate: "2026-02-30",
          handoffTime: "25:00",
          unit: "days",
          count: "32",
        },
      ],
    }),
  );
  expect(checked).toEqual({
    ok: false,
    errors: {
      name: true,
      timeZone: true,
      layers: [{ members: true, startDate: true, handoffTime: true, count: true }],
    },
  });
});

test("override times are read on the schedule's wall clock, not the browser's", () => {
  const start = fromLocalInput("2026-10-27T18:00", "America/Sao_Paulo");
  expect(start).toBe(Date.UTC(2026, 9, 27, 21));
  expect(localInput(start!, "Europe/London")).toBe("2026-10-27T21:00");
  const now = Date.UTC(2026, 9, 26);
  expect(
    checkOverride(
      SCH,
      "America/Sao_Paulo",
      { userId: "usr_ana", start: "2026-10-27T18:00", end: "2026-10-28T06:00" },
      now,
    ),
  ).toEqual({
    ok: true,
    args: { scheduleId: SCH, userId: "usr_ana", start, end: start! + 12 * 60 * 60 * 1000 },
  });
  expect(
    checkOverride(
      SCH,
      "UTC",
      { userId: "", start: "2026-10-27T18:00", end: "2026-10-27T17:00" },
      now,
    ),
  ).toEqual({ ok: false, errors: { userId: true, end: true } });
});

test("layers read as their rhythm, and viewers are never offered for a rotation", () => {
  expect(layerRhythm(layer, "en")).toBe("Weekly, hands off Monday at 9:00 AM");
  expect(layerRhythm({ ...layer, unit: "hours", count: 12 }, "pt-BR")).toBe(
    "A cada 12 horas, troca às 09:00",
  );
  const members: MemberRow[] = [
    { id: "usr_c", name: null, role: "responder", updatedAt: 0 },
    { id: "usr_b", name: "Bia", role: "viewer", updatedAt: 0 },
    { id: "usr_a", name: "Ana", role: "admin", updatedAt: 0 },
  ];
  expect(rotationChoices(members).map((member) => member.id)).toEqual(["usr_a", "usr_c"]);
});
