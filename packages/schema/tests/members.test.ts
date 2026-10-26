import { describe, expect, test } from "vite-plus/test";
import {
  checkMemberChange,
  createMemoryStore,
  MEMBERS_ACTOR,
  mutations,
  ROLES,
  runMutation,
  serverMutations,
  type BrigadeTables,
  type DeviceRow,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);

const ctx = (id: string, role: Role, kind: "user" | "system" = "user"): MutationContext => ({
  actor: { kind, id, role },
  now: T,
  server: true,
});

function shard() {
  const store = createMemoryStore<BrigadeTables>();
  for (const [id, role] of [
    ["usr_ana", "owner"],
    ["usr_bia", "admin"],
    ["usr_caio", "responder"],
    ["usr_duda", "viewer"],
  ] as const) {
    store.insert("members", { id, name: id.slice(4), role, updatedAt: 0 });
  }
  const device = (id: string, userId: string): DeviceRow => ({
    id,
    userId,
    platform: "ios",
    environment: "sandbox",
    pushToken: `token-${id}-0123456789`,
    voipToken: null,
    publicKey: `B${"a".repeat(86)}`,
    registeredAt: 0,
    updatedAt: 0,
  });
  store.insert("devices", device("dev_1", "usr_caio"));
  store.insert("devices", device("dev_2", "usr_caio"));
  store.insert("devices", device("dev_3", "usr_bia"));
  return store;
}

describe("checkMemberChange", () => {
  const owner = { id: "usr_ana", role: "owner" as const };
  const admin = { id: "usr_bia", role: "admin" as const };
  const responder = { id: "usr_caio", role: "responder" as const };
  const viewer = { id: "usr_duda", role: "viewer" as const };
  const owner2 = { id: "usr_eva", role: "owner" as const };

  test("owners change any role and remove anyone, but never the last owner", () => {
    expect(checkMemberChange(owner, admin, { kind: "role", role: "owner" }, 1)).toEqual({
      ok: true,
    });
    expect(checkMemberChange(owner, responder, { kind: "remove" }, 1)).toEqual({ ok: true });
    expect(checkMemberChange(owner, owner2, { kind: "role", role: "admin" }, 2)).toEqual({
      ok: true,
    });
    expect(checkMemberChange(owner, owner, { kind: "role", role: "admin" }, 1)).toEqual({
      ok: false,
      code: "last_owner",
    });
    expect(checkMemberChange(owner, owner, { kind: "remove" }, 1)).toEqual({
      ok: false,
      code: "last_owner",
    });
  });

  test("an owner may step down or leave while another owner remains", () => {
    expect(checkMemberChange(owner, owner, { kind: "role", role: "viewer" }, 2)).toEqual({
      ok: true,
    });
    expect(checkMemberChange(owner, owner, { kind: "remove" }, 2)).toEqual({ ok: true });
  });

  test("admins manage everyone but owners, and make nobody an owner", () => {
    expect(checkMemberChange(admin, responder, { kind: "role", role: "admin" }, 1)).toEqual({
      ok: true,
    });
    expect(checkMemberChange(admin, viewer, { kind: "remove" }, 1)).toEqual({ ok: true });
    expect(checkMemberChange(admin, admin, { kind: "role", role: "responder" }, 1)).toEqual({
      ok: true,
    });
    for (const change of [{ kind: "role", role: "admin" }, { kind: "remove" }] as const) {
      expect(checkMemberChange(admin, owner2, change, 2)).toEqual({ ok: false, code: "forbidden" });
    }
    expect(checkMemberChange(admin, responder, { kind: "role", role: "owner" }, 1)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(checkMemberChange(admin, admin, { kind: "role", role: "owner" }, 1)).toEqual({
      ok: false,
      code: "forbidden",
    });
  });

  test("responders and viewers only leave", () => {
    for (const actor of [responder, viewer]) {
      expect(checkMemberChange(actor, actor, { kind: "remove" }, 1)).toEqual({ ok: true });
      expect(checkMemberChange(actor, actor, { kind: "role", role: "admin" }, 1)).toEqual({
        ok: false,
        code: "forbidden",
      });
      expect(
        checkMemberChange(
          actor,
          viewer.id === actor.id ? responder : viewer,
          { kind: "remove" },
          1,
        ),
      ).toEqual({
        ok: false,
        code: "forbidden",
      });
    }
  });

  test("the same role is a conflict", () => {
    expect(checkMemberChange(owner, admin, { kind: "role", role: "admin" }, 1)).toEqual({
      ok: false,
      code: "conflict",
    });
  });
});

describe("member.changeRole, member.remove, member.reconcile", () => {
  test("are server only", () => {
    for (const name of ["member.changeRole", "member.remove", "member.reconcile"]) {
      expect(Object.keys(mutations)).not.toContain(name);
      expect(Object.keys(serverMutations)).toContain(name);
    }
  });

  test("a role change updates the copy and emits member.role_changed; again is a conflict", () => {
    const store = shard();
    const args = { id: "usr_caio", from: "responder", to: "viewer" };
    expect(
      runMutation(serverMutations, "member.changeRole", args, store, ctx("usr_bia", "admin")),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "member.role_changed",
          subject: "usr_caio",
          data: { userId: "usr_caio", from: "responder", to: "viewer" },
        },
      ],
    });
    expect(store.get("members", "usr_caio")).toMatchObject({ role: "viewer", updatedAt: T });
    expect(
      runMutation(serverMutations, "member.changeRole", args, store, ctx("usr_bia", "admin")),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      runMutation(
        serverMutations,
        "member.changeRole",
        args,
        shard(),
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("a role change for a member the shard never saw still emits its event", () => {
    const store = shard();
    const result = runMutation(
      serverMutations,
      "member.changeRole",
      { id: "usr_eva", from: "viewer", to: "responder" },
      store,
      ctx("usr_ana", "owner"),
    );
    expect(result).toMatchObject({ ok: true, events: [{ type: "member.role_changed" }] });
    expect(store.get("members", "usr_eva")).toBeUndefined();
  });

  test("removing a member deletes their copy and every device of theirs in one change", () => {
    const store = shard();
    const result = runMutation(
      serverMutations,
      "member.remove",
      { id: "usr_caio", role: "responder", reason: "removed" },
      store,
      ctx("usr_bia", "admin"),
    );
    expect(result).toEqual({
      ok: true,
      events: [
        {
          type: "member.removed",
          subject: "usr_caio",
          data: { userId: "usr_caio", role: "responder", reason: "removed" },
        },
        {
          type: "device.unregistered",
          subject: "dev_1",
          data: { id: "dev_1", userId: "usr_caio", reason: "member_removed" },
        },
        {
          type: "device.unregistered",
          subject: "dev_2",
          data: { id: "dev_2", userId: "usr_caio", reason: "member_removed" },
        },
      ],
    });
    expect(store.get("members", "usr_caio")).toBeUndefined();
    expect(store.scan("devices").map((device) => device.id)).toEqual(["dev_3"]);
    expect(
      runMutation(
        serverMutations,
        "member.remove",
        { id: "usr_caio", role: "responder", reason: "removed" },
        store,
        ctx("usr_bia", "admin"),
      ),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
  });

  test("a member removed before they had a copy loses their devices too", () => {
    const store = shard();
    store.delete("members", "usr_caio");
    expect(
      runMutation(
        serverMutations,
        "member.remove",
        { id: "usr_caio", role: "responder", reason: "removed" },
        store,
        ctx("usr_ana", "owner"),
      ),
    ).toMatchObject({ ok: true });
    expect(store.scan("devices").map((device) => device.id)).toEqual(["dev_3"]);
  });

  test("anyone may leave; only owners and admins remove someone else", () => {
    const leave = { id: "usr_duda", role: "viewer", reason: "left" };
    expect(
      runMutation(serverMutations, "member.remove", leave, shard(), ctx("usr_duda", "viewer")),
    ).toMatchObject({ ok: true });
    expect(
      runMutation(serverMutations, "member.remove", leave, shard(), ctx("usr_ana", "owner")),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(
      runMutation(
        serverMutations,
        "member.remove",
        { ...leave, reason: "removed" },
        shard(),
        ctx("usr_caio", "responder"),
      ),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });

  test("reconcile removes copies D1 no longer has, fixes roles and drops orphaned devices", () => {
    const store = shard();
    store.insert("devices", { ...store.get("devices", "dev_3")!, id: "dev_4", userId: "usr_gone" });
    const result = runMutation(
      serverMutations,
      "member.reconcile",
      {
        members: [
          { id: "usr_ana", role: "owner" },
          { id: "usr_bia", role: "admin" },
          { id: "usr_duda", role: "responder" },
          { id: "usr_eva", role: "viewer" },
        ],
      },
      store,
      { ...ctx(MEMBERS_ACTOR.id, MEMBERS_ACTOR.role, "system") },
    );
    expect(result).toMatchObject({
      ok: true,
      events: [
        {
          type: "member.removed",
          data: { userId: "usr_caio", role: "responder", reason: "reconciled" },
        },
        { type: "device.unregistered", data: { id: "dev_1", reason: "member_removed" } },
        { type: "device.unregistered", data: { id: "dev_2", reason: "member_removed" } },
        {
          type: "member.role_changed",
          data: { userId: "usr_duda", from: "viewer", to: "responder" },
        },
        { type: "device.unregistered", data: { id: "dev_4", userId: "usr_gone" } },
      ],
    });
    expect(store.scan("members").map((member) => [member.id, member.role])).toEqual([
      ["usr_ana", "owner"],
      ["usr_bia", "admin"],
      ["usr_duda", "responder"],
    ]);
    expect(store.scan("devices").map((device) => device.id)).toEqual(["dev_3"]);
  });

  test("reconcile with nothing to repair is a conflict, and an empty list changes nothing", () => {
    const store = shard();
    const members = ROLES.map((role, index) => ({
      id: ["usr_ana", "usr_bia", "usr_caio", "usr_duda"][index]!,
      role,
    }));
    const system = ctx(MEMBERS_ACTOR.id, MEMBERS_ACTOR.role, "system");
    expect(
      runMutation(serverMutations, "member.reconcile", { members }, store, system),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(
      runMutation(serverMutations, "member.reconcile", { members: [] }, store, system),
    ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    expect(store.scan("members")).toHaveLength(4);
  });
});
