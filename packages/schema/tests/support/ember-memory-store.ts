// A `MemoryStore` whose rows live on a real Ember shard engine (node:sqlite), through `createEmberStore`. The Ember
// test run (vite.ember.config.ts) puts it in place of `createMemoryStore`, so every mutation and query test in this
// package runs its `apply` over Ember's `ctx.db` too (RFC 0016 "The workspace shard").
//
// Each store call outside a transaction is one Ember mutation; `transaction(fn)` runs `fn` inside one, and calls
// made inside it use that mutation's `ctx.db`. A throw rolls back the store's undo log and the Ember mutation both.

import {
  createEngine,
  defineSchema,
  defineTable,
  mutationGeneric,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { createEmberStore, EMBER_ROW_INDEX } from "../../src/ember-store.ts";
import type { MemoryStore, Row, Store, Tables } from "../../src/store.ts";
import { TABLES } from "../../src/tables.ts";

const NAMES = Object.keys(TABLES).sort();
const row = () => defineTable({ id: v.string(), data: v.string() }).index(EMBER_ROW_INDEX, ["id"]);
const schema = defineSchema({ tables: Object.fromEntries(NAMES.map((name) => [name, row()])) });

export function createEmberMemoryStore<S extends Tables>(
  seed: { [T in keyof S]?: S[T][] } = {},
): MemoryStore<S> {
  const engine = createEngine({ schema, driver: createNodeSqliteDriver() });
  engine.migrate();
  let current: Store<S> | null = null;

  const within = <R>(fn: (store: Store<S>) => R): R => {
    if (current) return fn(current);
    const box: { value?: R; error?: { error: unknown } } = {};
    const handler = (ctx: MutationCtx) => {
      const store = createEmberStore<S>(ctx.db as never, new Set(NAMES));
      current = store;
      try {
        box.value = fn(store);
        // As a Brigade handler does: a rollback that could not be replayed fails the whole Ember mutation.
        const failure = store.undoFailure();
        if (failure) throw failure.error;
      } catch (error) {
        box.error = { error };
        throw error; // Ember rolls the mutation back
      } finally {
        current = null;
      }
      return null;
    };
    try {
      engine.runMutation(mutationGeneric({ handler } as never) as never, {});
    } catch (error) {
      throw box.error ? box.error.error : error;
    }
    if (box.error) throw box.error.error;
    return box.value as R;
  };

  const store: MemoryStore<S> = {
    get: (table, id) => within((s) => s.get(table, id)),
    insert: (table, value) => within((s) => s.insert(table, value)),
    update: (table, id, patch) => within((s) => s.update(table, id, patch)),
    delete: (table, id) => within((s) => s.delete(table, id)),
    scan: (table) => within((s) => s.scan(table)),
    range: (table, from, to) => within((s) => s.range(table, from, to)),
    transaction: (fn) => within((s) => s.transaction(fn)),
    dump() {
      return within((s) => {
        const out: { [name: string]: Row[] } = {};
        for (const name of NAMES) {
          const rows = s.scan(name);
          if (rows.length) out[name] = rows;
        }
        return out as { [T in keyof S]?: S[T][] };
      });
    },
  };

  for (const name of Object.keys(seed)) {
    for (const value of seed[name] ?? []) store.insert(name, value);
  }
  return store;
}
