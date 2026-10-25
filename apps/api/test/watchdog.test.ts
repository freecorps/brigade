// The external dead-man switch (RFC 0007 "Watching the watcher"): the cron's heartbeat goes through the watchdog's
// outbox, the Queue and the consumer, which checks the relay; only a beat proved end to end, in time, with the relay
// up pings the external check. Everything else is silence, which is what makes the external check page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import worker from "../src/index.ts";
import { consumeEvents, type Fetch, type NotifyEnv } from "../src/notify.ts";
import { OutboxDrain, type BrigadeEvent } from "../src/outbox.ts";
import {
  BEAT_STALE_MS,
  HEARTBEAT_EVENT,
  MAX_PROOF_LATENCY_MS,
  pagingStatus,
  pingUrl,
  STATUS_EVENT,
  SYSTEM_WORKSPACE,
  WATCHDOG_NAME,
  type WatchdogDO,
} from "../src/watchdog.ts";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const MINUTE = 60_000;
/** vite.config.ts sets `DEAD_MAN_URL` to this loopback URL for the tests; nothing listens there. */
const PING_URL = "http://localhost/dead-man-test";

/** The pings the watchdog sent (global `fetch`, which the object shares with the tests). */
let pings: () => string[];
let pingAnswer: () => Response;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  pingAnswer = () => new Response("OK");
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => pingAnswer());
  pings = () =>
    spy.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
});
afterEach(() => {
  vi.restoreAllMocks();
});

let names = 0;
/** A fresh watchdog (the class does not care about its name), and helpers to beat it and read its outbox. */
function watchdog() {
  const stub = env.WATCHDOG.getByName(`watchdog-test-${++names}`);
  const events = () =>
    runInDurableObject(stub, (_instance: WatchdogDO, state) =>
      state.storage.sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent),
    );
  const heartbeats = async () => (await events()).filter((e) => e.type === HEARTBEAT_EVENT);
  /** The consumer's env, with this watchdog as the one it reports to. */
  const notifyEnv = (relayUrl: string | null = "https://relay.test"): NotifyEnv => ({
    WORKSPACE: env.WORKSPACE,
    WATCHDOG: { getByName: () => stub } as unknown as NotifyEnv["WATCHDOG"],
    RELAY_URL: relayUrl ?? undefined,
    RELAY_SEND_TOKEN: "test-token",
  });
  return { stub, events, heartbeats, notifyEnv };
}

/** A relay whose `/health` answers `status`, or throws when it is null. */
function relay(status: number | null) {
  const urls: string[] = [];
  const send: Fetch = async (request) => {
    urls.push(request.url);
    if (status === null) throw new TypeError("connection refused");
    return new Response(null, { status });
  };
  return { urls, send };
}

async function deliver(events: BrigadeEvent[], notifyEnv: NotifyEnv, send: Fetch) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await consumeEvents(batch, notifyEnv, send);
  return getQueueResult(batch, ctx);
}

describe("pagingStatus", () => {
  const at = (first: number | null, last: number | null, proved: number | null) => ({
    firstBeatAt: first,
    lastBeatAt: last,
    lastProvedAt: proved,
    relay: proved === null ? null : ("ok" as const),
  });

  test("unknown before any beat, and while the first beats wait to be proved", () => {
    expect(pagingStatus(at(null, null, null), NOW)).toEqual({ status: "unknown", reasons: [] });
    expect(pagingStatus(at(NOW, NOW + MINUTE, null), NOW + 2 * MINUTE)).toEqual({
      status: "unknown",
      reasons: [],
    });
  });

  test("ok while beats are proved within the window", () => {
    expect(pagingStatus(at(NOW, NOW + 5 * MINUTE, NOW + 5 * MINUTE), NOW + 6 * MINUTE)).toEqual({
      status: "ok",
      reasons: [],
    });
  });

  test("a pipeline that proved nothing for the window is stalled", () => {
    expect(pagingStatus(at(NOW, NOW + 4 * MINUTE, null), NOW + 4 * MINUTE)).toEqual({
      status: "degraded",
      reasons: ["pipeline_stalled"],
    });
    expect(
      pagingStatus(
        at(NOW, NOW + 10 * MINUTE, NOW + 5 * MINUTE),
        NOW + 5 * MINUTE + BEAT_STALE_MS + 1,
      ),
    ).toEqual({ status: "degraded", reasons: ["pipeline_stalled"] });
  });

  test("a cron that stopped beating is degraded too", () => {
    const now = NOW + 5 * MINUTE + BEAT_STALE_MS + 1;
    expect(pagingStatus(at(NOW, NOW + 5 * MINUTE, NOW + 5 * MINUTE), now)).toEqual({
      status: "degraded",
      reasons: ["no_beat", "pipeline_stalled"],
    });
  });

  test("the relay's state on the last proof", () => {
    const times = { firstBeatAt: NOW, lastBeatAt: NOW, lastProvedAt: NOW };
    expect(pagingStatus({ ...times, relay: "unreachable" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["relay_unreachable"],
    });
    expect(pagingStatus({ ...times, relay: "not_configured" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["relay_not_configured"],
    });
  });
});

describe("pingUrl", () => {
  test("https anywhere, http only on loopback, anything else ignored", () => {
    expect(pingUrl({})).toBeUndefined();
    expect(pingUrl({ DEAD_MAN_URL: "" })).toBeUndefined();
    expect(pingUrl({ DEAD_MAN_URL: "https://checks.example/ping/abc" })?.href).toBe(
      "https://checks.example/ping/abc",
    );
    expect(pingUrl({ DEAD_MAN_URL: "http://127.0.0.1:8789/ping" })?.port).toBe("8789");
    expect(pingUrl({ DEAD_MAN_URL: "http://checks.example/ping" })).toBeUndefined();
    expect(pingUrl({ DEAD_MAN_URL: "ftp://checks.example/ping" })).toBeUndefined();
    expect(pingUrl({ DEAD_MAN_URL: "not a url" })).toBeUndefined();
  });
});

describe("the heartbeat, end to end", () => {
  test("the cron writes a heartbeat into the watchdog's outbox", async () => {
    const controller = createScheduledController({ scheduledTime: new Date(), cron: "* * * * *" });
    await worker.scheduled(controller, env);
    const events = await runInDurableObject(
      env.WATCHDOG.getByName(WATCHDOG_NAME),
      (_instance: WatchdogDO, state) =>
        state.storage.sql
          .exec<{ event: string }>("select event from outbox order by seq")
          .toArray()
          .map((row) => JSON.parse(row.event) as BrigadeEvent),
    );
    expect(events.at(-1)).toMatchObject({
      type: HEARTBEAT_EVENT,
      workspaceId: SYSTEM_WORKSPACE,
      source: `brigade://${SYSTEM_WORKSPACE}/watchdog`,
      actor: { kind: "system", id: "sys_watchdog" },
      specversion: "1.0",
    });
  });

  test("the watchdog's drain sends its heartbeats like a shard's outbox", async () => {
    const { stub } = watchdog();
    await stub.beat(NOW);
    await stub.beat(NOW + MINUTE);
    const sent = await runInDurableObject(stub, async (_instance: WatchdogDO, state) => {
      const batches: BrigadeEvent[][] = [];
      const drain = new OutboxDrain(
        state.storage.sql,
        async (messages) => {
          batches.push(messages.map((message) => message.body));
        },
        () => {},
      );
      await drain.drain(NOW + MINUTE);
      return { batches, backlog: drain.backlog() };
    });
    expect(sent.backlog).toBe(0);
    expect(sent.batches.flat().map((event) => event.type)).toEqual([
      HEARTBEAT_EVENT,
      HEARTBEAT_EVENT,
    ]);
  });

  test("a heartbeat through the queue with the relay up pings the external check once", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    await stub.beat();
    const [heartbeat] = await heartbeats();
    const up = relay(200);
    // Delivered twice (at-least-once): the second proves nothing new and pings nothing.
    const result = await deliver([heartbeat!, heartbeat!], notifyEnv(), up.send);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1"]);
    expect(result.retryMessages).toEqual([]);
    expect(up.urls[0]).toBe("https://relay.test/health");
    expect(pings()).toEqual([PING_URL]);
    expect(await stub.health()).toMatchObject({
      status: "ok",
      reasons: [],
      external: { configured: true, lastPingOk: true },
    });
  });

  test("the relay down: no ping, degraded, and the change goes to the outbox", async () => {
    const { stub, heartbeats, events, notifyEnv } = watchdog();
    await stub.beat();
    for (const down of [relay(503), relay(null)]) {
      // A beat a millisecond later each time, so each is newer than the last proved.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await stub.beat();
      await deliver([(await heartbeats()).at(-1)!], notifyEnv(), down.send);
    }
    expect(pings()).toEqual([]);
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_unreachable"],
      // Through the queue, but never with the relay up: no page could have gone out.
      lastOkAt: null,
      external: { configured: true, lastPingAt: null },
    });
    const changes = (await events()).filter((event) => event.type === STATUS_EVENT);
    expect(changes.map((event) => event.data)).toEqual([
      { status: "degraded", previous: "unknown", reasons: ["relay_unreachable"] },
    ]);
  });

  test("no relay configured: no ping, degraded", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    await stub.beat();
    const none = relay(200);
    await deliver(await heartbeats(), notifyEnv(null), none.send);
    expect(none.urls).toEqual([]);
    expect(pings()).toEqual([]);
    expect((await stub.health()).reasons).toEqual(["relay_not_configured"]);
  });

  test("a heartbeat that took too long counts as alive inside, but pings nothing", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    const [heartbeat] = await heartbeats();
    const health = await stub.proved(heartbeat!.time, "ok", NOW + MAX_PROOF_LATENCY_MS + 1);
    expect(health.lastProvedAt).not.toBeNull();
    expect(pings()).toEqual([]);
  });

  test("an older heartbeat after a newer one changes nothing", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    await stub.beat(NOW + MINUTE);
    const [first, second] = await heartbeats();
    await stub.proved(second!.time, "ok", NOW + MINUTE + 1000);
    await stub.proved(first!.time, "unreachable", NOW + MINUTE + 2000);
    expect(pings()).toEqual([PING_URL]);
    expect((await stub.health(NOW + MINUTE + 3000)).status).toBe("ok");
  });

  test("an external check that refuses the ping is recorded, not thrown", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    pingAnswer = () => new Response(null, { status: 500 });
    const [heartbeat] = await heartbeats();
    const health = await stub.proved(heartbeat!.time, "ok", NOW + 1000);
    expect(health.external).toMatchObject({ lastPingOk: false });
  });

  test("beats that never come back: the pipeline is stalled after the window", async () => {
    const { stub, events } = watchdog();
    for (let minute = 0; minute <= 4; minute++) await stub.beat(NOW + minute * MINUTE);
    expect(await stub.health(NOW + 4 * MINUTE)).toMatchObject({
      status: "degraded",
      reasons: ["pipeline_stalled"],
      lastProvedAt: null,
    });
    // The change waits in the outbox for the pipeline to come back.
    expect((await events()).filter((event) => event.type === STATUS_EVENT)).toHaveLength(1);
    expect(pings()).toEqual([]);
  });

  test("other system events are acked and never reach a shard", async () => {
    const { notifyEnv } = watchdog();
    const event: BrigadeEvent = {
      id: "evt_status",
      type: STATUS_EVENT,
      source: `brigade://${SYSTEM_WORKSPACE}/watchdog`,
      workspaceId: SYSTEM_WORKSPACE,
      time: new Date().toISOString(),
      actor: { kind: "system", id: "sys_watchdog" },
      data: { status: "degraded" },
      specversion: "1.0",
    };
    const up = relay(200);
    const result = await deliver([event], notifyEnv(), up.send);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(up.urls).toEqual([]);
  });
});

describe("GET /health/paging", () => {
  test("answers the watchdog's state, uncached; other methods get 405", async () => {
    const response = await exports.default.fetch("http://api.test/health/paging");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as Record<string, unknown>;
    expect(["ok", "degraded", "unknown"]).toContain(body.status);
    expect(Object.keys(body).sort()).toEqual([
      "external",
      "lastBeatAt",
      "lastOkAt",
      "lastProvedAt",
      "reasons",
      "status",
    ]);
    // Coarse on purpose: never the ping URL.
    expect(JSON.stringify(body)).not.toContain("dead-man-test");
    const post = await exports.default.fetch("http://api.test/health/paging", { method: "POST" });
    expect(post.status).toBe(405);
  });
});
