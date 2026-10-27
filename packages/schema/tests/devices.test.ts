import { describe, expect, test } from "vite-plus/test";
import {
  callChoiceOf,
  createMemoryStore,
  DEFAULT_CALL_CHOICE,
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

  test("Critical Alerts: optional for apps from before it, stored, and a change refreshes the device", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    // An app from before the capability sends no `criticalAlerts`: registered, read as not allowed.
    expect(run(store, ana, "device.register", args(id)).ok).toBe(true);
    expect(store.get("devices", id)?.criticalAlerts).toBe(false);
    expect(run(store, ana, "device.register", args(id, { criticalAlerts: false }))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, ana, "device.register", args(id, { criticalAlerts: true })).ok).toBe(true);
    expect(store.get("devices", id)?.criticalAlerts).toBe(true);
    // Turned off in Settings: the next registration says so.
    expect(run(store, ana, "device.register", args(id)).ok).toBe(true);
    expect(store.get("devices", id)?.criticalAlerts).toBe(false);
    expect(run(store, ana, "device.register", args(id, { criticalAlerts: "yes" }))).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });

  test("a device stored before Critical Alerts counts as not allowing them", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    const { criticalAlerts: _, ...old } = store.get("devices", id)!;
    store.delete("devices", id);
    store.insert("devices", old);
    expect(run(store, ana, "device.register", args(id))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
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

describe("device.expireVoip", () => {
  test("server only: clears a refused PushKit token, keeps the device and its alert token, and says so", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id, { voipToken: "b".repeat(64) }));
    expect(Object.keys(mutations)).not.toContain("device.expireVoip");
    const result = run(store, NOTIFIER_ACTOR, "device.expireVoip", {
      id,
      voipToken: "b".repeat(64),
    });
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "device.voip_cleared",
          subject: id,
          data: { id, userId: "usr_ana", reason: "token_invalid" },
        },
      ],
    });
    expect(store.get("devices", id)).toMatchObject({ pushToken: "a".repeat(64), voipToken: null });
    expect(store.get("member_devices", id)).toMatchObject({ voip: false });
    // Already cleared, and a device gone, change nothing.
    expect(
      run(store, NOTIFIER_ACTOR, "device.expireVoip", { id, voipToken: "b".repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      run(store, NOTIFIER_ACTOR, "device.expireVoip", {
        id: deviceId(),
        voipToken: "b".repeat(64),
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  test("keeps a PushKit token registered again while the call was out", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id, { voipToken: "b".repeat(64) }));
    run(store, ana, "device.register", args(id, { voipToken: "c".repeat(64) }));
    expect(
      run(store, NOTIFIER_ACTOR, "device.expireVoip", { id, voipToken: "b".repeat(64) }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("devices", id)?.voipToken).toBe("c".repeat(64));
  });
});

describe("member.setCalls", () => {
  test("every role sets their own; the same choice again is a conflict; a script never sets it", () => {
    const store = createMemoryStore<BrigadeTables>();
    expect(run(store, bia, "member.setCalls", { calls: "never" }, false)).toMatchObject({
      ok: true,
    });
    expect(run(store, ana, "member.setCalls", { calls: "sev1" })).toEqual({
      ok: true,
      events: [
        {
          type: "member.calls_changed",
          subject: "usr_ana",
          data: { userId: "usr_ana", calls: "sev1" },
        },
      ],
    });
    expect(store.get("member_settings", "usr_ana")).toMatchObject({ calls: "sev1" });
    expect(run(store, ana, "member.setCalls", { calls: "sev1" })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(run(store, ana, "member.setCalls", { calls: "never" })).toMatchObject({ ok: true });
    expect(callChoiceOf(store.scan("member_settings"), "usr_ana")).toBe("never");
    expect(callChoiceOf(store.scan("member_settings"), "usr_caio")).toBe(DEFAULT_CALL_CHOICE);
    const token: Actor = { kind: "token", id: "usr_ana", role: "owner" };
    expect(run(store, token, "member.setCalls", { calls: "sev1" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(run(store, ana, "member.setCalls", { calls: "always" })).toMatchObject({
      ok: false,
      error: { code: "invalid_args" },
    });
  });

  test("goes when the member leaves", () => {
    const store = createMemoryStore<BrigadeTables>();
    run(store, ana, "member.setCalls", { calls: "never" });
    run(store, ana, "member.remove", { id: "usr_ana", role: "responder", reason: "left" });
    expect(store.get("member_settings", "usr_ana")).toBeUndefined();
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

  test("with `before`, only the devices last registered before it", () => {
    const store = createMemoryStore<BrigadeTables>();
    const [old, fresh] = [deviceId(), deviceId()];
    run(store, ana, "device.register", args(old));
    run(
      store,
      ana,
      "device.register",
      args(fresh, { pushToken: "b".repeat(64), publicKey: OTHER_KEY }),
    );
    store.update("devices", fresh, { updatedAt: T + 10 });
    expect(
      run(store, ACCOUNT_ACTOR, "device.signOut", { userId: "usr_ana", before: T }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    const result = run(store, ACCOUNT_ACTOR, "device.signOut", {
      userId: "usr_ana",
      before: T + 1,
    });
    expect(result.ok && result.events.map((event) => event.data)).toEqual([
      { id: old, userId: "usr_ana", reason: "password_reset" },
    ]);
    expect(store.get("devices", fresh)).toBeDefined();
  });

  test("with `deviceId`, only that device of the user, as `unregistered` (a sign-out on that phone)", () => {
    const store = createMemoryStore<BrigadeTables>();
    const [phone, laptop, theirs] = [deviceId(), deviceId(), deviceId()];
    run(store, ana, "device.register", args(phone));
    run(
      store,
      ana,
      "device.register",
      args(laptop, { pushToken: "b".repeat(64), publicKey: OTHER_KEY }),
    );
    run(store, bia, "device.register", args(theirs, { pushToken: "c".repeat(64) }));
    const result = run(store, ACCOUNT_ACTOR, "device.signOut", {
      userId: "usr_ana",
      deviceId: phone,
    });
    expect(result.ok && result.events.map((event) => event.data)).toEqual([
      { id: phone, userId: "usr_ana", reason: "unregistered" },
    ]);
    expect(store.get("devices", laptop)).toBeDefined();
    // Another user's device is never theirs to drop.
    expect(
      run(store, ACCOUNT_ACTOR, "device.signOut", { userId: "usr_ana", deviceId: theirs }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("devices", theirs)).toBeDefined();
  });

  test("with `deviceId` and `before`, a phone its member registered again since the sign-out stays", () => {
    const store = createMemoryStore<BrigadeTables>();
    const phone = deviceId();
    run(store, ana, "device.register", args(phone));
    store.update("devices", phone, { updatedAt: T + 10 });
    expect(
      run(store, ACCOUNT_ACTOR, "device.signOut", {
        userId: "usr_ana",
        deviceId: phone,
        before: T,
      }),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("devices", phone)).toBeDefined();
    expect(
      run(store, ACCOUNT_ACTOR, "device.signOut", {
        userId: "usr_ana",
        deviceId: phone,
        before: T + 11,
      }).ok,
    ).toBe(true);
    expect(store.get("devices", phone)).toBeUndefined();
  });
});

describe("device.touch", () => {
  const touch = (store: MemoryStore<BrigadeTables>, actor: Actor, input: unknown, now: number) =>
    runMutation(serverMutations, "device.touch", input, store, { actor, now, server: true });

  test("server only: an unchanged device registered again is refreshed, with no event, so a late sign-out keeps it", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(Object.keys(mutations)).not.toContain("device.touch");
    // Registered again with nothing changed: still a conflict, and `touch` is what moves `updatedAt`.
    expect(run(store, ana, "device.register", args(id))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(touch(store, ana, { id, sessionId: "ses_one" }, T + 10)).toEqual({
      ok: true,
      events: [],
    });
    expect(store.get("devices", id)).toMatchObject({ updatedAt: T + 10, sessionId: "ses_one" });
    // A sign-out from before it, acted on only now, leaves the phone.
    expect(
      runMutation(
        serverMutations,
        "device.signOut",
        { userId: "usr_ana", deviceId: id, before: T + 5 },
        store,
        {
          actor: ACCOUNT_ACTOR,
          now: T + 20,
          server: true,
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.get("devices", id)).toBeDefined();
    // A change keeps the session it was registered with.
    run(store, ana, "device.register", args(id, { publicKey: OTHER_KEY }));
    expect(store.get("devices", id)?.sessionId).toBe("ses_one");
  });

  test("another member's device, or none, is `not_found`; never moves `updatedAt` back", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(touch(store, bia, { id }, T + 10)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(touch(store, ana, { id: deviceId() }, T + 10)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(touch(store, ana, { id }, T - 10).ok).toBe(true);
    expect(store.get("devices", id)?.updatedAt).toBe(T);
  });
});
