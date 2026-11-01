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
  OPERATOR_EMAIL_HOURLY_CAP,
  OPERATOR_EMAIL_TRIES,
  pagingStatus,
  pingUrl,
  STATUS_EVENT,
  SYSTEM_WORKSPACE,
  TRANSIENT_FAILURES_TO_DEGRADE,
  WATCHDOG_NAME,
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
  const check = (status: string) =>
    status === "transient"
      ? { status: "error", reason: "unreachable", transient: true }
      : { status };
  const deep = (apns: string, fcm = "not_configured") => {
    const urls: string[] = [];
    const send: Fetch = async (request) => {
      urls.push(`${request.method} ${request.url}`);
      const ok = apns === "ok" && fcm !== "error" && fcm !== "transient";
      return Response.json({ ok, apns: check(apns), fcm: check(fcm) }, { status: ok ? 200 : 503 });
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
      relay: "ok" as const,
    };
    expect(pagingStatus(times, now)).toEqual({
      status: "degraded",
      reasons: ["pipeline_stalled", "pipeline_slow"],
    });
    // Slow but within the window: the pings stop (MAX_PROOF_LATENCY_MS), and the dashboard says why.
    const slow = { ...times, provedBeatAt: now - 2.5 * MINUTE };
    expect(pagingStatus(slow, now)).toEqual({ status: "degraded", reasons: ["pipeline_slow"] });
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
    const { stub, heartbeats, notifyEnv } = watchdog();
    for (const status of [200, 404, 500]) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      await stub.beat();
      await deliver([(await heartbeats()).at(-1)!], notifyEnv(), relay(status).send);
      expect((await stub.health()).reasons, String(status)).toEqual(["relay_unreachable"]);
    }
    expect(pings()).toEqual([]);
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

  test("a heartbeat that took too long counts as alive inside, but pings nothing", async () => {
    const { stub, heartbeats } = watchdog();
    await stub.beat(NOW);
    const [heartbeat] = await heartbeats();
    const health = await stub.proved(heartbeat!.time, "ok", NOW + MAX_PROOF_LATENCY_MS + 1);
    expect(health.lastProvedAt).not.toBeNull();
    // The dashboard says why the external check heard nothing.
    expect(health).toMatchObject({ status: "degraded", reasons: ["pipeline_slow"] });
    expect(pings()).toEqual([]);
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
    const { stub, heartbeats, notifyEnv } = watchdog();
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

    await beat(deep("ok", "error").send);
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["fcm_failing"] });
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
    const flushed = (left = 0) =>
      vi.waitFor(async () => expect(await waiting()).toHaveLength(left));
    /** Beats at `minute` and proves that beat a second later: ok (or as `checks` say). */
    const proveAt = async (minute: number, checks?: BeatChecks) => {
      await dog.stub.beat(NOW + minute * MINUTE);
      const newest = (await dog.heartbeats()).at(-1)!;
      await dog.stub.proved(newest.time, "ok", NOW + minute * MINUTE + 1000, checks);
    };
    return { ...dog, waiting, flushed, proveAt };
  }

  test("a stalled queue: the watchdog emails the operators itself as the status degrades", async () => {
    const { sent, mail } = mailbox();
    const { stub, heartbeats, events, notifyEnv, flushed, proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    // Unknown to ok is a change too.
    await flushed();
    expect(sent.map((one) => one.subject)).toEqual([
      "Brigade's paging self-check is back to normal",
    ]);
    // The Queue stops: beats keep coming, none comes back, and nothing is drained.
    for (let minute = 1; minute <= 4; minute++) await stub.beat(NOW + minute * MINUTE);
    await flushed();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.subject).toBe("Brigade's paging self-check is degraded");
    expect(sent[1]!.to.email).toBe("ops@example.com");
    // The Queue comes back: the backlog proves the newest beat, back to ok, emailed from the watchdog too.
    await stub.proved((await heartbeats()).at(-1)!.time, "ok", NOW + 4 * MINUTE + 5000);
    await flushed();
    expect(sent.map((one) => one.subject).at(-1)).toBe(
      "Brigade's paging self-check is back to normal",
    );
    // The changes the Queue held send nothing more through the consumer.
    const changes = (await events()).filter((event) => event.type === STATUS_EVENT);
    expect(changes).toHaveLength(3);
    const result = await deliver(changes, notifyEnv(), relay().send, mail);
    expect(result.explicitAcks).toHaveLength(3);
    expect(sent).toHaveLength(3);
  });

  test("an email that failed is tried again on the next beats, then given up", async () => {
    let down = 2;
    const box = mailbox(() =>
      down-- > 0 ? { ok: false, retry: true, code: "E_INTERNAL_SERVER_ERROR" } : { ok: true },
    );
    const { stub, heartbeats, waiting, flushed, proveAt } = await emailingWatchdog(box.mail);
    await proveAt(0);
    await vi.waitFor(async () => expect(await waiting()).toEqual([{ tries: 1 }]));
    // Not again within the minute (a proof a moment later), then on the next beats until it goes.
    await stub.proved((await heartbeats())[0]!.time, "ok", NOW + 2000);
    expect(box.tries()).toBe(1);
    await stub.beat(NOW + MINUTE);
    await vi.waitFor(async () => expect(await waiting()).toEqual([{ tries: 2 }]));
    await stub.beat(NOW + 2 * MINUTE);
    await flushed();
    expect(box.sent.map((one) => one.subject)).toEqual([
      "Brigade's paging self-check is back to normal",
    ]);

    // An email that never goes is given up after OPERATOR_EMAIL_TRIES tries.
    const never = mailbox(() => ({ ok: false, retry: true, code: "E_INTERNAL_SERVER_ERROR" }));
    const other = await emailingWatchdog(never.mail);
    await other.proveAt(0);
    for (let n = 1; n < OPERATOR_EMAIL_TRIES; n++) {
      await vi.waitFor(async () => expect(await other.waiting()).toEqual([{ tries: n }]));
      await other.proveAt(n);
    }
    await other.flushed();
    expect(never.tries()).toBe(OPERATOR_EMAIL_TRIES);
  });

  test("OPERATOR_EMAILS are emailed each status change, once each, capped per hour", async () => {
    const { sent, mail } = mailbox();
    const { flushed, proveAt } = await emailingWatchdog(
      mail,
      " ops@example.com, not an address ,oncall@example.test,Ops@Example.com",
    );
    await proveAt(0);
    await flushed();
    await proveAt(1, { apns: "error", fcm: "ok", d1: "error" });
    await flushed();
    const to = (subject: string) =>
      sent
        .filter((one) => one.subject === subject)
        .map((one) => one.to.email)
        .sort();
    expect(to("Brigade's paging self-check is degraded")).toEqual([
      "oncall@example.test",
      "ops@example.com",
    ]);
    const degraded = sent.find((one) => one.subject === "Brigade's paging self-check is degraded")!;
    expect(degraded.text).toContain("Apple's push service refused the relay's key");
    expect(degraded.text).toContain("The database (D1) didn't answer a simple read.");
    // Flapping: ok and degraded in turn, one change a minute. At most OPERATOR_EMAIL_HOURLY_CAP are emailed.
    for (let minute = 2; minute <= OPERATOR_EMAIL_HOURLY_CAP + 3; minute++) {
      await proveAt(minute, minute % 2 ? { apns: "error", fcm: "ok", d1: "ok" } : undefined);
      await flushed();
    }
    expect(sent).toHaveLength(OPERATOR_EMAIL_HOURLY_CAP * 2);
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
    await nobody.proveAt(0);
    await nobody.flushed();
    const unset = await emailingWatchdog(mail);
    await runInDurableObject(unset.stub, (instance: WatchdogDO) => {
      Reflect.set(instance, "mail", () => undefined);
    });
    await unset.proveAt(0);
    await unset.flushed();
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
    const { flushed, proveAt } = await emailingWatchdog(mail);
    await proveAt(0);
    await flushed();
    expect(inner.sent.map((one) => one.to.email)).toEqual(["ops@example.com"]);
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
      [
        () => Response.json({ error: "registry_unavailable" }, { status: 503 }),
        "relay_unreachable",
      ],
    ] as const) {
      await beat(signedRelay(answer).send, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
      expect((await stub.health()).reasons, reason).toEqual([reason]);
    }
    expect(pings()).toEqual([]);
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

  test("a relay without /v1 falls back to the send token's check, and is unreachable without one", async () => {
    const { stub, heartbeats, notifyEnv } = watchdog();
    const { beat } = deepBeats(stub, heartbeats, notifyEnv);
    const old: Fetch = async (request) =>
      new URL(request.url).pathname.startsWith("/v1/")
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json({ ok: true, ...PROVIDERS });
    await beat(old, { RELAY_INSTANCE_KEY: key.privateKey, DB: env.DB });
    expect(await stub.health()).toMatchObject({ status: "ok", reasons: [] });
    await beat(old, {
      RELAY_INSTANCE_KEY: key.privateKey,
      RELAY_SEND_TOKEN: undefined,
      DB: env.DB,
    });
    expect((await stub.health()).reasons).toEqual(["relay_unreachable"]);
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
      "status",
    ]);
  });

  test("other methods get 405", async () => {
    expect((await api("/health/paging", { method: "POST" })).status).toBe(405);
  });
});
