import { DurableObject } from "cloudflare:workers";
import type { Actor, AnyQuery, BrigadeTables } from "@freecorps/brigade-schema";
import { parseClientMessage, PROTOCOL_VERSION } from "@freecorps/brigade-sync/protocol";
import { findQuery, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";
import { encodeFrame, type ServerFrame, type SubPatch } from "./wire.ts";

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
  subs: { [subId: string]: Subscription };
};

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
    const state: SocketState = { workspace, actor: DEV_ACTOR, clientId: null, subs: {} };
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
    if (!parsed.ok) return this.refuse(ws, parsed.reason);
    const message = parsed.message;

    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL_VERSION) return this.refuse(ws, "Unsupported protocol");
      if (state.clientId !== null) return this.refuse(ws, "hello twice");
      // `token` is reserved and ignored: the Worker authenticates the upgrade.
      state.clientId = message.clientId;
      ws.serializeAttachment(state);
      return;
    }
    if (state.clientId === null) return this.refuse(ws, "hello first");

    switch (message.type) {
      case "subscribe":
        return this.subscribe(
          ws,
          state,
          message.subId,
          message.query,
          message.args,
          message.version,
        );
      case "unsubscribe":
        delete state.subs[message.subId];
        ws.serializeAttachment(state);
        return;
      case "mutate": {
        const now = Date.now();
        const { clientId } = state;
        const stored = this.shard.storedResult(clientId, message.mutationId, now);
        if (stored) {
          this.send(ws, stored);
          return;
        }
        const { result, changes } = this.shard.mutate({
          clientId,
          mutationId: message.mutationId,
          actor: state.actor,
          name: message.name,
          args: message.args,
          now,
        });
        // The result first, then the patch with its effects (RFC 0004 "Ordering").
        this.send(ws, result);
        if (result.ok) this.broadcast(result.version, changes);
        return;
      }
    }
  }

  private subscribe(
    ws: WebSocket,
    state: SocketState,
    subId: string,
    name: string,
    rawArgs: unknown,
    since: number | undefined,
  ): void {
    // A re-subscribe replaces the old subscription, whatever the outcome.
    delete state.subs[subId];
    const refuse = (code: string, message: string) => {
      ws.serializeAttachment(state);
      this.send(ws, { type: "error", subId, code, message });
    };
    if (Object.keys(state.subs).length >= MAX_SUBSCRIPTIONS) {
      return refuse("limit", `At most ${MAX_SUBSCRIPTIONS} subscriptions per socket`);
    }
    const result = this.shard.query(name, rawArgs, state.actor.role);
    if (!result.ok) return refuse(result.error.code, result.error.message);
    // `runQuery` accepted both, so the lookup and the args are valid.
    const query = findQuery(name)!;
    const args = query.args(rawArgs);
    if (!args.ok) return refuse("invalid_args", `Invalid arguments for ${name}`);

    const version = this.shard.version();
    state.subs[subId] = { query: name, args: args.value, version };
    if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_ATTACHMENT_BYTES) {
      delete state.subs[subId];
      return refuse("limit", "Too much subscription state on this socket");
    }
    ws.serializeAttachment(state);

    const patch = since === undefined ? undefined : this.shard.resume(query, result.rows, since);
    this.send(
      ws,
      patch
        ? { type: "patch", version, subs: { [subId]: patch } }
        : { type: "snapshot", subId, version, rows: result.rows },
    );
  }

  /**
   * Sends one patch for `version` to every socket with a subscription whose result it changed: rows that are in
   * the result now (entered or changed) and ids that were in it and left. Sockets with nothing to change skip the
   * version.
   */
  private broadcast(version: number, changes: readonly RowChange[]): void {
    if (changes.length === 0) return;
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (!state?.clientId) continue;
      const subs: { [subId: string]: SubPatch } = {};
      let touched = false;
      for (const [subId, sub] of Object.entries(state.subs)) {
        const query = findQuery(sub.query);
        const patch = query && this.diff(query, sub.args, changes);
        if (!patch) continue;
        subs[subId] = patch;
        sub.version = version;
        touched = true;
      }
      if (!touched) continue;
      ws.serializeAttachment(state);
      this.send(ws, { type: "patch", version, subs });
    }
  }

  private diff(
    query: AnyQuery,
    args: unknown,
    changes: readonly RowChange[],
  ): SubPatch | undefined {
    const patch: SubPatch = { upserts: [], deletes: [] };
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
   * A socket-level protocol error: an `error` frame, then close. A well-behaved client never sends a malformed
   * frame, and the client closes and backs off on one anyway (RFC 0004 "Protocol").
   */
  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", code: "protocol", message });
    close(ws, CLOSE_PROTOCOL_ERROR, "protocol error");
  }

  private send(ws: WebSocket, frame: ServerFrame): void {
    try {
      ws.send(encodeFrame(frame));
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

function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
