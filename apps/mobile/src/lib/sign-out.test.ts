import {
  createMemoryStore,
  runMutation,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type Store,
} from "@freecorps/brigade-schema";
import { expect, test } from "vite-plus/test";
import { registerPhone, unregisterPhone, type DeviceDeps } from "./device";
import { needsRetry } from "./paging";
import {
  finishSignOut,
  leftovers,
  MAX_KEPT,
  parseLeftovers,
  signOutPhone,
  type FinishDeps,
  type Leftover,
  type SignOutDeps,
} from "./sign-out";

// An uncompressed P-256 point's shape (0x04 then 64 bytes), base64url.
const KEY = `BA${"abcdefghij".repeat(9).slice(0, 85)}`;
const ANA: Actor = { kind: "user", id: "usr_ana", role: "responder" };
const BIA: Actor = { kind: "user", id: "usr_bia", role: "responder" };
const WORKSPACE = "org_test";
const ORIGIN = "http://10.0.2.2:5173/api/auth";
const DAY = 24 * 60 * 60 * 1000;
const LIFETIME = 7 * DAY;

/** The shard's own device mutations on one store, as `actor`; `offline` makes every call hang. */
function shard(store: Store<BrigadeTables>, network: { offline: boolean }) {
  return (actor: Actor): DeviceDeps["mutate"] =>
    (name, args) => {
      if (network.offline) return new Promise(() => {});
      const result = runMutation(serverMutations, name, args, store, {
        actor,
        now: Date.now(),
        server: true,
      });
      return Promise.resolve(result.ok ? { ok: true } : { ok: false, error: result.error });
    };
}

function phone(mutate: DeviceDeps["mutate"]): DeviceDeps {
  return {
    platform: "ios",
    apsEnvironment: "development",
    publicKey: async () => KEY,
    permission: async () => true,
    pushToken: async () => "ab".repeat(32),
    mutate,
  };
}

/**
 * One phone: Better Auth's server sessions by cookie, the session stored here, the kept sign-out in secure storage,
 * and the shard, all behind one network switch.
 */
function world() {
  const store = createMemoryStore<BrigadeTables>();
  const network = { offline: false };
  const as = shard(store, network);
  const sessions = new Map<string, string>([
    ["ana-cookie", ANA.id],
    ["bia-cookie", BIA.id],
  ]);
  const actors: Record<string, Actor> = { [ANA.id]: ANA, [BIA.id]: BIA };
  const phoneState = { cookie: "ana-cookie", kept: null as string | null };
  const clock = { now: 1_000_000 };
  // When each session expires on the server: past it, the server no longer knows it.
  const expiries = new Map<string, number>(
    [...sessions.keys()].map((cookie) => [cookie, clock.now + LIFETIME]),
  );
  const known = (cookie: string) => {
    if ((expiries.get(cookie) ?? 0) <= clock.now) sessions.delete(cookie);
    return sessions.has(cookie);
  };
  const kept = leftovers({
    read: async () => phoneState.kept,
    write: async (raw) => {
      phoneState.kept = raw;
    },
  });

  const signOutDeps = (actor: Actor): SignOutDeps => ({
    cookie: async () => phoneState.cookie,
    unregister: () => unregisterPhone(phone(as(actor)), 10),
    signOut: async () => {
      // Better Auth's Expo client forgets the stored session before the request goes out.
      const cookie = phoneState.cookie;
      phoneState.cookie = "";
      if (network.offline) return false;
      sessions.delete(cookie);
      return true;
    },
    forget: async () => {
      phoneState.cookie = "";
    },
    add: kept.add,
    origin: ORIGIN,
    now: () => clock.now,
    lifetime: LIFETIME,
  });

  const finishDeps: FinishDeps = {
    leftovers: kept,
    origin: ORIGIN,
    now: () => clock.now,
    lifetime: LIFETIME,
    session: async (cookie) => {
      if (network.offline) return null;
      return known(cookie) ? { expiresAt: expiries.get(cookie)! } : false;
    },
    unregister: (leftover) => unregisterPhone(phone(as(actors[leftover.userId]!)), 10),
    signOut: async (cookie) => {
      if (network.offline) return false;
      sessions.delete(cookie);
      return true;
    },
  };

  return {
    store,
    network,
    as,
    sessions,
    expiries,
    phoneState,
    clock,
    kept,
    signOutDeps,
    finishDeps,
  };
}

test("signing out online takes the phone off the shard and keeps nothing", async () => {
  const w = world();
  expect(await registerPhone(phone(w.as(ANA)))).toBe("on");
  const result = await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  expect(result).toBe("released");
  expect(w.store.scan("devices")).toEqual([]);
  expect(w.phoneState).toEqual({ cookie: "", kept: null });
  expect(w.sessions.has("ana-cookie")).toBe(false);
});

test("signing out offline signs out here but keeps the session aside, unrevoked, to finish with", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  const result = await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  // The app says the phone may still page Ana until it is back online.
  expect(result).toBe("kept");
  expect(w.phoneState.cookie).toBe("");
  expect(parseLeftovers(w.phoneState.kept)).toEqual([
    {
      cookie: "ana-cookie",
      userId: ANA.id,
      workspaceId: WORKSPACE,
      origin: ORIGIN,
      expiresAt: w.clock.now + LIFETIME,
      keptAt: w.clock.now,
    },
  ]);
  // Revoking it now would leave nothing that can take the phone off the shard.
  expect(w.sessions.has("ana-cookie")).toBe(true);
  expect(w.store.scan("devices")).toMatchObject([{ userId: ANA.id }]);
});

test("an unregister that throws is kept like one that timed out, not an error out of sign-out", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  const deps = w.signOutDeps(ANA);
  const result = await signOutPhone(
    { userId: ANA.id, workspaceId: WORKSPACE },
    { ...deps, unregister: () => Promise.reject(new Error("socket gone")) },
  );
  expect(result).toBe("kept");
  expect(w.phoneState.cookie).toBe("");
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([
    { cookie: "ana-cookie", workspaceId: WORKSPACE },
  ]);
  expect(w.sessions.has("ana-cookie")).toBe(true);
});

test("back online, the kept session takes the phone off, so the next member to sign in is paged on it", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));

  // Bia signs in while still offline: nothing to finish yet, and the phone is still Ana's.
  expect(await finishSignOut(w.finishDeps)).toBe("pending");
  w.network.offline = false;
  expect(await registerPhone(phone(w.as(BIA)))).toBe("taken");

  // Online again: the app finishes Ana's sign-out before registering again.
  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.phoneState.kept).toBeNull();
  expect(w.sessions.has("ana-cookie")).toBe(false);
  expect(await registerPhone(phone(w.as(BIA)))).toBe("on");
  expect(w.store.scan("devices")).toMatchObject([{ userId: BIA.id }]);
  expect(await finishSignOut(w.finishDeps)).toBe("none");
});

test("a kept session the server no longer knows is dropped, not retried forever", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  w.network.offline = false;
  // Expired or revoked from another device meanwhile: nothing can take the phone off as Ana now (RFC 0006).
  w.sessions.delete("ana-cookie");
  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.phoneState.kept).toBeNull();
  expect(await registerPhone(phone(w.as(BIA)))).toBe("taken");
});

test("a sign-out the server did not answer is revoked later; the phone was already off", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  const deps = w.signOutDeps(ANA);
  // The shard answered, then the connection dropped before the sign-out request.
  const unregister = deps.unregister!;
  deps.unregister = async () => {
    const done = await unregister();
    w.network.offline = true;
    return done;
  };
  expect(await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, deps)).toBe("released");
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([{ workspaceId: null }]);
  expect(w.store.scan("devices")).toEqual([]);

  w.network.offline = false;
  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.sessions.has("ana-cookie")).toBe(false);
});

test("the shard taking the phone off but the revoke failing leaves only the revoke to do", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  w.network.offline = false;
  const signOut = w.finishDeps.signOut;
  const deps: FinishDeps = { ...w.finishDeps, signOut: async () => false };
  expect(await finishSignOut(deps)).toBe("pending");
  expect(w.store.scan("devices")).toEqual([]);
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([{ workspaceId: null }]);
  expect(await finishSignOut({ ...w.finishDeps, signOut })).toBe("finished");
});

test("a sign-out with no session to keep says the phone cannot be freed, not that it was kept", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  const deps = { ...w.signOutDeps(ANA), cookie: async () => "" };
  expect(await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, deps)).toBe("stuck");
  expect(w.phoneState.kept).toBeNull();
  // Nor when secure storage refuses the write.
  const failing = { ...w.signOutDeps(ANA), add: () => Promise.reject(new Error("full")) };
  expect(await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, failing)).toBe("stuck");
});

test("two sign-outs kept before either finishes are both finished", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  // Ana signs out with the shard unreachable: kept.
  w.network.offline = true;
  expect(await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA))).toBe(
    "kept",
  );
  w.network.offline = false;
  // Ana's session cannot be checked yet (the auth server answers 5xx), so it is still pending.
  const down: FinishDeps = { ...w.finishDeps, session: async () => null };
  expect(await finishSignOut(down)).toBe("pending");
  // Bia signs in: the phone is still Ana's. Her device was never on the shard, so taking it off "works", but the
  // connection drops before her sign-out reaches the server: hers is kept too, without clobbering Ana's.
  w.phoneState.cookie = "bia-cookie";
  expect(await registerPhone(phone(w.as(BIA)))).toBe("taken");
  const bia = w.signOutDeps(BIA);
  bia.signOut = async () => {
    w.phoneState.cookie = "";
    return false;
  };
  expect(await signOutPhone({ userId: BIA.id, workspaceId: WORKSPACE }, bia)).toBe("released");
  expect(parseLeftovers(w.phoneState.kept).map((leftover) => leftover.userId)).toEqual([
    ANA.id,
    BIA.id,
  ]);

  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.store.scan("devices")).toEqual([]);
  expect(w.sessions.size).toBe(0);
  expect(w.phoneState.kept).toBeNull();
});

test("a sign-out kept while an earlier one is being finished is not cleared with it", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  w.network.offline = false;
  // Ana's revoke hangs until we let it answer.
  let answer!: () => void;
  const revoking = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const slow: FinishDeps = {
    ...w.finishDeps,
    signOut: async (cookie) => {
      await revoking;
      return w.finishDeps.signOut(cookie);
    },
  };
  const finishing = finishSignOut(slow);
  // Meanwhile Bia signs in on a phone that is already off the shard, and signs out offline.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(w.store.scan("devices")).toEqual([]);
  w.phoneState.cookie = "bia-cookie";
  expect(await registerPhone(phone(w.as(BIA)))).toBe("on");
  w.network.offline = true;
  expect(await signOutPhone({ userId: BIA.id, workspaceId: WORKSPACE }, w.signOutDeps(BIA))).toBe(
    "kept",
  );
  w.network.offline = false;
  answer();
  expect(await finishing).toBe("finished");
  // Only Ana's record went with her finish.
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([{ userId: BIA.id }]);
  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.store.scan("devices")).toEqual([]);
  expect(w.phoneState.kept).toBeNull();
});

test("a kept sign-out is finished only against its own server, and dropped once its session has expired", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  w.network.offline = false;
  // A development build now on another Metro host: Ana's session is not this server's to check.
  const elsewhere: FinishDeps = { ...w.finishDeps, origin: "http://localhost:5173/api/auth" };
  expect(await finishSignOut(elsewhere)).toBe("none");
  expect(parseLeftovers(w.phoneState.kept)).toHaveLength(1);
  expect(w.sessions.has("ana-cookie")).toBe(true);
  // A week on, the session is gone from the server either way.
  w.clock.now += LIFETIME;
  expect(await finishSignOut(elsewhere)).toBe("none");
  expect(w.phoneState.kept).toBeNull();
});

test("a sign-out kept against another server does not hold up registering for this one", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone(
    { userId: ANA.id, workspaceId: WORKSPACE },
    { ...w.signOutDeps(ANA), origin: "http://localhost:5173/api/auth" },
  );
  w.network.offline = false;
  // Not this server's to finish: nothing to retry for it, so Bia's registration result alone decides.
  const finished = await finishSignOut(w.finishDeps);
  expect(finished).toBe("none");
  expect(needsRetry(finished, "on")).toBe(false);
  expect(parseLeftovers(w.phoneState.kept)).toHaveLength(1);
});

test("a kept session the socket renews is kept for as long as the server keeps it", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  const keptAt = w.clock.now;
  w.network.offline = false;
  // Six days on, the phone opens Ana's socket, but the shard does not answer in time.
  w.clock.now += 6 * DAY;
  const silent: FinishDeps = {
    ...w.finishDeps,
    unregister: async (leftover) => {
      // Better Auth renews a session last renewed over a day ago on the upgrade.
      w.expiries.set(leftover.cookie, w.clock.now + LIFETIME);
      return false;
    },
  };
  expect(await finishSignOut(silent)).toBe("pending");
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([{ expiresAt: w.clock.now + LIFETIME }]);
  // Before a lifetime from when it was kept is up, the renewed session finishes it.
  w.clock.now = keptAt + LIFETIME - DAY;
  expect(await finishSignOut(w.finishDeps)).toBe("finished");
  expect(w.store.scan("devices")).toEqual([]);
  expect(w.sessions.has("ana-cookie")).toBe(false);
});

test("a removed member's kept sign-out is dropped and revoked a lifetime after it was kept, however often it renewed", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  const keptAt = w.clock.now;
  w.network.offline = false;
  // Ana is removed: /get-session still answers, and every upgrade renews the session before the 403.
  const refused: FinishDeps = {
    ...w.finishDeps,
    unregister: async (leftover) => {
      w.expiries.set(leftover.cookie, w.clock.now + LIFETIME);
      return false;
    },
  };
  for (let day = 2; day < 7; day += 2) {
    w.clock.now = keptAt + day * DAY;
    expect(await finishSignOut(refused)).toBe("pending");
  }
  const [renewed] = parseLeftovers(w.phoneState.kept);
  expect(renewed!.expiresAt).toBeGreaterThan(keptAt + LIFETIME);
  expect(w.sessions.has("ana-cookie")).toBe(true);
  // A lifetime after it was kept: dropped, and the session revoked once on the way out.
  w.clock.now = keptAt + LIFETIME;
  expect(await finishSignOut(refused)).toBe("none");
  expect(w.phoneState.kept).toBeNull();
  expect(w.sessions.has("ana-cookie")).toBe(false);
  // The phone stays Ana's on that shard (RFC 0006): only her removal from the shard frees it.
  expect(await registerPhone(phone(w.as(BIA)))).toBe("taken");
});

test("an expiry /get-session reports later than the kept one is stored", async () => {
  const w = world();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA));
  w.network.offline = false;
  w.expiries.set("ana-cookie", w.clock.now + 2 * LIFETIME);
  const down: FinishDeps = { ...w.finishDeps, unregister: async () => false };
  expect(await finishSignOut(down)).toBe("pending");
  expect(parseLeftovers(w.phoneState.kept)).toMatchObject([
    { expiresAt: w.clock.now + 2 * LIFETIME },
  ]);
});

test("a full list drops a sign-out already off its shard, never one still on it", async () => {
  const w = world();
  const record = (n: number, workspaceId: string | null): Leftover => ({
    cookie: `cookie-${n}`,
    userId: `usr_${n}`,
    workspaceId,
    origin: ORIGIN,
    expiresAt: w.clock.now + LIFETIME,
    keptAt: w.clock.now,
  });
  // One only left to revoke, then the rest still on their shards.
  await w.kept.add(record(0, null));
  for (let n = 1; n < MAX_KEPT; n++) await w.kept.add(record(n, WORKSPACE));
  await w.kept.add(record(MAX_KEPT, WORKSPACE));
  const cookies = (await w.kept.list()).map(({ cookie }) => cookie);
  expect(cookies).toHaveLength(MAX_KEPT);
  expect(cookies).not.toContain("cookie-0");
  // Every one is still on a shard: keeping Ana's would drop one of them, so it is refused and she is told.
  await expect(w.kept.add(record(99, WORKSPACE))).rejects.toThrow();
  await registerPhone(phone(w.as(ANA)));
  w.network.offline = true;
  expect(await signOutPhone({ userId: ANA.id, workspaceId: WORKSPACE }, w.signOutDeps(ANA))).toBe(
    "stuck",
  );
  expect((await w.kept.list()).map(({ cookie }) => cookie)).toEqual(cookies);
});

test("a kept sign-out that is not one is ignored", () => {
  const ok: Leftover = {
    cookie: "c",
    userId: "usr_a",
    workspaceId: null,
    origin: ORIGIN,
    expiresAt: 1,
    keptAt: 0,
  };
  expect(parseLeftovers(JSON.stringify([ok]))).toEqual([ok]);
  // A record from before origins and times were kept cannot be told apart from another server's, and one without
  // when it was kept has no limit: dropped.
  const { origin: _origin, expiresAt: _expiresAt, ...old } = ok;
  const { keptAt: _keptAt, ...unbounded } = ok;
  expect(parseLeftovers(JSON.stringify([old, unbounded, ok]))).toEqual([ok]);
  for (const raw of [
    null,
    "",
    "{}",
    "[]",
    "nope",
    JSON.stringify(ok),
    JSON.stringify([{ ...ok, cookie: "" }]),
  ]) {
    expect(parseLeftovers(raw)).toEqual([]);
  }
});
