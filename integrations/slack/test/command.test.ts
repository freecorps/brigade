import { expect, test } from "vite-plus/test";
import { parseCommand } from "../src/command.ts";

test("declare takes the rest as the title and a last sev1 to sev4 as the severity", () => {
  expect(parseCommand("declare Checkout is down sev1")).toEqual({
    kind: "declare",
    title: "Checkout is down",
    severity: "sev1",
  });
  expect(parseCommand("  DECLARE   Payments   slow  SEV2 ")).toEqual({
    kind: "declare",
    title: "Payments slow",
    severity: "sev2",
  });
});

test("declare without a severity is SEV3, the dashboard's default", () => {
  expect(parseCommand("declare Search returns nothing")).toEqual({
    kind: "declare",
    title: "Search returns nothing",
    severity: "sev3",
  });
  // Only the last word counts, and only sev1 to sev4.
  expect(parseCommand("declare sev1 database sev5")).toEqual({
    kind: "declare",
    title: "sev1 database sev5",
    severity: "sev3",
  });
});

test("declare without a title is not a command", () => {
  expect(parseCommand("declare")).toEqual({ kind: "unknown" });
  expect(parseCommand("declare sev1")).toEqual({ kind: "unknown" });
});

test("ack takes nothing, a number or INC-<number>", () => {
  expect(parseCommand("ack")).toEqual({ kind: "ack" });
  expect(parseCommand("ack 12")).toEqual({ kind: "ack", number: 12 });
  expect(parseCommand("ack INC-12")).toEqual({ kind: "ack", number: 12 });
  expect(parseCommand("acknowledge inc-7")).toEqual({ kind: "ack", number: 7 });
  for (const text of ["ack 0", "ack twelve", "ack 12 13", "ack -1", "ack INC-"]) {
    expect(parseCommand(text), text).toEqual({ kind: "unknown" });
  }
});

test("help, nothing, and anything else", () => {
  expect(parseCommand("")).toEqual({ kind: "help" });
  expect(parseCommand("help")).toEqual({ kind: "help" });
  expect(parseCommand("resolve INC-12")).toEqual({ kind: "unknown" });
});
