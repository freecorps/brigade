import { expect, test } from "vite-plus/test";
import { createMemoryStore, StoreError } from "../src/index.ts";

type Tables = { notes: { id: string; text: string; tags: string[] } };

test("get, insert, update, delete and scan", () => {
  const store = createMemoryStore<Tables>();
  expect(store.get("notes", "b")).toBeUndefined();
  store.insert("notes", { id: "b", text: "two", tags: [] });
  store.insert("notes", { id: "a", text: "one", tags: ["x"] });
  expect(store.update("notes", "b", { text: "TWO" })).toEqual({ id: "b", text: "TWO", tags: [] });
  expect(store.scan("notes").map((row) => row.id)).toEqual(["a", "b"]);
  expect(store.delete("notes", "a")).toBe(true);
  expect(store.delete("notes", "a")).toBe(false);
  expect(store.dump()).toEqual({ notes: [{ id: "b", text: "TWO", tags: [] }] });
});

test("duplicate inserts and missing updates throw StoreError", () => {
  const store = createMemoryStore<Tables>({ notes: [{ id: "a", text: "", tags: [] }] });
  expect(() => store.insert("notes", { id: "a", text: "", tags: [] })).toThrow(StoreError);
  expect(() => store.update("notes", "z", { text: "" })).toThrow(StoreError);
});

test("rows never alias the caller's objects", () => {
  const row = { id: "a", text: "one", tags: ["x"] };
  const store = createMemoryStore<Tables>({ notes: [row] });
  row.tags.push("y");
  const read = store.get("notes", "a")!;
  read.tags.push("z");
  store.scan("notes")[0]!.text = "changed";
  expect(store.get("notes", "a")).toEqual({ id: "a", text: "one", tags: ["x"] });
});

test("update ignores keys set to undefined and clears keys set to null", () => {
  type Nullable = { items: { id: string; text: string; note: string | null } };
  const store = createMemoryStore<Nullable>({ items: [{ id: "a", text: "one", note: "n" }] });
  expect(store.update("items", "a", { text: undefined, note: null })).toEqual({
    id: "a",
    text: "one",
    note: null,
  });
  expect(store.get("items", "a")).toEqual({ id: "a", text: "one", note: null });
});

test("update cannot change a row's id", () => {
  const store = createMemoryStore<Tables>({ notes: [{ id: "a", text: "", tags: [] }] });
  store.update("notes", "a", { id: "b" } as never);
  expect(store.scan("notes").map((row) => row.id)).toEqual(["a"]);
});

test("a transaction that throws undoes every write, including nested ones", () => {
  const store = createMemoryStore<Tables>({ notes: [{ id: "a", text: "one", tags: [] }] });
  const before = store.dump();
  expect(() =>
    store.transaction(() => {
      store.update("notes", "a", { text: "changed" });
      store.transaction(() => store.insert("notes", { id: "b", text: "", tags: [] }));
      store.delete("notes", "a");
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(store.dump()).toEqual(before);

  // An inner rollback keeps the outer transaction's earlier writes.
  store.transaction(() => {
    store.insert("notes", { id: "c", text: "", tags: [] });
    expect(() =>
      store.transaction(() => {
        store.insert("notes", { id: "d", text: "", tags: [] });
        throw new Error("inner");
      }),
    ).toThrow("inner");
  });
  expect(store.scan("notes").map((row) => row.id)).toEqual(["a", "c"]);
});
