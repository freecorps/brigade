import { expect, test } from "vite-plus/test";
import { brigadeServer, devHost, memberActor } from "./sync";

test("the optimistic actor is the signed-in member; a role the app does not know reads as viewer", () => {
  expect(memberActor("usr_1", "responder")).toEqual({
    kind: "user",
    id: "usr_1",
    role: "responder",
  });
  expect(memberActor("usr_1", "owner,admin")).toEqual({
    kind: "user",
    id: "usr_1",
    role: "viewer",
  });
  expect(memberActor("usr_1", undefined).role).toBe("viewer");
});

test("the dev host is Metro's host, without its port", () => {
  expect(devHost("localhost:8081")).toBe("localhost");
  expect(devHost("10.0.2.2:8081")).toBe("10.0.2.2");
  expect(devHost("exp://192.0.2.10:8081/--/x")).toBe("192.0.2.10");
  expect(devHost("[::1]:8081")).toBe("[::1]");
  expect(devHost("")).toBeUndefined();
  expect(devHost(undefined)).toBeUndefined();
});

test("development builds sign in and sync through the dashboard's dev server on the Metro host", () => {
  const server = brigadeServer({ hostUri: "localhost:8081", dev: true });
  expect(server?.auth).toBe("http://localhost:5173/api/auth");
  expect(server?.sync("ws_1")).toBe("ws://localhost:5173/api/sync/ws_1");
  expect(brigadeServer({ hostUri: "10.0.2.2:8081", dev: true })?.sync("a b")).toBe(
    "ws://10.0.2.2:5173/api/sync/a%20b",
  );
});

test("release builds never fall back to the Metro host", () => {
  const release = { hostUri: "localhost:8081", dev: false };
  expect(brigadeServer(release)).toBeUndefined();
  const server = brigadeServer({ ...release, override: "https://brigade.example.com" });
  expect(server?.auth).toBe("https://brigade.example.com/api/auth");
  expect(server?.sync("ws_1")).toBe("wss://brigade.example.com/api/sync/ws_1");
});

test("an override wins, as an origin only; a malformed one, or none without a Metro host, is no server", () => {
  const dev = { hostUri: "localhost:8081", dev: true };
  expect(brigadeServer({ ...dev, override: "https://brigade.example.com/some/path/" })?.auth).toBe(
    "https://brigade.example.com/api/auth",
  );
  expect(brigadeServer({ ...dev, override: "  " })?.auth).toBe("http://localhost:5173/api/auth");
  expect(brigadeServer({ ...dev, override: "brigade.example.com" })).toBeUndefined();
  expect(brigadeServer({ ...dev, override: "ftp://brigade.example.com" })).toBeUndefined();
  expect(brigadeServer({ dev: true })).toBeUndefined();
});
