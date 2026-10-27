// Delivery receipts (RFC 0006 "Delivery receipts"): one row per page and device, its stages, and the device summaries
// every member sees (no token, no key).
import { describe, expect, test } from "vite-plus/test";
import {
  callDeliveryId,
  createMemoryStore,
  deliveryId,
  isCallDelivery,
  deliveryStage,
  evaluateQuery,
  incidentDeliveries,
  allDevices,
  MAX_DELIVERIES_PER_DEVICE,
  mutations,
  newId,
  NOTIFIER_ACTOR,
  parseDeliveryId,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type MemoryStore,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);
let seed = 0;
const random = (n: number) => new Uint8Array(n).fill(++seed % 256);
const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const KEY = `B${"A".repeat(86)}`;

function run(
  store: MemoryStore<BrigadeTables>,
  actor: Actor,
  name: string,
  input: unknown,
  now = T,
) {
  return runMutation(serverMutations, name, input, store, { actor, now, server: true });
}

function setup() {
  const store = createMemoryStore<BrigadeTables>();
  const incidentId = newId("inc", T, random);
  run(store, ana, "incident.declare", {
    id: incidentId,
    title: "Checkout is down",
    severity: "sev1",
  });
  const deviceId = newId("dev", T, random);
  run(store, ana, "device.register", {
    id: deviceId,
    platform: "ios",
    environment: "production",
    pushToken: "a".repeat(64),
    voipToken: null,
    publicKey: KEY,
  });
  const eventId = newId("evt", T, random);
  const device = { deviceId, userId: ana.id, platform: "ios", environment: "production" };
  const plan = (now = T) =>
    run(
      store,
      NOTIFIER_ACTOR,
      "delivery.plan",
      { incidentId, eventId, page: null, devices: [device] },
      now,
    );
  return {
    store,
    incidentId,
    deviceId,
    eventId,
    plan,
    id: deliveryId(incidentId, eventId, deviceId),
  };
}

describe("delivery ids", () => {
  test("round-trip, and refuse anything but inc:evt:dev", () => {
    const inc = newId("inc", T, random);
    const evt = newId("evt", T, random);
    const dev = newId("dev", T, random);
    expect(parseDeliveryId(deliveryId(inc, evt, dev))).toEqual({
      incidentId: inc,
      eventId: evt,
      deviceId: dev,
    });
    for (const bad of [`${inc}:${evt}`, `${evt}:${inc}:${dev}`, `${inc}:${evt}:${dev}:x`, 42, ""]) {
      expect(parseDeliveryId(bad)).toBeUndefined();
    }
  });
});

describe("delivery.plan, report and confirm", () => {
  test(`an incident keeps each device's latest ${MAX_DELIVERIES_PER_DEVICE} rows`, () => {
    const { store, incidentId, deviceId } = setup();
    const other = newId("dev", T, random);
    const device = (id: string) => ({
      deviceId: id,
      userId: ana.id,
      platform: "ios",
      environment: "production",
    });
    const events: string[] = [];
    const page = (devices: string[], now: number) => {
      const eventId = newId("evt", now, random);
      events.push(eventId);
      return run(
        store,
        NOTIFIER_ACTOR,
        "delivery.plan",
        { incidentId, eventId, page: null, devices: devices.map(device) },
        now,
      );
    };
    // The other device is on the first page only: it keeps that row however often this one is paged.
    page([deviceId, other], T);
    for (let i = 1; i < MAX_DELIVERIES_PER_DEVICE; i++) page([deviceId], T + i * 60_000);
    const rows = () => store.scan("deliveries").filter((row) => row.deviceId === deviceId);
    expect(rows()).toHaveLength(MAX_DELIVERIES_PER_DEVICE);

    const over = page([deviceId], T + MAX_DELIVERIES_PER_DEVICE * 60_000);
    expect(over).toMatchObject({
      ok: true,
      events: [{ type: "notification.planned", data: { devices: 1, dropped: 1 } }],
    });
    expect(rows()).toHaveLength(MAX_DELIVERIES_PER_DEVICE);
    // The oldest went; the newest is there.
    expect(store.get("deliveries", deliveryId(incidentId, events[0]!, deviceId))).toBeUndefined();
    expect(store.get("deliveries", deliveryId(incidentId, events.at(-1)!, deviceId))).toBeDefined();
    expect(store.get("deliveries", deliveryId(incidentId, events[0]!, other))).toBeDefined();
  });

  test("are server only", () => {
    for (const name of ["delivery.plan", "delivery.report", "delivery.confirm"]) {
      expect(Object.keys(mutations)).not.toContain(name);
      expect(Object.keys(serverMutations)).toContain(name);
    }
  });

  test("a page goes planned, sent, accepted, delivered, each with its time", () => {
    const { store, incidentId, eventId, deviceId, plan, id } = setup();
    expect(plan()).toMatchObject({
      ok: true,
      events: [{ type: "notification.planned", data: { incidentId, eventId, devices: 1 } }],
    });
    expect(deliveryStage(store.get("deliveries", id)!)).toBe("planned");

    const report = run(
      store,
      NOTIFIER_ACTOR,
      "delivery.report",
      {
        incidentId,
        eventId,
        outcomes: [{ deviceId, ok: true, error: null, reason: null, ms: 400 }],
      },
      T + 1000,
    );
    expect(report).toMatchObject({
      ok: true,
      events: [{ type: "notification.sent", data: { accepted: 1, failed: 0 } }],
    });
    expect(store.get("deliveries", id)).toMatchObject({
      plannedAt: T,
      sentAt: T + 600,
      acceptedAt: T + 1000,
      attempts: 1,
      error: null,
    });

    const confirmed = run(store, NOTIFIER_ACTOR, "delivery.confirm", { id }, T + 2000);
    expect(confirmed).toMatchObject({
      ok: true,
      events: [
        {
          type: "notification.delivered",
          subject: incidentId,
          data: { incidentId, eventId, userId: ana.id, deviceId },
        },
      ],
    });
    expect(deliveryStage(store.get("deliveries", id)!)).toBe("delivered");
    // The receipt is the latest sign the phone was online.
    expect(store.get("member_devices", deviceId)?.lastSeenAt).toBe(T + 2000);
  });

  test("a report that lands after the phone's receipt never stamps sent or accepted after delivered", () => {
    const { store, incidentId, eventId, deviceId, plan, id } = setup();
    plan();
    // The phone posts its receipt while a slow device in the same send holds the report back.
    run(store, NOTIFIER_ACTOR, "delivery.confirm", { id }, T + 1000);
    run(
      store,
      NOTIFIER_ACTOR,
      "delivery.report",
      {
        incidentId,
        eventId,
        outcomes: [{ deviceId, ok: true, error: null, reason: null, ms: 200 }],
      },
      T + 10_000,
    );
    const row = store.get("deliveries", id)!;
    expect(row.sentAt).toBeLessThanOrEqual(row.deliveredAt!);
    expect(row.acceptedAt).toBeLessThanOrEqual(row.deliveredAt!);
    expect(deliveryStage(row)).toBe("delivered");
  });

  test("a retry keeps the first plan; a second receipt changes nothing", () => {
    const { store, plan, id } = setup();
    plan();
    expect(plan(T + 5000)).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("deliveries", id)?.plannedAt).toBe(T);
    run(store, NOTIFIER_ACTOR, "delivery.confirm", { id }, T + 1000);
    expect(run(store, NOTIFIER_ACTOR, "delivery.confirm", { id }, T + 9000)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(store.get("deliveries", id)?.deliveredAt).toBe(T + 1000);
  });

  test("a failed attempt keeps its error and APNs' reason; a later success clears it", () => {
    const { store, incidentId, eventId, deviceId, plan, id } = setup();
    plan();
    const outcome = { deviceId, ok: false, error: "apns_refused", reason: "BadDeviceToken", ms: 0 };
    run(store, NOTIFIER_ACTOR, "delivery.report", { incidentId, eventId, outcomes: [outcome] });
    expect(store.get("deliveries", id)).toMatchObject({
      attempts: 1,
      acceptedAt: null,
      error: "apns_refused",
      reason: "BadDeviceToken",
    });
    run(store, NOTIFIER_ACTOR, "delivery.report", {
      incidentId,
      eventId,
      outcomes: [{ ...outcome, ok: true, error: null, reason: null }],
    });
    expect(store.get("deliveries", id)).toMatchObject({ attempts: 2, error: null, reason: null });
  });

  test("refuses unplanned devices, unknown deliveries and malformed reasons", () => {
    const { store, incidentId, eventId, deviceId, id } = setup();
    expect(
      run(store, NOTIFIER_ACTOR, "delivery.report", {
        incidentId,
        eventId,
        outcomes: [{ deviceId, ok: true, error: null, reason: null, ms: 0 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(run(store, NOTIFIER_ACTOR, "delivery.confirm", { id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      run(store, NOTIFIER_ACTOR, "delivery.report", {
        incidentId,
        eventId,
        outcomes: [{ deviceId, ok: false, error: "relay_refused", reason: "<b>", ms: 0 }],
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(
      run(store, NOTIFIER_ACTOR, "delivery.confirm", { id: "inc_x:evt_y:dev_z" }),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });

  test("members read an incident's deliveries and every device summary, never a token", () => {
    const { store, incidentId, plan } = setup();
    plan();
    const rows = evaluateQuery(incidentDeliveries, { id: incidentId }, store);
    expect(rows).toHaveLength(1);
    const devices = evaluateQuery(allDevices, {}, store);
    expect(devices).toEqual([
      expect.objectContaining({
        userId: ana.id,
        platform: "ios",
        environment: "production",
        voip: false,
      }),
    ]);
    expect(JSON.stringify([rows, devices])).not.toContain("aaaa");
    expect(JSON.stringify([rows, devices])).not.toContain(KEY);
  });
});

describe("call rows (RFC 0010)", () => {
  test("a device the page rings gets a call row next to its push's, reported on its own", () => {
    const { store, incidentId, deviceId, eventId, id } = setup();
    const device = { deviceId, userId: ana.id, platform: "ios", environment: "production" };
    const planned = run(store, NOTIFIER_ACTOR, "delivery.plan", {
      incidentId,
      eventId,
      page: null,
      devices: [{ ...device, call: true }],
    });
    expect(planned.ok && planned.events[0]?.data).toMatchObject({ devices: 1, calls: 1 });
    const callId = callDeliveryId(incidentId, eventId, deviceId);
    expect(callId).toBe(`${id}:call`);
    // A receipt can never confirm a call.
    expect(parseDeliveryId(callId)).toBeUndefined();
    expect(store.get("deliveries", callId)).toMatchObject({ kind: "call", sentAt: null });
    expect(store.get("deliveries", id)?.kind).toBeUndefined();

    const reported = run(
      store,
      NOTIFIER_ACTOR,
      "delivery.report",
      {
        incidentId,
        eventId,
        outcomes: [
          { deviceId, ok: true, error: null, reason: null, ms: 40 },
          {
            deviceId,
            ok: false,
            error: "token_invalid",
            reason: "BadDeviceToken",
            ms: 30,
            kind: "call",
          },
        ],
      },
      T + 1000,
    );
    expect(reported.ok && reported.events[0]?.data).toEqual({
      incidentId,
      eventId,
      accepted: 1,
      failed: 0,
      calls: { accepted: 0, failed: 1 },
    });
    expect(store.get("deliveries", id)).toMatchObject({ error: null, acceptedAt: T + 1000 });
    expect(store.get("deliveries", callId)).toMatchObject({
      error: "token_invalid",
      reason: "BadDeviceToken",
      acceptedAt: null,
      attempts: 1,
    });
    expect(isCallDelivery(store.get("deliveries", callId)!)).toBe(true);
    expect(run(store, NOTIFIER_ACTOR, "delivery.confirm", { id: callId })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });

  test(`calls count apart: each kind keeps its own latest ${MAX_DELIVERIES_PER_DEVICE} rows`, () => {
    const { store, incidentId, deviceId } = setup();
    const device = { deviceId, userId: ana.id, platform: "ios", environment: "production" };
    for (let i = 0; i < MAX_DELIVERIES_PER_DEVICE + 2; i++) {
      run(
        store,
        NOTIFIER_ACTOR,
        "delivery.plan",
        {
          incidentId,
          eventId: newId("evt", T + i, random),
          page: null,
          devices: [{ ...device, call: i % 2 === 0 }],
        },
        T + i,
      );
    }
    const rows = store.scan("deliveries");
    expect(rows.filter((row) => !isCallDelivery(row))).toHaveLength(MAX_DELIVERIES_PER_DEVICE);
    expect(rows.filter(isCallDelivery)).toHaveLength(
      Math.min(MAX_DELIVERIES_PER_DEVICE, Math.ceil((MAX_DELIVERIES_PER_DEVICE + 2) / 2)),
    );
  });
});

describe("device summaries", () => {
  const register = (
    store: MemoryStore<BrigadeTables>,
    id: string,
    token = "a".repeat(64),
    now = T,
  ) =>
    run(
      store,
      ana,
      "device.register",
      {
        id,
        platform: "ios",
        environment: "sandbox",
        pushToken: token,
        voipToken: null,
        publicKey: KEY,
      },
      now,
    );

  test("follow registering, re-registering and unregistering", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = newId("dev", T, random);
    register(store, id);
    expect(store.get("member_devices", id)).toEqual({
      id,
      userId: ana.id,
      platform: "ios",
      environment: "sandbox",
      voip: false,
      registeredAt: T,
      lastSeenAt: T,
    });
    register(store, id, "b".repeat(64), T + 60_000);
    expect(store.get("member_devices", id)).toMatchObject({
      registeredAt: T,
      lastSeenAt: T + 60_000,
    });
    run(store, ana, "device.unregister", { id });
    expect(store.get("member_devices", id)).toBeUndefined();
  });

  test("a device registered before summaries gets one on its next registration", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = newId("dev", T, random);
    register(store, id);
    store.delete("member_devices", id);
    expect(register(store, id, "a".repeat(64), T + 1000)).toMatchObject({
      ok: true,
      events: [{ type: "device.registered" }],
    });
    expect(store.get("member_devices", id)?.lastSeenAt).toBe(T + 1000);
    expect(register(store, id)).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("go with the device when APNs drops it or its member is removed", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = newId("dev", T, random);
    register(store, id);
    run(store, NOTIFIER_ACTOR, "device.expire", { id, pushToken: "a".repeat(64) });
    expect(store.get("member_devices", id)).toBeUndefined();

    const again = newId("dev", T, random);
    run(store, ana, "member.sync", { id: ana.id, name: "Ana", role: "responder" });
    register(store, again);
    run(store, { kind: "system", id: "sys_members", role: "owner" }, "member.remove", {
      id: ana.id,
      role: "responder",
      reason: "removed",
    });
    expect(store.get("member_devices", again)).toBeUndefined();
  });
});
