import { expect, test } from "vite-plus/test";
import {
  MAX_PHONE_WORKSPACES,
  MAX_SEEN_SHIFTS,
  phoneWorkspacesStore,
  readPhoneWorkspaces,
  withoutWorkspaces,
  withShifts,
  withWorkspace,
} from "./phone-workspaces";

const ANA = "usr_ana";

function storage(initial: string | null = null) {
  const state = { raw: initial };
  return {
    state,
    read: async () => state.raw,
    write: async (raw: string | null) => {
      state.raw = raw;
    },
  };
}

test("each workspace opened on the phone is kept for its member, the newest first, and only theirs is read", async () => {
  const kept = storage();
  const store = phoneWorkspacesStore(kept);
  await store.update(ANA, (list) => withWorkspace(list, "ws_one", "One"));
  await store.update(ANA, (list) => withWorkspace(list, "ws_two", "Two"));
  await store.update(ANA, (list) => withWorkspace(list, "ws_one"));
  expect((await store.read(ANA)).workspaces).toEqual([
    { id: "ws_one", name: "One" },
    { id: "ws_two", name: "Two" },
  ]);
  // Another member signed in on the phone never registers in Ana's workspaces.
  expect((await store.read("usr_bia")).workspaces).toEqual([]);
  expect(store.current("usr_bia")).toEqual({ userId: "usr_bia", workspaces: [] });
  // Signing out forgets them.
  await store.clear();
  expect(kept.state.raw).toBeNull();
  expect((await store.read(ANA)).workspaces).toEqual([]);
});

test("a workspace the member left is dropped, and the list stays bounded", () => {
  let list = readPhoneWorkspaces(null, ANA);
  for (let i = 0; i < MAX_PHONE_WORKSPACES + 3; i++) list = withWorkspace(list, `ws_${i}`);
  expect(list.workspaces).toHaveLength(MAX_PHONE_WORKSPACES);
  list = withoutWorkspaces(list, ["ws_12", "ws_11"]);
  expect(list.workspaces.map((workspace) => workspace.id)).not.toContain("ws_12");
  expect(list.workspaces).toHaveLength(MAX_PHONE_WORKSPACES - 2);
});

test("the member's stretches in a workspace are kept, bounded, and anything malformed is ignored", () => {
  const shifts: [number, number | null][] = Array.from({ length: 20 }, (_, i) => [i, i + 1]);
  const list = withShifts(
    withWorkspace(readPhoneWorkspaces(null, ANA), "ws_one", "One"),
    "ws_one",
    {
      shifts,
      staleAt: 100,
    },
  );
  const read = readPhoneWorkspaces(JSON.stringify(list), ANA);
  expect(read.workspaces[0]?.oncall?.shifts).toHaveLength(MAX_SEEN_SHIFTS);
  expect(read.workspaces[0]?.oncall?.staleAt).toBe(100);
  const garbage = JSON.stringify({
    userId: ANA,
    workspaces: [{ id: "ws_x", oncall: { shifts: [["a", 1]], staleAt: 1 } }, { name: "no id" }, 7],
  });
  expect(readPhoneWorkspaces(garbage, ANA).workspaces).toEqual([{ id: "ws_x" }]);
  expect(readPhoneWorkspaces("{", ANA).workspaces).toEqual([]);
});
