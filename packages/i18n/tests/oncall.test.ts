import type { MemberRow } from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  handoffTime,
  memberLabel,
  offsetLabel,
  scheduleRefusal,
  viewerTime,
  zoneLabel,
} from "../src/oncall.ts";

test("times say their zone, and the viewer's own time when their clock reads differently", () => {
  const at = Date.UTC(2026, 9, 27, 12);
  expect(handoffTime(at, "America/Sao_Paulo", "en")).toBe("Tue, Oct 27, 9:00 AM GMT-3");
  expect(viewerTime(at, "America/Sao_Paulo", "America/Sao_Paulo", "en")).toBeNull();
  // Same offset, different name: nothing to add.
  expect(viewerTime(at, "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "en")).toBeNull();
  expect(viewerTime(at, "America/Sao_Paulo", "Asia/Kolkata", "en")).toBe(
    "Tue, Oct 27, 5:30 PM GMT+5:30 your time",
  );
  expect(offsetLabel("Asia/Kathmandu", at)).toBe("UTC+05:45");
  expect(offsetLabel("America/Sao_Paulo", at)).toBe("UTC-03:00");
  // London in winter reads as an offset, not as if it were the UTC zone.
  expect(offsetLabel("Europe/London", at)).toBe("UTC+00:00");
  // Fourteen hours ahead and eleven behind: a day apart on the calendar.
  expect(offsetLabel("Pacific/Kiritimati", at)).toBe("UTC+14:00");
  expect(offsetLabel("Pacific/Pago_Pago", at)).toBe("UTC-11:00");
});

test("zones read by their current name, and members by theirs or as unnamed", () => {
  expect(zoneLabel("Asia/Calcutta")).toBe("Asia/Kolkata");
  expect(zoneLabel("America/Sao_Paulo")).toBe("America/Sao Paulo");
  const members = [
    { id: "usr_ana", name: "Ana" },
    { id: "usr_nameless", name: null },
  ] as MemberRow[];
  expect(memberLabel(members, "usr_ana")).toBe("Ana");
  expect(memberLabel(members, "usr_nameless")).toBe("Unnamed member");
  // Gone from the list (removed since): never a raw id.
  expect(memberLabel(members, "usr_gone")).toBe("Unnamed member");
  expect(scheduleRefusal("not_found")).toBe("The schedule no longer exists.");
});
