// The Brigade Sync adapter (RFC 0016 "Clients"): `/sync/:workspace` of a workspace on Ember, for app versions that
// only speak Brigade Sync (RFC 0004). The Worker holds the client's socket and opens one Ember socket to the
// workspace's shard on its behalf, as the same actor, and translates frames, not rules: both sides run the same named
// mutations and queries (`workspace:mutate`, `workspace:query`).
//
// - `hello` opens the Ember side with a token minted for the socket's actor and session; `subscribe` is a `sub` of
//   `workspace:query`, `unsubscribe` an `unsub`, `mutate` a `mut` of `workspace:mutate` under its own mutation id
//   (Ember de-duplicates it by client id and mid, as the DO did); `ping` is answered here.
// - Ember's `snap` is a `snapshot`, its `patch` a `patch` holding each subscription's changes (rows that entered or
//   changed, ids that left, against the rows sent last), its `mres` a `mutationResult`. Ember's version and epoch are
//   the shard's, so they are Brigade's too; Ember sends a mutation's patch (`mids`) before its result, which is the
//   order RFC 0004 promises. A resume always gets a `snapshot` (the protocol allows it).
// - The token lasts at most 5 minutes; it is minted again before it expires (or when Ember says it did), and each
//   time the session and the member are checked in D1 again (`verifyIdentity`, the auth hook's own checks). One that
//   no longer passes closes the socket (`1012`): no adapter socket outlives its session or membership by more than
//   those 5 minutes, and none outlives the session's expiry.
//
// The socket's admission is `clients:admit` (src/ember-clients.ts), as for any Ember client.

import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ServerMessage,
  type SubscriptionChanges,
  type WireRow,
} from "@freecorps/brigade-sync/protocol";
import type { Actor } from "@freecorps/brigade-schema";
import type { ActorResult } from "./actor.ts";
import { ember, verifyIdentity, workspaceShard } from "./ember.ts";
import { admitToEmber } from "./ember-clients.ts";
import { mintEmberToken } from "./ember-token.ts";

const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_SERVICE_RESTART = 1012;

/** A token is minted again this long before it expires. */
export const ADAPTER_REFRESH_AHEAD_MS = 30 * 1000;
/** No refresh sooner than this after the last one, whatever the token's lifetime. */
const MIN_REFRESH_MS = 5 * 1000;
/** The longest a timer waits (2^31 - 1 ms). */
const MAX_TIMER_MS = 2 ** 31 - 1;

type Resolved = Extract<ActorResult, { ok: true }>;
type AdapterEnv = Env;

type EmberFrame =
  | { t: "ready"; shard: string; version: number; epoch: string }
  | { t: "snap"; qid: string; version: number; value: unknown }
  | { t: "patch"; version: number; changes: { qid: string; value: unknown }[]; mids: string[] }
  | { t: "mres"; mid: string; ok: true; value: unknown; version: number }
  | { t: "mres"; mid: string; ok: false; error: { code: string; message: string } }
  | { t: "err"; code: string; message: string; qid?: string }
  | { t: "authExpired" };

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** A query's answer as Brigade's queries give it (`QueryResult`): its rows, or why not. */
function rowsOf(
  value: unknown,
): { ok: true; rows: WireRow[] } | { ok: false; code: string; message: string } {
  const result = value as {
    ok?: boolean;
    rows?: WireRow[];
    error?: { code: string; message: string };
  };
  if (result?.ok === true && Array.isArray(result.rows)) return { ok: true, rows: result.rows };
  return {
    ok: false,
    code: result?.error?.code ?? "internal",
    message: result?.error?.message ?? "Query failed",
  };
}

/** What changed between the rows sent last (by id, as JSON) and `rows`. */
function changesOf(
  last: Map<string, string>,
  rows: WireRow[],
): { changes: SubscriptionChanges; next: Map<string, string> } {
  const next = new Map(rows.map((row) => [row.id, JSON.stringify(row)] as const));
  const upserts = rows.filter((row) => last.get(row.id) !== next.get(row.id));
  const deletes = [...last.keys()].filter((id) => !next.has(id));
  return { changes: { upserts, deletes }, next };
}

/**
 * Serves a Brigade Sync upgrade for `workspaceId` on its Ember shard, for the caller the Worker resolved (`resolved`).
 * Answers 101 with the client's socket, or the refusal the DO would give (403 `not_a_member`, 401, 503).
 */
export async function openSyncOnEmber(
  request: Request,
  env: AdapterEnv,
  ctx: ExecutionContext,
  workspaceId: string,
  resolved: Resolved,
): Promise<Response> {
  const { actor, sessionId, sessionExpiresAt } = resolved;
  if (sessionExpiresAt !== undefined && sessionExpiresAt <= Date.now()) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  // A member's socket names their session; only the dev actor (local runs) has none, and Ember backs no such actor.
  if (actor.kind !== "token" && sessionId === undefined) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const admitted = await admitToEmber(
    env,
    workspaceId,
    {
      actor,
      ...(resolved.name !== undefined ? { name: resolved.name } : {}),
      ...(resolved.resetAt !== undefined ? { resetAt: resolved.resetAt } : {}),
    },
    ctx.waitUntil.bind(ctx),
  );
  if (!admitted.ok) {
    const status = { not_found: 500, not_a_member: 403, unauthenticated: 401, unavailable: 503 };
    return Response.json(
      { error: admitted.code === "not_found" ? "internal" : admitted.code },
      {
        status: status[admitted.code],
      },
    );
  }
  const shard = workspaceShard(workspaceId);
  const mint = async (): Promise<{ token: string; expiresAt: number } | null> => {
    const minted = await mintEmberToken(
      env.BETTER_AUTH_SECRET,
      {
        sub: actor.id,
        ws: workspaceId,
        role: actor.role,
        ...(actor.kind === "token" ? { kind: "token" as const } : {}),
        ...(sessionId === undefined ? {} : { sid: sessionId }),
      },
      Date.now(),
      sessionExpiresAt,
    );
    if (!minted) return null;
    // The auth hook's own D1 checks (the session still there, the member still backing the actor): what every
    // refresh of an Ember client goes through.
    if (!(await verifyIdentity(env, minted.token))) return null;
    return minted;
  };
  const first = await mint();
  if (!first) return Response.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(request.url);
  const upstreamResponse = await ember.fetch(
    new Request(`${url.origin}/ember/ws?shard=${encodeURIComponent(shard)}`, {
      headers: { Upgrade: "websocket" },
    }),
    env as never,
    ctx,
  );
  const upstream = upstreamResponse.webSocket;
  if (!upstream) {
    log("the Ember shard refused the adapter's socket", {
      workspace: workspaceId,
      status: upstreamResponse.status,
    });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  upstream.accept();
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  new Adapter(server, upstream, actor, first, mint, sessionExpiresAt, workspaceId).start();
  return new Response(null, { status: 101, webSocket: client });
}

class Adapter {
  private clientId: string | null = null;
  private epoch = "";
  /** Per subscription: the rows sent last (by id, as JSON); a subscription is here once Ember answered it. */
  private readonly sent = new Map<string, Map<string, string>>();
  private refresh: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(
    private readonly client: WebSocket,
    private readonly upstream: WebSocket,
    private readonly actor: Actor,
    private token: { token: string; expiresAt: number },
    private readonly mint: () => Promise<{ token: string; expiresAt: number } | null>,
    private readonly sessionExpiresAt: number | undefined,
    private readonly workspaceId: string,
  ) {}

  start(): void {
    this.client.addEventListener("message", (event) => this.fromClient(event.data));
    this.client.addEventListener("close", () => this.close(1000, "closed"));
    this.client.addEventListener("error", () => this.close(CLOSE_INTERNAL_ERROR, "client error"));
    this.upstream.addEventListener("message", (event) => this.fromEmber(event.data));
    this.upstream.addEventListener("close", (event) =>
      // Ember closed its side: the client reconnects and resumes, as after any shard restart.
      this.close(CLOSE_SERVICE_RESTART, event.reason || "shard closed"),
    );
    this.upstream.addEventListener("error", () =>
      this.close(CLOSE_SERVICE_RESTART, "shard socket error"),
    );
    this.armExpiry();
    this.arm();
  }

  /** Closes the socket at the session's expiry, in steps no longer than a timer can wait. */
  private armExpiry(): void {
    if (this.sessionExpiresAt === undefined || this.closed) return;
    const left = this.sessionExpiresAt - Date.now();
    if (left <= 0) return this.close(CLOSE_SERVICE_RESTART, "session expired");
    this.expiry = setTimeout(() => this.armExpiry(), Math.min(left, MAX_TIMER_MS));
  }

  /** Mints the next token ahead of this one's expiry. */
  private arm(): void {
    clearTimeout(this.refresh);
    // A token capped at the session's expiry is the last one: the socket closes then (`armExpiry`).
    if (this.sessionExpiresAt !== undefined && this.token.expiresAt >= this.sessionExpiresAt)
      return;
    const at = this.token.expiresAt - ADAPTER_REFRESH_AHEAD_MS;
    this.refresh = setTimeout(
      () => void this.renew(),
      Math.min(MAX_TIMER_MS, Math.max(MIN_REFRESH_MS, at - Date.now())),
    );
  }

  /** A fresh token after D1's checks, sent to Ember; the socket closes when they no longer pass. */
  private async renew(): Promise<void> {
    if (this.closed) return;
    let next: { token: string; expiresAt: number } | null;
    try {
      next = await this.mint();
    } catch (error) {
      // D1 could not say: the socket closes and the client reconnects, as the DO's sockets do on a restart.
      log("renewing an adapter socket's token failed", { error: String(error) });
      return this.close(CLOSE_SERVICE_RESTART, "unavailable");
    }
    if (!next) {
      return this.close(
        this.actor.kind === "token" ? CLOSE_POLICY_VIOLATION : CLOSE_SERVICE_RESTART,
        this.actor.kind === "token" ? "token ended" : "signed out",
      );
    }
    this.token = next;
    this.toEmber({ t: "auth", token: next.token });
    this.arm();
  }

  private send(frame: ServerMessage): void {
    if (this.closed) return;
    try {
      this.client.send(JSON.stringify(frame));
    } catch (error) {
      log("sending to an adapter socket failed", { error: String(error) });
      this.close(CLOSE_INTERNAL_ERROR, "send failed");
    }
  }

  private toEmber(frame: Record<string, unknown>): void {
    if (this.closed) return;
    try {
      this.upstream.send(JSON.stringify(frame));
    } catch (error) {
      log("sending to the Ember shard failed", { error: String(error) });
      this.close(CLOSE_SERVICE_RESTART, "shard socket failed");
    }
  }

  /** A socket-level refusal: told, then closed, as the DO does (`protocol`). */
  private refuse(message: string): void {
    this.send({ type: "error", code: "protocol", message });
    this.close(CLOSE_POLICY_VIOLATION, message);
  }

  private fromClient(data: unknown): void {
    if (this.closed) return;
    const parsed = parseClientMessage(data);
    if (!parsed.ok) return this.refuse(parsed.reason);
    const message = parsed.message;
    if (message.type === "ping") return this.send({ type: "pong" });
    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL_VERSION) return this.refuse("Unsupported protocol");
      if (this.clientId !== null) return this.refuse("hello twice");
      this.clientId = message.clientId;
      return this.toEmber({
        t: "hello",
        clientId: message.clientId,
        token: this.token.token,
        protocol: 1,
      });
    }
    if (this.clientId === null) return this.refuse("hello first");
    switch (message.type) {
      case "subscribe":
        // A re-subscribe replaces the old one; the client holds nothing for it until its snapshot.
        this.sent.delete(message.subId);
        return this.toEmber({
          t: "sub",
          qid: message.subId,
          fn: "workspace:query",
          args: { name: message.query, args: message.args ?? {} },
        });
      case "unsubscribe":
        this.sent.delete(message.subId);
        return this.toEmber({ t: "unsub", qid: message.subId });
      case "mutate":
        return this.toEmber({
          t: "mut",
          mid: message.mutationId,
          fn: "workspace:mutate",
          args: { name: message.name, args: message.args ?? {} },
        });
    }
  }

  private fromEmber(data: unknown): void {
    if (this.closed) return;
    let frame: EmberFrame;
    try {
      frame = JSON.parse(String(data)) as EmberFrame;
    } catch {
      log("an Ember frame could not be read", { workspace: this.workspaceId });
      return;
    }
    switch (frame.t) {
      case "ready":
        this.epoch = frame.epoch;
        return;
      case "snap": {
        const subId = String(frame.qid);
        const result = rowsOf(frame.value);
        if (!result.ok) {
          this.sent.delete(subId);
          return this.send({ type: "error", subId, code: result.code, message: result.message });
        }
        this.sent.set(subId, new Map(result.rows.map((row) => [row.id, JSON.stringify(row)])));
        return this.send({
          type: "snapshot",
          subId,
          epoch: this.epoch,
          version: frame.version,
          rows: result.rows,
        });
      }
      case "patch": {
        const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
        for (const change of frame.changes) {
          const subId = String(change.qid);
          const last = this.sent.get(subId);
          // Not answered yet, or dropped: its snapshot comes on its own.
          if (!last) continue;
          const result = rowsOf(change.value);
          if (!result.ok) {
            this.sent.delete(subId);
            this.send({ type: "error", subId, code: result.code, message: result.message });
            continue;
          }
          const { changes, next } = changesOf(last, result.rows);
          this.sent.set(subId, next);
          if (changes.upserts.length > 0 || changes.deletes.length > 0) subs[subId] = changes;
        }
        // As the DO's broadcast: the socket a mutation came from always gets its version, so the client can drop
        // what it applied optimistically; others only when something they hold changed.
        if (Object.keys(subs).length === 0 && frame.mids.length === 0) return;
        return this.send({ type: "patch", epoch: this.epoch, version: frame.version, subs });
      }
      case "mres": {
        const mutationId = String(frame.mid);
        if (!frame.ok) {
          return this.send({
            type: "mutationResult",
            mutationId,
            ok: false,
            error: { code: frame.error.code as never, message: frame.error.message },
          });
        }
        // `workspace:mutate` answers Brigade's own result: refused for what it holds, or done at `version`.
        const value = frame.value as { ok: boolean; error?: { code: string; message: string } };
        if (value?.ok === false && value.error) {
          return this.send({
            type: "mutationResult",
            mutationId,
            ok: false,
            error: value.error as never,
          });
        }
        return this.send({ type: "mutationResult", mutationId, ok: true, version: frame.version });
      }
      case "err":
        if (frame.qid !== undefined) {
          const subId = String(frame.qid);
          this.sent.delete(subId);
          return this.send({ type: "error", subId, code: frame.code, message: frame.message });
        }
        log("the Ember shard refused the adapter's socket", {
          workspace: this.workspaceId,
          code: frame.code,
        });
        return this.close(
          frame.code === "unauthenticated" ? CLOSE_SERVICE_RESTART : CLOSE_INTERNAL_ERROR,
          frame.code,
        );
      case "authExpired":
        void this.renew();
        return;
    }
  }

  private close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.refresh);
    clearTimeout(this.expiry);
    for (const socket of [this.client, this.upstream]) {
      try {
        socket.close(code === 1000 ? 1000 : code, reason.slice(0, 120));
      } catch {
        // Already closed.
      }
    }
  }
}
