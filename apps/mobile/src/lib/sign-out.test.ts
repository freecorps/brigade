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
import {
  finishSignOut,
  leftovers,
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
  });

  const finishDeps: FinishDeps = {
    leftovers: kept,
    origin: ORIGIN,
    now: () => clock.now,
    lifetime: LIFETIME,
    session: async (cookie) => (network.offline ? null : sessions.has(cookie)),
    unregister: (leftover) => unregisterPhone(phone(as(actors[leftover.userId]!)), 10),
    signOut: async (cookie) => {
      if (network.offline) return false;
      sessions.delete(cookie);
      return true;
    },
  };

  return { store, network, as, sessions, phoneState, clock, kept, signOutDeps, finishDeps };
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
      savedAt: w.clock.now,
    },
  ]);
  // Revoking it now would leave nothing that can take the phone off the shard.
  expect(w.sessions.has("ana-cookie")).toBe(true);
  expect(w.store.scan("devices")).toMatchObject([{ userId: ANA.id }]);
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

test("a kept sign-out that is not one is ignored", () => {
  const ok: Leftover = {
    cookie: "c",
    userId: "usr_a",
    workspaceId: null,
    origin: ORIGIN,
    savedAt: 1,
  };
  expect(parseLeftovers(JSON.stringify([ok]))).toEqual([ok]);
  // A record from before origins and times were kept cannot be told apart from another server's: dropped.
  const { origin: _origin, savedAt: _savedAt, ...old } = ok;
  expect(parseLeftovers(JSON.stringify([old, ok]))).toEqual([ok]);
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
