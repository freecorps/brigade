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
import { emailSender, type EmailEnv, type EmailSender } from "./email.ts";
import { notifyOperators, providerAnswer, type OperatorEnv } from "./notify-operators.ts";
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
 * Half a minute past the cron's third minute, not on it: the beat that finds three unproved minutes behind it is
 * written a second or so before its own proof comes back, and an exact 3 minutes made that beat `pipeline_stalled`
 * and its proof `ok` again a second later (two operator emails in one minute).
 */
export const BEAT_STALE_MS = 3.5 * 60 * 1000;
/**
 * A proof that took longer than this to come back pings nothing; on the `TRANSIENT_FAILURES_TO_DEGRADE`th in a row it
 * shows as `pipeline_slow`. One late beat (a Queue batch that waited) says little: a Queue that stays backed up is
 * three in a row, and one stopped is `pipeline_stalled`.
 */
export const MAX_PROOF_LATENCY_MS = 2 * 60 * 1000;
/** How long the external check gets per ping. */
export const PING_TIMEOUT_MS = 5000;
/**
 * At most this many `brigade.status_changed` events an hour email the operators (`OPERATOR_EMAILS`), so a status that
 * flaps does not flood their inboxes; the rest are only logged.
 */
export const OPERATOR_EMAIL_HOURLY_CAP = 6;
/** How many times the watchdog tries one status change's email, a minute apart (a beat), before it gives up. */
export const OPERATOR_EMAIL_TRIES = 5;
/** Just under the cron's minute, so a failure on a proof (a few seconds after its beat) is tried on the next beat. */
const OPERATOR_EMAIL_RETRY_MS = 50 * 1000;
/**
 * How long a status change waits before it is emailed, so a change that is undone within it (a beat degraded and its
 * proof a second later back to ok) emails nobody. A beat and its proof each send what is due, so in practice a change
 * goes out with the second beat after it, about two minutes later. The external check (`DEAD_MAN_URL`) is what pages;
 * this email only says why.
 */
export const OPERATOR_EMAIL_HOLD_MS = 90 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/**
 * A check failing transiently on this many proved beats in a row degrades the status and stops the pings; fewer change
 * nothing, so one slow answer does not page the operators. Transient: a deeper check (APNs, FCM, D1) the consumer
 * marks so, the relay not answering (`unreachable`) or limiting (`rate_limited`), for its deep check and for the send
 * token's, and a proof later than `MAX_PROOF_LATENCY_MS` (`pipeline_slow`).
 */
export const TRANSIENT_FAILURES_TO_DEGRADE = 3;

/**
 * What the consumer found at the relay: `ok` when it took the send token or the instance's signature (src/notify.ts),
 * `unauthorized` when it refused the send token, `unreachable` for anything else. With an instance key (RFC 0015
 * section 7), the signed deep health's own refusals: `bad_signature` (a key the relay does not take, or one that does
 * not read), `instance_unregistered` (not registered yet, or registered on another relay), `instance_revoked`,
 * `rate_limited` (the relay's limits), and `handles_unavailable` (the relay answers but cannot open handles).
 */
export type RelayHealth =
  | "ok"
  | "unauthorized"
  | "unreachable"
  | "not_configured"
  | "bad_signature"
  | "instance_unregistered"
  | "instance_revoked"
  | "rate_limited"
  | "handles_unavailable";
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
export type BeatChecks = {
  apns: BeatCheck;
  fcm: BeatCheck;
  d1: BeatCheck;
  /**
   * The send token's own check (`POST /send` with no body) when the relay's answer was its signed deep check and
   * `RELAY_SEND_TOKEN` is set too (RFC 0015 section 9: raw-token phones still page through `/send`). Absent otherwise.
   */
  sendToken?: RelayHealth;
  /**
   * This instance's own APNs key and Firebase account (src/direct-push.ts `directHealth`, Q34), when it sends pages
   * itself; absent when it does not. A failure here never degrades the status: pages still go out, through the relay.
   */
  directApns?: BeatCheck;
  directFcm?: BeatCheck;
  /**
   * What a failing check was answered, in one word (src/notify-operators.ts `providerAnswer`): APNs' `reason`, or
   * what the check made of no answer (`unreachable`, `status_500`). Kept while the check counts as failing, for the
   * operators' email and the log; never part of `GET /health/paging`. Absent from an older consumer.
   */
  answers?: { apns?: string; fcm?: string; directApns?: string; directFcm?: string };
};
export type DegradedReason =
  | "no_beat"
  | "pipeline_stalled"
  | "pipeline_slow"
  | "relay_unauthorized"
  | "relay_unreachable"
  | "relay_not_configured"
  | "relay_bad_signature"
  | "relay_instance_unregistered"
  | "relay_instance_revoked"
  | "relay_rate_limited"
  | "relay_handles_unavailable"
  | "apns_failing"
  | "fcm_failing"
  | "d1_failing"
  /**
   * This instance's own push key (`BeatChecks.directApns`/`directFcm`) is failing: pages go through the relay instead,
   * so these never make the status `degraded`; they are told to the operators (src/notify-operators.ts).
   */
  | "direct_apns_failing"
  | "direct_fcm_failing";

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

export type WatchdogEnv = EmailEnv &
  OperatorEnv & {
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
  create table if not exists operator_email_queue (
    event_id text primary key, event text not null, tries integer not null, next_at integer not null
  ) without rowid;
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
  | "direct_apns"
  | "direct_fcm"
  | "direct_apns_failures"
  | "direct_fcm_failures"
  | "apns_answer"
  | "fcm_answer"
  | "direct_apns_answer"
  | "direct_fcm_answer"
  | "send_token"
  | "relay_failures"
  | "send_token_failures"
  | "slow_proofs"
  | "slow"
  | "status"
  | "reasons"
  /** What the operators were last told (`stateKey`): a change back to it before its email went out emails nobody. */
  | "notified"
  | "last_ping_at"
  | "last_ping_ok"
  | "beats";

export class WatchdogDO extends DurableObject<Env> {
  private readonly drain: OutboxDrain;
  private readonly drainPaused: boolean;
  /** `PING_TIMEOUT_MS`; a field so tests can shorten it. */
  private pingTimeoutMs = PING_TIMEOUT_MS;
  /** The operators' email sender; a field so tests can stand one in. */
  private mail: () => EmailSender | undefined = () => emailSender(this.env as WatchdogEnv);
  /** Whether `emailOperators` is running, so a beat and a proof close together do not send the same email twice. */
  private emailing = false;

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
    this.ctx.waitUntil(this.emailOperators(now));
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
    const pages = this.ctx.storage.transactionSync(() => {
      this.set("proved_beat_at", String(beatAt));
      this.set("last_proved_at", String(now));
      this.slowCheck(now - beatAt > MAX_PROOF_LATENCY_MS);
      const recorded = this.relayCheck("relay", relay);
      const token = this.relayCheck("send_token", checks?.sendToken);
      const answers = checks?.answers;
      this.check("apns", checks?.apns ?? "unknown", answers?.apns);
      this.check("fcm", checks?.fcm ?? "unknown", answers?.fcm);
      this.check("d1", checks?.d1 ?? "unknown");
      // Not part of what pages need (the relay is their fallback), so not part of `failed` below.
      for (const [key, found, answer] of [
        ["direct_apns", checks?.directApns, answers?.directApns],
        ["direct_fcm", checks?.directFcm, answers?.directFcm],
      ] as const) {
        if (found === undefined) {
          this.delete(key);
          this.delete(`${key}_failures`);
          this.delete(`${key}_answer`);
        } else this.check(key, found, answer);
      }
      const failed = (["apns", "fcm", "d1"] as const).some((key) => this.get(key) === "error");
      // "The last time a page could have gone out": not while APNs, FCM or D1 is failing, nor the send token.
      // A send token not known yet (its every answer so far transient) is no failure either, as for the providers.
      const up = recorded === "ok" && (token === null || token === "ok") && !failed;
      if (up) this.set("last_ok_at", String(now));
      this.settle(now);
      return up;
    });
    this.ctx.waitUntil(this.emailOperators(now));
    await this.armDrain(now);
    if (pages && now - beatAt <= MAX_PROOF_LATENCY_MS) this.ctx.waitUntil(this.ping(now));
    else if (pages) log("heartbeat too late to ping", { latencyMs: now - beatAt });
    return this.health(now);
  }

  /**
   * Emails the operators the status change waiting in `operator_email_queue` (`settle` puts it there, in the same
   * transaction as the change), from here, not through the outbox, the Queue and the consumer: a stalled Queue is one
   * of the things it reports, and an email waiting in it would arrive with the recovery. Runs in `waitUntil` after
   * every beat and proof. The queue holds one change, the newest (`settle` replaces the one before), and it waits
   * `OPERATOR_EMAIL_HOLD_MS`; when it comes back to what the operators were last told (`notified`) before it goes, it
   * goes nowhere: a flap that passed emails nobody, and a "degraded" whose send failed is never sent after the status
   * is back to normal. One that failed, or never finished (the object evicted mid-send), is tried again a minute
   * later, up to `OPERATOR_EMAIL_TRIES` times. At most `OPERATOR_EMAIL_HOURLY_CAP` are emailed an hour; past it the
   * change waits for the hour to free a place (and is dropped if the status comes back meanwhile). Never throws.
   */
  private async emailOperators(now: number): Promise<void> {
    if (this.emailing) return;
    this.emailing = true;
    const sql = this.ctx.storage.sql;
    try {
      const rows = sql
        .exec<{ event_id: string; event: string; tries: number; next_at: number }>(
          "select event_id, event, tries, next_at from operator_email_queue",
        )
        .toArray()
        .map((row) => ({ ...row, change: JSON.parse(row.event) as BrigadeEvent }));
      // One change at most since `settle` replaces it; a queue from before that keeps its newest.
      rows.sort((a, b) => Date.parse(a.change.time) - Date.parse(b.change.time));
      const row = rows.pop();
      for (const older of rows) {
        sql.exec("delete from operator_email_queue where event_id = ?", older.event_id);
      }
      if (!row) return;
      const told = changeKey(row.change);
      if (sameState(told, this.get("notified"))) {
        log("operator email not sent: back to what was last emailed", { event: row.event_id });
        sql.exec("delete from operator_email_queue where event_id = ?", row.event_id);
        return;
      }
      if (row.next_at > now) return;
      sql.exec("delete from operator_emails where at < ?", now - 24 * 60 * 60 * 1000);
      const sent = sql
        .exec<{ at: number }>(
          "select at from operator_emails where at > ? order by at",
          now - HOUR_MS,
        )
        .toArray();
      if (sent.length >= OPERATOR_EMAIL_HOURLY_CAP) {
        log("operator email held: capped", { event: row.event_id });
        // When the oldest of the hour's emails leaves the hour.
        sql.exec(
          "update operator_email_queue set next_at = ? where event_id = ?",
          sent[0]!.at + HOUR_MS + 1,
          row.event_id,
        );
        return;
      }
      const outcome = await notifyOperators(row.change, this.env as WatchdogEnv, this.mail());
      if (outcome === "sent") {
        sql.exec(
          "insert or ignore into operator_emails (event_id, at) values (?, ?)",
          row.event_id,
          now,
        );
      }
      // Skipped (nobody to email) counts as told: nobody is left to tell of it.
      if (outcome !== "failed") this.set("notified", told);
      if (outcome !== "failed" || row.tries + 1 >= OPERATOR_EMAIL_TRIES) {
        if (outcome === "failed")
          log("operator email given up", { event: row.event_id, tries: row.tries + 1 });
        sql.exec("delete from operator_email_queue where event_id = ?", row.event_id);
      } else {
        // A no-op when `settle` replaced the change while it was being sent: the newer one waits its own turn.
        sql.exec(
          "update operator_email_queue set tries = tries + 1, next_at = ? where event_id = ?",
          now + OPERATOR_EMAIL_RETRY_MS,
          row.event_id,
        );
      }
    } catch (error) {
      log("operator email failed", { error: String(error) });
    } finally {
      this.emailing = false;
    }
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
          slow: this.get("slow") === "1",
          relay: this.get("relay") as RelayHealth | null,
          sendToken: this.get("send_token") as RelayHealth | null,
          apns: this.get("apns") as CheckHealth | null,
          fcm: this.get("fcm") as CheckHealth | null,
          d1: this.get("d1") as CheckHealth | null,
          directApns: this.get("direct_apns") as CheckHealth | null,
          directFcm: this.get("direct_fcm") as CheckHealth | null,
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
   * `answer` (what this failure was answered, `BeatChecks.answers`) is kept only while the check counts as failing, so
   * the change `settle` writes can say it.
   */
  private check(
    key: "apns" | "fcm" | "d1" | "direct_apns" | "direct_fcm",
    found: BeatCheck,
    answer?: string,
  ): void {
    const count: Keys = `${key}_failures`;
    if (found !== "transient") {
      this.set(count, "0");
      this.set(key, found);
    } else {
      const failures = Number(this.get(count) ?? 0) + 1;
      this.set(count, String(failures));
      if (failures >= TRANSIENT_FAILURES_TO_DEGRADE) this.set(key, "error");
    }
    if (key === "d1") return;
    const failing = this.get(key) === "error";
    const said = found === "error" || found === "transient" ? providerAnswer(answer) : undefined;
    if (failing && said !== undefined) this.set(`${key}_answer`, said);
    // Not failing, or failing with no word for it (an older consumer): what an earlier failure said does not stay.
    else this.delete(`${key}_answer`);
  }

  /**
   * Records what a proved beat found at the relay (`relay`), or the send token's own check beside it (`send_token`,
   * absent when it did not run), and returns what counts. Not answering (`unreachable`) and its limits
   * (`rate_limited`) are transient: a relay or a provider behind it slow for one beat, a deploy, a network blip; and
   * the signed deep check is limited per caller IP, while instances on Workers may share Cloudflare's egress addresses
   * (Q28). Until the `TRANSIENT_FAILURES_TO_DEGRADE`th in a row the check keeps what it was (nothing, before any
   * answer); anything else (a refused token or signature, an instance unregistered or revoked, no relay configured) is
   * recorded as it is, at once, and starts the count again.
   */
  private relayCheck(
    key: "relay" | "send_token",
    found: RelayHealth | undefined,
  ): RelayHealth | null {
    const count: Keys = `${key}_failures`;
    if (found === undefined) {
      this.delete(key);
      this.delete(count);
      return null;
    }
    if (found !== "unreachable" && found !== "rate_limited") {
      this.set(count, "0");
      this.set(key, found);
      return found;
    }
    const failures = Number(this.get(count) ?? 0) + 1;
    this.set(count, String(failures));
    if (failures >= TRANSIENT_FAILURES_TO_DEGRADE) this.set(key, found);
    return this.get(key) as RelayHealth | null;
  }

  /**
   * Records whether a proof came back later than `MAX_PROOF_LATENCY_MS`: `pipeline_slow` from the
   * `TRANSIENT_FAILURES_TO_DEGRADE`th in a row, gone with the first that is not. A slow proof pings nothing either way.
   */
  private slowCheck(slow: boolean): void {
    if (!slow) {
      this.set("slow_proofs", "0");
      this.delete("slow");
      return;
    }
    const proofs = Number(this.get("slow_proofs") ?? 0) + 1;
    this.set("slow_proofs", String(proofs));
    if (proofs >= TRANSIENT_FAILURES_TO_DEGRADE) this.set("slow", "1");
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
   * Recomputes the status and, when it or its reasons changed, writes `brigade.status_changed` to the outbox, puts it
   * in the operators' email queue in place of any change still waiting there (`emailOperators`), and logs it (Workers Logs alerts can watch for `paging pipeline
   * degraded`). Runs only on a beat or a proof, so `no_beat` (no beat is what runs it) is never logged or evented:
   * only `GET /health/paging` and the external check see it. Call inside a transaction.
   */
  private settle(now: number): void {
    const { status, reasons } = this.health(now);
    const previous = this.get("status");
    const key = JSON.stringify([...reasons].sort());
    const previousKey = this.get("reasons");
    if (previous === status && previousKey === key) return;
    // A watchdog from before `notified` was kept: what it recorded last was emailed as it changed.
    if (this.get("notified") === null && previous !== null) {
      this.set("notified", stateKey(previous, previousKey ?? "[]"));
    }
    this.set("status", status);
    this.set("reasons", key);
    // The first beat (nothing to unknown) is not a change anyone needs to hear about.
    if (previous === null && status === "unknown") return;
    // What each failing check listed was answered, by reason: for the operators (their email, this log).
    const answers: Partial<Record<DegradedReason, string>> = {};
    for (const [reason, key] of ANSWER_KEYS) {
      const answer = reasons.includes(reason) ? this.get(key) : null;
      if (answer !== null) answers[reason] = answer;
    }
    const said = Object.keys(answers).length > 0 ? { answers } : {};
    const [change] = this.write(
      [{ type: STATUS_EVENT, data: { status, previous, reasons, ...said } }],
      now,
      0,
    );
    log(status === "degraded" ? "paging pipeline degraded" : "paging pipeline status changed", {
      status,
      previous,
      reasons,
      ...said,
    });
    // The newest change replaces the one waiting: the operators hear of the status as it is, once it held for
    // `OPERATOR_EMAIL_HOLD_MS`. One already waiting for something the operators were not told keeps its turn, so a
    // status that keeps changing is still emailed.
    const sql = this.ctx.storage.sql;
    const notified = this.get("notified");
    const waiting = sql
      .exec<{ event: string; next_at: number }>("select event, next_at from operator_email_queue")
      .toArray()
      .filter((row) => !sameState(changeKey(JSON.parse(row.event) as BrigadeEvent), notified))
      .map((row) => row.next_at);
    sql.exec("delete from operator_email_queue");
    sql.exec(
      "insert into operator_email_queue (event_id, event, tries, next_at) values (?, ?, 0, ?)",
      change!.id,
      JSON.stringify(change),
      Math.min(now + OPERATOR_EMAIL_HOLD_MS, ...waiting),
    );
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
        signal: AbortSignal.timeout(this.pingTimeoutMs),
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

  private delete(key: Keys): void {
    this.ctx.storage.sql.exec("delete from watchdog_state where key = ?", key);
  }
}

/**
 * The status from the recorded times (pure, so the rules are tested on their own):
 * - `no_beat`: the cron has not beaten for `BEAT_STALE_MS` (the cron or this object stopped);
 * - `pipeline_stalled`: the newest proved beat (or, before any, the first beat) is older than `BEAT_STALE_MS`, so
 *   beats stopped coming through or come through late (the alarm, the drain, the Queue or the consumer stopped, or
 *   the Queue is backed up);
 * - `pipeline_slow`: proofs took longer than `MAX_PROOF_LATENCY_MS` on `TRANSIENT_FAILURES_TO_DEGRADE` beats in a row
 *   (`slow`); each such proof pings nothing;
 * - `relay_unauthorized` / `relay_unreachable` / `relay_not_configured`: what the consumer found at the relay on the
 *   last proof (`unreachable` and `rate_limited` only as `WatchdogDO.relayCheck` counts them); with an instance key (RFC 0015), `relay_bad_signature` / `relay_instance_unregistered` /
 *   `relay_instance_revoked` / `relay_rate_limited` / `relay_handles_unavailable` from its signed deep health;
 * - `apns_failing` / `fcm_failing` / `d1_failing`: the deeper checks (Q19): APNs refused the relay's provider token,
 *   FCM refused the service account, or (on `TRANSIENT_FAILURES_TO_DEGRADE` proofs in a row) a provider or the D1
 *   read did not answer;
 * - `direct_apns_failing` / `direct_fcm_failing`: this instance's own key or account failed the same way (Q34). Pages
 *   fall back to the relay, so these are listed but leave the status as it is.
 * With no beat yet, or beats but none proved and none overdue, it is `unknown`.
 */
export function pagingStatus(
  times: {
    firstBeatAt: number | null;
    lastBeatAt: number | null;
    /** The time of the newest beat proved (when the cron wrote it, not when it came back). */
    provedBeatAt: number | null;
    lastProvedAt: number | null;
    /** Proofs came back later than `MAX_PROOF_LATENCY_MS` on enough beats in a row (`WatchdogDO.slowCheck`). */
    slow?: boolean;
    relay: RelayHealth | null;
    /** The send token's check beside the signed one (`BeatChecks.sendToken`); null or absent without it. */
    sendToken?: RelayHealth | null;
    apns?: CheckHealth | null;
    fcm?: CheckHealth | null;
    d1?: CheckHealth | null;
    directApns?: CheckHealth | null;
    directFcm?: CheckHealth | null;
  },
  now: number,
): Pick<PagingHealth, "status" | "reasons"> {
  const { firstBeatAt, lastBeatAt, provedBeatAt, lastProvedAt, relay } = times;
  if (lastBeatAt === null || firstBeatAt === null) return { status: "unknown", reasons: [] };
  const reasons: DegradedReason[] = [];
  if (now - lastBeatAt > BEAT_STALE_MS) reasons.push("no_beat");
  if (now - (provedBeatAt ?? firstBeatAt) > BEAT_STALE_MS) reasons.push("pipeline_stalled");
  if (times.slow) reasons.push("pipeline_slow");
  if (relay === "unauthorized" || times.sendToken === "unauthorized") {
    reasons.push("relay_unauthorized");
  }
  if (relay === "unreachable" || times.sendToken === "unreachable") {
    reasons.push("relay_unreachable");
  }
  if (relay === "not_configured") reasons.push("relay_not_configured");
  if (relay === "bad_signature") reasons.push("relay_bad_signature");
  if (relay === "instance_unregistered") reasons.push("relay_instance_unregistered");
  if (relay === "instance_revoked") reasons.push("relay_instance_revoked");
  if (relay === "rate_limited") reasons.push("relay_rate_limited");
  if (relay === "handles_unavailable") reasons.push("relay_handles_unavailable");
  if (times.apns === "error") reasons.push("apns_failing");
  if (times.fcm === "error") reasons.push("fcm_failing");
  if (times.d1 === "error") reasons.push("d1_failing");
  const direct: DegradedReason[] = [];
  if (times.directApns === "error") direct.push("direct_apns_failing");
  if (times.directFcm === "error") direct.push("direct_fcm_failing");
  if (reasons.length > 0) return { status: "degraded", reasons: [...reasons, ...direct] };
  // A relay not known yet (every proof so far met only its limits, `relayCheck`) proves nothing: the beat pinged
  // nothing either, so the dashboard and the external check agree.
  return {
    status: lastProvedAt === null || relay === null ? "unknown" : "ok",
    reasons: direct,
  };
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

/** Where the watchdog keeps what each failing check was answered (`BeatChecks.answers`), by its reason. */
const ANSWER_KEYS = [
  ["apns_failing", "apns_answer"],
  ["fcm_failing", "fcm_answer"],
  ["direct_apns_failing", "direct_apns_answer"],
  ["direct_fcm_failing", "direct_fcm_answer"],
] as const satisfies readonly (readonly [DegradedReason, Keys])[];

/** A status and its sorted reasons (as `settle` keeps them, JSON), as one string to compare. */
function stateKey(status: string, reasons: string): string {
  return `${status} ${reasons}`;
}

/** The state a `brigade.status_changed` event tells of (`stateKey`). */
function changeKey(event: BrigadeEvent): string {
  const data = Object(event.data) as { status?: unknown; reasons?: unknown };
  const reasons = Array.isArray(data.reasons) ? data.reasons.map(String).sort() : [];
  return stateKey(String(data.status), JSON.stringify(reasons));
}

/**
 * Whether two states tell the operators the same: equal, or both nothing wrong (ok or unknown with no reason; never
 * told counts as that), so a new watchdog's first proof (unknown to ok) emails nobody.
 */
function sameState(a: string | null, b: string | null): boolean {
  const quiet = (key: string | null) => key === null || key === "ok []" || key === "unknown []";
  return a === b || (quiet(a) && quiet(b));
}

function num(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, shard: "watchdog", ...fields }));
}
