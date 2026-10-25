// The sync engine's storage side for one shard (RFC 0004): the row store, the monotonic version, the bounded
// change log, stored mutation results for de-duplication and the outbox. No sockets here; `WorkspaceDO` wires
// this to the WebSocket protocol. Everything is synchronous SQLite, so a caller never yields mid-operation.

import {
  lookup,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  TABLES,
  type Actor,
  type AnyQuery,
  type BrigadeTables,
  type DomainEvent,
  type MutationContext,
  type QueryResult,
  type RandomBytes,
  type Role,
} from "@freecorps/brigade-schema";
import { OUTBOX_SCHEMA, writeOutbox } from "./outbox.ts";
import { SqlStore, StorageFailure, type RowChange } from "./store.ts";
import {
  MUTATION_RETENTION_MS,
  type MutationResultMessage,
  type SubscriptionChanges,
  type WireRow,
} from "@freecorps/brigade-sync/protocol";

/** How many versions the change log keeps. A resume from further back gets a snapshot instead of a patch. */
export const CHANGE_LOG_VERSIONS = 1000;
/**
 * How long a mutation's result is kept for de-duplication, from when the shard ran it (the protocol's
 * `MUTATION_RETENTION_MS`). Clients never re-send a mutation older than this.
 */
export const RESULT_RETENTION_MS = MUTATION_RETENTION_MS;
/** While nothing drains the outbox, its size is logged each time it grows by this many rows. */
export const OUTBOX_LOG_EVERY = 1000;

const SCHEMA = `
  create table if not exists shard_meta (key text primary key, value) without rowid;
  create table if not exists change_log (
    version integer not null,
    tbl text not null,
    id text not null,
    primary key (version, tbl, id)
  ) without rowid;
  create table if not exists mutation_results (
    actor_id text not null,
    client_id text not null,
    mutation_id text not null,
    at integer not null,
    result text not null,
    primary key (actor_id, client_id, mutation_id)
  ) without rowid;
  create index if not exists mutation_results_at on mutation_results (at);
  ${OUTBOX_SCHEMA}
`;

export type MutateInput = {
  clientId: string;
  mutationId: string;
  actor: Actor;
  name: unknown;
  args: unknown;
  now: number;
  /**
   * Set only for the Worker's own calls (provisioning): it may also run server-only mutations such as
   * `workspace.create`. A socket's mutations are looked up among the client-facing ones alone.
   */
  internal?: boolean;
};

export type MutateOutcome = {
  result: MutationResultMessage;
  /** Changed rows of synced tables, when the mutation committed; what the patches are built from. */
  changes: RowChange[];
};

export type Logger = (message: string, fields: Record<string, unknown>) => void;

type Committed = { changes: RowChange[]; result: MutationResultMessage };

export class Shard {
  readonly store: SqlStore;
  private readonly sql: SqlStorage;
  private current: string;

  constructor(
    storage: DurableObjectStorage,
    private readonly options: {
      /** `workspace` for `WorkspaceDO`; part of every event's `source`. */
      shard: string;
      randomBytes: RandomBytes;
      log: Logger;
      /** Default `CHANGE_LOG_VERSIONS`; tests lower it. */
      changeLogVersions?: number;
    },
  ) {
    this.sql = storage.sql;
    this.store = new SqlStore(storage);
    // Spike storage from before results were keyed by actor: the table is only a de-duplication cache.
    const [results] = this.sql
      .exec<{ sql: string }>("select sql from sqlite_master where name = 'mutation_results'")
      .toArray();
    if (results && !results.sql.includes("actor_id")) this.sql.exec("drop table mutation_results");
    this.sql.exec(SCHEMA);
    this.current = this.text("epoch") ?? this.rotateEpoch();
  }

  /**
   * Opaque id created with the storage and replaced on every restore; versions only compare within one epoch
   * (RFC 0004). A token (`ep_<ULID>`), as the protocol requires.
   */
  get epoch(): string {
    return this.current;
  }

  /**
   * Writes a new epoch. Every restore of this shard's storage calls it before the shard serves a socket again
   * (RFC 0004 "Shard server"): a restored shard reuses versions for other changes, and only a new epoch makes
   * every client's resume point invalid, so each resume gets a snapshot. Also how the epoch is first created.
   */
  rotateEpoch(): string {
    const epoch = newId("ep", Date.now(), this.options.randomBytes);
    this.sql.exec(
      "insert into shard_meta (key, value) values ('epoch', ?) on conflict (key) do update set value = excluded.value",
      epoch,
    );
    this.current = epoch;
    return epoch;
  }

  /** The last committed version; 0 before the first mutation. */
  version(): number {
    return this.meta("version") ?? 0;
  }

  /** The change log holds every change after this version; a resume from before it gets a snapshot. */
  logStart(): number {
    return this.meta("log_start") ?? 0;
  }

  /** The workspace this shard serves, recorded on first use. */
  workspace(): string | undefined {
    return this.text("workspace");
  }

  /** Records the workspace id, or returns false if the shard already serves another one. */
  claim(workspaceId: string): boolean {
    const current = this.workspace();
    if (current === undefined) {
      this.sql.exec("insert into shard_meta (key, value) values ('workspace', ?)", workspaceId);
      return true;
    }
    return current === workspaceId;
  }

  /**
   * A stored result for a retried mutation, if it is still within retention. Results are kept apart per actor and
   * client: another actor reusing a client id and mutation id never gets this one's result.
   */
  storedResult(
    actorId: string,
    clientId: string,
    mutationId: string,
    now: number,
  ): MutationResultMessage | undefined {
    const [row] = this.sql
      .exec<{ result: string }>(
        `select result from mutation_results
         where actor_id = ? and client_id = ? and mutation_id = ? and at >= ?`,
        actorId,
        clientId,
        mutationId,
        now - RESULT_RETENTION_MS,
      )
      .toArray();
    return row && (JSON.parse(row.result) as MutationResultMessage);
  }

  /**
   * Runs a mutation as `actor` (RFC 0004): its rows, the version bump, the change log, the outbox and its stored
   * result all commit in one transaction, or none do. The caller checks `storedResult` first.
   *
   * A failed mutation's result is stored too, so a retry gets the same answer, except `unknown_mutation` (a later
   * deploy may know the name). A storage failure anywhere in the mutation's transaction (a store read or write in
   * `apply`, the commit hook, the transaction itself) is not the mutation's answer: it rolls back, nothing is
   * stored and it is rethrown, so the socket closes and the client replays the mutation. Only an exception from the
   * mutation's own code becomes a stored `internal`.
   *
   * Once this returns a committed version nothing else runs before the caller sends the result and the patches:
   * housekeeping (pruning old results) runs first, and a failure there is only logged.
   */
  mutate(input: MutateInput): MutateOutcome {
    const { clientId, mutationId, actor, now } = input;
    const workspaceId = this.workspace();
    if (workspaceId === undefined) throw new Error("Shard has no workspace yet");
    const ctx: MutationContext = { actor, now, server: true };
    // Set by `commit`; a box, because TypeScript does not see assignments made inside the callback.
    const done: { committed?: Committed; failed?: { error: unknown } } = {};

    this.prune(now);
    this.store.track();
    let outcome;
    try {
      outcome = runMutation(
        input.internal ? serverMutations : mutations,
        input.name,
        input.args,
        this.store,
        ctx,
        {
          commit: (events) => {
            try {
              done.committed = this.commit(events, { ...input, workspaceId });
            } catch (error) {
              // `runMutation` would answer it with `internal`; it is rethrown below instead.
              done.failed = { error };
              throw error;
            }
          },
          onError: (error, name) => {
            if (done.failed) return;
            // From the store under the mutation, not from its code: rethrown below, never stored.
            if (error instanceof StorageFailure) done.failed = { error };
            else this.options.log("mutation failed", { mutation: name, error });
          },
        },
      );
    } finally {
      this.store.untrack();
    }
    if (done.failed) throw done.failed.error;
    // The commit hook ran but the transaction still failed (it could not commit): nothing is stored.
    if (done.committed && !outcome.ok)
      throw new StorageFailure("the mutation's transaction failed");

    if (outcome.ok && done.committed) return done.committed;
    const result: MutationResultMessage = outcome.ok
      ? // Unreachable: `commit` runs before every success. Kept so a broken invariant cannot lose the reply.
        {
          type: "mutationResult",
          mutationId,
          ok: false,
          error: { code: "internal", message: "failed" },
        }
      : { type: "mutationResult", mutationId, ok: false, error: outcome.error };
    if (result.ok || result.error.code !== "unknown_mutation") {
      this.saveResult(actor.id, clientId, mutationId, now, result);
    }
    return { result, changes: [] };
  }

  /** `runMutation`'s commit hook, inside the mutation's transaction: version, change log, outbox and result. */
  private commit(
    events: readonly DomainEvent[],
    input: MutateInput & { workspaceId: string },
  ): Committed {
    const { clientId, mutationId, actor, now, workspaceId } = input;
    const version = this.version() + 1;
    this.setMeta("version", version);
    const changes = this.store.changes().filter((change) => !TABLES[change.table].serverOnly);
    this.store.stamp(changes, version);
    for (const { table, id } of changes) {
      this.sql.exec(
        "insert into change_log (version, tbl, id) values (?, ?, ?)",
        version,
        table,
        id,
      );
    }
    this.compact(version);
    writeOutbox(this.sql, events, {
      workspaceId,
      shard: this.options.shard,
      actor,
      now,
      version,
      randomBytes: this.options.randomBytes,
    });
    this.watchOutbox();
    const result: MutationResultMessage = { type: "mutationResult", mutationId, ok: true, version };
    this.saveResult(actor.id, clientId, mutationId, now, result);
    return { changes, result };
  }

  /** Runs a query for a subscription (permission and args checked by `runQuery`). */
  query(name: unknown, args: unknown, role: Role): QueryResult<WireRow> {
    return runQuery(queries, name, args, this.store, role, {
      onError: (error, query) => this.options.log("query failed", { query, error }),
    }) as QueryResult<WireRow>;
  }

  /**
   * A resume patch for `query` from `{ version, epoch }`, or undefined when a snapshot is needed: another epoch,
   * a version ahead of this shard (a restore) or older than the change log. The patch holds rows changed since
   * then that are in the result now, and the changed ids that are not (they may have left it; a delete for a row
   * the client lacks is a no-op).
   */
  resume(
    query: AnyQuery,
    rows: readonly WireRow[],
    from: { version: number; epoch: string },
  ): SubscriptionChanges | undefined {
    const since = from.version;
    if (from.epoch !== this.epoch || since < this.logStart() || since > this.version()) {
      return undefined;
    }
    const changed = new Set(
      this.sql
        .exec<{ id: string }>(
          "select distinct id from change_log where version > ? and tbl = ?",
          since,
          query.table,
        )
        .toArray()
        .map((row) => row.id),
    );
    const upserts = rows.filter((row) => changed.has(row.id));
    const present = new Set(rows.map((row) => row.id));
    const deletes = [...changed].filter((id) => !present.has(id)).sort();
    return { upserts, deletes };
  }

  /** Drops change-log versions beyond the bound; resumes from before `log_start` get a snapshot. */
  private compact(version: number): void {
    const start = version - (this.options.changeLogVersions ?? CHANGE_LOG_VERSIONS);
    if (start <= this.logStart()) return;
    this.sql.exec("delete from change_log where version <= ?", start);
    this.setMeta("log_start", start);
  }

  /**
   * TODO(RFC 0005): drain the outbox to the `brigade-events` Queue from an alarm, deleting rows only after the send
   * succeeds. Until then rows only accumulate, so the count is logged each time it grows by `OUTBOX_LOG_EVERY`.
   * Nothing deletes yet, so `max(seq) - min(seq) + 1` is the row count without a scan.
   */
  private watchOutbox(): void {
    const { rows } = this.sql
      .exec<{ rows: number | null }>("select max(seq) - min(seq) + 1 as rows from outbox")
      .one();
    if (rows !== null && rows > 0 && rows % OUTBOX_LOG_EVERY === 0) {
      this.options.log("outbox not drained", { rows });
    }
  }

  /** Drops results past retention. Housekeeping: a failure is logged, never fails the mutation. */
  private prune(now: number): void {
    try {
      this.sql.exec("delete from mutation_results where at < ?", now - RESULT_RETENTION_MS);
    } catch (error) {
      this.options.log("pruning mutation results failed", { error });
    }
  }

  private saveResult(
    actorId: string,
    clientId: string,
    mutationId: string,
    now: number,
    result: MutationResultMessage,
  ): void {
    this.sql.exec(
      `insert into mutation_results (actor_id, client_id, mutation_id, at, result) values (?, ?, ?, ?, ?)
       on conflict (actor_id, client_id, mutation_id) do update set at = excluded.at, result = excluded.result`,
      actorId,
      clientId,
      mutationId,
      now,
      JSON.stringify(result),
    );
  }

  private text(key: string): string | undefined {
    const [row] = this.sql
      .exec<{ value: string }>("select value from shard_meta where key = ?", key)
      .toArray();
    return row?.value;
  }

  private meta(key: string): number | undefined {
    const [row] = this.sql
      .exec<{ value: number }>("select value from shard_meta where key = ?", key)
      .toArray();
    return row?.value;
  }

  private setMeta(key: string, value: number): void {
    this.sql.exec(
      "insert into shard_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      key,
      value,
    );
  }
}

/**
 * What `changes` do to one subscription's result: rows in it now (entered or changed) are upserts, ids that were
 * in it and are not any more are deletes; undefined if it is untouched. Membership is `evaluateQuery`'s: a query
 * with a `key` holds only the row with that id, and one with a `range` only rows in it, whatever its filter says. Throws if the query's code does.
 */
export function subscriptionChanges(
  query: AnyQuery,
  args: unknown,
  changes: readonly RowChange[],
): SubscriptionChanges | undefined {
  const key = query.key?.(args);
  const range = query.range?.(args);
  const member = (row: WireRow | undefined) =>
    row !== undefined &&
    (key === undefined || row.id === key) &&
    (range === undefined || (row.id >= range.from && row.id < range.to)) &&
    query.filter(row as BrigadeTables[typeof query.table], args);
  const patch: SubscriptionChanges = { upserts: [], deletes: [] };
  for (const change of changes) {
    if (change.table !== query.table) continue;
    if (member(change.after)) patch.upserts.push(change.after!);
    else if (member(change.before)) patch.deletes.push(change.id);
  }
  return patch.upserts.length || patch.deletes.length ? patch : undefined;
}

/** The registry entry for a query name off the wire (own entries only). */
export const findQuery = (name: unknown): AnyQuery | undefined => lookup(queries, name);
