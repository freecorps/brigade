// The sync engine's storage side for one shard (RFC 0004): the row store, the monotonic version, the bounded
// change log, stored mutation results for de-duplication and the outbox. No sockets here; `WorkspaceDO` wires
// this to the WebSocket protocol. Everything is synchronous SQLite, so a caller never yields mid-operation.

import {
  lookup,
  mutations,
  queries,
  runMutation,
  runQuery,
  TABLES,
  type Actor,
  type AnyQuery,
  type MutationContext,
  type QueryResult,
  type RandomBytes,
  type Role,
} from "@freecorps/brigade-schema";
import { OUTBOX_SCHEMA, writeOutbox } from "./outbox.ts";
import { SqlStore, type RowChange } from "./store.ts";
import type { MutationResultFrame, SubPatch, WireRow } from "./wire.ts";

/** How many versions the change log keeps. A resume from further back gets a snapshot instead of a patch. */
export const CHANGE_LOG_VERSIONS = 1000;
/**
 * How long a mutation's result is kept for de-duplication. Clients drop pending mutations older than this, so a
 * retry inside the window gets the stored result and nothing older is retried.
 */
export const RESULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SCHEMA = `
  create table if not exists shard_meta (key text primary key, value) without rowid;
  create table if not exists change_log (
    version integer not null,
    tbl text not null,
    id text not null,
    primary key (version, tbl, id)
  ) without rowid;
  create table if not exists mutation_results (
    client_id text not null,
    mutation_id text not null,
    at integer not null,
    result text not null,
    primary key (client_id, mutation_id)
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
};

export type MutateOutcome = {
  result: MutationResultFrame;
  /** Changed rows of synced tables, when the mutation committed; what the patches are built from. */
  changes: RowChange[];
};

export type Logger = (message: string, fields: Record<string, unknown>) => void;

export class Shard {
  readonly store: SqlStore;
  private readonly sql: SqlStorage;

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
    this.sql.exec(SCHEMA);
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
    const [row] = this.sql
      .exec<{ value: string }>("select value from shard_meta where key = 'workspace'")
      .toArray();
    return row?.value;
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

  /** A stored result for a retried mutation, if it is still within retention. */
  storedResult(clientId: string, mutationId: string, now: number): MutationResultFrame | undefined {
    const [row] = this.sql
      .exec<{ result: string }>(
        "select result from mutation_results where client_id = ? and mutation_id = ? and at >= ?",
        clientId,
        mutationId,
        now - RESULT_RETENTION_MS,
      )
      .toArray();
    return row && (JSON.parse(row.result) as MutationResultFrame);
  }

  /**
   * Runs a mutation as `actor` (RFC 0004): its rows, the version bump, the change log, the outbox and its stored
   * result all commit in one transaction, or none do. A failure's result is stored too, so a retry gets the same
   * answer. The caller checks `storedResult` first.
   */
  mutate(input: MutateInput): MutateOutcome {
    const { clientId, mutationId, actor, now } = input;
    const workspaceId = this.workspace();
    if (workspaceId === undefined) throw new Error("Shard has no workspace yet");
    const ctx: MutationContext = { actor, now, server: true };
    // Set by `commit`; a box, because TypeScript does not see assignments made inside the callback.
    const done: { committed?: { changes: RowChange[]; result: MutationResultFrame } } = {};

    this.store.track();
    let outcome;
    try {
      outcome = runMutation(mutations, input.name, input.args, this.store, ctx, {
        commit: (events) => {
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
          const result: MutationResultFrame = {
            type: "mutationResult",
            mutationId,
            ok: true,
            version,
          };
          this.saveResult(clientId, mutationId, now, result);
          done.committed = { changes, result };
        },
        onError: (error, name) => this.options.log("mutation failed", { mutation: name, error }),
      });
    } finally {
      this.store.untrack();
    }

    this.prune(now);
    if (outcome.ok && done.committed) return done.committed;
    const result: MutationResultFrame = outcome.ok
      ? // Unreachable: `commit` runs before every success. Kept so a broken invariant cannot lose the reply.
        {
          type: "mutationResult",
          mutationId,
          ok: false,
          error: { code: "internal", message: "failed" },
        }
      : { type: "mutationResult", mutationId, ok: false, error: outcome.error };
    this.saveResult(clientId, mutationId, now, result);
    return { result, changes: [] };
  }

  /** Runs a query for a subscription (permission and args checked by `runQuery`). */
  query(name: unknown, args: unknown, role: Role): QueryResult<WireRow> {
    return runQuery(queries, name, args, this.store, role, {
      onError: (error, query) => this.options.log("query failed", { query, error }),
    }) as QueryResult<WireRow>;
  }

  /**
   * A resume patch for `query` from version `since`, or undefined when the change log no longer reaches back (or
   * `since` is ahead of this shard): rows changed since then that are in the result now, and the changed ids that
   * are not (they may have left it; a delete for a row the client lacks is a no-op).
   */
  resume(query: AnyQuery, rows: readonly WireRow[], since: number): SubPatch | undefined {
    if (since < this.logStart() || since > this.version()) return undefined;
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

  private prune(now: number): void {
    this.sql.exec("delete from mutation_results where at < ?", now - RESULT_RETENTION_MS);
  }

  private saveResult(
    clientId: string,
    mutationId: string,
    now: number,
    result: MutationResultFrame,
  ): void {
    this.sql.exec(
      `insert into mutation_results (client_id, mutation_id, at, result) values (?, ?, ?, ?)
       on conflict (client_id, mutation_id) do update set at = excluded.at, result = excluded.result`,
      clientId,
      mutationId,
      now,
      JSON.stringify(result),
    );
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

/** The registry entry for a query name off the wire (own entries only). */
export const findQuery = (name: unknown): AnyQuery | undefined => lookup(queries, name);
