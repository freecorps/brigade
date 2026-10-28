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
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import worker from "../src/index.ts";
import type { EmailSender, OutgoingEmail } from "../src/email.ts";
import { consumeEvents, type Fetch, type NotifyEnv } from "../src/notify.ts";
import { operatorAddresses } from "../src/notify-operators.ts";
import { OutboxDrain, type BrigadeEvent } from "../src/outbox.ts";
import {
  BEAT_STALE_MS,
  HEARTBEAT_EVENT,
  MAX_PROOF_LATENCY_MS,
  OPERATOR_EMAIL_HOURLY_CAP,
  pagingStatus,
  PING_TIMEOUT_MS,
  pingUrl,
  STATUS_EVENT,
  SYSTEM_WORKSPACE,
  WATCHDOG_NAME,
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
    const [heartbeat] = await heartbeats();
    const started = Date.now();
    const health = await stub.proved(heartbeat!.time, "ok");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(health.status).toBe("ok");
    expect(pings()).toEqual([PING_URL]);
    // Recorded as failed once the timeout gives up on it.
    await vi.waitFor(async () => expect((await stub.health()).external.lastPingOk).toBe(false), {
      timeout: PING_TIMEOUT_MS + 2000,
      interval: 200,
    });
  }, 15_000);

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
    /** The relay's deep check answering `apns` and `fcm` (apps/relay src/deep-health.ts). */
    const deep = (apns: string, fcm = "not_configured") => {
      const urls: string[] = [];
      const send: Fetch = async (request) => {
        urls.push(`${request.method} ${request.url}`);
        const ok = apns === "ok" && fcm !== "error";
        return Response.json(
          { ok, apns: { status: apns }, fcm: { status: fcm } },
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

    // One D1 read per beat: a D1 that throws degrades the status and silences the external check too.
    const broken = {
      prepare: () => {
        throw new Error("D1 is down");
      },
    } as unknown as D1Database;
    await beat(deep("ok").send, { DB: broken });
    expect(await stub.health()).toMatchObject({ status: "degraded", reasons: ["d1_failing"] });
    expect(pings()).toHaveLength(1);
    // FCM not configured (a relay serving iOS only) is no failure: pings again.
    await beat(deep("ok").send, { DB: env.DB });
    await vi.waitFor(() => expect(pings()).toHaveLength(2));
  });

  test("OPERATOR_EMAILS are emailed each status change, once per event and capped per hour", async () => {
    const { stub, notifyEnv } = watchdog();
    const sent: OutgoingEmail[] = [];
    const mail: EmailSender = {
      id: "test",
      async send(email) {
        sent.push(email);
        return { ok: true };
      },
    };
    const change = (n: number, data: object): BrigadeEvent => ({
      id: `evt_status_${n}`,
      type: STATUS_EVENT,
      source: `brigade://${SYSTEM_WORKSPACE}/watchdog`,
      workspaceId: SYSTEM_WORKSPACE,
      time: new Date().toISOString(),
      actor: { kind: "system", id: "sys_watchdog" },
      data,
      specversion: "1.0",
    });
    const operators = {
      ...notifyEnv(),
      WATCHDOG: { getByName: () => stub } as unknown as NotifyEnv["WATCHDOG"],
      OPERATOR_EMAILS: " ops@example.com, not an address ,oncall@example.org,ops@example.com",
    };
    const degraded = change(1, {
      status: "degraded",
      previous: "ok",
      reasons: ["apns_failing", "d1_failing"],
    });
    // Redelivered in the same batch and again later: one email per operator.
    const result = await deliver([degraded, degraded], operators, relay().send, mail);
    expect(result.explicitAcks.sort()).toEqual(["msg-0", "msg-1"]);
    await deliver([degraded], operators, relay().send, mail);
    expect(sent.map((one) => one.to.email).sort()).toEqual([
      "oncall@example.org",
      "ops@example.com",
    ]);
    expect(sent[0]!.subject).toBe("Brigade's paging self-check is degraded");
    expect(sent[0]!.text).toContain("Apple's push service refused the relay's key");
    expect(sent[0]!.text).toContain("The database (D1) didn't answer a simple read.");
    // Capped: at most OPERATOR_EMAIL_HOURLY_CAP changes an hour are emailed; the rest only logged.
    for (let n = 2; n <= OPERATOR_EMAIL_HOURLY_CAP + 2; n++) {
      await deliver(
        [change(n, { status: n % 2 ? "degraded" : "ok", reasons: [] })],
        operators,
        relay().send,
        mail,
      );
    }
    expect(sent).toHaveLength(OPERATOR_EMAIL_HOURLY_CAP * 2);
    // Without OPERATOR_EMAILS, or without email set up, nothing is sent and the event is still acked.
    const quiet = await deliver([change(99, { status: "ok" })], notifyEnv(), relay().send, mail);
    expect(quiet.explicitAcks).toEqual(["msg-0"]);
    expect(sent).toHaveLength(OPERATOR_EMAIL_HOURLY_CAP * 2);
    expect(operatorAddresses("a@b.co,,  c@d.io ,x")).toEqual(["a@b.co", "c@d.io"]);
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
