import { DurableObject } from "cloudflare:workers";
import type { Actor, AnyQuery, BrigadeTables } from "@freecorps/brigade-schema";
import {
  encode,
  parseClientMessage,
  PROTOCOL_VERSION,
  TOKEN,
  type ServerMessage,
  type SubscriptionChanges,
} from "@freecorps/brigade-sync/protocol";
import { findQuery, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

export interface WorkspaceInfo {
  /** User tables in the object's SQLite database, read with SQL. */
  tables: number;
  /** Size of the object's SQLite database in bytes. */
  databaseSize: number;
}

/** Workspace ids: 1-63 chars of `a-z`, `0-9`, `-`, `_`, starting with `a-z0-9`. */
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,62}$/;

/** Set by the Worker on the upgrade it forwards; the shard records it on first use. */
export const WORKSPACE_HEADER = "Brigade-Workspace";

/**
 * DEV ONLY. There is no auth yet, so every socket acts as this responder. Once auth exists the Worker
 * authenticates the upgrade and passes the actor to the shard in a signed header (RFC 0004 "Socket topology").
 */
export const DEV_ACTOR: Actor = { kind: "user", id: "usr_dev", role: "responder" };

/** Subscriptions per socket; each lives in the socket's attachment. */
export const MAX_SUBSCRIPTIONS = 32;
/** Serialized attachment budget, well under the runtime's 16 KiB limit. */
export const MAX_ATTACHMENT_BYTES = 8 * 1024;

/** WebSocket close codes the shard uses. */
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_INTERNAL_ERROR = 1011;

type Subscription = {
  subId: string;
  query: string;
  /** Validated args, as the query's validator returned them. */
  args: unknown;
  /** The last version sent for this subscription. */
  version: number;
};

/**
 * Per-socket state, kept in the socket's attachment so it survives hibernation: the shard holds nothing about a
 * socket in memory.
 */
export type SocketState = {
  workspace: string;
  actor: Actor;
  /** Set by `hello`; every other frame needs it. */
  clientId: string | null;
  /** An array, not an object keyed by subId: `__proto__` is a valid subId. */
  subs: Subscription[];
};

/** Largest frame the shard reads at all, to salvage the id of a refused `subscribe` or `mutate`. */
const MAX_SALVAGE_LENGTH = 1024 * 1024;

/**
 * Shard for one workspace (RFC 0002, RFC 0004): the incident index and the sync endpoint. Sockets use the
 * Hibernation API; every handler is synchronous, so a socket's frames are handled strictly in arrival order and
 * frames from different sockets never interleave.
 */
export class WorkspaceDO extends DurableObject<Env> {
  private readonly shard: Shard;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Runs on every wake from hibernation: only `create … if not exists`.
    this.shard = new Shard(ctx.storage, {
      shard: "workspace",
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      log: (message, fields) => this.log(message, fields),
    });
  }

  info(): WorkspaceInfo {
    const { sql } = this.ctx.storage;
    // `sqlite_version()` is not authorized in Durable Object SQLite, so read the catalog instead.
    // Skip internal tables so every runtime reports the same: Cloudflare's `_cf_*`, SQLite's
    // `sqlite_sequence` and the `__miniflare_do_name` table that local Miniflare adds.
    const { tables } = sql
      .exec<{ tables: number }>(
        `select count(*) as tables from sqlite_master
         where type = 'table'
           and name not like '!_cf!_%' escape '!'
           and name not like '!_!_%' escape '!'
           and name != 'sqlite_sequence'`,
      )
      .one();
    return { tables, databaseSize: sql.databaseSize };
  }

  /** Accepts a sync socket the Worker forwarded (`GET /sync/:workspaceId`). */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: "upgrade_required" },
        { status: 426, headers: { Upgrade: "websocket" } },
      );
    }
    const workspace = request.headers.get(WORKSPACE_HEADER) ?? "";
    if (!WORKSPACE_ID.test(workspace))
      return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
    if (!this.shard.claim(workspace)) {
      this.log("shard serves another workspace", { workspace });
      return Response.json({ error: "internal" }, { status: 500 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const state: SocketState = { workspace, actor: DEV_ACTOR, clientId: null, subs: [] };
    server.serializeAttachment(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      this.receive(ws, message);
    } catch (error) {
      // A bug or a storage failure: report it, tell the client and close; it reconnects and resumes.
      this.log("sync frame failed", { error });
      this.send(ws, { type: "error", code: "internal", message: "Internal error" });
      close(ws, CLOSE_INTERNAL_ERROR, "internal error");
    }
  }

  override webSocketClose(): void {
    // Nothing to clean up: a socket's state lives in its attachment and goes with it. The runtime answers the
    // close frame itself (web_socket_auto_reply_to_close, compatibility date 2026-04-07 and later).
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    this.log("sync socket error", { error });
  }

  private receive(ws: WebSocket, data: string | ArrayBuffer): void {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state) {
      close(ws, CLOSE_INTERNAL_ERROR, "no socket state");
      return;
    }
    // Checks size (64 KiB), JSON, shape and ids; never throws. Binary frames are refused as not text.
    const parsed = parseClientMessage(data);
    if (!parsed.ok) return this.malformed(ws, state, data, parsed.reason);
    const message = parsed.message;

    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL_VERSION) return this.refuse(ws, "Unsupported protocol");
      if (state.clientId !== null) return this.refuse(ws, "hello twice");
      // `token` is reserved and ignored: the Worker authenticates the upgrade.
      state.clientId = message.clientId;
      ws.serializeAttachment(state);
      return;
    }
    if (state.clientId === null) {
      // A parseable `mutate` is never a socket-level error: the client fails that mutation instead (RFC 0004).
      if (message.type === "mutate") {
        const { mutationId } = message;
        return this.send(ws, {
          type: "error",
          code: "internal",
          message: "hello first",
          mutationId,
        });
      }
      return this.refuse(ws, "hello first");
    }

    switch (message.type) {
      case "subscribe":
        return this.subscribe(
          ws,
          state,
          message.subId,
          message.query,
          message.args,
          message.version === undefined || message.epoch === undefined
            ? undefined
            : { version: message.version, epoch: message.epoch },
        );
      case "unsubscribe":
        state.subs = state.subs.filter((sub) => sub.subId !== message.subId);
        ws.serializeAttachment(state);
        return;
      case "mutate":
        return this.mutate(
          ws,
          state,
          state.clientId,
          message.mutationId,
          message.name,
          message.args,
        );
    }
  }

  /**
   * Answers a `mutate` with its `mutationResult`, then (when ok) the patch for its version: to every socket whose
   * subscriptions it touched, and always to this socket, with `subs: {}` if it touched none of them here, so the
   * client can settle the mutation (RFC 0004 "Ordering"). A retry gets the stored result and an empty patch at the
   * current version: every subscription on this socket has received every change that touched it, so it truly
   * holds that version.
   */
  private mutate(
    ws: WebSocket,
    state: SocketState,
    clientId: string,
    mutationId: string,
    name: string,
    args: unknown,
  ): void {
    let outcome;
    try {
      const now = Date.now();
      const stored = this.shard.storedResult(clientId, mutationId, now);
      outcome = stored
        ? { result: stored, changes: null }
        : this.shard.mutate({ clientId, mutationId, actor: state.actor, name, args, now });
    } catch (error) {
      // Nothing committed (the mutation is one transaction). Fail this mutation, not the socket.
      this.log("mutate failed", { mutation: name.slice(0, 64), error });
      this.send(ws, { type: "error", code: "internal", message: "Internal error", mutationId });
      return;
    }
    const { result, changes } = outcome;
    this.send(ws, result);
    if (!result.ok) return;
    if (changes) this.broadcast(result.version, changes, ws);
    else this.settle(ws, this.shard.version());
  }

  private subscribe(
    ws: WebSocket,
    state: SocketState,
    subId: string,
    name: string,
    rawArgs: unknown,
    from: { version: number; epoch: string } | undefined,
  ): void {
    // A re-subscribe replaces the old subscription, whatever the outcome.
    state.subs = state.subs.filter((sub) => sub.subId !== subId);
    const refuse = (code: string, message: string) => {
      ws.serializeAttachment(state);
      this.send(ws, { type: "error", subId, code, message });
    };
    if (state.subs.length >= MAX_SUBSCRIPTIONS) {
      return refuse("limit", `At most ${MAX_SUBSCRIPTIONS} subscriptions per socket`);
    }
    const result = this.shard.query(name, rawArgs, state.actor.role);
    if (!result.ok) return refuse(result.error.code, result.error.message);
    // `runQuery` accepted both, so the lookup and the args are valid.
    const query = findQuery(name)!;
    const args = query.args(rawArgs);
    if (!args.ok) return refuse("invalid_args", `Invalid arguments for ${name}`);

    const version = this.shard.version();
    const { epoch } = this.shard;
    state.subs.push({ subId, query: name, args: args.value, version });
    if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_ATTACHMENT_BYTES) {
      state.subs.pop();
      return refuse("limit", "Too much subscription state on this socket");
    }
    ws.serializeAttachment(state);

    // Exactly one answer: a patch holding only this subscription (possibly empty), or a snapshot.
    const changes = from && this.shard.resume(query, result.rows, from);
    if (changes) {
      const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
      subs[subId] = changes;
      this.send(ws, { type: "patch", epoch, version, subs });
    } else {
      this.send(ws, { type: "snapshot", subId, epoch, version, rows: result.rows });
    }
  }

  /**
   * Sends one patch for `version` to every socket with a subscription whose result it changed: rows that are in
   * the result now (entered or changed) and ids that were in it and left. Other sockets skip the version, except
   * `origin` (the mutating socket), which always gets it.
   */
  private broadcast(version: number, changes: readonly RowChange[], origin: WebSocket): void {
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (!state?.clientId) continue;
      // No prototype: a subId such as `__proto__` stays an ordinary key.
      const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
      let touched = false;
      for (const sub of state.subs) {
        const query = findQuery(sub.query);
        const patch = query && this.diff(query, sub.args, changes);
        if (!patch) continue;
        subs[sub.subId] = patch;
        touched = true;
      }
      if (!touched && ws !== origin) continue;
      this.sendPatch(ws, state, version, subs);
    }
  }

  /** An empty patch at `version` for this socket only (see `mutate`). */
  private settle(ws: WebSocket, version: number): void {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (state) this.sendPatch(ws, state, version, Object.create(null));
  }

  /** Every subscription on a socket that gets a patch holds that version (absent ones were not touched). */
  private sendPatch(
    ws: WebSocket,
    state: SocketState,
    version: number,
    subs: { [subId: string]: SubscriptionChanges },
  ): void {
    for (const sub of state.subs) sub.version = version;
    ws.serializeAttachment(state);
    this.send(ws, { type: "patch", epoch: this.shard.epoch, version, subs });
  }

  private diff(
    query: AnyQuery,
    args: unknown,
    changes: readonly RowChange[],
  ): SubscriptionChanges | undefined {
    const patch: SubscriptionChanges = { upserts: [], deletes: [] };
    const matches = (row: unknown) =>
      row !== undefined && query.filter(row as BrigadeTables[typeof query.table], args);
    try {
      for (const change of changes) {
        if (change.table !== query.table) continue;
        if (matches(change.after)) patch.upserts.push(change.after!);
        else if (matches(change.before)) patch.deletes.push(change.id);
      }
    } catch (error) {
      this.log("query filter failed", { query: query.name, error });
      return undefined;
    }
    return patch.upserts.length || patch.deletes.length ? patch : undefined;
  }

  /**
   * A frame `parseClientMessage` refused. A `mutate` whose id can still be read (or, after `hello`, a `subscribe`)
   * is refused alone with `invalid_args` and the socket stays open: every `subscribe` gets its one answer, and the
   * client fails that mutation instead of re-sending it (RFC 0004 "Errors"). Anything else is a socket-level
   * protocol error.
   */
  private malformed(ws: WebSocket, state: SocketState, data: unknown, reason: string): void {
    const id = salvage(data);
    if (!id || ("subId" in id && state.clientId === null)) return this.refuse(ws, reason);
    this.send(ws, { type: "error", code: "invalid_args", message: reason, ...id });
  }

  /**
   * A socket-level protocol error: an `error` frame, then close. A well-behaved client never sends a malformed
   * frame, and the client closes and backs off on one anyway (RFC 0004 "Protocol").
   */
  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", code: "protocol", message });
    close(ws, CLOSE_PROTOCOL_ERROR, "protocol error");
  }

  private send(ws: WebSocket, frame: ServerMessage): void {
    try {
      ws.send(encode(frame));
    } catch (error) {
      // The socket closed meanwhile; the client resumes on reconnect.
      this.log("sync send failed", { type: frame.type, error });
    }
  }

  /** One structured JSON line per problem; `internal` causes end up here, never on the wire. */
  private log(message: string, fields: Record<string, unknown>): void {
    const { error, ...rest } = fields;
    let workspace: string | undefined;
    try {
      workspace = this.shard.workspace();
    } catch {
      // Logging must not fail because storage did.
    }
    console.error(
      JSON.stringify({
        message,
        shard: "workspace",
        workspace,
        ...rest,
        ...(error === undefined ? {} : describe(error)),
      }),
    );
  }
}

function describe(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error)
    return { error: `${error.name}: ${error.message}`, stack: error.stack };
  return { error: typeof error === "string" ? error : (JSON.stringify(error) ?? typeof error) };
}

/** The `subId` of a `subscribe` or the `mutationId` of a `mutate` in a frame the parser refused, if readable. */
function salvage(data: unknown): { subId: string } | { mutationId: string } | undefined {
  if (typeof data !== "string" || data.length > MAX_SALVAGE_LENGTH) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { type, subId, mutationId } = value as Record<string, unknown>;
  if (type === "subscribe" && typeof subId === "string" && TOKEN.test(subId)) return { subId };
  if (type === "mutate" && typeof mutationId === "string" && TOKEN.test(mutationId)) {
    return { mutationId };
  }
  return undefined;
}

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
