// What `WorkspaceDO`'s orchestrators (`Pager`, and next the mailer, receipts, members' ledgers) take from it, built
// from an Ember mutation's context (RFC 0016 "Parity"), so they run on Ember unchanged: their rows through
// `createEmberStore`, their ledgers through `ctx.sql` (Ember's app-private SQL tables, G9), and their mutations
// through the same `run()` every Ember mutation of a workspace goes through (events and their drain included).
//
// Everything runs inside the one Ember mutation that built it: a throw rolls all of it back, rows and ledgers alike.

import type { MutationCtx } from "@freecorps/ember-server";
import {
  createEmberStore,
  mutations,
  type EmberRowsWriter,
  serverMutations,
  type BrigadeTables,
  type EmberStore,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { MutateInput, MutateOutcome } from "../src/shard.ts";
import { BRIGADE_TABLES } from "./schema.ts";
import { run, workspaceId, workspaceLimits } from "./workspace.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

/** How long a stored mutation result is kept, as the DO keeps it (`RESULT_RETENTION_MS`). */
const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;

/** A result of `SqlStorage.exec`, as the orchestrators read it. */
function cursor<T extends Row>(rows: T[]) {
  return {
    toArray: () => rows,
    one: (): T => {
      if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
      return rows[0]!;
    },
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    rowsRead: rows.length,
    rowsWritten: 0,
  };
}

/**
 * `DurableObjectStorage` as the orchestrators use it: `sql.exec` over `ctx.sql`, and `transactionSync` as a savepoint
 * (`ctx.sql.transaction`) around `store.transaction`, so a rollback undoes the ledgers, the documents and the store's
 * cache of them together. Their constructors run their schema text (`create table if not exists …; …`): that DDL is
 * the schema's `privateSql` already, applied by Ember's migration, so it is skipped here.
 */
function emberStorage(ctx: MutationCtx, store: EmberStore<BrigadeTables>): DurableObjectStorage {
  const sql = {
    exec<T extends Row>(statement: string, ...params: unknown[]) {
      if (/^\s*create\s+(unique\s+)?(table|index)\s+if\s+not\s+exists\b/i.test(statement)) {
        return cursor<T>([]);
      }
      return cursor(ctx.sql.exec(statement, ...(params as never[])) as T[]);
    },
  };
  return {
    sql,
    transactionSync: <T>(fn: () => T): T => ctx.sql.transaction(() => store.transaction(fn)),
  } as unknown as DurableObjectStorage;
}

/**
 * `db` with every error its calls throw (the query builder's `collect`/`first` included) reported to `failed` before
 * it is rethrown: a mutation's code catches its own errors, so a storage failure would otherwise end as `internal`.
 */
function watched(db: EmberRowsWriter, failed: (error: unknown) => void): EmberRowsWriter {
  const guard = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      failed(error);
      throw error;
    }
  };
  return {
    query: (table) => {
      const q = guard(() => db.query(table));
      return {
        withIndex: (index, range) => {
          const r = guard(() => q.withIndex(index, range));
          return { collect: () => guard(() => r.collect()), first: () => guard(() => r.first()) };
        },
      };
    },
    insert: (table, value) => guard(() => db.insert(table, value)),
    patch: (id, value) => guard(() => db.patch(id, value)),
    delete: (id) => guard(() => db.delete(id)),
  };
}

/** The DO's `Shard` and storage, as the orchestrators take them, over one Ember mutation. */
export function emberWorkspace(ctx: MutationCtx): {
  shard: EmberShard;
  storage: DurableObjectStorage;
} {
  const shard = new EmberShard(ctx);
  return { shard, storage: emberStorage(ctx, shard.store) };
}

/**
 * The part of the DO's `Shard` (src/shard.ts) the orchestrators use, over an Ember mutation: one `store` that every
 * read and mutation shares (so a read after a mutation sees it), the workspace it holds, and `mutate` with the DO's
 * de-duplication by mutation id (`storedResult`).
 */
export class EmberShard {
  readonly store: EmberStore<BrigadeTables>;
  /** The first error Ember's storage threw under this shard's store (the DO's `StorageFailure`). */
  private failure: { error: unknown } | undefined;

  constructor(private readonly ctx: MutationCtx) {
    this.store = createEmberStore<BrigadeTables>(
      watched(ctx.db as unknown as EmberRowsWriter, (error) => {
        this.failure ??= { error };
      }),
      TABLE_SET,
    );
  }

  workspace(): string | undefined {
    return workspaceId(this.store);
  }

  storedResult(
    actorId: string,
    clientId: string,
    mutationId: string,
    now: number,
  ): MutationResultMessage | undefined {
    const [row] = this.ctx.sql.exec(
      `select result from mutation_results
       where actor_id = ? and client_id = ? and mutation_id = ? and at >= ?`,
      actorId,
      clientId,
      mutationId,
      now - RESULT_RETENTION_MS,
    ) as { result: string }[];
    return row && (JSON.parse(row.result) as MutationResultMessage);
  }

  /**
   * Rethrows the storage failure any call under this shard met, so the Ember mutation that built it fails as a whole:
   * the orchestrators catch what `mutate` throws (a held push left held, `Pager.releaseDue`), which on the DO is fine
   * because its storage failure aborts the alarm's transaction, and here must do the same. Every function using the
   * shard calls it last.
   */
  check(): void {
    if (this.failure) throw this.failure.error;
  }

  mutate(input: MutateInput): MutateOutcome {
    const registry = input.internal ? serverMutations : mutations;
    let out: ReturnType<typeof run>;
    try {
      out = run(
        this.ctx,
        registry,
        input.name,
        input.args,
        () => input.actor,
        workspaceLimits(),
        this.store,
      );
    } catch (error) {
      // `run` throws only when the mutation cannot be answered (its events not written, a rollback not replayed).
      this.failure ??= { error };
      throw error;
    }
    // A storage failure is not an answer (RFC 0004): rethrown, so the whole Ember mutation rolls back and its caller
    // tries again, rather than an `internal` result stored for this mutation id (`escalation.start` never retried).
    this.check();
    const result: MutationResultMessage = out.ok
      ? { type: "mutationResult", mutationId: input.mutationId, ok: true, version: 0 }
      : { type: "mutationResult", mutationId: input.mutationId, ok: false, error: out.error };
    this.ctx.sql.exec(
      `insert into mutation_results (actor_id, client_id, mutation_id, at, result) values (?, ?, ?, ?, ?)
       on conflict (actor_id, client_id, mutation_id) do update set at = excluded.at, result = excluded.result`,
      input.actor.id,
      input.clientId,
      input.mutationId,
      input.now,
      JSON.stringify(result),
    );
    this.ctx.sql.exec("delete from mutation_results where at < ?", input.now - RESULT_RETENTION_MS);
    // Ember's subscriptions follow the rows themselves: no patches to build here.
    return { result, changes: [] };
  }
}
