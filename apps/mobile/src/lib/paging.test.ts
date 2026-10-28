import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  registerEverywhere,
  registerPhone,
  type DeviceDeps,
  type Paging,
  type Registrations,
} from "./device";
import {
  knownTokens,
  pagingNudges,
  MIN_TRY_GAP_MS,
  pagingCycle,
  permissionAsks,
  PERMISSION_RETURN_MS,
  TOKEN_FETCH_WAIT_MS,
  retryDelay,
  RETRY_JITTER,
  REMOVAL_TRIES,
  REMOVAL_WINDOW_MS,
  removalWatch,
  type PagingDeps,
} from "./paging";
import type { FinishResult } from "./sign-out";

/** Timers run by hand: `elapse(ms)` fires every timer due by then, in order. */
function clock() {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    setTimer: ((run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    }) satisfies PagingDeps["setTimer"],
    now: () => now,
    // Every wait on its step: jitter is tested on its own.
    random: () => 0.5,
    pending: () => timers.map((timer) => timer.at - now),
    settle,
    async elapse(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        now = due.at;
        due.run();
        await settle();
      }
      now = until;
    },
  };
}

/** The workspace the tests register in. */
const W = "ws_one";
/** The one workspace's paging of a registration. */
const first = (registrations: Registrations): Paging => Object.values(registrations)[0]!;

/** A phone whose kept sign-out finishes and whose registration answers as the test says; logs what ran. */
function phone(answers: { finish: FinishResult[]; register: Paging[] }) {
  const log: string[] = [];
  const shown: Paging[] = [];
  const next = <T>(list: T[]) => (list.length > 1 ? list.shift()! : list[0]!);
  return {
    log,
    shown,
    finish: async () => {
      log.push("finish");
      return next(answers.finish);
    },
    register: async (): Promise<Registrations> => {
      log.push("register");
      return { [W]: next(answers.register) };
    },
    onPaging: (registrations: Registrations) => shown.push(first(registrations)),
  };
}

test("the waits back off to every ten minutes, each give or take a fifth", () => {
  expect([0, 1, 2, 3, 4, 10].map((n) => retryDelay(n))).toEqual([
    5_000, 30_000, 120_000, 600_000, 600_000, 600_000,
  ]);
  expect(retryDelay(0, 0)).toBe(5_000 * (1 - RETRY_JITTER));
  expect(retryDelay(3, 0.999_999)).toBeLessThanOrEqual(600_000 * (1 + RETRY_JITTER));
  expect(retryDelay(3, 0.999_999)).toBeGreaterThan(600_000);
});

test("a phone with nothing left registers once, after finishing, and does not try again", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["on"] });
  pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  expect(p.log).toEqual(["finish", "register"]);
  expect(p.shown).toEqual(["on"]);
  expect(time.pending()).toEqual([]);
});

test("a finish left pending while online is tried again on the backoff until the phone is freed", async () => {
  const time = clock();
  // The auth server answers 5xx twice; then the old member's sign-out finishes and the phone is free.
  const p = phone({
    finish: ["pending", "pending", "finished", "none"],
    register: ["taken", "taken", "on"],
  });
  pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  expect(p.shown).toEqual(["taken"]);
  expect(time.pending()).toEqual([5_000]);
  await time.elapse(5_000);
  expect(p.shown).toEqual(["taken", "taken"]);
  expect(time.pending()).toEqual([30_000]);
  await time.elapse(30_000);
  // Finished first, then registered: the phone pages the member signed in now.
  expect(p.log).toEqual(["finish", "register", "finish", "register", "finish", "register"]);
  expect(p.shown).toEqual(["taken", "taken", "on"]);
  expect(time.pending()).toEqual([]);
});

test("a registration that failed is tried again, every ten minutes at most", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["failed"] });
  pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  await time.elapse(5_000 + 30_000 + 120_000 + 600_000);
  expect(p.shown).toEqual(["failed", "failed", "failed", "failed", "failed"]);
  expect(time.pending()).toEqual([600_000]);
});

test("a phone still another member's is tried again on the backoff, settling at ten minutes; too many phones is left to the member", async () => {
  const time = clock();
  const taken = phone({ finish: ["none"], register: ["taken"] });
  pagingCycle({ ...taken, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  // Soon at first: the other member's session may end right after this one signed in.
  expect(time.pending()).toEqual([5_000]);

  const later = clock();
  const limit = phone({ finish: ["none"], register: ["limit", "on"] });
  const cycle = pagingCycle({
    ...limit,
    setTimer: later.setTimer,
    now: later.now,
    random: later.random,
  });
  await later.settle();
  // Retrying changes nothing until they sign out on another phone: no timer, and Try again still works at once.
  expect(later.pending()).toEqual([]);
  await cycle.retry();
  expect(limit.shown).toEqual(["limit", "on"]);
});

test("with nobody signed in, a kept sign-out is still finished on the backoff", async () => {
  const time = clock();
  const p = phone({ finish: ["pending", "finished"], register: [] });
  pagingCycle({
    ...p,
    register: null,
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  await time.settle();
  expect(time.pending()).toEqual([5_000]);
  await time.elapse(5_000);
  expect(p.log).toEqual(["finish", "finish"]);
  expect(p.shown).toEqual([]);
  expect(time.pending()).toEqual([]);
});

test("Try again tries now instead of waiting, keeping one wait", async () => {
  const time = clock();
  const p = phone({
    finish: ["pending", "pending", "finished"],
    register: ["taken", "taken", "on"],
  });
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  expect(time.pending()).toEqual([5_000]);
  await cycle.retry();
  expect(p.shown).toEqual(["taken", "taken"]);
  // The backoff carries on from where it was, and the old wait is gone.
  expect(time.pending()).toEqual([30_000]);
  await cycle.retry();
  expect(p.shown).toEqual(["taken", "taken", "on"]);
  expect(time.pending()).toEqual([]);
});

test("the foreground, a reconnect or a new token try now, but never within the gap of the last try", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["failed"] });
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  await time.settle();
  await time.elapse(5_000 + 30_000);
  expect(p.log.filter((step) => step === "register")).toHaveLength(3);
  expect(time.pending()).toEqual([120_000]);
  // Back in the foreground long after the last try: now.
  await time.elapse(MIN_TRY_GAP_MS);
  cycle.nudge();
  await time.settle();
  expect(p.log.filter((step) => step === "register")).toHaveLength(4);
  // Nudged again and again right after: one try, once the gap is over, and the backoff after it.
  for (let n = 0; n < 50; n++) cycle.nudge();
  expect(time.pending()).toEqual([MIN_TRY_GAP_MS]);
  await time.elapse(MIN_TRY_GAP_MS);
  expect(p.log.filter((step) => step === "register")).toHaveLength(5);
  expect(time.pending()).toEqual([600_000]);
});

test("a retry asked for during a try runs once, right after it", async () => {
  const time = clock();
  let answer!: (result: FinishResult) => void;
  const log: string[] = [];
  const cycle = pagingCycle({
    finish: () => {
      log.push("finish");
      return log.length === 1
        ? new Promise<FinishResult>((resolve) => {
            answer = resolve;
          })
        : Promise.resolve("none");
    },
    register: async () => {
      log.push("register");
      return { [W]: "on" as const };
    },
    onPaging: () => {},
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  const first = cycle.retry();
  const second = cycle.retry();
  answer("pending");
  await Promise.all([first, second]);
  expect(log).toEqual(["finish", "register", "finish", "register"]);
  expect(time.pending()).toEqual([]);
});

test("a stopped cycle neither reports nor tries again", async () => {
  const time = clock();
  const p = phone({ finish: ["pending"], register: ["taken"] });
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  void cycle.stop();
  await time.settle();
  expect(p.shown).toEqual([]);
  expect(time.pending()).toEqual([]);
  await cycle.retry();
  expect(p.log).toEqual(["finish"]);
});

test("signing out does not wait for a push token that never comes, and the token arriving later sends nothing", async () => {
  const time = clock();
  const sent: string[] = [];
  let token!: (value: string) => void;
  const deps: DeviceDeps = {
    platform: "ios",
    apsEnvironment: "development",
    publicKey: async () => `BA${"abcdefghij".repeat(9).slice(0, 85)}`,
    permission: async () => true,
    // No APNs: getDevicePushTokenAsync may never return.
    pushToken: () =>
      new Promise((resolve) => {
        token = resolve;
      }),
    mutate: async (name) => {
      sent.push(name);
      return { ok: true };
    },
  };
  const shown: Paging[] = [];
  const cycle = pagingCycle({
    finish: async () => "none",
    register: async (proceed) => ({ [W]: await registerPhone(deps, proceed) }),
    onPaging: (registrations) => shown.push(first(registrations)),
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  await time.settle();
  // Sign-out starts while the token is still pending: stopping resolves at once.
  await cycle.stop();
  await deps.mutate("device.unregister", {});
  token("ab".repeat(32));
  await time.settle();
  expect(sent).toEqual(["device.unregister"]);
  expect(shown).toEqual([]);
  expect(time.pending()).toEqual([]);
});

test("a registration already sent stays ahead of the unregister sent after stopping, without waiting for the shard", async () => {
  const time = clock();
  const sent: string[] = [];
  const cycle = pagingCycle({
    finish: async () => "none",
    register: async (proceed) => {
      if (!proceed()) return { [W]: "pending" };
      sent.push("device.register");
      // Offline: the shard never answers. The unregister sent after it on the same socket undoes it.
      return new Promise<Registrations>(() => {});
    },
    onPaging: () => {},
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  await time.settle();
  await cycle.stop();
  sent.push("device.unregister");
  expect(sent).toEqual(["device.register", "device.unregister"]);
});

test("a finish or registration that throws counts as not done, not as a crash", async () => {
  const time = clock();
  const shown: Paging[] = [];
  pagingCycle({
    finish: () => Promise.reject(new Error("storage")),
    register: () => Promise.reject(new Error("socket")),
    onPaging: (registrations) => shown.push(first(registrations)),
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  await time.settle();
  expect(shown).toEqual(["failed"]);
  expect(time.pending()).toEqual([5_000]);
});

test("one workspace still failing is tried again even with the others on", async () => {
  const time = clock();
  const shown: Registrations[] = [];
  const answers: Registrations[] = [
    { ws_one: "on", ws_two: "failed" },
    { ws_one: "on", ws_two: "on" },
  ];
  pagingCycle({
    finish: async () => "none",
    register: async () => answers.shift()!,
    onPaging: (registrations) => shown.push(registrations),
    setTimer: time.setTimer,
    now: time.now,
    random: time.random,
  });
  await time.settle();
  expect(time.pending()).toEqual([5_000]);
  await time.elapse(5_000);
  expect(shown).toEqual([
    { ws_one: "on", ws_two: "failed" },
    { ws_one: "on", ws_two: "on" },
  ]);
  expect(time.pending()).toEqual([]);
});

afterEach(() => {
  vi.useRealTimers();
});

test("fetching the push token to register does not ask for another registration (the loop seen on Android)", async () => {
  vi.useFakeTimers();
  // expo-notifications fires the token listener with the token each `getDevicePushTokenAsync` fetched, on iOS and
  // Android alike: src/components/session.tsx registers again only when it is new.
  const tokens = knownTokens();
  const listeners: ((token: string) => void)[] = [];
  let calls = 0;
  const token = "c".repeat(64);
  const deps: DeviceDeps = {
    platform: "android",
    apsEnvironment: undefined,
    publicKey: async () => `BA${"abcdefghij".repeat(9).slice(0, 85)}`,
    permission: async () => true,
    pushToken: () =>
      tokens.fetch(async () => {
        queueMicrotask(() => listeners.forEach((listener) => listener(token)));
        return token;
      }),
    registerAll: async (_, workspaces) => {
      calls += 1;
      // A failure the shard keeps answering, so the phone stays `failed` and on the backoff.
      return { ok: true, workspaces: Object.fromEntries(workspaces.map((id) => [id, "internal"])) };
    },
    mutate: async () => ({ ok: true }),
  };
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
    tokens,
    { asking: () => false, recent: () => false },
    "active",
    "android",
  );
  listeners.push((value) => nudges.pushToken({ data: value }));
  await vi.advanceTimersByTimeAsync(60_000);
  // At once, 5 s later, then 30 s later: three tries in the first minute, not one a second.
  expect(calls).toBe(3);
  // Then 2 min and 10 min after those.
  await vi.advanceTimersByTimeAsync(700_000);
  expect(calls).toBe(5);
  // A token that is new does register at once, and Try again does too.
  listeners.forEach((listener) => listener("d".repeat(64)));
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toBe(6);
  await cycle.retry();
  expect(calls).toBe(7);
  void cycle.stop();
});

test("a token the listener hears before the fetch that fired it answered is not new", async () => {
  const tokens = knownTokens();
  const token = "c".repeat(64);
  let answer!: (token: string) => void;
  const fetched = tokens.fetch(() => new Promise((resolve) => (answer = resolve)));
  // Android emits the event as it answers the fetch: it can reach the listener first.
  const heard = tokens.changed(token);
  answer(token);
  await fetched;
  expect(await heard).toBe(false);
  expect(await tokens.changed(token)).toBe(false);
  // A rotated token is new, once.
  expect(await tokens.changed("d".repeat(64))).toBe(true);
  expect(await tokens.changed("d".repeat(64))).toBe(false);
  // A fetch that fails leaves the token known as it was.
  await tokens.fetch(() => Promise.reject(new Error("no FCM"))).catch(() => {});
  expect(await tokens.changed("d".repeat(64))).toBe(false);
});

test("a token fetch that never answers holds token events back only for a while", async () => {
  vi.useFakeTimers();
  const tokens = knownTokens();
  // No APNs: the fetch never answers.
  void tokens.fetch(() => new Promise<string>(() => {}));
  let heard: boolean | undefined;
  void tokens.changed("c".repeat(64)).then((changed) => (heard = changed));
  await vi.advanceTimersByTimeAsync(TOKEN_FETCH_WAIT_MS - 1);
  expect(heard).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(heard).toBe(true);
  // A later fetch is not held back by the stuck one.
  await tokens.fetch(async () => "d".repeat(64));
  let later: boolean | undefined;
  void tokens.changed("d".repeat(64)).then((changed) => (later = changed));
  await vi.advanceTimersByTimeAsync(0);
  expect(later).toBe(false);
  vi.useRealTimers();
});

test("a return to the foreground is the member's unless it is the end of the app's own permission request", () => {
  let nudges = 0;
  const cycle = { nudge: () => (nudges += 1) };
  let now = 0;
  const asks = permissionAsks(() => now);
  let answer!: () => void;
  const asked = asks.ask(() => new Promise<void>((resolve) => (answer = resolve)));
  const tokens = knownTokens();

  // Android: the permission screen sends the app to the background and it comes back as the request ends.
  const droid = pagingNudges(cycle, tokens, asks, "active", "android");
  droid.appState("background");
  // iOS: the alert makes the app inactive, and Home sends it to the background: the member left.
  const ios = pagingNudges(cycle, tokens, asks, "active", "ios");
  ios.appState("inactive");
  ios.appState("background");
  answer();
  return asked.then(() => {
    // The request ended a moment ago.
    now += 10;
    droid.appState("active");
    expect(nudges).toBe(0);
    ios.appState("active");
    expect(nudges).toBe(1);
    // Android: the member left from the permission screen, and comes back long after it was answered.
    void asks.ask(async () => {});
    droid.appState("background");
    return Promise.resolve().then(() => {
      now += PERMISSION_RETURN_MS;
      droid.appState("active");
      expect(nudges).toBe(2);
    });
  });
});

test("the phone's device gone from the shard while registered registers again, no sooner than the gap", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["on"] });
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer, now: time.now, random: time.random });
  const watch = removalWatch(time.now);
  await time.settle();
  expect(p.log.filter((step) => step === "register")).toHaveLength(1);
  // Registered, its summary synced, then removed from the dashboard a second later.
  expect(watch.see(true, true)).toBeUndefined();
  await time.elapse(1_000);
  expect(watch.see(false, true)).toBe("again");
  cycle.nudge();
  expect(time.pending()).toEqual([MIN_TRY_GAP_MS - 1_000]);
  await time.elapse(MIN_TRY_GAP_MS);
  expect(p.log.filter((step) => step === "register")).toHaveLength(2);
  // The same view again (the row still missing until the registration's lands) asks for nothing more.
  expect(watch.see(false, true)).toBeUndefined();
  await cycle.stop();
});

test("a device registered before its row synced is not taken as removed, nor one the app holds unregistered", () => {
  const watch = removalWatch(() => 0);
  expect(watch.see(undefined, true)).toBeUndefined();
  expect(watch.see(false, true)).toBeUndefined();
  expect(watch.see(true, false)).toBeUndefined();
  expect(watch.see(false, false)).toBeUndefined();
  expect(watch.see(true, true)).toBeUndefined();
  // Loading again (a reconnect) is not a removal either.
  expect(watch.see(undefined, true)).toBeUndefined();
  expect(watch.see(false, true)).toBe("again");
});

test("a device the server keeps removing is chased a few times an hour, then left to the member", () => {
  let now = 0;
  const watch = removalWatch(() => now);
  const remove = () => {
    expect(watch.see(true, true)).toBeUndefined();
    now += 60_000;
    return watch.see(false, true);
  };
  for (let n = 0; n < REMOVAL_TRIES; n++) expect(remove()).toBe("again");
  expect(remove()).toBe("gave_up");
  expect(remove()).toBe("gave_up");
  // An hour after the first try, one more is allowed.
  now = REMOVAL_WINDOW_MS + 60_000;
  expect(remove()).toBe("again");
});
