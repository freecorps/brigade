import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";

// expo-notifications as it behaves on Android (expo-notifications 58, expo-modules-core 58): every permission request,
// granted already or not, goes through the system's permission screen, so the app goes to the background and comes
// back; and every token fetch fires the push token listener with the token it fetched. On iOS a request shows an alert
// only while permission is not granted yet, and the alert makes the app `inactive`, not `background`.
const TOKEN = "c".repeat(152);
const android = vi.hoisted(() => {
  const appState: ((state: string) => void)[] = [];
  const tokenListeners: ((token: { type: string; data: string }) => void)[] = [];
  const state = {
    granted: true,
    requests: 0,
    asked: [] as unknown[],
    token: "",
    criticalAlerts: false,
    /** Set: the request stays open, its screen up, until the test answers it; and the app does not come back. */
    hold: null as null | { answer: () => void },
  };
  return { appState, tokenListeners, state };
});

const emit = (state: string) => android.appState.forEach((listener) => listener(state));

vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({
    status: android.state.granted ? "granted" : "denied",
    ios: { allowsCriticalAlerts: android.state.granted },
  }),
  requestPermissionsAsync: async (options: unknown) => {
    android.state.requests += 1;
    android.state.asked.push(options);
    const ios = process.env.EXPO_OS === "ios";
    if (ios && android.state.granted) return { status: "granted" };
    // The permission screen covers the app (onPause; an alert on iOS), answers, and the app is back (onResume).
    emit(ios ? "inactive" : "background");
    const hold = android.state.hold;
    if (hold) {
      await new Promise<void>((resolve) => (hold.answer = resolve));
    } else {
      await Promise.resolve();
      queueMicrotask(() => emit("active"));
    }
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
vi.mock("expo-constants", () => ({
  default: {
    get expoConfig() {
      return { extra: { criticalAlerts: android.state.criticalAlerts } };
    },
  },
}));
vi.mock("expo-secure-store", () => ({}));
vi.mock("expo-crypto", () => ({ getRandomBytes: (n: number) => new Uint8Array(n) }));
vi.mock("../../modules/brigade-push", () => ({
  BrigadePush: {
    fcmAvailable: true,
    getPublicKey: async () => `BA${"abcdefghij".repeat(9).slice(0, 85)}`,
  },
}));
vi.mock("../../modules/brigade-call", () => ({ BrigadeCall: null }));

type WorkspaceSync = import("@/lib/sync-client").WorkspaceSync;

const W = "ws_01JABCDEFGHJKMNPQRSTVWXYZ0";

let registerEverywhere: typeof import("@/lib/device").registerEverywhere;
let pagingCycle: typeof import("@/lib/paging").pagingCycle;
let pagingNudges: typeof import("@/lib/paging").pagingNudges;
let phone: typeof import("@/lib/phone");

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("EXPO_OS", "android");
  android.appState.length = 0;
  android.tokenListeners.length = 0;
  android.state.granted = true;
  android.state.requests = 0;
  android.state.asked = [];
  android.state.token = TOKEN;
  android.state.criticalAlerts = false;
  android.state.hold = null;
  // A fresh `pushTokens` and `permissions` (shared by the app, so by every test in this file otherwise).
  vi.resetModules();
  ({ registerEverywhere } = await import("@/lib/device"));
  ({ pagingCycle, pagingNudges } = await import("@/lib/paging"));
  phone = await import("@/lib/phone");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** The cycle wired as src/components/session.tsx wires it, against `answer` from `POST /devices/register`. */
function idleApp(answer: string) {
  let calls = 0;
  const deps = phone.phoneDeps({} as WorkspaceSync, undefined, async (_, workspaces) => {
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
  const nudges = pagingNudges(
    cycle,
    phone.pushTokens,
    phone.permissions,
    "active",
    process.env.EXPO_OS,
  );
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
  emit("background");
  emit("active");
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
  emit("background");
  emit("active");
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

test("leaving from the permission screen and coming back after it was answered registers (Android)", async () => {
  android.state.granted = false;
  android.state.hold = { answer: () => {} };
  const app = idleApp("ok");
  await vi.advanceTimersByTimeAsync(0);
  expect(android.state.requests).toBe(1);
  // The member leaves from the permission screen; it is dismissed while they are away.
  await vi.advanceTimersByTimeAsync(2_000);
  android.state.hold.answer();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(app.calls()).toBe(0);
  // They turn notifications on in Settings and come back.
  android.state.granted = true;
  emit("active");
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls()).toBe(1);
  void app.cycle.stop();
});

test("pressing Home while the permission alert is up and coming back registers (iOS)", async () => {
  vi.stubEnv("EXPO_OS", "ios");
  android.state.granted = false;
  android.state.hold = { answer: () => {} };
  const app = idleApp("ok");
  await vi.advanceTimersByTimeAsync(0);
  expect(android.state.requests).toBe(1);
  // The alert makes the app inactive; Home sends it to the background, and the alert is answered as it goes.
  emit("background");
  android.state.hold.answer();
  await vi.advanceTimersByTimeAsync(0);
  expect(app.calls()).toBe(0);
  // They turn notifications on in Settings and come straight back: tried once 5 s have passed since the last try.
  android.state.granted = true;
  emit("active");
  await vi.advanceTimersByTimeAsync(5_000);
  expect(app.calls()).toBe(1);
  void app.cycle.stop();
});

test("iOS asks with Critical Alerts even when notifications are granted already", async () => {
  vi.stubEnv("EXPO_OS", "ios");
  android.state.criticalAlerts = true;
  vi.resetModules();
  phone = await import("@/lib/phone");
  const deps = phone.phoneDeps({} as WorkspaceSync);
  expect(await deps.permission()).toBe(true);
  expect(android.state.requests).toBe(1);
  expect(android.state.asked[0]).toMatchObject({ ios: { allowCriticalAlerts: true } });
  expect(await deps.criticalAlerts?.()).toBe(true);
});
