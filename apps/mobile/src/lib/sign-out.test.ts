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
  parseLeftover,
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
    save: async (leftover) => {
      phoneState.kept = JSON.stringify(leftover);
    },
  });

  const finishDeps: FinishDeps = {
    load: async () => parseLeftover(phoneState.kept),
    save: async (leftover) => {
      phoneState.kept = JSON.stringify(leftover);
    },
    clear: async () => {
      phoneState.kept = null;
    },
    session: async (cookie) => (network.offline ? null : sessions.has(cookie)),
    unregister: (leftover) => unregisterPhone(phone(as(actors[leftover.userId]!)), 10),
    signOut: async (cookie) => {
      if (network.offline) return false;
      sessions.delete(cookie);
      return true;
    },
  };

  return { store, network, as, sessions, phoneState, signOutDeps, finishDeps };
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
  expect(parseLeftover(w.phoneState.kept)).toEqual({
    cookie: "ana-cookie",
    userId: ANA.id,
    workspaceId: WORKSPACE,
  });
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
  expect(parseLeftover(w.phoneState.kept)).toMatchObject({ workspaceId: null });
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
  expect(parseLeftover(w.phoneState.kept)).toMatchObject({ workspaceId: null });
  expect(await finishSignOut({ ...w.finishDeps, signOut })).toBe("finished");
});

test("a kept sign-out that is not one is ignored", () => {
  const ok: Leftover = { cookie: "c", userId: "usr_a", workspaceId: null };
  expect(parseLeftover(JSON.stringify(ok))).toEqual(ok);
  for (const raw of [
    null,
    "",
    "{}",
    "[]",
    "nope",
    '{"cookie":"","userId":"u","workspaceId":null}',
  ]) {
    expect(parseLeftover(raw)).toBeNull();
  }
});
