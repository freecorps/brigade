import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  mutations,
  serverMutations,
  newId,
  ROLES,
  runMutation,
  WORKSPACE_NAME_MAX,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 25, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));

const ctx = (role: Role = "owner"): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now: T,
  server: true,
});

describe("workspace.create", () => {
  test("is server only: not among the mutations a socket may send", () => {
    expect(Object.keys(mutations)).not.toContain("workspace.create");
    expect(Object.keys(serverMutations)).toEqual([
      ...Object.keys(mutations),
      "workspace.create",
      "monitor.report",
      "monitor.evaluate",
    ]);
    const result = runMutation(
      mutations,
      "workspace.create" as never,
      { id: WS, name: "Acme" },
      createMemoryStore<BrigadeTables>(),
      ctx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "unknown_mutation" } });
  });

  test("writes the workspace row and emits workspace.created", () => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: " Acme " },
      store,
      ctx(),
    );
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "workspace.created",
          subject: WS,
          data: { id: WS, name: "Acme", createdBy: "usr_ana" },
        },
      ],
    });
    expect(store.scan("workspace")).toEqual([
      { id: WS, name: "Acme", createdAt: T, createdBy: "usr_ana" },
    ]);
  });

  test("runs once per shard", () => {
    const store = createMemoryStore<BrigadeTables>();
    runMutation(serverMutations, "workspace.create", { id: WS, name: "Acme" }, store, ctx());
    const again = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: "Other" },
      store,
      ctx(),
    );
    expect(again).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(store.scan("workspace")).toHaveLength(1);
  });

  test.each(ROLES.filter((role) => role !== "owner"))("%s cannot create it", (role) => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(
      serverMutations,
      "workspace.create",
      { id: WS, name: "Acme" },
      store,
      ctx(role),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(store.scan("workspace")).toEqual([]);
  });

  test.each([
    ["an empty name", { id: WS, name: "  " }],
    ["a name that is too long", { id: WS, name: "x".repeat(WORKSPACE_NAME_MAX + 1) }],
    [
      "an id that is not a workspace id",
      { id: newId("inc", T, () => new Uint8Array(10)), name: "Acme" },
    ],
  ])("refuses %s", (_name, args) => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(serverMutations, "workspace.create", args, store, ctx());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });
});
