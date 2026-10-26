import { setLocale } from "@freecorps/brigade-i18n";
import { afterEach, expect, test } from "vite-plus/test";
import {
  formatAge,
  noticeFor as refusalFor,
  noticeText,
  type Notice,
  type NoticeTarget as Target,
} from "@freecorps/brigade-i18n/incident";
import type { IncidentRow } from "@freecorps/brigade-schema";
import { nextStatuses, pickTarget } from "@freecorps/brigade-sync";
import { titleToRestore } from "./incidents";

// The app words a refusal in the incident's row, or below the list (where it names the incident: `card`).
const refusalText = (notice: Notice, place: "row" | "list") =>
  noticeText(notice, place === "row" ? "row" : "card");

// The incident list and page logic now comes from the shared packages; these tests pin what the app relies on.

afterEach(() => setLocale("en"));

const ID = "inc_01M5PWGDG00000000000000001";

const row = (changes: Partial<IncidentRow>): IncidentRow => ({
  id: ID,
  number: 3,
  title: "Status page CSS broken",
  severity: "sev4",
  status: "triage",
  declaredAt: 0,
  declaredBy: "usr_dev",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: 0,
  ...changes,
});

test("pickTarget checks a pick against the rows it is given (the screen passes the latest)", () => {
  const triage = [row({})];
  expect(pickTarget(triage, ID, { kind: "status", to: "declined" })).toEqual(triage[0]);
  // Another client moved it on while the sheet was open: Declined is no longer a move from Investigating.
  expect(
    pickTarget([row({ status: "investigating" })], ID, { kind: "status", to: "declined" }),
  ).toBeUndefined();
  expect(pickTarget(triage, ID, { kind: "status", to: "triage" })).toBeUndefined();
  expect(pickTarget([], ID, { kind: "status", to: "fixing" })).toBeUndefined();
  expect(pickTarget(triage, ID, { kind: "severity", to: "sev1" })).toEqual(triage[0]);
  expect(
    pickTarget([row({ severity: "sev1" })], ID, { kind: "severity", to: "sev1" }),
  ).toBeUndefined();
  expect(pickTarget([], ID, { kind: "severity", to: "sev1" })).toBeUndefined();
});

test("a title the shard refused comes back only to an empty field, and never for the clock", () => {
  const declare: Target = { kind: "declare", incidentId: ID, number: null, title: "Checkout down" };
  const refused = refusalFor(
    {
      ok: false,
      error: { code: "invalid_args", message: "bad", issues: [{ path: "title", message: "x" }] },
    },
    declare,
    "t1",
  )!;
  expect(titleToRestore(refused, "")).toBe("Checkout down");
  expect(titleToRestore(refused, "Typed since")).toBeUndefined();
  const skew = refusalFor(
    {
      ok: false,
      error: { code: "invalid_args", message: "bad", issues: [{ path: "id", message: "x" }] },
    },
    declare,
    "t2",
  )!;
  expect(titleToRestore(skew, "")).toBeUndefined();
  const forbidden = refusalFor(
    { ok: false, error: { code: "forbidden", message: "no" } },
    declare,
    "t3",
  )!;
  expect(titleToRestore(forbidden, "")).toBeUndefined();
});

test("only the moves the lifecycle allows are offered", () => {
  expect(nextStatuses("resolved")).toEqual(["investigating"]);
  expect(nextStatuses("fixing")).not.toContain("fixing");
  expect(nextStatuses("declined")).toEqual([]);
});

test("ages read 'just now' under a minute and never in the future", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0, 0);
  expect(formatAge(now + 5_000, now, "en")).toBe("just now");
  expect(formatAge(now - 3 * 60_000, now, "en")).toBe("3 minutes ago");
  expect(formatAge(now - 2 * 3_600_000, now, "pt-BR")).toBe("há 2 horas");
});

const move: Target = {
  kind: "status",
  incidentId: ID,
  number: 7,
  title: "Checkout down",
  to: "fixing",
};

test("a confirmed change leaves nothing; a refused one is worded in its row or below the list", () => {
  expect(refusalFor({ ok: true, version: 3 }, move, "r0")).toBeUndefined();
  const refusal = refusalFor(
    { ok: false, error: { code: "invalid_transition", message: "no" } },
    move,
    "r1",
  )!;
  expect(refusalText(refusal, "row")).toBe(
    "Couldn't move it to Fixing. Its status changed in the meantime, so that move is no longer allowed.",
  );
  expect(refusalText(refusal, "list")).toContain("INC-7 “Checkout down”");
  void setLocale("pt-BR");
  expect(refusalText(refusal, "row")).not.toContain("Couldn't");
});

test("a declare refused for its id is the device clock, not the title", () => {
  const refusal = refusalFor(
    {
      ok: false,
      error: { code: "invalid_args", message: "bad", issues: [{ path: "id", message: "future" }] },
    },
    { kind: "declare", incidentId: ID, number: null, title: "Checkout down" },
    "r2",
  )!;
  expect(refusal.reason).toBe("clock_skew");
  expect(refusalText(refusal, "list")).toContain("device clock");
  const severity = refusalFor(
    { ok: false, error: { code: "forbidden", message: "no" } },
    { ...move, kind: "severity", to: "sev1" },
    "r3",
  )!;
  expect(refusalText(severity, "row")).toBe(
    "Couldn't change it to SEV1 Critical. You don't have permission to do that.",
  );
});
