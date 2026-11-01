// Registering with relay handles, and each instance on its own (RFC 0015 sections 5 and 7). Paging paths (AGENTS.md):
// a refused handle, a relay that does not answer or a failing instance must never leave the phone unregistered
// elsewhere.
import {
  createMemoryStore,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type Store,
} from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import {
  registerEverywhere,
  registerPhone,
  registrationsLeft,
  type DeviceDeps,
  type RegisterAnswer,
  type Registrations,
} from "./device";
import { pagingCycle } from "./paging";
import { withHandle, type InstanceConfig } from "./relay";

const KEY = `BA${"abcdefghij".repeat(9).slice(0, 85)}`;
const ANA: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const HANDLE = `k1.${"h".repeat(40)}`;
const TAG = `${"t".repeat(42)}A`;
const RELAY = "https://relay.example.com";
const INSTANCE = `ins_${"a".repeat(22)}`;

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

function route(stores: Record<string, Store<BrigadeTables>>, actor: Actor) {
  return async (args: object, workspaces: string[]): Promise<RegisterAnswer> => {
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

function phone(mutate: DeviceDeps["mutate"], over: Partial<DeviceDeps> = {}): DeviceDeps {
  return {
    platform: "ios",
    apsEnvironment: "production",
    publicKey: async () => KEY,
    permission: async () => true,
    pushToken: async () => "ab".repeat(32),
    mutate,
    ...over,
  };
}

/** `withHandle` for an instance on this build's relay, the relay answering a fixed handle. */
function onRelay(config: () => Promise<InstanceConfig> = async () => relayConfig) {
  let stored: string | null = null;
  return withHandleDeps(
    config,
    () => stored,
    (raw) => (stored = raw),
  );
}

const relayConfig: InstanceConfig = {
  kind: "brigade",
  versioned: true,
  relay: { origin: RELAY, instance: INSTANCE },
};

function withHandleDeps(
  config: () => Promise<InstanceConfig>,
  read: () => string | null,
  write: (raw: string | null) => void,
): Pick<DeviceDeps, "handles" | "dropHandle"> {
  return {
    handles: (args) =>
      withHandle(args, {
        config,
        thisBuild: async () => RELAY,
        isDefault: true,
        read: async () => read(),
        write: async (raw) => write(raw),
        fetch: async () => ({ ok: true, json: async () => ({ handle: HANDLE, tag: TAG }) }),
        now: () => Date.now(),
      }),
    dropHandle: async () => write(null),
  };
}

test("with a relay, the shard gets the handle and its tag, never the tokens (RFC 0015 section 7)", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const deps = phone(shard(store)(ANA), {
    ...onRelay(),
    registerAll: route({ ws_one: store }, ANA),
  });
  expect(await registerEverywhere(deps, [], "ws_one")).toEqual({ ws_one: "on" });
  expect(store.scan("devices")).toMatchObject([
    { handle: HANDLE, tag: TAG, voip: false, envelope: 2, pushToken: null, voipToken: null },
  ]);
  // Registering again with nothing changed: the same row, no new event.
  expect(await registerEverywhere(deps, [], "ws_one")).toEqual({ ws_one: "on" });
  expect(store.scan("devices")).toHaveLength(1);
});

test("today's instance, without a relay in /config, keeps getting the raw tokens", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const deps = phone(shard(store)(ANA), {
    ...onRelay(async () => ({ kind: "brigade", versioned: true })),
    registerAll: route({ ws_one: store }, ANA),
  });
  expect(await registerEverywhere(deps, [], "ws_one")).toEqual({ ws_one: "on" });
  expect(store.scan("devices")).toMatchObject([
    { pushToken: "ab".repeat(32), handle: null, envelope: 2 },
  ]);
});

test.each(["invalid_args", "bad_handle", "handle_not_yours"])(
  "a handle refused with %s is dropped, the raw tokens sent at once, and a new handle asked for next time",
  async (code) => {
    const sent: object[] = [];
    let stored: string | null = null;
    let writes = 0;
    const relay = withHandleDeps(
      async () => relayConfig,
      () => stored,
      (raw) => {
        writes += 1;
        stored = raw;
      },
    );
    const deps = phone(async () => ({ ok: true }), {
      ...relay,
      registerAll: async (args, workspaces) => {
        sent.push(args);
        return {
          ok: true,
          workspaces: Object.fromEntries(
            workspaces.map((id) => [id, "handle" in args ? code : "ok"]),
          ),
        };
      },
    });
    expect(await registerEverywhere(deps, ["ws_two"], "ws_one")).toEqual({
      ws_one: "on",
      ws_two: "on",
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toHaveProperty("handle", HANDLE);
    expect(sent[1]).toMatchObject({ pushToken: "ab".repeat(32), envelope: 2 });
    expect(sent[1]).not.toHaveProperty("handle");
    // Kept, then dropped.
    expect(writes).toBe(2);
    expect(stored).toBeNull();
  },
);

test("over the socket too: a refused handle falls back to the tokens, then to what an older shard knows", async () => {
  const sent: object[] = [];
  const deps = phone(async (_name, args) => {
    sent.push(args);
    // A shard from before handles and envelopes refuses every key it does not know.
    return "handle" in args || "envelope" in args
      ? { ok: false, error: { code: "invalid_args", message: "Unknown key" } }
      : { ok: true };
  }, onRelay());
  expect(await registerPhone(deps)).toBe("on");
  expect(sent).toHaveLength(3);
  expect(sent[2]).not.toHaveProperty("envelope");
  expect(sent[2]).toHaveProperty("pushToken", "ab".repeat(32));
});

test("an instance on another relay registers nothing and says so, without retrying on a timer", async () => {
  let sent = 0;
  const deps = phone(
    async () => {
      sent += 1;
      return { ok: true };
    },
    {
      handles: async () => "foreign",
      registerAll: async () => {
        sent += 1;
        return { ok: true, workspaces: {} };
      },
    },
  );
  const registered = await registerEverywhere(deps, ["ws_two"], "ws_one");
  expect(registered).toEqual({ ws_one: "foreign", ws_two: "foreign" });
  expect(registrationsLeft(registered)).toBe(false);
  expect(sent).toBe(0);
});

test("asking for a handle that throws still registers the tokens", async () => {
  const store = createMemoryStore<BrigadeTables>();
  const deps = phone(shard(store)(ANA), {
    handles: async () => {
      throw new Error("relay down");
    },
  });
  expect(await registerPhone(deps)).toBe("on");
  expect(store.scan("devices")).toMatchObject([{ pushToken: "ab".repeat(32), handle: null }]);
});

/** Timers run by hand, as src/lib/paging.test.ts does. */
function clock() {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  return {
    now: () => now,
    setTimer: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((one) => one !== timer);
      };
    },
    pending: () => timers.length,
    async advance(ms: number) {
      now += ms;
      const due = timers.filter((timer) => timer.at <= now);
      timers = timers.filter((timer) => timer.at > now);
      for (const timer of due) timer.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

test("each instance registers on its own backoff: one failing never holds back another (RFC 0015 section 5)", async () => {
  const healthy = createMemoryStore<BrigadeTables>();
  let brokenTries = 0;
  const instances = {
    // Freecorps' Brigade, answering.
    a: phone(shard(healthy)(ANA), { registerAll: route({ ws_a: healthy }, ANA) }),
    // Another instance, down: every registration fails.
    b: phone(async () => ({ ok: true }), {
      registerAll: async () => {
        brokenTries += 1;
        return { ok: false, status: 503 };
      },
    }),
  };
  const time = { a: clock(), b: clock() };
  const seen: Record<"a" | "b", Registrations[]> = { a: [], b: [] };
  const cycles = (["a", "b"] as const).map((id) =>
    pagingCycle({
      finish: async () => "none",
      register: (proceed) => registerEverywhere(instances[id], [], `ws_${id}`, proceed),
      onPaging: (registrations) => seen[id].push(registrations),
      setTimer: time[id].setTimer,
      now: time[id].now,
      random: () => 0.5,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(seen.a).toEqual([{ ws_a: "on" }]);
  expect(seen.b).toEqual([{ ws_b: "failed" }]);
  // Only the failing one waits to try again; the healthy one has nothing left to do.
  expect(time.a.pending()).toBe(0);
  expect(time.b.pending()).toBe(1);
  await time.b.advance(5_000);
  expect(brokenTries).toBe(2);
  expect(seen.a).toHaveLength(1);
  // A new token nudges both: the healthy one registers again whatever the other is doing.
  cycles[0]!.nudge();
  await time.a.advance(5_000);
  expect(seen.a).toEqual([{ ws_a: "on" }, { ws_a: "on" }]);
  for (const cycle of cycles) await cycle.stop();
});
