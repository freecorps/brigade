// Paging (RFC 0005 "Notifiers", RFC 0006 "Who is paged"): which events page and whom, the push notifier (sealed per
// device, sent through the relay), the ledger that makes redeliveries harmless, and the fallback when the relay
// fails: retries, then `notification.failed` and a `page_failed` entry on the incident's timeline.
import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  runDurableObjectAlarm,
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
  callDeliveryId,
  createMemoryStore,
  deliveryId,
  ESCALATION_ACTOR,
  MONITOR_ACTOR,
  NOTIFIER_ACTOR,
  newId,
  type Actor,
  type BrigadeTables,
  type Role,
  type TimelineRow,
  wantsCall,
} from "@freecorps/brigade-schema";
import {
  callIdOf,
  consumeDeadLetters,
  consumeEvents,
  MAX_PAGE_ATTEMPTS,
  QUEUE_MAX_RETRIES,
  retryDelay,
  type Fetch,
  type NotifyEnv,
} from "../src/notify.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  asksForPage,
  MAX_PAGE_DEVICES,
  PAGE_HOLD_MS,
  PAGE_IN_FLIGHT_MS,
  PAGE_REPLAY_DELAY_MS,
  pageTargets,
  ringsAsCall,
  sendsCritical,
} from "../src/paging.ts";
import worker from "../src/index.ts";
import { Shard } from "../src/shard.ts";
import { HEARTBEAT_EVENT, PING_TIMEOUT_MS, SYSTEM_WORKSPACE } from "../src/watchdog.ts";
import type { WorkspaceDO } from "../src/workspace.ts";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const user = (id: string, role: Role): Actor => ({ kind: "user", id, role });
const ana = user("usr_ana", "owner");
const bia = user("usr_bia", "responder");
const caio = user("usr_caio", "viewer");

/** What the code logged (`console.error`, one JSON line each), parsed. */
let logged: () => Record<string, unknown>[];
beforeEach(() => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  logged = () =>
    spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
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
    options: {
      platform?: "ios" | "android";
      environment?: "sandbox" | "production";
      /** Registers a PushKit token too, so the phone can ring (RFC 0010). */
      voip?: boolean;
      /** Reports Critical Alerts as allowed (RFC 0006 "Critical Alerts"); left out as an app from before them. */
      criticalAlerts?: boolean;
    } = {},
  ) => {
    const recipient = await generateRecipient();
    const deviceId = newId("dev", Date.now(), random);
    const pushToken = toBase64url(random(32)).replace(/[-_]/g, "a");
    const voipToken = options.voip ? toBase64url(random(32)).replace(/[-_]/g, "b") : null;
    await run(actor, "device.register", {
      id: deviceId,
      platform: options.platform ?? "ios",
      environment: options.environment ?? "sandbox",
      pushToken,
      voipToken,
      publicKey: toBase64url(recipient.publicKey),
      ...(options.criticalAlerts === undefined ? {} : { criticalAlerts: options.criticalAlerts }),
    });
    return { deviceId, pushToken, voipToken, recipient, userId: actor.id };
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
  /** `call` for a VoIP push (RFC 0010); absent for an alert. */
  kind?: string;
  callId?: string;
  /** A Critical Alert (RFC 0006); absent otherwise. */
  critical?: boolean;
  /** `android` for an Android phone (FCM); absent for an iPhone. */
  platform?: string;
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

  test("an incident the alerts reopen (a flapping alert) pages; one a member reopens does not", () => {
    const reopened = { from: "resolved", to: "investigating" };
    expect(asksForPage(event("incident.status_changed", reopened))).toBe(false);
    const byAlerts = (data: unknown) => ({
      ...event("incident.status_changed", data),
      actor: { kind: "system" as const, id: "sys_alerts" },
    });
    expect(asksForPage(byAlerts(reopened))).toBe(true);
    expect(asksForPage(byAlerts({ from: "triage", to: "resolved" }))).toBe(false);
    // The raise that reopen brought along pages through the reopen alone: one page, not two.
    const raised = { from: "sev3", to: "sev1", reopening: true };
    expect(
      asksForPage({ ...event("incident.severity_changed", raised), actor: byAlerts({}).actor }),
    ).toBe(false);
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
  const users = ({ targets }: { targets: { userId: string }[] }) =>
    targets.map((target) => target.userId);

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

  test("a commander without a device: everyone who can respond instead, and the commander is listed as unreachable", () => {
    const s = store();
    s.delete("devices", "dev_usr_bia");
    const result = pageTargets(s, { roles: { commander: "usr_bia" } }, MONITOR_ACTOR.id);
    expect(users(result)).toEqual(["usr_ana", "usr_duda"]);
    expect(result.noDevices).toEqual(["usr_bia"]);
    // With nobody else to page, the commander is still listed.
    s.delete("devices", "dev_usr_ana");
    s.delete("devices", "dev_usr_duda");
    expect(pageTargets(s, { roles: { commander: "usr_bia" } }, MONITOR_ACTOR.id)).toEqual({
      targets: [],
      noDevices: ["usr_bia", "usr_ana", "usr_duda"],
    });
  });

  test("a commander who is now a viewer is not paged; everyone who can respond is", () => {
    const s = store();
    s.update("members", "usr_bia", { role: "viewer" });
    expect(users(pageTargets(s, { roles: { commander: "usr_bia" } }, "usr_ana"))).toEqual([
      "usr_duda",
    ]);
  });

  test("members without a device are listed, not targeted; a device of someone no longer a member is ignored", () => {
    const s = store();
    s.delete("devices", "dev_usr_bia");
    s.delete("members", "usr_duda");
    const result = pageTargets(s, { roles: {} }, MONITOR_ACTOR.id);
    expect(users(result)).toEqual(["usr_ana"]);
    expect(result.noDevices).toEqual(["usr_bia"]);
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
        workspace: event.workspaceId,
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

describe("pages that ring as a call (RFC 0010)", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const deliveries = (ws: Awaited<ReturnType<typeof workspace>>, incident: string) =>
    ws.withShard((shard) =>
      shard.store.scan("deliveries").filter((row) => row.incidentId === incident),
    );

  test("a SEV1 page rings the phones with a VoIP token after their alert push; the others get the alert only", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana, { voip: true, environment: "production" });
    const biaPhone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev1");
    const fake = relay();

    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    const anas = fake.requests.filter((r) =>
      [anaPhone.pushToken, anaPhone.voipToken].includes(r.body.deviceToken),
    );
    // The alert first, then the call to the PushKit token, in the device's environment.
    expect(anas.map((r) => r.body.kind ?? "alert")).toEqual(["alert", "call"]);
    const [alert, call] = anas;
    expect(alert!.body.deviceToken).toBe(anaPhone.pushToken);
    expect(call!.url).toBe("https://relay.test/send");
    expect(call!.auth).toBe("Bearer test-token");
    expect(call!.body).toMatchObject({
      kind: "call",
      deviceToken: anaPhone.voipToken,
      urgency: "page",
      environment: "production",
    });
    expect(call!.body.callId).toMatch(UUID);
    expect(call!.body.callId).toBe(await callIdOf(event.id));
    expect(await opened(anaPhone.recipient, call!.body.envelope)).toEqual({
      title: "SEV1 · INC-1",
      body: "Checkout is down",
      incident,
      workspace: event.workspaceId,
    });
    // No VoIP token: the alert only.
    expect(
      fake.requests
        .filter((r) => r.body.deviceToken === biaPhone.pushToken)
        .map((r) => r.body.kind),
    ).toEqual([undefined]);
    expect(fake.requests).toHaveLength(3);
    expect((await deliveries(ws, incident)).every((row) => row.acceptedAt !== null)).toBe(true);
  });

  test("a SEV2's first page and a SEV3 do not ring; a severity raised into SEV1 does", async () => {
    const ws = await workspace();
    await ws.device(bia, { voip: true });
    const fake = relay();
    const sev2 = await ws.declare(ana, "sev2");
    await deliver(sev2.event, fake.send);
    const sev3 = await ws.declare(ana, "sev3");
    await deliver(sev3.event, fake.send);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert", "alert"]);

    await ws.run(ana, "incident.setSeverity", { id: sev3.incident, severity: "sev1" });
    const raised = (await ws.events(sev3.incident)).find(
      (e) => e.type === "incident.severity_changed",
    )!;
    await deliver(raised, fake.send);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual([
      "alert",
      "alert",
      "alert",
      "call",
    ]);
  });

  test("the policy: SEV1 pages ring, and an escalation level of a SEV1 or SEV2; nothing below", () => {
    const event = (type: string): BrigadeEvent => ({
      id: "evt_x",
      type,
      source: "brigade://ws/workspace",
      workspaceId: "ws",
      time: new Date().toISOString(),
      actor: { kind: "system", id: "sys_escalation" },
      subject: "inc_x",
      data: {},
      specversion: "1.0",
    });
    expect(ringsAsCall(event("incident.declared"), "sev1")).toBe(true);
    expect(ringsAsCall(event("incident.severity_changed"), "sev1")).toBe(true);
    expect(ringsAsCall(event("escalation.paged"), "sev1")).toBe(true);
    expect(ringsAsCall(event("escalation.paged"), "sev2")).toBe(true);
    expect(ringsAsCall(event("incident.declared"), "sev2")).toBe(false);
    expect(ringsAsCall(event("incident.severity_changed"), "sev2")).toBe(false);
    expect(ringsAsCall(event("escalation.paged"), "sev3")).toBe(false);
    expect(ringsAsCall(event("escalation.paged"), "sev4")).toBe(false);
  });

  test("a call the relay refuses or never answers leaves the alert delivered, with no retry", async () => {
    for (const [fails, error, reason] of [
      [
        () => Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 }),
        "token_invalid",
        "BadDeviceToken",
      ],
      [
        () => Response.json({ status: 400, reason: "BadTopic" }, { status: 502 }),
        "apns_refused",
        "BadTopic",
      ],
      [
        () => Response.json({ error: "relay_misconfigured" }, { status: 500 }),
        "relay_refused",
        null,
      ],
      [() => Promise.reject(new Error("connection reset")), "relay_unreachable", null],
    ] as const) {
      const ws = await workspace();
      const phone = await ws.device(bia, { voip: true });
      const { incident, event } = await ws.declare(ana, "sev1");
      const fake = relay((body) =>
        body.kind === "call" ? fails() : Response.json({ status: 200 }),
      );

      expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
      expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert", "call"]);
      // The alert's row is untouched by the call; the call's own row says what went wrong.
      const [row, callRow] = await deliveries(ws, incident);
      expect(row).toMatchObject({ deviceId: phone.deviceId, error: null, attempts: 1 });
      expect(row!.kind).toBeUndefined();
      expect(row!.acceptedAt).not.toBeNull();
      expect(callRow).toMatchObject({
        id: callDeliveryId(incident, event.id, phone.deviceId),
        kind: "call",
        deviceId: phone.deviceId,
        acceptedAt: null,
        error,
        reason,
        attempts: 1,
      });
      expect(callRow!.sentAt).not.toBeNull();
      expect((await ws.timeline(incident)).map((r) => r.kind)).toEqual(["declared"]);
      // The device stays: a refused VoIP token never drops the phone's alert token.
      expect(
        await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
      ).toBeDefined();
      expect(
        logged().some((line) =>
          ["relay refused a call", "call not sent"].includes(String(line.message)),
        ),
      ).toBe(true);
      // A redelivery sends nothing again, the call included.
      await deliver(event, fake.send, { attempts: 2 });
      expect(fake.requests).toHaveLength(2);
    }
  });

  test("each call has its own delivery row next to the alert's, synced like it", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana, { voip: true });
    const biaPhone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev1");
    await deliver(event, relay().send);

    const rows = await deliveries(ws, incident);
    expect(rows.map((row) => [row.deviceId, row.kind ?? "push"])).toEqual(
      expect.arrayContaining([
        [anaPhone.deviceId, "push"],
        [anaPhone.deviceId, "call"],
        [biaPhone.deviceId, "push"],
      ]),
    );
    expect(rows).toHaveLength(3);
    const call = rows.find((row) => row.kind === "call")!;
    expect(call).toMatchObject({ userId: ana.id, error: null, attempts: 1 });
    expect(call.acceptedAt).not.toBeNull();
    const planned = (await ws.events(incident)).filter((e) => e.type === "notification.planned");
    expect(planned.map((e) => e.data)).toEqual([expect.objectContaining({ devices: 2, calls: 1 })]);
    const sent = (await ws.events(incident)).filter((e) => e.type === "notification.sent");
    expect(sent.map((e) => e.data)).toEqual([
      expect.objectContaining({ accepted: 2, failed: 0, calls: { accepted: 1, failed: 0 } }),
    ]);
  });

  test("a call that never went out (its alert never got through) stays planned, and the page settles on the alert", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia, { voip: true });
    const { incident, event } = await ws.declare(ana, "sev1");
    const fake = relay(() => Response.json({ status: 400, reason: "BadTopic" }, { status: 502 }));
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert"]);
    const [row, callRow] = await deliveries(ws, incident);
    expect(row).toMatchObject({ error: "apns_refused", reason: "BadTopic" });
    expect(callRow).toMatchObject({ kind: "call", sentAt: null, error: null });
    expect((await ws.timeline(incident)).map((r) => r.kind)).toEqual(["declared", "page_failed"]);
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)?.voipToken),
    ).toBe(phone.voipToken);
  });

  test("a VoIP token APNs refuses as gone is cleared; the phone keeps its alert pushes and stops ringing", async () => {
    for (const reason of ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]) {
      const ws = await workspace();
      const phone = await ws.device(bia, { voip: true });
      const fake = relay((body) =>
        body.kind === "call"
          ? Response.json(
              { status: reason === "Unregistered" ? 410 : 400, reason },
              { status: 502 },
            )
          : Response.json({ status: 200 }),
      );
      const first = await ws.declare(ana, "sev1");
      expect(await deliver(first.event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });

      const device = await ws.withShard((shard) => shard.store.get("devices", phone.deviceId));
      expect(device, reason).toMatchObject({ pushToken: phone.pushToken, voipToken: null });
      expect(
        await ws.withShard((shard) => shard.store.get("member_devices", phone.deviceId)?.voip),
      ).toBe(false);
      const cleared = (await ws.events(phone.deviceId)).filter(
        (e) => e.type === "device.voip_cleared",
      );
      expect(cleared.map((e) => e.data)).toEqual([
        { id: phone.deviceId, userId: bia.id, reason: "token_invalid" },
      ]);
      expect((await ws.events(phone.deviceId)).map((e) => e.type)).not.toContain(
        "device.unregistered",
      );

      // The next page is an alert push only, to the same alert token.
      const second = await ws.declare(ana, "sev1");
      await deliver(second.event, fake.send);
      expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert", "call", "alert"]);
      expect(fake.requests[2]!.body.deviceToken).toBe(phone.pushToken);
    }
  });

  test("a VoIP token registered again while the call was out is kept", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia, { voip: true });
    const { event } = await ws.declare(ana, "sev1");
    const fresh = "c".repeat(64);
    const fake = relay(async (body) => {
      if (body.kind !== "call") return Response.json({ status: 200 });
      // The app registers a new PushKit token while the call to the old one is out.
      await ws.withShard((shard) =>
        shard.store.update("devices", phone.deviceId, { voipToken: fresh }),
      );
      return Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 });
    });
    await deliver(event, fake.send);
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)?.voipToken),
    ).toBe(fresh);
  });

  test("a member's choice of calls: never rings nobody, and SEV1 only keeps SEV1 pages ringing", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana, { voip: true });
    const biaPhone = await ws.device(bia, { voip: true });
    await ws.run(ana, "member.setCalls", { calls: "never" });
    await ws.run(bia, "member.setCalls", { calls: "sev1" });
    const fake = relay();
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev1");
    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });

    // Calls off: Ana still gets the alert push, and no call row is planned for her.
    const sent = (token: string | null) =>
      fake.requests.filter((r) => r.body.deviceToken === token).map((r) => r.body.kind ?? "alert");
    expect(sent(anaPhone.pushToken)).toEqual(["alert"]);
    expect(sent(anaPhone.voipToken)).toEqual([]);
    expect(sent(biaPhone.pushToken)).toEqual(["alert"]);
    expect(sent(biaPhone.voipToken)).toEqual(["call"]);
    const rows = await deliveries(ws, incident);
    expect(rows.filter((row) => row.kind === "call").map((row) => row.userId)).toEqual([bia.id]);
    expect(rows.filter((row) => row.kind !== "call").every((row) => row.acceptedAt !== null)).toBe(
      true,
    );
  });

  test("a call's choice per member and severity", () => {
    expect(wantsCall(undefined, "sev1")).toBe(true);
    expect(wantsCall(undefined, "sev2")).toBe(true);
    expect(wantsCall("sev1_sev2", "sev2")).toBe(true);
    expect(wantsCall("sev1", "sev1")).toBe(true);
    expect(wantsCall("sev1", "sev2")).toBe(false);
    expect(wantsCall("never", "sev1")).toBe(false);
  });

  test("an alert that fails is not followed by a call; the retry that delivers it rings, under the same call id", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia, { voip: true });
    const { event } = await ws.declare(ana, "sev1");
    let down = true;
    const fake = relay(() =>
      down
        ? Response.json({ error: "apns_unreachable" }, { status: 502 })
        : Response.json({ status: 200 }),
    );
    expect((await deliver(event, fake.send)).retried).toHaveLength(1);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert"]);

    down = false;
    expect((await deliver(event, fake.send, { attempts: 2 })).acked).toEqual(["msg-0"]);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert", "alert", "call"]);
    expect(fake.requests[2]!.body).toMatchObject({
      deviceToken: phone.voipToken,
      callId: await callIdOf(event.id),
    });
  });

  test("an Android phone that registered a call token rings through FCM after its alert; one without does not", async () => {
    const ws = await workspace();
    const ringing = await ws.device(bia, {
      platform: "android",
      environment: "production",
      voip: true,
    });
    const quiet = await ws.device(ana, { platform: "android", environment: "production" });
    const { event } = await ws.declare(MONITOR_ACTOR, "sev1");
    const fake = relay();
    await deliver(event, fake.send);
    const call = fake.requests.find((r) => r.body.kind === "call");
    expect(call?.body).toMatchObject({
      platform: "android",
      deviceToken: ringing.voipToken,
      callId: await callIdOf(event.id),
      urgency: "page",
    });
    expect(await opened(ringing.recipient, call!.body.envelope)).toMatchObject({
      incident: event.subject,
    });
    // An alert to each phone's FCM token, and the call only after the ringing phone's alert.
    const sends = fake.requests.map((r) => `${r.body.kind ?? "alert"}:${r.body.deviceToken}`);
    expect(sends).toHaveLength(3);
    expect(sends).toEqual(
      expect.arrayContaining([`alert:${quiet.pushToken}`, `alert:${ringing.pushToken}`]),
    );
    expect(sends.indexOf(`call:${ringing.voipToken}`)).toBeGreaterThan(
      sends.indexOf(`alert:${ringing.pushToken}`),
    );
  });

  test("an Android phone's choice of calls is followed like an iPhone's", async () => {
    const ws = await workspace();
    await ws.device(bia, { platform: "android", environment: "production", voip: true });
    await ws.run(bia, "member.setCalls", { calls: "never" });
    const { event } = await ws.declare(MONITOR_ACTOR, "sev1");
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.kind ?? "alert")).toEqual(["alert"]);
  });

  test("call ids: a UUID the relay takes, the same for one event and different for another", async () => {
    const one = await callIdOf("evt_01");
    expect(one).toMatch(UUID);
    expect(await callIdOf("evt_01")).toBe(one);
    expect(await callIdOf("evt_02")).not.toBe(one);
  });
});

describe("Critical Alerts (RFC 0006)", () => {
  test("the policy: a SEV1 page to an iPhone that allows them; nothing else", () => {
    const sev = (severity: "sev1" | "sev2" | "sev3", urgency: "page" | "high" = "page") => ({
      urgency,
      incident: { severity },
    });
    const allowed = { platform: "ios", criticalAlerts: true } as const;
    expect(sendsCritical(sev("sev1"), allowed)).toBe(true);
    expect(sendsCritical(sev("sev2"), allowed)).toBe(false);
    expect(sendsCritical(sev("sev3", "high"), allowed)).toBe(false);
    expect(sendsCritical(sev("sev1", "high"), allowed)).toBe(false);
    expect(sendsCritical(sev("sev1"), { platform: "ios", criticalAlerts: false })).toBe(false);
    // A shard from before Critical Alerts sends no flag.
    expect(sendsCritical(sev("sev1"), { platform: "ios" })).toBe(false);
    expect(sendsCritical(sev("sev1"), { platform: "android", criticalAlerts: true })).toBe(false);
  });

  test("a SEV1 page is critical only for the phones that allow it; SEV2 pages stay time-sensitive", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana, { criticalAlerts: true });
    const biaPhone = await ws.device(bia, { criticalAlerts: false });
    const fake = relay();
    const { event } = await ws.declare(MONITOR_ACTOR, "sev1");
    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    const to = (token: string) => fake.requests.filter((r) => r.body.deviceToken === token);
    expect(to(anaPhone.pushToken).map((r) => r.body.critical)).toEqual([true]);
    expect(to(biaPhone.pushToken).map((r) => r.body.critical)).toEqual([undefined]);
    expect(to(anaPhone.pushToken)[0]!.body.urgency).toBe("page");

    const sev2 = await ws.declare(MONITOR_ACTOR, "sev2");
    await deliver(sev2.event, fake.send);
    expect(fake.requests.slice(2).map((r) => r.body.critical)).toEqual([undefined, undefined]);
  });

  test("a critical push the relay or APNs refuses goes out time-sensitive at once (the fallback)", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia, { criticalAlerts: true });
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev1");
    const refusals = [
      Response.json({ error: "invalid_body" }, { status: 400 }),
      Response.json({ status: 400, reason: "BadPayload" }, { status: 502 }),
    ];
    for (const refusal of refusals) {
      const fake = relay((body) =>
        body.critical ? refusal.clone() : Response.json({ status: 200 }),
      );
      const fresh = await ws.declare(MONITOR_ACTOR, "sev1");
      expect(await deliver(fresh.event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
      expect(fake.requests.map((r) => r.body.critical)).toEqual([true, undefined]);
      expect(fake.requests[1]!.body).toMatchObject({
        deviceToken: phone.pushToken,
        urgency: "page",
      });
    }
    expect(logged().map((line) => line.message)).toContain(
      "relay refused a critical push, sending it time-sensitive",
    );
    // A token APNs says is gone is not resent: the device is dropped as for any push.
    const gone = relay(() =>
      Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 }),
    );
    await deliver(event, gone.send);
    expect(gone.requests).toHaveLength(1);
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
    ).toBeUndefined();
    expect((await ws.timeline(incident)).map((row) => row.kind)).toContain("declared");
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
    // Ana has no device: recorded too (`no_devices`), apart from Bia's.
    const failed = (await ws.events(incident)).filter((e) => e.type === "notification.failed");
    expect(failed.filter((e) => (e.data as { userId: string }).userId === phone.userId)).toEqual([
      expect.objectContaining({
        actor: { kind: "system", id: "sys_notifier" },
        data: {
          incidentId: incident,
          eventId: event.id,
          channel: "push",
          userId: phone.userId,
          reason: "undelivered",
          schedule: null,
        },
      }),
    ]);
    // A later redelivery changes nothing: the page is closed.
    const before = await ws.timeline(incident);
    await deliver(event, down, { attempts: MAX_PAGE_ATTEMPTS + 1 });
    expect(await ws.timeline(incident)).toEqual(before);
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
    // The device is dropped and the page retried, so the next plan sees the member without it.
    expect(await deliver(event, fake.send)).toMatchObject({
      acked: [],
      retried: [expect.objectContaining({ msgId: "msg-0" })],
    });
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
    ).toBeUndefined();
    const types = (await ws.events()).map((e) => e.type);
    expect(types).toContain("device.unregistered");
    expect(await deliver(event, fake.send, { attempts: 2 })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    // Not `no_devices`: Bia had a phone, and APNs refusing its token is why she has none now.
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "token_invalid" }),
    );
  });

  test("a refused token stays the reason for this incident's later pages; a member who never had a phone is no_devices", async () => {
    const duda = user("usr_duda", "responder");
    const ws = await workspace([ana, bia, duda]);
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev3");
    const fake = relay(() =>
      Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 }),
    );
    await deliver(event, fake.send);
    await deliver(event, fake.send, { attempts: 2 });
    // Ana raises the severity: a new page, which finds Bia without a phone, and Duda, who never registered one.
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" });
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    expect(await deliver(raised, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    const failed = (await ws.events(incident))
      .filter((e) => e.type === "notification.failed")
      .map((e) => e.data as { eventId: string; userId: string; reason: string });
    expect(failed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: event.id, userId: "usr_bia", reason: "token_invalid" }),
        expect.objectContaining({ eventId: raised.id, userId: "usr_bia", reason: "token_invalid" }),
        expect.objectContaining({ eventId: raised.id, userId: "usr_duda", reason: "no_devices" }),
      ]),
    );
    expect(
      failed.filter((one) => one.userId === "usr_bia" && one.reason !== "token_invalid"),
    ).toEqual([]);
  });

  test("a token refused on the last attempt is recorded as token_invalid, not undelivered", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const fake = relay(() =>
      Response.json({ status: 400, reason: "BadDeviceToken" }, { status: 502 }),
    );
    expect(await deliver(event, fake.send, { attempts: MAX_PAGE_ATTEMPTS })).toEqual({
      acked: ["msg-0"],
      retried: [],
    });
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "token_invalid" }),
    );
  });

  test("a device registered again with a new token while its push was out is kept", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const fresh = "f".repeat(64);
    const fake = relay(async () => {
      // The app rotated its token before APNs answered that the old one is gone.
      await ws.run(bia, "device.register", {
        id: phone.deviceId,
        platform: "ios",
        environment: "sandbox",
        pushToken: fresh,
        voipToken: null,
        publicKey: toBase64url(phone.recipient.publicKey),
      });
      return Response.json({ status: 410, reason: "Unregistered" }, { status: 502 });
    });
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([phone.pushToken]);
    expect(
      await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)?.pushToken),
    ).toBe(fresh);
    expect((await ws.events()).map((e) => e.type)).not.toContain("device.unregistered");
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

  test("a relay that refuses the request (403, 404: wrong token or URL) is not retried", async () => {
    for (const status of [403, 404]) {
      const ws = await workspace();
      await ws.device(bia);
      const { incident, event } = await ws.declare(MONITOR_ACTOR);
      const fake = relay(() => Response.json({ error: "nope" }, { status }));
      expect(await deliver(event, fake.send), String(status)).toEqual({
        acked: ["msg-0"],
        retried: [],
      });
      expect(await ws.timeline(incident)).toContainEqual(
        expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "undelivered" }),
      );
    }
  });

  test("an Android phone is paged through the relay's FCM path, sealed to its own key with its receipt", async () => {
    const ws = await workspace();
    const iphone = await ws.device(ana);
    const android = await ws.device(bia, { platform: "android", environment: "production" });
    const { incident, event } = await ws.declare(MONITOR_ACTOR, "sev2");
    const fake = relay();
    expect(
      await deliver(event, fake.send, {
        environment: { ...relayEnv, DASHBOARD_URL: "https://brigade.example.com" } as Parameters<
          typeof consumeEvents
        >[1],
      }),
    ).toEqual({ acked: ["msg-0"], retried: [] });
    const request = fake.requests.find((r) => r.body.deviceToken === android.pushToken)!;
    expect(request.body).toMatchObject({
      platform: "android",
      urgency: "page",
      collapseId: incident,
    });
    expect(await opened(android.recipient, request.body.envelope)).toMatchObject({
      title: "SEV2 · INC-1",
      body: "Checkout is down",
      incident,
      workspace: event.workspaceId,
      receipt: { url: "https://brigade.example.com/api/receipts", token: expect.any(String) },
    });
    // An iPhone's body is unchanged: no platform, so every relay takes it.
    const ios = fake.requests.find((r) => r.body.deviceToken === iphone.pushToken)!;
    expect(ios.body.platform).toBeUndefined();
    expect((await ws.timeline(incident)).map((row) => row.kind)).toEqual(["declared"]);
  });

  test("FCM's refusals: a token that is done drops the Android phone; quota and outages are retried", async () => {
    for (const answer of [
      { status: 404, reason: "UNREGISTERED", tokenInvalid: true },
      { status: 400, reason: "INVALID_ARGUMENT", tokenInvalid: true },
      { status: 403, reason: "SENDER_ID_MISMATCH", tokenInvalid: true },
    ]) {
      const ws = await workspace();
      const phone = await ws.device(bia, { platform: "android", environment: "production" });
      const { incident, event } = await ws.declare(MONITOR_ACTOR);
      const fake = relay(() => Response.json(answer, { status: 502 }));
      expect((await deliver(event, fake.send)).retried, answer.reason).toHaveLength(1);
      expect(
        await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
      ).toBeUndefined();
      await deliver(event, fake.send, { attempts: 2 });
      expect(await ws.timeline(incident)).toContainEqual(
        expect.objectContaining({
          kind: "page_failed",
          userId: "usr_bia",
          reason: "token_invalid",
        }),
      );
    }
    for (const answer of [
      { status: 429, reason: "QUOTA_EXCEEDED" },
      { status: 503, reason: "UNAVAILABLE" },
      { status: 500, reason: "INTERNAL" },
      { error: "fcm_unreachable" },
    ]) {
      const ws = await workspace();
      const phone = await ws.device(bia, { platform: "android", environment: "production" });
      const { event } = await ws.declare(MONITOR_ACTOR);
      let refused = true;
      const fake = relay(() =>
        refused ? Response.json(answer, { status: 502 }) : Response.json({ status: 200 }),
      );
      expect((await deliver(event, fake.send)).retried, JSON.stringify(answer)).toHaveLength(1);
      // Kept, and its delivery row says the push service was busy, with FCM's own code.
      expect(
        await ws.withShard((shard) => shard.store.get("devices", phone.deviceId)),
      ).toBeDefined();
      const row = await ws.withShard((shard) =>
        shard.store.scan("deliveries").find((r) => r.deviceId === phone.deviceId),
      );
      expect(row).toMatchObject({
        error: "apns_unavailable",
        reason: "reason" in answer ? answer.reason : null,
      });
      refused = false;
      expect((await deliver(event, fake.send, { attempts: 2 })).acked).toEqual(["msg-0"]);
    }
  });

  test("a monitor's incident with nobody to page says so; a member's own declaration does not", async () => {
    // Only a viewer: nobody the page is for.
    const ws = await workspace([caio]);
    const fake = relay();
    const byMonitor = await ws.declare(MONITOR_ACTOR);
    await deliver(byMonitor.event, fake.send);
    expect(
      (await ws.timeline(byMonitor.incident)).filter((row) => row.kind === "page_failed"),
    ).toEqual([expect.objectContaining({ userId: null, reason: "no_devices" })]);
    const byAna = await ws.declare(ana);
    await deliver(byAna.event, fake.send);
    expect((await ws.timeline(byAna.incident)).map((row) => row.kind)).toEqual(["declared"]);
  });

  test("each member the page is for without a device is recorded by name, even when others were paged", async () => {
    const ws = await workspace([ana, bia, caio, user("usr_duda", "admin")]);
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(fake.requests).toHaveLength(1);
    const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
    // Duda has no device; Bia was paged; Ana declared it; Caio only reads.
    expect(failed).toEqual([
      expect.objectContaining({ userId: "usr_duda", reason: "no_devices", actor: "sys_notifier" }),
    ]);
    // Nobody with a device: still by name, at once.
    const second = await ws.declare(bia);
    await deliver(second.event, fake.send);
    expect(
      (await ws.timeline(second.incident))
        .filter((row) => row.kind === "page_failed")
        .map((row) => row.kind === "page_failed" && [row.userId, row.reason]),
    ).toEqual([
      ["usr_ana", "no_devices"],
      ["usr_duda", "no_devices"],
    ]);
  });

  test("a commander without a device: the responders are paged and the commander is recorded as not paged", async () => {
    const ws = await workspace();
    const anaPhone = await ws.device(ana);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    const fake = relay();
    expect(await deliver(event, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([anaPhone.pushToken]);
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: bia.id, reason: "no_devices" }),
    );
  });

  test("a commander whose only device expired is replaced by everyone who can respond on the retry", async () => {
    // Ana raises the severity, so she is not paged; Duda is the other responder.
    const duda = user("usr_duda", "responder");
    const ws = await workspace([ana, bia, duda]);
    const dudaPhone = await ws.device(duda);
    const biaPhone = await ws.device(bia);
    const { incident } = await ws.declare(MONITOR_ACTOR, "sev3");
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" });
    const raised = (await ws.events(incident)).find((e) => e.type === "incident.severity_changed")!;
    const fake = relay((body) =>
      body.deviceToken === biaPhone.pushToken
        ? Response.json({ status: 410, reason: "Unregistered" }, { status: 502 })
        : Response.json({ status: 200 }),
    );
    expect(await deliver(raised, fake.send)).toMatchObject({
      acked: [],
      retried: [expect.objectContaining({ msgId: "msg-0" })],
    });
    await deliver(raised, fake.send, { attempts: 2 });
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([
      biaPhone.pushToken,
      dudaPhone.pushToken,
    ]);
  });

  test("a commander with a device is the only one paged", async () => {
    const ws = await workspace();
    await ws.device(ana);
    const biaPhone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([biaPhone.pushToken]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([]);
  });

  test("role definitions leave the commander's page as it was: renamed, it is still paged first; other roles never are", async () => {
    const duda = user("usr_duda", "responder");
    const ws = await workspace([ana, bia, caio, duda]);
    await ws.device(ana);
    const biaPhone = await ws.device(bia);
    await ws.device(duda);
    const scribe = "rol_01JB0000000000000000000001";
    await ws.run(ana, "incidentRole.update", {
      id: "commander",
      name: "Incident lead",
      description: "",
      checklist: [],
    });
    await ws.run(ana, "incidentRole.create", {
      id: scribe,
      name: "Scribe",
      description: "",
      checklist: [],
    });
    // Taking out another built-in leaves the commander alone (the commander itself never can be: roles.test.ts).
    await ws.run(ana, "incidentRole.delete", { id: "operations" });
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await ws.run(ana, "incident.assignRole", { id: incident, role: scribe, userId: duda.id });
    await ws.run(ana, "incident.assignRole", { id: incident, role: "commander", userId: bia.id });
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([biaPhone.pushToken]);
  });

  test(`past ${MAX_PAGE_DEVICES} devices, members none of whose devices were sent to are recorded (over_limit)`, async () => {
    const team = Array.from({ length: 21 }, (_, i) =>
      user(`usr_m${String(i).padStart(2, "0")}`, "responder"),
    );
    const ws = await workspace([ana, ...team]);
    // Ten phones each, written straight to the table: 210 devices, 10 past the limit.
    await ws.withShard((shard) => {
      for (const member of team) {
        for (let i = 0; i < 10; i++) {
          shard.store.insert("devices", {
            id: newId("dev", Date.now(), random),
            userId: member.id,
            platform: "ios",
            environment: "sandbox",
            pushToken: `${member.id}-${i}`.padEnd(32, "x"),
            voipToken: null,
            publicKey: "B",
            registeredAt: 0,
            updatedAt: 0,
          });
        }
      }
    });
    const { incident, event } = await ws.declare(ana);
    // The keys are not real points: sealing fails, which is not retried, and each member sent to is `undelivered`.
    await deliver(event, relay().send);
    const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
    expect(
      failed.filter((row) => row.kind === "page_failed" && row.reason === "over_limit"),
    ).toEqual([expect.objectContaining({ userId: "usr_m20" })]);
    expect(failed).toHaveLength(21);
    expect(logged()).toContainEqual(
      expect.objectContaining({ message: "page has too many devices, some skipped", limit: 200 }),
    );
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

  test("the last delivery before the dead-letter queue logs `page dead-lettered` with the event and incident", async () => {
    const ws = await workspace();
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const broken = {
      WORKSPACE: { getByName: () => ({ planPage: () => Promise.reject(new Error("reset")) }) },
    } as unknown as Parameters<typeof consumeEvents>[1];
    const dead = () => logged().filter((line) => line.message === "page dead-lettered");
    await deliver(event, relay().send, { environment: broken, attempts: QUEUE_MAX_RETRIES });
    expect(dead()).toEqual([]);
    expect(
      (await deliver(event, relay().send, { environment: broken, attempts: QUEUE_MAX_RETRIES + 1 }))
        .retried,
    ).toHaveLength(1);
    expect(dead()).toEqual([
      expect.objectContaining({ event: event.id, incident, attempts: QUEUE_MAX_RETRIES + 1 }),
    ]);
  });

  test("retry delays double from 5 s and stop at a minute", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelay)).toEqual([5, 10, 20, 40, 60, 60, 60]);
  });
});

/** Runs `name` as `actor` in the shard and answers its result, whatever it is. */
async function attempt(
  ws: Awaited<ReturnType<typeof workspace>>,
  actor: Actor,
  name: string,
  args: object,
) {
  return ws.withShard((shard) => {
    const { result } = shard.mutate({
      clientId: "test",
      mutationId: `m${++mutations}`,
      actor,
      name,
      args,
      now: Date.now(),
      internal: true,
    });
    return result;
  });
}

/** A relay that refuses every push for good (as for a request it will refuse again). */
const refusing = () => relay(() => Response.json({ error: "invalid_body" }, { status: 400 }));

// RFC 0005 "Notifiers": an owner or admin pages a failed page again, as a page of its own.
describe("paging a failed page again", () => {
  test("an owner pages a member a page missed again, on a new event, once", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, refusing().send);
    const failed = (await ws.timeline(incident)).find(
      (row) => row.kind === "page_failed" && row.userId === bia.id,
    )!;
    expect(failed).toMatchObject({ reason: "undelivered" });

    await ws.run(ana, "incident.pageAgain", { id: incident, entries: [failed.id] });
    const again = (await ws.events(incident)).find((e) => e.type === "incident.paged_again")!;
    // Never the old event replayed: a page of its own, with its own id, to the member it missed.
    expect(again.id).not.toBe(event.id);
    expect(again.data).toEqual({
      incidentId: incident,
      entries: [failed.id],
      userIds: [bia.id],
      everyone: false,
      causedBy: ana.id,
    });
    expect(asksForPage(again)).toBe(true);
    const fake = relay();
    await deliver(again, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([phone.pushToken]);
    expect(fake.requests[0]!.body).toMatchObject({ urgency: "page", collapseId: incident });
    expect((await ws.timeline(incident)).at(-1)).toMatchObject({
      kind: "paged_again",
      actor: ana.id,
      entries: [failed.id],
      userIds: [bia.id],
      everyone: false,
    });
    // Once per failed page; the old event stays closed.
    expect(
      await attempt(ws, ana, "incident.pageAgain", { id: incident, entries: [failed.id] }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    const late = relay();
    await deliver(event, late.send);
    expect(late.requests).toHaveLength(0);
  });

  test("refused for a responder, an acknowledged incident, and a failure paging again cannot change", async () => {
    const ws = await workspace([ana, bia, caio, user("usr_duda", "admin")]);
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, refusing().send);
    const failed = (await ws.timeline(incident)).find((row) => row.kind === "page_failed")!;
    expect(
      await attempt(ws, bia, "incident.pageAgain", { id: incident, entries: [failed.id] }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    // Not a failed page: the declaration's own entry.
    expect(
      await attempt(ws, ana, "incident.pageAgain", { id: incident, entries: [`${incident}:1`] }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    await ws.run(bia, "incident.ack", { id: incident });
    expect(
      await attempt(ws, user("usr_duda", "admin"), "incident.pageAgain", {
        id: incident,
        entries: [failed.id],
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect((await ws.events(incident)).map((e) => e.type)).not.toContain("incident.paged_again");
  });

  test("a lost page goes to whoever it was for: the interim rule, leaving out who declared it, not who asks", async () => {
    const duda = user("usr_duda", "admin");
    const ws = await workspace([ana, bia, caio, duda]);
    const anaPhone = await ws.device(ana);
    const biaPhone = await ws.device(bia);
    const dudaPhone = await ws.device(duda);
    const { incident, event } = await ws.declare(ana);
    const batch = createMessageBatch("brigade-events-dlq", [
      { id: "dlq-0", timestamp: new Date(), attempts: 1, body: event },
    ]);
    await consumeDeadLetters(batch, { WORKSPACE: env.WORKSPACE });
    const lost = (await ws.timeline(incident)).find((row) => row.kind === "page_failed")!;
    expect(lost).toMatchObject({ reason: "dead_lettered", userId: null, causedBy: ana.id });
    await ws.run(duda, "incident.pageAgain", { id: incident, entries: [lost.id] });
    const again = (await ws.events(incident)).find((e) => e.type === "incident.paged_again")!;
    // Ana declared it (and knows); Duda asking is no reason to leave Duda out.
    expect(again.data).toMatchObject({ userIds: [], everyone: true, causedBy: ana.id });
    const fake = relay();
    await deliver(again, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([
      biaPhone.pushToken,
      dudaPhone.pushToken,
    ]);
    expect(fake.requests.map((r) => r.body.deviceToken)).not.toContain(anaPhone.pushToken);
  });

  test("a member paged again who left since is recorded as not paged, and nobody else as `nobody_else`", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, refusing().send);
    const failed = (await ws.timeline(incident)).find(
      (row) => row.kind === "page_failed" && row.userId === bia.id,
    )!;
    await ws.run(ana, "incident.pageAgain", { id: incident, entries: [failed.id] });
    const again = (await ws.events(incident)).find((e) => e.type === "incident.paged_again")!;
    // Bia became a viewer before the page went out: the `paged_again` line is not the last word on her.
    await ws.run(ana, "member.changeRole", { id: bia.id, from: "responder", to: "viewer" });
    const fake = relay();
    await deliver(again, fake.send);
    expect(fake.requests).toHaveLength(0);
    expect((await ws.timeline(incident)).at(-1)).toMatchObject({
      kind: "page_failed",
      userId: bia.id,
      reason: "not_a_member",
    });

    // A lost page paged again to everyone, when only whoever declared it can respond.
    const alone = await workspace([ana, caio]);
    await alone.device(ana);
    const lost = await alone.declare(ana);
    await consumeDeadLetters(
      createMessageBatch("brigade-events-dlq", [
        { id: "dlq-0", timestamp: new Date(), attempts: 1, body: lost.event },
      ]),
      { WORKSPACE: env.WORKSPACE },
    );
    const entry = (await alone.timeline(lost.incident)).find((row) => row.kind === "page_failed")!;
    await alone.run(ana, "incident.pageAgain", { id: lost.incident, entries: [entry.id] });
    const everyone = (await alone.events(lost.incident)).find(
      (e) => e.type === "incident.paged_again",
    )!;
    await deliver(everyone, fake.send);
    expect(fake.requests).toHaveLength(0);
    expect((await alone.timeline(lost.incident)).at(-1)).toMatchObject({
      kind: "page_failed",
      userId: null,
      reason: "nobody_else",
    });
  });
});

// RFC 0005 "Notifiers", "The shard failing": a lost SEV1 or SEV2 declaration is paged again once, on its own.
describe("paging a lost declaration again on its own", () => {
  async function deadLetter(event: BrigadeEvent) {
    const batch = createMessageBatch("brigade-events-dlq", [
      { id: "dlq-0", timestamp: new Date(), attempts: 1, body: event },
    ]);
    await consumeDeadLetters(batch, { WORKSPACE: env.WORKSPACE });
  }
  /** Makes the queued page again due, as if `PAGE_REPLAY_DELAY_MS` passed, and runs the shard's alarm. */
  async function replay(ws: Awaited<ReturnType<typeof workspace>>) {
    await runInDurableObject(ws.stub, async (_instance: WorkspaceDO, state) => {
      state.storage.sql.exec("update page_replays set at = ?", Date.now() - 1);
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
  }

  /** Runs the shard's alarm now, with nothing made due. */
  async function alarm(ws: Awaited<ReturnType<typeof workspace>>) {
    await runInDurableObject(ws.stub, (_instance: WorkspaceDO, state) =>
      state.storage.setAlarm(Date.now() + 60_000),
    );
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
  }

  test("a lost SEV1 declared by a monitor pages everyone who can respond once, after a delay", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const lost = Date.now();
    await deadLetter(event);
    // Not at once: the delay is for whatever stopped it to pass. The alarm before it is due pages nothing.
    expect((await ws.events(incident)).map((e) => e.type)).not.toContain("incident.paged_again");
    await alarm(ws);
    expect((await ws.events(incident)).map((e) => e.type)).not.toContain("incident.paged_again");
    const queued = await ws.withShard((_shard, sql) =>
      sql.exec<{ at: number }>("select at from page_replays").toArray(),
    );
    expect(queued).toHaveLength(1);
    // From when it was dead-lettered: never a bound on how long the steps since took.
    expect(queued[0]!.at).toBeGreaterThanOrEqual(lost + PAGE_REPLAY_DELAY_MS);

    await replay(ws);
    const again = (await ws.events(incident)).filter((e) => e.type === "incident.paged_again");
    expect(again).toHaveLength(1);
    expect(again[0]!.id).not.toBe(event.id);
    expect(again[0]).toMatchObject({
      actor: { id: "sys_notifier" },
      data: { everyone: true, userIds: [], causedBy: MONITOR_ACTOR.id },
    });
    expect((await ws.timeline(incident)).at(-1)).toMatchObject({
      kind: "paged_again",
      auto: true,
      everyone: true,
    });
    const fake = relay();
    await deliver(again[0]!, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([phone.pushToken]);

    // Once: the same dead letter again, or the alarm again, adds nothing; nor does its own page being lost.
    await deadLetter(event);
    await ws.withShard((_shard, sql) =>
      sql.exec("insert into page_replays values ('evt_x', ?, ?, 'sys_monitors', 0)", incident, "x"),
    );
    await replay(ws);
    await deadLetter(again[0]!);
    await ws.withShard(async (_shard, sql) => {
      expect(sql.exec("select * from page_replays").toArray()).toEqual([]);
    });
    expect(
      (await ws.events(incident)).filter((e) => e.type === "incident.paged_again"),
    ).toHaveLength(1);
  });

  test("its own page lost too keeps who declared it: paged again by hand, they are still left out", async () => {
    const duda = user("usr_duda", "admin");
    const ws = await workspace([ana, bia, caio, duda]);
    const anaPhone = await ws.device(ana);
    const biaPhone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deadLetter(event);
    await replay(ws);
    const auto = (await ws.events(incident)).find((e) => e.type === "incident.paged_again")!;
    expect(auto).toMatchObject({ actor: { id: "sys_notifier" }, data: { causedBy: ana.id } });
    await deadLetter(auto);
    const lost = (await ws.timeline(incident))
      .filter((row) => row.kind === "page_failed" && row.reason === "dead_lettered")
      .at(-1)!;
    expect(lost).toMatchObject({ causedBy: ana.id });
    expect(
      (await ws.events(incident)).filter((e) => e.type === "notification.failed").at(-1),
    ).toMatchObject({ data: { eventId: auto.id, reason: "dead_lettered" } });

    await ws.run(duda, "incident.pageAgain", { id: incident, entries: [lost.id] });
    const byHand = (await ws.events(incident)).find(
      (e) => e.type === "incident.paged_again" && e.actor.id === duda.id,
    )!;
    expect(byHand.data).toMatchObject({ everyone: true, causedBy: ana.id });
    const fake = relay();
    await deliver(byHand, fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([biaPhone.pushToken]);
    expect(fake.requests.map((r) => r.body.deviceToken)).not.toContain(anaPhone.pushToken);
  });

  test("dropped once someone paged it again by hand", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await deadLetter(event);
    const lost = (await ws.timeline(incident)).find((row) => row.kind === "page_failed")!;
    await ws.run(ana, "incident.pageAgain", { id: incident, entries: [lost.id] });
    await replay(ws);
    expect(
      (await ws.events(incident)).filter((e) => e.type === "incident.paged_again"),
    ).toMatchObject([{ actor: { id: ana.id } }]);
    expect((await ws.timeline(incident)).filter((row) => row.kind === "paged_again")).toEqual([
      expect.not.objectContaining({ auto: true }),
    ]);
    await ws.withShard(async (_shard, sql) => {
      expect(sql.exec("select * from page_replays").toArray()).toEqual([]);
    });
  });

  test("dropped once an escalation run started on the incident: the run pages it", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    await deadLetter(event);
    await ws.run(ana, "escalation.createPolicy", {
      id: newId("esc", Date.now(), random),
      name: "Checkout",
      levels: [
        {
          id: newId("lvl", Date.now(), random),
          targets: [{ kind: "member", id: bia.id }],
          timeoutMinutes: 5,
        },
      ],
      repeat: 0,
      isDefault: true,
    });
    await ws.run(ESCALATION_ACTOR, "escalation.start", {
      incidentId: incident,
      eventId: newId("evt", Date.now(), random),
      causedBy: ana.id,
    });
    await replay(ws);
    expect((await ws.events(incident)).map((e) => e.type)).not.toContain("incident.paged_again");
    expect(logged()).toContainEqual(
      expect.objectContaining({
        message: "paging a lost page again dropped: an escalation run pages it",
      }),
    );
    await ws.withShard(async (_shard, sql) => {
      expect(sql.exec("select * from page_replays").toArray()).toEqual([]);
    });
  });

  test("not for a SEV3, an incident acknowledged meanwhile, or a page a run pages again", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const low = await ws.declare(MONITOR_ACTOR, "sev3");
    await deadLetter(low.event);
    const acked = await ws.declare(MONITOR_ACTOR);
    await deadLetter(acked.event);
    await ws.run(bia, "incident.ack", { id: acked.incident });
    await replay(ws);
    for (const { incident } of [low, acked]) {
      expect((await ws.events(incident)).map((e) => e.type)).not.toContain("incident.paged_again");
      expect((await ws.timeline(incident)).map((row) => row.kind)).not.toContain("paged_again");
    }
  });
});

// RFC 0006 "Offline phones": APNs keeps only the latest push for a phone it cannot reach.
describe("lower-urgency pushes behind a page", () => {
  /** The same page asked for again by another event (as a later push for the incident would be). */
  const another = (event: BrigadeEvent): BrigadeEvent => ({
    ...event,
    id: newId("evt", Date.now(), random),
    time: new Date().toISOString(),
  });

  test("a SEV3 push waits out a page the phone has not confirmed, and never shares its collapse id", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests.map((r) => r.body)).toMatchObject([
      { urgency: "page", collapseId: incident },
    ]);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });

    // APNs took the page and the phone has not said it got it: the SEV3 push is held back, pending, and Bia is not
    // recorded as missed.
    const held = another(event);
    expect(await deliver(held, fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(fake.requests).toHaveLength(1);
    expect(logged()).toContainEqual(
      expect.objectContaining({
        message: "push held back behind a page the phone may still be waiting for",
      }),
    );
    expect((await ws.timeline(incident)).map((row) => row.kind)).not.toContain("page_failed");

    // Once the phone confirms the page, a later push goes out, under a collapse id of its own.
    await ws.run(NOTIFIER_ACTOR, "delivery.confirm", {
      id: deliveryId(incident, event.id, phone.deviceId),
    });
    await deliver(another(event), fake.send);
    expect(fake.requests.map((r) => r.body)).toMatchObject([
      { urgency: "page", collapseId: incident },
      { urgency: "high", collapseId: `${incident}:high` },
    ]);
  });

  /** The shard's held-back pushes, oldest first. */
  const held = (ws: Awaited<ReturnType<typeof workspace>>) =>
    ws.withShard((_shard, sql) =>
      sql
        .exec<{ event_id: string; device_id: string; state: string }>(
          "select event_id, device_id, state from page_held order by at, event_id",
        )
        .toArray(),
    );
  /** The `notification.released` events of `incident` in the outbox. */
  const releases = async (ws: Awaited<ReturnType<typeof workspace>>, incident: string) =>
    (await ws.events(incident)).filter((e) => e.type === "notification.released");
  /** Runs the shard's alarm now. */
  async function alarm(ws: Awaited<ReturnType<typeof workspace>>) {
    await runInDurableObject(ws.stub, (_instance: WorkspaceDO, state) =>
      state.storage.setAlarm(Date.now() + 60_000),
    );
    expect(await runDurableObjectAlarm(ws.stub)).toBe(true);
  }
  /** Moves every page's planned and accepted times `ms` into the past. */
  const age = (ws: Awaited<ReturnType<typeof workspace>>, ms: number) =>
    ws.withShard((_shard, sql) => {
      sql.exec(
        "update page_urgent set planned_at = planned_at - ?, accepted_at = accepted_at - ?",
        ms,
        ms,
      );
    });

  test("a phone offline for 20 minutes still gets the latest push held, once, when the hold ends", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const first = another(event);
    // Held a moment later: the latest is the one planned last.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const latest = another(event);
    await deliver(first, fake.send);
    await deliver(latest, fake.send);
    expect(fake.requests).toHaveLength(1);
    // Pending, not reached: the ledger has no delivery for either.
    expect(await held(ws)).toEqual([
      { event_id: first.id, device_id: phone.deviceId, state: "held" },
      { event_id: latest.id, device_id: phone.deviceId, state: "held" },
    ]);
    await ws.withShard((_shard, sql) => {
      expect(
        sql
          .exec("select * from page_deliveries where event_id in (?, ?)", first.id, latest.id)
          .toArray(),
      ).toEqual([]);
    });
    await alarm(ws);
    expect(await releases(ws, incident)).toEqual([]);

    // Twenty minutes on, the phone still offline and the page never confirmed: the hold ran out.
    await age(ws, 20 * 60 * 1000);
    await alarm(ws);
    const out = await releases(ws, incident);
    expect(out).toMatchObject([
      {
        actor: { id: "sys_notifier" },
        data: { incidentId: incident, eventId: latest.id, deviceIds: [phone.deviceId] },
      },
    ]);
    expect(asksForPage(out[0]!)).toBe(true);
    // Only the latest goes; the one before it is passed over.
    expect((await held(ws)).map((row) => row.state)).toEqual(["superseded", "released"]);
    await deliver(out[0]!, fake.send);
    expect(fake.requests.map((r) => r.body)).toMatchObject([
      { urgency: "page", collapseId: incident },
      { urgency: "high", collapseId: `${incident}:high`, deviceToken: phone.pushToken },
    ]);
    const pushed = await opened(phone.recipient, fake.requests[1]!.body.envelope);
    expect(pushed).toMatchObject({ incident, title: expect.stringMatching(/^SEV3 /) });

    // Once: the alarm again, the release again, or either held push again sends nothing more.
    await alarm(ws);
    expect(await releases(ws, incident)).toHaveLength(1);
    await deliver(out[0]!, fake.send);
    await deliver(latest, fake.send);
    await deliver(first, fake.send);
    expect(fake.requests).toHaveLength(2);
  });

  test("the page's receipt releases a held push at once", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    const environment = {
      ...relayEnv,
      DASHBOARD_URL: "https://brigade.test",
    } as Parameters<typeof consumeEvents>[1];
    await deliver(event, fake.send, { environment });
    const page = await opened(phone.recipient, fake.requests[0]!.body.envelope);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const later = another(event);
    await deliver(later, fake.send, { environment });
    expect(fake.requests).toHaveLength(1);
    expect(await releases(ws, incident)).toEqual([]);

    expect(await ws.stub.receipt(page.receipt!.token)).toBe("recorded");
    const out = await releases(ws, incident);
    expect(out).toMatchObject([{ data: { eventId: later.id, deviceIds: [phone.deviceId] } }]);
    await deliver(out[0]!, fake.send, { environment });
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["page", "high"]);
  });

  test("a receipt that never comes: released when the hold ends, which the alarm is set for", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const later = another(event);
    await deliver(later, fake.send);
    const accepted = await ws.withShard(
      (_shard, sql) =>
        sql.exec<{ accepted_at: number }>("select accepted_at from page_urgent").one().accepted_at,
    );
    const set = await runInDurableObject(ws.stub, (_instance: WorkspaceDO, state) =>
      state.storage.getAlarm(),
    );
    expect(set).not.toBeNull();
    expect(set!).toBeLessThanOrEqual(accepted + PAGE_HOLD_MS);

    // A minute before the end, still held.
    await age(ws, PAGE_HOLD_MS - 60_000);
    await alarm(ws);
    expect(await releases(ws, incident)).toEqual([]);
    await age(ws, 60_000);
    await alarm(ws);
    expect(await releases(ws, incident)).toMatchObject([
      { data: { eventId: later.id, deviceIds: [phone.deviceId] } },
    ]);
  });

  test("a held push is dropped, not sent, once the incident is acknowledged", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    await deliver(another(event), fake.send);
    await ws.run(bia, "incident.ack", { id: incident });
    await age(ws, PAGE_HOLD_MS + 1);
    await alarm(ws);
    expect(await releases(ws, incident)).toEqual([]);
    expect((await held(ws)).map((row) => row.state)).toEqual(["dropped"]);
  });

  test("a push planned while a page is on its way to the relay waits for it too", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    // Another message of the same batch planned the page and is waiting on the relay: no outcome yet.
    expect(await ws.stub.planPage(event)).toMatchObject({ send: true, urgency: "page" });
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const fake = relay();
    const later = another(event);
    await deliver(later, fake.send);
    expect(fake.requests).toHaveLength(0);
    expect(await held(ws)).toMatchObject([{ event_id: later.id, state: "held" }]);

    // The relay refused the page: no phone waits for it, so the held push goes at the next alarm.
    await ws.stub.recordPage(
      event,
      [
        {
          deviceId: phone.deviceId,
          userId: bia.id,
          ok: false,
          reason: "undelivered",
          error: "relay_refused",
        },
      ],
      true,
      [],
    );
    await alarm(ws);
    expect(await releases(ws, incident)).toMatchObject([
      { data: { eventId: later.id, deviceIds: [phone.deviceId] } },
    ]);
  });

  test("a page the relay never answers stops holding a push back after the in-flight timeout", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    // Planned, and the relay never answered: no outcome is ever recorded.
    expect(await ws.stub.planPage(event)).toMatchObject({ send: true, urgency: "page" });
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const fake = relay();
    const later = another(event);
    await deliver(later, fake.send);
    expect(fake.requests).toHaveLength(0);
    const planned = await ws.withShard(
      (_shard, sql) =>
        sql.exec<{ planned_at: number }>("select planned_at from page_urgent").one().planned_at,
    );
    const set = await runInDurableObject(ws.stub, (_instance: WorkspaceDO, state) =>
      state.storage.getAlarm(),
    );
    expect(set!).toBeLessThanOrEqual(planned + PAGE_IN_FLIGHT_MS);

    await age(ws, PAGE_IN_FLIGHT_MS - 10_000);
    await alarm(ws);
    expect(await releases(ws, incident)).toEqual([]);
    await age(ws, 10_000);
    await alarm(ws);
    const out = await releases(ws, incident);
    expect(out).toMatchObject([{ data: { eventId: later.id, deviceIds: [phone.deviceId] } }]);
    await deliver(out[0]!, fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["high"]);
  });

  test("a release whose rows cannot leave `held` rolls back with them: the push goes out once", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const later = another(event);
    await deliver(later, fake.send);
    await ws.withShard((_shard, sql) => {
      sql.exec(
        "create trigger no_release before update on page_held when new.state = 'released' begin select raise(abort, 'storage failed'); end",
      );
    });
    await age(ws, PAGE_HOLD_MS + 1);
    await alarm(ws);
    // The mutation committed, then marking its rows failed: neither stays.
    expect(await releases(ws, incident)).toEqual([]);
    expect((await held(ws)).map((row) => row.state)).toEqual(["held"]);
    expect(logged()).toContainEqual(
      expect.objectContaining({ message: "releasing held pushes failed" }),
    );

    await ws.withShard((_shard, sql) => {
      sql.exec("drop trigger no_release");
    });
    await alarm(ws);
    await alarm(ws);
    expect(await releases(ws, incident)).toMatchObject([
      { data: { eventId: later.id, deviceIds: [phone.deviceId] } },
    ]);
    expect((await held(ws)).map((row) => row.state)).toEqual(["released"]);
  });

  test("a held push never goes to a phone signed in to another member since", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    await deliver(another(event), fake.send);
    // The phone is Ana's now: the push was held for Bia.
    await ws.withShard((shard) => {
      shard.store.update("devices", phone.deviceId, { userId: ana.id });
    });
    await age(ws, PAGE_HOLD_MS + 1);
    await alarm(ws);
    const out = await releases(ws, incident);
    expect(out).toHaveLength(1);
    await deliver(out[0]!, fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["page"]);
  });

  test("phones held back behind a page for a while never keep a due push waiting, past a batch", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const later = another(event);
    await deliver(later, fake.send);
    await age(ws, PAGE_HOLD_MS + 1);
    // More phones than a release looks at, each held back longer ago and behind a page APNs took just now.
    await ws.withShard((_shard, sql) => {
      const now = Date.now();
      for (let i = 0; i < 501; i++) {
        const device = `dev_other${String(i).padStart(4, "0")}`;
        const other = `inc_other${String(i).padStart(4, "0")}`;
        sql.exec(
          "insert into page_held (event_id, device_id, incident_id, user_id, at) values (?, ?, ?, ?, ?)",
          `evt_other${i}`,
          device,
          other,
          bia.id,
          i,
        );
        sql.exec(
          "insert into page_urgent (event_id, device_id, incident_id, planned_at, accepted_at) values (?, ?, ?, ?, ?)",
          `evt_page${i}`,
          device,
          other,
          now,
          now,
        );
      }
    });
    await alarm(ws);
    expect(await releases(ws, incident)).toMatchObject([
      { data: { eventId: later.id, deviceIds: [phone.deviceId] } },
    ]);
  });

  test("a member whose other phone a push is held back from is not recorded as missed until its release", async () => {
    const ws = await workspace();
    const waiting = await ws.device(bia);
    const other = await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    // APNs takes the page for one phone, refuses the other: only the first may still be waiting for it.
    const fake = relay((body) =>
      body.deviceToken === waiting.pushToken
        ? Response.json({ status: 200 })
        : Response.json({ error: "invalid_body" }, { status: 400 }),
    );
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const failed = async () =>
      (await ws.timeline(incident)).filter(
        (row) => row.kind === "page_failed" && row.userId === bia.id,
      );
    expect(await failed()).toEqual([]);

    // The later push goes to the other phone and fails there; the first phone's is held. Bia may still get it.
    await deliver(another(event), fake.send);
    expect(fake.requests.map((r) => r.body.deviceToken)).toEqual([
      waiting.pushToken,
      other.pushToken,
      other.pushToken,
    ]);
    expect(await failed()).toEqual([]);
    expect((await ws.events(incident)).filter((e) => e.type === "notification.failed")).toEqual([]);

    // The release fails too: that is when she is recorded as not reached.
    await age(ws, PAGE_HOLD_MS + 1);
    await alarm(ws);
    const out = await releases(ws, incident);
    expect(out).toHaveLength(1);
    await deliver(out[0]!, refusing().send);
    expect(await failed()).toEqual([expect.objectContaining({ reason: "undelivered" })]);
    expect(
      (await ws.events(incident)).filter((e) => e.type === "notification.failed"),
    ).toMatchObject([{ data: { eventId: out[0]!.id, userId: bia.id } }]);
  });

  test("a hold that cannot be written sends the push at once (fail open)", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    const fake = relay();
    await deliver(event, fake.send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    await ws.withShard((_shard, sql) => {
      sql.exec(
        "create trigger no_hold before insert on page_held begin select raise(abort, 'storage failed'); end",
      );
    });
    expect(await deliver(another(event), fake.send)).toEqual({ acked: ["msg-0"], retried: [] });
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["page", "high"]);
    expect(logged()).toContainEqual(
      expect.objectContaining({ message: "holding a push back failed, sending it now" }),
    );
  });

  test("a page APNs never took holds nothing back, and a page is never held back", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(ana);
    await deliver(event, refusing().send);
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev3" });
    const fake = relay();
    await deliver(another(event), fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["high"]);
    // Raised again: a page goes whatever came before it.
    await ws.run(ana, "incident.setSeverity", { id: incident, severity: "sev1" });
    await deliver(another(event), fake.send);
    expect(fake.requests.map((r) => r.body.urgency)).toEqual(["high", "page"]);
  });
});

describe("the dead-letter consumer", () => {
  async function deadLetter(event: unknown, environment = { WORKSPACE: env.WORKSPACE }) {
    const batch = createMessageBatch("brigade-events-dlq", [
      { id: "dlq-0", timestamp: new Date(), attempts: 1, body: event },
    ]);
    const ctx = createExecutionContext();
    await consumeDeadLetters(batch, environment);
    const result = await getQueueResult(batch, ctx);
    return { acked: result.explicitAcks, retried: result.retryMessages.map((m) => m.msgId) };
  }

  test("records a page the Queue gave up on, once, and acks", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    expect(await deadLetter(event)).toEqual({ acked: ["dlq-0"], retried: [] });
    expect(await deadLetter(event)).toEqual({ acked: ["dlq-0"], retried: [] });
    const failed = (await ws.timeline(incident)).filter((row) => row.kind === "page_failed");
    expect(failed).toEqual([
      expect.objectContaining({ userId: null, reason: "dead_lettered", actor: "sys_notifier" }),
    ]);
    expect((await ws.events(incident)).filter((e) => e.type === "notification.failed")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ eventId: event.id, reason: "dead_lettered", userId: null }),
      }),
    ]);
    // The page is closed: a late redelivery of the original sends nothing.
    const fake = relay();
    await deliver(event, fake.send);
    expect(fake.requests).toHaveLength(0);
  });

  test("a page already settled, or for an acknowledged incident, adds nothing", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const settled = await ws.declare(MONITOR_ACTOR);
    await deliver(settled.event, relay().send);
    await deadLetter(settled.event);
    const acked = await ws.declare(MONITOR_ACTOR);
    await ws.run(bia, "incident.ack", { id: acked.incident });
    await deadLetter(acked.event);
    for (const { incident } of [settled, acked]) {
      const reasons = (await ws.timeline(incident)).map(
        (row) => row.kind === "page_failed" && row.reason,
      );
      expect(reasons).not.toContain("dead_lettered");
    }
  });

  test("an unreachable shard is retried; a malformed message or an event that does not page is acked", async () => {
    const ws = await workspace();
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const broken = {
      WORKSPACE: {
        getByName: () => ({ recordDeadLetter: () => Promise.reject(new Error("reset")) }),
      },
    } as unknown as { WORKSPACE: typeof env.WORKSPACE };
    // Likely still down (that is how the page got here): try again later, not drop the only record.
    expect(await deadLetter(event, broken)).toEqual({ acked: [], retried: ["dlq-0"] });
    expect(logged()).toContainEqual(
      expect.objectContaining({
        message: "dead-lettered page could not be recorded",
        event: event.id,
      }),
    );
    expect(await deadLetter({ nope: true })).toEqual({ acked: ["dlq-0"], retried: [] });
    await ws.run(ana, "incident.postUpdate", { id: incident, body: "Rolling back" });
    const update = (await ws.events(incident)).find((e) => e.type === "incident.update_posted")!;
    expect(await deadLetter(update)).toEqual({ acked: ["dlq-0"], retried: [] });
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([]);
  });
});

describe("queue routing", () => {
  test("the Worker sends dead-letter queues to the dead-letter consumer", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    for (const name of [
      "brigade-events-dlq",
      "brigade-events-dlq-dev",
      "brigade-events-dlq-staging",
    ]) {
      const batch = createMessageBatch(name, [
        { id: "dlq-r", timestamp: new Date(), attempts: 1, body: event },
      ]);
      const ctx = createExecutionContext();
      await worker.queue!(batch, env as never, ctx);
      expect((await getQueueResult(batch, ctx)).explicitAcks, name).toEqual(["dlq-r"]);
    }
    // Recorded as dead-lettered (by the first; the rest found it settled), not paged again as a fresh event.
    expect((await ws.timeline(incident)).filter((row) => row.kind === "page_failed")).toEqual([
      expect.objectContaining({ reason: "dead_lettered" }),
    ]);
  });
});

// The dead-man switch's heartbeat shares the Queue, and so batches, with pages (apps/api src/watchdog.ts). Whatever
// happens to the heartbeat, the page next to it goes out.
describe("a heartbeat in the same batch as a page", () => {
  const heartbeat = (): BrigadeEvent => ({
    id: newId("evt", Date.now(), random),
    type: HEARTBEAT_EVENT,
    source: `brigade://${SYSTEM_WORKSPACE}/watchdog`,
    workspaceId: SYSTEM_WORKSPACE,
    time: new Date().toISOString(),
    actor: { kind: "system", id: "sys_watchdog" },
    data: { beat: 1 },
    specversion: "1.0",
  });

  /** A relay that takes the send token (an empty `POST /send` is `400 invalid_body`) and the pages. */
  function relayWithTokenCheck() {
    const pages: string[] = [];
    const send: Fetch = async (request) => {
      const text = await request.text();
      if (text === "") return Response.json({ error: "invalid_body" }, { status: 400 });
      pages.push((JSON.parse(text) as RelayBody).deviceToken);
      return Response.json({ status: 200 });
    };
    return { pages, send };
  }

  async function deliverBoth(page: BrigadeEvent, watchdog: unknown, send: Fetch) {
    const batch = createMessageBatch("brigade-events", [
      { id: "beat", timestamp: new Date(), attempts: 1, body: heartbeat() },
      { id: "page", timestamp: new Date(), attempts: 1, body: page },
    ]);
    const ctx = createExecutionContext();
    await consumeEvents(
      batch,
      { ...relayEnv, WATCHDOG: watchdog as NonNullable<NotifyEnv["WATCHDOG"]> },
      send,
    );
    return getQueueResult(batch, ctx);
  }

  test("the page goes out and both are acked", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const proofs: string[] = [];
    const watchdog = {
      getByName: () => ({
        proved: async (_time: string, relay: string) => {
          proofs.push(relay);
        },
      }),
    };
    const fake = relayWithTokenCheck();
    const result = await deliverBoth(event, watchdog, fake.send);
    expect(result.explicitAcks.sort()).toEqual(["beat", "page"]);
    expect(fake.pages).toEqual([phone.pushToken]);
    expect(proofs).toEqual(["ok"]);
  });

  test("a watchdog whose RPC throws: the page still goes out", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const watchdog = {
      getByName: () => ({
        proved: async () => {
          throw new Error("Durable Object reset");
        },
      }),
    };
    const fake = relayWithTokenCheck();
    const result = await deliverBoth(event, watchdog, fake.send);
    expect(result.explicitAcks.sort()).toEqual(["beat", "page"]);
    expect(result.retryMessages).toEqual([]);
    expect(fake.pages).toEqual([phone.pushToken]);
    expect(logged()).toContainEqual(
      expect.objectContaining({ message: "heartbeat could not be recorded" }),
    );
  });

  test("an external check that never answers: the page still goes out, without waiting on it", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(MONITOR_ACTOR);
    // The real watchdog, pinging a check that hangs until its timeout aborts it.
    const ping = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
          ),
      );
    const stub = env.WATCHDOG.getByName(`notify-test-${++names}`);
    const watchdog = { getByName: () => stub };
    const fake = relayWithTokenCheck();
    const started = Date.now();
    const result = await deliverBoth(event, watchdog, fake.send);
    expect(Date.now() - started).toBeLessThan(PING_TIMEOUT_MS);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(result.explicitAcks.sort()).toEqual(["beat", "page"]);
    expect(fake.pages).toEqual([phone.pushToken]);
  });
});

// The relay is reached through the `RELAY` service binding when it is bound (a Worker cannot fetch another
// workers.dev Worker on its own account), and at RELAY_URL otherwise (a self-hosted instance, RFC 0006).
describe("how the consumer reaches the relay", () => {
  const heartbeat = (): BrigadeEvent => ({
    id: newId("evt", Date.now(), random),
    type: HEARTBEAT_EVENT,
    source: `brigade://${SYSTEM_WORKSPACE}/watchdog`,
    workspaceId: SYSTEM_WORKSPACE,
    time: new Date().toISOString(),
    actor: { kind: "system", id: "sys_watchdog" },
    data: { beat: 1 },
    specversion: "1.0",
  });

  /** A relay as apps/relay answers: `400 invalid_body` to the empty token check, 200 to a page. */
  function fakeRelay() {
    const calls: { url: string; auth: string | null; deviceToken?: string }[] = [];
    const send: Fetch = async (request) => {
      const text = await request.text();
      const deviceToken = text === "" ? undefined : (JSON.parse(text) as RelayBody).deviceToken;
      calls.push({ url: request.url, auth: request.headers.get("Authorization"), deviceToken });
      if (text === "") return Response.json({ error: "invalid_body" }, { status: 400 });
      return Response.json({ status: 200 });
    };
    return { calls, send };
  }

  /** The `RELAY` service binding, answering as `relay` does. */
  function binding(relay: ReturnType<typeof fakeRelay>): Fetcher {
    return {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => relay.send(new Request(input, init)),
      connect: () => {
        throw new Error("the relay is only fetched");
      },
    };
  }

  /** Delivers a heartbeat and `page` in one batch; returns what the watchdog was told about the relay. */
  async function deliverBoth(page: BrigadeEvent, environment: NotifyEnv, send: Fetch) {
    const proofs: string[] = [];
    const watchdog = {
      getByName: () => ({
        proved: async (_time: string, relay: string) => {
          proofs.push(relay);
        },
      }),
    };
    const batch = createMessageBatch("brigade-events", [
      { id: "beat", timestamp: new Date(), attempts: 1, body: heartbeat() },
      { id: "page", timestamp: new Date(), attempts: 1, body: page },
    ]);
    const ctx = createExecutionContext();
    await consumeEvents(
      batch,
      { ...environment, WATCHDOG: watchdog as unknown as NonNullable<NotifyEnv["WATCHDOG"]> },
      send,
    );
    const result = await getQueueResult(batch, ctx);
    return { acked: result.explicitAcks.sort(), proofs };
  }

  test("with the RELAY binding, the token check and the page go through it, never through fetch", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const bound = fakeRelay();
    const internet = fakeRelay();
    const globalFetch = vi.spyOn(globalThis, "fetch");
    // RELAY_URL is set too: the binding wins.
    const result = await deliverBoth(event, { ...relayEnv, RELAY: binding(bound) }, internet.send);
    expect(result).toEqual({ acked: ["beat", "page"], proofs: ["ok"] });
    expect(bound.calls).toHaveLength(2);
    expect(bound.calls).toContainEqual({
      url: "https://relay.internal/send",
      auth: "Bearer test-token",
      deviceToken: undefined,
    });
    expect(bound.calls).toContainEqual({
      url: "https://relay.internal/send",
      auth: "Bearer test-token",
      deviceToken: phone.pushToken,
    });
    expect(internet.calls).toEqual([]);
    expect(globalFetch).not.toHaveBeenCalled();
    // Bia's phone took the page; only members without a phone are recorded as missed.
    expect(await ws.timeline(incident)).not.toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia" }),
    );
  });

  test("the RELAY binding without a send token is not configured", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const bound = fakeRelay();
    const result = await deliverBoth(
      event,
      { WORKSPACE: env.WORKSPACE, RELAY: binding(bound) },
      fakeRelay().send,
    );
    expect(result).toEqual({ acked: ["beat", "page"], proofs: ["not_configured"] });
    expect(bound.calls).toEqual([]);
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "not_configured" }),
    );
  });

  test("without the binding, the token check and the page go to RELAY_URL", async () => {
    const ws = await workspace();
    const phone = await ws.device(bia);
    const { event } = await ws.declare(MONITOR_ACTOR);
    const internet = fakeRelay();
    const result = await deliverBoth(event, relayEnv, internet.send);
    expect(result).toEqual({ acked: ["beat", "page"], proofs: ["ok"] });
    expect(internet.calls).toHaveLength(2);
    for (const deviceToken of [undefined, phone.pushToken]) {
      expect(internet.calls).toContainEqual({
        url: "https://relay.test/send",
        auth: "Bearer test-token",
        deviceToken,
      });
    }
  });

  test("with neither the binding nor RELAY_URL, paging is not configured", async () => {
    const ws = await workspace();
    await ws.device(bia);
    const { incident, event } = await ws.declare(MONITOR_ACTOR);
    const internet = fakeRelay();
    const result = await deliverBoth(
      event,
      { WORKSPACE: env.WORKSPACE, RELAY_SEND_TOKEN: "test-token" },
      internet.send,
    );
    expect(result).toEqual({ acked: ["beat", "page"], proofs: ["not_configured"] });
    expect(internet.calls).toEqual([]);
    expect(await ws.timeline(incident)).toContainEqual(
      expect.objectContaining({ kind: "page_failed", userId: "usr_bia", reason: "not_configured" }),
    );
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
