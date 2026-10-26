import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  MAX_DEVICES_PER_MEMBER,
  mutations,
  newId,
  NOTIFIER_ACTOR,
  ACCOUNT_ACTOR,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type MemoryStore,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
let seed = 0;
const random = (n: number) => new Uint8Array(n).fill(++seed % 256);
const deviceId = () => newId("dev", T, random);
const ana: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const bia: Actor = { kind: "user", id: "usr_bia", role: "viewer" };
// An uncompressed P-256 point's shape: 0x04 then 64 bytes, base64url.
const KEY = `B${"A".repeat(86)}`;
const OTHER_KEY = `B${"Q".repeat(86)}`;

const args = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  platform: "ios",
  environment: "sandbox",
  pushToken: "a".repeat(64),
  voipToken: null,
  publicKey: KEY,
  ...overrides,
});

function run(
  store: MemoryStore<BrigadeTables>,
  actor: Actor,
  name: string,
  input: unknown,
  server = true,
) {
  return runMutation(server ? serverMutations : mutations, name, input, store, {
    actor,
    now: T,
    server,
  });
}

describe("device.register", () => {
  test("stores the member's device server-side and announces it without tokens or key", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    const result = run(store, ana, "device.register", args(id, { voipToken: "b".repeat(64) }));
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "device.registered",
          subject: id,
          data: { id, userId: "usr_ana", platform: "ios", environment: "sandbox", voip: true },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("aaaa");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(store.get("devices", id)).toMatchObject({
      userId: "usr_ana",
      pushToken: "a".repeat(64),
      voipToken: "b".repeat(64),
      publicKey: KEY,
      registeredAt: T,
    });
  });

  test("every role may register its own devices, viewers included", () => {
    const store = createMemoryStore<BrigadeTables>();
    expect(run(store, bia, "device.register", args(deviceId())).ok).toBe(true);
  });

  test("a client's optimistic run writes nothing: the table is server-only", () => {
    const store = createMemoryStore<BrigadeTables>();
    expect(run(store, ana, "device.register", args(deviceId()), false).ok).toBe(true);
    expect(store.dump()).toEqual({});
  });

  test("another member cannot take over a device id", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    const result = run(
      store,
      { ...bia, role: "admin" },
      "device.register",
      args(id, { publicKey: OTHER_KEY }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(store.get("devices", id)?.publicKey).toBe(KEY);
  });

  test("a rotated key refreshes the device; the same values again are a conflict", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(run(store, ana, "device.register", args(id))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, ana, "device.register", args(id, { publicKey: OTHER_KEY })).ok).toBe(true);
    expect(store.get("devices", id)?.publicKey).toBe(OTHER_KEY);
  });

  test("the same token under a new id (a reinstall) replaces the old device", () => {
    const store = createMemoryStore<BrigadeTables>();
    const old = deviceId();
    const fresh = deviceId();
    run(store, ana, "device.register", args(old));
    const result = run(store, ana, "device.register", args(fresh, { publicKey: OTHER_KEY }));
    expect(result.ok && result.events.map((event) => event.type)).toEqual([
      "device.unregistered",
      "device.registered",
    ]);
    expect(store.scan("devices").map((device) => device.id)).toEqual([fresh]);
  });

  test(`at most ${MAX_DEVICES_PER_MEMBER} devices per member`, () => {
    const store = createMemoryStore<BrigadeTables>();
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i++) {
      const token = i.toString(16).padStart(64, "0");
      expect(run(store, ana, "device.register", args(deviceId(), { pushToken: token })).ok).toBe(
        true,
      );
    }
    expect(
      run(store, ana, "device.register", args(deviceId(), { pushToken: "f".repeat(64) })),
    ).toMatchObject({
      ok: false,
      error: { code: "limit_reached" },
    });
  });

  test("refuses malformed tokens and keys, and system actors", () => {
    const store = createMemoryStore<BrigadeTables>();
    for (const bad of [
      { pushToken: "short" },
      { pushToken: "a b".repeat(20) },
      { publicKey: "A".repeat(87) },
      { publicKey: KEY.slice(1) },
      { platform: "web" },
      { environment: "staging" },
    ]) {
      expect(run(store, ana, "device.register", args(deviceId(), bad))).toMatchObject({
        ok: false,
        error: { code: "invalid_args" },
      });
    }
    expect(run(store, NOTIFIER_ACTOR, "device.register", args(deviceId()))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});

describe("device.unregister and device.expire", () => {
  test("a member removes only their own device", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(run(store, bia, "device.unregister", { id })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(run(store, ana, "device.unregister", { id })).toEqual({
      ok: true,
      events: [
        {
          type: "device.unregistered",
          subject: id,
          data: { id, userId: "usr_ana", reason: "unregistered" },
        },
      ],
    });
    expect(store.get("devices", id)).toBeUndefined();
  });

  test("device.expire is server-only and records why", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(Object.keys(mutations)).not.toContain("device.expire");
    const result = run(store, NOTIFIER_ACTOR, "device.expire", { id, pushToken: "a".repeat(64) });
    expect(result.ok && result.events[0]?.data).toEqual({
      id,
      userId: "usr_ana",
      reason: "token_invalid",
    });
    expect(store.get("devices", id)).toBeUndefined();
  });

  test("device.expire keeps a device registered again with a new token while the push was out", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    // The page went to the old token; the app rotated it before APNs answered that the old one is gone.
    run(store, ana, "device.register", args(id, { pushToken: "b".repeat(64) }));
    expect(
      run(store, NOTIFIER_ACTOR, "device.expire", { id, pushToken: "a".repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("devices", id)?.pushToken).toBe("b".repeat(64));
  });
});

describe("notification.fail", () => {
  test("adds a page_failed entry to the incident's timeline and emits notification.failed", () => {
    const store = createMemoryStore<BrigadeTables>();
    const incident = newId("inc", T, random);
    run(store, ana, "incident.declare", { id: incident, title: "Checkout down", severity: "sev1" });
    const eventId = newId("evt", T, random);
    const result = run(store, NOTIFIER_ACTOR, "notification.fail", {
      incidentId: incident,
      eventId,
      userId: "usr_ana",
      reason: "undelivered",
    });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "notification.failed",
          subject: incident,
          data: {
            incidentId: incident,
            eventId,
            userId: "usr_ana",
            reason: "undelivered",
            channel: "push",
            schedule: null,
          },
        },
      ],
    });
    expect(store.get("timeline", `${incident}:2`)).toMatchObject({
      kind: "page_failed",
      actor: "sys_notifier",
      userId: "usr_ana",
      reason: "undelivered",
    });
    expect(Object.keys(mutations)).not.toContain("notification.fail");
  });
});

describe("device.signOut", () => {
  test("server only, as `ACCOUNT_ACTOR`: drops every device of the user, and only theirs", () => {
    const store = createMemoryStore<BrigadeTables>();
    const [one, two, other] = [deviceId(), deviceId(), deviceId()];
    run(store, ana, "device.register", args(one));
    run(
      store,
      ana,
      "device.register",
      args(two, { pushToken: "b".repeat(64), publicKey: OTHER_KEY }),
    );
    run(store, bia, "device.register", args(other, { pushToken: "c".repeat(64) }));
    expect(Object.keys(mutations)).not.toContain("device.signOut");
    expect(run(store, NOTIFIER_ACTOR, "device.signOut", { userId: "usr_ana" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    const result = run(store, ACCOUNT_ACTOR, "device.signOut", { userId: "usr_ana" });
    expect(result.ok && result.events.map((event) => event.data)).toEqual([
      { id: one, userId: "usr_ana", reason: "password_reset" },
      { id: two, userId: "usr_ana", reason: "password_reset" },
    ]);
    expect(store.get("devices", one)).toBeUndefined();
    expect(store.get("member_devices", two)).toBeUndefined();
    expect(store.get("devices", other)).toBeDefined();
    // Nothing left to drop.
    expect(run(store, ACCOUNT_ACTOR, "device.signOut", { userId: "usr_ana" })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });
});
