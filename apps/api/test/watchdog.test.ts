// The external dead-man switch (RFC 0007 "Watching the watcher"): the cron's heartbeat goes through the watchdog's
// outbox, the Queue and the consumer, which checks the relay takes its token; only a beat proved end to end, in time, with the relay
// up pings the external check. Everything else is silence, which is what makes the external check page.
import { env, exports } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  createScheduledController,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { generateInstanceKey, verifyRequest } from "@freecorps/brigade-push/instance";
import worker from "../src/index.ts";
import { withEmailCeiling } from "../src/email-ceiling.ts";
import type { EmailResult, EmailSender, OutgoingEmail } from "../src/email.ts";
import { consumeEvents, type Fetch, type NotifyEnv } from "../src/notify.ts";
import { operatorAddresses } from "../src/notify-operators.ts";
import { OutboxDrain, type BrigadeEvent } from "../src/outbox.ts";
import {
  BEAT_STALE_MS,
  HEARTBEAT_EVENT,
  MAX_PROOF_LATENCY_MS,
  OPERATOR_EMAIL_HOLD_MS,
  OPERATOR_EMAIL_HOURLY_CAP,
  OPERATOR_EMAIL_TRIES,
  pagingStatus,
  pingUrl,
  STATUS_EVENT,
  SYSTEM_WORKSPACE,
  TRANSIENT_FAILURES_TO_DEGRADE,
  WATCHDOG_NAME,
  type BeatCheck,
  type BeatChecks,
  type WatchdogDO,
} from "../src/watchdog.ts";
import { sessionCookie } from "./session.ts";

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

/**
 * A relay answering the consumer's token check (`POST /send`, no body) as apps/relay does: `400 invalid_body` for
 * `test-token`, `401` for any other; or with `status` and no body, or throwing when `status` is null.
 */
function relay(status: "relay" | number | null = "relay") {
  const urls: string[] = [];
  const auth: (string | null)[] = [];
  const send: Fetch = async (request) => {
    urls.push(`${request.method} ${request.url}`);
    auth.push(request.headers.get("Authorization"));
    if (status === null) throw new TypeError("connection refused");
    if (typeof status === "number") return new Response(null, { status });
    if (request.headers.get("Authorization") !== "Bearer test-token") {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return Response.json({ error: "invalid_body" }, { status: 400 });
  };
  return { urls, auth, send };
}

/** Lets the ping the watchdog started in `waitUntil` finish and record itself. */
async function pinged(stub: DurableObjectStub<WatchdogDO>, expected: boolean | null) {
  await vi.waitFor(async () => {
    expect((await stub.health()).external.lastPingOk).toBe(expected);
  });
}

/** A D1 whose every read throws. */
const BROKEN_D1 = {
  prepare: () => {
    throw new Error("D1 is down");
  },
} as unknown as D1Database;

/**
 * The relay's deep check answering `apns` and `fcm` (apps/relay src/deep-health.ts; `transient` is an error that may
 * pass), and a beat proved through it, each a moment after the last so it is newer.
 */
function deepBeats(
  stub: DurableObjectStub<WatchdogDO>,
  heartbeats: () => Promise<BrigadeEvent[]>,
  notifyEnv: () => NotifyEnv,
) {
  const check = (status: string, refused: string) => {
    if (status === "transient") return { status: "error", reason: "unreachable", transient: true };
    return status === "error" ? { status, reason: refused } : { status };
  };
  const deep = (apns: string, fcm = "not_configured") => {
    const urls: string[] = [];
    const send: Fetch = async (request) => {
      urls.push(`${request.method} ${request.url}`);
      const ok = apns === "ok" && fcm !== "error" && fcm !== "transient";
      return Response.json(
        { ok, apns: check(apns, "InvalidProviderToken"), fcm: check(fcm, "refused") },
        { status: ok ? 200 : 503 },
      );
    };
    return { urls, send };
  };
  const beat = async (send: Fetch, extra: Partial<NotifyEnv> = {}) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await stub.beat();
    await deliver([(await heartbeats()).at(-1)!], { ...notifyEnv(), ...extra }, send);
  };
  return { deep, beat };
}

async function deliver(
  events: BrigadeEvent[],
  notifyEnv: NotifyEnv,
  send: Fetch,
  mail?: EmailSender,
) {
  const batch = createMessageBatch(
    "brigade-events",
    events.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await consumeEvents(batch, notifyEnv, send, mail);
  return getQueueResult(batch, ctx);
}

describe("pagingStatus", () => {
  /** Each beat proved a second after it was written. */
  const at = (first: number | null, last: number | null, proved: number | null) => ({
    firstBeatAt: first,
    lastBeatAt: last,
    provedBeatAt: proved,
    lastProvedAt: proved === null ? null : proved + 1000,
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

  test("beats coming through ten minutes late: stalled and slow, though every one is proved", () => {
    // The Queue is backed up: the beat written at 12:00 is proved at 12:10, and so on.
    const now = NOW + 20 * MINUTE;
    const times = {
      firstBeatAt: NOW,
      lastBeatAt: now,
      provedBeatAt: now - 10 * MINUTE,
      lastProvedAt: now,
      slow: true,
      relay: "ok" as const,
    };
    expect(pagingStatus(times, now)).toEqual({
      status: "degraded",
      reasons: ["pipeline_stalled", "pipeline_slow"],
    });
    // Slow but within the window: the pings stop (MAX_PROOF_LATENCY_MS), and the dashboard says why.
    const slow = { ...times, provedBeatAt: now - 2.5 * MINUTE };
    expect(pagingStatus(slow, now)).toEqual({ status: "degraded", reasons: ["pipeline_slow"] });
    // Slow on fewer beats in a row than it takes (`slow` unset): nothing yet.
    expect(pagingStatus({ ...slow, slow: false }, now)).toEqual({ status: "ok", reasons: [] });
  });

  test("stalled only past three and a half minutes, so the beat that finds three unproved minutes is not", () => {
    // Proved at 12:00, then the 12:01 and 12:02 beats are late: the 12:03 beat is written a second before its proof.
    expect(BEAT_STALE_MS).toBe(3.5 * MINUTE);
    expect(pagingStatus(at(NOW, NOW + 3 * MINUTE, NOW), NOW + 3 * MINUTE + 500)).toEqual({
      status: "ok",
      reasons: [],
    });
    expect(pagingStatus(at(NOW, NOW + 4 * MINUTE, NOW), NOW + 4 * MINUTE)).toEqual({
      status: "degraded",
      reasons: ["pipeline_stalled"],
    });
  });

  test("a cron that stopped beating is degraded too", () => {
    const now = NOW + 5 * MINUTE + BEAT_STALE_MS + 1;
    expect(pagingStatus(at(NOW, NOW + 5 * MINUTE, NOW + 5 * MINUTE), now)).toEqual({
      status: "degraded",
      reasons: ["no_beat", "pipeline_stalled"],
    });
  });

  test("the relay's state on the last proof", () => {
    const times = { firstBeatAt: NOW, lastBeatAt: NOW, provedBeatAt: NOW, lastProvedAt: NOW };
    expect(pagingStatus({ ...times, relay: "unauthorized" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["relay_unauthorized"],
    });
    expect(pagingStatus({ ...times, relay: "unreachable" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["relay_unreachable"],
    });
    expect(pagingStatus({ ...times, relay: "not_configured" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["relay_not_configured"],
    });
  });

  test("the deeper checks on the last proof: APNs, FCM and D1 failing each degrade; not configured or unknown never", () => {
    const times = { firstBeatAt: NOW, lastBeatAt: NOW, provedBeatAt: NOW, lastProvedAt: NOW };
    expect(
      pagingStatus({ ...times, relay: "ok", apns: "error", fcm: "error", d1: "error" }, NOW),
    ).toEqual({ status: "degraded", reasons: ["apns_failing", "fcm_failing", "d1_failing"] });
    for (const quiet of ["ok", "not_configured", "unknown", null] as const) {
      expect(
        pagingStatus({ ...times, relay: "ok", apns: quiet, fcm: quiet, d1: quiet }, NOW),
      ).toEqual({ status: "ok", reasons: [] });
    }
  });

  test("the instance's own push key failing is listed but never degrades: the relay pages meanwhile", () => {
    const times = { firstBeatAt: NOW, lastBeatAt: NOW, provedBeatAt: NOW, lastProvedAt: NOW };
    expect(
      pagingStatus({ ...times, relay: "ok", directApns: "error", directFcm: "error" }, NOW),
    ).toEqual({ status: "ok", reasons: ["direct_apns_failing", "direct_fcm_failing"] });
    expect(pagingStatus({ ...times, relay: "ok", d1: "error", directApns: "error" }, NOW)).toEqual({
      status: "degraded",
      reasons: ["d1_failing", "direct_apns_failing"],
    });
    for (const quiet of ["ok", "not_configured", "unknown", null] as const) {
      expect(
        pagingStatus({ ...times, relay: "ok", directApns: quiet, directFcm: quiet }, NOW),
      ).toEqual({ status: "ok", reasons: [] });
    }
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
    const up = relay();
    // Delivered twice (at-least-once): the second proves nothing new and pings nothing.
    const result = await deliver([heartbeat!, heartbeat!], notifyEnv(), up.send);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1"]);
    expect(result.retryMessages).toEqual([]);
    // A relay without the deep check answers it as a relay from before it: then the token check, the send route
    // with the token and no body, which never reaches APNs.
    // (Both deliveries run side by side, so the order is theirs.)
    expect(new Set(up.urls)).toEqual(
      new Set(["GET https://relay.test/health?deep=1", "POST https://relay.test/send"]),
    );
    expect(new Set(up.auth)).toEqual(new Set(["Bearer test-token"]));
    expect(pings()).toEqual([PING_URL]);
    await pinged(stub, true);
    expect(await stub.health()).toMatchObject({
      status: "ok",
      reasons: [],
      external: { configured: true, lastPingOk: true },
    });
  });

  test("the relay down: no ping, degraded on the third beat in a row, and the change goes to the outbox", async () => {
    const { stub, heartbeats, events, notifyEnv } = watchdog();
    await stub.beat();
    for (const down of [relay(503), relay(null), relay(503)]) {
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

  test("a relay that refuses the send token: no ping, degraded relay_unauthorized", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    await stub.beat();
    const wrong = relay();
    await deliver(await heartbeats(), { ...notifyEnv(), RELAY_SEND_TOKEN: "rotated" }, wrong.send);
    expect(wrong.auth).toEqual(["Bearer rotated"]);
    expect(pings()).toEqual([]);
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_unauthorized"],
      lastOkAt: null,
    });
  });

  test("a relay URL without a send token is not configured, not refused", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    await stub.beat();
    const fake = relay();
    const { RELAY_SEND_TOKEN: _token, ...withoutToken } = notifyEnv();
    await deliver(await heartbeats(), withoutToken, fake.send);
    expect(fake.auth).toEqual([]);
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_not_configured"],
    });
  });

  test("a relay that answers its token check with anything but 400 invalid_body is unreachable", async () => {
    for (const status of [200, 404, 500]) {
      const { stub, heartbeats, notifyEnv } = watchdog();
      for (let n = 0; n < TRANSIENT_FAILURES_TO_DEGRADE; n++) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        await stub.beat();
        await deliver([(await heartbeats()).at(-1)!], notifyEnv(), relay(status).send);
      }
      expect((await stub.health()).reasons, String(status)).toEqual(["relay_unreachable"]);
    }
    expect(pings()).toEqual([]);
  });

  test("a relay not answering on one beat or two changes nothing and still pings; the third in a row degrades", async () => {
    const { stub, heartbeats, events, notifyEnv } = watchdog();
    const beat = async (send: Fetch) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await stub.beat();
      await deliver([(await heartbeats()).at(-1)!], notifyEnv(), send);
    };
    await beat(relay().send);
    await vi.waitFor(() => expect(pings()).toHaveLength(1));
    // A deploy, a blip, a provider check that ran long: the relay does not answer, then does.
    for (const n of [1, 2]) {
      await beat(relay(null).send);
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "ok", reasons: [] });
      await vi.waitFor(() => expect(pings()).toHaveLength(1 + n));
    }
    await beat(relay().send);
    await vi.waitFor(() => expect(pings()).toHaveLength(4));
    // The count started again: two more are still nothing, the third is.
    await beat(relay(503).send);
    await beat(relay(null).send);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
    await vi.waitFor(() => expect(pings()).toHaveLength(6));
    await beat(relay(503).send);
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_unreachable"],
    });
    expect(pings()).toHaveLength(6);
    // Only that one is a change; a refused token right after is one at once.
    await beat(relay().send);
    const changes = (await events()).filter((event) => event.type === STATUS_EVENT);
    expect(changes.map((event) => event.data)).toEqual([
      { status: "ok", previous: "unknown", reasons: [] },
      { status: "degraded", previous: "ok", reasons: ["relay_unreachable"] },
      { status: "ok", previous: "degraded", reasons: [] },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await stub.beat();
    await deliver(
      [(await heartbeats()).at(-1)!],
      { ...notifyEnv(), RELAY_SEND_TOKEN: "rotated" },
      relay().send,
    );
    expect((await stub.health()).reasons).toEqual(["relay_unauthorized"]);
  });

  test("no relay configured: no ping, degraded", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    await stub.beat();
    const none = relay();
    await deliver(await heartbeats(), notifyEnv(null), none.send);
    expect(none.urls).toEqual([]);
    expect(pings()).toEqual([]);
    expect((await stub.health()).reasons).toEqual(["relay_not_configured"]);
  });

  test("a heartbeat that took too long counts as alive inside, but pings nothing; three in a row are pipeline_slow", async () => {
    const { stub, heartbeats } = watchdog();
    const late = async (minute: number, latency: number) => {
      await stub.beat(NOW + minute * MINUTE);
      const newest = (await heartbeats()).at(-1)!;
      return stub.proved(newest.time, "ok", NOW + minute * MINUTE + latency);
    };
    await late(0, 1000);
    await vi.waitFor(() => expect(pings()).toHaveLength(1));
    // One late beat (a batch that waited): nothing changes, but it pings nothing either.
    let health = await late(1, MAX_PROOF_LATENCY_MS + 1);
    expect(health.lastProvedAt).not.toBeNull();
    expect(health).toMatchObject({ status: "ok", reasons: [] });
    health = await late(2, MAX_PROOF_LATENCY_MS + 1);
    expect(health).toMatchObject({ status: "ok", reasons: [] });
    // The third in a row: the dashboard says why the external check heard nothing.
    health = await late(3, MAX_PROOF_LATENCY_MS + 1);
    expect(health).toMatchObject({ status: "degraded", reasons: ["pipeline_slow"] });
    expect(pings()).toHaveLength(1);
    // One on time ends it.
    health = await late(4, 1000);
    expect(health).toMatchObject({ status: "ok", reasons: [] });
    await vi.waitFor(() => expect(pings()).toHaveLength(2));
  });

  test("several heartbeats in one batch: only the newest is proved", async () => {
    const { stub, heartbeats, events, notifyEnv } = watchdog();
    // A Queue that waited: the beat from three minutes ago comes with the one just written.
    await stub.beat(Date.now() - 3 * MINUTE);
    await stub.beat();
    const [old, fresh] = await heartbeats();
    const up = relay();
    // The older one last in the batch too: order does not matter.
    const result = await deliver([fresh!, old!, fresh!], notifyEnv(), up.send);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1", "msg-2"]);
    expect(result.retryMessages).toEqual([]);
    // One proof: one deep check (and the old relay's token check after it).
    expect(up.urls).toEqual([
      "GET https://relay.test/health?deep=1",
      "POST https://relay.test/send",
    ]);
    expect(pings()).toEqual([PING_URL]);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
    expect(
      (await events()).filter((event) => event.type === STATUS_EVENT).map((event) => event.data),
    ).toEqual([{ status: "ok", previous: "unknown", reasons: [] }]);
  });

  test("a backed-up queue (beats ten minutes late): degraded, no pings, though the relay is up", async () => {
    const { stub, heartbeats, events } = watchdog();
    for (let minute = 0; minute <= 20; minute++) {
      await stub.beat(NOW + minute * MINUTE);
      if (minute < 10) continue;
      // Each minute the consumer gets the beat from ten minutes earlier.
      const late = (await heartbeats())[minute - 10]!;
      await stub.proved(late.time, "ok", NOW + minute * MINUTE + 1000);
    }
    expect(await stub.health(NOW + 20 * MINUTE + 1000)).toMatchObject({
      status: "degraded",
      reasons: ["pipeline_stalled", "pipeline_slow"],
    });
    expect(pings()).toEqual([]);
    // Each change of reasons is an event, not only each change of status.
    const changes = (await events()).filter((event) => event.type === STATUS_EVENT);
    expect(changes.map((event) => event.data)).toEqual([
      { status: "degraded", previous: "unknown", reasons: ["pipeline_stalled"] },
      { status: "degraded", previous: "degraded", reasons: ["pipeline_stalled", "pipeline_slow"] },
    ]);
  });

  test("an external check that never answers does not hold up proved()", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat();
    // Hangs until the watchdog's own timeout aborts it.
    vi.mocked(globalThis.fetch).mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        ),
    );
    // The real 5 s would be waited out in full below; the order of events is the same with a shorter one.
    const timeout = 500;
    await runInDurableObject(stub, (instance: WatchdogDO) => {
      Reflect.set(instance, "pingTimeoutMs", timeout);
    });
    const [heartbeat] = await heartbeats();
    const started = Date.now();
    const health = await stub.proved(heartbeat!.time, "ok");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(health.status).toBe("ok");
    expect(pings()).toEqual([PING_URL]);
    // Recorded as failed once the timeout gives up on it.
    await vi.waitFor(async () => expect((await stub.health()).external.lastPingOk).toBe(false), {
      timeout: timeout + 2000,
      interval: 50,
    });
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

  test("an older ping finishing after a newer one does not overwrite its result", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    await stub.beat(NOW + MINUTE);
    const [first, second] = await heartbeats();
    // The first ping answers OK, but only after the second one has failed.
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(globalThis.fetch)
      .mockImplementationOnce(async () => {
        await slow;
        return new Response("OK");
      })
      .mockImplementationOnce(async () => new Response(null, { status: 500 }));
    await stub.proved(first!.time, "ok", NOW + 1000);
    await stub.proved(second!.time, "ok", NOW + MINUTE + 1000);
    await pinged(stub, false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await stub.health()).external.lastPingOk).toBe(false);
  });

  test("an external check that refuses the ping is recorded, not thrown", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    pingAnswer = () => new Response(null, { status: 500 });
    const [heartbeat] = await heartbeats();
    await stub.proved(heartbeat!.time, "ok", NOW + 1000);
    await pinged(stub, false);
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

  test("a relay with the deep check: the providers are recorded; APNs, FCM or D1 failing stops the pings", async () => {
    const { stub, heartbeats, events, notifyEnv } = watchdog();
    const { deep, beat } = deepBeats(stub, heartbeats, notifyEnv);
    const ok = deep("ok");
    await beat(ok.send, { DB: env.DB });
    // One request: no token check on the send route once the deep check answered.
    expect(ok.urls).toEqual(["GET https://relay.test/health?deep=1"]);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
    await pinged(stub, true);
    expect(pings()).toHaveLength(1);

    await beat(deep("error").send);
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["apns_failing"] });
    expect(pings()).toHaveLength(1);
    // What APNs answered goes with the change, for the operators; `GET /health/paging` never has it.
    const changed = async () =>
      (await events()).filter((event) => event.type === STATUS_EVENT).at(-1)!.data;
    expect(await changed()).toMatchObject({ answers: { apns_failing: "InvalidProviderToken" } });
    expect(JSON.stringify(await stub.health())).not.toContain("InvalidProviderToken");

    await beat(deep("ok", "error").send);
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["fcm_failing"] });
    expect(await changed()).toMatchObject({ answers: { fcm_failing: "refused" } });
    expect(pings()).toHaveLength(1);

    // One D1 read per beat: a D1 that keeps throwing degrades the status and silences the external check too, from
    // its third beat in a row (the two before still ping).
    for (let n = 0; n < TRANSIENT_FAILURES_TO_DEGRADE; n++) {
      await beat(deep("ok").send, { DB: BROKEN_D1 });
    }
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["d1_failing"] });
    await vi.waitFor(() => expect(pings()).toHaveLength(TRANSIENT_FAILURES_TO_DEGRADE));
    // FCM not configured (a relay serving iOS only) is no failure: pings again.
    await beat(deep("ok").send, { DB: env.DB });
    await vi.waitFor(() => expect(pings()).toHaveLength(TRANSIENT_FAILURES_TO_DEGRADE + 1));
  });

  test("a transient deep-check failure stops nothing until the third beat in a row; a refused key degrades at once", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { deep, beat } = deepBeats(stub, heartbeats, notifyEnv);
    await beat(deep("ok").send, { DB: env.DB });
    await vi.waitFor(() => expect(pings()).toHaveLength(1));
    // APNs not answering in time on one beat, then two: still ok, and still pinging.
    for (const n of [1, 2]) {
      await beat(deep("transient").send, { DB: env.DB });
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "ok", reasons: [] });
      await vi.waitFor(() => expect(pings()).toHaveLength(1 + n));
    }
    // The third in a row degrades and stops the ping.
    await beat(deep("transient").send, { DB: env.DB });
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["apns_failing"] });
    expect(pings()).toHaveLength(3);
    // Back to ok: pings again. FCM's token endpoint and D1 failing count their own runs the same way.
    await beat(deep("ok").send, { DB: env.DB });
    await vi.waitFor(() => expect(pings()).toHaveLength(4));
    for (const n of [1, 2]) {
      await beat(deep("ok", "transient").send, { DB: BROKEN_D1 });
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "ok", reasons: [] });
      await vi.waitFor(() => expect(pings()).toHaveLength(4 + n));
    }
    await beat(deep("ok", "transient").send, { DB: BROKEN_D1 });
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["fcm_failing", "d1_failing"],
    });
    expect(pings()).toHaveLength(6);

    // A refused key (no `transient`) degrades on its first beat.
    const fresh = watchdog();
    const once = deepBeats(fresh.stub, fresh.heartbeats, fresh.notifyEnv);
    await once.beat(once.deep("ok").send, { DB: env.DB });
    await vi.waitFor(() => expect(pings()).toHaveLength(7));
    const { lastOkAt } = await fresh.stub.health();
    expect(lastOkAt).not.toBeNull();
    await once.beat(once.deep("error").send, { DB: env.DB });
    // The relay answered, but a page to an iPhone could not have gone out: "last OK" stays where it was.
    expect(await fresh.stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["apns_failing"],
      lastOkAt,
    });
    expect(pings()).toHaveLength(7);
  });

  /** A mail sender that records what it sent; `answer` decides each send. */
  function mailbox(answer: () => EmailResult = () => ({ ok: true })) {
    const sent: OutgoingEmail[] = [];
    let tries = 0;
    const mail: EmailSender = {
      id: "test",
      async send(email) {
        tries++;
        const result = answer();
        if (result.ok) sent.push(email);
        return result;
      },
    };
    return { sent, mail, tries: () => tries };
  }

  /** A watchdog that emails `operators` itself through `mail`, and helpers to drive its status. */
  async function emailingWatchdog(mail: EmailSender, operators = "ops@example.com") {
    const dog = watchdog();
    await runInDurableObject(dog.stub, (instance: WatchdogDO) => {
      Reflect.set(instance, "env", { ...env, OPERATOR_EMAILS: operators });
      Reflect.set(instance, "mail", () => mail);
    });
    /** The status changes still waiting to be emailed. */
    const waiting = () =>
      runInDurableObject(dog.stub, (_instance: WatchdogDO, state) =>
        state.storage.sql
          .exec<{ tries: number }>("select tries from operator_email_queue")
          .toArray(),
      );
    /** Lets the emails a beat or a proof started in `waitUntil` finish. */
    const flushed = () =>
      vi.waitFor(async () =>
        expect(
          await runInDurableObject(dog.stub, (instance: WatchdogDO) =>
            Reflect.get(instance, "emailing"),
          ),
        ).toBe(false),
      );
    /** Beats at `minute` and proves that beat a second later: ok (or as `checks` say). */
    const proveAt = async (minute: number, checks?: BeatChecks) => {
      await dog.stub.beat(NOW + minute * MINUTE);
      await flushed();
      const newest = (await dog.heartbeats()).at(-1)!;
      await dog.stub.proved(newest.time, "ok", NOW + minute * MINUTE + 1000, checks);
      await flushed();
    };
    return { ...dog, waiting, flushed, proveAt };
  }
  const DEGRADED = "Brigade's paging self-check is degraded";
  const NORMAL = "Brigade's paging self-check is back to normal";
  const APNS_REFUSED: BeatChecks = { apns: "error", fcm: "ok", d1: "ok" };

  test("a change is emailed once it held for OPERATOR_EMAIL_HOLD_MS: with the second beat after it", async () => {
    expect(OPERATOR_EMAIL_HOLD_MS).toBeGreaterThan(MINUTE);
    expect(OPERATOR_EMAIL_HOLD_MS).toBeLessThan(2 * MINUTE);
    const { sent, mail } = mailbox();
    const { proveAt, waiting } = await emailingWatchdog(mail);
    // A new watchdog's first proof (unknown to ok) tells nobody anything.
    await proveAt(0);
    expect(sent).toEqual([]);
    await proveAt(1, APNS_REFUSED);
    await proveAt(2, APNS_REFUSED);
    expect(sent).toEqual([]);
    expect(await waiting()).toEqual([{ tries: 0 }]);
    await proveAt(3, APNS_REFUSED);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    expect(sent[0]!.to.email).toBe("ops@example.com");
    await proveAt(4);
    await proveAt(5);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    await proveAt(6);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED, NORMAL]);
    expect(await waiting()).toEqual([]);
  });

  test("a change undone before its email went out emails nobody, both ways", async () => {
    const { sent, mail } = mailbox();
    const { stub, events, heartbeats, proveAt, flushed, waiting } = await emailingWatchdog(mail);
    await proveAt(0);
    // Degraded on one proof, ok on the next: logged and evented, emailed to nobody.
    await proveAt(1, APNS_REFUSED);
    await proveAt(2);
    for (let minute = 3; minute <= 5; minute++) await proveAt(minute);
    expect(sent).toEqual([]);
    expect(await waiting()).toEqual([]);
    const changes = async () =>
      (await events()).filter((event) => event.type === STATUS_EVENT).map((event) => event.data);
    expect((await changes()).slice(-2)).toEqual([
      { status: "degraded", previous: "ok", reasons: ["apns_failing"] },
      { status: "ok", previous: "degraded", reasons: [] },
    ]);
    // A Queue that held two beats: the beat at 12:08 finds 12:05 the newest proved (three and a half minutes
    // would be stalled), and its proof a second later is on time.
    await stub.beat(NOW + 6 * MINUTE);
    await stub.beat(NOW + 7 * MINUTE);
    await stub.beat(NOW + 8 * MINUTE);
    await flushed();
    expect((await stub.health(NOW + 8 * MINUTE)).status).toBe("ok");
    // One more minute of silence is stalled; the backlog's newest beat proved a second later undoes it.
    await stub.beat(NOW + 9 * MINUTE);
    await flushed();
    expect((await stub.health(NOW + 9 * MINUTE)).reasons).toEqual(["pipeline_stalled"]);
    await stub.proved((await heartbeats()).at(-1)!.time, "ok", NOW + 9 * MINUTE + 1000);
    await flushed();
    for (let minute = 10; minute <= 13; minute++) await proveAt(minute);
    expect(sent).toEqual([]);

    // The other way: degraded and told, then ok for a moment and degraded again: no "back to normal", no repeat.
    await proveAt(14, APNS_REFUSED);
    await proveAt(15, APNS_REFUSED);
    await proveAt(16, APNS_REFUSED);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    await proveAt(17);
    await proveAt(18, APNS_REFUSED);
    for (let minute = 19; minute <= 21; minute++) await proveAt(minute, APNS_REFUSED);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    expect(await waiting()).toEqual([]);
  });

  test("a status that keeps changing is still emailed: the newest change, on the first one's time", async () => {
    const { sent, mail } = mailbox();
    const { proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    // Degraded with a new reason each minute: each change replaces the last, but the first one's hold still ends.
    await proveAt(1, APNS_REFUSED);
    await proveAt(2, { apns: "error", fcm: "error", d1: "ok" });
    await proveAt(3, { apns: "ok", fcm: "error", d1: "ok" });
    // Sent by the beat at 12:03, the first one's hold over: the status as the 12:02 proof left it, not as it first
    // changed.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe(DEGRADED);
    expect(sent[0]!.text).toContain("Firebase Cloud Messaging gave the relay no access token.");
    expect(sent[0]!.text).toContain("Apple's push service refused");
    // Its proof changed it again (FCM alone): that one waits a hold of its own, the last having gone out.
    await proveAt(4, { apns: "ok", fcm: "error", d1: "ok" });
    expect(sent).toHaveLength(1);
    await proveAt(5, { apns: "ok", fcm: "error", d1: "ok" });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.text).not.toContain("Apple's push service refused");
  });

  test("a stalled queue: the watchdog emails the operators itself as the status degrades", async () => {
    const { sent, mail } = mailbox();
    const { stub, heartbeats, events, notifyEnv, flushed, proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    // The Queue stops: beats keep coming, none comes back, and nothing is drained. Stalled from the beat at 12:04,
    // emailed two beats later.
    for (let minute = 1; minute <= 6; minute++) await stub.beat(NOW + minute * MINUTE);
    await flushed();
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    expect(sent[0]!.text).toContain("stopped getting through the event queue");
    // The Queue comes back: the backlog proves the newest beat, back to ok, emailed from the watchdog too.
    await stub.proved((await heartbeats()).at(-1)!.time, "ok", NOW + 6 * MINUTE + 5000);
    await flushed();
    await stub.beat(NOW + 7 * MINUTE);
    await stub.beat(NOW + 8 * MINUTE);
    await flushed();
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED, NORMAL]);
    // The changes the Queue held send nothing more through the consumer.
    const changes = (await events()).filter((event) => event.type === STATUS_EVENT);
    expect(changes).toHaveLength(3);
    const result = await deliver(changes, notifyEnv(), relay().send, mail);
    expect(result.explicitAcks).toHaveLength(3);
    expect(sent).toHaveLength(2);
  });

  test("the instance's own push key failing keeps pinging and emails the operators that the relay pages meanwhile", async () => {
    const { sent, mail } = mailbox();
    const { stub, proveAt } = await emailingWatchdog(mail);
    /** Just after the proof at `minute`: `health` reads the clock otherwise. */
    const at = (minute: number) => NOW + minute * MINUTE + 2000;
    const direct = (apns: BeatCheck, fcm: BeatCheck = "ok"): BeatChecks => ({
      apns: "ok",
      fcm: "ok",
      d1: "ok",
      directApns: apns,
      directFcm: fcm,
    });
    const subjects = () => sent.map((one) => one.subject);
    await proveAt(0, direct("ok"));
    await pinged(stub, true);
    expect(sent).toEqual([]);
    // Apple refuses the instance's own key: still ok, still pinging, and the operators hear of it once.
    await proveAt(1, direct("error"));
    expect(await stub.health(at(1))).toMatchObject({
      status: "ok",
      reasons: ["direct_apns_failing"],
    });
    await vi.waitFor(() => expect(pings()).toHaveLength(2));
    await proveAt(2, direct("error"));
    await proveAt(3, direct("error"));
    expect(subjects()).toEqual(["Brigade's own push key is failing: pages go through the relay"]);
    expect(sent.at(-1)!.text).toContain("Apple's push service refused this instance's own key");
    await proveAt(4, direct("error"));
    expect(sent).toHaveLength(1);
    // A slow answer counts only on the third in a row, as the relay's checks do.
    await proveAt(5, direct("ok", "transient"));
    await proveAt(6, direct("ok", "transient"));
    expect(await stub.health(at(6))).toMatchObject({ status: "ok", reasons: [] });
    await proveAt(7, direct("ok", "transient"));
    expect(await stub.health(at(7))).toMatchObject({
      status: "ok",
      reasons: ["direct_fcm_failing"],
    });
    // The two minutes Apple was fine (ok, no reason) were long enough to say so.
    expect(subjects()).toEqual([
      "Brigade's own push key is failing: pages go through the relay",
      NORMAL,
    ]);
    // Still unknown (no relay answer yet), a failing own key is listed too.
    const { renderOperatorStatusEmail } = await import("../src/email-templates.ts");
    const unknown = renderOperatorStatusEmail(
      { status: "unknown", reasons: ["direct_fcm_failing"] },
      { email: "ops@example.com" },
      "en",
    );
    expect(unknown.text).toContain("Google refused this instance's own Firebase service account");
    // Direct sends turned off: nothing of them is kept.
    for (let minute = 8; minute <= 10; minute++) {
      await proveAt(minute, { apns: "ok", fcm: "ok", d1: "ok" });
    }
    expect(await stub.health(at(10))).toMatchObject({ status: "ok", reasons: [] });
    // FCM's own key failing for a minute and a bit, then gone: the operators were last told "back to normal".
    expect(subjects()).toHaveLength(2);
  });

  test("what a failing provider check was answered reaches the status change and the operators' email, as one word", async () => {
    const { sent, mail } = mailbox();
    const { stub, events, proveAt } = await emailingWatchdog(mail);
    const changes = async () =>
      (await events()).filter((event) => event.type === STATUS_EVENT).map((event) => event.data);
    /** APNs refusing a new provider token as changed too often: a limit, so `transient` (apps/relay deep-health). */
    const limited: BeatChecks = {
      apns: "transient",
      fcm: "ok",
      d1: "ok",
      answers: { apns: "TooManyProviderTokenUpdates" },
    };
    const fine: BeatChecks = { apns: "ok", fcm: "ok", d1: "ok" };
    await proveAt(0, fine);
    // One limited beat, then one that passes, as two signers of one key meeting on a connection look: nobody hears.
    await proveAt(1, limited);
    await proveAt(2, fine);
    await proveAt(3, limited);
    await proveAt(4, limited);
    expect(await stub.health(NOW + 4 * MINUTE + 2000)).toMatchObject({ status: "ok", reasons: [] });
    expect(sent).toHaveLength(0);
    // The third in a row is a limit pages meet too: degraded, and the email says what APNs answered.
    await proveAt(5, limited);
    expect((await changes()).at(-1)).toEqual({
      status: "degraded",
      previous: "ok",
      reasons: ["apns_failing"],
      answers: { apns_failing: "TooManyProviderTokenUpdates" },
    });
    await proveAt(6, limited);
    await proveAt(7, limited);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain(
      "so iPhones can't be paged. The check's answer: TooManyProviderTokenUpdates.",
    );
    // Passing again: the answer is forgotten with the failure.
    await proveAt(8, fine);
    expect((await changes()).at(-1)).toEqual({ status: "ok", previous: "degraded", reasons: [] });

    // The instance's own key, refused at once; an answer that is not one word is never kept or emailed.
    const refused: BeatChecks = {
      apns: "ok",
      fcm: "error",
      d1: "ok",
      directApns: "error",
      answers: { fcm: "<b>not a word</b>", directApns: "InvalidProviderToken" },
    };
    await proveAt(9, refused);
    expect((await changes()).at(-1)).toEqual({
      status: "degraded",
      previous: "ok",
      reasons: ["fcm_failing", "direct_apns_failing"],
      answers: { direct_apns_failing: "InvalidProviderToken" },
    });
    await proveAt(10, refused);
    await proveAt(11, refused);
    expect(sent.at(-1)!.text).toContain("The check's answer: InvalidProviderToken.");
    expect(sent.at(-1)!.text).not.toContain("not a word");
    // An older consumer says no answer: the earlier one does not stay on a failure it did not describe.
    await proveAt(12, { apns: "ok", fcm: "ok", d1: "ok", directApns: "error" });
    await proveAt(13, { apns: "error", fcm: "ok", d1: "ok", directApns: "error" });
    expect((await changes()).at(-1)).toEqual({
      status: "degraded",
      previous: "ok",
      reasons: ["apns_failing", "direct_apns_failing"],
    });
    // Nor on a check that stays failing: a later beat without a word for it (transient here) forgets the earlier one,
    // so the next change does not repeat an answer that beat never gave.
    await proveAt(14, fine);
    await proveAt(15, {
      apns: "error",
      fcm: "ok",
      d1: "ok",
      answers: { apns: "InvalidProviderToken" },
    });
    expect((await changes()).at(-1)).toMatchObject({
      answers: { apns_failing: "InvalidProviderToken" },
    });
    await proveAt(16, { apns: "transient", fcm: "error", d1: "ok" });
    expect((await changes()).at(-1)).toEqual({
      status: "degraded",
      previous: "degraded",
      reasons: ["apns_failing", "fcm_failing"],
    });
  });

  test("an email that failed is tried again on the next beats, then given up", async () => {
    let down = 2;
    const box = mailbox(() =>
      down-- > 0 ? { ok: false, retry: true, code: "E_INTERNAL_SERVER_ERROR" } : { ok: true },
    );
    const { stub, heartbeats, waiting, flushed, proveAt } = await emailingWatchdog(box.mail);
    await proveAt(0);
    await proveAt(1, APNS_REFUSED);
    await proveAt(2, APNS_REFUSED);
    await stub.beat(NOW + 3 * MINUTE);
    await flushed();
    expect(await waiting()).toEqual([{ tries: 1 }]);
    // Not again within the minute (a proof a moment later), then on the next beats until it goes.
    await stub.proved(
      (await heartbeats()).at(-1)!.time,
      "ok",
      NOW + 3 * MINUTE + 1000,
      APNS_REFUSED,
    );
    await flushed();
    expect(box.tries()).toBe(1);
    await stub.beat(NOW + 4 * MINUTE);
    await flushed();
    expect(await waiting()).toEqual([{ tries: 2 }]);
    await stub.beat(NOW + 5 * MINUTE);
    await flushed();
    expect(await waiting()).toEqual([]);
    expect(box.sent.map((one) => one.subject)).toEqual([DEGRADED]);

    // An email that never goes is given up after OPERATOR_EMAIL_TRIES tries.
    const never = mailbox(() => ({ ok: false, retry: true, code: "E_INTERNAL_SERVER_ERROR" }));
    const other = await emailingWatchdog(never.mail);
    await other.proveAt(0);
    for (let minute = 1; minute <= 2 + OPERATOR_EMAIL_TRIES; minute++) {
      await other.proveAt(minute, APNS_REFUSED);
    }
    expect(never.tries()).toBe(OPERATOR_EMAIL_TRIES);
    expect(await other.waiting()).toEqual([]);
  });

  test("a degraded email waiting to be tried again is never sent once the status is back to normal", async () => {
    let down = 2;
    const box = mailbox(() =>
      down-- > 0 ? { ok: false, retry: true, code: "E_INTERNAL_SERVER_ERROR" } : { ok: true },
    );
    const { waiting, proveAt } = await emailingWatchdog(box.mail);
    await proveAt(0);
    await proveAt(1, APNS_REFUSED);
    await proveAt(2, APNS_REFUSED);
    await proveAt(3, APNS_REFUSED);
    await proveAt(4); // the beat tries again and fails; its proof is back to normal
    expect(box.tries()).toBe(2);
    expect(await waiting()).toEqual([]);
    for (let minute = 5; minute <= 8; minute++) await proveAt(minute);
    // Neither the stale "degraded" nor a "back to normal" for something never told.
    expect(box.sent).toEqual([]);
    expect(box.tries()).toBe(2);
  });

  test("OPERATOR_EMAILS are emailed each status change, once each, capped per hour", async () => {
    const { sent, mail } = mailbox();
    const { proveAt } = await emailingWatchdog(
      mail,
      " ops@example.com, not an address ,oncall@example.test,Ops@Example.com",
    );
    await proveAt(0);
    await proveAt(1, { apns: "error", fcm: "ok", d1: "error" });
    await proveAt(2, { apns: "error", fcm: "ok", d1: "error" });
    await proveAt(3, { apns: "error", fcm: "ok", d1: "error" });
    const to = (subject: string) =>
      sent
        .filter((one) => one.subject === subject)
        .map((one) => one.to.email)
        .sort();
    expect(to(DEGRADED)).toEqual(["oncall@example.test", "ops@example.com"]);
    const degraded = sent.find((one) => one.subject === DEGRADED)!;
    expect(degraded.text).toContain("Apple's push service refused the relay's key");
    expect(degraded.text).toContain("The database (D1) didn't answer a simple read.");
    // Flapping: ok and degraded in turn, three minutes each, long enough to be emailed. At most
    // OPERATOR_EMAIL_HOURLY_CAP an hour are; the change past it waits for a place.
    const phase = (minute: number) => Math.floor((minute - 1) / 3) % 2 === 0;
    for (let minute = 4; minute <= 40; minute++) {
      await proveAt(minute, phase(minute) ? APNS_REFUSED : undefined);
    }
    expect(sent).toHaveLength(OPERATOR_EMAIL_HOURLY_CAP * 2);
    expect(sent.filter((_, i) => i % 2 === 0).map((one) => one.subject)).toEqual(
      Array.from({ length: OPERATOR_EMAIL_HOURLY_CAP }, (_, i) =>
        i % 2 === 0 ? DEGRADED : NORMAL,
      ),
    );
    // Stays degraded: once the hour frees a place, the operators are told the status as it is.
    for (let minute = 41; minute <= 66; minute++) await proveAt(minute, APNS_REFUSED);
    expect(sent).toHaveLength(OPERATOR_EMAIL_HOURLY_CAP * 2 + 2);
    expect(sent.at(-1)!.subject).toBe(DEGRADED);
    expect(operatorAddresses("a@example.com,,  c@example.test ,x")).toEqual([
      "a@example.com",
      "c@example.test",
    ]);
    // The same address in another case is one operator.
    expect(operatorAddresses("Ops@Example.com, ops@example.com,OPS@EXAMPLE.COM")).toEqual([
      "ops@example.com",
    ]);
  });

  test("without OPERATOR_EMAILS, or without email set up, nothing is sent and nothing waits", async () => {
    const { sent, mail } = mailbox();
    const nobody = await emailingWatchdog(mail, "");
    const unset = await emailingWatchdog(mail);
    await runInDurableObject(unset.stub, (instance: WatchdogDO) => {
      Reflect.set(instance, "mail", () => undefined);
    });
    for (const dog of [nobody, unset]) {
      await dog.proveAt(0);
      for (let minute = 1; minute <= 3; minute++) await dog.proveAt(minute, APNS_REFUSED);
      expect(await dog.waiting()).toEqual([]);
    }
    expect(sent).toEqual([]);
  });

  test("the operators' email is sent past the instance's daily email ceiling", async () => {
    const inner = mailbox();
    // A ceiling of one, already used up today.
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      `insert into "email_day" ("day", "sent") values (?, 1) on conflict ("day") do update set "sent" = "sent" + 1`,
    )
      .bind(day)
      .run();
    const mail = withEmailCeiling(inner.mail, env.DB, 1);
    expect(
      (await mail.send({ to: { email: "x@example.com" }, subject: "s", text: "t", html: "h" })).ok,
    ).toBe(false);
    const { proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    for (let minute = 1; minute <= 3; minute++) await proveAt(minute, APNS_REFUSED);
    expect(inner.sent.map((one) => one.to.email)).toEqual(["ops@example.com"]);
  });

  test("a watchdog from before the operators' last state was kept: its recorded status is what they were told", async () => {
    const { sent, mail } = mailbox();
    const { stub, proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    for (let minute = 1; minute <= 3; minute++) await proveAt(minute, APNS_REFUSED);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED]);
    // Deployed while degraded: nothing says what was emailed, and the old queue still holds two changes.
    await runInDurableObject(stub, (_instance: WatchdogDO, state) => {
      state.storage.sql.exec("delete from watchdog_state where key = 'notified'");
    });
    for (let minute = 4; minute <= 6; minute++) await proveAt(minute);
    expect(sent.map((one) => one.subject)).toEqual([DEGRADED, NORMAL]);
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
    const up = relay();
    const result = await deliver([event], notifyEnv(), up.send);
    expect(result.explicitAcks).toEqual(["msg-0"]);
    expect(up.urls).toEqual([]);
  });
});

// With an instance key (RFC 0015 sections 3 and 7) the deep check is the relay's signed `GET /v1/health?deep=1`, and
// the instance's own state on the relay is a reason of its own. With the send token too, its check runs beside it.
describe("the signed deep check (RFC 0015)", () => {
  let key: Awaited<ReturnType<typeof generateInstanceKey>>;
  beforeAll(async () => {
    key = await generateInstanceKey();
  });
  const PROVIDERS = { apns: { status: "ok" }, fcm: { status: "not_configured" } };

  /**
   * A relay answering the signed deep check with `answer`, and the send token's check (`POST /send`, no body) as
   * apps/relay does (`400 invalid_body` for `test-token`, `401` for any other) unless `token` says otherwise.
   */
  function signedRelay(answer: () => Response, token?: () => Response) {
    const calls: { url: string; auth: string | null; signed: boolean }[] = [];
    const tokenChecks: (string | null)[] = [];
    const send: Fetch = async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/send") {
        tokenChecks.push(request.headers.get("Authorization"));
        if (token) return token();
        return request.headers.get("Authorization") === "Bearer test-token"
          ? Response.json({ error: "invalid_body" }, { status: 400 })
          : Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const verified = await verifyRequest({
        method: request.method,
        path: url.pathname + url.search,
        headers: request.headers,
        body: await request.text(),
        now: Date.now(),
      });
      calls.push({
        url: `${request.method} ${request.url}`,
        auth: request.headers.get("Authorization"),
        signed: verified.ok && verified.instance === key.instance,
      });
      return answer();
    };
    return { calls, tokenChecks, send };
  }
  const admitted = () =>
    Response.json({ ok: true, ...PROVIDERS, handles: true, instance: key.instance });

  test("an admitted instance: signed, the providers recorded, the send token checked beside it, and a ping", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const up = signedRelay(admitted);
    await beat(up.send, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
    expect(up.calls).toEqual([
      { url: "GET https://relay.test/v1/health?deep=1", auth: null, signed: true },
    ]);
    expect(up.tokenChecks).toEqual(["Bearer test-token"]);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
    await pinged(stub, true);
    // Without a send token, only the signed check.
    const alone = signedRelay(admitted);
    await beat(alone.send, {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_SEND_TOKEN: undefined,
      DB: env.DB,
    });
    expect(alone.tokenChecks).toEqual([]);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
  });

  test("a send token the relay refuses is a reason beside an admitted instance, and pings nothing", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    await beat(signedRelay(admitted).send, {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_SEND_TOKEN: "rotated",
      DB: env.DB,
    });
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_unauthorized"],
      lastOkAt: null,
    });
    // Both failing say both.
    await beat(
      signedRelay(() => Response.json({ error: "instance_revoked" }, { status: 403 })).send,
      { RELAY_INSTANCE_KEY: key.privateKey, RELAY_SEND_TOKEN: "rotated", DB: env.DB },
    );
    expect((await stub.health()).reasons).toEqual(["relay_unauthorized", "relay_instance_revoked"]);
    expect(pings()).toEqual([]);
  });

  test("each refusal of the instance degrades with its reason, and pings nothing", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    for (const [answer, reason] of [
      [() => Response.json({ error: "bad_signature" }, { status: 401 }), "relay_bad_signature"],
      [() => Response.json({ error: "stale_timestamp" }, { status: 401 }), "relay_bad_signature"],
      [
        () => Response.json({ error: "instance_unregistered" }, { status: 403 }),
        "relay_instance_unregistered",
      ],
      [
        () => Response.json({ error: "instance_revoked" }, { status: 403 }),
        "relay_instance_revoked",
      ],
      [
        () =>
          Response.json(
            { ok: false, ...PROVIDERS, handles: false, instance: key.instance },
            { status: 503 },
          ),
        "relay_handles_unavailable",
      ],
    ] as const) {
      await beat(signedRelay(answer).send, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
      expect((await stub.health()).reasons, reason).toEqual([reason]);
    }
    // A registry that does not answer is the relay not answering: on the third beat in a row.
    const unavailable = () => Response.json({ error: "registry_unavailable" }, { status: 503 });
    for (let n = 0; n < TRANSIENT_FAILURES_TO_DEGRADE; n++) {
      await beat(signedRelay(unavailable).send, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
    }
    expect((await stub.health()).reasons).toEqual(["relay_unreachable"]);
    expect(pings()).toEqual([]);
  });

  test("the send token's check not answering beside an admitted instance counts on the third beat in a row", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const vars = { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB };
    const slowToken = signedRelay(admitted, () => new Response(null, { status: 503 }));
    await beat(signedRelay(admitted).send, vars);
    await vi.waitFor(() => expect(pings()).toHaveLength(1));
    for (const n of [1, 2]) {
      await beat(slowToken.send, vars);
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "ok", reasons: [] });
      await vi.waitFor(() => expect(pings()).toHaveLength(1 + n));
    }
    await beat(slowToken.send, vars);
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_unreachable"],
    });
    expect(pings()).toHaveLength(3);
    // A refused token is at once.
    await beat(signedRelay(admitted).send, vars);
    await beat(signedRelay(admitted).send, { ...vars, RELAY_SEND_TOKEN: "rotated" });
    expect((await stub.health()).reasons).toEqual(["relay_unauthorized"]);
    // A new watchdog whose send token never answered yet: not a failure until the third, as for the relay.
    const fresh = watchdog();
    const once = deepBeats(fresh.stub, fresh.heartbeats, fresh.notifyEnv);
    await once.beat(slowToken.send, vars);
    expect(await fresh.stub.health()).toMatchObject({ status: "ok", reasons: [] });
  });

  test("the relay's limits degrade only on the third limited beat in a row (shared egress IPs, Q28)", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const limited = () =>
      Response.json(
        { error: "rate_limited", limit: "ip" },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    const vars = { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB };
    await beat(signedRelay(admitted).send, vars);
    for (const n of [1, 2]) {
      await beat(signedRelay(limited).send, vars);
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "ok", reasons: [] });
    }
    await beat(signedRelay(limited).send, vars);
    expect((await stub.health()).reasons).toEqual(["relay_rate_limited"]);
    // An answer that is not limited starts the count again.
    await beat(signedRelay(admitted).send, vars);
    await beat(signedRelay(limited).send, vars);
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
  });

  test("a key that does not read, or an instance id that is not one, is a bad signature, asked of no relay", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    for (const vars of [
      { RELAY_INSTANCE_KEY: "not-a-key" },
      { RELAY_INSTANCE_KEY: key.privateKey, RELAY_INSTANCE_ID: "ins_short" },
    ]) {
      const none = signedRelay(admitted);
      await beat(none.send, { ...vars, DB: env.DB });
      expect(none.calls).toEqual([]);
      expect((await stub.health()).reasons).toEqual(["relay_bad_signature"]);
    }
  });

  test("a rotated key signs as RELAY_INSTANCE_ID, the instance's first id", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const rotated = await generateInstanceKey();
    const instances: (string | null)[] = [];
    const send: Fetch = async (request) => {
      if (new URL(request.url).pathname === "/send") {
        return Response.json({ error: "invalid_body" }, { status: 400 });
      }
      const verified = await verifyRequest({
        method: request.method,
        path: new URL(request.url).pathname + new URL(request.url).search,
        headers: request.headers,
        body: "",
        now: Date.now(),
      });
      instances.push(verified.ok && !verified.original ? verified.instance : null);
      return admitted();
    };
    await beat(send, {
      RELAY_INSTANCE_KEY: rotated.privateKey,
      RELAY_INSTANCE_ID: key.instance,
      DB: env.DB,
    });
    expect(instances).toEqual([key.instance]);
    expect(await stub.health()).toMatchObject({ status: "ok" });
  });

  test("a relay without /v1: the send token's check still runs for raw-token phones, but handle phones are a reason", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const old: Fetch = async (request) =>
      new URL(request.url).pathname.startsWith("/v1/")
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json({ ok: true, ...PROVIDERS });
    await beat(old, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
    // The old deep check took the send token: no reason of its own, but phones with a handle cannot be paged.
    expect(await stub.health()).toMatchObject({
      status: "degraded",
      reasons: ["relay_handles_unavailable"],
      lastOkAt: null,
    });
    // The send token refused too: both.
    await beat(old, {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_SEND_TOKEN: "rotated",
      DB: env.DB,
    });
    await beat(
      async (request) =>
        new URL(request.url).pathname.startsWith("/v1/")
          ? Response.json({ error: "not_found" }, { status: 404 })
          : Response.json({ error: "unauthorized" }, { status: 401 }),
      { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB },
    );
    expect((await stub.health()).reasons).toEqual([
      "relay_unauthorized",
      "relay_handles_unavailable",
    ]);
    await beat(old, {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_SEND_TOKEN: undefined,
      DB: env.DB,
    });
    expect((await stub.health()).reasons).toEqual(["relay_handles_unavailable"]);
    expect(pings()).toEqual([]);
  });

  test("a new watchdog whose proofs met only the relay's limits is unknown, as it pinged nothing", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const limited = signedRelay(() =>
      Response.json({ error: "rate_limited", limit: "ip" }, { status: 429 }),
    );
    for (const n of [1, 2]) {
      await beat(limited.send, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
      expect(await stub.health(), `beat ${n}`).toMatchObject({ status: "unknown", reasons: [] });
    }
    expect(pings()).toEqual([]);
  });
});

describe("GET /health/paging", () => {
  const ORIGIN = "http://api.test";
  let people = 0;
  const api = (path: string, init: { method?: string; body?: string; cookie?: string } = {}) =>
    exports.default.fetch(`${ORIGIN}${path}`, {
      method: init.method,
      body: init.body,
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        // Sign-up is rate-limited per IP (TEST-NET-3, RFC 5737).
        "cf-connecting-ip": `203.0.113.${++people}`,
        ...(init.cookie ? { Cookie: init.cookie } : {}),
      },
    });
  async function signUp(name: string) {
    const email = `${name}-${people}@example.com`;
    const response = await api("/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        password: "correct horse battery staple",
      }),
    });
    expect(response.status).toBe(200);
    const { user } = (await response.json()) as { user: { id: string } };
    const cookie = await sessionCookie(email, "correct horse battery staple");
    return { id: user.id, cookie };
  }
  async function paging(cookie?: string) {
    const response = await api("/health/paging", { cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = (await response.json()) as Record<string, unknown>;
    // Never the ping URL, whoever asks.
    expect(JSON.stringify(body)).not.toContain("dead-man-test");
    return body;
  }

  test("without a session, or in no workspace: the status alone", async () => {
    const body = await paging();
    expect(Object.keys(body)).toEqual(["status"]);
    expect(["ok", "degraded", "unknown"]).toContain(body.status);
    const lone = await signUp("lone");
    expect(Object.keys(await paging(lone.cookie))).toEqual(["status"]);
  });

  test("a member sees why and since when; nobody sees the external check", async () => {
    const owner = await signUp("owner");
    const created = await api("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    const { id: workspaceId } = (await created.json()) as { id: string };
    expect(Object.keys(await paging(owner.cookie)).sort()).toEqual([
      "lastBeatAt",
      "lastOkAt",
      "lastProvedAt",
      "reasons",
      "relay",
      "status",
    ]);
    const responder = await signUp("responder");
    await env.DB.prepare(
      `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, ?, ?)`,
    )
      .bind(`mem_${people}`, workspaceId, responder.id, "responder", new Date().toISOString())
      .run();
    expect(Object.keys(await paging(responder.cookie)).sort()).toEqual([
      "lastBeatAt",
      "lastOkAt",
      "lastProvedAt",
      "reasons",
      "relay",
      "status",
    ]);
  });

  test("a member sees which relay pages go through: none on an instance with no relay", async () => {
    const owner = await signUp("relayless");
    const created = await api("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    // The tests' env has no RELAY, RELAY_URL, send token or instance key.
    expect((await paging(owner.cookie)).relay).toEqual({ kind: "none" });
  });

  test("with the watchdog down, a member's 503 still says which relay (and app); nobody else's does", async () => {
    const owner = await signUp("watchdogless");
    const created = await api("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const down = {
        ...env,
        WATCHDOG: {
          getByName: () => ({
            health: () => Promise.reject(new Error("watchdog down")),
          }),
        },
        RELAY_URL: "https://relay.acme.example",
        RELAY_SEND_TOKEN: "t",
        RELAY_KIND: "own",
        RELAY_APP_URL: "https://apps.example.com/acme-brigade",
      } as unknown as typeof env;
      const ask = (cookie?: string) =>
        worker.fetch(
          new Request(`${ORIGIN}/health/paging`, {
            headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
          }) as Parameters<typeof worker.fetch>[0],
          down,
          createExecutionContext(),
        );
      const member = await ask(owner.cookie);
      expect(member.status).toBe(503);
      expect(member.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await member.json()).toEqual({
        error: "unavailable",
        relay: {
          kind: "own",
          host: "relay.acme.example",
          app: "https://apps.example.com/acme-brigade",
        },
      });
      const outsider = await ask();
      expect(outsider.status).toBe(503);
      expect(await outsider.json()).toEqual({ error: "unavailable" });
    } finally {
      error.mockRestore();
    }
  });

  test("other methods get 405", async () => {
    expect((await api("/health/paging", { method: "POST" })).status).toBe(405);
  });
});
