import { expect, test } from "vite-plus/test";
import { answeredCallStep, pendingCallStore, type SessionKind } from "./answered-call";
import type { CallState } from "./call-session";

const call = (id: string, ended = false): CallState => ({
  call: { id, title: "sev1 · API down", body: "Checkout fails", incident: "inc_01ABC" },
  ack: { kind: "idle" },
  ended,
});

test("an answered call opens once a member is ready", () => {
  expect(answeredCallStep("c1", "ready", call("c1"))).toBe("open");
});

test("it waits while the session is read, or could not be read and may come back", () => {
  expect(answeredCallStep("c1", "loading", call("c1"))).toBe("wait");
  expect(answeredCallStep("c1", "unavailable", call("c1"))).toBe("wait");
});

test("it is dropped when nobody will be signed in to show it to", () => {
  for (const session of ["signed-out", "no-server", "no-workspace"] satisfies SessionKind[]) {
    expect(answeredCallStep("c1", session, call("c1"))).toBe("drop");
  }
});

test("it is dropped when the call ended first, or another call replaced it", () => {
  expect(answeredCallStep("c1", "ready", call("c1", true))).toBe("drop");
  expect(answeredCallStep("c1", "loading", call("c1", true))).toBe("drop");
  expect(answeredCallStep("c1", "ready", call("c2"))).toBe("drop");
  expect(answeredCallStep("c1", "ready", null)).toBe("drop");
});

test("the waiting call is taken once, and a later answer replaces it", () => {
  const store = pendingCallStore();
  let heard = 0;
  store.subscribe(() => heard++);
  store.answered("c1");
  store.answered("c2");
  expect(store.current()).toBe("c2");
  expect(store.take("c1")).toBe(false);
  expect(store.take("c2")).toBe(true);
  expect(store.take("c2")).toBe(false);
  expect(store.current()).toBeNull();
  expect(heard).toBe(3);
});
