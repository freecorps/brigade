import { expect, test } from "vite-plus/test";
import { incidentByIdRoute, openedPage, tapStep } from "./page-taps";

const page = { incident: "inc_01ABC", workspace: "ws_one" };
const sealed = { ...page, origin: "https://acme.example.com" };

test("a tapped page from native code is checked", () => {
  expect(openedPage(page)).toEqual(page);
  expect(openedPage(sealed)).toEqual(sealed);
  expect(openedPage({ ...page, origin: null })).toEqual(page);
  // Written otherwise, the same instance.
  for (const same of [
    "https://ACME.example.com",
    "https://acme.example.com/",
    "https://acme.example.com:443",
  ]) {
    expect(openedPage({ ...page, origin: same }), same).toEqual(sealed);
  }
  for (const bad of [
    null,
    "inc_01",
    { incident: "inc_01" },
    { incident: "evt_01", workspace: "ws" },
    { incident: "inc_../x", workspace: "ws" },
    { incident: "inc_01", workspace: "" },
    { incident: "inc_01", workspace: "a/b" },
    // An origin not written as `URL.origin` writes it cannot name an instance.
    { ...page, origin: "https://acme.example.com/path" },
    { ...page, origin: "https://acme.example.com/?q" },
    { ...page, origin: "https://user@acme.example.com" },
    { ...page, origin: "acme" },
    { ...page, origin: 1 },
  ]) {
    expect(openedPage(bad), JSON.stringify(bad)).toBeNull();
  }
});

const here = { instance: "default", active: "default" };

test("opens in the workspace that is open, switches to another first, waits without a member", () => {
  expect(tapStep(page, here, "ws_one", false)).toBe("open");
  expect(tapStep(page, here, "ws_two", false)).toBe("switch");
  expect(tapStep(page, here, "ws_two", true)).toBe("wait");
  expect(tapStep(page, here, undefined, false)).toBe("wait");
});

test("a page from another instance switches to it first; one from no instance on the phone is dropped", () => {
  expect(tapStep(sealed, { instance: "acme", active: "default" }, "ws_one", false)).toBe(
    "instance",
  );
  expect(tapStep(sealed, { instance: "acme", active: "acme" }, "ws_one", false)).toBe("open");
  expect(tapStep(sealed, { instance: undefined, active: "default" }, "ws_one", false)).toBe("drop");
  // A version 1 page names no instance: the app's, once it has one.
  expect(tapStep(page, { instance: undefined, active: undefined }, undefined, false)).toBe("wait");
});

test("the route finds the incident by id", () => {
  expect(incidentByIdRoute("inc_01ABC")).toBe("/incidents/by-id/inc_01ABC");
});
