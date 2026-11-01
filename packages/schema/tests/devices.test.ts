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

  test("a phone that confirmed a page lately is kept over one only registered lately", () => {
    const store = createMemoryStore<BrigadeTables>();
    const at = (now: number, input: unknown) =>
      runMutation(serverMutations, "device.register", input, store, {
        actor: ana,
        now,
        server: true,
      });
    const ids: string[] = [];
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i++) {
      const id = deviceId();
      ids.push(id);
      expect(at(T + i * 1000, args(id, { pushToken: i.toString(16).padStart(64, "0") })).ok).toBe(
        true,
      );
    }
    // The oldest registration is the on-call phone nobody opens, but a page reached it after every other registration.
    store.update("member_devices", ids[0]!, { lastSeenAt: T + 60_000 });
    const newest = deviceId();
    const result = at(T + 120_000, args(newest, { pushToken: "f".repeat(64) }));
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "device.unregistered", subject: ids[1] }, { type: "device.registered" }],
    });
    expect(store.get("devices", ids[0]!)).toBeDefined();
  });

  test(`a new device over ${MAX_DEVICES_PER_MEMBER} replaces the member's least recently registered one`, () => {
    const store = createMemoryStore<BrigadeTables>();
    const at = (now: number, actor: Actor, input: unknown) =>
      runMutation(serverMutations, "device.register", input, store, { actor, now, server: true });
    const ids: string[] = [];
    for (let i = 0; i < MAX_DEVICES_PER_MEMBER; i++) {
      const id = deviceId();
      ids.push(id);
      const token = i.toString(16).padStart(64, "0");
      expect(at(T + i * 1000, ana, args(id, { pushToken: token })).ok).toBe(true);
    }
    // Bia's devices are never Ana's to replace.
    const theirs = deviceId();
    expect(
      at(T, { ...bia, role: "responder" }, args(theirs, { pushToken: "e".repeat(64) })).ok,
    ).toBe(true);
    // The first one registered again since: the second is now the least recently registered.
    expect(
      runMutation(serverMutations, "device.touch", { id: ids[0]! }, store, {
        actor: ana,
        now: T + 60_000,
        server: true,
      }),
    ).toEqual({ ok: true, events: [] });
    const newest = deviceId();
    const result = at(T + 120_000, ana, args(newest, { pushToken: "f".repeat(64) }));
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: "device.unregistered",
          subject: ids[1],
          data: { id: ids[1], userId: "usr_ana", reason: "replaced" },
        },
        { type: "device.registered", subject: newest },
      ],
    });
    const anas = store.scan("devices").filter((device) => device.userId === "usr_ana");
    expect(anas).toHaveLength(MAX_DEVICES_PER_MEMBER);
    expect(anas.map((device) => device.id)).toContain(newest);
    expect(anas.map((device) => device.id)).not.toContain(ids[1]);
    expect(store.get("member_devices", ids[1])).toBeUndefined();
    expect(store.get("devices", theirs)).toBeDefined();
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

  test("a client's optimistic run takes only the member's own phone off their list", () => {
    const store = createMemoryStore<BrigadeTables>();
    const mine = deviceId();
    const theirs = deviceId();
    run(store, ana, "device.register", args(mine));
    run(store, bia, "device.register", args(theirs, { pushToken: "c".repeat(64) }));
    expect(run(store, ana, "device.unregister", { id: mine }, false)).toMatchObject({ ok: true });
    expect(store.get("member_devices", mine)).toBeUndefined();
    // The server answers for another member's phone (`not_found`); the client leaves their summary alone.
    run(store, ana, "device.unregister", { id: theirs }, false);
    expect(store.get("member_devices", theirs)).toMatchObject({ userId: "usr_bia" });
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

// RFC 0015 section 7: a phone named to the relay by a handle and its tag, never by a token the instance sees.
describe("devices with a relay handle", () => {
  const HANDLE = `k1.${"h".repeat(120)}`;
  const OTHER_HANDLE = `k1.${"j".repeat(120)}`;
  const TAG = `${"t".repeat(42)}A`;
  const OTHER_TAG = `${"u".repeat(42)}w`;
  const handleArgs = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    platform: "ios",
    environment: "production",
    handle: HANDLE,
    tag: TAG,
    publicKey: KEY,
    ...overrides,
  });

  test("registers with a handle alone, can say it rings and opens envelope 2; no token is stored", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    const result = run(store, ana, "device.register", handleArgs(id, { voip: true, envelope: 2 }));
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "device.registered", data: { id, voip: true } }],
    });
    expect(JSON.stringify(result)).not.toContain(HANDLE);
    expect(JSON.stringify(result)).not.toContain(TAG);
    expect(store.get("devices", id)).toMatchObject({
      pushToken: null,
      voipToken: null,
      handle: HANDLE,
      tag: TAG,
      voip: true,
      envelope: 2,
    });
    expect(store.get("member_devices", id)?.voip).toBe(true);
    // The same again changes nothing; a new handle (re-sealed) or a change of `voip` refreshes it.
    expect(
      run(store, ana, "device.register", handleArgs(id, { voip: true, envelope: 2 })),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      run(store, ana, "device.register", handleArgs(id, { handle: OTHER_HANDLE, envelope: 2 })).ok,
    ).toBe(true);
    expect(store.get("devices", id)).toMatchObject({ handle: OTHER_HANDLE, voip: false });
    expect(store.get("member_devices", id)?.voip).toBe(false);
  });

  test("a phone that moves from raw tokens to a handle keeps nothing of its tokens, and back", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id, { voipToken: "b".repeat(64) }));
    expect(run(store, ana, "device.register", handleArgs(id)).ok).toBe(true);
    expect(store.get("devices", id)).toMatchObject({ pushToken: null, voipToken: null });
    expect(run(store, ana, "device.register", args(id)).ok).toBe(true);
    expect(store.get("devices", id)).toMatchObject({
      pushToken: "a".repeat(64),
      handle: null,
      tag: null,
      envelope: null,
    });
    // An instance moving (RFC 0015 section 9): both at once.
    expect(
      run(store, ana, "device.register", handleArgs(id, { pushToken: "a".repeat(64) })).ok,
    ).toBe(true);
    expect(store.get("devices", id)).toMatchObject({ pushToken: "a".repeat(64), handle: HANDLE });
  });

  test("refuses neither a token nor a handle, a handle without its tag, and voip or a VoIP token out of place", () => {
    const store = createMemoryStore<BrigadeTables>();
    for (const input of [
      handleArgs(deviceId(), { handle: undefined, tag: undefined }),
      handleArgs(deviceId(), { tag: undefined }),
      handleArgs(deviceId(), { handle: undefined }),
      handleArgs(deviceId(), { voipToken: "b".repeat(64) }),
      args(deviceId(), { voip: true }),
      handleArgs(deviceId(), { handle: "no-key-id" }),
      handleArgs(deviceId(), { tag: "short" }),
      // Not canonical: the last character's 2 unused bits are set (the same bytes as a tag ending in "A").
      handleArgs(deviceId(), { tag: `${"t".repeat(42)}B` }),
      handleArgs(deviceId(), { envelope: 1 }),
    ]) {
      expect(run(store, ana, "device.register", input), JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { code: "invalid_args" },
      });
    }
  });

  test("the same tag under a new id (a reinstall) replaces the old device; a raw token never matches a tag", () => {
    const store = createMemoryStore<BrigadeTables>();
    const old = deviceId();
    const raw = deviceId();
    run(store, ana, "device.register", handleArgs(old));
    run(store, ana, "device.register", args(raw));
    const fresh = deviceId();
    const result = run(store, ana, "device.register", handleArgs(fresh, { handle: OTHER_HANDLE }));
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "device.unregistered", data: { id: old, reason: "unregistered" } },
        { type: "device.registered", data: { id: fresh } },
      ],
    });
    expect(store.get("devices", old)).toBeUndefined();
    expect(store.get("devices", raw)).toBeDefined();
  });

  test("device.expire by handle drops the device, unless it registered again since, even with the same tag", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", handleArgs(id));
    // The phone registered again mid-flight: the same token (so the same tag), a newly sealed handle.
    run(store, ana, "device.register", handleArgs(id, { handle: OTHER_HANDLE }));
    expect(run(store, NOTIFIER_ACTOR, "device.expire", { id, handle: HANDLE })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(store.get("devices", id)?.handle).toBe(OTHER_HANDLE);
    expect(run(store, NOTIFIER_ACTOR, "device.expire", { id, handle: OTHER_HANDLE })).toMatchObject(
      {
        ok: true,
        events: [{ type: "device.unregistered", data: { id, reason: "token_invalid" } }],
      },
    );
    // Exactly one of the token and the handle; handleOnly only with the handle.
    for (const input of [
      { id, handle: HANDLE, pushToken: "a".repeat(64) },
      { id },
      { id, pushToken: "a".repeat(64), handleOnly: true },
      { id, tag: TAG },
    ]) {
      expect(
        run(store, NOTIFIER_ACTOR, "device.expire", input),
        JSON.stringify(input),
      ).toMatchObject({
        ok: false,
        error: { code: "invalid_args" },
      });
    }
  });

  test("device.expire with handleOnly keeps a device's raw token and drops only its handle", () => {
    const store = createMemoryStore<BrigadeTables>();
    const both = deviceId();
    const alone = deviceId();
    run(
      store,
      ana,
      "device.register",
      handleArgs(both, { pushToken: "a".repeat(64), voipToken: "b".repeat(64), voip: true }),
    );
    run(store, ana, "device.register", handleArgs(alone, { handle: OTHER_HANDLE, tag: OTHER_TAG }));
    expect(
      run(store, NOTIFIER_ACTOR, "device.expire", { id: both, handle: HANDLE, handleOnly: true }),
    ).toMatchObject({
      ok: true,
      events: [{ type: "device.handle_cleared", data: { id: both, reason: "handle_not_yours" } }],
    });
    expect(store.get("devices", both)).toMatchObject({
      pushToken: "a".repeat(64),
      voipToken: "b".repeat(64),
      handle: null,
      tag: null,
      voip: false,
    });
    // It still rings through its PushKit token.
    expect(store.get("member_devices", both)?.voip).toBe(true);
    // A device with the handle alone has nothing left: dropped.
    expect(
      run(store, NOTIFIER_ACTOR, "device.expire", {
        id: alone,
        handle: OTHER_HANDLE,
        handleOnly: true,
      }),
    ).toMatchObject({ ok: true, events: [{ type: "device.unregistered" }] });
    expect(store.get("devices", alone)).toBeUndefined();
  });

  test("envelope: a later version than 2 is stored as 2; under 2 is refused", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    expect(run(store, ana, "device.register", handleArgs(id, { envelope: 3 })).ok).toBe(true);
    expect(store.get("devices", id)?.envelope).toBe(2);
    // However far ahead the app is.
    const later = deviceId();
    expect(
      run(store, ana, "device.register", handleArgs(later, { envelope: 1001, tag: OTHER_TAG })).ok,
    ).toBe(true);
    expect(store.get("devices", later)?.envelope).toBe(2);
    expect(store.get("devices", id)?.envelope).toBe(2);
    expect(run(store, ana, "device.register", handleArgs(id, { envelope: 2 }))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    for (const envelope of [1, 0, 2.5, "2"]) {
      expect(
        run(store, ana, "device.register", handleArgs(deviceId(), { envelope })),
      ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    }
  });

  test("device.expireVoip of a raw PushKit token keeps a handle device ringing through its handle, and says so", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(
      store,
      ana,
      "device.register",
      handleArgs(id, { pushToken: "a".repeat(64), voipToken: "b".repeat(64), voip: true }),
    );
    expect(
      run(store, NOTIFIER_ACTOR, "device.expireVoip", { id, voipToken: "b".repeat(64) }).ok,
    ).toBe(true);
    expect(store.get("devices", id)).toMatchObject({ voipToken: null, voip: true });
    expect(store.get("member_devices", id)?.voip).toBe(true);
  });

  test("device.expireVoip by handle stops the device ringing, unless it registered again since", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", handleArgs(id, { voip: true }));
    expect(run(store, NOTIFIER_ACTOR, "device.expireVoip", { id, handle: HANDLE })).toMatchObject({
      ok: true,
      events: [{ type: "device.voip_cleared" }],
    });
    expect(store.get("devices", id)).toMatchObject({ voip: false, handle: HANDLE });
    expect(store.get("member_devices", id)?.voip).toBe(false);
    // Rings again once registered so; a call to the handle from before is then no reason to stop it.
    run(store, ana, "device.register", handleArgs(id, { handle: OTHER_HANDLE, voip: true }));
    expect(run(store, NOTIFIER_ACTOR, "device.expireVoip", { id, handle: HANDLE })).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(store.get("devices", id)?.voip).toBe(true);
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
    expect(store.get("member_devices", id)?.lastSeenAt).toBe(T);
  });

  test("moves the summary's `lastSeenAt`, so the dashboard's \"last heard from\" is the registration that changed nothing", () => {
    const store = createMemoryStore<BrigadeTables>();
    const id = deviceId();
    run(store, ana, "device.register", args(id));
    expect(store.get("member_devices", id)?.lastSeenAt).toBe(T);
    expect(touch(store, ana, { id }, T + 60_000).ok).toBe(true);
    expect(store.get("member_devices", id)?.lastSeenAt).toBe(T + 60_000);
    // Another member's touch moves nothing.
    expect(touch(store, bia, { id }, T + 120_000).ok).toBe(false);
    expect(store.get("member_devices", id)?.lastSeenAt).toBe(T + 60_000);
  });
});
