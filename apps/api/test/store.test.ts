// The SQLite store against packages/schema's `Store` contract, and its nested transactions.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { StoreError, type IncidentRow } from "@freecorps/brigade-schema";
import { SqlStore } from "../src/store.ts";

let names = 0;
/** Runs `fn` with a store over a fresh Durable Object's storage. */
const withStore = <R>(fn: (store: SqlStore, storage: DurableObjectStorage) => R) =>
  runInDurableObject(env.WORKSPACE.getByName(`store-${++names}`), (_instance, state) =>
    fn(new SqlStore(state.storage), state.storage),
  );

const incident = (id: string, title = "Checkout down"): IncidentRow => ({
  id,
  number: null,
  title,
  severity: "sev2",
  status: "triage",
  declaredAt: 1,
  declaredBy: "usr_ana",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: 1,
});

describe("SqlStore", () => {
  test("insert, get, update, delete and scan behave like the memory store", async () => {
    await withStore((store) => {
      expect(store.insert("incidents", incident("inc_b"))).toEqual(incident("inc_b"));
      store.insert("incidents", incident("inc_a"));
      expect(() => store.insert("incidents", incident("inc_a"))).toThrow(StoreError);

      // Undefined keeps the value, null clears it, and the id never changes.
      const patch = { title: undefined, number: null, severity: "sev1", id: "inc_z" } as never;
      expect(store.update("incidents", "inc_a", patch)).toEqual({
        ...incident("inc_a"),
        severity: "sev1",
      });
      expect(() => store.update("incidents", "inc_nope", { title: "x" })).toThrow(StoreError);

      expect(store.scan("incidents").map((row) => row.id)).toEqual(["inc_a", "inc_b"]);
      expect(store.delete("incidents", "inc_b")).toBe(true);
      expect(store.delete("incidents", "inc_b")).toBe(false);
      expect(store.get("incidents", "inc_b")).toBeUndefined();
      expect(store.get("incidents", "inc_a")?.severity).toBe("sev1");
    });
  });

  test("range reads one id range off the primary key, like the memory store", async () => {
    await withStore((store, storage) => {
      for (const id of ["inc_a;", "inc_a:2", "inc_a", "inc_a:10", "inc_b:1", "inc_a:1"]) {
        store.insert("incidents", incident(id));
      }
      expect(store.range("incidents", "inc_a:", "inc_a;").map((row) => row.id)).toEqual([
        "inc_a:1",
        "inc_a:10",
        "inc_a:2",
      ]);
      expect(() => store.range("nope" as "incidents", "a", "b")).toThrow(StoreError);
      // SQLite answers it from the (tbl, id) key: a search, not a scan of every row.
      const plan = storage.sql
        .exec<{ detail: string }>(
          "explain query plan select data from store_rows where tbl = ? and id >= ? and id < ? order by id",
          "incidents",
          "inc_a:",
          "inc_a;",
        )
        .toArray()
        .map((row) => row.detail)
        .join(" ");
      expect(plan).toMatch(/SEARCH store_rows USING PRIMARY KEY \(tbl=\? AND id>\? AND id<\?\)/);
    });
  });

  test("never shares objects with callers", async () => {
    await withStore((store) => {
      const row = incident("inc_a");
      store.insert("incidents", row);
      row.title = "changed";
      store.get("incidents", "inc_a")!.title = "changed too";
      expect(store.get("incidents", "inc_a")?.title).toBe("Checkout down");
    });
  });

  test("refuses tables outside TABLES", async () => {
    await withStore((store) => {
      expect(() => store.get("nope" as "incidents", "x")).toThrow(StoreError);
      expect(() => store.scan("__proto__" as "incidents")).toThrow(StoreError);
    });
  });

  test("an inner transaction's rollback undoes only its own writes", async () => {
    await withStore((store) => {
      store.transaction(() => {
        store.insert("incidents", incident("inc_outer"));
        expect(() =>
          store.transaction(() => {
            store.insert("incidents", incident("inc_inner"));
            store.update("incidents", "inc_outer", { title: "inner" });
            throw new Error("inner");
          }),
        ).toThrow("inner");
        store.transaction(() => store.insert("incidents", incident("inc_kept")));
      });
      expect(store.scan("incidents").map((row) => [row.id, row.title])).toEqual([
        ["inc_kept", "Checkout down"],
        ["inc_outer", "Checkout down"],
      ]);
    });
  });

  test("an outer rollback also undoes inner, committed transactions", async () => {
    await withStore((store) => {
      expect(() =>
        store.transaction(() => {
          store.insert("incidents", incident("inc_outer"));
          store.transaction(() => store.insert("incidents", incident("inc_inner")));
          throw new Error("outer");
        }),
      ).toThrow("outer");
      expect(store.scan("incidents")).toEqual([]);
    });
  });

  test("tracks changed rows with their value before and after", async () => {
    await withStore((store) => {
      store.insert("incidents", incident("inc_a"));
      store.insert("incidents", incident("inc_b"));
      store.track();
      store.transaction(() => {
        store.insert("incidents", incident("inc_c"));
        store.update("incidents", "inc_a", { title: "Renamed" });
        store.delete("incidents", "inc_b");
        // Written and rolled back: not a change.
        try {
          store.transaction(() => {
            store.insert("incidents", incident("inc_d"));
            throw new Error("undo");
          });
        } catch {
          // expected
        }
        const changes = store.changes();
        expect(changes).toEqual([
          { table: "incidents", id: "inc_c", before: undefined, after: incident("inc_c") },
          {
            table: "incidents",
            id: "inc_a",
            before: incident("inc_a"),
            after: incident("inc_a", "Renamed"),
          },
          { table: "incidents", id: "inc_b", before: incident("inc_b"), after: undefined },
        ]);
      });
      store.untrack();
      store.insert("incidents", incident("inc_e"));
      expect(store.changes()).toEqual([]);
    });
  });
});
