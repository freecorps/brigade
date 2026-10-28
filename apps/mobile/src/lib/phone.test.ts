import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

// expo-notifications as it behaves on Android (expo-notifications 58, expo-modules-core 58): every permission request,
// granted already or not, goes through the system's permission screen, so the app goes to the background and comes
// back; and every token fetch fires the push token listener with the token it fetched.
const android = vi.hoisted(() => {
  const appState: ((state: string) => void)[] = [];
  const tokenListeners: ((token: { type: string; data: string }) => void)[] = [];
  const state = { granted: true, requests: 0, token: "c".repeat(152) };
  return { appState, tokenListeners, state };
});

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ status: android.state.granted ? "granted" : "denied" }),
  requestPermissionsAsync: async () => {
    android.state.requests += 1;
    // The permission screen covers the app (onPause), answers, and the app is back (onResume).
    android.appState.forEach((listener) => listener("background"));
    await Promise.resolve();
    queueMicrotask(() => android.appState.forEach((listener) => listener("active")));
    return { status: android.state.granted ? "granted" : "denied" };
  },
  getDevicePushTokenAsync: async () => {
    const data = android.state.token;
    queueMicrotask(() =>
      android.tokenListeners.forEach((listener) => listener({ type: "android", data })),
    );
    return { type: "android", data };
  },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));
vi.mock("../../modules/brigade-push", () => ({
  BrigadePush: {
    fcmAvailable: true,
    getPublicKey: async () => `BA${"abcdefghij".repeat(9).slice(0, 85)}`,
  },
}));
vi.mock("../../modules/brigade-call", () => ({ BrigadeCall: null }));

const { registerEverywhere } = await import("@/lib/device");
const { pagingCycle, pagingNudges } = await import("@/lib/paging");
const { permissions, phoneDeps, pushTokens } = await import("@/lib/phone");
type WorkspaceSync = import("@/lib/sync-client").WorkspaceSync;

const W = "ws_01JABCDEFGHJKMNPQRSTVWXYZ0";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("EXPO_OS", "android");
  android.appState.length = 0;
  android.tokenListeners.length = 0;
  android.state.granted = true;
  android.state.requests = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** The cycle wired as src/components/session.tsx wires it, against `answer` from `POST /devices/register`. */
function idleApp(answer: string) {
  let calls = 0;
  const deps = phoneDeps({} as WorkspaceSync, undefined, async (_, workspaces) => {
    calls += 1;
    return { ok: true, workspaces: Object.fromEntries(workspaces.map((id) => [id, answer])) };
  });
  const cycle = pagingCycle({
    finish: async () => "none",
    register: (proceed) => registerEverywhere(deps, [W], W, proceed),
    onPaging: () => {},
    setTimer: (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    now: Date.now,
    random: () => 0.5,
  });
  const nudges = pagingNudges(cycle, pushTokens, permissions, "active");
  android.appState.push(nudges.appState);
  android.tokenListeners.push(nudges.pushToken);
  return { cycle, calls: () => calls };
}

test("an idle Android app registered once makes no more registrations (the one every 5 s seen on dev)", async () => {
  const app = idleApp("ok");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.calls()).toBe(1);
  // Granted already: the system's permission screen is not shown at all.
  expect(android.state.requests).toBe(0);
  void app.cycle.stop();
});

test("coming back from the app's own permission request does not register again", async () => {
  // Notifications turned off: the app asks on every try, and each ask takes it out of the foreground and back.
  android.state.granted = false;
  const app = idleApp("ok");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(android.state.requests).toBe(1);
  // `off` is not tried again on a timer, and the return from asking is not the member coming back.
  expect(app.calls()).toBe(0);
  // The member turns them on in Settings and comes back: that registers.
  android.state.granted = true;
  android.appState.forEach((listener) => listener("background"));
  android.appState.forEach((listener) => listener("active"));
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls()).toBe(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.calls()).toBe(1);
  void app.cycle.stop();
});

test("the foreground, a new token, Try again and failures still register", async () => {
  const app = idleApp("ok");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(app.calls()).toBe(1);
  // Back to the foreground.
  android.appState.forEach((listener) => listener("background"));
  android.appState.forEach((listener) => listener("active"));
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls()).toBe(2);
  // FCM rotates the token.
  await vi.advanceTimersByTimeAsync(10_000);
  android.state.token = "d".repeat(152);
  android.tokenListeners.forEach((listener) =>
    listener({ type: "android", data: android.state.token }),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls()).toBe(3);
  // Try again never waits.
  await app.cycle.retry();
  expect(app.calls()).toBe(4);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(app.calls()).toBe(4);
  void app.cycle.stop();

  // A failure is tried again on the backoff: at once, 5 s, then 30 s later.
  const failing = idleApp("internal");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(failing.calls()).toBe(3);
  void failing.cycle.stop();
});
