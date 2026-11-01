// The instances on the phone (RFC 0015 section 5): at most 5, one active, each with storage of its own, and an install
// from before several instances becoming the build's default instance with everything it had.
import { describe, expect, test } from "vite-plus/test";
import {
  activeInstance,
  addAndKeep,
  DEFAULT_INSTANCE,
  firstInstances,
  instanceAt,
  instancesStore,
  instanceStorage,
  MAX_INSTANCES,
  readInstances,
  sessionHome,
  withActive,
  withInstance,
  withoutInstance,
  writeInstances,
} from "./instances";
import { PHONE_WORKSPACES_KEY } from "./phone-workspaces";
import { WORKSPACE_KEY } from "./sync";

const BUILD = "https://brigade.example.com";
const ACME = "https://brigade.acme.example";

describe("an install from before several instances", () => {
  test("becomes the build's default instance, active, with the keys it had", () => {
    expect(readInstances(null, BUILD)).toEqual({
      instances: [{ id: DEFAULT_INSTANCE, origin: BUILD }],
      active: DEFAULT_INSTANCE,
    });
    // `@better-auth/expo` with the prefix it had keeps reading `brigade_cookie`: still signed in.
    expect(instanceStorage(DEFAULT_INSTANCE)).toEqual({
      auth: "brigade",
      workspaces: PHONE_WORKSPACES_KEY,
      workspace: WORKSPACE_KEY,
      handle: "brigade.handle",
    });
  });

  test("a build without a server has no instance", () => {
    expect(readInstances(null, undefined)).toEqual({ instances: [], active: null });
    expect(activeInstance(firstInstances(undefined))).toBeUndefined();
  });

  test("the default instance follows the build's origin (a new address, a development build's Metro host)", () => {
    const stored = writeInstances({
      instances: [{ id: DEFAULT_INSTANCE, origin: "http://192.168.1.5:5173" }],
      active: DEFAULT_INSTANCE,
    });
    expect(readInstances(stored, "http://localhost:5173").instances).toEqual([
      { id: DEFAULT_INSTANCE, origin: "http://localhost:5173" },
    ]);
  });
});

describe("storage is per instance", () => {
  test("every other instance has keys of its own, under `brigade:<id>`", () => {
    const acme = instanceStorage("acme1");
    expect(acme.auth).toBe("brigade:acme1");
    const all = [instanceStorage(DEFAULT_INSTANCE), acme, instanceStorage("other2")];
    for (const field of ["auth", "workspaces", "workspace", "handle"] as const) {
      expect(new Set(all.map((storage) => storage[field])).size).toBe(3);
    }
  });
});

describe("the list", () => {
  const two = withInstance(firstInstances(BUILD), `${ACME}/login`, "acme1");

  test("adds an instance by its origin, once, without making it active", () => {
    if (typeof two === "string") throw new Error(two);
    expect(two.instance).toEqual({ id: "acme1", origin: ACME });
    expect(two.list.active).toBe(DEFAULT_INSTANCE);
    const again = withInstance(two.list, ACME, "other");
    expect(again).toEqual({ list: two.list, instance: two.instance });
    expect(withInstance(two.list, "ftp://x", "x")).toBe("invalid");
    expect(withInstance(two.list, ACME.replace("acme", "beta"), "not ok!")).toBe("invalid");
  });

  test(`holds at most ${MAX_INSTANCES}`, () => {
    let list = firstInstances(BUILD);
    for (let i = 1; i < MAX_INSTANCES; i += 1) {
      const added = withInstance(list, `https://b${i}.example.com`, `b${i}`);
      if (typeof added === "string") throw new Error(added);
      list = added.list;
    }
    expect(list.instances).toHaveLength(MAX_INSTANCES);
    expect(withInstance(list, "https://one-more.example.com", "more")).toBe("full");
  });

  test("finds an instance by any URL of it; removing the active one activates the first left", () => {
    if (typeof two === "string") throw new Error(two);
    expect(instanceAt(two.list, `${ACME}/api/auth`)?.id).toBe("acme1");
    expect(instanceAt(two.list, "https://elsewhere.example")).toBeUndefined();
    const onAcme = withActive(two.list, "acme1");
    expect(activeInstance(onAcme)?.id).toBe("acme1");
    expect(withActive(onAcme, "nope")).toBe(onAcme);
    expect(withoutInstance(onAcme, "acme1").active).toBe(DEFAULT_INSTANCE);
    expect(withoutInstance(withoutInstance(onAcme, "acme1"), DEFAULT_INSTANCE)).toEqual({
      instances: [],
      active: null,
    });
  });

  test("reads what it wrote, and drops what is not an instance", () => {
    if (typeof two === "string") throw new Error(two);
    expect(readInstances(writeInstances(two.list), BUILD)).toEqual(two.list);
    const messy = JSON.stringify({
      instances: [
        { id: DEFAULT_INSTANCE, origin: BUILD },
        { id: "acme1", origin: ACME },
        { id: "acme2", origin: `${ACME}/again` },
        { id: "bad id", origin: "https://x.example" },
        { id: "noorigin" },
        { id: "ftp1", origin: "ftp://x.example" },
        "nope",
        ...Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, origin: `https://x${i}.example` })),
      ],
      active: "gone",
    });
    const read = readInstances(messy, BUILD);
    expect(read.instances.map((one) => one.id)).toEqual([
      DEFAULT_INSTANCE,
      "acme1",
      "x0",
      "x1",
      "x2",
    ]);
    expect(read.active).toBe(DEFAULT_INSTANCE);
    expect(readInstances("{", BUILD)).toEqual(firstInstances(BUILD));
  });
});

describe("the store", () => {
  function storage(initial: string | null = null) {
    let raw = initial;
    let failing = false;
    const writes: string[] = [];
    return {
      deps: {
        read: async () => {
          if (failing) throw new Error("locked");
          return raw;
        },
        write: async (next: string) => {
          writes.push(next);
          raw = next;
        },
        defaultOrigin: BUILD,
        newId: (() => {
          let n = 0;
          return () => `id${(n += 1)}`;
        })(),
      },
      writes,
      raw: () => raw,
      fail: (value: boolean) => (failing = value),
    };
  }

  test("opens on the build's default instance before anything is read, then on what was stored", async () => {
    const stored = writeInstances({
      instances: [
        { id: DEFAULT_INSTANCE, origin: BUILD },
        { id: "acme1", origin: ACME },
      ],
      active: "acme1",
    });
    const kept = storage(stored);
    const store = instancesStore(kept.deps);
    expect(store.current()).toEqual(firstInstances(BUILD));
    let told = 0;
    store.subscribe(() => (told += 1));
    expect(activeInstance(await store.load())?.id).toBe("acme1");
    expect(told).toBe(1);
    // Reading writes nothing: an install that never adds an instance keeps storage as it was.
    expect(kept.writes).toEqual([]);
  });

  test("adds, activates and removes, each change on what the one before wrote", async () => {
    const kept = storage();
    const store = instancesStore(kept.deps);
    const [acme, beta] = await Promise.all([
      store.add(ACME),
      store.add("https://beta.example.com"),
    ]);
    expect(acme).toEqual({ instance: { id: "id1", origin: ACME }, created: true });
    expect(beta).toEqual({
      instance: { id: "id2", origin: "https://beta.example.com" },
      created: true,
    });
    await store.activate("id2");
    expect(activeInstance(store.current())?.id).toBe("id2");
    await store.remove("id2");
    expect(store.current()).toEqual({
      instances: [
        { id: DEFAULT_INSTANCE, origin: BUILD },
        { id: "id1", origin: ACME },
      ],
      active: DEFAULT_INSTANCE,
    });
    expect(await store.add(ACME)).toEqual({
      instance: { id: "id1", origin: ACME },
      created: false,
    });
  });

  test("the build's default instance, removed and added again, comes back as itself", async () => {
    const kept = storage();
    const store = instancesStore(kept.deps);
    await store.add(ACME);
    await store.remove(DEFAULT_INSTANCE);
    expect(store.current().instances.map((one) => one.id)).toEqual(["id1"]);
    expect(await store.add(`${BUILD}/sign-in`)).toEqual({
      instance: { id: DEFAULT_INSTANCE, origin: BUILD },
      created: true,
    });
  });

  test("the member's Remove never leaves no instance, decided on the stored list in turn", async () => {
    const kept = storage();
    const store = instancesStore(kept.deps);
    await store.add(ACME);
    // Two removals at once: the first goes, the second would leave none and is refused.
    const [first, second] = await Promise.all([
      store.removeUnlessLast(DEFAULT_INSTANCE),
      store.removeUnlessLast("id1"),
    ]);
    expect([first, second]).toEqual(["removed", "last"]);
    expect(store.current().instances.map((one) => one.id)).toEqual(["id1"]);
    expect(await store.removeUnlessLast("nope")).toBe("last");
    // The shared remove (a sign-in's rollback) is not limited.
    await store.remove("id1");
    expect(store.current().instances).toEqual([]);
  });

  test("a failed keep removes only a row this call created, never one already stored", async () => {
    // Acme is stored but not read into memory yet (the store was never loaded).
    const kept = storage(
      writeInstances({
        instances: [
          { id: DEFAULT_INSTANCE, origin: BUILD },
          { id: "acme1", origin: ACME },
        ],
        active: DEFAULT_INSTANCE,
      }),
    );
    const store = instancesStore(kept.deps);
    expect(instanceAt(store.current(), ACME)).toBeUndefined();
    const refused = async () => {
      throw new Error("A session is kept for this instance already");
    };
    await expect(addAndKeep(store, ACME, refused)).rejects.toThrow("kept");
    expect(instanceAt(store.current(), ACME)?.id).toBe("acme1");
    expect(readInstances(kept.raw(), BUILD).instances.map((one) => one.id)).toEqual([
      DEFAULT_INSTANCE,
      "acme1",
    ]);
    // A new one this call added goes again.
    await expect(addAndKeep(store, "https://beta.example.com", refused)).rejects.toThrow();
    expect(instanceAt(store.current(), "https://beta.example.com")).toBeUndefined();
    // Kept: listed, with what `keep` was given.
    const seen: string[] = [];
    const beta = await addAndKeep(store, "https://beta.example.com", async (one) => {
      seen.push(one.id);
    });
    expect(seen).toEqual([beta.id]);
    expect(instanceAt(store.current(), "https://beta.example.com")).toEqual(beta);
  });

  test("where a session for an origin would be kept: listed, or the build's own under its keys from before", () => {
    const list = {
      instances: [{ id: "acme1", origin: ACME }],
      active: "acme1",
    };
    expect(sessionHome(list, `${ACME}/x`, BUILD)).toEqual({ id: "acme1", origin: ACME });
    // The build's own instance, removed: a cookie may be left under `brigade`.
    expect(sessionHome(list, BUILD, BUILD)).toEqual({ id: DEFAULT_INSTANCE, origin: BUILD });
    expect(instanceStorage(sessionHome(list, BUILD, BUILD)!.id).auth).toBe("brigade");
    // An origin the phone never had: nothing can be kept for it.
    expect(sessionHome(list, "https://new.example.com", BUILD)).toBeUndefined();
    expect(sessionHome(list, "not a url", BUILD)).toBeUndefined();
  });

  test("a list it cannot read is never overwritten", async () => {
    const kept = storage(
      writeInstances({ instances: [{ id: "acme1", origin: ACME }], active: "acme1" }),
    );
    kept.fail(true);
    const store = instancesStore(kept.deps);
    expect(await store.load()).toEqual(firstInstances(BUILD));
    await expect(store.add("https://beta.example.com")).rejects.toThrow("locked");
    expect(kept.writes).toEqual([]);
  });
});
