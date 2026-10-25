// The framework-agnostic sync client (RFC 0004): a pool of one socket per shard, the server's confirmed rows per
// shard, and the optimistic view (confirmed rows + pending mutations re-applied in order with their original
// context). Web and mobile use it through the React hooks in `react.ts`. No DOM or Node APIs: the socket, the
// timers, the clock and randomness are injected or looked up on `globalThis`.

import {
  createMemoryStore,
  evaluateQuery,
  lookup,
  mutations as brigadeMutations,
  newId,
  queries as brigadeQueries,
  runMutation,
  type Actor,
  type AnyMutation,
  type AnyQuery,
  type ArgsOf,
  type BrigadeTables,
  type Issue,
  type MemoryStore,
  type MutationContext,
  type MutationErrorCode,
  type QueryArgsOf,
  type QueryRowOf,
  type RandomBytes,
  type Store,
} from "@freecorps/brigade-schema";
import {
  encode,
  MAX_CLIENT_MESSAGE_LENGTH,
  MUTATION_ERROR_CODES,
  MUTATION_RETENTION_MS,
  parseServerMessage,
  PROTOCOL_VERSION,
  TOKEN,
  type ClientMessage,
  type ErrorMessage,
  type PatchMessage,
  type SnapshotMessage,
  type SubscriptionChanges,
  type WireRow,
} from "./protocol.ts";

// ------------------------------------------------------------------------------------------------- injection

/**
 * The part of a WebSocket the client uses. The global `WebSocket` of browsers and React Native fits it as is.
 * Handlers take `never` so a DOM `WebSocket` (whose handlers take DOM events) is assignable without casts; the
 * client reads only `event.data` from messages.
 */
export type SyncSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: never) => void) | null;
  onmessage: ((event: never) => void) | null;
  onclose: ((event: never) => void) | null;
  onerror: ((event: never) => void) | null;
};

/** Opens a socket to `url`. May throw; the client then retries with backoff. */
export type Transport = (url: string) => SyncSocket;

export type Timers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type Backoff = {
  /** First retry delay cap, in ms. Default 500. */
  initialMs?: number;
  /** Largest delay cap, in ms. Default 30 000. */
  maxMs?: number;
  /** Cap growth per failed attempt. Default 2. */
  factor?: number;
};

type QueryRegistry = { readonly [name: string]: AnyQuery };
type MutationRegistry = { readonly [name: string]: AnyMutation };

/** Most unconfirmed mutations a client holds (all shards); beyond it `mutate` fails with `too_many_pending`. */
export const MAX_PENDING_MUTATIONS = 500;

export type SyncClientOptions<Q extends QueryRegistry, M extends MutationRegistry> = {
  /** The socket URL of a shard, e.g. `(shard) => \`wss://api.example.com/sync/${shard}\``. */
  url(shard: string): string;
  /**
   * Who runs optimistic mutations, and with which role. Only the optimistic run uses it: the server takes the
   * actor from the authenticated socket.
   */
  actor: Actor | (() => Actor);
  /** Default: the global `WebSocket`. */
  transport?: Transport;
  /** Default: the registries of `@freecorps/brigade-schema`. */
  queries?: Q;
  mutations?: M;
  /** Stable per app install or browser tab; 1 to 64 of `A-Z a-z 0-9 _ : -`. Default: a new `cli_` id. */
  clientId?: string;
  /** Epoch milliseconds. Default `Date.now`. */
  now?: () => number;
  /** In [0, 1), for backoff jitter. Default `Math.random`. */
  random?: () => number;
  /** For ids. Default `crypto.getRandomValues`; Hermes has none, so React Native passes expo-crypto's. */
  randomBytes?: RandomBytes;
  /** Default: the global `setTimeout` / `clearTimeout`. */
  timers?: Timers;
  backoff?: Backoff;
  /** How long a shard socket stays open after its last subscription and mutation are gone. Default 5 000 ms. */
  idleCloseMs?: number;
  /**
   * How long a subscription outlives its last listener, so a component that unmounts and mounts again (React
   * Strict Mode, a quick navigation) keeps it instead of re-subscribing. Default 1 000 ms.
   */
  lingerMs?: number;
  /** Default `MAX_PENDING_MUTATIONS`. */
  maxPending?: number;
  /** Malformed or stale frames, socket failures, listener errors. Default `console.warn` when there is one. */
  onWarning?(message: string, detail?: unknown): void;
};

// ------------------------------------------------------------------------------------------------- results

export type QueryStatus = "loading" | "ready" | "error";

export type QueryState<R> = {
  /** The optimistic view: the server's rows with pending mutations applied. */
  rows: readonly R[];
  /** `loading` until the server's first snapshot; `error` if the query was refused or the client closed. */
  status: QueryStatus;
  /** True while `rows` differ from the server's confirmed result because of mutations it has not confirmed. */
  pending: boolean;
  error?: { code: string; message: string };
};

/**
 * Why a mutation failed: the server's codes, plus the client's own. `expired`: still unconfirmed when the client
 * reconnected more than `MUTATION_RETENTION_MS` after creating it, so it was not re-sent. `too_many_pending`: over
 * `maxPending`. `closed`: the client was closed first.
 */
export type SyncErrorCode = MutationErrorCode | "expired" | "too_many_pending" | "closed";

export type SyncMutationError = { code: SyncErrorCode; message: string; issues?: Issue[] };

/** The server's answer to a mutation; `ok: false` carries a typed error. */
export type MutationOutcome =
  | { ok: true; version: number }
  | { ok: false; error: SyncMutationError };

/** A query bound to a shard and args, shaped for `useSyncExternalStore`. */
export type QueryHandle<R> = {
  readonly key: string;
  /** Starts the subscription with the first listener; ends it `lingerMs` after the last one leaves. */
  subscribe: (listener: () => void) => () => void;
  /** The same object until the state changes. */
  getSnapshot: () => QueryState<R>;
  /** For server rendering and hydration: always the `loading` state, whatever the client holds. */
  getServerSnapshot: () => QueryState<R>;
};

export type ConnectionState = "idle" | "connecting" | "open" | "waiting";

const LOADING: QueryState<never> = Object.freeze({
  rows: Object.freeze([]) as readonly never[],
  status: "loading",
  pending: false,
});

const CLOSED_ERROR = Object.freeze({ code: "closed", message: "The sync client is closed" });

const CLOSED: QueryState<never> = Object.freeze({
  rows: Object.freeze([]) as readonly never[],
  status: "error",
  pending: false,
  error: CLOSED_ERROR,
});

/** The longest delay `setTimeout` takes (a signed 32-bit number of ms). */
const MAX_TIMER_MS = 2_147_483_647;

/** Room left in a `subscribe` frame for the `version` and `epoch` of a later resume. */
const RESUME_ROOM = 128;

// ------------------------------------------------------------------------------------------------- internals

type Tables = BrigadeTables;
type View = Store<Tables>;

type Live = {
  subId: string;
  shard: Shard;
  query: AnyQuery;
  name: string;
  /** Validated (a fresh plain copy): evaluated locally and sent; the server validates them again. */
  args: unknown;
  sub: Subscription;
  /** Ids the server says are in the result. */
  ids: Set<string>;
  /** Last shard version received for it, and the epoch it belongs to; sent back to resume. */
  version?: number;
  epoch?: string;
  /**
   * Data for it arrived on the current socket: frames that skip it advance its version, and older data is stale.
   * Until then it accepts any snapshot, and it blocks dropping confirmed mutations.
   */
  synced: boolean;
  status: QueryStatus;
  error?: { code: string; message: string };
};

type Subscription = {
  key: string;
  listeners: Set<() => void>;
  state: QueryState<unknown>;
  lingerTimer?: unknown;
  /** Absent when the query was refused locally (unknown name, invalid args): nothing goes to the server. */
  live?: Live;
};

type PendingMutation = {
  mutationId: string;
  name: string;
  args: unknown;
  /** The encoded `mutate` frame, re-sent as is. */
  frame: string;
  /** The context of the first optimistic run, reused on every re-apply; `ctx.now` is its creation time. */
  ctx: MutationContext;
  resolve(outcome: MutationOutcome): void;
  /** Set by an ok result: dropped once every subscription of the shard is in sync at this version or later. */
  confirmedAt?: number;
  /** The socket (`Shard.connection`) the ok result arrived on. */
  confirmedOn?: number;
};

type Shard = {
  id: string;
  confirmed: MemoryStore<Tables>;
  /** `${table}/${id}` → subIds holding the row; a row nobody holds leaves the store. */
  owners: Map<string, Set<string>>;
  subs: Map<string, Live>;
  pending: PendingMutation[];
  /** The epoch of the latest data received; versions of other epochs do not compare. */
  epoch?: string;
  socket: SyncSocket | null;
  open: boolean;
  attempt: number;
  /** The current socket delivered data and did not end with a `protocol` error: its close resets `attempt`. */
  healthy: boolean;
  /** Counts the shard's sockets; the current one is `connection`. */
  connection: number;
  retryTimer?: unknown;
  idleTimer?: unknown;
  /** Fires when the oldest unconfirmed mutation passes the retention window. */
  expiryTimer?: unknown;
};

const globals = globalThis as unknown as {
  WebSocket?: new (url: string) => SyncSocket;
  crypto?: { getRandomValues(array: Uint8Array): Uint8Array };
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  console?: { warn(...args: unknown[]): void };
};

function defaultTransport(url: string): SyncSocket {
  if (!globals.WebSocket) throw new Error("No global WebSocket: pass `transport`");
  return new globals.WebSocket(url);
}

function defaultTimers(): Timers {
  const set = globals.setTimeout;
  const clear = globals.clearTimeout;
  if (!set || !clear) throw new Error("No global setTimeout: pass `timers`");
  return {
    setTimeout: (callback, ms) => set(callback, ms),
    clearTimeout: (handle) => clear(handle),
  };
}

function defaultRandomBytes(): RandomBytes {
  const crypto = globals.crypto;
  if (!crypto) throw new Error("No global crypto.getRandomValues: pass `randomBytes`");
  return (length) => crypto.getRandomValues(new Uint8Array(length));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const failure = (code: SyncErrorCode, message: string): MutationOutcome => ({
  ok: false,
  error: { code, message },
});

/** Delay before retry `attempt` (0-based): a cap that grows exponentially, then "equal jitter" within it. */
export function backoffDelay(attempt: number, random: number, backoff: Backoff = {}): number {
  const initial = backoff.initialMs ?? 500;
  const max = backoff.maxMs ?? 30_000;
  const factor = backoff.factor ?? 2;
  const cap = Math.min(max, initial * factor ** Math.min(attempt, 64));
  return Math.round(cap / 2 + (random * cap) / 2);
}

// ------------------------------------------------------------------------------------------------- client

export class SyncClient<
  Q extends QueryRegistry = typeof brigadeQueries,
  M extends MutationRegistry = typeof brigadeMutations,
> {
  readonly clientId: string;
  private readonly options: SyncClientOptions<Q, M>;
  private readonly queries: QueryRegistry;
  private readonly mutations: MutationRegistry;
  private readonly transport: Transport;
  private readonly timers: Timers;
  private readonly randomBytes: RandomBytes;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly shards = new Map<string, Shard>();
  private readonly subscriptions = new Map<string, Subscription>();
  /** Per shard: the listeners of `onConnectionChange` and the state they last saw. */
  private readonly connectionListeners = new Map<
    string,
    { listeners: Set<() => void>; last: ConnectionState }
  >();
  private nextSubId = 0;
  private closed = false;

  /** Throws only for a bad configuration (an invalid `clientId`, no global to fall back on). */
  constructor(options: SyncClientOptions<Q, M>) {
    if (options.clientId !== undefined && !TOKEN.test(options.clientId)) {
      throw new RangeError("clientId must be 1 to 64 characters of A-Z a-z 0-9 _ : -");
    }
    this.options = options;
    this.queries = options.queries ?? brigadeQueries;
    this.mutations = options.mutations ?? brigadeMutations;
    this.transport = options.transport ?? defaultTransport;
    this.timers = options.timers ?? defaultTimers();
    this.randomBytes = options.randomBytes ?? defaultRandomBytes();
    this.clock = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
    this.clientId = options.clientId ?? this.newId("cli");
  }

  /** A new `<prefix>_<ULID>` from the client's clock and randomness, e.g. `client.newId("inc")` for a declare. */
  newId(prefix: string): string {
    return newId(prefix, this.now(), this.randomBytes);
  }

  /** A live query on `shard`. Cheap: nothing happens until the handle gets a listener. */
  query<N extends keyof Q & string>(
    shard: string,
    name: N,
    args: QueryArgsOf<Q[N]>,
  ): QueryHandle<QueryRowOf<Q[N]>> {
    const key = `${shard}\n${name}\n${JSON.stringify(args) ?? ""}`;
    return {
      key,
      subscribe: (listener) => this.listen(key, shard, name, args, listener),
      getServerSnapshot: () => LOADING,
      getSnapshot: () =>
        (this.subscriptions.get(key)?.state ?? (this.closed ? CLOSED : LOADING)) as QueryState<
          QueryRowOf<Q[N]>
        >,
    };
  }

  /**
   * Applies the mutation optimistically on `shard` and sends it. Never throws or rejects: resolves with the
   * server's result, or with a client error (`invalid_args` for args that are not JSON or make the frame too
   * large, `too_many_pending`, `closed`, `expired`, `internal`). Until the server answers, the mutation stays
   * pending: re-applied on every server change and re-sent with the same id after a reconnect.
   */
  mutate<N extends keyof M & string>(
    shard: string,
    name: N,
    args: ArgsOf<M[N]>,
  ): Promise<MutationOutcome> {
    try {
      return this.enqueue(shard, name, args);
    } catch (error) {
      // A throwing actor callback, clock or random source.
      this.warn(`Could not run ${String(name).slice(0, 64)}`, error);
      return Promise.resolve(failure("internal", "The mutation could not be started"));
    }
  }

  private enqueue(shardId: string, name: string, args: unknown): Promise<MutationOutcome> {
    if (this.closed) return Promise.resolve(failure("closed", "The sync client is closed"));
    let unconfirmed = 0;
    for (const shard of this.shards.values()) unconfirmed += this.unconfirmed(shard);
    if (unconfirmed >= (this.options.maxPending ?? MAX_PENDING_MUTATIONS)) {
      return Promise.resolve(
        failure("too_many_pending", "Too many changes are waiting to be sent"),
      );
    }
    const now = this.now();
    const actor = this.options.actor;
    const ctx: MutationContext = {
      actor: typeof actor === "function" ? actor() : actor,
      now,
      server: false,
    };
    const mutationId = newId("mut", now, this.randomBytes);
    // Encode first: what the server will see, and the size it will check. The optimistic run uses the same copy.
    let frame: string;
    try {
      frame = encode({ type: "mutate", mutationId, name, args });
    } catch {
      return Promise.resolve(failure("invalid_args", "Arguments must be JSON"));
    }
    if (frame.length > MAX_CLIENT_MESSAGE_LENGTH) {
      return Promise.resolve(failure("invalid_args", "The change is too large to send"));
    }
    const wireArgs = (JSON.parse(frame) as { args?: unknown }).args;
    const shard = this.shard(shardId);
    return new Promise<MutationOutcome>((resolve) => {
      shard.pending.push({ mutationId, name, args: wireArgs, frame, ctx, resolve });
      this.armExpiry(shard);
      this.retain(shard);
      this.sendFrame(shard, frame);
      this.refresh(shard);
    });
  }

  /** The socket state of a shard, for an offline indicator. */
  connectionState(shard: string): ConnectionState {
    const target = this.shards.get(shard);
    if (!target) return "idle";
    if (target.open) return "open";
    if (target.socket) return "connecting";
    return target.retryTimer !== undefined ? "waiting" : "idle";
  }

  /**
   * Calls `listener` whenever `connectionState(shard)` changes; returns the unsubscribe. With `connectionState`
   * as the snapshot it fits `useSyncExternalStore`. Listening does not open a socket.
   */
  onConnectionChange(shard: string, listener: () => void): () => void {
    let entry = this.connectionListeners.get(shard);
    if (!entry) {
      entry = { listeners: new Set(), last: this.connectionState(shard) };
      this.connectionListeners.set(shard, entry);
    }
    // A wrapper per call, so the same function listening twice unsubscribes once each.
    const wrapped = () => listener();
    entry.listeners.add(wrapped);
    const current = entry;
    return () => {
      current.listeners.delete(wrapped);
      if (current.listeners.size === 0 && this.connectionListeners.get(shard) === current) {
        this.connectionListeners.delete(shard);
      }
    };
  }

  /** Notifies `onConnectionChange` listeners of `shard` if its state moved since they last heard. */
  private connectionChanged(shard: string): void {
    const entry = this.connectionListeners.get(shard);
    if (!entry) return;
    const next = this.connectionState(shard);
    if (next === entry.last) return;
    entry.last = next;
    for (const listener of entry.listeners) {
      try {
        listener();
      } catch (error) {
        this.warn("A connection listener threw", error);
      }
    }
  }

  /**
   * Closes every socket. Pending mutations resolve with `closed`; every subscription gets a final `error` state
   * (`closed`, with the server's last rows) and then stops updating.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const shard of this.shards.values()) {
      const pending = shard.pending;
      shard.pending = [];
      for (const mutation of pending) {
        if (mutation.confirmedAt === undefined) {
          mutation.resolve(failure("closed", "The sync client is closed"));
        }
      }
      for (const live of shard.subs.values()) {
        live.status = "error";
        live.error = CLOSED_ERROR;
      }
      this.refresh(shard);
      this.disconnect(shard);
    }
    this.shards.clear();
    for (const shard of this.connectionListeners.keys()) this.connectionChanged(shard);
    this.connectionListeners.clear();
    // Handles keep returning their final state; nothing updates or notifies them any more.
    for (const sub of this.subscriptions.values()) {
      if (sub.lingerTimer !== undefined) this.timers.clearTimeout(sub.lingerTimer);
      sub.lingerTimer = undefined;
      sub.listeners.clear();
    }
  }

  // ----------------------------------------------------------------------------------------- subscriptions

  private listen(
    key: string,
    shard: string,
    name: string,
    args: unknown,
    listener: () => void,
  ): () => void {
    if (this.closed) return () => {};
    let sub = this.subscriptions.get(key);
    if (!sub) {
      sub = this.open(key, shard, name, args);
      this.subscriptions.set(key, sub);
    }
    if (sub.lingerTimer !== undefined) {
      this.timers.clearTimeout(sub.lingerTimer);
      sub.lingerTimer = undefined;
    }
    sub.listeners.add(listener);
    if (sub.live?.status === "error") this.resubscribe(sub.live);
    const current = sub;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.closed) return; // Nothing to end: close() already did.
      current.listeners.delete(listener);
      if (current.listeners.size > 0 || this.subscriptions.get(key) !== current) return;
      current.lingerTimer = this.timers.setTimeout(() => {
        current.lingerTimer = undefined;
        if (current.listeners.size === 0) this.end(current);
      }, this.options.lingerMs ?? 1000);
    };
  }

  private open(key: string, shardId: string, name: string, rawArgs: unknown): Subscription {
    const query = lookup(this.queries, name);
    if (!query) {
      return refused(key, "unknown_query", `Unknown query ${name.slice(0, 64)}`);
    }
    let parsed;
    try {
      parsed = query.args(rawArgs);
    } catch {
      return refused(key, "invalid_args", `Invalid arguments for ${query.name}`);
    }
    if (!parsed.ok) return refused(key, "invalid_args", `Invalid arguments for ${query.name}`);
    const subId = `s${(this.nextSubId++).toString(36)}`;
    const frame = encode({ type: "subscribe", subId, query: name, args: parsed.value });
    if (frame.length + RESUME_ROOM > MAX_CLIENT_MESSAGE_LENGTH) {
      return refused(key, "invalid_args", "The query arguments are too large to send");
    }
    const shard = this.shard(shardId);
    const sub: Subscription = { key, listeners: new Set(), state: LOADING };
    const live: Live = {
      subId,
      shard,
      query,
      name,
      args: parsed.value,
      sub,
      ids: new Set(),
      synced: false,
      status: "loading",
    };
    sub.live = live;
    shard.subs.set(live.subId, live);
    this.retain(shard);
    this.sendFrame(shard, frame);
    this.refresh(shard, live);
    return sub;
  }

  private end(sub: Subscription): void {
    this.subscriptions.delete(sub.key);
    const live = sub.live;
    if (!live) return;
    const shard = live.shard;
    shard.subs.delete(live.subId);
    this.send(shard, { type: "unsubscribe", subId: live.subId });
    for (const id of live.ids) this.disown(shard, live.query.table, id, live.subId);
    this.settle(shard);
    this.refresh(shard);
    this.release(shard);
  }

  // ----------------------------------------------------------------------------------------- connections

  private shard(id: string): Shard {
    let shard = this.shards.get(id);
    if (!shard) {
      shard = {
        id,
        confirmed: createMemoryStore<Tables>(),
        owners: new Map(),
        subs: new Map(),
        pending: [],
        socket: null,
        open: false,
        attempt: 0,
        healthy: false,
        connection: 0,
      };
      this.shards.set(id, shard);
    }
    return shard;
  }

  private unconfirmed(shard: Shard): number {
    return shard.pending.filter((m) => m.confirmedAt === undefined).length;
  }

  /** Subscriptions plus unconfirmed mutations: what keeps a shard socket open. */
  private refs(shard: Shard): number {
    return shard.subs.size + this.unconfirmed(shard);
  }

  private retain(shard: Shard): void {
    if (shard.idleTimer !== undefined) {
      this.timers.clearTimeout(shard.idleTimer);
      shard.idleTimer = undefined;
    }
    if (!shard.socket && shard.retryTimer === undefined) this.connect(shard);
  }

  private release(shard: Shard): void {
    if (this.refs(shard) > 0 || shard.idleTimer !== undefined) return;
    shard.idleTimer = this.timers.setTimeout(() => {
      shard.idleTimer = undefined;
      if (this.refs(shard) > 0) return;
      this.disconnect(shard);
      // Nothing left to show: forget the shard; a later subscription starts from a snapshot.
      this.shards.delete(shard.id);
      this.connectionChanged(shard.id);
    }, this.options.idleCloseMs ?? 5000);
  }

  private connect(shard: Shard): void {
    let socket: SyncSocket;
    try {
      socket = this.transport(this.options.url(shard.id));
    } catch (error) {
      this.warn(`Could not open the socket for ${shard.id}`, error);
      this.retry(shard);
      return;
    }
    shard.socket = socket;
    shard.open = false;
    shard.healthy = false;
    shard.connection++;
    for (const live of shard.subs.values()) live.synced = false;
    socket.onopen = () => {
      if (shard.socket !== socket) return;
      shard.open = true;
      this.connectionChanged(shard.id);
      this.greet(shard);
    };
    socket.onmessage = ((event: { data: unknown }) => {
      // Frames from a socket the client already left are ignored.
      if (shard.socket !== socket) return;
      this.receive(shard, event.data);
    }) as (event: never) => void;
    socket.onclose = () => {
      if (shard.socket !== socket) return;
      shard.socket = null;
      shard.open = false;
      // A connection that delivered data starts the backoff over.
      if (shard.healthy) shard.attempt = 0;
      shard.healthy = false;
      if (!this.closed && this.refs(shard) > 0) this.retry(shard);
      this.connectionChanged(shard.id);
    };
    // A close always follows an error; reconnecting is handled there.
    socket.onerror = () => {};
    // Only now: a listener that reacts by closing the client finds the socket fully wired.
    this.connectionChanged(shard.id);
  }

  private retry(shard: Shard): void {
    if (this.closed || shard.retryTimer !== undefined) return;
    this.expire(shard);
    if (this.refs(shard) === 0) return;
    const delay = backoffDelay(shard.attempt++, this.random(), this.options.backoff);
    shard.retryTimer = this.timers.setTimeout(() => {
      shard.retryTimer = undefined;
      if (!this.closed && this.refs(shard) > 0 && !shard.socket) this.connect(shard);
      this.connectionChanged(shard.id);
    }, delay);
    this.connectionChanged(shard.id);
  }

  /**
   * Closes the shard's socket, if any, without reconnecting. It does not notify connection listeners: each caller
   * does once it has settled the next state (a retry, or idle), so they never see a passing `idle`.
   */
  private closeSocket(shard: Shard, reason: string): void {
    const socket = shard.socket;
    shard.socket = null;
    shard.open = false;
    if (!socket) return;
    try {
      socket.close(1000, reason);
    } catch (error) {
      this.warn(`Could not close the socket for ${shard.id}`, error);
    }
  }

  private disconnect(shard: Shard): void {
    for (const timer of [shard.idleTimer, shard.retryTimer, shard.expiryTimer]) {
      if (timer !== undefined) this.timers.clearTimeout(timer);
    }
    shard.idleTimer = shard.retryTimer = shard.expiryTimer = undefined;
    this.closeSocket(shard, "idle");
    this.connectionChanged(shard.id);
  }

  /**
   * On every open: fail mutations too old to re-send, then `hello`, unconfirmed mutations in order, and every
   * subscription with the version it holds (see protocol.ts).
   */
  private greet(shard: Shard): void {
    this.expire(shard);
    this.send(shard, { type: "hello", protocol: PROTOCOL_VERSION, clientId: this.clientId });
    for (const mutation of shard.pending) {
      if (mutation.confirmedAt === undefined) this.sendFrame(shard, mutation.frame);
    }
    // A refused subscription is not asked for again until it gets a new listener.
    for (const live of shard.subs.values()) {
      if (live.status !== "error") this.subscribe(shard, live);
    }
  }

  private subscribe(shard: Shard, live: Live): void {
    const message: ClientMessage = {
      type: "subscribe",
      subId: live.subId,
      query: live.name,
      args: live.args,
    };
    if (live.version !== undefined && live.epoch !== undefined) {
      message.version = live.version;
      message.epoch = live.epoch;
    }
    this.send(shard, message);
  }

  /** A refused subscription that gets a new listener asks the server again, from a snapshot. */
  private resubscribe(live: Live): void {
    live.status = "loading";
    live.error = undefined;
    this.subscribe(live.shard, live);
    this.refresh(live.shard);
  }

  /**
   * Fails every unconfirmed mutation created more than `MUTATION_RETENTION_MS` ago with `expired`: the server may
   * no longer recognise a retry. Runs on (re)connect, before each retry and from a timer, so it needs no socket.
   */
  private expire(shard: Shard): void {
    const now = this.now();
    const expired = shard.pending.filter(
      (m) => m.confirmedAt === undefined && now - m.ctx.now > MUTATION_RETENTION_MS,
    );
    if (expired.length > 0) {
      shard.pending = shard.pending.filter((m) => !expired.includes(m));
      for (const mutation of expired) {
        mutation.resolve(failure("expired", "The change waited too long to be sent"));
      }
      this.refresh(shard);
    }
    this.armExpiry(shard);
    if (expired.length > 0) this.release(shard);
  }

  /** Schedules `expire` for the moment the oldest unconfirmed mutation leaves the retention window. */
  private armExpiry(shard: Shard): void {
    if (shard.expiryTimer !== undefined) this.timers.clearTimeout(shard.expiryTimer);
    shard.expiryTimer = undefined;
    let oldest: number | undefined;
    for (const m of shard.pending) {
      if (m.confirmedAt === undefined && (oldest === undefined || m.ctx.now < oldest)) {
        oldest = m.ctx.now;
      }
    }
    if (oldest === undefined || this.closed) return;
    // setTimeout holds at most a signed 32-bit delay; a longer one fires at once. Firing early only re-arms.
    const delay = Math.min(
      MAX_TIMER_MS,
      Math.max(0, oldest + MUTATION_RETENTION_MS + 1 - this.now()),
    );
    shard.expiryTimer = this.timers.setTimeout(() => {
      shard.expiryTimer = undefined;
      if (!this.closed) this.expire(shard);
    }, delay);
  }

  private send(shard: Shard, message: ClientMessage): void {
    this.sendFrame(shard, encode(message));
  }

  private sendFrame(shard: Shard, frame: string): void {
    if (!shard.open || !shard.socket) return; // Everything is sent again on open.
    try {
      shard.socket.send(frame);
    } catch (error) {
      // The frame is lost: drop the socket and reconnect, and the next `greet` replays everything.
      this.warn(`Could not send to ${shard.id}`, error);
      this.closeSocket(shard, "send failed");
      if (!this.closed && this.refs(shard) > 0) this.retry(shard);
      this.connectionChanged(shard.id);
    }
  }

  // ----------------------------------------------------------------------------------------- server messages

  private receive(shard: Shard, data: unknown): void {
    const parsed = parseServerMessage(data);
    if (!parsed.ok) {
      this.warn(`Ignored a malformed frame from ${shard.id}: ${parsed.reason}`);
      return;
    }
    const message = parsed.message;
    switch (message.type) {
      case "snapshot":
        shard.healthy = true; // Data flows: when this connection ends, the backoff starts over.
        return this.snapshot(shard, message);
      case "patch":
        shard.healthy = true;
        return this.patch(shard, message);
      case "mutationResult": {
        shard.healthy = true;
        const index = shard.pending.findIndex((m) => m.mutationId === message.mutationId);
        const mutation = shard.pending[index];
        if (!mutation || mutation.confirmedAt !== undefined) return; // A duplicate result.
        if (message.ok) {
          mutation.confirmedAt = message.version;
          mutation.confirmedOn = shard.connection;
          mutation.resolve({ ok: true, version: message.version });
          this.settle(shard);
        } else {
          shard.pending.splice(index, 1);
          mutation.resolve({ ok: false, error: message.error });
        }
        this.armExpiry(shard);
        this.refresh(shard);
        this.release(shard);
        return;
      }
      case "error":
        return this.error(shard, message);
    }
  }

  private snapshot(shard: Shard, message: SnapshotMessage): void {
    this.seeEpoch(shard, message.epoch);
    const live = shard.subs.get(message.subId);
    if (!live) return; // Unsubscribed meanwhile.
    // A snapshot replaces the data whatever its version (a restored shard may be behind), except that on the
    // current socket data never goes back.
    if (live.synced && this.stale(shard, live, message.version)) return;
    const table = live.query.table;
    const next = new Set(message.rows.map((row) => row.id));
    for (const id of live.ids) {
      if (!next.has(id)) this.disown(shard, table, id, live.subId);
    }
    for (const row of message.rows) this.own(shard, table, row, live);
    this.received(live, message.epoch, message.version);
    this.answered(shard, message.version);
    this.advance(shard, message.epoch, message.version, live.subId);
    this.settle(shard);
    this.refresh(shard);
  }

  /**
   * A subscribe answer at `version` is the shard's state now. A mutation confirmed at a later version cannot be in
   * it: the shard went back (restored from a backup) and lost it, and that version will be reused for other
   * changes. Drop it rather than wait for, or re-apply over, data that will never hold it. This needs no socket
   * check: the shard never answers on a socket below a version it already confirmed there.
   */
  private answered(shard: Shard, version: number): void {
    shard.pending = shard.pending.filter(
      (m) => m.confirmedAt === undefined || m.confirmedAt <= version,
    );
  }

  /**
   * Any data frame at `version` means the socket's state is at `version`: the shard sent every earlier change
   * already, so every other subscription in sync on this socket (same epoch) holds that version too. One not yet
   * in sync (its answer still on the way) keeps the version it really holds.
   */
  private advance(shard: Shard, epoch: string, version: number, ...skip: string[]): void {
    for (const live of shard.subs.values()) {
      if (
        !skip.includes(live.subId) &&
        live.synced &&
        live.status === "ready" &&
        live.epoch === epoch
      ) {
        live.version = Math.max(live.version ?? 0, version);
      }
    }
  }

  /** One version's changes for every touched subscription: applied together, then settled once. */
  private patch(shard: Shard, message: PatchMessage): void {
    // Every patch, an empty one included: the epoch moves even when no subscription is in the frame.
    this.seeEpoch(shard, message.epoch);
    const touched = new Set<string>();
    let answer = false;
    for (const [subId, changes] of Object.entries(message.subs) as [
      string,
      SubscriptionChanges,
    ][]) {
      const live = shard.subs.get(subId);
      if (!live) continue;
      if (live.epoch !== undefined && live.epoch !== message.epoch) {
        // Changes only apply to data of the same epoch; the shard answers a resume across epochs with a snapshot.
        this.warn(`Ignored a patch for ${subId} on ${shard.id} from another epoch`);
        continue;
      }
      if (live.synced && this.stale(shard, live, message.version)) continue;
      const table = live.query.table;
      // A subscription not yet in sync on this socket is getting its resume answer.
      if (!live.synced) answer = true;
      for (const id of changes.deletes) this.disown(shard, table, id, live.subId);
      for (const row of changes.upserts) this.own(shard, table, row, live);
      this.received(live, message.epoch, message.version);
      touched.add(subId);
    }
    if (answer) this.answered(shard, message.version);
    // Subscriptions the version did not touch hold its state too (including after an empty patch).
    this.advance(shard, message.epoch, message.version, ...touched);
    this.settle(shard);
    this.refresh(shard);
  }

  /** Data older than what a subscription holds cannot apply on top of it; logged and skipped. */
  private stale(shard: Shard, live: Live, version: number): boolean {
    if (live.version === undefined || version >= live.version) return false;
    this.warn(`Ignored stale data for ${live.subId} on ${shard.id}: ${version} < ${live.version}`);
    return true;
  }

  /**
   * Notes the shard's epoch from a data frame. On a new epoch (the storage was restored or re-created), versions
   * confirmed on earlier sockets belong to the old one and no longer compare, and the new data is the truth
   * whether or not it holds them. Mutations confirmed on this socket ran in the new epoch and wait as usual.
   */
  private seeEpoch(shard: Shard, epoch: string): void {
    if (shard.epoch !== undefined && shard.epoch !== epoch) {
      shard.pending = shard.pending.filter(
        (m) => m.confirmedAt === undefined || m.confirmedOn === shard.connection,
      );
    }
    shard.epoch = epoch;
  }

  private received(live: Live, epoch: string, version: number): void {
    live.epoch = epoch;
    live.version = version;
    live.synced = true;
    live.status = "ready";
    live.error = undefined;
  }

  private error(shard: Shard, message: ErrorMessage): void {
    let handled = false;
    if (message.subId !== undefined) {
      const live = shard.subs.get(message.subId);
      if (live) {
        // It gets no data any more: let go of its rows (others may still hold them) and its resume point.
        for (const id of live.ids) this.disown(shard, live.query.table, id, live.subId);
        live.version = undefined;
        live.epoch = undefined;
        live.synced = false;
        live.status = "error";
        live.error = { code: message.code, message: message.message };
        handled = true;
      }
    }
    if (message.mutationId !== undefined) {
      const index = shard.pending.findIndex((m) => m.mutationId === message.mutationId);
      const mutation = shard.pending[index];
      if (mutation && mutation.confirmedAt === undefined) {
        shard.pending.splice(index, 1);
        const code = (MUTATION_ERROR_CODES as readonly string[]).includes(message.code)
          ? (message.code as MutationErrorCode)
          : "internal";
        mutation.resolve({ ok: false, error: { code, message: message.message } });
        handled = true;
      }
    }
    if (handled) {
      this.settle(shard); // A refused subscription no longer blocks dropping confirmed mutations.
      this.armExpiry(shard);
      this.refresh(shard);
      this.release(shard);
      return;
    }
    if (message.subId !== undefined || message.mutationId !== undefined) return; // About something gone.
    this.warn(`Error from ${shard.id}: ${message.code}: ${message.message}`);
    if (message.code === "protocol") {
      // The shard will not talk to this socket: close it and reconnect with the backoff. This connection does
      // not reset the count, even if it delivered data, so a shard that keeps refusing is never retried fast.
      shard.healthy = false;
      this.closeSocket(shard, "protocol");
      if (!this.closed && this.refs(shard) > 0) this.retry(shard);
      this.connectionChanged(shard.id);
    }
  }

  /**
   * Drops a confirmed mutation once its effects are in every view: every subscription of the shard that can
   * receive data (not refused) is in sync on the current socket at its version or later. A subscription waiting
   * for its snapshot or resume answer blocks it, so a patch lost with a connection never shows a row missing.
   */
  private settle(shard: Shard): void {
    const subs = [...shard.subs.values()].filter((live) => live.status !== "error");
    shard.pending = shard.pending.filter(
      (m) =>
        m.confirmedAt === undefined ||
        !subs.every(
          (live) => live.synced && live.version !== undefined && live.version >= m.confirmedAt!,
        ),
    );
  }

  private own(shard: Shard, table: AnyQuery["table"], row: WireRow, live: Live): void {
    const key = `${table}/${row.id}`;
    let holders = shard.owners.get(key);
    if (!holders) shard.owners.set(key, (holders = new Set()));
    holders.add(live.subId);
    live.ids.add(row.id);
    // Rows are whole: replace, never merge.
    shard.confirmed.delete(table, row.id);
    shard.confirmed.insert(table, row as unknown as Tables[typeof table]);
  }

  private disown(shard: Shard, table: AnyQuery["table"], id: string, subId: string): void {
    shard.subs.get(subId)?.ids.delete(id);
    const key = `${table}/${id}`;
    const holders = shard.owners.get(key);
    if (!holders) return;
    holders.delete(subId);
    if (holders.size === 0) {
      shard.owners.delete(key);
      shard.confirmed.delete(table, id);
    }
  }

  // ----------------------------------------------------------------------------------------- the view

  /**
   * Rebuilds the optimistic view of a shard and updates every subscription whose state changed, then notifies
   * their listeners. With `only`, evaluates just that (new) subscription, without notifying.
   */
  private refresh(shard: Shard, only?: Live): void {
    let view: View = shard.confirmed;
    if (shard.pending.length > 0) {
      const optimistic = createMemoryStore<Tables>(shard.confirmed.dump());
      for (const mutation of shard.pending) {
        // A pending mutation that no longer applies drops out of the view silently (RFC 0004).
        runMutation(this.mutations, mutation.name, mutation.args, optimistic, mutation.ctx, {
          onError: (error, name) => this.warn(`Optimistic ${name} threw`, error),
        });
      }
      view = optimistic;
    }
    const confirmed = view === shard.confirmed ? undefined : shard.confirmed;
    if (only) {
      only.sub.state = this.evaluate(only, view, confirmed);
      return;
    }
    const changed: Subscription[] = [];
    for (const live of shard.subs.values()) {
      const next = this.evaluate(live, view, confirmed);
      const prev = live.sub.state;
      if (
        prev.status === next.status &&
        prev.pending === next.pending &&
        same(prev.error, next.error) &&
        same(prev.rows, next.rows)
      ) {
        continue;
      }
      live.sub.state = next;
      changed.push(live.sub);
    }
    for (const sub of changed) {
      for (const listener of sub.listeners) {
        try {
          listener();
        } catch (error) {
          this.warn("A query listener threw", error);
        }
      }
    }
  }

  private evaluate(live: Live, view: View, confirmed: View | undefined): QueryState<unknown> {
    if (live.status === "error" && live.error && live.error !== CLOSED_ERROR) {
      return { rows: [], status: "error", pending: false, error: live.error };
    }
    try {
      const rows = evaluateQuery(live.query, live.args, view);
      const pending = confirmed
        ? !same(rows, evaluateQuery(live.query, live.args, confirmed))
        : false;
      const state: QueryState<unknown> = { rows, status: live.status, pending };
      if (live.error) state.error = live.error;
      return state;
    } catch (error) {
      this.warn(`Query ${live.name} threw`, error);
      return {
        rows: [],
        status: "error",
        pending: false,
        error: { code: "internal", message: `${live.name} failed` },
      };
    }
  }

  private now(): number {
    return Math.floor(this.clock());
  }

  private warn(message: string, detail?: unknown): void {
    try {
      if (this.options.onWarning) this.options.onWarning(message, detail);
      else globals.console?.warn(message, detail);
    } catch {
      // A failing logger must not break the client.
    }
  }
}

function refused(key: string, code: string, message: string): Subscription {
  return {
    key,
    listeners: new Set(),
    state: { rows: [], status: "error", pending: false, error: { code, message } },
  };
}

/** Creates a `SyncClient` typed by the registries it is given (default: `@freecorps/brigade-schema`'s). */
export function createSyncClient<
  Q extends QueryRegistry = typeof brigadeQueries,
  M extends MutationRegistry = typeof brigadeMutations,
>(options: SyncClientOptions<Q, M>): SyncClient<Q, M> {
  return new SyncClient(options);
}
