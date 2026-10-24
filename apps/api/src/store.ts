// packages/schema's `Store` over the Durable Object's SQLite (RFC 0004 "Shared core").
//
// Layout: one `store_rows` table for every logical table, each row a JSON document keyed by (table, id), plus the
// shard version that last changed it. Mutations and queries are plain functions over JSON rows (`filter` and
// `sort` run in JavaScript), and rows travel as JSON, so real columns would buy nothing yet and would need a
// migration for every column a mutation adds. If a table outgrows a scan, it gets real columns and indexes then.
//
// Transactions: `sql.exec` refuses `SAVEPOINT`, but `transactionSync` nests, and the runtime implements the
// nested call with a savepoint: an inner rollback undoes only its writes, an outer one undoes everything
// (test/store.test.ts checks both). So `transaction` is just `transactionSync`.
//
// Storage failures: every SQLite error surfaces as a `StorageFailure`, so the shard can tell a failing disk from a
// bug in a mutation's own code. Both reach `runMutation` as an exception, but only the bug is the mutation's
// answer (a stored `internal`); a storage failure is rethrown and the client replays the mutation.

import {
  StoreError,
  TABLES,
  type BrigadeTables,
  type Row,
  type Store,
  type TableName,
} from "@freecorps/brigade-schema";

export const STORE_SCHEMA = `
  create table if not exists store_rows (
    tbl text not null,
    id text not null,
    version integer not null default 0,
    data text not null,
    primary key (tbl, id)
  ) without rowid;
`;

/** A row a tracked mutation wrote: its value before the mutation and after it (undefined = absent). */
export type RowChange = {
  table: TableName;
  id: string;
  before: Row | undefined;
  after: Row | undefined;
};

const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** SQLite failed under the store: not something the mutation did wrong. The original error is the `cause`. */
export class StorageFailure extends Error {
  override name = "StorageFailure";
  constructor(cause: unknown) {
    super(`Storage failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** Runs one storage call, turning its errors into `StorageFailure`s (a `StoreError` stays what it is). */
function guarded<R>(call: () => R): R {
  try {
    return call();
  } catch (error) {
    throw error instanceof StoreError || error instanceof StorageFailure
      ? error
      : new StorageFailure(error);
  }
}

export class SqlStore implements Store<BrigadeTables> {
  /** Rows written while tracking, with their value before the first write. */
  private touched: Map<string, { table: TableName; id: string; before: Row | undefined }> | null =
    null;

  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(STORE_SCHEMA);
  }

  get<T extends TableName>(table: T, id: string): BrigadeTables[T] | undefined {
    return this.read(checked(table), id) as BrigadeTables[T] | undefined;
  }

  insert<T extends TableName>(table: T, row: BrigadeTables[T]): BrigadeTables[T] {
    checked(table);
    if (this.read(table, row.id)) throw new StoreError(`Duplicate id ${row.id} in ${table}`);
    this.touch(table, row.id, undefined);
    const data = JSON.stringify(row);
    this.exec("insert into store_rows (tbl, id, data) values (?, ?, ?)", table, row.id, data);
    return JSON.parse(data) as BrigadeTables[T];
  }

  update<T extends TableName>(
    table: T,
    id: string,
    patch: Partial<Omit<BrigadeTables[T], "id">>,
  ): BrigadeTables[T] {
    const row = this.read(checked(table), id);
    if (!row) throw new StoreError(`No row ${id} in ${table}`);
    this.touch(table, id, row);
    // JSON drops keys set to undefined (they keep their value); null clears. The id never changes.
    const data = JSON.stringify({ ...row, ...JSON.parse(JSON.stringify(patch)), id });
    this.exec("update store_rows set data = ? where tbl = ? and id = ?", data, table, id);
    return JSON.parse(data) as BrigadeTables[T];
  }

  delete<T extends TableName>(table: T, id: string): boolean {
    const row = this.read(checked(table), id);
    if (!row) return false;
    this.touch(table, id, row);
    this.exec("delete from store_rows where tbl = ? and id = ?", table, id);
    return true;
  }

  scan<T extends TableName>(table: T): BrigadeTables[T][] {
    const rows = this.exec<{ data: string }>(
      "select data from store_rows where tbl = ? order by id",
      checked(table),
    ).map((row) => JSON.parse(row.data) as BrigadeTables[T]);
    // SQLite compares ids as UTF-8 bytes; JavaScript (and the memory store) as UTF-16 code units. They agree on
    // every id in use (ASCII), and this keeps the two stores identical for any other id too.
    return rows.sort(byId);
  }

  /** `transactionSync`; an error `fn` throws passes through as is, one from storage itself is a `StorageFailure`. */
  transaction<R>(fn: () => R): R {
    let thrown: { error: unknown } | undefined;
    try {
      return this.storage.transactionSync(() => {
        try {
          return fn();
        } catch (error) {
          thrown = { error };
          throw error;
        }
      });
    } catch (error) {
      if (thrown && thrown.error === error) throw error;
      throw error instanceof StorageFailure ? error : new StorageFailure(error);
    }
  }

  /** Starts recording which rows are written, for the change log and the patches. */
  track(): void {
    this.touched = new Map();
  }

  /**
   * The rows whose value differs from before `track()`. Call it inside the transaction (the `commit` hook), so a
   * row a rolled-back savepoint restored reads back as unchanged.
   */
  changes(): RowChange[] {
    const changes: RowChange[] = [];
    for (const { table, id, before } of this.touched?.values() ?? []) {
      const after = this.read(table, id);
      if (JSON.stringify(before) !== JSON.stringify(after))
        changes.push({ table, id, before, after });
    }
    return changes;
  }

  untrack(): void {
    this.touched = null;
  }

  /** Records the shard version on rows a mutation changed. */
  stamp(changes: readonly RowChange[], version: number): void {
    for (const { table, id, after } of changes) {
      if (after) {
        this.exec("update store_rows set version = ? where tbl = ? and id = ?", version, table, id);
      }
    }
  }

  private read(table: TableName, id: string): Row | undefined {
    const [row] = this.exec<{ data: string }>(
      "select data from store_rows where tbl = ? and id = ?",
      table,
      id,
    );
    return row && (JSON.parse(row.data) as Row);
  }

  /** One statement, read to the end, with SQLite's errors as `StorageFailure`s. */
  private exec<T extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): T[] {
    return guarded(() => this.storage.sql.exec<T>(query, ...bindings).toArray());
  }

  private touch(table: TableName, id: string, before: Row | undefined): void {
    // Table names never contain a space, so the key is unambiguous. The first write keeps the original value:
    // a later rollback can only bring the row back to it.
    const key = `${table} ${id}`;
    if (this.touched && !this.touched.has(key)) this.touched.set(key, { table, id, before });
  }
}

function checked<T extends string>(table: T): T {
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) {
    throw new StoreError(`Unknown table ${table.slice(0, 64)}`);
  }
  return table;
}
