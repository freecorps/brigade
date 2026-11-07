import {
  createEngine,
  defineSchema,
  defineTable,
  mutationGeneric,
  queryGeneric,
  v,
  type MutationCtx,
  type QueryCtx,
} from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { describe, expect, test } from "vite-plus/test";
import { createEmberStore, EMBER_ROW_INDEX, StoreError, type Store } from "../src/index.ts";

type Note = { id: string; text: string; tags: string[]; note?: string | null };
type Tables = { notes: Note; other: { id: string; n: number } };

const row = () => defineTable({ id: v.string(), data: v.string() }).index(EMBER_ROW_INDEX, ["id"]);
const schema = defineSchema({ tables: { notes: row(), other: row() } });

/** A fresh shard: `tx` runs `fn` as one Ember mutation over the store, `read` as one query. */
function shard(limits?: { rowsRead?: number }) {
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    ...(limits ? { limits } : {}),
  });
  engine.migrate();
  const names = new Set(["notes", "other"]);
  const tx = <R>(fn: (store: Store<Tables>) => R): R => {
    const box: { value?: R } = {};
    engine.runMutation(
      mutationGeneric({
        handler: (ctx: MutationCtx) => {
          box.value = fn(createEmberStore<Tables>(ctx.db as never, names));
          return null;
        },
      } as never) as never,
      {},
    );
    return box.value as R;
  };
  const read = <R>(fn: (store: Store<Tables>) => R): R => {
    const box: { value?: R } = {};
    engine.runQuery(
      queryGeneric({
        handler: (ctx: QueryCtx) => {
          box.value = fn(createEmberStore<Tables>(ctx.db as never, names));
          return null;
        },
      } as never) as never,
      {},
    );
    return box.value as R;
  };
  return { tx, read };
}

const note = (id: string, text = id): Note => ({ id, text, tags: [] });

describe("createEmberStore", () => {
  test("get, insert, update, delete, scan and range, as the memory store", () => {
    const { tx, read } = shard();
    tx((store) => {
      expect(store.get("notes", "b")).toBeUndefined();
      store.insert("notes", note("b", "two"));
      store.insert("notes", { id: "a", text: "one", tags: ["x"] });
      store.insert("notes", note("c"));
      expect(store.update("notes", "b", { text: "TWO" })).toEqual({
        id: "b",
        text: "TWO",
        tags: [],
      });
      expect(store.delete("notes", "c")).toBe(true);
      expect(store.delete("notes", "c")).toBe(false);
    });
    expect(read((store) => store.scan("notes").map((r) => r.id))).toEqual(["a", "b"]);
    expect(read((store) => store.range("notes", "a", "b").map((r) => r.id))).toEqual(["a"]);
    expect(read((store) => store.get("notes", "b"))).toEqual({ id: "b", text: "TWO", tags: [] });
  });

  test("duplicate inserts and missing updates throw StoreError", () => {
    const { tx } = shard();
    tx((store) => store.insert("notes", note("a")));
    tx((store) => {
      expect(() => store.insert("notes", note("a"))).toThrow(StoreError);
      expect(() => store.update("notes", "z", { text: "" })).toThrow(StoreError);
    });
  });

  test("update ignores keys set to undefined, clears keys set to null and never changes the id", () => {
    const { tx } = shard();
    tx((store) => store.insert("notes", { ...note("a", "one"), note: "n" }));
    const updated = tx((store) =>
      store.update("notes", "a", { text: undefined, note: null, id: "b" } as Partial<Note>),
    );
    expect(updated).toEqual({ id: "a", text: "one", tags: [], note: null });
  });

  test("rows never alias the caller's objects", () => {
    const { tx, read } = shard();
    const value = { id: "a", text: "one", tags: ["x"] };
    tx((store) => {
      store.insert("notes", value);
      value.tags.push("y");
      store.get("notes", "a")!.tags.push("z");
      store.scan("notes")[0]!.text = "changed";
    });
    expect(read((store) => store.get("notes", "a"))).toEqual({ id: "a", text: "one", tags: ["x"] });
  });

  test("scan and range see the writes made earlier in the same call", () => {
    const { tx } = shard();
    tx((store) => ["a", "c", "e"].forEach((id) => store.insert("notes", note(id))));
    tx((store) => {
      expect(store.range("notes", "b", "f").map((r) => r.id)).toEqual(["c", "e"]);
      store.insert("notes", note("d"));
      store.delete("notes", "e");
      expect(store.range("notes", "b", "f").map((r) => r.id)).toEqual(["c", "d"]);
      store.update("notes", "a", { text: "A" });
      expect(store.scan("notes").map((r) => [r.id, r.text])).toEqual([
        ["a", "A"],
        ["c", "c"],
        ["d", "d"],
      ]);
      store.insert("notes", note("b"));
      expect(store.scan("notes").map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    });
  });

  test("a failed transaction undoes its writes and the call goes on", () => {
    const { tx, read } = shard();
    tx((store) => {
      store.insert("notes", note("keep"));
      store.insert("notes", note("edit", "before"));
      store.insert("notes", note("drop"));
    });
    tx((store) => {
      expect(() =>
        store.transaction(() => {
          store.insert("notes", note("new"));
          store.update("notes", "edit", { text: "after" });
          store.update("notes", "edit", { text: "again" });
          store.delete("notes", "drop");
          store.insert("other", { id: "x", n: 1 });
          throw new Error("boom");
        }),
      ).toThrow("boom");
      expect(store.scan("notes").map((r) => [r.id, r.text])).toEqual([
        ["drop", "drop"],
        ["edit", "before"],
        ["keep", "keep"],
      ]);
      expect(store.scan("other")).toEqual([]);
      store.insert("notes", note("after"));
    });
    expect(read((store) => store.scan("notes").map((r) => [r.id, r.text]))).toEqual([
      ["after", "after"],
      ["drop", "drop"],
      ["edit", "before"],
      ["keep", "keep"],
    ]);
    expect(read((store) => store.scan("other"))).toEqual([]);
  });

  test("a nested rollback undoes only its own writes; an outer one undoes the inner, committed ones too", () => {
    const { tx, read } = shard();
    tx((store) => {
      store.transaction(() => {
        store.insert("notes", note("outer"));
        expect(() =>
          store.transaction(() => {
            store.insert("notes", note("inner"));
            throw new Error("inner");
          }),
        ).toThrow("inner");
      });
      expect(() =>
        store.transaction(() => {
          store.update("notes", "outer", { text: "changed" });
          store.transaction(() => store.insert("notes", note("committed")));
          throw new Error("outer");
        }),
      ).toThrow("outer");
    });
    expect(read((store) => store.scan("notes"))).toEqual([note("outer")]);
  });

  test("over a query's ctx.db it reads and refuses writes", () => {
    const { tx, read } = shard();
    tx((store) => store.insert("notes", note("a")));
    read((store) => {
      expect(store.get("notes", "a")).toEqual(note("a"));
      expect(() => store.insert("notes", note("b"))).toThrow(/read-only/);
      expect(() => store.update("notes", "a", { text: "x" })).toThrow(/read-only/);
      expect(() => store.delete("notes", "a")).toThrow(/read-only/);
    });
  });

  test("an unknown table is a programming error, not a missing row", () => {
    const { read } = shard();
    read((store) => {
      expect(() => store.get("nope" as "notes", "a")).toThrow(/Unknown table nope/);
      expect(() => store.scan("nope" as "notes")).toThrow(/Unknown table nope/);
    });
  });

  test("each table is read from Ember once per call, so repeated scans stay under Ember's read limit", () => {
    // 50 rows, a 200-row read limit: 100 scans and 100 lookups would read 10,050 rows without the store's cache.
    const { tx } = shard({ rowsRead: 200 });
    tx((store) => {
      for (let i = 0; i < 50; i++) store.insert("notes", note(`n${String(i).padStart(2, "0")}`));
    });
    const seen = tx((store) => {
      let rows = 0;
      for (let i = 0; i < 100; i++) {
        rows += store.scan("notes").length;
        store.get("notes", `n${String(i % 60).padStart(2, "0")}`);
        store.range("notes", "n10", "n20");
      }
      return rows;
    });
    expect(seen).toBe(5000);
  });
});
