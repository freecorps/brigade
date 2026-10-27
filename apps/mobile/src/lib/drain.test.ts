import { expect, test } from "vite-plus/test";
import { DRAIN_CHECK_MS, DRAIN_MAX_MS, drainer } from "./drain";

/** Timers run by hand. */
function clock() {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    elapse(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        now = due.at;
        due.run();
      }
      now = until;
    },
  };
}

function client(unsent: boolean) {
  const state = { unsent, closed: false };
  return { state, unsent: () => state.unsent, close: () => void (state.closed = true) };
}

// A paging path (AGENTS.md): an ack made while the socket was reconnecting must still reach the shard after the member
// switches workspaces, or the escalation goes on paging people.
test("switching away keeps the old workspace's client open until the shard confirmed its changes", () => {
  const time = clock();
  const drain = drainer(time);
  const old = client(true);
  drain.keep("ana:ws_one", old);
  time.elapse(DRAIN_CHECK_MS * 5);
  expect(old.state.closed).toBe(false);
  old.state.unsent = false;
  time.elapse(DRAIN_CHECK_MS);
  expect(old.state.closed).toBe(true);
  expect(drain.size()).toBe(0);
});

test("with nothing to send it closes at once; with changes stuck it closes after the bound, keeping them on the phone", () => {
  const time = clock();
  const drain = drainer(time);
  const idle = client(false);
  drain.keep("ana:ws_one", idle);
  expect(idle.state.closed).toBe(true);
  const stuck = client(true);
  drain.keep("ana:ws_two", stuck);
  time.elapse(DRAIN_MAX_MS - DRAIN_CHECK_MS);
  expect(stuck.state.closed).toBe(false);
  time.elapse(DRAIN_CHECK_MS);
  expect(stuck.state.closed).toBe(true);
});

test("switching back takes the same client again; signing out closes every draining one", () => {
  const time = clock();
  const drain = drainer(time);
  const one = client(true);
  const two = client(true);
  drain.keep("ana:ws_one", one);
  drain.keep("ana:ws_two", two);
  expect(drain.take("ana:ws_one")).toBe(one);
  expect(drain.take("ana:ws_one")).toBeUndefined();
  time.elapse(DRAIN_MAX_MS * 2);
  expect(one.state.closed).toBe(false);
  drain.closeAll();
  expect(two.state.closed).toBe(true);
  expect(drain.size()).toBe(0);
});
