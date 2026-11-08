// The dashboard's client for a workspace on Ember (RFC 0016 "Clients", step 4): the same surface as `SyncClient`
// (`query`, `mutate`, `newId`, the connection state), so the React hooks and every card above them do not change,
// over Ember's own client and protocol instead of Brigade Sync. The workspace's named queries and mutations are the
// shard's `workspace:query` and `workspace:mutate`, which run the same definitions (apps/api/ember/workspace.ts).
//
// Optimistic updates (gap G5): one for every mutation, which runs Brigade's `apply` over the rows of the shard's
// loaded queries, as `SyncClient` does over its confirmed rows, then evaluates each loaded query again over the
// result. Ember re-runs it over every server change until the mutation's result arrives, with the same context (the
// actor and the time of its first run), so a re-apply makes the same rows.

import {
  EmberClient,
  EmberError,
  type AuthTokenFetcher,
  type ConnectivitySource,
  type OptimisticUpdate,
  type PendingMutationRecord,
  type QuerySnapshot,
  type ShardConnectionState,
  type WebSocketConstructor,
} from "@freecorps/ember-client";
import {
  createMemoryStore,
  evaluateQuery,
  lookup,
  mutations as brigadeMutations,
  newId,
  queries as brigadeQueries,
  runMutation,
  type Actor,
  type AnyQuery,
  type ArgsOf,
  type BrigadeTables,
  type MutationContext,
  type QueryArgsOf,
  type QueryResult,
  type QueryRowOf,
  type RandomBytes,
  type Row,
} from "@freecorps/brigade-schema";
import type {
  ConnectionState,
  MutationOutcome,
  QueryHandle,
  QueryState,
  SyncClientLike,
  SyncErrorCode,
  SyncMutationError,
} from "./client.ts";

type Queries = typeof brigadeQueries;
type Mutations = typeof brigadeMutations;

/** The shard functions every workspace query and mutation goes through. */
export const WORKSPACE_QUERY = "workspace:query";
export const WORKSPACE_MUTATE = "workspace:mutate";

/** The Ember shard of a workspace (apps/api/src/ember.ts `workspaceShard`). */
export const emberShard = (workspaceId: string): string => `workspace:${workspaceId}`;

const globals = globalThis as unknown as {
  crypto?: { getRandomValues(array: Uint8Array): Uint8Array };
  setTimeout?: (callback: () => void, ms: number) => unknown;
  console?: { warn(...args: unknown[]): void };
};

/** How long a query outlives its last listener, as `SyncClient`'s `lingerMs`. */
const LINGER_MS = 1000;

/** How long a workspace's client stays after nothing uses it, before it is closed and dropped. */
export const IDLE_CLOSE_MS = 30_000;

export type EmberSyncClientOptions = {
  /**
   * Where Ember is served: its sockets are `<url>/ws`, e.g. `https://brigade.example.com/api/ember`. A function is
   * read when a workspace's client is first needed (a page's location, which a module loaded outside a page lacks).
   */
  url: string | (() => string);
  /**
   * A token for `workspaceId`'s shard (`POST /ember-token/:workspace`), or null when signed out. Called when a
   * socket opens and again before the token expires.
   */
  token(workspaceId: string): ReturnType<AuthTokenFetcher>;
  /** Who runs optimistic mutations, and with which role; the shard takes the actor from the token. */
  actor: Actor | (() => Actor);
  /** Stable per browser tab (Ember de-duplicates a re-sent mutation by it). Default: Ember's own. */
  clientId?: string;
  WebSocket?: WebSocketConstructor;
  connectivity?: ConnectivitySource | null;
  /** For ids. Default `crypto.getRandomValues`. */
  randomBytes?: RandomBytes;
  now?: () => number;
  /** Errors not tied to a call (a failed token refresh, a refused frame). Default `console.warn`. */
  onWarning?(message: string, detail?: unknown): void;
};

type Loaded = { args: { name: string; args: unknown }; value: QueryResult | undefined };

const LOADING: QueryState<never> = Object.freeze({
  rows: Object.freeze([]) as readonly never[],
  status: "loading",
  pending: false,
});

/** `QuerySnapshot` of `workspace:query` → Brigade's `QueryState`. */
function stateOf<R>(snapshot: QuerySnapshot<QueryResult<R>>): QueryState<R> {
  if (snapshot.status === "loading") return LOADING;
  if (snapshot.status === "error") {
    const error = snapshot.error;
    return {
      rows: [],
      status: "error",
      pending: false,
      error: { code: error?.code ?? "internal", message: error?.message ?? "The query failed" },
    };
  }
  const result = snapshot.value;
  if (!result) return LOADING;
  if (!result.ok) return { rows: [], status: "error", pending: false, error: result.error };
  return { rows: result.rows, status: "ready", pending: snapshot.optimistic };
}

/** An Ember error on a mutation → Brigade's codes. The client retries what the network loses, so this is rare. */
function failureOf(error: unknown): MutationOutcome {
  const code: SyncErrorCode =
    error instanceof EmberError
      ? error.code === "closed"
        ? "closed"
        : error.code === "unauthenticated" || error.code === "auth_expired"
          ? "forbidden"
          : error.code === "invalid_args" || error.code === "InvalidArgument"
            ? "invalid_args"
            : "internal"
      : "internal";
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code, message } };
}

const connection = (state: ShardConnectionState | undefined): ConnectionState =>
  state === undefined ? "idle" : state === "offline" ? "waiting" : state;

export class EmberSyncClient implements SyncClientLike {
  readonly #options: EmberSyncClientOptions;
  readonly #randomBytes: RandomBytes;
  readonly #now: () => number;
  /**
   * One Ember client per workspace: a token is for one workspace's shard. A workspace nothing uses (no query
   * listened to, no mutation waiting) is closed and dropped `IDLE_CLOSE_MS` later, so a workspace left behind keeps no
   * socket and asks for no token.
   */
  readonly #clients = new Map<string, EmberClient>();
  /** Listened queries and mutations in flight, per workspace. */
  readonly #uses = new Map<string, number>();
  /** The context of each pending mutation's first optimistic run, reused on every re-run. */
  readonly #contexts = new WeakMap<PendingMutationRecord, MutationContext>();
  /** `onConnectionChange` listeners per workspace, whichever of its clients is current. */
  readonly #connection = new Map<string, Set<() => void>>();
  #closed = false;

  constructor(options: EmberSyncClientOptions) {
    this.#options = options;
    this.#randomBytes =
      options.randomBytes ??
      ((length) => {
        if (!globals.crypto) throw new Error("No global crypto: pass `randomBytes`");
        return globals.crypto.getRandomValues(new Uint8Array(length));
      });
    this.#now = options.now ?? Date.now;
  }

  newId(prefix: string): string {
    return newId(prefix, Math.floor(this.#now()), this.#randomBytes);
  }

  /** A live query of the workspace `shard`. Cheap: nothing happens until the handle gets a listener. */
  query<N extends keyof Queries>(
    shard: string,
    name: N,
    args: QueryArgsOf<Queries[N]>,
  ): QueryHandle<QueryRowOf<Queries[N]>> {
    type R = QueryRowOf<Queries[N]>;
    type Watch = {
      subscribe(listener: () => void): () => void;
      getSnapshot(): QuerySnapshot<QueryResult<R>>;
    };
    const key = `${shard}\n${name}\n${JSON.stringify(args) ?? ""}`;
    if (this.#closed) {
      const closed: QueryState<R> = {
        rows: [],
        status: "error",
        pending: false,
        error: { code: "closed", message: "The sync client is closed" },
      };
      return {
        key,
        subscribe: () => () => {},
        getSnapshot: () => closed,
        getServerSnapshot: () => LOADING,
      };
    }
    // Bound to the workspace's current client: one dropped while idle is replaced when the handle is used again.
    let bound: { client: EmberClient; watch: Watch } | undefined;
    const watch = (): Watch => {
      const client = this.#client(shard);
      if (bound?.client !== client) {
        const w = client.watchQuery<never>(WORKSPACE_QUERY, { name, args } as never, {
          shard: emberShard(shard),
        }) as unknown as Watch;
        bound = { client, watch: w };
      }
      return bound.watch;
    };
    let last: QuerySnapshot<QueryResult<R>> | undefined;
    let state: QueryState<R> = LOADING;
    return {
      key,
      subscribe: (listener) => {
        // A handle from before `close()` opens nothing again.
        if (this.#closed) return () => {};
        const off = watch().subscribe(listener);
        this.#use(shard, 1);
        let done = false;
        const stop = () => {
          off();
          this.#use(shard, -1);
        };
        // Kept a little after the last listener, so a remount (Strict Mode, a quick navigation) keeps the rows.
        return () => {
          if (done) return;
          done = true;
          if (globals.setTimeout) globals.setTimeout(stop, LINGER_MS);
          else stop();
        };
      },
      getSnapshot: () => {
        if (this.#closed) return state;
        const snapshot = watch().getSnapshot();
        if (snapshot !== last) {
          last = snapshot;
          state = stateOf(snapshot);
        }
        return state;
      },
      getServerSnapshot: () => LOADING,
    };
  }

  /** Runs `name` on the workspace `shard`: applied optimistically at once, resolved with the shard's answer. */
  async mutate<N extends keyof Mutations>(
    shard: string,
    name: N,
    args: ArgsOf<Mutations[N]>,
  ): Promise<MutationOutcome> {
    if (this.#closed)
      return { ok: false, error: { code: "closed", message: "The sync client is closed" } };
    this.#use(shard, 1);
    try {
      const result = (await this.#client(shard).mutation(
        WORKSPACE_MUTATE,
        { name, args } as never,
        { shard: emberShard(shard), optimisticUpdate: this.#optimistic(shard) },
      )) as { ok: true } | { ok: false; error: SyncMutationError };
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    } catch (error) {
      return failureOf(error);
    } finally {
      this.#use(shard, -1);
    }
  }

  connectionState(shard: string): ConnectionState {
    const client = this.#clients.get(shard);
    return connection(client?.connectionState().shards[emberShard(shard)]);
  }

  /** Calls `listener` whenever `connectionState(shard)` changes. Listening does not open a socket. */
  onConnectionChange(shard: string, listener: () => void): () => void {
    let last = this.connectionState(shard);
    const check = () => {
      const next = this.connectionState(shard);
      if (next === last) return;
      last = next;
      listener();
    };
    let listeners = this.#connection.get(shard);
    if (!listeners) this.#connection.set(shard, (listeners = new Set()));
    listeners.add(check);
    return () => {
      listeners.delete(check);
    };
  }

  close(): void {
    this.#closed = true;
    for (const client of this.#clients.values()) client.close();
    this.#clients.clear();
    this.#uses.clear();
    this.#connection.clear();
  }

  #client(workspaceId: string): EmberClient {
    let client = this.#clients.get(workspaceId);
    if (client) return client;
    const o = this.#options;
    client = new EmberClient({
      url: typeof o.url === "function" ? o.url() : o.url,
      auth: () => o.token(workspaceId),
      defaultShard: emberShard(workspaceId),
      ...(o.clientId === undefined ? {} : { clientId: o.clientId }),
      ...(o.WebSocket === undefined ? {} : { WebSocket: o.WebSocket }),
      ...(o.connectivity === undefined ? {} : { connectivity: o.connectivity }),
      onError: (error) => this.#warn("Ember client error", error),
    });
    this.#clients.set(workspaceId, client);
    client.onConnectionStateChange(() => this.#connectionChanged(workspaceId));
    return client;
  }

  #connectionChanged(workspaceId: string): void {
    for (const check of this.#connection.get(workspaceId) ?? []) check();
  }

  /** Counts a use of `workspaceId`'s client; the last one ending schedules its close. */
  #use(workspaceId: string, delta: 1 | -1): void {
    const uses = (this.#uses.get(workspaceId) ?? 0) + delta;
    if (uses > 0) {
      this.#uses.set(workspaceId, uses);
      return;
    }
    this.#uses.delete(workspaceId);
    // Bound to the client idle now: a later one of the same workspace is never closed by this timer.
    const client = this.#clients.get(workspaceId);
    if (!client) return;
    const close = () => {
      if (this.#closed || this.#uses.has(workspaceId)) return;
      if (this.#clients.get(workspaceId) !== client) return;
      // A mutation still unconfirmed keeps the client; tried again once it may have drained.
      if (client.connectionState().pendingMutations > 0) {
        if (globals.setTimeout) globals.setTimeout(close, IDLE_CLOSE_MS);
        return;
      }
      this.#clients.delete(workspaceId);
      client.close();
      this.#connectionChanged(workspaceId);
    };
    if (globals.setTimeout) globals.setTimeout(close, IDLE_CLOSE_MS);
    else close();
  }

  /**
   * The optimistic run of a workspace mutation: Brigade's `apply` over the rows the loaded queries hold, then each
   * loaded query evaluated again over the result. A mutation that does not apply here (a row it needs is not
   * loaded, a rule refuses it) changes nothing until the shard answers, as with `SyncClient`.
   */
  #optimistic(workspaceId: string): OptimisticUpdate<{ name: string; args: unknown }> {
    const shard = { shard: emberShard(workspaceId) };
    return (store, { name, args }, record) => {
      const loaded = store.getAllQueries(WORKSPACE_QUERY, shard) as Loaded[];
      const seed: { [T in keyof BrigadeTables]?: BrigadeTables[T][] } = {};
      const seen = new Set<string>();
      const live: { query: AnyQuery; loaded: Loaded }[] = [];
      for (const entry of loaded) {
        const query = lookup(brigadeQueries, entry.args.name);
        if (!query || !entry.value?.ok) continue;
        live.push({ query, loaded: entry });
        const table = query.table as keyof BrigadeTables;
        for (const row of entry.value.rows as Row[]) {
          const key = `${String(table)}/${row.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          ((seed[table] ??= []) as Row[]).push(row);
        }
      }
      const view = createMemoryStore<BrigadeTables>(seed);
      const ctx = this.#context(record);
      const out = runMutation(brigadeMutations, name, args, view, ctx, {
        onError: (error, mutation) => this.#warn(`Optimistic ${mutation} threw`, error),
      });
      if (!out.ok) return;
      for (const { query, loaded: entry } of live) {
        try {
          const rows = evaluateQuery(query, entry.args.args as never, view);
          store.setQuery(
            WORKSPACE_QUERY,
            entry.args,
            { ok: true, rows } satisfies QueryResult,
            shard,
          );
        } catch (error) {
          this.#warn(`Query ${entry.args.name} threw`, error);
        }
      }
    };
  }

  #context(record: PendingMutationRecord): MutationContext {
    let ctx = this.#contexts.get(record);
    if (!ctx) {
      const actor = this.#options.actor;
      ctx = {
        actor: typeof actor === "function" ? actor() : actor,
        now: Math.floor(record.createdAt),
        server: false,
      };
      this.#contexts.set(record, ctx);
    }
    return ctx;
  }

  #warn(message: string, detail?: unknown): void {
    try {
      if (this.#options.onWarning) this.#options.onWarning(message, detail);
      else globals.console?.warn(message, detail);
    } catch {
      // A failing logger must not break the client.
    }
  }
}

export function createEmberSyncClient(options: EmberSyncClientOptions): EmberSyncClient {
  return new EmberSyncClient(options);
}
