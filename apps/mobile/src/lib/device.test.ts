import {
  createMemoryStore,
  isId,
  runMutation,
  serverMutations,
  type BrigadeTables,
} from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import { deviceId, deviceRegistration, pushEnvironment } from "./device";
import { DEV_ACTOR } from "./sync";

// An uncompressed P-256 point's shape (0x04 then 64 bytes), base64url.
const KEY = `BA${"abcdefghij".repeat(9).slice(0, 85)}`;

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
    {
      actor: DEV_ACTOR,
      now: Date.now(),
      server: true,
    },
  );
  expect(result.ok).toBe(true);
});
