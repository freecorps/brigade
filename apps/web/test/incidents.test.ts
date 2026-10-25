import { setLocale } from "@freecorps/brigade-i18n";
import { afterEach, expect, test } from "vite-plus/test";
import { mutationErrorReason, nextFailed, nextStatuses, syncView } from "../src/lib/incidents";
import { CLIENT_ID_STORAGE_KEY, syncUrl, tabClientId } from "../src/lib/sync";
import { memoryStorage, throwingStorage } from "./storage";

afterEach(() => setLocale("en"));

test("only the moves the lifecycle allows are offered", () => {
  expect(nextStatuses("triage")).toEqual([
    "investigating",
    "fixing",
    "monitoring",
    "resolved",
    "declined",
  ]);
  expect(nextStatuses("resolved")).toEqual(["investigating"]);
  expect(nextStatuses("declined")).toEqual([]);
});

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

test("after the list loaded, a dropped socket is reconnecting, not unavailable", () => {
  expect(syncView("ready", "waiting", false)).toBe("reconnecting");
  expect(syncView("ready", "connecting", false)).toBe("reconnecting");
  expect(syncView("error", "open", false)).toBe("unavailable");
});

test("refused mutations get a translated reason, never the server's message", async () => {
  expect(mutationErrorReason("invalid_transition")).toMatch(/no longer allowed/);
  expect(mutationErrorReason("something_new")).toBe(mutationErrorReason("internal"));
  await setLocale("pt-BR");
  expect(mutationErrorReason("forbidden")).toBe("Você não tem permissão para fazer isso.");
});

test("the socket URL follows the page's origin and scheme", () => {
  expect(syncUrl({ protocol: "http:", host: "localhost:5173" }, "demo")).toBe(
    "ws://localhost:5173/api/sync/demo",
  );
  expect(syncUrl({ protocol: "https:", host: "brigade.example" }, "demo")).toBe(
    "wss://brigade.example/api/sync/demo",
  );
});

test("the client id is kept per tab and replaced when invalid or unreadable", () => {
  const storage = memoryStorage();
  let made = 0;
  const create = () => `cli_${++made}`;
  expect(tabClientId(storage, create)).toBe("cli_1");
  expect(tabClientId(storage, create)).toBe("cli_1");
  storage.setItem(CLIENT_ID_STORAGE_KEY, "not valid!");
  expect(tabClientId(storage, create)).toBe("cli_2");
  expect(tabClientId(throwingStorage, create)).toBe("cli_3");
  expect(tabClientId(undefined, create)).toBe("cli_4");
});
