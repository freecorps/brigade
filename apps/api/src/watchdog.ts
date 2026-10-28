// The external dead-man switch (RFC 0007 "Watching the watcher"). Once a minute the Cron Trigger asks the one
// `WatchdogDO` for a beat: a `brigade.heartbeat` event written to its own outbox and sent by its alarm through the same
// `OutboxDrain` the shards use, to the `brigade-events` Queue. The consumer (src/notify.ts) checks the relay takes its
// send token and reports back (`proved`); only a beat that made it all the way, quickly, with the relay taking the
// token, pings the operator's external check (`DEAD_MAN_URL`). The external check alerts on silence, so any stage that stops
// (the cron, Durable Objects, alarms, the drain, the Queue, the consumer, the relay) stops the pings and pages the
// operators through a channel outside Cloudflare. Inside Brigade the same state is `GET /health/paging`, which the
// dashboard shows.

import { DurableObject } from "cloudflare:workers";
import type { Actor } from "@freecorps/brigade-schema";
import { OUTBOX_SCHEMA, OutboxDrain, writeOutbox, type BrigadeEvent } from "./outbox.ts";

/** The single watchdog object's name. */
export const WATCHDOG_NAME = "watchdog";
/**
 * The `workspaceId` of the watchdog's events. `WORKSPACE_ID` refuses a leading underscore, so no workspace can have
 * it, and the consumer can route these events before it looks for a shard.
 */
export const SYSTEM_WORKSPACE = "_system";
export const HEARTBEAT_EVENT = "brigade.heartbeat";
export const STATUS_EVENT = "brigade.status_changed";
export const WATCHDOG_ACTOR: Actor = { kind: "system", id: "sys_watchdog", role: "admin" };

/**
 * The newest proved beat older than this (three missed minutes) makes the pipeline degraded; so does no beat at all.
 */
export const BEAT_STALE_MS = 3 * 60 * 1000;
/**
 * A proof that took longer than this to come back pings nothing, and shows as `pipeline_slow`, so the dashboard and
 * the external check agree.
 */
export const MAX_PROOF_LATENCY_MS = 2 * 60 * 1000;
/** How long the external check gets per ping. */
export const PING_TIMEOUT_MS = 5000;
/**
 * At most this many `brigade.status_changed` events an hour email the operators (`OPERATOR_EMAILS`), so a status that
 * flaps does not flood their inboxes; the rest are only logged.
 */
export const OPERATOR_EMAIL_HOURLY_CAP = 6;
/**
 * A deeper check (APNs, FCM, D1) failing transiently on this many proved beats in a row degrades the status and stops
 * the pings; fewer change nothing, so one slow answer does not page the operators.
 */
export const TRANSIENT_FAILURES_TO_DEGRADE = 3;

/**
 * What the consumer found at the relay: `ok` when it took the send token (src/notify.ts), `unauthorized` when it
 * refused it, `unreachable` for anything else.
 */
export type RelayHealth = "ok" | "unauthorized" | "unreachable" | "not_configured";
/**
 * What the beat's deeper checks found (Q19): the push providers through the relay's `GET /health?deep=1` (APNs took
 * the relay's provider token; FCM gave it an access token), and one cheap D1 read. `unknown`: not checked (an older
 * relay without the deep check, or no relay to ask).
 */
export type CheckHealth = "ok" | "error" | "not_configured" | "unknown";
/**
 * What one beat's check found, as the consumer reports it: `transient` is a failure that may pass by itself (a
 * provider or D1 not answering in time, a 5xx), which counts as `error` only after `TRANSIENT_FAILURES_TO_DEGRADE`
 * beats in a row; `error` (a refused key or account) counts at once.
 */
export type BeatCheck = CheckHealth | "transient";
export type BeatChecks = { apns: BeatCheck; fcm: BeatCheck; d1: BeatCheck };
export type DegradedReason =
  | "no_beat"
  | "pipeline_stalled"
  | "pipeline_slow"
  | "relay_unauthorized"
  | "relay_unreachable"
  | "relay_not_configured"
  | "apns_failing"
  | "fcm_failing"
  | "d1_failing";

/**
 * `GET /health/paging`, as the watchdog knows it. Coarse on purpose: no URLs, ids or error text. The route
 * (src/index.ts) trims it further by who asks (`pagingHealthFor`).
 */
export type PagingHealth = {
  /** `unknown` until the first beat is proved (a new deployment, or local dev where the cron never runs). */
  status: "ok" | "degraded" | "unknown";
  reasons: DegradedReason[];
  lastBeatAt: string | null;
  /** When a beat last made it through the queue and the consumer. */
  lastProvedAt: string | null;
  /** When a beat last made it through with the relay answering too: the last time a page could have gone out. */
  lastOkAt: string | null;
  external: { configured: boolean; lastPingAt: string | null; lastPingOk: boolean | null };
};

export type WatchdogEnv = {
  EVENTS: Queue;
  /**
   * The external check's ping URL (a healthchecks.io-style check, a self-hosted one, …): a secret, so no real
   * service is named in the repo. Optional: without it the watchdog still runs and the dashboard still shows it.
   */
  DEAD_MAN_URL?: string;
};

const STATE_SCHEMA = `
  create table if not exists watchdog_state (key text primary key, value text not null) without rowid;
  create table if not exists operator_emails (event_id text primary key, at integer not null) without rowid;
`;

type Keys =
  | "first_beat_at"
  | "last_beat_at"
  | "proved_beat_at"
  | "last_proved_at"
  | "last_ok_at"
  | "relay"
  | "apns"
  | "fcm"
  | "d1"
  | "apns_failures"
  | "fcm_failures"
  | "d1_failures"
  | "status"
  | "reasons"
  | "last_ping_at"
  | "last_ping_ok"
  | "beats";

export class WatchdogDO extends DurableObject<Env> {
  private readonly drain: OutboxDrain;
  private readonly drainPaused: boolean;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(OUTBOX_SCHEMA);
    ctx.storage.sql.exec(STATE_SCHEMA);
    // TEST ONLY, as in WorkspaceDO: the API's tests pause the drain and read the outbox.
    this.drainPaused = Reflect.get(env, "OUTBOX_DRAIN") === "paused";
    this.drain = new OutboxDrain(
      ctx.storage.sql,
      async (messages) => {
        await env.EVENTS.sendBatch(messages);
      },
      (message, fields) => log(message, fields),
    );
  }

  /**
   * The cron's minute (RPC from the Worker's `scheduled`): writes a heartbeat to the outbox and arms the alarm, which
   * drains it, so the alarm and the drain are part of what a proof proves. Returns the heartbeat's id.
   */
  async beat(now = Date.now()): Promise<string> {
    const event = this.ctx.storage.transactionSync(() => {
      const beats = Number(this.get("beats") ?? 0) + 1;
      const [heartbeat] = this.write(
        [{ type: HEARTBEAT_EVENT, data: { beat: beats } }],
        now,
        beats,
      );
      this.set("beats", String(beats));
      if (this.get("first_beat_at") === null) this.set("first_beat_at", String(now));
      this.set("last_beat_at", String(now));
      this.settle(now);
      return heartbeat!;
    });
    await this.armDrain(now);
    return event.id;
  }

  /**
   * A heartbeat came out of the Queue (RPC from the consumer), with what the consumer found at the relay and, from
   * its deeper checks, at APNs, FCM and D1 (`checks`; absent from an older consumer). Records it, and pings the
   * external check when the beat is the newest yet, came through within `MAX_PROOF_LATENCY_MS`, the relay took the
   * token and none of the deeper checks failed (APNs, FCM, D1; `not_configured` and `unknown` are not failures, and a
   * `transient` one only from the `TRANSIENT_FAILURES_TO_DEGRADE`th in a row). A redelivery, or a beat older than one already proved, changes nothing. The ping runs in
   * `waitUntil` (it keeps the object from being evicted, not the RPC from returning), so an external check that
   * hangs never holds up the consumer, and with it the pages in the same batch.
   */
  async proved(
    beatTime: string,
    relay: RelayHealth,
    now = Date.now(),
    checks?: BeatChecks,
  ): Promise<PagingHealth> {
    const beatAt = Date.parse(beatTime);
    const known = Number(this.get("proved_beat_at") ?? Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(beatAt) || beatAt <= known) return this.health(now);
    const failing = this.ctx.storage.transactionSync(() => {
      this.set("proved_beat_at", String(beatAt));
      this.set("last_proved_at", String(now));
      this.set("relay", relay);
      for (const key of ["apns", "fcm", "d1"] as const) this.check(key, checks?.[key] ?? "unknown");
      const failed = (["apns", "fcm", "d1"] as const).some((key) => this.get(key) === "error");
      // "The last time a page could have gone out": not while APNs, FCM or D1 is failing.
      if (relay === "ok" && !failed) this.set("last_ok_at", String(now));
      this.settle(now);
      return failed;
    });
    await this.armDrain(now);
    const pages = relay === "ok" && !failing;
    if (pages && now - beatAt <= MAX_PROOF_LATENCY_MS) this.ctx.waitUntil(this.ping(now));
    else if (pages) log("heartbeat too late to ping", { latencyMs: now - beatAt });
    return this.health(now);
  }

  /**
   * Whether the consumer may email the operators about the status change `eventId` (RPC): once per event (a
   * redelivery is refused) and at most `OPERATOR_EMAIL_HOURLY_CAP` events an hour.
   */
  async claimOperatorEmail(eventId: string, now = Date.now()): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    return this.ctx.storage.transactionSync(() => {
      sql.exec("delete from operator_emails where at < ?", now - 24 * 60 * 60 * 1000);
      if (sql.exec("select 1 from operator_emails where event_id = ?", eventId).toArray().length) {
        return false;
      }
      const { sent } = sql
        .exec<{ sent: number }>(
          "select count(*) as sent from operator_emails where at > ?",
          now - 60 * 60 * 1000,
        )
        .one();
      if (sent >= OPERATOR_EMAIL_HOURLY_CAP) return false;
      sql.exec("insert into operator_emails (event_id, at) values (?, ?)", eventId, now);
      return true;
    });
  }

  /** `GET /health/paging`: the state now, with the cron's silence counted too. */
  health(now = Date.now()): PagingHealth {
    const time = (key: Keys) => {
      const value = this.get(key);
      return value === null ? null : new Date(Number(value)).toISOString();
    };
    const pingOk = this.get("last_ping_ok");
    return {
      ...pagingStatus(
        {
          firstBeatAt: num(this.get("first_beat_at")),
          lastBeatAt: num(this.get("last_beat_at")),
          provedBeatAt: num(this.get("proved_beat_at")),
          lastProvedAt: num(this.get("last_proved_at")),
          relay: this.get("relay") as RelayHealth | null,
          apns: this.get("apns") as CheckHealth | null,
          fcm: this.get("fcm") as CheckHealth | null,
          d1: this.get("d1") as CheckHealth | null,
        },
        now,
      ),
      lastBeatAt: time("last_beat_at"),
      lastProvedAt: time("last_proved_at"),
      lastOkAt: time("last_ok_at"),
      external: {
        configured: pingUrl(this.env as WatchdogEnv) !== undefined,
        lastPingAt: time("last_ping_at"),
        lastPingOk: pingOk === null ? null : pingOk === "1",
      },
    };
  }

  /**
   * Records what a proved beat's check `key` found. A `transient` failure only counts until the
   * `TRANSIENT_FAILURES_TO_DEGRADE`th in a row, which records `error`; before it the check keeps what it was, so the
   * status does not change and the beat still pings. Anything else is recorded as it is and starts the count again.
   */
  private check(key: "apns" | "fcm" | "d1", found: BeatCheck): void {
    const count: Keys = `${key}_failures`;
    if (found !== "transient") {
      this.set(count, "0");
      this.set(key, found);
      return;
    }
    const failures = Number(this.get(count) ?? 0) + 1;
    this.set(count, String(failures));
    if (failures >= TRANSIENT_FAILURES_TO_DEGRADE) this.set(key, "error");
  }

  /** Drains the outbox to the Queue; comes back when a failed send's backoff ends. */
  override async alarm(): Promise<void> {
    if (this.drainPaused) return;
    try {
      await this.drain.drain(Date.now());
    } catch (error) {
      log("watchdog outbox drain failed", { error: String(error) });
      this.drain.failed(Date.now(), error);
    }
    const next = this.drain.nextWake(Date.now());
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  /**
   * Recomputes the status and, when it or its reasons changed, writes `brigade.status_changed` to the outbox and logs
   * it (Workers Logs alerts can watch for `paging pipeline degraded`). Runs only on a beat or a proof, so `no_beat`
   * (no beat is what runs it) is never logged or evented: only `GET /health/paging` and the external check see it.
   * Call inside a transaction.
   */
  private settle(now: number): void {
    const { status, reasons } = this.health(now);
    const previous = this.get("status");
    const key = JSON.stringify([...reasons].sort());
    if (previous === status && this.get("reasons") === key) return;
    this.set("status", status);
    this.set("reasons", key);
    // The first beat (nothing to unknown) is not a change anyone needs to hear about.
    if (previous === null && status === "unknown") return;
    this.write([{ type: STATUS_EVENT, data: { status, previous, reasons } }], now, 0);
    log(status === "degraded" ? "paging pipeline degraded" : "paging pipeline status changed", {
      status,
      previous,
      reasons,
    });
  }

  private write(events: { type: string; data: unknown }[], now: number, version: number) {
    return writeOutbox(this.ctx.storage.sql, events, {
      workspaceId: SYSTEM_WORKSPACE,
      shard: "watchdog",
      actor: WATCHDOG_ACTOR,
      now,
      version,
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    });
  }

  private async armDrain(now: number): Promise<void> {
    if (this.drainPaused) return;
    const at = Math.max(now, this.drain.retryAt() ?? now);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  /** One GET to the external check. A failure is recorded and logged; the next proved beat tries again. */
  private async ping(now: number): Promise<void> {
    const url = pingUrl(this.env as WatchdogEnv);
    if (url === undefined) return;
    let ok = false;
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      await response.body?.cancel();
      ok = response.ok;
      if (!ok) log("dead-man ping refused", { status: response.status });
    } catch (error) {
      log("dead-man ping failed", { error: String(error) });
    }
    // Pings run in `waitUntil` and can overlap; an older one finishing late must not overwrite a newer result.
    if (Number(this.get("last_ping_at") ?? 0) > now) return;
    this.set("last_ping_at", String(now));
    this.set("last_ping_ok", ok ? "1" : "0");
  }

  private get(key: Keys): string | null {
    const [row] = this.ctx.storage.sql
      .exec<{ value: string }>("select value from watchdog_state where key = ?", key)
      .toArray();
    return row?.value ?? null;
  }

  private set(key: Keys, value: string): void {
    this.ctx.storage.sql.exec(
      "insert into watchdog_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      key,
      value,
    );
  }
}

/**
 * The status from the recorded times (pure, so the rules are tested on their own):
 * - `no_beat`: the cron has not beaten for `BEAT_STALE_MS` (the cron or this object stopped);
 * - `pipeline_stalled`: the newest proved beat (or, before any, the first beat) is older than `BEAT_STALE_MS`, so
 *   beats stopped coming through or come through late (the alarm, the drain, the Queue or the consumer stopped, or
 *   the Queue is backed up);
 * - `pipeline_slow`: the last proof took longer than `MAX_PROOF_LATENCY_MS`, which pings nothing;
 * - `relay_unauthorized` / `relay_unreachable` / `relay_not_configured`: what the consumer found at the relay on the
 *   last proof;
 * - `apns_failing` / `fcm_failing` / `d1_failing`: the deeper checks (Q19): APNs refused the relay's provider token,
 *   FCM refused the service account, or (on `TRANSIENT_FAILURES_TO_DEGRADE` proofs in a row) a provider or the D1
 *   read did not answer.
 * With no beat yet, or beats but none proved and none overdue, it is `unknown`.
 */
export function pagingStatus(
  times: {
    firstBeatAt: number | null;
    lastBeatAt: number | null;
    /** The time of the newest beat proved (when the cron wrote it, not when it came back). */
    provedBeatAt: number | null;
    lastProvedAt: number | null;
    relay: RelayHealth | null;
    apns?: CheckHealth | null;
    fcm?: CheckHealth | null;
    d1?: CheckHealth | null;
  },
  now: number,
): Pick<PagingHealth, "status" | "reasons"> {
  const { firstBeatAt, lastBeatAt, provedBeatAt, lastProvedAt, relay } = times;
  if (lastBeatAt === null || firstBeatAt === null) return { status: "unknown", reasons: [] };
  const reasons: DegradedReason[] = [];
  if (now - lastBeatAt > BEAT_STALE_MS) reasons.push("no_beat");
  if (now - (provedBeatAt ?? firstBeatAt) > BEAT_STALE_MS) reasons.push("pipeline_stalled");
  if (provedBeatAt !== null && lastProvedAt !== null) {
    if (lastProvedAt - provedBeatAt > MAX_PROOF_LATENCY_MS) reasons.push("pipeline_slow");
  }
  if (relay === "unauthorized") reasons.push("relay_unauthorized");
  if (relay === "unreachable") reasons.push("relay_unreachable");
  if (relay === "not_configured") reasons.push("relay_not_configured");
  if (times.apns === "error") reasons.push("apns_failing");
  if (times.fcm === "error") reasons.push("fcm_failing");
  if (times.d1 === "error") reasons.push("d1_failing");
  if (reasons.length > 0) return { status: "degraded", reasons };
  return { status: lastProvedAt === null ? "unknown" : "ok", reasons };
}

/**
 * `DEAD_MAN_URL` when it is usable: `https:`, or `http:` on a loopback host for the local double
 * (scripts/dead-man-double.mjs). Anything else is logged and ignored, as if unset.
 */
export function pingUrl(env: Pick<WatchdogEnv, "DEAD_MAN_URL">): URL | undefined {
  const raw = env.DEAD_MAN_URL;
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    log("DEAD_MAN_URL is not a URL; ignored", {});
    return undefined;
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol === "https:" || (url.protocol === "http:" && loopback)) return url;
  log("DEAD_MAN_URL must be https; ignored", { protocol: url.protocol });
  return undefined;
}

/** A heartbeat off the queue, if `body` is one: the watchdog's events never reach a shard. */
export function isSystemEvent(body: unknown): body is BrigadeEvent {
  return (
    typeof body === "object" &&
    body !== null &&
    Reflect.get(body, "workspaceId") === SYSTEM_WORKSPACE &&
    typeof Reflect.get(body, "type") === "string" &&
    typeof Reflect.get(body, "time") === "string"
  );
}

function num(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, shard: "watchdog", ...fields }));
}
