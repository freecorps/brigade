import { expect, test } from "vite-plus/test";
import { DEV_ACTOR as API_DEV_ACTOR } from "../../../api/src/dev-actor.ts";
import { DEV_ACTOR, devHost, syncUrl } from "./sync";

test("the optimistic actor is the shard's dev actor, so no change shows that the shard then refuses", () => {
  expect(DEV_ACTOR).toEqual(API_DEV_ACTOR);
});

test("the dev host is Metro's host, without its port", () => {
  expect(devHost("localhost:8081")).toBe("localhost");
  expect(devHost("10.0.2.2:8081")).toBe("10.0.2.2");
  expect(devHost("exp://192.0.2.10:8081/--/x")).toBe("192.0.2.10");
  expect(devHost("[::1]:8081")).toBe("[::1]");
  expect(devHost("")).toBeUndefined();
  expect(devHost(undefined)).toBeUndefined();
});

test("development builds connect to the dashboard's dev server on the Metro host", () => {
  expect(syncUrl("demo", { hostUri: "localhost:8081" })).toBe("ws://localhost:5173/api/sync/demo");
  expect(syncUrl("a b", { hostUri: "10.0.2.2:8081" })).toBe("ws://10.0.2.2:5173/api/sync/a%20b");
});

test("an override wins, and without one or a Metro host there is no URL", () => {
  expect(
    syncUrl("demo", { override: "wss://brigade.example.com/api/sync/", hostUri: "localhost:8081" }),
  ).toBe("wss://brigade.example.com/api/sync/demo");
  expect(syncUrl("demo", { override: "  ", hostUri: "localhost:8081" })).toBe(
    "ws://localhost:5173/api/sync/demo",
  );
  expect(syncUrl("demo", {})).toBeUndefined();
});
