import { expect, test } from "vite-plus/test";
import { incidentByIdRoute, openedPage, tapStep } from "./page-taps";

const page = { incident: "inc_01ABC", workspace: "ws_one" };

test("a tapped page from native code is checked", () => {
  expect(openedPage(page)).toEqual(page);
  for (const bad of [
    null,
    "inc_01",
    { incident: "inc_01" },
    { incident: "evt_01", workspace: "ws" },
    { incident: "inc_../x", workspace: "ws" },
    { incident: "inc_01", workspace: "" },
    { incident: "inc_01", workspace: "a/b" },
  ]) {
    expect(openedPage(bad), JSON.stringify(bad)).toBeNull();
  }
});

test("opens in the workspace that is open, switches to another first, waits without a member", () => {
  expect(tapStep(page, "ws_one", false)).toBe("open");
  expect(tapStep(page, "ws_two", false)).toBe("switch");
  expect(tapStep(page, "ws_two", true)).toBe("wait");
  expect(tapStep(page, undefined, false)).toBe("wait");
});

test("the route finds the incident by id", () => {
  expect(incidentByIdRoute("inc_01ABC")).toBe("/incidents/by-id/inc_01ABC");
});
