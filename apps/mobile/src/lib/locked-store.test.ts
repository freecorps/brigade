import { expect, test } from "vite-plus/test";
import { keepReadable, lockedReadable, sessionKeys, type KeyStore } from "@/lib/locked-store";

/** A key store that records the options each write used. */
function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const writes: Array<[string, object | undefined]> = [];
  const store: KeyStore = {
    getItem: (key) => items.get(key) ?? null,
    getItemAsync: async (key) => items.get(key) ?? null,
    setItem: (key, value, options) => {
      items.set(key, value);
      writes.push([key, options]);
    },
    setItemAsync: async (key, value, options) => {
      items.set(key, value);
      writes.push([key, options]);
    },
  };
  return { items, writes, store };
}

const AFTER_FIRST_UNLOCK = 0;

test("every write is readable after the first unlock; what a caller asks for wins", async () => {
  const { store, writes } = memory();
  const locked = lockedReadable(store, AFTER_FIRST_UNLOCK);
  await locked.setItemAsync("a", "1");
  locked.setItem("b", "2", { keychainService: "x" });
  expect(writes).toEqual([
    ["a", { keychainAccessible: AFTER_FIRST_UNLOCK }],
    ["b", { keychainAccessible: AFTER_FIRST_UNLOCK, keychainService: "x" }],
  ]);
  expect(await locked.getItemAsync("a")).toBe("1");
});

test("the session keys as @better-auth/expo names them", () => {
  expect(sessionKeys("brigade")).toEqual(["brigade_cookie", "brigade_session_data"]);
  expect(sessionKeys("brigade:abc")).toEqual(["brigade_abc_cookie", "brigade_abc_session_data"]);
});

test("items kept before are written again with every chunk, and nothing past the last one", async () => {
  const { store, writes, items } = memory({
    instances: "[]",
    brigade_cookie: "c",
    "brigade_session_data.0": "s0",
    "brigade_session_data.1": "s1",
  });
  await keepReadable(lockedReadable(store, AFTER_FIRST_UNLOCK), [
    "instances",
    ...sessionKeys("brigade"),
    "missing",
  ]);
  expect(writes.map(([key]) => key)).toEqual([
    "instances",
    "brigade_cookie",
    "brigade_session_data.0",
    "brigade_session_data.1",
  ]);
  expect(Object.fromEntries(items)).toMatchObject({ brigade_cookie: "c" });
});

test("an item that cannot be read (a locked phone) is left for the next launch", async () => {
  const { store, writes } = memory({ a: "1" });
  await keepReadable(
    {
      ...store,
      getItemAsync: async () => {
        throw new Error("User interaction is not allowed");
      },
    },
    ["a"],
  );
  expect(writes).toEqual([]);
});
