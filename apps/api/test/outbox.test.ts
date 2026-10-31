// The outbox drain (RFC 0005 "Delivery"): in order, bounded batches, rows deleted only after the send succeeds,
// backoff after a failure.
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vite-plus/test";
import { newId, type Actor } from "@freecorps/brigade-schema";
import {
  DRAIN_BATCH,
  DRAIN_BATCHES_PER_RUN,
  DRAIN_RETRY_FIRST_MS,
  DRAIN_RETRY_MAX_MS,
  OutboxDrain,
  type BrigadeEvent,
  type OutboxSend,
} from "../src/outbox.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

let names = 0;
/** A fresh shard with `events` incidents declared, and a drain over its outbox that sends through `send`. */
function withDrain<R>(
  events: number,
  send: OutboxSend,
  fn: (
    drain: OutboxDrain,
    sql: SqlStorage,
    logs: { message: string }[],
    instance: WorkspaceDO,
  ) => Promise<R>,
  jitter = () => 1,
) {
  return runInDurableObject(
    env.WORKSPACE.getByName(`outbox-${++names}`),
    async (instance: WorkspaceDO, state) => {
      const logs: { message: string }[] = [];
      const log = (message: string, fields: Record<string, unknown>) =>
        logs.push({ message, ...fields });
      const shard = new Shard(state.storage, { shard: "workspace", randomBytes: random, log });
      shard.claim("acme");
      for (let i = 0; i < events; i++) {
        shard.mutate({
          clientId: "c1",
          mutationId: `m${i}`,
          actor: ana,
          name: "incident.declare",
          args: { id: newId("inc", NOW, random), title: `Incident ${i}`, severity: "sev3" },
          now: NOW + i,
        });
      }
      return fn(
        new OutboxDrain(state.storage.sql, send, log, jitter),
        state.storage.sql,
        logs,
        instance,
      );
    },
  );
}

const ids = (sql: SqlStorage) =>
  sql
    .exec<{ id: string }>("select id from outbox order by seq")
    .toArray()
    .map((row) => row.id);

/** A send that records each batch's event ids. */
function recorder() {
  const batches: string[][] = [];
  const send: OutboxSend = async (messages) => {
    expect(messages.every((message) => message.contentType === "json")).toBe(true);
    batches.push(messages.map((message) => message.body.id));
  };
  return { batches, send };
}

describe("OutboxDrain", () => {
  test("sends every event once, oldest first, and empties the outbox", async () => {
    const { batches, send } = recorder();
    await withDrain(3, send, async (drain, sql) => {
      const before = ids(sql);
      expect(drain.nextWake(NOW)).toBe(NOW);
      expect(await drain.drain(NOW)).toBe(3);
      expect(batches).toEqual([before]);
      expect(drain.backlog()).toBe(0);
      expect(drain.nextWake(NOW)).toBeNull();
      // Nothing left: a second drain sends nothing.
      expect(await drain.drain(NOW)).toBe(0);
      expect(batches).toHaveLength(1);
    });
  });

  test("the queue gets the envelope as written: the event id is the consumers' idempotency key", async () => {
    const bodies: BrigadeEvent[] = [];
    await withDrain(
      1,
      async (messages) => {
        bodies.push(...messages.map((message) => message.body));
      },
      async (drain, sql) => {
        const [row] = sql.exec<{ event: string }>("select event from outbox").toArray();
        await drain.drain(NOW);
        expect(bodies).toEqual([JSON.parse(row!.event)]);
        expect(bodies[0]).toMatchObject({ type: "incident.declared", specversion: "1.0" });
      },
    );
  });

  test("a Queue that never answers is a failed send that backs off, not a drain that hangs", async () => {
    await withDrain(
      2,
      async () => {},
      async (_drain, sql, logs) => {
        const log = (message: string, fields: Record<string, unknown>) =>
          logs.push({ message, ...fields });
        const never: OutboxSend = () => new Promise(() => {});
        const drain = new OutboxDrain(sql, never, log, () => 1, 20);
        const before = ids(sql);
        expect(await drain.drain(NOW)).toBe(0);
        // Kept, backed off, and tried again once the backoff ends.
        expect(ids(sql)).toEqual(before);
        expect(drain.retryAt()).toBeGreaterThan(NOW);
        const { batches, send } = recorder();
        const later = new OutboxDrain(sql, send, log, () => 1, 20);
        expect(await later.drain(drain.retryAt()!)).toBe(2);
        expect(batches).toEqual([before]);
      },
    );
  });

  test(`batches hold at most ${DRAIN_BATCH} events and go in order; one run sends at most ${DRAIN_BATCHES_PER_RUN}`, async () => {
    const { batches, send } = recorder();
    await withDrain(250, send, async (drain, sql) => {
      const before = ids(sql);
      expect(await drain.drain(NOW)).toBe(250);
      expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
      expect(batches.flat()).toEqual(before);
    });
  });

  test("a failed send keeps every row, sends nothing after it, and backs off exponentially", async () => {
    let fail = true;
    const { batches, send: record } = recorder();
    const send: OutboxSend = async (messages) => {
      if (fail) throw new Error("Queue unavailable");
      await record(messages);
    };
    await withDrain(3, send, async (drain, sql, logs) => {
      const before = ids(sql);
      expect(await drain.drain(NOW)).toBe(0);
      expect(ids(sql)).toEqual(before);
      expect(drain.retryAt()).toBe(NOW + DRAIN_RETRY_FIRST_MS);
      expect(drain.nextWake(NOW)).toBe(NOW + DRAIN_RETRY_FIRST_MS);
      expect(logs).toContainEqual(
        expect.objectContaining({ message: "outbox send failed", backlog: 3 }),
      );

      // Before the backoff ends, nothing is tried.
      expect(await drain.drain(NOW + 10)).toBe(0);
      expect(logs.filter((log) => log.message === "outbox send failed")).toHaveLength(1);

      // Each failure doubles the wait, up to the ceiling.
      let at = NOW + DRAIN_RETRY_FIRST_MS;
      for (const expected of [2, 4, 8].map((n) => n * DRAIN_RETRY_FIRST_MS)) {
        await drain.drain(at);
        expect(drain.retryAt()! - at).toBe(expected);
        at = drain.retryAt()!;
      }
      for (let i = 0; i < 20; i++) {
        await drain.drain(at);
        at = drain.retryAt()!;
      }
      expect(await drain.drain(at)).toBe(0);
      expect(drain.retryAt()! - at).toBe(DRAIN_RETRY_MAX_MS);

      // Recovered: the same rows go, in order, and the backoff is cleared.
      fail = false;
      expect(await drain.drain(drain.retryAt()!)).toBe(3);
      expect(batches).toEqual([before]);
      expect(drain.retryAt()).toBeNull();
    });
  });

  test("the backoff has jitter: half to all of the step", async () => {
    await withDrain(
      1,
      async () => {
        throw new Error("down");
      },
      async (drain) => {
        await drain.drain(NOW);
        expect(drain.retryAt()).toBe(NOW + DRAIN_RETRY_FIRST_MS / 2);
      },
      () => 0,
    );
  });

  test("at-least-once: if the object dies between the send and the delete, the same events go again", async () => {
    const { batches, send } = recorder();
    await withDrain(2, send, async (drain, sql) => {
      const before = ids(sql);
      // The send succeeds, then storage fails before the rows are deleted, as a crash right there would leave them.
      sql.exec(`create trigger no_delete before delete on outbox
                begin select raise(abort, 'storage gone'); end`);
      await expect(drain.drain(NOW)).rejects.toThrow(/storage gone/);
      expect(batches).toEqual([before]);
      expect(ids(sql)).toEqual(before);

      sql.exec("drop trigger no_delete");
      expect(await drain.drain(NOW)).toBe(2);
      // Sent twice with the same ids: consumers de-duplicate by `event.id`.
      expect(batches).toEqual([before, before]);
      expect(drain.backlog()).toBe(0);
    });
  });

  test("a row that is not JSON is logged and dropped, and the events after it still go", async () => {
    const { batches, send } = recorder();
    await withDrain(2, send, async (drain, sql, logs) => {
      const [first, second] = ids(sql);
      sql.exec("update outbox set event = '{not json' where id = ?", first);
      expect(await drain.drain(NOW)).toBe(2);
      expect(batches).toEqual([[second]]);
      expect(drain.backlog()).toBe(0);
      expect(logs).toContainEqual(
        expect.objectContaining({ message: "outbox event unreadable, dropped", id: first }),
      );
    });
  });

  test("a drain that throws in the alarm backs off instead of running again on every alarm", async () => {
    const { send } = recorder();
    await withDrain(1, send, async (drain, sql, _logs, instance) => {
      // Storage refuses the delete after the send, so `drain` throws rather than recording a failed send.
      sql.exec(`create trigger no_delete before delete on outbox
                begin select raise(abort, 'storage gone'); end`);
      Reflect.set(instance, "drainPaused", false);
      await instance.alarm();
      expect(drain.retryAt()).not.toBeNull();
      expect(drain.backlog()).toBe(1);
      sql.exec("drop trigger no_delete");
    });
  });

  test("events written while a send is in flight go in the next batch, after the earlier ones", async () => {
    const batches: string[][] = [];
    await withDrain(
      1,
      async (messages) => {
        batches.push(messages.map((message) => message.body.id));
      },
      async (drain, sql) => {
        const first = ids(sql);
        const sending = drain.drain(NOW);
        // A second drain while one runs does nothing (the alarm never overlaps itself; this guards anyway).
        expect(await drain.drain(NOW)).toBe(0);
        await sending;
        sql.exec(
          "insert into outbox (id, version, event) values (?, ?, ?)",
          "evt_late",
          99,
          JSON.stringify({ id: "evt_late" }),
        );
        await drain.drain(NOW);
        expect(batches).toEqual([first, ["evt_late"]]);
      },
    );
  });
});
