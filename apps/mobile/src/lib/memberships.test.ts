import { expect, test } from "vite-plus/test";
import {
  keptWorkspace,
  listWorkspaces,
  membershipsStore,
  openingOf,
  parseMemberships,
  type Membership,
  type Memberships,
} from "./memberships";

const A: Membership = { id: "org_a", name: "Alpha", role: "owner" };
const B: Membership = { id: "org_b", name: "Beta", role: "responder" };
const kept = (workspaceId: string, userId = "usr_1") =>
  JSON.stringify({ userId, workspaceId, name: "Kept", role: "admin" });

function state(patch: Partial<Memberships>): Memberships {
  return { userId: "usr_1", error: false, loading: false, known: null, ...patch };
}

test("the answer is read as memberships; anything malformed is left out and an unknown role reads as viewer", () => {
  expect(
    parseMemberships({
      workspaces: [
        A,
        { id: "org_c", name: "Gamma", role: "boss" },
        { id: 3, name: "x" },
        null,
        { id: "", name: "empty" },
      ],
    }),
  ).toEqual([A, { id: "org_c", name: "Gamma", role: "viewer" }]);
  expect(parseMemberships({})).toBeUndefined();
  expect(parseMemberships(null)).toBeUndefined();
});

test("the list is asked for with the member's session; no answer or a refusal is undefined", async () => {
  let sent: RequestInit | undefined;
  const list = await listWorkspaces("https://x/api/workspaces", "s=1", async (_url, init) => {
    sent = init;
    return Response.json({ workspaces: [A] });
  });
  expect(list).toEqual([A]);
  expect(new Headers(sent?.headers).get("cookie")).toBe("s=1");
  expect(await listWorkspaces("u", "", async () => new Response(null, { status: 401 }))).toBe(
    undefined,
  );
  expect(await listWorkspaces("u", "", () => Promise.reject(new Error("offline")))).toBe(undefined);
});

test("only the member's own kept workspace is read", () => {
  expect(keptWorkspace(kept("org_a"), "usr_1")).toEqual({
    userId: "usr_1",
    workspaceId: "org_a",
    name: "Kept",
    role: "admin",
  });
  expect(keptWorkspace(kept("org_a"), "usr_2")).toBeNull();
  expect(keptWorkspace(JSON.stringify({ userId: "usr_1", workspaceId: "org_a" }), "usr_1")).toBe(
    null,
  );
  expect(keptWorkspace("{", "usr_1")).toBeNull();
  expect(keptWorkspace(null, "usr_1")).toBeNull();
});

test("the kept workspace opens while the list has it, else the hint, else the oldest", () => {
  const known = { userId: "usr_1", workspaceId: "org_b", name: "Old", role: "viewer" as const };
  expect(openingOf(state({ list: [A, B], known }))).toEqual({
    kind: "open",
    workspaceId: "org_b",
    name: "Beta",
    role: "responder",
    listed: true,
  });
  expect(openingOf(state({ list: [A, B] }), "org_b")).toMatchObject({ workspaceId: "org_b" });
  expect(openingOf(state({ list: [A], known }), "org_x")).toMatchObject({ workspaceId: "org_a" });
  expect(openingOf(state({ list: [], known }))).toEqual({ kind: "none" });
});

test("without a list, what was kept opens (offline), then the hint; nothing at all waits or is unavailable", () => {
  const known = { userId: "usr_1", workspaceId: "org_b", name: "Old", role: "viewer" as const };
  expect(openingOf(state({ known, error: true }))).toEqual({
    kind: "open",
    workspaceId: "org_b",
    name: "Old",
    role: "viewer",
    listed: false,
  });
  expect(openingOf(state({}), "org_h")).toEqual({
    kind: "open",
    workspaceId: "org_h",
    listed: false,
  });
  expect(openingOf(state({ loading: true }))).toEqual({ kind: "pending" });
  expect(openingOf(state({ error: true }))).toEqual({ kind: "unavailable" });
  expect(openingOf(state({ known: undefined, list: [A] }))).toEqual({ kind: "pending" });
  expect(openingOf(null)).toEqual({ kind: "pending" });
});

function fakeStore(lists: (Membership[] | undefined)[], raw: string | null = null) {
  let stored = raw;
  const writes: (string | null)[] = [];
  const pendingLists = [...lists];
  const store = membershipsStore({
    list: async () => pendingLists.shift(),
    read: async () => stored,
    write: async (next) => {
      stored = next;
      writes.push(next);
    },
    remove: async () => {
      stored = null;
      writes.push(null);
    },
  });
  return { store, writes, stored: () => stored };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("owned by a member, it reads what was kept and the list; another member starts from nothing", async () => {
  const { store } = fakeStore([[A, B], [B]], kept("org_b"));
  store.own("usr_1");
  expect(store.current("usr_1")?.known).toBeUndefined();
  await settle();
  expect(store.current("usr_1")).toMatchObject({ list: [A, B], error: false });
  expect(openingOf(store.current("usr_1"))).toMatchObject({ workspaceId: "org_b", listed: true });
  store.own("usr_2");
  expect(store.current("usr_1")).toBeNull();
  await settle();
  // The kept workspace was usr_1's.
  expect(store.current("usr_2")).toMatchObject({ list: [B], known: null });
});

test("a pick is kept on the phone; one not in the list reads it again, and one still missing is refused", async () => {
  const C: Membership = { id: "org_c", name: "Gamma", role: "owner" };
  const { store, writes } = fakeStore([[A], [A, C], [A, C]]);
  store.own("usr_1");
  await settle();
  expect(await store.pick("org_c")).toBe(true);
  expect(openingOf(store.current("usr_1"))).toMatchObject({ workspaceId: "org_c", name: "Gamma" });
  expect(writes.at(-1)).toBe(
    JSON.stringify({ userId: "usr_1", workspaceId: "org_c", name: "Gamma", role: "owner" }),
  );
  expect(await store.pick("org_gone")).toBe(false);
  expect(openingOf(store.current("usr_1"))).toMatchObject({ workspaceId: "org_c" });
});

test("keeping the same workspace again writes nothing; forgetting removes it and the list", async () => {
  const { store, writes, stored } = fakeStore([[A]]);
  store.own("usr_1");
  await settle();
  const known = { userId: "usr_1", workspaceId: "org_a", name: "Alpha", role: "owner" as const };
  store.keep(known);
  store.keep({ ...known });
  // Another member's is never kept.
  store.keep({ ...known, userId: "usr_2" });
  await settle();
  expect(writes).toHaveLength(1);
  await store.forget();
  expect(stored()).toBeNull();
  expect(store.current("usr_1")).toBeNull();
  expect(store.owner()).toBeNull();
});

test("a failed read keeps the list before it, and an older load never replaces a newer one", async () => {
  let release: ((list: Membership[]) => void) | undefined;
  let calls = 0;
  const store = membershipsStore({
    list: () => {
      calls++;
      if (calls === 2) return new Promise((resolve) => (release = resolve));
      return Promise.resolve(calls === 1 ? [A] : calls === 3 ? [B] : undefined);
    },
    read: async () => null,
    write: async () => {},
    remove: async () => {},
  });
  store.own("usr_1");
  await settle();
  const slow = store.load();
  await store.load();
  release?.([A]);
  expect(await slow).toBeUndefined();
  expect(store.current("usr_1")?.list).toEqual([B]);
  await store.load();
  expect(store.current("usr_1")).toMatchObject({ list: [B], error: true });
});
