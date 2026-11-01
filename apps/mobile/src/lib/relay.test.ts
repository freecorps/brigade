// Relay handles on the phone (RFC 0015 sections 2, 5 and 7; Q30, Q32): which relay, when a new handle is asked for,
// and the raw-token fallback that keeps a phone on today's instance paged.
import { describe, expect, test } from "vite-plus/test";
import type { DeviceRegistration } from "./device";
import {
  buildRelay,
  FREECORPS_BRIGADE,
  FREECORPS_RELAY,
  HANDLE_MAX_AGE_MS,
  handleRequest,
  handleServes,
  loadConfig,
  parseConfig,
  parseHandleRecord,
  relayPlan,
  withHandle,
  type HandleDeps,
  type HandleRecord,
  type InstanceConfig,
} from "./relay";

const INSTANCE = `ins_${"a".repeat(22)}`;
const OTHER_INSTANCE = `ins_${"b".repeat(22)}`;
const RELAY = "https://relay.example.com";
const HANDLE = `k1.${"h".repeat(40)}`;
const NEW_HANDLE = `k2.${"n".repeat(40)}`;
const TAG = `${"t".repeat(42)}A`;
const NOW = Date.UTC(2026, 10, 1);
const KEY = `BA${"abcdefghij".repeat(9).slice(0, 85)}`;

const relay = { origin: RELAY, instance: INSTANCE };
const withRelay: InstanceConfig = { kind: "brigade", versioned: true, relay };

function registration(over: Partial<DeviceRegistration> = {}): DeviceRegistration {
  return {
    id: "dev_00000000000000000000000000",
    platform: "ios",
    environment: "production",
    pushToken: "ab".repeat(32),
    voipToken: "cd".repeat(32),
    publicKey: KEY,
    ...over,
  };
}

describe("what /config says", () => {
  test("a relay needs an http(s) origin and an instance id; anything else is no relay", () => {
    expect(
      parseConfig({ brigade: { api: 1 }, relay: { origin: `${RELAY}/x`, instance: INSTANCE } }),
    ).toEqual({ kind: "brigade", versioned: true, relay });
    expect(parseConfig({ relay: { origin: RELAY, instance: "nope" } })).toEqual({
      kind: "brigade",
      versioned: false,
    });
    expect(parseConfig({ relay: { origin: "ftp://x", instance: INSTANCE } }).kind).toBe("brigade");
    expect(parseConfig({ signUp: "open" })).toEqual({ kind: "brigade", versioned: false });
    expect(parseConfig(null)).toEqual({ kind: "unreachable" });
    expect(
      parseConfig({ relay: { ...relay, app: "https://apps.example.com/brigade" } }),
    ).toMatchObject({ relay: { app: "https://apps.example.com/brigade" } });
    expect(parseConfig({ relay: { ...relay, app: "javascript:x" } })).toMatchObject({ relay });
  });

  test("no answer, an error or not JSON is unreachable", async () => {
    expect(
      await loadConfig("https://brigade.test/api/config", async () => {
        throw new TypeError("offline");
      }),
    ).toEqual({ kind: "unreachable" });
    expect(
      await loadConfig("https://brigade.test/api/config", async () => ({
        ok: false,
        json: async () => ({}),
      })),
    ).toEqual({ kind: "unreachable" });
  });
});

describe("this build's relay (Q32)", () => {
  const config = (value: InstanceConfig) => async () => value;
  test("the variable wins, as an origin", async () => {
    expect(
      await buildRelay({
        env: " https://relay.acme.example/v1 ",
        defaultOrigin: FREECORPS_BRIGADE,
        defaultConfig: config(withRelay),
      }),
    ).toBe("https://relay.acme.example");
  });

  test("the store build (Freecorps' Brigade, or none) is paged through Freecorps' relay", async () => {
    let asked = 0;
    const counted = async (): Promise<InstanceConfig> => {
      asked += 1;
      return withRelay;
    };
    expect(
      await buildRelay({
        env: undefined,
        defaultOrigin: FREECORPS_BRIGADE,
        defaultConfig: counted,
      }),
    ).toBe(FREECORPS_RELAY);
    expect(await buildRelay({ env: "", defaultOrigin: undefined, defaultConfig: counted })).toBe(
      FREECORPS_RELAY,
    );
    expect(asked).toBe(0);
  });

  test("a company's build takes its own instance's relay, unknown until that /config answers", async () => {
    const acme = "https://brigade.acme.example";
    expect(
      await buildRelay({ env: undefined, defaultOrigin: acme, defaultConfig: config(withRelay) }),
    ).toBe(RELAY);
    expect(
      await buildRelay({
        env: undefined,
        defaultOrigin: acme,
        defaultConfig: config({ kind: "unreachable" }),
      }),
    ).toBeUndefined();
    expect(
      await buildRelay({
        env: undefined,
        defaultOrigin: acme,
        defaultConfig: config({ kind: "brigade", versioned: true }),
      }),
    ).toBeUndefined();
  });
});

describe("how to register with an instance", () => {
  test("no relay, or no /config: raw tokens", () => {
    expect(relayPlan({ kind: "brigade", versioned: true }, FREECORPS_RELAY, false)).toEqual({
      kind: "raw",
    });
    expect(relayPlan({ kind: "unreachable" }, FREECORPS_RELAY, true)).toEqual({ kind: "raw" });
  });

  test("this build's relay: a handle; another relay: foreign, never for the build's own instance", () => {
    expect(relayPlan(withRelay, RELAY, false)).toEqual({ kind: "relay", relay });
    expect(relayPlan(withRelay, FREECORPS_RELAY, false)).toEqual({ kind: "foreign", relay });
    expect(relayPlan(withRelay, FREECORPS_RELAY, true)).toEqual({ kind: "relay", relay });
    // This build's relay not known yet: another instance gets the raw tokens, as before handles.
    expect(relayPlan(withRelay, undefined, false)).toEqual({ kind: "raw" });
    expect(relayPlan(withRelay, undefined, true)).toEqual({ kind: "relay", relay });
  });

  test("what the relay seals: Android sends no VoIP token, its calls ring through FCM", () => {
    expect(handleRequest(relay, registration())).toEqual({
      instance: INSTANCE,
      platform: "ios",
      environment: "production",
      pushToken: "ab".repeat(32),
      voipToken: "cd".repeat(32),
    });
    expect(
      handleRequest(relay, registration({ platform: "android", voipToken: "ab".repeat(32) })),
    ).not.toHaveProperty("voipToken");
    expect(handleRequest(relay, registration({ voipToken: null }))).not.toHaveProperty("voipToken");
  });
});

describe("the kept handle (Q30)", () => {
  const want = handleRequest(relay, registration());
  const kept: HandleRecord = { ...want, relay: RELAY, handle: HANDLE, tag: TAG, at: NOW };

  test("serves while nothing it was sealed for changed and it is younger than 30 days", () => {
    expect(handleServes(kept, relay, want, NOW)).toBe(true);
    expect(handleServes(kept, relay, want, NOW + HANDLE_MAX_AGE_MS - 1)).toBe(true);
  });

  test.each([
    ["a new push token", { pushToken: "ef".repeat(32) }, {}],
    ["a new VoIP token", { voipToken: "ef".repeat(32) }, {}],
    ["a VoIP token that came later", {}, { voipToken: undefined }],
    ["the VoIP token withdrawn", { voipToken: undefined }, {}],
    ["another APNs environment", { environment: "sandbox" as const }, {}],
    ["another instance id at the relay", { instance: OTHER_INSTANCE }, {}],
  ])("asks for a new one on %s", (_, wanted, stored) => {
    const record = { ...kept, ...stored } as HandleRecord;
    if ("voipToken" in stored && stored.voipToken === undefined) delete record.voipToken;
    const request = { ...want, ...wanted };
    if ("voipToken" in wanted && wanted.voipToken === undefined) delete request.voipToken;
    const at = { ...relay, instance: request.instance };
    expect(handleServes(record, at, request, NOW)).toBe(false);
  });

  test("asks for a new one from another relay origin, and once it is 30 days old", () => {
    expect(handleServes(kept, { ...relay, origin: FREECORPS_RELAY }, want, NOW)).toBe(false);
    expect(handleServes(kept, relay, want, NOW + HANDLE_MAX_AGE_MS)).toBe(false);
    // A clock set back before it was given: asked again rather than kept forever.
    expect(handleServes(kept, relay, want, NOW - 1)).toBe(false);
    expect(handleServes(null, relay, want, NOW)).toBe(false);
  });

  test("a stored record that does not read is none", () => {
    expect(parseHandleRecord(JSON.stringify(kept))).toEqual(kept);
    expect(parseHandleRecord(JSON.stringify({ ...kept, handle: "x" }))).toBeNull();
    expect(parseHandleRecord("{")).toBeNull();
    expect(parseHandleRecord(null)).toBeNull();
  });
});

/** An instance and its relay in memory: `/config`'s answer, the kept handle, and what the relay was asked. */
function instance(over: Partial<HandleDeps> & { mint?: () => Promise<unknown> } = {}) {
  let stored: string | null = null;
  const minted: unknown[] = [];
  const deps: HandleDeps = {
    config: async () => withRelay,
    thisBuild: async () => RELAY,
    isDefault: false,
    read: async () => stored,
    write: async (raw) => {
      stored = raw;
    },
    fetch: async (url, init) => {
      minted.push({ url, body: JSON.parse(init.body as string) });
      const answer = over.mint ? await over.mint() : { handle: HANDLE, tag: TAG };
      return { ok: answer !== null, json: async () => answer };
    },
    now: () => NOW,
    ...over,
  };
  return { deps, minted, stored: () => stored, setStored: (raw: string | null) => (stored = raw) };
}

describe("registering with a handle", () => {
  test("asks the relay once, then sends the kept handle without the tokens", async () => {
    const at = instance();
    const first = await withHandle(registration(), at.deps);
    expect(first).toEqual({
      id: "dev_00000000000000000000000000",
      platform: "ios",
      environment: "production",
      publicKey: KEY,
      handle: HANDLE,
      tag: TAG,
      voip: true,
      envelope: 2,
    });
    expect(at.minted).toEqual([
      {
        url: `${RELAY}/v1/handles`,
        body: {
          instance: INSTANCE,
          platform: "ios",
          environment: "production",
          pushToken: "ab".repeat(32),
          voipToken: "cd".repeat(32),
        },
      },
    ]);
    // Launch, foreground, Try again: nothing changed, the same handle, the relay not asked.
    expect(await withHandle(registration(), at.deps)).toEqual(first);
    expect(at.minted).toHaveLength(1);
    // A new token: a new handle.
    await withHandle(registration({ pushToken: "ef".repeat(32) }), at.deps);
    expect(at.minted).toHaveLength(2);
  });

  test("a handle without a VoIP token cannot ring; Android rings through FCM when it has a call token", async () => {
    expect(await withHandle(registration({ voipToken: null }), instance().deps)).toMatchObject({
      voip: false,
    });
    const android = registration({
      platform: "android",
      pushToken: "f".repeat(140),
      voipToken: "f".repeat(140),
    });
    expect(await withHandle(android, instance().deps)).toMatchObject({ voip: true });
    expect(await withHandle({ ...android, voipToken: null }, instance().deps)).toMatchObject({
      voip: false,
    });
  });

  // A paging path (AGENTS.md): today's instance (no relay in /config) and a relay that does not answer keep the raw
  // tokens, as before handles.
  test("no relay in /config: the raw tokens, as today, with envelope 2 only for an instance that says its version", async () => {
    const versioned = instance({ config: async () => ({ kind: "brigade", versioned: true }) });
    expect(await withHandle(registration(), versioned.deps)).toEqual({
      ...registration(),
      envelope: 2,
    });
    const older = instance({ config: async () => ({ kind: "brigade", versioned: false }) });
    expect(await withHandle(registration(), older.deps)).toEqual(registration());
    expect(versioned.minted).toEqual([]);
  });

  test("a relay that refuses or does not answer: the raw tokens, nothing kept", async () => {
    for (const mint of [
      async () => null,
      async () => {
        throw new TypeError("offline");
      },
      async () => ({ handle: "bad", tag: TAG }),
    ]) {
      const at = instance({ mint });
      expect(await withHandle(registration(), at.deps)).toEqual({
        ...registration(),
        envelope: 2,
      });
      expect(at.stored()).toBeNull();
    }
  });

  test("an instance on another relay pages through its own app: nothing is registered", async () => {
    const at = instance({ thisBuild: async () => FREECORPS_RELAY });
    expect(await withHandle(registration(), at.deps)).toBe("foreign");
    expect(at.minted).toEqual([]);
    // The build's own instance is never foreign.
    const own = instance({ thisBuild: async () => FREECORPS_RELAY, isDefault: true });
    expect(await withHandle(registration(), own.deps)).toMatchObject({ handle: HANDLE });
  });

  test("/config not answering keeps the handle that still serves, else the raw tokens", async () => {
    const at = instance();
    await withHandle(registration(), at.deps);
    const offline = {
      ...at.deps,
      config: async (): Promise<InstanceConfig> => ({ kind: "unreachable" }),
    };
    expect(await withHandle(registration(), offline)).toMatchObject({ handle: HANDLE });
    expect(await withHandle(registration({ pushToken: "ef".repeat(32) }), offline)).toEqual(
      registration({ pushToken: "ef".repeat(32) }),
    );
  });

  test("a relay key rotation reaches the phone: a 30-day-old handle is asked for again", async () => {
    let now = NOW;
    let answer = { handle: HANDLE, tag: TAG };
    const at = instance({ now: () => now, mint: async () => answer });
    await withHandle(registration(), at.deps);
    answer = { handle: NEW_HANDLE, tag: TAG };
    now = NOW + HANDLE_MAX_AGE_MS;
    expect(await withHandle(registration(), at.deps)).toMatchObject({ handle: NEW_HANDLE });
    expect(at.minted).toHaveLength(2);
  });

  test("a relay or instance id that changed asks for a new handle", async () => {
    const at = instance();
    await withHandle(registration(), at.deps);
    const moved = {
      ...at.deps,
      config: async (): Promise<InstanceConfig> => ({
        kind: "brigade",
        versioned: true,
        relay: { origin: RELAY, instance: OTHER_INSTANCE },
      }),
    };
    await withHandle(registration(), moved);
    expect(at.minted).toHaveLength(2);
    expect(at.minted[1]).toMatchObject({ body: { instance: OTHER_INSTANCE } });
  });
});
