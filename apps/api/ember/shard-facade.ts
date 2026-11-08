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
  ROLES,
  type Actor,
  type EmberRowsWriter,
  serverMutations,
  type BrigadeTables,
  type EmberStore,
} from "@freecorps/brigade-schema";
import {
  MUTATION_RETENTION_MS,
  type MutationResultMessage,
} from "@freecorps/brigade-sync/protocol";
import type { MutateInput, MutateOutcome } from "../src/shard.ts";
import { BRIGADE_TABLES } from "./schema.ts";
import { run, workspaceId, workspaceLimits } from "./workspace.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

/** How long a stored mutation result and a request key are kept, as the DO keeps them (`RESULT_RETENTION_MS`). */
const RESULT_RETENTION_MS = MUTATION_RETENTION_MS;

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
          return {
            collect: () => guard(() => r.collect()),
            first: () => guard(() => r.first()),
            order: (order) => {
              const o = guard(() => r.order(order));
              return { take: (n) => guard(() => o.take(n)) };
            },
          };
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

  /** When the stored result of a mutation was written (`Shard.storedAt`), within the retention. */
  storedAt(actorId: string, clientId: string, mutationId: string, now: number): number | undefined {
    const [row] = this.ctx.sql.exec(
      `select at from mutation_results
       where actor_id = ? and client_id = ? and mutation_id = ? and at >= ?`,
      actorId,
      clientId,
      mutationId,
      now - RESULT_RETENTION_MS,
    ) as { at: number }[];
    return row?.at;
  }

  /**
   * Ties an HTTP request's `Idempotency-Key` to what the request is (`Shard.claimRequestKey`): true when the key is
   * new or was first sent with this same request, within the results' retention.
   */
  claimRequestKey(actorId: string, key: string, request: string, now: number): boolean {
    const [row] = this.ctx.sql.exec(
      "select request from request_keys where actor_id = ? and key = ? and at >= ?",
      actorId,
      key,
      now - RESULT_RETENTION_MS,
    ) as { request: string }[];
    if (row) return row.request === request;
    this.ctx.sql.exec(
      `insert into request_keys (actor_id, key, at, request) values (?, ?, ?, ?)
       on conflict (actor_id, key) do update set at = excluded.at, request = excluded.request`,
      actorId,
      key,
      now,
      request,
    );
    this.ctx.sql.exec("delete from request_keys where at < ?", now - RESULT_RETENTION_MS);
    return true;
  }

  /**
   * Whether `userId` was removed from this workspace within `MEMBER_TOMBSTONE_MS` (`member_gone`, written by `run()`
   * and `members:reconcile`): a request the Worker authenticated against D1 just before the removal still in flight is
   * refused, as the DO's tombstone refuses it (`Membership.refuses`). A member synced again clears it.
   */
  gone(userId: string, now: number): boolean {
    const [row] = this.ctx.sql.exec(
      "select 1 from member_gone where user_id = ? and until > ?",
      userId,
      now,
    ) as unknown[];
    return row !== undefined;
  }

  /** The status page's dirty version (`shard_meta` `status_dirty`, set by `run()`), as `Shard.statusDirty`. */
  statusDirty(): number | undefined {
    const [row] = this.ctx.sql.exec("select value from shard_meta where key = 'status_dirty'") as {
      value: number;
    }[];
    return row?.value;
  }

  /** The snapshot pushed as of `version`: a change since set a newer one, which stays (`Shard.statusPushed`). */
  statusPushed(version: number): void {
    this.ctx.sql.exec("delete from shard_meta where key = 'status_dirty' and value <= ?", version);
  }

  /**
   * An API token actor as this shard backs it (`WorkspaceDO.tokenActor`, RFC 0014), or undefined: its listed copy must
   * exist, be neither revoked nor expired and have the same creator; its role is the lower of what the Worker read in
   * D1 and the creator's copy here. Any other actor is returned as it is.
   */
  tokenActor(actor: Actor, now: number): Actor | undefined {
    if (actor.kind !== "token") return actor;
    const row = this.store.get("api_tokens", actor.id);
    if (!row || row.revokedAt !== null || row.createdBy !== actor.by) return undefined;
    if (row.expiresAt !== null && row.expiresAt <= now) return undefined;
    const copy = this.store.get("members", row.createdBy);
    return copy && ROLES.indexOf(copy.role) > ROLES.indexOf(actor.role)
      ? { ...actor, role: copy.role }
      : actor;
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
