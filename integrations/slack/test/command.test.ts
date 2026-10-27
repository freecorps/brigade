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

test("declare without a title opens the form, at the severity given", () => {
  expect(parseCommand("declare")).toEqual({ kind: "declare", title: "", severity: "sev3" });
  expect(parseCommand("declare sev1")).toEqual({ kind: "declare", title: "", severity: "sev1" });
});

test("titles read as people wrote them: Slack's escapes undone", () => {
  expect(parseCommand("declare API &amp; DB down for <@U0USER0002|bia> <!here> sev2")).toEqual({
    kind: "declare",
    title: "API & DB down for @bia @here",
    severity: "sev2",
  });
  expect(
    parseCommand("declare see <https://status.example.com|status> in <#C0CHAN0001|ops>"),
  ).toEqual({
    kind: "declare",
    title: "see https://status.example.com in #ops",
    severity: "sev3",
  });
});

test("update takes the rest as the text, with INC-<number> first naming the incident", () => {
  expect(parseCommand("update Rolled back")).toEqual({ kind: "update", body: "Rolled back" });
  expect(parseCommand("update INC-12 Rolled back\nwatching")).toEqual({
    kind: "update",
    body: "Rolled back\nwatching",
    number: 12,
  });
  // A bare number is text: "12 servers are back" is an update.
  expect(parseCommand("update 12 servers are back")).toEqual({
    kind: "update",
    body: "12 servers are back",
  });
  expect(parseCommand("update")).toEqual({ kind: "unknown" });
  expect(parseCommand("update INC-12")).toEqual({ kind: "unknown" });
});

test("sev takes 1 to 4 (or sev1 to sev4), after an optional incident", () => {
  expect(parseCommand("sev 2")).toEqual({ kind: "severity", severity: "sev2" });
  expect(parseCommand("severity SEV1")).toEqual({ kind: "severity", severity: "sev1" });
  expect(parseCommand("sev INC-12 4")).toEqual({ kind: "severity", severity: "sev4", number: 12 });
  expect(parseCommand("sev 12 4")).toEqual({ kind: "severity", severity: "sev4", number: 12 });
  for (const text of ["sev", "sev 5", "sev high", "sev INC-12", "sev x 2", "sev 1 2 3"]) {
    expect(parseCommand(text), text).toEqual({ kind: "unknown" });
  }
});

test("role takes a role's name and the Slack user it goes to", () => {
  expect(parseCommand("role commander <@U0USER0002|bia>")).toEqual({
    kind: "role",
    role: "commander",
    user: "U0USER0002",
  });
  expect(parseCommand("role INC-3 Customer liaison <@W0USER0003>")).toEqual({
    kind: "role",
    role: "Customer liaison",
    user: "W0USER0003",
    number: 3,
  });
  // Without escaping (an old manifest), "@bia" names nobody.
  expect(parseCommand("role commander @bia")).toEqual({ kind: "unknown" });
  expect(parseCommand("role <@U0USER0002>")).toEqual({ kind: "unknown" });
});

test("resolve and escalate take nothing or an incident", () => {
  expect(parseCommand("resolve")).toEqual({ kind: "resolve" });
  expect(parseCommand("resolve INC-12")).toEqual({ kind: "resolve", number: 12 });
  expect(parseCommand("escalate 4")).toEqual({ kind: "escalate", number: 4 });
  expect(parseCommand("escalate now please")).toEqual({ kind: "unknown" });
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
  expect(parseCommand("status INC-12")).toEqual({ kind: "unknown" });
});
