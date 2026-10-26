// A reference shard server for tests, written over the shared core (`runMutation` / `runQuery`) and the protocol
// module, the way `WorkspaceDO` will be: one in-memory store per shard, a monotonic version, a change log for
// resumes, mutation de-duplication by (clientId, mutationId), and patches pushed to every socket whose
// subscriptions a change touches, after the mutation's result.

import {
  createMemoryStore,
  mutations,
  queries,
  runMutation,
  runQuery,
  type Actor,
  type BrigadeTables,
  type MemoryStore,
  type MutationContext,
  type TableName,
} from "@freecorps/brigade-schema";
import {
  encode,
  parseClientMessage,
  MUTATION_RETENTION_MS,
  PROTOCOL_VERSION,
  type MutationResultMessage,
  type PatchMessage,
  type ServerMessage,
  type WireRow,
} from "../src/protocol.ts";
import type { SyncSocket, Timers, Transport } from "../src/client.ts";

// ------------------------------------------------------------------------------------------------- timers

/** Deterministic timers: nothing runs until `advance`. */
export class FakeTimers implements Timers {
  now = 0;
  private next = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.next++;
    this.tasks.set(id, { at: this.now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  /** Runs every task due within `ms`, in time order. */
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      // A task overdue after `suspend` runs late, at the current time.
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
    }
    this.now = end;
  }

  /** Time passes with no task run, as when JS is suspended (an app in the background); `advance` runs them late. */
  suspend(ms: number): void {
    this.now += ms;
  }

  get pending(): number {
    return this.tasks.size;
  }
}

// ------------------------------------------------------------------------------------------------- network

type Frame = () => void;

/** One client-side socket. Frames and events travel through the network's queue, delivered by `flush`. */
export class FakeSocket implements SyncSocket {
  onopen: ((event: never) => void) | null = null;
  onmessage: ((event: never) => void) | null = null;
  onclose: ((event: never) => void) | null = null;
  onerror: ((event: never) => void) | null = null;
  closed = false;
  /** Every frame the client sent, decoded. */
  readonly sent: unknown[] = [];
  connection?: Connection;

  constructor(
    readonly url: string,
    private readonly network: FakeNetwork,
  ) {}

  send(data: string): void {
    if (this.closed) throw new Error("send on a closed socket");
    this.sent.push(JSON.parse(data));
    const connection = this.connection;
    this.network.enqueue(() => connection?.receive(data));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection?.drop();
    // A socket the client closed itself fires no event it cares about.
  }

  /**
   * The connection ends. A network failure loses the frames in flight; the server closing (`graceful`) delivers
   * what it sent before the close.
   */
  kill(graceful = false): void {
    if (this.closed) return;
    this.connection?.drop();
    if (!graceful) this.closed = true;
    this.network.enqueue(() => {
      this.closed = true;
      this.fire("onclose", {});
    });
  }

  fire(handler: "onopen" | "onmessage" | "onclose", event: unknown): void {
    (this[handler] as ((event: unknown) => void) | null)?.(event);
  }

  /** Delivers a raw frame from the server. */
  deliver(data: unknown): void {
    this.network.enqueue(() => {
      if (!this.closed) this.fire("onmessage", { data });
    });
  }
}

export class FakeNetwork {
  online = true;
  readonly sockets: FakeSocket[] = [];
  private readonly queue: Frame[] = [];

  constructor(private readonly server: FakeServer) {}

  /** A transport for one client, authenticated as `actor` (the Worker's job in production). */
  transport(actor: Actor): Transport {
    return (url) => {
      const socket = new FakeSocket(url, this);
      this.sockets.push(socket);
      if (!this.online) {
        socket.closed = true;
        this.enqueue(() => socket.fire("onclose", {}));
        return socket;
      }
      const shard = url.replace(/^.*\/sync\//, "");
      socket.connection = this.server.accept(shard, actor, socket);
      this.enqueue(() => {
        if (!socket.closed) socket.fire("onopen", {});
      });
      return socket;
    };
  }

  enqueue(frame: Frame): void {
    this.queue.push(frame);
  }

  /** Delivers the next queued frame; false when there was none. */
  step(): boolean {
    const frame = this.queue.shift();
    frame?.();
    return frame !== undefined;
  }

  /** Delivers queued frames, in order, until nothing is left. */
  flush(): void {
    for (let i = 0; i < 10_000; i++) {
      const frame = this.queue.shift();
      if (!frame) return;
      frame();
    }
    throw new Error("the network did not settle");
  }

  /** Drops every open socket and refuses new ones until `reconnect`. */
  disconnect(): void {
    this.online = false;
    for (const socket of this.sockets) socket.kill();
  }

  reconnect(): void {
    this.online = true;
  }

  open(): FakeSocket[] {
    return this.sockets.filter((socket) => !socket.closed);
  }
}

// ------------------------------------------------------------------------------------------------- server

type ServerSub = { query: string; args: unknown; ids: Set<string>; table: TableName };

export class Connection {
  clientId?: string;
  readonly subs = new Map<string, ServerSub>();
  alive = true;

  constructor(
    readonly shard: ShardServer,
    readonly actor: Actor,
    private readonly socket: FakeSocket,
  ) {}

  /** Every message the server sent on this connection. */
  readonly out: ServerMessage[] = [];
  /** Held back by a slow link (`ShardServer.slow`): a snapshot and everything sent after it, in order. */
  private readonly held: ServerMessage[] = [];

  send(message: ServerMessage): void {
    if (!this.alive) return;
    if (this.held.length > 0 || (this.shard.slow && message.type === "snapshot")) {
      this.held.push(message);
      return;
    }
    this.out.push(message);
    this.socket.deliver(encode(message));
  }

  receive(data: string): void {
    if (this.alive) this.shard.handle(this, data);
  }

  /** The held frames finally arrive. */
  release(): void {
    for (const message of this.held.splice(0)) this.send(message);
  }

  /** The server closes the socket. */
  kill(): void {
    this.socket.kill(true);
  }

  drop(): void {
    this.alive = false;
    this.shard.connections.delete(this);
  }
}

type Change = { version: number; table: TableName; id: string };

export class ShardServer {
  store: MemoryStore<BrigadeTables> = createMemoryStore<BrigadeTables>();
  version = 0;
  /** Created with the shard's storage; a restore or a re-created storage writes a new one. */
  epoch: string;
  private static epochs = 0;
  readonly connections = new Set<Connection>();
  /** Rows changed per version; resumes older than `logStart` get a snapshot. */
  log: Change[] = [];
  logStart = 0;
  /** Results by (clientId, mutationId), kept `MUTATION_RETENTION_MS` after the run. */
  readonly results = new Map<string, { at: number; message: MutationResultMessage }>();
  /** Mutations actually run (not answered from `results`). */
  runs = 0;
  /** Answers every hello with a protocol error (the client closes the socket). */
  refusing = false;
  /**
   * After an ok `mutationResult`, send that socket a `patch` for the version even when it touched nothing there
   * (empty `subs`), as the protocol requires. Off only to test the client without it.
   */
  confirmPatches = true;
  /** Pings received; with `silent` set, they get no pong (a half-open socket, or a stuck shard). */
  pings = 0;
  silent = false;
  /** An older shard that does not know `ping`: a protocol error, then a close. */
  refusesPing = false;
  /** A slow link: snapshots, and what follows them on their socket, wait for `deliverHeld`. */
  slow = false;
  /** Frames the parser refused. */
  readonly refused: string[] = [];

  /**
   * Takes a backup; calling the result restores the shard to it at its lower version, with a new epoch as the
   * restore procedure requires. `keepEpoch` plays a restore that skipped that step, for the client's safety net.
   */
  checkpoint(): (options?: { keepEpoch?: boolean }) => void {
    const rows = this.store.dump();
    const { version, logStart } = this;
    const log = [...this.log];
    return ({ keepEpoch = false } = {}) => {
      this.store = createMemoryStore<BrigadeTables>(rows);
      this.version = version;
      this.log = log;
      this.logStart = logStart;
      if (!keepEpoch) this.epoch = `ep${++ShardServer.epochs}`;
    };
  }

  /** Re-creates the storage: a new epoch, the same rows and version (a worst case for clients). */
  recreate(): void {
    this.epoch = `ep${++ShardServer.epochs}`;
    this.log = [];
    this.logStart = this.version;
  }

  constructor(
    readonly id: string,
    private readonly clock: () => number,
  ) {
    this.epoch = `ep${++ShardServer.epochs}`;
  }

  /** Ends the slow link: every held frame arrives. */
  deliverHeld(): void {
    this.slow = false;
    for (const connection of this.connections) connection.release();
  }

  handle(connection: Connection, data: string): void {
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      this.refused.push(parsed.reason);
      connection.send({ type: "error", code: "protocol", message: parsed.reason });
      return;
    }
    const message = parsed.message;
    // The shard's runtime answers a ping itself, before `hello` too (a WebSocket auto-response).
    if (message.type === "ping") {
      this.pings++;
      if (this.refusesPing) {
        connection.send({ type: "error", code: "protocol", message: "unknown message type" });
        connection.kill();
        return;
      }
      if (!this.silent) connection.send({ type: "pong" });
      return;
    }
    if (message.type !== "hello" && connection.clientId === undefined) {
      connection.send({ type: "error", code: "protocol", message: "hello first" });
      return;
    }
    switch (message.type) {
      case "hello":
        if (message.protocol !== PROTOCOL_VERSION || this.refusing) {
          connection.send({ type: "error", code: "protocol", message: "Unsupported protocol" });
          return;
        }
        if (connection.clientId !== undefined) {
          connection.send({ type: "error", code: "protocol", message: "hello twice" });
          return;
        }
        connection.clientId = message.clientId;
        return;
      case "subscribe":
        return this.subscribe(
          connection,
          message.subId,
          message.query,
          message.args,
          message.version === undefined
            ? undefined
            : { version: message.version, epoch: message.epoch! },
        );
      case "unsubscribe":
        connection.subs.delete(message.subId);
        return;
      case "mutate":
        return this.mutate(connection, message.mutationId, message.name, message.args);
    }
  }

  private subscribe(
    connection: Connection,
    subId: string,
    query: string,
    args: unknown,
    resume: { version: number; epoch: string } | undefined,
  ): void {
    const result = runQuery(queries, query, args, this.store, connection.actor.role);
    if (!result.ok) {
      connection.send({
        type: "error",
        subId,
        code: result.error.code,
        message: result.error.message,
      });
      return;
    }
    const table = queries[query as keyof typeof queries].table;
    const rows = result.rows as WireRow[];
    const ids = new Set(rows.map((row) => row.id));
    connection.subs.set(subId, { query, args, ids, table });
    // Resume only within this epoch, from a version this shard has reached and its log still covers.
    if (
      resume !== undefined &&
      resume.epoch === this.epoch &&
      resume.version <= this.version &&
      resume.version >= this.logStart
    ) {
      const since = resume.version;
      // Resume: rows changed since `since` that are in the result now, and the ones that may have left it.
      const changed = new Set(
        this.log.filter((c) => c.version > since && c.table === table).map((c) => c.id),
      );
      const upserts = rows.filter((row) => changed.has(row.id));
      const deletes = [...changed].filter((id) => !ids.has(id));
      connection.send({
        type: "patch",
        epoch: this.epoch,
        version: this.version,
        subs: { [subId]: { upserts, deletes } },
      });
      return;
    }
    connection.send({ type: "snapshot", subId, epoch: this.epoch, version: this.version, rows });
  }

  private mutate(connection: Connection, mutationId: string, name: string, args: unknown): void {
    const key = `${connection.clientId}/${mutationId}`;
    const stored = this.results.get(key);
    if (stored && this.clock() - stored.at <= MUTATION_RETENTION_MS) {
      connection.send(stored.message);
      return;
    }
    this.runs++;
    const result = this.run(connection.actor, name, args);
    const message: MutationResultMessage = result.ok
      ? { type: "mutationResult", mutationId, ok: true, version: result.version }
      : { type: "mutationResult", mutationId, ok: false, error: result.error };
    this.results.set(key, { at: this.clock(), message });
    // The result first, then the patches with its effects (RFC 0004 "Ordering").
    connection.send(message);
    if (result.ok) this.broadcast(result.changes, connection);
  }

  /** Runs a mutation as `actor` (a client's, or a system write), recording what changed. */
  run(actor: Actor, name: string, args: unknown) {
    const before = this.store.dump();
    const ctx: MutationContext = { actor, now: this.clock(), server: true };
    const result = runMutation(mutations, name, args, this.store, ctx, {
      commit: () => {
        this.version++;
      },
    });
    if (!result.ok) return result;
    const after = this.store.dump();
    const changes: Change[] = [];
    // The synced tables the dashboard's tests subscribe to.
    for (const table of ["incidents", "monitors", "alerts", "timeline", "members"] as const) {
      const old = new Map((before[table] ?? []).map((row) => [row.id, JSON.stringify(row)]));
      const now = new Map((after[table] ?? []).map((row) => [row.id, JSON.stringify(row)]));
      for (const id of new Set([...old.keys(), ...now.keys()])) {
        if (old.get(id) !== now.get(id)) changes.push({ version: this.version, table, id });
      }
    }
    this.log.push(...changes);
    return { ok: true as const, version: this.version, changes };
  }

  /** A server-side write (another user on another channel, an alarm): the patches go to every socket. */
  write(actor: Actor, name: string, args: unknown) {
    const result = this.run(actor, name, args);
    if (result.ok) this.broadcast(result.changes);
    return result;
  }

  /** One `patch` frame per socket for this version, holding every subscription on it the changes touch. */
  /** Also sends `origin` (the socket that ran the mutation) a patch when nothing on it was touched. */
  private broadcast(changes: Change[], origin?: Connection): void {
    for (const connection of this.connections) {
      const subs: PatchMessage["subs"] = {};
      for (const [subId, sub] of connection.subs) {
        const touched = changes.filter((c) => c.table === sub.table).map((c) => c.id);
        if (touched.length === 0) continue;
        const result = runQuery(queries, sub.query, sub.args, this.store, connection.actor.role);
        if (!result.ok) continue;
        const rows = result.rows as WireRow[];
        const ids = new Set(rows.map((row) => row.id));
        const upserts = rows.filter((row) => touched.includes(row.id));
        const deletes = touched.filter((id) => sub.ids.has(id) && !ids.has(id));
        sub.ids = ids;
        if (upserts.length === 0 && deletes.length === 0) continue;
        subs[subId] = { upserts, deletes };
      }
      if (Object.keys(subs).length > 0 || (connection === origin && this.confirmPatches)) {
        connection.send({ type: "patch", epoch: this.epoch, version: this.version, subs });
      }
    }
  }
}

export class FakeServer {
  readonly shards = new Map<string, ShardServer>();

  constructor(private readonly clock: () => number) {}

  shard(id: string): ShardServer {
    let shard = this.shards.get(id);
    if (!shard) this.shards.set(id, (shard = new ShardServer(id, this.clock)));
    return shard;
  }

  accept(shardId: string, actor: Actor, socket: FakeSocket): Connection {
    const shard = this.shard(shardId);
    const connection = new Connection(shard, actor, socket);
    shard.connections.add(connection);
    return connection;
  }
}
