import { afterEach, expect, test, vi } from "vite-plus/test";

// `@better-auth/expo` runs on React Native; in Node it needs only these (vite.config.ts inlines it so they apply).
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "brigade" }, platform: {} } }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `brigade://${path}` }));
vi.mock("expo-secure-store", () => ({}));
vi.stubGlobal("__DEV__", false);

const { brigadeAuthClient, forgetSession } = await import("./auth-client");

/** expo-secure-store in memory. */
function memoryStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    getItemAsync: async (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    setItemAsync: async (key: string, value: string) => void items.set(key, value),
  };
}

const SIGNED_IN = JSON.stringify({
  "better-auth.session_token": { value: "token.sig", expires: "2999-01-01T00:00:00.000Z" },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("signing out offline forgets the stored session before the request fails", async () => {
  const storage = memoryStore();
  storage.items.set("brigade_cookie", SIGNED_IN);
  const sent: (string | null)[] = [];
  vi.stubGlobal("fetch", async (_request: Request | string, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get("cookie"));
    throw new TypeError("Network request failed");
  });
  const client = brigadeAuthClient("https://brigade.test/api/auth", storage);
  expect(await client.getCookie()).toContain("better-auth.session_token=token.sig");

  // A network failure rejects rather than answering with an error.
  await expect(client.signOut()).rejects.toThrow("Network request failed");
  // The request still carried the session, so an online sign-out revokes it on the server.
  expect(sent).toEqual([expect.stringContaining("token.sig")]);
  expect(await client.getCookie()).toBe("");
  expect(client.$store.atoms.session?.get().data ?? null).toBeNull();
});

test("the build's default instance keeps the session from before several instances; others keep their own", async () => {
  const { instanceStorage, DEFAULT_INSTANCE } = await import("./instances");
  const storage = memoryStore();
  // An install from before several instances: its session under `brigade_cookie`.
  storage.items.set("brigade_cookie", SIGNED_IN);
  vi.stubGlobal("fetch", vi.fn());
  const before = brigadeAuthClient(
    "https://brigade.test/api/auth",
    storage,
    instanceStorage(DEFAULT_INSTANCE).auth,
  );
  expect(await before.getCookie()).toContain("token.sig");
  // Another instance on the same phone: nothing of the first one's session.
  const acme = brigadeAuthClient(
    "https://brigade.acme.test/api/auth",
    storage,
    instanceStorage("acme1").auth,
  );
  expect(await acme.getCookie()).toBe("");
  storage.items.set("brigade_acme1_cookie", SIGNED_IN.replace("token.sig", "acme.sig"));
  expect(await acme.getCookie()).toContain("acme.sig");
  // Forgetting one session leaves the other.
  await forgetSession(acme);
  expect(await acme.getCookie()).toBe("");
  expect(await before.getCookie()).toContain("token.sig");
});

test("forgetting the session signs out here without telling the server", async () => {
  const storage = memoryStore();
  storage.items.set("brigade_cookie", SIGNED_IN);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const client = brigadeAuthClient("https://brigade.test/api/auth", storage);
  await forgetSession(client);
  expect(fetch).not.toHaveBeenCalled();
  expect(await client.getCookie()).toBe("");
});
