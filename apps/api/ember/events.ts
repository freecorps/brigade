// Delivering a workspace's events from its Ember shard (RFC 0005 "Delivery", RFC 0016 "The workspace shard"): what
// `OutboxDrain` does for `WorkspaceDO`. Every mutation writes its `BrigadeEvent` envelopes to `events` in its own
// transaction (ember/workspace.ts `run`), each with the next `seq`; `scheduleDrain` then makes sure one `drain` job is
// on its way. The drain sends the oldest rows to the same `brigade-events` Queue, in `seq` order, one batch at a time,
// and deletes a batch only once the send resolved: at-least-once, consumers de-duplicate by `event.id`.
//
// One drain at a time: `event_drain` holds when the pending one was scheduled. A mutation schedules another only when
// none is pending, or the pending one is older than `DRAIN_LEASE_MS` (its action died or ran out of retries), so a
// stuck drain is replaced by the next event. A drain that leaves rows behind schedules the next one itself.

import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
  type QueryCtx,
} from "@freecorps/ember-server";
import {
  DRAIN_BATCH,
  DRAIN_BATCH_BYTES,
  DRAIN_BATCHES_PER_RUN,
  DRAIN_SEND_TIMEOUT_MS,
  MAX_EVENT_BYTES,
  type BrigadeEvent,
} from "../src/outbox.ts";
import { within } from "../src/deadline.ts";

/** How long a scheduled drain may stay unfinished before the next event schedules another. */
export const DRAIN_LEASE_MS = 5 * 60 * 1000;

const PENDING = makeFunctionReference<"query">("events:pending");
const SENT = makeFunctionReference<"mutation">("events:sent");
const DRAIN = "events:drain";

type EventDoc = { _id: string; id: string; seq: number; type: string; at: number; event: string };
type DrainDoc = { _id: string; key: string; scheduledAt: number };
/** What `pending` answers: the batch's last `seq`, its envelopes, and the ids of rows dropped from it. */
type Batch = { lastSeq: number; bodies: BrigadeEvent[]; dropped: string[] };

type Db = {
  query(table: string): {
    withIndex(
      index: string,
      range?: (q: {
        eq(f: string, v: unknown): unknown;
        lte(f: string, v: unknown): unknown;
      }) => unknown,
    ): { order(o: "asc" | "desc"): { first(): unknown; take(n: number): unknown[] } } & {
      first(): unknown;
      take(n: number): unknown[];
      collect(): unknown[];
    };
  };
  insert(table: string, value: object): string;
  patch(id: string, value: object): void;
  delete(id: string): void;
};

/** The `seq` the next event of this shard takes: one past the newest row's (the drain deletes from the oldest). */
export function nextSeq(db: unknown, last: { seq?: number }): number {
  if (last.seq === undefined) {
    const newest = (db as Db)
      .query("events")
      .withIndex("by_seq")
      .order("desc")
      .first() as EventDoc | null;
    last.seq = newest?.seq ?? 0;
  }
  last.seq += 1;
  return last.seq;
}

/** After a mutation wrote events: schedules `drain` unless one is pending and fresh. */
export function scheduleDrain(ctx: MutationCtx): void {
  const db = ctx.db as unknown as Db;
  const state = db
    .query("event_drain")
    .withIndex("by_key", (q) => q.eq("key", "drain") as never)
    .first() as DrainDoc | null;
  if (state && state.scheduledAt > ctx.now - DRAIN_LEASE_MS) return;
  if (state) db.patch(state._id, { scheduledAt: ctx.now });
  else db.insert("event_drain", { key: "drain", scheduledAt: ctx.now });
  ctx.scheduler.runAfter(0, DRAIN, {});
}

/**
 * The next batch, oldest first, bounded by count and bytes. An event too large for the Queue, or not JSON, is left
 * out of the batch (`body: null`) and deleted with it, logged: it would otherwise block the shard's events for good.
 */
export const pending = internalQueryGeneric({
  args: {},
  handler: (ctx): Batch | null => {
    const rows = ((ctx as QueryCtx).db as unknown as Db)
      .query("events")
      .withIndex("by_seq")
      .take(DRAIN_BATCH) as EventDoc[];
    if (rows.length === 0) return null;
    const bodies: BrigadeEvent[] = [];
    const dropped: string[] = [];
    let bytes = 0;
    let lastSeq = 0;
    for (const row of rows) {
      const size = new TextEncoder().encode(row.event).length;
      let body: BrigadeEvent | undefined;
      if (size <= MAX_EVENT_BYTES) {
        try {
          body = JSON.parse(row.event) as BrigadeEvent;
        } catch {
          body = undefined;
        }
      }
      if (body === undefined) {
        dropped.push(row.id);
        lastSeq = row.seq;
        continue;
      }
      if (bodies.length > 0 && bytes + size > DRAIN_BATCH_BYTES) break;
      bytes += size;
      bodies.push(body);
      lastSeq = row.seq;
    }
    return { lastSeq, bodies, dropped };
  },
});

/**
 * A batch went: deletes the rows up to `lastSeq`. With rows left (`more`), schedules the next drain; with none,
 * clears the pending mark, so the next event schedules one. Answers whether rows are left.
 */
export const sent = internalMutationGeneric({
  args: { lastSeq: v.number(), more: v.boolean() },
  handler: (ctx, { lastSeq, more }: { lastSeq: number; more: boolean }): boolean => {
    const c = ctx as MutationCtx;
    const db = c.db as unknown as Db;
    for (const row of db
      .query("events")
      .withIndex("by_seq", (q) => q.lte("seq", lastSeq) as never)
      .collect() as EventDoc[]) {
      db.delete(row._id);
    }
    const left = db.query("events").withIndex("by_seq").first() !== null;
    const state = db
      .query("event_drain")
      .withIndex("by_key", (q) => q.eq("key", "drain") as never)
      .first() as DrainDoc | null;
    if (left && more) {
      // The caller keeps draining in this run: the mark stays, fresh.
      if (state) db.patch(state._id, { scheduledAt: c.now });
      return true;
    }
    if (left) {
      if (state) db.patch(state._id, { scheduledAt: c.now });
      else db.insert("event_drain", { key: "drain", scheduledAt: c.now });
      c.scheduler.runAfter(0, DRAIN, {});
      return true;
    }
    if (state) db.delete(state._id);
    return false;
  },
});

/** Sends up to `DRAIN_BATCHES_PER_RUN` batches to `EVENTS`; a failed send throws, so Ember retries the action. */
export const drain = internalActionGeneric({
  args: {},
  handler: async (ctx): Promise<number> => {
    const queue = ctx.env.EVENTS as Queue<BrigadeEvent>;
    let count = 0;
    for (let batch = 0; batch < DRAIN_BATCHES_PER_RUN; batch++) {
      const next = (await ctx.runQuery(PENDING, {})) as Batch | null;
      if (next === null) {
        await ctx.runMutation(SENT, { lastSeq: 0, more: false });
        return count;
      }
      if (next.dropped.length > 0) {
        console.error(
          JSON.stringify({ message: "event too large or unreadable, dropped", ids: next.dropped }),
        );
      }
      if (next.bodies.length > 0) {
        // Bounded as on the DO: a Queue that never answers must not hold the shard's alarm. A timeout throws, and
        // Ember retries the drain; the batch stays until a send resolves.
        await within(
          queue.sendBatch(next.bodies.map((body) => ({ body, contentType: "json" as const }))),
          DRAIN_SEND_TIMEOUT_MS,
          "sendBatch",
        );
      }
      count += next.bodies.length;
      const last = batch === DRAIN_BATCHES_PER_RUN - 1;
      const left = (await ctx.runMutation(SENT, { lastSeq: next.lastSeq, more: !last })) as boolean;
      if (!left) return count;
    }
    return count;
  },
});
