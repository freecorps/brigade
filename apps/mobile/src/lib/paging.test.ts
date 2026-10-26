import { expect, test } from "vite-plus/test";
import { registerPhone, type DeviceDeps, type Paging } from "./device";
import { pagingCycle, retryDelay, type PagingDeps } from "./paging";
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
    register: async () => {
      log.push("register");
      return next(answers.register);
    },
    onPaging: (paging: Paging) => shown.push(paging),
  };
}

test("the waits back off to every ten minutes", () => {
  expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([30_000, 120_000, 600_000, 600_000, 600_000]);
});

test("a phone with nothing left registers once, after finishing, and does not try again", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["on"] });
  pagingCycle({ ...p, setTimer: time.setTimer });
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
  pagingCycle({ ...p, setTimer: time.setTimer });
  await time.settle();
  expect(p.shown).toEqual(["taken"]);
  expect(time.pending()).toEqual([30_000]);
  await time.elapse(30_000);
  expect(p.shown).toEqual(["taken", "taken"]);
  expect(time.pending()).toEqual([120_000]);
  await time.elapse(120_000);
  // Finished first, then registered: the phone pages the member signed in now.
  expect(p.log).toEqual(["finish", "register", "finish", "register", "finish", "register"]);
  expect(p.shown).toEqual(["taken", "taken", "on"]);
  expect(time.pending()).toEqual([]);
});

test("a registration that failed or found the phone taken is tried again, every ten minutes at most", async () => {
  const time = clock();
  const p = phone({ finish: ["none"], register: ["failed"] });
  pagingCycle({ ...p, setTimer: time.setTimer });
  await time.settle();
  await time.elapse(30_000 + 120_000 + 600_000);
  expect(p.shown).toEqual(["failed", "failed", "failed", "failed"]);
  expect(time.pending()).toEqual([600_000]);
});

test("with nobody signed in, a kept sign-out is still finished on the backoff", async () => {
  const time = clock();
  const p = phone({ finish: ["pending", "finished"], register: [] });
  pagingCycle({ ...p, register: null, setTimer: time.setTimer });
  await time.settle();
  expect(time.pending()).toEqual([30_000]);
  await time.elapse(30_000);
  expect(p.log).toEqual(["finish", "finish"]);
  expect(p.shown).toEqual([]);
  expect(time.pending()).toEqual([]);
});

test("Try again, the foreground or a reconnect tries now instead of waiting, keeping one wait", async () => {
  const time = clock();
  const p = phone({
    finish: ["pending", "pending", "finished"],
    register: ["taken", "taken", "on"],
  });
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer });
  await time.settle();
  expect(time.pending()).toEqual([30_000]);
  await cycle.retry();
  expect(p.shown).toEqual(["taken", "taken"]);
  // The backoff carries on from where it was, and the old wait is gone.
  expect(time.pending()).toEqual([120_000]);
  await cycle.retry();
  expect(p.shown).toEqual(["taken", "taken", "on"]);
  expect(time.pending()).toEqual([]);
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
      return "on";
    },
    onPaging: () => {},
    setTimer: time.setTimer,
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
  const cycle = pagingCycle({ ...p, setTimer: time.setTimer });
  cycle.stop();
  await time.settle();
  expect(p.shown).toEqual([]);
  expect(time.pending()).toEqual([]);
  await cycle.retry();
  expect(p.log).toEqual(["finish"]);
});

test("signing out while a registration waits for the push token sends no device.register", async () => {
  const time = clock();
  const sent: string[] = [];
  let token!: (value: string) => void;
  const deps: DeviceDeps = {
    platform: "ios",
    apsEnvironment: "development",
    publicKey: async () => `BA${"abcdefghij".repeat(9).slice(0, 85)}`,
    permission: async () => true,
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
    register: (proceed) => registerPhone(deps, proceed),
    onPaging: (paging) => shown.push(paging),
    setTimer: time.setTimer,
  });
  await time.settle();
  // Sign-out starts: it waits for the registration still asking for the token.
  let stopped = false;
  const stopping = cycle.stop().then(() => {
    stopped = true;
  });
  await time.settle();
  expect(stopped).toBe(false);
  token("ab".repeat(32));
  await stopping;
  // Only now does it unregister, and nothing it would have to undo went out.
  expect(sent).toEqual([]);
  expect(shown).toEqual([]);
  expect(time.pending()).toEqual([]);
});

test("stopping during a registration already sent resolves without waiting for the shard's answer", async () => {
  const time = clock();
  const sent: string[] = [];
  const cycle = pagingCycle({
    finish: async () => "none",
    register: async (proceed) => {
      if (!proceed()) return "pending";
      sent.push("device.register");
      // Offline: the shard never answers. The unregister sent after it on the same socket undoes it.
      return new Promise<Paging>(() => {});
    },
    onPaging: () => {},
    setTimer: time.setTimer,
  });
  await time.settle();
  await cycle.stop();
  expect(sent).toEqual(["device.register"]);
});

test("a finish or registration that throws counts as not done, not as a crash", async () => {
  const time = clock();
  const shown: Paging[] = [];
  pagingCycle({
    finish: () => Promise.reject(new Error("storage")),
    register: () => Promise.reject(new Error("socket")),
    onPaging: (paging) => shown.push(paging),
    setTimer: time.setTimer,
  });
  await time.settle();
  expect(shown).toEqual(["failed"]);
  expect(time.pending()).toEqual([30_000]);
});
