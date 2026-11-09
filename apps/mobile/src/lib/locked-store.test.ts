import { expect, test } from "vite-plus/test";
import {
  keepReadable,
  lockedReadable,
  MAX_CHUNKS,
  sessionKeys,
  type KeyStore,
} from "@/lib/locked-store";

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

test("items kept before are written again with every chunk, in each slot, and nothing past the last one", async () => {
  const { store, writes, items } = memory({
    instances: "[]",
    brigade_cookie: "c",
    "brigade_session_data.0": "s0",
    "brigade_session_data.1": "s1",
    // A chunked value in slot 1, and a chunk `@better-auth/expo` cleared (empty).
    brigade_abc_cookie: "marker",
    "brigade_abc_cookie.1.0": "a0",
    "brigade_abc_cookie.1.1": "a1",
    "brigade_abc_cookie.1.2": "",
  });
  await keepReadable(lockedReadable(store, AFTER_FIRST_UNLOCK), [
    "instances",
    ...sessionKeys("brigade"),
    ...sessionKeys("brigade:abc"),
    "missing",
  ]);
  expect(writes).toEqual(
    [
      "instances",
      "brigade_cookie",
      "brigade_session_data.0",
      "brigade_session_data.1",
      "brigade_abc_cookie",
      "brigade_abc_cookie.1.0",
      "brigade_abc_cookie.1.1",
    ].map((key) => [key, { keychainAccessible: AFTER_FIRST_UNLOCK }]),
  );
  // Each written back as it was; the cleared chunk stays empty.
  expect(Object.fromEntries(items)).toEqual({
    instances: "[]",
    brigade_cookie: "c",
    "brigade_session_data.0": "s0",
    "brigade_session_data.1": "s1",
    brigade_abc_cookie: "marker",
    "brigade_abc_cookie.1.0": "a0",
    "brigade_abc_cookie.1.1": "a1",
    "brigade_abc_cookie.1.2": "",
  });
});

test("an item the auth client changed between the two reads is not put back", async () => {
  const { store, writes } = memory({ brigade_cookie: "old" });
  let reads = 0;
  await keepReadable(
    {
      ...store,
      getItemAsync: async (key) =>
        key === "brigade_cookie" ? (++reads === 1 ? "old" : "new") : null,
    },
    ["brigade_cookie"],
  );
  expect(writes).toEqual([]);
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

test("a value split into as many chunks as @better-auth/expo allows is written again whole", async () => {
  const chunks = Object.fromEntries(
    Array.from({ length: MAX_CHUNKS }, (_, i) => [`brigade_cookie.0.${i}`, `c${i}`]),
  );
  const { store, writes } = memory({ brigade_cookie: "marker", ...chunks });
  await keepReadable(lockedReadable(store, AFTER_FIRST_UNLOCK), ["brigade_cookie"]);
  expect(writes.map(([key]) => key)).toEqual(["brigade_cookie", ...Object.keys(chunks)]);
});
