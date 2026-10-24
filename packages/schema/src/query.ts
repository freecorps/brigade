// Named queries (RFC 0004 "Shared core"): declared as data over one table, so the server can answer them and
// decide which subscriptions a changed row touches, and a client can re-run them over its local rows after an
// optimistic mutation.

import { can, isRole, type Permission, type Role } from "./access.ts";
import type { Store } from "./store.ts";
import type { BrigadeTables } from "./tables.ts";
import type { Infer, Issue, Validator } from "./validate.ts";

type TableName = Extract<keyof BrigadeTables, string>;

export type QueryDef<
  Name extends string = string,
  Args = unknown,
  T extends TableName = TableName,
> = {
  name: Name;
  args: Validator<Args>;
  permission: Permission;
  table: T;
  /** Pure: whether `row` belongs to the result. */
  filter(row: BrigadeTables[T], args: Args): boolean;
  /** Pure comparator; rows otherwise come ordered by id. */
  sort?(a: BrigadeTables[T], b: BrigadeTables[T]): number;
};

// `any` keeps every concrete query assignable to a registry entry (args are checked by its validator).
export type AnyQuery = QueryDef<string, any, TableName>;
export type QueryArgsOf<Q> = Q extends QueryDef<string, infer A, TableName> ? A : never;
export type QueryRowOf<Q> = Q extends QueryDef<string, unknown, infer T> ? BrigadeTables[T] : never;

// Generic over the validator (not its output) so `filter`'s `args` is inferred from `args`.
export function defineQuery<
  const Name extends string,
  V extends Validator<any>,
  T extends TableName,
>(def: {
  name: Name;
  args: V;
  permission: Permission;
  table: T;
  filter(row: BrigadeTables[T], args: Infer<V>): boolean;
  sort?(a: BrigadeTables[T], b: BrigadeTables[T]): number;
}): QueryDef<Name, Infer<V>, T> {
  return def;
}

export type QueryErrorCode = "unknown_query" | "invalid_args" | "forbidden";
export type QueryResult<R = unknown> =
  | { ok: true; rows: R[] }
  | { ok: false; error: { code: QueryErrorCode; message: string; issues?: Issue[] } };

/** Runs a query over every row of its table. */
export function evaluateQuery<Args, T extends TableName>(
  query: QueryDef<string, Args, T>,
  args: Args,
  store: Store<BrigadeTables>,
): BrigadeTables[T][] {
  const rows = store.scan(query.table).filter((row) => query.filter(row, args));
  return query.sort ? rows.sort((a, b) => query.sort!(a, b)) : rows;
}

/** Checks that `role` may read, validates `rawArgs`, and evaluates the query. */
export function runQuery(
  registry: { readonly [name: string]: AnyQuery },
  name: string,
  rawArgs: unknown,
  store: Store<BrigadeTables>,
  role: Role,
): QueryResult {
  const query = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!query) {
    return { ok: false, error: { code: "unknown_query", message: `Unknown query ${name}` } };
  }
  if (!isRole(role) || !can(role, query.permission)) {
    return { ok: false, error: { code: "forbidden", message: `Not allowed to run ${name}` } };
  }
  const args = query.args(rawArgs);
  if (!args.ok) {
    return {
      ok: false,
      error: {
        code: "invalid_args",
        message: `Invalid arguments for ${name}`,
        issues: args.issues,
      },
    };
  }
  return { ok: true, rows: evaluateQuery(query, args.value, store) };
}
