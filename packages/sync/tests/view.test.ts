import { expect, test } from "vite-plus/test";
import { nextFailed, syncView } from "../src/view.ts";

test("a failed connect latches until data arrives, so retries do not flicker", () => {
  let failed = false;
  const step = (status: "loading" | "ready", connection: "connecting" | "open" | "waiting") =>
    (failed = nextFailed(failed, status, connection));
  expect(step("loading", "connecting")).toBe(false);
  expect(syncView("loading", "connecting", failed)).toBe("connecting");
  expect(step("loading", "waiting")).toBe(true);
  expect(step("loading", "connecting")).toBe(true); // The next attempt.
  expect(syncView("loading", "connecting", failed)).toBe("unavailable");
  expect(step("ready", "open")).toBe(false);
  expect(syncView("ready", "open", failed)).toBe("live");
});

test("after the list loaded, a dropped socket is reconnecting; a refused list is its own state", () => {
  expect(syncView("ready", "waiting", false)).toBe("reconnecting");
  expect(syncView("ready", "connecting", false)).toBe("reconnecting");
  // The shard said no: nothing retries it, so this is not "unavailable, still trying".
  expect(syncView("error", "open", false)).toBe("refused");
  expect(syncView("error", "waiting", true)).toBe("refused");
});
