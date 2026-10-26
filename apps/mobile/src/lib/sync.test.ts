import { expect, test } from "vite-plus/test";
import { brigadeServer, devHost, knownWorkspace, memberActor, settledRole } from "./sync";

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
  expect(server?.forgotPassword).toBe("http://localhost:5173/forgot-password");
  expect(server?.sync("ws_1")).toBe("ws://localhost:5173/api/sync/ws_1");
  expect(server?.ack("ws_1", "inc_1")).toBe(
    "http://localhost:5173/api/workspaces/ws_1/incidents/inc_1/ack",
  );
  expect(brigadeServer({ hostUri: "10.0.2.2:8081", dev: true })?.sync("a b")).toBe(
    "ws://10.0.2.2:5173/api/sync/a%20b",
  );
});

test("release builds never fall back to the Metro host", () => {
  const release = { hostUri: "localhost:8081", dev: false };
  expect(brigadeServer(release)).toBeUndefined();
  const server = brigadeServer({ ...release, override: "https://brigade.example.com" });
  expect(server?.auth).toBe("https://brigade.example.com/api/auth");
  expect(server?.forgotPassword).toBe("https://brigade.example.com/forgot-password");
  expect(server?.ack("ws_1", "a/b")).toBe(
    "https://brigade.example.com/api/workspaces/ws_1/incidents/a%2Fb/ack",
  );
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

test("the remembered workspace opens only for the same member in the same workspace", () => {
  const known = { userId: "usr_a", workspaceId: "org_a", name: "Acme", role: "responder" };
  const raw = JSON.stringify(known);
  expect(knownWorkspace(raw, "usr_a", "org_a")).toEqual(known);
  expect(knownWorkspace(raw, "usr_b", "org_a")).toBeNull();
  expect(knownWorkspace(raw, "usr_a", "org_b")).toBeNull();
  expect(knownWorkspace(JSON.stringify({ ...known, role: "owner!" }), "usr_a", "org_a")).toBeNull();
  for (const bad of [null, "", "{}", "nope", "null"]) {
    expect(knownWorkspace(bad, "usr_a", "org_a")).toBeNull();
  }
});

test("the role kept changes are restored as waits for the live or remembered one, never a loading viewer", () => {
  const known = { userId: "usr_1", workspaceId: "org_1", name: "Acme", role: "responder" as const };
  // Still reading what was remembered, and nothing live yet.
  expect(settledRole("usr_1", undefined, undefined)).toBeUndefined();
  // Offline with nothing remembered.
  expect(settledRole("usr_1", undefined, null)).toBeUndefined();
  expect(settledRole("usr_1", undefined, known)).toBe("responder");
  // The live role wins over the remembered one; one the app does not know is a viewer, as the shard would treat it.
  expect(settledRole("usr_1", "admin", known)).toBe("admin");
  expect(settledRole("usr_1", "owner-ish", known)).toBe("viewer");
});
