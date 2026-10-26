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
import { expect, test } from "vite-plus/test";
import {
  deviceId,
  deviceRegistration,
  pushEnvironment,
  registerPhone,
  unregisterPhone,
  type DeviceDeps,
} from "./device";

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
