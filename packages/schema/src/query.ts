// Named queries (RFC 0004 "Shared core"): declared as data over one table, so the server can answer them and
// decide which subscriptions a changed row touches, and a client can re-run them over its local rows after an
// optimistic mutation.

import { allows, type Permission, type Role } from "./access.ts";
import { lookup, report } from "./mutation.ts";
import type { Store } from "./store.ts";
import { TABLES, type BrigadeTables, type SyncedTable } from "./tables.ts";
import { clip } from "./text.ts";
import { MAX_ISSUES, type Infer, type Issue, type Validator } from "./validate.ts";

export type QueryDef<
  Name extends string = string,
  Args = unknown,
  T extends SyncedTable = SyncedTable,
> = {
  name: Name;
  args: Validator<Args>;
  permission: Permission;
  /** A table clients hold; server-only tables cannot be queried. */
  table: T;
  /** Pure: whether `row` belongs to the result. */
  filter(row: BrigadeTables[T], args: Args): boolean;
  /** Pure comparator; rows otherwise come ordered by id. */
  sort?(a: BrigadeTables[T], b: BrigadeTables[T]): number;
  /** Single-row queries: the id to read with `store.get` instead of scanning the table. */
  key?(args: Args): string;
  /**
   * Queries over an id prefix: the half-open id range (`from` <= id < `to`) to read with `store.range` instead of
   * scanning the table. Rows outside it never belong to the result, whatever `filter` says.
   */
  range?(args: Args): IdRange;
};

export type IdRange = { from: string; to: string };

/**
 * The ids that start with `prefix`: from the prefix itself to the prefix with its last code unit raised by one
 * (`inc_x:` to `inc_x;`), so a store reads them off its id order.
 */
export function prefixRange(prefix: string): IdRange {
  const last = prefix.charCodeAt(prefix.length - 1);
  return { from: prefix, to: prefix.slice(0, -1) + String.fromCharCode(last + 1) };
}

// `any` keeps every concrete query assignable to a registry entry (args are checked by its validator).
export type AnyQuery = QueryDef<string, any, SyncedTable>;
export type QueryArgsOf<Q> = Q extends QueryDef<string, infer A, SyncedTable> ? A : never;
export type QueryRowOf<Q> = Q extends QueryDef<string, unknown, infer T> ? BrigadeTables[T] : never;

// Generic over the validator (not its output) so `filter`'s `args` is inferred from `args`.
export function defineQuery<
  const Name extends string,
  V extends Validator<any>,
  T extends SyncedTable,
>(def: {
  name: Name;
  args: V;
  permission: Permission;
  table: T;
  filter(row: BrigadeTables[T], args: Infer<V>): boolean;
  sort?(a: BrigadeTables[T], b: BrigadeTables[T]): number;
  key?(args: Infer<V>): string;
  range?(args: Infer<V>): IdRange;
}): QueryDef<Name, Infer<V>, T> {
  // The type already excludes server-only tables; this also catches casts and plain JS callers.
  if (TABLES[def.table].serverOnly) {
    throw new Error(`Query ${def.name} reads server-only table ${def.table}`);
  }
  return def;
}

export type QueryErrorCode = "unknown_query" | "invalid_args" | "forbidden" | "internal";
export type QueryResult<R = unknown> =
  | { ok: true; rows: R[] }
  | { ok: false; error: { code: QueryErrorCode; message: string; issues?: Issue[] } };

/**
 * Runs a query over its table, reads one row when the query has a `key`, or an id range when it has a `range`. Throws for a server-only table, so a
 * query built without `defineQuery` still cannot read one (`runQuery` turns that into `internal`).
 */
export function evaluateQuery<Args, T extends SyncedTable>(
  query: QueryDef<string, Args, T>,
  args: Args,
  store: Store<BrigadeTables>,
): BrigadeTables[T][] {
  if (
    !Object.prototype.hasOwnProperty.call(TABLES, query.table) ||
    TABLES[query.table].serverOnly
  ) {
    throw new Error(`Query ${query.name} reads a table clients do not hold`);
  }
  let candidates: BrigadeTables[T][];
  if (query.key) {
    const row = store.get(query.table, query.key(args));
    candidates = row ? [row] : [];
  } else if (query.range) {
    const { from, to } = query.range(args);
    candidates = store.range(query.table, from, to);
  } else {
    candidates = store.scan(query.table);
  }
  const rows = candidates.filter((row) => query.filter(row, args));
  return query.sort ? rows.sort((a, b) => query.sort!(a, b)) : rows;
}

/**
 * Checks that `role` may read (and, for an API token, that `options.scopes` hold the query's permission: RFC 0014),
 * validates `rawArgs`, and evaluates the query. Never throws: unexpected exceptions become an `internal` error and
 * their cause goes only to `options.onError`.
 */
export function runQuery(
  registry: { readonly [name: string]: AnyQuery },
  name: unknown,
  rawArgs: unknown,
  store: Store<BrigadeTables>,
  role: Role,
  options: { onError?(error: unknown, name: string): void; scopes?: readonly Permission[] } = {},
): QueryResult {
  // `name` comes off the wire: a non-string is just an unknown query.
  const query = lookup(registry, name);
  if (!query) {
    return { ok: false, error: { code: "unknown_query", message: `Unknown query ${clip(name)}` } };
  }
  try {
    const actor = { kind: options.scopes ? "token" : "user", role, scopes: options.scopes };
    if (!allows(actor, query.permission)) {
      return {
        ok: false,
        error: { code: "forbidden", message: `Not allowed to run ${query.name}` },
      };
    }
    const args = query.args(rawArgs);
    if (!args.ok) {
      const message = `Invalid arguments for ${query.name}`;
      const issues = args.issues.slice(0, MAX_ISSUES);
      return { ok: false, error: { code: "invalid_args", message, issues } };
    }
    return { ok: true, rows: evaluateQuery(query, args.value, store) };
  } catch (error) {
    report(options, error, query.name);
    return { ok: false, error: { code: "internal", message: `${query.name} failed` } };
  }
}
