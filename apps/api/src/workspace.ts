import { DurableObject } from "cloudflare:workers";
import { fitMemberName, type Actor, type ProbeRegion } from "@freecorps/brigade-schema";
import {
  encode,
  parseClientMessage,
  PROTOCOL_VERSION,
  TOKEN,
  type ServerMessage,
  type SubscriptionChanges,
} from "@freecorps/brigade-sync/protocol";
import { readActor, readMemberName } from "./actor.ts";
import { isProbeRegion, MONITOR_TICK_MS, Monitoring } from "./monitors.ts";
import { OutboxDrain, type BrigadeEvent } from "./outbox.ts";
import {
  Pager,
  type DeadLetterResult,
  type DeviceOutcome,
  type PagePlan,
  type SkippedMember,
} from "./paging.ts";
import type { ProbeReport } from "./probe.ts";
import { findQuery, Shard, subscriptionChanges } from "./shard.ts";
import type { RowChange } from "./store.ts";

export interface WorkspaceInfo {
  /** User tables in the object's SQLite database, read with SQL. */
  tables: number;
  /** Size of the object's SQLite database in bytes. */
  databaseSize: number;
}

/**
 * Workspace ids: a workspace's own id (`ws_<ULID>`, the Better Auth organization id), or 1-63 chars of `a-z`,
 * `0-9`, `-`, `_` starting with `a-z0-9` (dev shards such as `demo`, and the tests).
 */
export const WORKSPACE_ID = /^(?:ws_[0-9A-HJKMNP-TV-Z]{26}|[a-z0-9][a-z0-9_-]{0,62})$/;

/** Set by the Worker on the upgrade it forwards; the shard records it on first use. */
export const WORKSPACE_HEADER = "Brigade-Workspace";

/** Subscriptions per socket; each lives in the socket's attachment. */
export const MAX_SUBSCRIPTIONS = 32;
/**
 * Attachment budget, well under the runtime's 16 KiB limit. Measured approximately, as the UTF-8 length of the
 * state's JSON: the runtime stores the structured-clone encoding, whose size differs a little, so the margin
 * covers it.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024;

/** WebSocket close codes the shard uses. */
export const CLOSE_PROTOCOL_ERROR = 1002;
export const CLOSE_INTERNAL_ERROR = 1011;
export const CLOSE_SERVICE_RESTART = 1012;

type Subscription = {
  subId: string;
  query: string;
  /** Validated args, as the query's validator returned them. */
  args: unknown;
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
  /** Set when the shard closes the socket: frames already queued behind the close are dropped unread. */
  closed?: true;
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
  private readonly monitoring: Monitoring;
  private readonly drain: OutboxDrain;
  private readonly drainPaused: boolean;
  private readonly pager: Pager;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
    // Runs on every wake from hibernation: only `create … if not exists`.
    this.shard = new Shard(ctx.storage, {
      shard: "workspace",
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      onOutbox: () => this.armDrain(),
    });
    // TEST ONLY: the API's own tests (vite.config.ts) read events from the outbox, so they pause the drain; the
    // drain's tests drive it directly. No deployed environment sets it (apps/web test/worker-config.test.ts).
    this.drainPaused = Reflect.get(env, "OUTBOX_DRAIN") === "paused";
    this.drain = new OutboxDrain(
      ctx.storage.sql,
      async (messages) => {
        await env.EVENTS.sendBatch(messages);
      },
      (message, fields) => this.log(message, fields),
    );
    this.pager = new Pager({
      storage: ctx.storage,
      shard: this.shard,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    this.monitoring = new Monitoring({
      storage: ctx.storage,
      shard: this.shard,
      probes: env.PROBE,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
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

  /**
   * The restore hook: every path that restores this object's storage (point-in-time recovery, importing a
   * nightly export; RFC 0004 "Shard server", open question Q3) calls this right after the restore, before the
   * shard is reachable again. It writes a new epoch and closes every open socket, so each client reconnects and
   * gets a snapshot instead of resuming from versions the restore reused. Returns the new epoch.
   */
  rotateEpoch(): string {
    const epoch = this.shard.rotateEpoch();
    this.log("epoch rotated", { epoch });
    for (const ws of this.ctx.getWebSockets()) close(ws, CLOSE_SERVICE_RESTART, "epoch rotated");
    return epoch;
  }

  /**
   * Runs `workspace.create` once Better Auth has created the workspace (RPC from the API Worker): records the
   * shard's workspace and writes `workspace.created` to the outbox, like any mutation (RFC 0005). Idempotent: a
   * second call finds the row and changes nothing.
   */
  provision(workspace: { id: string; name: string }, actor: Actor): { ok: boolean; code?: string } {
    if (!this.shard.claim(workspace.id)) {
      this.log("shard serves another workspace", { workspace: workspace.id });
      return { ok: false, code: "internal" };
    }
    const now = Date.now();
    // De-duplicated like a socket's mutation: a retry gets the stored result instead of running again.
    const stored = this.shard.storedResult(actor.id, "api", "provision", now);
    const { result, changes } = stored
      ? { result: stored, changes: [] }
      : this.shard.mutate({
          clientId: "api",
          mutationId: "provision",
          actor,
          name: "workspace.create",
          args: workspace,
          now,
          internal: true,
        });
    if (result.ok) {
      if (!stored) this.broadcast(result.version, changes, undefined);
      return { ok: true };
    }
    // Already provisioned (a retry): fine.
    if (result.error.code === "conflict") return { ok: true };
    return { ok: false, code: result.error.code };
  }

  /**
   * A probe's verdicts for its region (RPC from `ProbeDO`), each run as `monitor.report` by the monitors' system
   * actor and de-duplicated by its report id. Returns, per report, whether the probe may stop sending it: true
   * when it committed or can never apply (a paused or deleted monitor, a region it no longer uses, a result from
   * before its last restart or older than one recorded), false when it should be sent again. A storage failure
   * throws, and the probe sends them all again.
   */
  report(region: ProbeRegion, reports: ProbeReport[]): boolean[] {
    if (!isProbeRegion(region) || this.shard.workspace() === undefined)
      return reports.map(() => true);
    return reports.map(({ reportId, ...report }) => {
      const result = this.monitoring.report(`probe:${region}`, reportId, {
        ...report,
        source: region,
      });
      return result.ok || ["conflict", "not_found", "invalid_args"].includes(result.error.code);
    });
  }

  /**
   * A heartbeat ping (RPC from the Worker's `POST /heartbeat/:token`) with the SHA-256 of the token's secret.
   * False for an unknown monitor or a wrong token, alike; a shard that serves no workspace yet answers false
   * without claiming one.
   */
  async heartbeat(monitorId: string, digest: ArrayBuffer): Promise<boolean> {
    if (this.shard.workspace() === undefined) return false;
    return this.monitoring.ping(monitorId, digest);
  }

  /**
   * What the push notifier should send for `event` (RPC from the queue consumer, src/notify.ts): see `Pager.plan`.
   * A shard that serves no workspace yet plans nothing.
   */
  planPage(event: BrigadeEvent): PagePlan {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return this.pager.plan(event, Date.now());
  }

  /**
   * What a page did (RPC from the queue consumer): see `Pager.record`. `skipped` defaults to none, so a consumer
   * from the version before it (during a deploy) still records its outcomes.
   */
  recordPage(
    event: BrigadeEvent,
    outcomes: DeviceOutcome[],
    final: boolean,
    skipped: SkippedMember[] = [],
  ): void {
    if (this.shard.workspace() !== event.workspaceId) return;
    this.pager.record(event, outcomes, final, skipped, Date.now());
  }

  /** A page the Queue gave up on (RPC from the dead-letter consumer): see `Pager.deadLettered`. */
  recordDeadLetter(event: BrigadeEvent): DeadLetterResult {
    if (this.shard.workspace() !== event.workspaceId) return "other_workspace";
    return this.pager.deadLettered(event, Date.now());
  }

  /**
   * The shard's one alarm (RFC 0005, RFC 0007): monitor upkeep (`Monitoring.tick`), then draining the outbox to the
   * Queue, so events the tick wrote go out in the same run. A fallback a tick from now is set first, so a failure
   * never ends the chain; then the alarm moves to the earliest either needs, or goes when neither needs it.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.setAlarm(now + MONITOR_TICK_MS);
    let monitors: number | null = now + MONITOR_TICK_MS;
    try {
      monitors = await this.monitoring.tick(now);
    } catch (error) {
      this.log("monitor tick failed", { error });
    }
    if (!this.drainPaused) {
      try {
        await this.drain.drain(Date.now());
      } catch (error) {
        this.log("outbox drain failed", { error });
        try {
          this.drain.failed(Date.now(), error);
        } catch (backoff) {
          this.log("backing off the outbox drain failed", { error: backoff });
        }
      }
    }
    // Read and set in one turn: a mutation committing meanwhile arms the drain after this, never before.
    const next = earliest(monitors, this.drainPaused ? null : this.drain.nextWake(Date.now()));
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  /**
   * Called after every mutation that wrote events: brings the alarm forward so the drain runs now, or when its
   * backoff ends after a failed send. Fire and forget; a failure is logged, and the next alarm drains anyway.
   */
  private armDrain(): void {
    if (this.drainPaused) return;
    const at = Math.max(Date.now(), this.drain.retryAt() ?? 0);
    const { storage } = this.ctx;
    storage
      .getAlarm()
      .then((current) => (current === null || current > at ? storage.setAlarm(at) : undefined))
      .catch((error: unknown) => this.log("arming the outbox drain failed", { error }));
  }

  /** Accepts a sync socket the Worker forwarded (`GET /sync/:workspaceId`). */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: "upgrade_required" },
        { status: 426, headers: { Upgrade: "websocket" } },
      );
    }
    // Set by the Worker after it authenticated the upgrade (src/actor.ts); never copied from the client.
    const actor = readActor(request.headers);
    if (!actor) return Response.json({ error: "internal" }, { status: 500 });
    const workspace = request.headers.get(WORKSPACE_HEADER) ?? "";
    if (!WORKSPACE_ID.test(workspace))
      return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
    if (!this.shard.claim(workspace)) {
      this.log("shard serves another workspace", { workspace });
      return Response.json({ error: "internal" }, { status: 500 });
    }
    const name = readMemberName(request.headers);
    if (name !== undefined) this.syncMember(actor, name);
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const state: SocketState = { workspace, actor, clientId: null, subs: [] };
    server.serializeAttachment(state);
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Copies the member this socket acts as into the shard's member list (`member.sync`, RFC 0003), so roles can
   * point at them and the dashboard can show their name. The name is fitted first (trimmed, cut, or null when the
   * shard cannot keep it: `fitMemberName`), so an odd name in D1 still lists the member, and the copy is skipped
   * when that fitted value is current. A failure is logged and the socket still opens: the list is a cache of D1,
   * refreshed on the member's next socket.
   */
  private syncMember(actor: Actor, raw: string): void {
    try {
      const name = fitMemberName(raw);
      const current = this.shard.store.get("members", actor.id);
      if (current && current.name === name && current.role === actor.role) return;
      const { result, changes } = this.shard.mutate({
        clientId: "api",
        mutationId: "member",
        actor,
        name: "member.sync",
        args: { id: actor.id, name, role: actor.role },
        now: Date.now(),
        internal: true,
      });
      if (result.ok) this.broadcast(result.version, changes, undefined);
      else this.log("member sync refused", { code: result.error.code });
    } catch (error) {
      this.log("member sync failed", { error });
    }
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
    // Frames the client sent before the shard closed this socket still arrive here. Handling them would run them
    // out of order (a mutate that depends on one whose storage failed), so they are dropped unread: the client
    // replays everything unconfirmed, in order, on its next socket.
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = ws.deserializeAttachment() as SocketState | null;
    if (state?.closed) return;
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
    // Any frame before `hello`, a `mutate` included, is about the socket, not that frame (RFC 0004 "Shard
    // server"): the client always sends `hello` first, and after the close it replays the mutation behind one.
    if (state.clientId === null) return this.refuse(ws, "hello first");

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
   * client can settle the mutation (RFC 0004 "Ordering").
   *
   * A retry the shard already ran gets the stored result and nothing else: the client re-sends only on a new
   * socket, before its `subscribe`s, and their answers (at the current version, at or after the result's) settle
   * it. A storage failure throws out of here: nothing committed, so the socket closes with `internal` and the
   * client replays the mutation on the next one, instead of failing it for good.
   */
  private mutate(
    ws: WebSocket,
    state: SocketState,
    clientId: string,
    mutationId: string,
    name: string,
    args: unknown,
  ): void {
    const now = Date.now();
    const stored = this.shard.storedResult(state.actor.id, clientId, mutationId, now);
    if (stored) return this.send(ws, stored);
    const { result, changes } = this.shard.mutate({
      clientId,
      mutationId,
      actor: state.actor,
      name,
      args,
      now,
    });
    this.send(ws, result);
    if (result.ok) {
      this.broadcast(result.version, changes, ws);
      // A monitor changed: the alarm pushes it to its probes (and keeps watching its heartbeats) right away.
      if (changes.some((change) => change.table === "monitors")) {
        this.ctx.storage.setAlarm(Date.now()).catch((error: unknown) => {
          // The next alarm (or a later change) pushes it instead; log rather than leave an unhandled rejection.
          console.error(
            JSON.stringify({ message: "arming the alarm failed", error: String(error) }),
          );
        });
      }
    }
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
    state.subs.push({ subId, query: name, args: args.value });
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
  private broadcast(
    version: number,
    changes: readonly RowChange[],
    origin: WebSocket | undefined,
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        this.patchSocket(ws, version, changes, ws === origin);
      } catch (error) {
        // One socket's failure (a corrupt attachment, a closed socket) must not stop the others' patches. This one
        // would miss the version, so it closes and its client resumes.
        this.log("sync patch failed", { error });
        close(ws, CLOSE_INTERNAL_ERROR, "internal error");
      }
    }
  }

  /** One socket's patch for `version`; see `broadcast`. */
  private patchSocket(
    ws: WebSocket,
    version: number,
    changes: readonly RowChange[],
    origin: boolean,
  ): void {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state?.clientId) return;
    // No prototype: a subId such as `__proto__` stays an ordinary key.
    const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
    const failed: string[] = [];
    let touched = false;
    for (const sub of state.subs) {
      const query = findQuery(sub.query);
      let patch;
      try {
        if (!query) throw new Error(`Unknown query ${sub.query.slice(0, 64)}`);
        patch = subscriptionChanges(query, sub.args, changes);
      } catch (error) {
        this.log("query filter failed", { query: sub.query.slice(0, 64), error });
        failed.push(sub.subId);
        continue;
      }
      if (patch) {
        subs[sub.subId] = patch;
        touched = true;
      }
    }
    if (failed.length > 0) {
      // A patch at `version` says the whole socket holds it, which a subscription that missed this change does
      // not: refuse it first (the client lets go of its rows), so the patch claims only what it carries.
      state.subs = state.subs.filter((sub) => !failed.includes(sub.subId));
      ws.serializeAttachment(state);
      for (const subId of failed) {
        this.send(ws, { type: "error", subId, code: "internal", message: "Internal error" });
      }
    }
    if (touched || origin) {
      this.send(ws, { type: "patch", epoch: this.shard.epoch, version, subs });
    }
  }

  /**
   * A frame `parseClientMessage` refused. After `hello`, one whose id can still be read is refused alone with
   * `invalid_args` and the socket stays open (RFC 0004 "Shard server"): a `subscribe` gets its one answer, an
   * `error` with its `subId`; a `mutate` gets a failed `mutationResult`, as invalid args from `runMutation` would,
   * but not stored (it never ran). Anything else is a socket-level protocol error.
   */
  private malformed(ws: WebSocket, state: SocketState, data: unknown, reason: string): void {
    const id = state.clientId === null ? undefined : salvage(data);
    if (!id) return this.refuse(ws, reason);
    if ("subId" in id) {
      // Like any `subscribe`, it replaces a subscription with the same subId, here with nothing.
      state.subs = state.subs.filter((sub) => sub.subId !== id.subId);
      ws.serializeAttachment(state);
      return this.send(ws, { type: "error", code: "invalid_args", message: reason, ...id });
    }
    this.send(ws, {
      type: "mutationResult",
      mutationId: id.mutationId,
      ok: false,
      error: { code: "invalid_args", message: reason },
    });
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
      // A lost frame would make the next patch claim a version this socket never fully got: close it, so the
      // client reconnects and resumes from what it holds.
      this.log("sync send failed", { type: frame.type, error });
      close(ws, CLOSE_INTERNAL_ERROR, "send failed");
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

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
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

/**
 * Every close the shard makes goes through here: the attachment is marked closed first, so `receive` drops the
 * frames still queued behind the close (see there), then the socket closes.
 */
function close(ws: WebSocket, code: number, reason: string): void {
  try {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (state && typeof state === "object" && !state.closed) {
      ws.serializeAttachment({ ...state, closed: true });
    }
  } catch {
    // An unreadable attachment or a socket already gone: `readyState` still stops later frames.
  }
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
