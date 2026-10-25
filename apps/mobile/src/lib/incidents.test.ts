import { setLocale } from "@freecorps/brigade-i18n";
import { afterEach, expect, test } from "vite-plus/test";
import { formatAge, nextStatuses, refusalFor, refusalText, type Target } from "./incidents";

afterEach(() => setLocale("en"));

const ID = "inc_01M5PWGDG00000000000000001";

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
    { kind: "declare", incidentId: ID, title: "Checkout down" },
    "r2",
  )!;
  expect(refusal.clockSkew).toBe(true);
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
