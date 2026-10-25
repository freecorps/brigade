// Paging (RFC 0005 "Notifiers", RFC 0006 "Who is paged"): which events page and whom, the push notifier (sealed per
// device, sent through the relay), the ledger that makes redeliveries harmless, and the fallback when the relay
// fails: retries, then `notification.failed` and a `page_failed` entry on the incident's timeline.
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  generateRecipient,
  openPush,
  parsePushEnvelope,
  toBase64url,
  type HpkeRecipient,
} from "@freecorps/brigade-push";
import {
  createMemoryStore,
  MONITOR_ACTOR,
  newId,
  type Actor,
  type BrigadeTables,
  type Role,
  type TimelineRow,
} from "@freecorps/brigade-schema";
import { consumeEvents, MAX_PAGE_ATTEMPTS, retryDelay, type Fetch } from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { asksForPage, pageTargets } from "../src/paging.ts";
import { Shard } from "../src/shard.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "responder");
const caio = user("usr_caio", "viewer");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

let names = 0;
let mutations = 0;

/** A provisioned workspace with members, and helpers that run mutations and read its outbox and timeline. */
async function workspace(members: Actor[] = [ana, bia, caio]) {
  const id = newId("ws", Date.now() + ++names, random);
  const stub = env.WORKSPACE.getByName(id);
  expect(await stub.provision({ id, name: "Acme" }, ana)).toEqual({ ok: true });
  const withShard = <R>(
    fn: (shard: Shard, sql: SqlStorage, instance: WorkspaceDO) => R | Promise<R>,
  ) =>
    runInDurableObject(stub, (instance: WorkspaceDO, state) =>
      fn(
        new Shard(state.storage, { shard: "workspace", randomBytes: random, log: () => {} }),
        state.storage.sql,
        instance,
      ),
    );
  const run = (actor: Actor, name: string, args: object) =>
    withShard((shard) => {
      const { result } = shard.mutate({
        clientId: "test",
        mutationId: `m${++mutations}`,
        actor,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
      expect(result, name).toMatchObject({ ok: true });
      return result;
    });
  for (const member of members) {
    await run(member, "member.sync", {
      id: member.id,
      name: member.id.slice(4),
      role: member.role,
    });
  }
  /** Registers a device for `actor` and returns its key pair, to open what was sealed for it. */
  const device = async (
    actor: Actor,
    options: { platform?: "ios" | "android"; environment?: "sandbox" | "production" } = {},
  ) => {
    const recipient = await generateRecipient();
    const deviceId = newId("dev", Date.now(), random);
    const pushToken = toBase64url(random(32)).replace(/[-_]/g, "a");
    await run(actor, "device.register", {
      id: deviceId,
      platform: options.platform ?? "ios",
      environment: options.environment ?? "sandbox",
      pushToken,
      voipToken: null,
      publicKey: toBase64url(recipient.publicKey),
    });
    return { deviceId, pushToken, recipient, userId: actor.id };
  };
  /** Declares an incident as `actor` and returns its id and the `incident.declared` event from the outbox. */
  const declare = async (actor: Actor, severity = "sev1") => {
    const incident = newId("inc", Date.now(), random);
    await run(actor, "incident.declare", { id: incident, title: "Checkout is down", severity });
    return {
      incident,
      event: (await events(incident)).find((e) => e.type === "incident.declared")!,
    };
  };
  const events = (subject?: string) =>
    withShard((_shard, sql) =>
      sql
        .exec<{ event: string }>("select event from outbox order by seq")
        .toArray()
        .map((row) => JSON.parse(row.event) as BrigadeEvent)
        .filter((event) => subject === undefined || event.subject === subject),
    );
  const timeline = (incident: string) =>
    withShard((shard) =>
      shard.store.scan("timeline").filter((row): row is TimelineRow => row.incidentId === incident),
    );
  return { id, stub, withShard, run, device, declare, events, timeline };
}

/** A relay that answers with `answer` per request, and remembers what it got. */
function relay(
  answer: (body: RelayBody) => Response | Promise<Response> = () => Response.json({ status: 200 }),
) {
  const requests: { auth: string | null; url: string; body: RelayBody }[] = [];
  const send: Fetch = async (request) => {
    const body = (await request.json()) as RelayBody;
    requests.push({ auth: request.headers.get("Authorization"), url: request.url, body });
    return answer(body);
  };
  return { requests, send };
}
type RelayBody = {
  deviceToken: string;
  envelope: unknown;
  urgency: string;
  environment: string;
  collapseId: string;
};

const relayEnv = {
  WORKSPACE: env.WORKSPACE,
  RELAY_URL: "https://relay.test",
  RELAY_SEND_TOKEN: "test-token",
};

/** Delivers `event` to the consumer as attempt `attempts` and returns what it acked and retried. */
async function deliver(
  event: BrigadeEvent,
  send: Fetch,
  { attempts = 1, environment = relayEnv as Parameters<typeof consumeEvents>[1], copies = 1 } = {},
) {
  const batch = createMessageBatch(
    "brigade-events",
    Array.from({ length: copies }, (_, i) => ({
      id: `msg-${i}`,
      timestamp: new Date(),
      attempts,
      body: event,
    })),
  );
  // The harness's result has which messages were retried, not their delays: those are read off the calls.
  const delays = new Map<string, number | undefined>();
  for (const message of batch.messages) {
    const retry = message.retry.bind(message);
    message.retry = (options) => {
      delays.set(message.id, options?.delaySeconds);
      retry(options);
    };
  }
  const ctx = createExecutionContext();
  await consumeEvents(batch, environment, send);
  const result = await getQueueResult(batch, ctx);
  return {
    acked: result.explicitAcks,
    retried: result.retryMessages.map(({ msgId }) => ({ msgId, delaySeconds: delays.get(msgId) })),
  };
}

async function opened(recipient: HpkeRecipient, envelope: unknown) {
  return openPush(recipient, parsePushEnvelope(envelope)!);
}

describe("which events page", () => {
  const event = (type: string, data: unknown = {}): BrigadeEvent => ({
    id: "evt_x",
    type,
    source: "brigade://ws/workspace",
    workspaceId: "ws",
    time: new Date().toISOString(),
    actor: { kind: "user", id: "usr_ana" },
    subject: "inc_x",
    data,
    specversion: "1.0",
  });

  test("a declared incident and a severity raised into SEV1 or SEV2; nothing else", () => {
    expect(asksForPage(event("incident.declared"))).toBe(true);
    expect(asksForPage(event("incident.severity_changed", { from: "sev3", to: "sev2" }))).toBe(
      true,
    );
    expect(asksForPage(event("incident.severity_changed", { from: "sev2", to: "sev1" }))).toBe(
      true,
    );
    expect(asksForPage(event("incident.severity_changed", { from: "sev1", to: "sev2" }))).toBe(
      false,
    );
    expect(asksForPage(event("incident.severity_changed", { from: "sev4", to: "sev3" }))).toBe(
      false,
    );
    for (const type of [
      "incident.status_changed",
      "incident.update_posted",
      "monitor.created",
      "notification.failed",
    ]) {
      expect(asksForPage(event(type)), type).toBe(false);
    }
  });
});

describe("who is paged", () => {
  const store = () => {
    const s = createMemoryStore<BrigadeTables>();
    for (const [id, role] of [
      ["usr_ana", "owner"],
      ["usr_bia", "responder"],
      ["usr_caio", "viewer"],
      ["usr_duda", "admin"],
    ] as const) {
      s.insert("members", { id, name: id, role, updatedAt: 0 });
      s.insert("devices", {
        id: `dev_${id}`,
        userId: id,
        platform: "ios",
        environment: "sandbox",
        pushToken: "a".repeat(64),
        voipToken: null,
        publicKey: "B",
        registeredAt: 0,
        updatedAt: 0,
      });
    }
    return s;
  };
  const users = (targets: { userId: string }[]) => targets.map((target) => target.userId);

  test("without a commander: every member who can respond, except who caused it; never viewers", () => {
    expect(users(pageTargets(store(), { roles: {} }, "usr_ana"))).toEqual(["usr_bia", "usr_duda"]);
    expect(users(pageTargets(store(), { roles: {} }, MONITOR_ACTOR.id))).toEqual([
      "usr_ana",
      "usr_bia",
      "usr_duda",
    ]);
  });

  test("with a commander: only them, unless they caused it", () => {
    expect(users(pageTargets(store(), { roles: { commander: "usr_bia" } }, "usr_ana"))).toEqual([
      "usr_bia",
    ]);
    expect(users(pageTargets(store(), { roles: { commander: "usr_bia" } }, "usr_bia"))).toEqual([
      "usr_ana",
      "usr_duda",
    ]);
  });

  test("members without a device are not targets; a device of someone no longer a member is ignored", () => {
    const s = store();
    s.delete("devices", "dev_usr_bia");
    s.delete("members", "usr_duda");
    expect(users(pageTargets(s, { roles: {} }, MONITOR_ACTOR.id))).toEqual(["usr_ana"]);
  });
});

describe("the push notifier", () => {
  test("seals the page for each device's own key and sends it through the relay", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana);
    const biaPhone = await ws.device(bia, { environment: "production" });
    const caioPhone = await ws.device(caio);
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev2");
    const fake = relay();

    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    // The viewer is not paged; the two others each get one push, sealed to their key.
    expect(fake.requests.map((request) => request.body.deviceToken).sort()).toEqual(
      [anaPhone.pushToken, biaPhone.pushToken].sort(),
    );
    expect(fake.requests.map((r) => r.body.deviceToken)).not.toContain(caioPhone.pushToken);
    for (const phone of [anaPhone, biaPhone]) {
      const request = fake.requests.find((r) => r.body.deviceToken === phone.pushToken)!;
      expect(request.url).toBe("https://relay.test/send");
      expect(request.auth).toBe("Bearer test-token");
      expect(request.body).toMatchObject({ urgency: "page", collapseId: incident });
      expect(await opened(phone.recipient, request.body.envelope)).toEqual({
        title: "SEV2 · INC-1",
        body: "Checkout is down",
        incident,
      });
    }
    // The device's APNs environment travels with its push.
    expect(
      fake.requests.find((r) => r.body.deviceToken === biaPhone.pushToken)!.body.environment,
    ).toBe("production");
    // One device's push cannot be opened with another's key.
    const other = fake.requests.find((r) => r.body.deviceToken === biaPhone.pushToken)!;
    await expect(opened(anaPhone.recipient, other.body.envelope)).rejects.toThrow();
    expect((await ws.timeline(incident)).map((row) => row.kind)).toEqual(["declared"]);
  });

  test("a redelivered event pages nobody again (the ledger is keyed by event id)", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { event } = await ws.declare(ana);
    const fake = relay();
    // Twice in one batch, then again later, as at-least-once delivery may.
    expect((await deliver(event, fake.send, { copies: 2 })).acked).toEqual(["msg-0", "msg-1"]);
    expect(await deliver(event, fake.send, { attempts: 2 })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    expect(fake.requests).toHaveLength(1);
  });

  test("a SEV3 notifies at `high` urgency; a severity raised into SEV1 pages", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana, "sev3");
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["high"]);

    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" });
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    await deliver(raised, fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["high", "page"]);
  });

  test("an incident already acknowledged or resolved is not paged", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await ws.run(bia, "incident.ack", { id: incident });
    const fake = relay();
    expect((await deliver(event, fake.send)).acked).toEqual(["msg-0"]);
    expect(fake.requests).toHaveLength(0);
  });

  test("events that do not page are acked untouched; malformed messages are dropped", async () => {
    const ws = await workspace();
    const { incident } = await ws.declare(ana);
    await ws.run(ana, "incident.postUpdate", { id: incident, body: "Rolling back" });
    const update = (await ws.events(incident)).find((e) => e.type === "incident.update_posted")!;
    const fake = relay();
    expect((await deliver(update, fake.send)).acked).toEqual(["msg-0"]);
    expect((await deliver({ nope: true } as never, fake.send)).acked).toEqual(["msg-0"]);
    expect(fake.requests).toHaveLength(0);
  });
});

describe("when paging fails (the paging path's fallback)", () => {
  test("an unreachable relay is retried with backoff, then recorded as a failed page on the timeline", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const down: Fetch = async () => {
      throw new Error("Network connection lost.");
    };
    for (let attempt = 1; attempt < MAX_PAGE_ATTEMPTS; attempt++) {
      expect(await deliver(event, down, { attempts: attempt })).toEqual({
        acked: [],
        retried: [{ msgId: "msg-0", delaySeconds: retryDelay(attempt) }],
      });
    }
    expect((await ws.timeline(incident)).map((row) => row.kind)).toEqual(["declared"]);

    // The last attempt gives up: the consumer acks, and the shard records who was not paged.
    expect(await deliver(event, down, { attempts: MAX_PAGE_ATTEMPTS })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({
        kind: "page_failed",
        actor: "sys_notifier",
        userId: phone.userId,
        reason: "undelivered",
      }),
    );
    expect((await ws.events(incident)).filter((e) => e.type === "notification.failed")).toEqual([
      expect.objectContaining({
        actor: { kind: "system", id: "sys_notifier" },
        data: {
          incidentId: incident,
          eventId: event.id,
          channel: "push",
          userId: phone.userId,
          reason: "undelivered",
        },
      }),
    ]);
    // A later redelivery changes nothing: the page is closed.
    await deliver(event, down, { attempts: MAX_PAGE_ATTEMPTS + 1 });
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toHaveLength(
      1,
    );
  });

  test("relay errors (apns_unreachable, APNs 5xx) retry; a device delivered on an earlier try is not sent again", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana);
    const biaPhone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    // Ana's phone works; the relay cannot reach APNs for Bia's, then APNs fails, then it works.
    const answers = [
      Response.json({ error: "apns_unreachable" }, { status: 502 }),
      Response.json({ status: 503, reason: "ServiceUnavailable" }, { status: 502 }),
    ];
    const fake = relay((body) =>
      body.deviceToken === biaPhone.pushToken && answers.length > 0
        ? answers.shift()!
        : Response.json({ status: 200 }),
    );
    expect((await deliver(event, fake.send, { attempts: 1 })).retried).toHaveLength(1);
    expect((await deliver(event, fake.send, { attempts: 2 })).retried).toHaveLength(1);
    expect((await deliver(event, fake.send, { attempts: 3 })).acked).toEqual(["msg-0"]);
    const sentTo = fake.requests.map((r) =>
      r.body.deviceToken === anaPhone.pushToken ? "ana" : "bia",
    );
    expect(sentTo.sort()).toEqual(["ana", "bia", "bia", "bia"]);
    expect((await ws.timeline(incident)).map((row) => row.kind)).toEqual(["declared"]);
  });

  test("a token APNs says is gone drops the device; with no other device, the member is recorded as not paged", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const fake = relay(() =>
      Response.json({ status: 410, reason: "Unregistered" }, { status: 502 }),
    );
    // Not retryable: one attempt settles it.
    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
    ).toBeUndefined();
    const types = (await ws.events()).map((e) => e.type);
    expect(types).toContain("device.unregistered");
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "undelivered" }),
    );
  });

  test("an instance without a relay records the failure at once, without retrying", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const fake = relay();
    expect(await deliver(event, fake.send, { environment: { WORKSPACE: env.WORKSPACE } })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    expect(fake.requests).toHaveLength(0);
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "not_configured" }),
    );
  });

  test("Android devices are not reachable yet (no FCM): recorded as unsupported", async () => {
    const ws = await workspace();
    await ws.device(bia, { platform: "android", environment: "production" });
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests).toHaveLength(0);
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "unsupported" }),
    );
  });

  test("a monitor's incident with nobody to page says so; a member's own declaration does not", async () => {
    const ws = await workspace();
    const fake = relay();
    const byMonitor = await ws.declare(MONITOR_ACTOR);
    await deliver(byMonitor.event, fake.send);
    expect(await ws.timeline(byMonitor.incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: null, reason: "no_devices" }),
    );
    const byAna = await ws.declare(ana);
    await deliver(byAna.event, fake.send);
    expect((await ws.timeline(byAna.incident)).map((row) => row.kind)).toEqual(["declared"]);
  });

  test("an unreachable shard retries the whole message", async () => {
    const ws = await workspace();
    const { event } = await ws.declare(MONITOR_ACTOR);
    const broken = {
      WORKSPACE: {
        getByName: () => ({
          planPage: () => Promise.reject(new Error("Durable Object reset")),
        }),
      },
    } as unknown as Parameters<typeof consumeEvents>[1];
    expect((await deliver(event, relay().send, { environment: broken })).retried).toEqual([
      { msgId: "msg-0", delaySeconds: retryDelay(1) },
    ]);
  });

  test("retry delays double from 5 s and stop at a minute", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });
});

describe("end to end: outbox → queue → consumer", () => {
  test("the shard alarm drains a monitor's incident to brigade-events, and the consumer records the page", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident } = await ws.declare(MONITOR_ACTOR);
    // The tests pause the drain (vite.config.ts); this one runs it, through Miniflare's real queue and consumer.
    await ws.withShard(async (_shard, sql, instance) => {
      Reflect.set(instance, "drainPaused", false);
      await instance.alarm();
      expect(sql.exec<{ n: number }>("select count(*) as n from outbox").one().n).toBe(0);
    });
    // The test environment has no relay, so the consumer records the page as failed: not_configured.
    await vi.waitFor(
      async () => {
        expect(await ws.timeline(incident)).toContainEqual(
          expect.objectContaining({
            kind: "page_failed",
            userId: "usr_bia",
            reason: "not_configured",
          }),
        );
      },
      { timeout: 10_000, interval: 100 },
    );
  });
});
