import { expect, test } from "vite-plus/test";
import { canTransition, isActive } from "../src/index.ts";

test("triage can be declined, declined is final", () => {
  expect(canTransition("triage", "declined")).toBe(true);
  expect(canTransition("declined", "investigating")).toBe(false);
});

test("resolved incidents can be reopened", () => {
  expect(canTransition("resolved", "investigating")).toBe(true);
  expect(isActive("resolved")).toBe(false);
});
