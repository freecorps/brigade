import { expect, test } from "vite-plus/test";
import {
  hostOf,
  instanceLabel,
  judgeAddress,
  loadAddressConfig,
  olderVersion,
  privateHost,
  readAddress,
  readAddressConfig,
} from "./instance-address";
import { FREECORPS_BRIGADE, FREECORPS_RELAY } from "./relay";

const RELAY = { origin: FREECORPS_RELAY, instance: "ins_aaaaaaaaaaaaaaaaaaaaaa" };
const store = { appVersion: "0.1.0", thisBuild: FREECORPS_RELAY, isDefault: false };

test("an address is read as the dashboard's origin, HTTPS only", () => {
  expect(readAddress("brigade.example.com", false)).toEqual({
    origin: "https://brigade.example.com",
  });
  expect(readAddress("  https://Brigade.Example.com/incidents?x=1  ", false)).toEqual({
    origin: "https://brigade.example.com",
  });
  expect(readAddress("brigade.example.com:8443", false)).toEqual({
    origin: "https://brigade.example.com:8443",
  });
  expect(readAddress("http://brigade.example.com", false)).toEqual({ problem: "insecure" });
  // A development build allows http:// on a private address only.
  expect(readAddress("http://brigade.example.com", true)).toEqual({ problem: "insecure" });
  expect(readAddress("http://192.168.0.10:5173", true)).toEqual({
    origin: "http://192.168.0.10:5173",
  });
  expect(readAddress("http://localhost:5173", true)).toEqual({ origin: "http://localhost:5173" });
  expect(readAddress("http://localhost:5173", false)).toEqual({ problem: "insecure" });
  for (const bad of [
    "",
    "   ",
    "not an address",
    "ftp://brigade.example.com",
    "https://u:p@x.example",
  ]) {
    expect(readAddress(bad, true), bad).toEqual({ problem: "invalid" });
  }
});

test("private hosts", () => {
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.2.2",
    "172.20.1.1",
    "192.168.1.5",
    "mac.local",
    "[::1]",
    "fd12:3456::1",
  ]) {
    expect(privateHost(host), host).toBe(true);
  }
  for (const host of [
    "brigade.example.com",
    "8.8.8.8",
    "172.32.0.1",
    "192.169.0.1",
    "localhost.example.com",
  ]) {
    expect(privateHost(host), host).toBe(false);
  }
});

test("not a Brigade: a page, a 404, other JSON", () => {
  expect(readAddressConfig(404, null)).toEqual({ kind: "not-brigade" });
  expect(readAddressConfig(200, null)).toEqual({ kind: "not-brigade" });
  expect(readAddressConfig(200, { hello: "world" })).toEqual({ kind: "not-brigade" });
  expect(readAddressConfig(200, [1, 2])).toEqual({ kind: "not-brigade" });
  expect(judgeAddress(readAddressConfig(200, { name: "x" }), store)).toEqual({
    kind: "not-brigade",
  });
});

test("a server error or no answer is unreachable, not 'not a Brigade'", async () => {
  expect(readAddressConfig(503, { error: "unavailable" })).toEqual({ kind: "unreachable" });
  expect(readAddressConfig(429, null)).toEqual({ kind: "unreachable" });
  expect(
    await loadAddressConfig("https://brigade.example.com", async () => {
      throw new TypeError("Network request failed");
    }),
  ).toEqual({ kind: "unreachable" });
  // A body that is not JSON (a web page at /api/config).
  expect(
    await loadAddressConfig("https://brigade.example.com", async (url) => {
      expect(url).toBe("https://brigade.example.com/api/config");
      return {
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token <");
        },
      };
    }),
  ).toEqual({ kind: "not-brigade" });
});

test("this build's relay: ok", () => {
  const config = readAddressConfig(200, {
    signUp: "open",
    brigade: { api: 1, minApp: "0.1.0" },
    relay: RELAY,
  });
  expect(config).toEqual({ kind: "brigade", minApp: "0.1.0", relay: { origin: FREECORPS_RELAY } });
  expect(judgeAddress(config, store)).toEqual({ kind: "ok", relay: FREECORPS_RELAY });
});

test("another relay: this instance uses its own app build", () => {
  const config = readAddressConfig(200, {
    signUp: "closed",
    brigade: { api: 1, minApp: "0.1.0" },
    relay: {
      origin: "https://relay.acme.example",
      instance: RELAY.instance,
      app: "https://apps.acme.example/brigade",
    },
  });
  expect(judgeAddress(config, store)).toEqual({
    kind: "own-app",
    relay: "https://relay.acme.example",
    app: "https://apps.acme.example/brigade",
  });
  // A link that is not https is not offered.
  const plain = readAddressConfig(200, {
    brigade: {},
    relay: { origin: "https://relay.acme.example", app: "http://apps.acme.example" },
  });
  expect(judgeAddress(plain, store)).toEqual({
    kind: "own-app",
    relay: "https://relay.acme.example",
  });
  // The build's default instance is never foreign: the build was made for it.
  expect(judgeAddress(config, { ...store, isDefault: true })).toEqual({
    kind: "ok",
    relay: "https://relay.acme.example",
  });
  // This build's relay not known yet: nothing can be told foreign.
  expect(judgeAddress(config, { ...store, thisBuild: undefined }).kind).toBe("ok");
});

test("no relay: sign-in allowed, cannot page this phone", () => {
  const config = readAddressConfig(200, { signUp: "open", brigade: { api: 1, minApp: "0.1.0" } });
  expect(judgeAddress(config, store)).toEqual({ kind: "no-relay" });
  // An instance from before step 3 (no `brigade`) is still a Brigade.
  expect(judgeAddress(readAddressConfig(200, { signUp: "invite" }), store)).toEqual({
    kind: "no-relay",
  });
  // The build's default instance pages with the raw tokens.
  expect(judgeAddress(config, { ...store, isDefault: true })).toEqual({ kind: "ok", relay: "" });
});

test("an app older than the instance supports: update the app", () => {
  const config = readAddressConfig(200, { brigade: { api: 2, minApp: "0.3.0" }, relay: RELAY });
  expect(judgeAddress(config, store)).toEqual({ kind: "update-app", minApp: "0.3.0" });
  expect(judgeAddress(config, { ...store, appVersion: "0.3.0" }).kind).toBe("ok");
  expect(judgeAddress(config, { ...store, appVersion: "1.0.0" }).kind).toBe("ok");
  // Before anything else about the relay: an old app should not judge it.
  const foreign = readAddressConfig(200, {
    brigade: { minApp: "9.0.0" },
    relay: { origin: "https://relay.acme.example" },
  });
  expect(judgeAddress(foreign, store).kind).toBe("update-app");
  // A minApp that does not read never blocks.
  expect(readAddressConfig(200, { brigade: { minApp: "soon" } })).toEqual({ kind: "brigade" });
});

test("versions", () => {
  expect(olderVersion("0.1.0", "0.1.1")).toBe(true);
  expect(olderVersion("0.9.9", "0.10.0")).toBe(true);
  expect(olderVersion("1.0", "1.0.0")).toBe(false);
  expect(olderVersion("1.2.0-beta.1", "1.2.0")).toBe(false);
  expect(olderVersion("x", "1.0.0")).toBe(false);
});

test("hosts and labels", () => {
  expect(hostOf("https://brigade.example.com")).toBe("brigade.example.com");
  expect(hostOf("http://192.168.0.10:5173")).toBe("192.168.0.10:5173");
  expect(instanceLabel(FREECORPS_BRIGADE)).toBe("Freecorps");
  expect(instanceLabel("https://brigade.acme.example")).toBe("brigade.acme.example");
});
