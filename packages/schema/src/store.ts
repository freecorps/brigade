// The row store mutations and queries run against (RFC 0004 "Shared core"). The server implements it over the
// Durable Object's SQLite; clients use `createMemoryStore`. Rows are plain JSON objects keyed by `id`.

export type Row = { id: string };
/** Table name → row type. */
export type Tables = { [table: string]: Row };

export interface Store<S extends Tables> {
  get<T extends keyof S & string>(table: T, id: string): S[T] | undefined;
  /** Throws `StoreError` if a row with the same id exists. */
  insert<T extends keyof S & string>(table: T, row: S[T]): S[T];
  /**
   * Merges `patch` into the row and returns it. Keys set to `undefined` are ignored (the column keeps its
   * value); `null` clears a column. The id never changes. Throws `StoreError` if the row does not exist.
   */
  update<T extends keyof S & string>(table: T, id: string, patch: Partial<Omit<S[T], "id">>): S[T];
  /** Returns whether a row was deleted. */
  delete<T extends keyof S & string>(table: T, id: string): boolean;
  /** Every row of the table, ordered by id. */
  scan<T extends keyof S & string>(table: T): S[T][];
  /** The rows whose id is at least `from` and below `to` (code unit order), ordered by id. */
  range<T extends keyof S & string>(table: T, from: string, to: string): S[T][];
  /**
   * Runs `fn` atomically: if it throws, every write made inside it is undone and the error is rethrown.
   * Must be re-entrant: a nested call rolls back only its own writes (SQLite: savepoints), and an outer
   * rollback also undoes the inner, committed ones.
   */
  transaction<R>(fn: () => R): R;
}

export class StoreError extends Error {
  override name = "StoreError";
}

// Rows are JSON, so a JSON round trip is a full copy; the store never shares objects with its callers.
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export type MemoryStore<S extends Tables> = Store<S> & {
  /** Every table and its rows ordered by id; for tests, snapshots and persistence. */
  dump(): { [T in keyof S]?: S[T][] };
};

/**
 * An in-memory `Store` for clients and tests. `transaction` copies the table maps (not the rows), so it costs
 * O(rows) per call: fine for an incident index, not for large tables.
 */
export function createMemoryStore<S extends Tables>(
  seed: { [T in keyof S]?: S[T][] } = {},
): MemoryStore<S> {
  let tables = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    let rows = tables.get(name);
    if (!rows) tables.set(name, (rows = new Map()));
    return rows;
  };
  const sorted = (rows: Map<string, Row>) =>
    [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const store: MemoryStore<S> = {
    get(name, id) {
      const row = table(name).get(id);
      return row && (copy(row) as S[typeof name]);
    },
    insert(name, row) {
      const rows = table(name);
      if (rows.has(row.id)) throw new StoreError(`Duplicate id ${row.id} in ${name}`);
      rows.set(row.id, copy(row));
      return copy(row);
    },
    update(name, id, patch) {
      const rows = table(name);
      const row = rows.get(id);
      if (!row) throw new StoreError(`No row ${id} in ${name}`);
      const changes = Object.entries(patch).filter(([, value]) => value !== undefined);
      const next = { ...row, ...copy(Object.fromEntries(changes)), id };
      rows.set(id, next);
      return copy(next) as S[typeof name];
    },
    delete(name, id) {
      return table(name).delete(id);
    },
    scan(name) {
      return sorted(table(name)).map((row) => copy(row) as S[typeof name]);
    },
    range(name, from, to) {
      return sorted(table(name))
        .filter((row) => row.id >= from && row.id < to)
        .map((row) => copy(row) as S[typeof name]);
    },
    transaction(fn) {
      const before = new Map([...tables].map(([name, rows]) => [name, new Map(rows)]));
      try {
        return fn();
      } catch (error) {
        // Rows are replaced on write, never changed in place, so restoring the maps restores the data.
        tables = before;
        throw error;
      }
    },
    dump() {
      const out: { [name: string]: Row[] } = {};
      for (const name of [...tables.keys()].sort()) {
        const rows = tables.get(name);
        if (rows?.size) out[name] = sorted(rows).map(copy);
      }
      return out as { [T in keyof S]?: S[T][] };
    },
  };

  for (const name of Object.keys(seed)) {
    for (const row of seed[name] ?? []) store.insert(name, row);
  }
  return store;
}
