import {
  createMemoryStore,
  isId,
  MAX_DEVICES_PER_MEMBER,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type Store,
} from "@freecorps/brigade-schema";
import { createSyncClient, type SyncSocket } from "@freecorps/brigade-sync";
import { expect, test } from "vite-plus/test";
import {
  deviceId,
  deviceRegistration,
  instanceOrigin,
  pushEnvironment,
  registerEverywhere,
  registerPhone,
  registrationsLeft,
  unregisterPhone,
  type RegisterAnswer,
  VOIP_GRACE_MS,
  type DeviceDeps,
} from "./device";
import { neverOpened } from "./sync";

// An uncompressed P-256 point's shape (0x04 then 64 bytes), base64url.
const KEY = `BA${"abcdefghij".repeat(9).slice(0, 85)}`;
const ANA: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const BIA: Actor = { kind: "user", id: "usr_bia", role: "responder" };

test("the device id is stable for a key and differs between keys", () => {
  const id = deviceId(KEY);
  expect(isId("dev", id)).toBe(true);
  expect(deviceId(KEY)).toBe(id);
  expect(deviceId(`${KEY.slice(0, 5)}Z${KEY.slice(6)}`)).not.toBe(id);
});

test("local Xcode builds register sandbox tokens, EAS builds production ones", () => {
  expect(pushEnvironment("development")).toBe("sandbox");
  expect(pushEnvironment("production")).toBe("production");
  expect(pushEnvironment(undefined)).toBe("production");
});

/** The shard's own device mutations on one store, as `actor`. */
function shard(store: Store<BrigadeTables>) {
  return (actor: Actor): DeviceDeps["mutate"] =>
    async (name, args) => {
      const result = runMutation(serverMutations, name, args, store, {
        actor,
        now: Date.now(),
        server: true,
      });
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    };
}

function phone(mutate: DeviceDeps["mutate"], over: Partial<DeviceDeps> = {}): DeviceDeps {
  return {
    platform: "ios",
    apsEnvironment: "development",
    publicKey: async () => KEY,
    permission: async () => true,
    pushToken: async () => "ab".repeat(32),
    mutate,
    ...over,
  };
}

test("the registration is what the shard's device.register accepts", () => {
  const args = deviceRegistration({
    publicKey: KEY,
    pushToken: "ab".repeat(32),
    platform: "ios",
    apsEnvironment: "development",
  });
  expect(args).toMatchObject({ environment: "sandbox", voipToken: null, platform: "ios" });
  const result = runMutation(
    serverMutations,
    "device.register",
    args,
    createMemoryStore<BrigadeTables>(),
    { actor: ANA, now: Date.now(), server: true },
  );
  expect(result.ok).toBe(true);
});

test("signing in registers the phone, and signing in again changes nothing", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  expect(await registerPhone(phone(as(ANA)))).toBe("on");
  expect(await registerPhone(phone(as(ANA)))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ id: deviceId(KEY), userId: ANA.id }]);
});

test("an iPhone registers its PushKit token so pages can ring; without one, or on Android, it registers none", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  const voip = "cd".repeat(32);
  expect(await registerPhone(phone(as(ANA), { voipToken: async () => voip }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ voipToken: voip }]);
  expect(store.scan("member_devices")).toMatchObject([{ voip: true }]);

  // PushKit withdrew the token: registering again clears it, so the instance stops sending calls to it.
  expect(await registerPhone(phone(as(ANA), { voipToken: async () => null }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ voipToken: null }]);

  // A module that fails, or none at all: the phone is still paged, with alerts only.
  const failing = async (): Promise<string | null> => {
    throw new Error("no PushKit");
  };
  expect(await registerPhone(phone(as(ANA), { voipToken: failing }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ voipToken: null }]);

  const other = createMemoryStore<BrigadeTables>();
  expect(
    await registerPhone(
      phone(shard(other)(ANA), { platform: "android", voipToken: async () => voip }),
    ),
  ).toBe("on");
  expect(other.scan("devices")).toMatchObject([{ voipToken: null }]);
});

test("Critical Alerts are reported only when allowed, so an instance from before them still registers the phone", async () => {
  const base = { publicKey: KEY, pushToken: "ab".repeat(32), apsEnvironment: "development" };
  expect(deviceRegistration({ ...base, platform: "ios", criticalAlerts: true })).toMatchObject({
    criticalAlerts: true,
  });
  for (const args of [
    deviceRegistration({ ...base, platform: "ios" }),
    deviceRegistration({ ...base, platform: "ios", criticalAlerts: false }),
    deviceRegistration({ ...base, platform: "android", criticalAlerts: true }),
  ]) {
    expect(args).not.toHaveProperty("criticalAlerts");
  }

  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  expect(await registerPhone(phone(as(ANA), { criticalAlerts: async () => true }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ criticalAlerts: true }]);
  // Turned off in Settings, or a permission read that fails: time-sensitive pages, as before.
  expect(await registerPhone(phone(as(ANA), { criticalAlerts: async () => false }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ criticalAlerts: false }]);
  const failing = async (): Promise<boolean> => {
    throw new Error("no permission read");
  };
  expect(await registerPhone(phone(as(ANA), { criticalAlerts: failing }))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ criticalAlerts: false }]);
});

test("a registered phone keeps its instance's origin for the extension's receipts, and only then", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  const kept: string[] = [];
  const receiptOrigin = {
    origin: "https://brigade.example/api/auth",
    keep: (origin: string) => void kept.push(origin),
  };
  expect(await registerPhone(phone(as(ANA), { receiptOrigin }))).toBe("on");
  // The origin only: the extension compares a receipt URL's scheme, host and port with it.
  expect(kept).toEqual(["https://brigade.example"]);
  // Registered already: kept again, so an app updated to receipts keeps it on its next launch.
  expect(await registerPhone(phone(as(ANA), { receiptOrigin }))).toBe("on");
  expect(kept).toHaveLength(2);

  // Refused (another member's phone), or never sent: nothing kept.
  expect(await registerPhone(phone(as(BIA), { receiptOrigin }))).toBe("taken");
  expect(await registerPhone(phone(as(ANA), { receiptOrigin }), () => false)).toBe("pending");
  expect(kept).toHaveLength(2);

  // An app binary without the call, or an origin it cannot read, never fails the registration.
  const throwing = {
    origin: "https://brigade.example",
    keep: () => {
      throw new Error("no such function");
    },
  };
  expect(await registerPhone(phone(as(ANA), { receiptOrigin: throwing }))).toBe("on");
  expect(instanceOrigin("brigade://callback")).toBeUndefined();
  expect(instanceOrigin("http://localhost:8787/api/auth")).toBe("http://localhost:8787");
});

test("signing out unregisters it, so the next member to sign in on the phone is paged on it", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  await registerPhone(phone(as(ANA)));
  // Without signing out first, the phone keeps paging Ana and Bia is told so.
  expect(await registerPhone(phone(as(BIA)))).toBe("taken");
  expect(await unregisterPhone(phone(as(ANA)))).toBe(true);
  expect(store.scan("devices")).toEqual([]);
  expect(await registerPhone(phone(as(BIA)))).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ userId: BIA.id }]);
  // Already gone is as good as unregistered.
  expect(await unregisterPhone(phone(as(ANA)))).toBe(true);
});

test("the member's device limit is a failure, not an up-to-date registration", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const as = shard(store);
  for (let n = 0; n < MAX_DEVICES_PER_MEMBER; n++) {
    const key = `BA${String(n).padStart(2, "0")}${"abcdefghij".repeat(9).slice(0, 83)}`;
    const token = String(n).padStart(64, "0");
    const deps = phone(as(ANA), { publicKey: async () => key, pushToken: async () => token });
    expect(await registerPhone(deps)).toBe("on");
  }
  expect(await registerPhone(phone(as(ANA)))).toBe("failed");
});

test("without a key, permission or a working token it says why instead of registering", async () => {
  const never: DeviceDeps["mutate"] = async () => {
    throw new Error("not called");
  };
  expect(await registerPhone(phone(never, { publicKey: null, platform: "android" }))).toBe(
    "unsupported",
  );
  expect(await registerPhone(phone(never, { permission: async () => false }))).toBe("off");
  expect(
    await registerPhone(
      phone(never, {
        pushToken: async () => {
          throw new Error("no APNs");
        },
      }),
    ),
  ).toBe("failed");
});

test("signing out offline gives up on unregistering after the timeout", async () => {
  const hang: DeviceDeps["mutate"] = () => new Promise(() => {});
  expect(await unregisterPhone(phone(hang), 10)).toBe(false);
  expect(await unregisterPhone(phone(hang, { publicKey: null }), 10)).toBe(true);
});

/** A sync client whose sockets the test opens or refuses; `refuse` closes the next one before it opens. */
function socketClient(answer: "refuse" | "open") {
  const client = createSyncClient({
    url: (shard) => `ws://10.0.2.2:5173/api/sync/${shard}`,
    actor: { kind: "user", id: "usr_ana", role: "responder" },
    // Long enough that no retry happens during a test.
    backoff: { initialMs: 60_000, maxMs: 60_000 },
    transport: () => {
      const socket: SyncSocket = {
        send: () => {},
        close: () => {},
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
      };
      setTimeout(() => {
        // As React Native reports an upgrade answered 401 or 403: an error, then a close, never an open.
        if (answer === "refuse") socket.onclose?.({} as never);
        else socket.onopen?.({} as never);
      }, 0);
      return socket;
    },
    onWarning: () => {},
  });
  return client;
}

test("a socket the server refuses (a removed member) ends the unregister at once, not after the timeout", async () => {
  const client = socketClient("refuse");
  const refused = neverOpened(client, "org_test");
  const started = Date.now();
  const done = await unregisterPhone(
    phone((name, args) => client.mutate("org_test", name, args as never)),
    60_000,
    refused.promise,
  );
  expect(done).toBe(false);
  expect(Date.now() - started).toBeLessThan(1_000);
  refused.dispose();
  client.close();
});

test("a socket that opens is not taken for a refusal", async () => {
  const client = socketClient("open");
  const refused = neverOpened(client, "org_test");
  let gaveUp = false;
  void refused.promise.then(() => {
    gaveUp = true;
  });
  // The shard never answers: only the timeout ends it.
  expect(
    await unregisterPhone(
      phone((name, args) => client.mutate("org_test", name, args as never)),
      20,
      refused.promise,
    ),
  ).toBe(false);
  expect(client.connectionState("org_test")).toBe("open");
  expect(gaveUp).toBe(false);
  refused.dispose();
  client.close();
});

test("a VoIP token that is slow to come never holds the alert token back", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const started = Date.now();
  const never = () => new Promise<string | null>(() => {});
  expect(await registerPhone(phone(shard(store)(ANA), { voipToken: never }))).toBe("on");
  expect(Date.now() - started).toBeLessThan(VOIP_GRACE_MS + 1000);
  expect(store.scan("devices")).toMatchObject([{ voipToken: null }]);
});

test("an instance from before Critical Alerts still registers the phone, without them", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const sent: unknown[] = [];
  const current = shard(store)(ANA);
  // An older shard: its validator refuses any key it does not know.
  const older: DeviceDeps["mutate"] = async (name, args) => {
    sent.push(args);
    if (args && typeof args === "object" && "criticalAlerts" in args) {
      return { ok: false, error: { code: "invalid_args", message: "Unknown key" } };
    }
    return current(name, args);
  };
  expect(await registerPhone(phone(older, { criticalAlerts: async () => true }))).toBe("on");
  expect(sent).toHaveLength(2);
  expect(sent[1]).not.toHaveProperty("criticalAlerts");
  expect(store.scan("devices")).toHaveLength(1);
});

/**
 * `POST /devices/register` over one store per workspace, as the API runs it: `device.register` as the member in each
 * workspace they are in; `not_a_member` elsewhere.
 */
function route(stores: Record<string, Store<BrigadeTables>>, actor: Actor, log: string[][] = []) {
  return async (args: object, workspaces: string[]): Promise<RegisterAnswer> => {
    log.push(workspaces);
    const answers: Record<string, string> = {};
    for (const id of workspaces) {
      const store = stores[id];
      if (!store) {
        answers[id] = "not_a_member";
        continue;
      }
      const result = await shard(store)(actor)("device.register", args);
      answers[id] = result.ok || result.error.code === "conflict" ? "ok" : result.error.code;
    }
    return { ok: true, workspaces: answers };
  };
}

// A paging path (AGENTS.md): a new push token (a reinstall, APNs rotating it) must reach every workspace the phone pages
// for, or the others keep a dead token and page nobody on it.
test("the phone registers in every workspace it was opened in at once, a new token reaching all of them", async () => {
  const stores = {
    ws_one: createMemoryStore<BrigadeTables>(),
    ws_two: createMemoryStore<BrigadeTables>(),
  };
  const log: string[][] = [];
  const deps = (token: string) =>
    phone(shard(stores.ws_one)(ANA), {
      pushToken: async () => token,
      registerAll: route(stores, ANA, log),
    });
  expect(await registerEverywhere(deps("ab".repeat(32)), ["ws_two"], "ws_one")).toEqual({
    ws_one: "on",
    ws_two: "on",
  });
  expect(await registerEverywhere(deps("cd".repeat(32)), ["ws_one", "ws_two"], "ws_one")).toEqual({
    ws_one: "on",
    ws_two: "on",
  });
  for (const store of Object.values(stores)) {
    expect(store.scan("devices")).toMatchObject([{ pushToken: "cd".repeat(32) }]);
  }
  expect(log).toEqual([
    ["ws_one", "ws_two"],
    ["ws_one", "ws_two"],
  ]);
});

test("each workspace says how it went: another member's phone is taken, a workspace left is dropped", async () => {
  const stores = {
    ws_one: createMemoryStore<BrigadeTables>(),
    ws_two: createMemoryStore<BrigadeTables>(),
  };
  // Bia never signed out on this phone in ws_two.
  await registerPhone(phone(shard(stores.ws_two)(BIA)));
  const gone: string[][] = [];
  const registered = await registerEverywhere(
    phone(shard(stores.ws_one)(ANA), { registerAll: route(stores, ANA) }),
    ["ws_two", "ws_gone"],
    "ws_one",
    () => true,
    (ids) => gone.push(ids),
  );
  expect(registered).toEqual({ ws_one: "on", ws_two: "taken" });
  expect(gone).toEqual([["ws_gone"]]);
});

// A paging path (AGENTS.md): a workspace forgotten here is never registered on this phone again.
test("a workspace whose membership the API could not check is kept and tried again, never forgotten", async () => {
  const gone: string[][] = [];
  const registered = await registerEverywhere(
    phone(async () => ({ ok: true }), {
      registerAll: async () => ({
        ok: true,
        workspaces: { ws_one: "ok", ws_two: "unavailable" },
      }),
    }),
    ["ws_two"],
    "ws_one",
    () => true,
    (ids) => gone.push(ids),
  );
  expect(registered).toEqual({ ws_one: "on", ws_two: "failed" });
  expect(registrationsLeft(registered)).toBe(true);
  expect(gone).toEqual([]);
});

test("offline or a server error fails every workspace, so all are tried again; notifications off says so for all", async () => {
  const offline = phone(async () => ({ ok: true }), {
    registerAll: async () => ({ ok: false, status: 0 }),
  });
  expect(await registerEverywhere(offline, ["ws_two"], "ws_one")).toEqual({
    ws_one: "failed",
    ws_two: "failed",
  });
  const off = phone(async () => ({ ok: true }), {
    permission: async () => false,
    registerAll: async () => ({ ok: true, workspaces: {} }),
  });
  expect(await registerEverywhere(off, ["ws_two"], "ws_one")).toEqual({
    ws_one: "off",
    ws_two: "off",
  });
});

test("an instance from before the route registers the open workspace over its socket", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const older = phone(shard(store)(ANA), { registerAll: async () => ({ ok: false, status: 404 }) });
  expect(await registerEverywhere(older, ["ws_two"], "ws_one")).toEqual({ ws_one: "on" });
  expect(store.scan("devices")).toHaveLength(1);
});

test("a route that refuses Critical Alerts gets the registration again without them", async () => {
  const sent: object[] = [];
  const deps = phone(async () => ({ ok: true }), {
    criticalAlerts: async () => true,
    registerAll: async (args, workspaces) => {
      sent.push(args);
      return {
        ok: true,
        workspaces: Object.fromEntries(
          workspaces.map((id) => [id, "criticalAlerts" in args ? "invalid_args" : "ok"]),
        ),
      };
    },
  });
  expect(await registerEverywhere(deps, [], "ws_one")).toEqual({ ws_one: "on" });
  expect(sent).toHaveLength(2);
  expect(sent[1]).not.toHaveProperty("criticalAlerts");
});
