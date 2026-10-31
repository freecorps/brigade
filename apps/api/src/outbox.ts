// The transactional outbox (RFC 0005 "Delivery"): every committed mutation writes its events here, in the same
// SQLite transaction as its rows, wrapped in the `BrigadeEvent` envelope. The shard's alarm drains it to the
// `brigade-events` Queue (`OutboxDrain`), deleting rows only after the send succeeds: at-least-once, in `seq` order.

import { newId, type Actor, type DomainEvent, type RandomBytes } from "@freecorps/brigade-schema";
import { within } from "./deadline.ts";

/** RFC 0005's envelope. */
export type BrigadeEvent<T = unknown> = {
  /** `evt_<ULID>` (RFC 0003 prefixed ids); consumers de-duplicate by it. */
  id: string;
  type: string;
  /** `brigade://<workspace>/<shard>`; the workspace shard is `workspace`. */
  source: string;
  workspaceId: string;
  /** ISO 8601, from the mutation's `ctx.now`. */
  time: string;
  actor: { kind: Actor["kind"]; id: string };
  subject?: string;
  data: T;
  specversion: "1.0";
};

export const OUTBOX_SCHEMA = `
  create table if not exists outbox (
    seq integer primary key,
    id text not null unique,
    version integer not null,
    event text not null
  );
`;

const DRAIN_SCHEMA = `
  create table if not exists outbox_drain (key text primary key, value integer not null) without rowid;
`;

export type OutboxContext = {
  workspaceId: string;
  shard: string;
  actor: Actor;
  now: number;
  /** The shard version the mutation committed as. */
  version: number;
  randomBytes: RandomBytes;
};

/** Wraps and writes `events`; call it inside the mutation's transaction. Returns the envelopes. */
export function writeOutbox(
  sql: SqlStorage,
  events: readonly DomainEvent[],
  ctx: OutboxContext,
): BrigadeEvent[] {
  return events.map((event) => {
    const envelope: BrigadeEvent = {
      id: newId("evt", ctx.now, ctx.randomBytes),
      type: event.type,
      source: `brigade://${ctx.workspaceId}/${ctx.shard}`,
      workspaceId: ctx.workspaceId,
      time: new Date(ctx.now).toISOString(),
      actor: { kind: ctx.actor.kind, id: ctx.actor.id },
      ...(event.subject === undefined ? {} : { subject: event.subject }),
      data: event.data,
      specversion: "1.0",
    };
    sql.exec(
      "insert into outbox (id, version, event) values (?, ?, ?)",
      envelope.id,
      ctx.version,
      JSON.stringify(envelope),
    );
    return envelope;
  });
}

/** Messages per `sendBatch`: the Queue's limit. */
export const DRAIN_BATCH = 100;
/** Bytes per `sendBatch`, under the Queue's 256 KB (each message also carries about 100 bytes of metadata). */
export const DRAIN_BATCH_BYTES = 200_000;
/** A single message may not pass the Queue's 128 KB; events are far smaller (an update is at most 4000 characters). */
export const MAX_EVENT_BYTES = 120_000;
/** Batches per drain; more rows than this wait for the next alarm, set for right away. */
export const DRAIN_BATCHES_PER_RUN = 10;
/** Backoff after a failed send: doubles from the first to the last, with jitter. */
export const DRAIN_RETRY_FIRST_MS = 1000;
export const DRAIN_RETRY_MAX_MS = 5 * 60 * 1000;
/**
 * How long one `sendBatch` gets. A Queue that never answers would otherwise hold the drain, and with it the shard's
 * alarm (every escalation level after it), for as long as the runtime lets the alarm run; past this it is a failed
 * send that backs off like any other. The batch may still have gone: it goes again, and consumers de-duplicate.
 */
export const DRAIN_SEND_TIMEOUT_MS = 10_000;
/** The backlog is logged on every failure, and as an error once it passes this many rows. */
export const OUTBOX_BACKLOG_ALERT = 1000;

export type OutboxSend = (messages: { body: BrigadeEvent; contentType: "json" }[]) => Promise<void>;

/**
 * Sends the outbox to the Queue (RFC 0005 "Delivery"). One drain at a time per shard (the alarm runs alone), oldest
 * row first, one batch at a time: a batch's rows are deleted only once `send` resolved, and nothing after a failed
 * batch is sent, so the Queue receives a shard's events in commit order. If the object dies between the send and
 * the delete, the rows go again: consumers de-duplicate by `event.id`. A failed send backs off exponentially
 * (`retryAt`), and the alarm comes back then.
 */
export class OutboxDrain {
  private running = false;

  constructor(
    private readonly sql: SqlStorage,
    private readonly send: OutboxSend,
    private readonly log: (message: string, fields: Record<string, unknown>) => void,
    private readonly jitter: () => number = Math.random,
    private readonly sendTimeoutMs = DRAIN_SEND_TIMEOUT_MS,
  ) {
    sql.exec(DRAIN_SCHEMA);
  }

  /** Rows waiting to be sent. */
  backlog(): number {
    return this.sql.exec<{ n: number }>("select count(*) as n from outbox").one().n;
  }

  /** When a failed send may be tried again; null when the last send succeeded. */
  retryAt(): number | null {
    return this.state("retry_at");
  }

  /**
   * When the drain wants the alarm next: now when rows wait, `retryAt` while backing off, null with nothing to send.
   */
  nextWake(now: number): number | null {
    if (this.backlog() === 0) return null;
    return Math.max(now, this.retryAt() ?? now);
  }

  /**
   * Sends up to `DRAIN_BATCHES_PER_RUN` batches; returns how many events went. A failed send is recorded and backed
   * off, never thrown; only a storage failure throws, and then the rows stay and go again.
   */
  async drain(now: number): Promise<number> {
    if (this.running) return 0;
    const retryAt = this.retryAt();
    if (retryAt !== null && retryAt > now) return 0;
    this.running = true;
    let sent = 0;
    try {
      for (let batch = 0; batch < DRAIN_BATCHES_PER_RUN; batch++) {
        const rows = this.next();
        if (rows.length === 0) break;
        const last = rows.at(-1)!.seq;
        try {
          if (rows.some((row) => row.body !== null)) {
            await within(
              this.send(
                rows.flatMap((row) =>
                  row.body === null ? [] : [{ body: row.body, contentType: "json" as const }],
                ),
              ),
              this.sendTimeoutMs,
              "sendBatch",
            );
          }
        } catch (error) {
          this.failed(now, error);
          return sent;
        }
        // Only after the send resolved. A crash before this line sends the batch again (at-least-once).
        this.sql.exec("delete from outbox where seq <= ?", last);
        sent += rows.length;
        this.setState("failures", null);
        this.setState("retry_at", null);
      }
      return sent;
    } finally {
      this.running = false;
    }
  }

  /**
   * The next batch in `seq` order, bounded by count and bytes. An event too large for the Queue, or one that is not
   * JSON, is logged and dropped: either would otherwise block the shard's outbox for good.
   */
  private next(): { seq: number; body: BrigadeEvent | null }[] {
    const rows = this.sql
      .exec<{ seq: number; id: string; event: string }>(
        "select seq, id, event from outbox order by seq limit ?",
        DRAIN_BATCH,
      )
      .toArray();
    const batch: { seq: number; body: BrigadeEvent | null }[] = [];
    let bytes = 0;
    for (const row of rows) {
      const size = new TextEncoder().encode(row.event).length;
      if (size > MAX_EVENT_BYTES) {
        // Cannot happen with today's events; kept so one oversized row never blocks the shard's outbox for good.
        this.log("outbox event too large for the queue, dropped", { id: row.id, bytes: size });
        batch.push({ seq: row.seq, body: null });
        continue;
      }
      let body: BrigadeEvent;
      try {
        body = JSON.parse(row.event) as BrigadeEvent;
      } catch (error) {
        // Cannot happen with `writeOutbox`; a damaged row must not stop every event after it.
        this.log("outbox event unreadable, dropped", { id: row.id, bytes: size, error });
        batch.push({ seq: row.seq, body: null });
        continue;
      }
      if (batch.length > 0 && bytes + size > DRAIN_BATCH_BYTES) break;
      bytes += size;
      batch.push({ seq: row.seq, body });
    }
    return batch;
  }

  /**
   * Records a failed drain and backs off. `drain` calls it when a send fails; the alarm calls it when `drain` threw
   * (storage), so a failure that repeats does not run the drain on every alarm.
   */
  failed(now: number, error: unknown): void {
    const failures = (this.state("failures") ?? 0) + 1;
    const ceiling = Math.min(DRAIN_RETRY_MAX_MS, DRAIN_RETRY_FIRST_MS * 2 ** (failures - 1));
    // Half to all of the ceiling, so shards that failed together do not retry together.
    const delay = Math.ceil(ceiling / 2 + (ceiling / 2) * this.jitter());
    this.setState("failures", failures);
    this.setState("retry_at", now + delay);
    const backlog = this.backlog();
    this.log(backlog >= OUTBOX_BACKLOG_ALERT ? "outbox backlog growing" : "outbox send failed", {
      failures,
      backlog,
      retryInMs: delay,
      error,
    });
  }

  private state(key: string): number | null {
    const [row] = this.sql
      .exec<{ value: number }>("select value from outbox_drain where key = ?", key)
      .toArray();
    return row?.value ?? null;
  }

  private setState(key: string, value: number | null): void {
    if (value === null) this.sql.exec("delete from outbox_drain where key = ?", key);
    else {
      this.sql.exec(
        "insert into outbox_drain (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
        key,
        value,
      );
    }
  }
}
