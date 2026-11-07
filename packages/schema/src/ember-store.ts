// packages/schema's `Store` over an Ember function's `ctx.db` (RFC 0016 "The workspace shard"), so every mutation's
// `apply` and every query run unchanged on an Ember shard.
//
// Layout: each Brigade table is an Ember table of the same name whose documents are `{ id, data }`: Brigade's own id
// (Ember's `_id` is its own) and the row as JSON text, with an index `by_row_id` on `id` (Ember reserves `by_id`). JSON text, as in the Durable
// Object's `store_rows`, keeps every row Brigade has written storable as is (Ember refuses field names starting with
// `$`, and `undefined` inside arrays) and needs no Ember migration when a mutation adds a field.
//
// This file imports nothing from Ember: `ctx.db` is described structurally below, so the package stays
// framework-light and an Ember upgrade cannot change what it compiles against.
//
// Transactions: an Ember mutation is already one transaction, and its `ctx.db` has no savepoints. `runMutation`
// still needs `transaction` to undo a failed `apply` without failing the whole Ember mutation, so the store keeps an
// undo log: every write inside `transaction` records the row's JSON before it, and a throw restores those rows in
// reverse order. Nested calls roll back only their own writes; an outer rollback also undoes the inner, committed
// ones. If restoring throws (Ember's write limit, say), the rows are in neither state: `runMutation` would turn that
// into an `internal` result the handler returns, and Ember would commit it. So the store is then broken: every later
// call throws, and `undoFailure()` returns the error, which the handler must rethrow so Ember rolls the whole mutation
// back (`EmberStore`).

import { StoreError, type Store, type Tables } from "./store.ts";

/** The index every Brigade table has on Ember, over Brigade's `id`. */
export const EMBER_ROW_INDEX = "by_row_id";

/** A Brigade row as an Ember document. */
export type EmberRowDoc = { _id: string; id: string; data: string };

/** The range builder Ember's `withIndex` passes, as the store uses it (only the `id` field). */
export interface EmberIdRange {
  eq(field: "id", value: string): unknown;
  gte(field: "id", value: string): { lt(field: "id", value: string): unknown };
}

/** What the store reads through: a query's (or a mutation's) `ctx.db`. */
export interface EmberRowsReader {
  query(table: string): {
    withIndex(
      index: string,
      range: (q: EmberIdRange) => unknown,
    ): {
      collect(): EmberRowDoc[];
      first(): EmberRowDoc | null;
      order(order: "desc"): { take(n: number): EmberRowDoc[] };
    };
  };
}

/** A mutation's `ctx.db`, as the store writes through it. */
export interface EmberRowsWriter extends EmberRowsReader {
  insert(table: string, value: { id: string; data: string }): string;
  patch(id: string, value: { data: string }): void;
  delete(id: string): void;
}

/** A document as the store holds it: Ember's id and the row's JSON. */
type Held = { _id: string; data: string };

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const isWriter = (db: EmberRowsReader): db is EmberRowsWriter =>
  typeof (db as Partial<EmberRowsWriter>).insert === "function";

/**
 * A `Store` over `db`. Over a query's `ctx.db` (no `insert`) it reads only, and a write throws. `tables` limits it to
 * the tables Brigade defines (a misspelt or unknown name is a programming error, as in the Durable Object's store).
 */
/**
 * A `Store` over Ember, plus `undoFailure()`: the error of a rollback that could not be replayed, after which the
 * store refuses every call. A handler that ran a mutation through it rethrows it, so Ember fails the whole mutation
 * instead of committing a half-undone one.
 */
export type EmberStore<S extends Tables> = Store<S> & {
  undoFailure(): { error: unknown } | undefined;
  /**
   * The rows whose id is at least `from` and below `to`, newest id first, at most `limit` (the Durable Object's
   * `SqlStore.rangeDescending`): read off the index, `limit` at a time, never the whole range.
   */
  rangeDescending<T extends keyof S & string>(
    table: T,
    from: string,
    to: string,
    limit: number,
  ): S[T][];
};

export function createEmberStore<S extends Tables>(
  db: EmberRowsReader | EmberRowsWriter,
  tables?: ReadonlySet<string>,
): EmberStore<S> {
  // Rows written inside `transaction`, with their JSON before the write (undefined: absent).
  const undo: { table: string; id: string; before: string | undefined }[] = [];
  let depth = 0;
  // What this call has read and written, per table: a row's document (null: known absent), and whether the whole
  // table is held. Brigade's mutations scan tables and look rows up again and again; Ember counts every row read
  // against its per-transaction limit (16,384), so a scanned table, a row or an id range is read from Ember once per call (a range that only partly
  // overlaps one already read is read again).
  const cache = new Map<
    string,
    { rows: Map<string, Held | null>; complete: boolean; ranges: [string, string][] }
  >();

  const checked = (table: string): string => {
    if (tables && !tables.has(table)) throw new Error(`Unknown table ${table}`);
    return table;
  };
  const held = (table: string) => {
    let entry = cache.get(table);
    if (!entry) cache.set(table, (entry = { rows: new Map(), complete: false, ranges: [] }));
    return entry;
  };
  const lookup = (table: string, id: string): Held | null => {
    const entry = held(table);
    const known = entry.rows.get(id);
    if (known !== undefined) return known;
    if (entry.complete) return null;
    const doc = db
      .query(table)
      .withIndex(EMBER_ROW_INDEX, (q) => q.eq("id", id))
      .first();
    const value = doc ? { _id: doc._id, data: doc.data } : null;
    entry.rows.set(id, value);
    return value;
  };
  const writer = (): EmberRowsWriter => {
    if (!isWriter(db)) throw new Error("This store is read-only (a query's ctx.db)");
    return db;
  };
  const write = (table: string, id: string, data: string | undefined) => {
    const w = writer();
    const doc = lookup(table, id);
    const rows = held(table).rows;
    if (data === undefined) {
      if (doc) w.delete(doc._id);
      rows.set(id, null);
    } else if (doc) {
      w.patch(doc._id, { data });
      rows.set(id, { _id: doc._id, data });
    } else {
      rows.set(id, { _id: w.insert(table, { id, data }), data });
    }
  };
  const change = (
    table: string,
    id: string,
    before: string | undefined,
    data: string | undefined,
  ) => {
    if (depth > 0) undo.push({ table, id, before });
    write(table, id, data);
  };
  const rowsOf = <T>(docs: Iterable<Held | null>) =>
    [...docs]
      .filter((doc): doc is Held => doc !== null)
      .map((doc) => JSON.parse(doc.data) as T & { id: string })
      // Ember orders its index by encoded bytes, JavaScript (and the other stores) by UTF-16 code units: they agree
      // on every id in use (ASCII), and sorting here keeps the stores identical for any other id too.
      .sort(byId);
  const fill = (table: string, docs: EmberRowDoc[]) => {
    const rows = held(table).rows;
    for (const doc of docs)
      if (!rows.has(doc.id)) rows.set(doc.id, { _id: doc._id, data: doc.data });
  };

  let broken: { error: unknown } | undefined;
  const live = () => {
    if (broken)
      throw new Error("A rollback in this store failed; the Ember mutation must fail", {
        cause: broken.error,
      });
  };

  const store: EmberStore<S> = {
    undoFailure: () => broken,
    get(table, id) {
      live();
      const doc = lookup(checked(table), id);
      return doc ? (JSON.parse(doc.data) as S[typeof table]) : undefined;
    },
    insert(table, row) {
      live();
      writer();
      if (lookup(checked(table), row.id))
        throw new StoreError(`Duplicate id ${row.id} in ${table}`);
      const data = JSON.stringify(row);
      change(table, row.id, undefined, data);
      return JSON.parse(data) as S[typeof table];
    },
    update(table, id, patch) {
      live();
      writer();
      const doc = lookup(checked(table), id);
      if (!doc) throw new StoreError(`No row ${id} in ${table}`);
      // JSON drops keys set to undefined (they keep their value); null clears. The id never changes.
      const data = JSON.stringify({
        ...JSON.parse(doc.data),
        ...JSON.parse(JSON.stringify(patch)),
        id,
      });
      change(table, id, doc.data, data);
      return JSON.parse(data) as S[typeof table];
    },
    delete(table, id) {
      live();
      writer();
      const doc = lookup(checked(table), id);
      if (!doc) return false;
      change(table, id, doc.data, undefined);
      return true;
    },
    scan(table) {
      live();
      const entry = held(checked(table));
      if (!entry.complete) {
        fill(
          table,
          db
            .query(table)
            .withIndex(EMBER_ROW_INDEX, (q) => q)
            .collect(),
        );
        entry.complete = true;
      }
      return rowsOf<S[typeof table]>(entry.rows.values());
    },
    range(table, from, to) {
      live();
      const entry = held(checked(table));
      // A range is read through the index, not the whole table (`range` exists so a large table such as `timeline`
      // is never scanned), and each range at most once: one already read, or inside one, comes from what is held.
      // Bounds compare as Ember's index does (encoded bytes), which agrees with code units on every id in use (ASCII),
      // as SQLite's byte order does for the Durable Object's store.
      const covered = entry.complete || entry.ranges.some(([lo, hi]) => lo <= from && to <= hi);
      if (!covered) {
        fill(
          table,
          db
            .query(table)
            .withIndex(EMBER_ROW_INDEX, (q) => q.gte("id", from).lt("id", to))
            .collect(),
        );
        entry.ranges.push([from, to]);
      }
      // Rows held from earlier reads and writes are the current ones; those outside the range are left out here.
      const inRange = [...entry.rows].filter(([id]) => id >= from && id < to).map(([, doc]) => doc);
      return rowsOf<S[typeof table]>(inRange);
    },
    rangeDescending(table, from, to, limit) {
      live();
      // As SQL's `limit 0`: nothing, and nothing read.
      if (!(limit > 0)) return [];
      const entry = held(checked(table));
      const covered = entry.complete || entry.ranges.some(([lo, hi]) => lo <= from && to <= hi);
      // Rows held in `[lo, to)`, newest first: what this call read and wrote there.
      const newest = (lo: string) =>
        rowsOf<S[typeof table]>(
          [...entry.rows].filter(([id]) => id >= lo && id < to).map(([, doc]) => doc),
        )
          .reverse()
          .slice(0, limit);
      if (covered) return newest(from);
      // `limit` at a time off the index, each batch below the last: a row this call deleted is skipped without ever
      // reading the rest of the range. `lo` is how far down the index was read; held rows below it are left out, since
      // rows the index holds between them and `lo` were not read.
      let below = to;
      for (;;) {
        const docs = db
          .query(table)
          .withIndex(EMBER_ROW_INDEX, (q) => q.gte("id", from).lt("id", below))
          .order("desc")
          .take(limit);
        fill(table, docs);
        if (docs.length < limit) return newest(from);
        below = docs[docs.length - 1]!.id;
        const out = newest(below);
        if (out.length === limit) return out;
      }
    },
    transaction(fn) {
      live();
      const mark = undo.length;
      depth++;
      try {
        return fn();
      } catch (error) {
        try {
          for (let i = undo.length - 1; i >= mark; i--) {
            const entry = undo[i]!;
            write(entry.table, entry.id, entry.before);
          }
        } catch (failure) {
          broken ??= { error: failure };
          throw failure;
        }
        undo.length = mark;
        throw error;
      } finally {
        depth--;
        // The outermost call finished: nothing can roll these writes back any more.
        if (depth === 0) undo.length = 0;
      }
    },
  };
  return store;
}
