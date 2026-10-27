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
  type Permission,
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

  test("the same role is a conflict, but only for someone allowed to make the change", () => {
    expect(checkMemberChange(owner, admin, { kind: "role", role: "admin" }, 1)).toEqual({
      ok: false,
      code: "conflict",
    });
    // The rules come first: an admin learns nothing about an owner, nor a viewer about anyone.
    expect(checkMemberChange(admin, owner, { kind: "role", role: "owner" }, 1)).toEqual({
      ok: false,
      code: "forbidden",
    });
    expect(checkMemberChange(viewer, admin, { kind: "role", role: "admin" }, 1)).toEqual({
      ok: false,
      code: "forbidden",
    });
    // The last owner asked to stay owner is a conflict, not last_owner.
    expect(checkMemberChange(owner, owner, { kind: "role", role: "owner" }, 1)).toEqual({
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

  test("a role change updates the copy and emits member.role_changed; only by owners and admins", () => {
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
      runMutation(
        serverMutations,
        "member.changeRole",
        { ...args, to: "responder" },
        store,
        ctx("usr_bia", "admin"),
      ),
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
    // A member who never opened Brigade has nothing in the shard, and their removal is still announced.
    expect(
      runMutation(
        serverMutations,
        "member.remove",
        { id: "usr_eva", role: "viewer", reason: "left" },
        store,
        ctx("usr_eva", "viewer"),
      ),
    ).toEqual({
      ok: true,
      events: [
        {
          type: "member.removed",
          subject: "usr_eva",
          data: { userId: "usr_eva", role: "viewer", reason: "left" },
        },
      ],
    });
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

  test("only the members' system actor removes one member as reconciled, and it drops their devices", () => {
    const reconciled = { id: "usr_caio", role: "responder", reason: "reconciled" };
    for (const actor of [ctx("usr_ana", "owner"), ctx("sys_monitors", "admin", "system")]) {
      expect(
        runMutation(serverMutations, "member.remove", reconciled, shard(), actor),
      ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    }
    const store = shard();
    expect(
      runMutation(
        serverMutations,
        "member.remove",
        reconciled,
        store,
        ctx(MEMBERS_ACTOR.id, MEMBERS_ACTOR.role, "system"),
      ),
    ).toMatchObject({
      ok: true,
      events: [
        {
          type: "member.removed",
          data: { userId: "usr_caio", role: "responder", reason: "reconciled" },
        },
        { type: "device.unregistered" },
        { type: "device.unregistered" },
      ],
    });
    expect(store.get("members", "usr_caio")).toBeUndefined();
    expect(store.scan("devices").map((device) => device.id)).toEqual(["dev_3"]);
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

  test("reconcile forgets the call choice of someone with no copy", () => {
    const store = shard();
    // Their removal's sync failed: the copy went, the choice stayed.
    store.insert("member_settings", { id: "usr_gone", calls: "never", updatedAt: T });
    store.insert("member_settings", { id: "usr_ana", calls: "sev1", updatedAt: T });
    const result = runMutation(
      serverMutations,
      "member.reconcile",
      {
        members: [
          { id: "usr_ana", role: "owner" },
          { id: "usr_bia", role: "admin" },
          { id: "usr_caio", role: "responder" },
          { id: "usr_duda", role: "viewer" },
          { id: "usr_eva", role: "viewer" },
        ],
      },
      store,
      { ...ctx(MEMBERS_ACTOR.id, MEMBERS_ACTOR.role, "system") },
    );
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "member.calls_changed", data: { userId: "usr_gone", calls: "sev1_sev2" } },
      ],
    });
    expect(store.scan("member_settings").map((row) => row.id)).toEqual(["usr_ana"]);
  });

  test("reconcile drops the devices a member last registered before their password was reset", () => {
    const store = shard();
    // Caio's second phone registered again after the reset (the owner signing in); Bia was never reset.
    store.update("devices", "dev_2", { updatedAt: T });
    const members = [
      { id: "usr_ana", role: "owner", resetAt: null },
      { id: "usr_bia", role: "admin" },
      { id: "usr_caio", role: "responder", resetAt: T - 1 },
      { id: "usr_duda", role: "viewer", resetAt: T - 1 },
    ];
    const system = ctx(MEMBERS_ACTOR.id, MEMBERS_ACTOR.role, "system");
    expect(
      runMutation(serverMutations, "member.reconcile", { members }, store, system),
    ).toMatchObject({
      ok: true,
      events: [
        {
          type: "device.unregistered",
          data: { id: "dev_1", userId: "usr_caio", reason: "password_reset" },
        },
      ],
    });
    expect(store.scan("devices").map((device) => device.id)).toEqual(["dev_2", "dev_3"]);
    expect(store.get("member_devices", "dev_1")).toBeUndefined();
    // Done: the same reset again finds nothing.
    expect(
      runMutation(serverMutations, "member.reconcile", { members }, store, system),
    ).toMatchObject({ ok: false, error: { code: "conflict" } });
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

describe("an API token (RFC 0014)", () => {
  const token = (role: Role, scopes: Permission[] = ["members:manage"]): MutationContext => ({
    actor: { kind: "token", id: "tok_1", role, by: "usr_ana", scopes },
    now: T,
    server: true,
  });

  test("never makes, changes or removes an owner or admin, whatever its creator's role", () => {
    const owner = { id: "usr_ana", role: "owner" as const, kind: "token" as const };
    const admin = { id: "usr_bia", role: "admin" as const };
    const owner2 = { id: "usr_eva", role: "owner" as const };
    const responder = { id: "usr_caio", role: "responder" as const };
    const forbidden = { ok: false, code: "forbidden" };
    expect(checkMemberChange(owner, responder, { kind: "role", role: "admin" }, 2)).toEqual(
      forbidden,
    );
    expect(checkMemberChange(owner, responder, { kind: "role", role: "owner" }, 2)).toEqual(
      forbidden,
    );
    for (const target of [admin, owner2]) {
      expect(checkMemberChange(owner, target, { kind: "role", role: "viewer" }, 2)).toEqual(
        forbidden,
      );
      expect(checkMemberChange(owner, target, { kind: "remove" }, 2)).toEqual(forbidden);
    }
    expect(checkMemberChange(owner, responder, { kind: "role", role: "viewer" }, 2)).toEqual({
      ok: true,
    });
    expect(checkMemberChange(owner, responder, { kind: "remove" }, 2)).toEqual({ ok: true });
    // The same change by its creator in person is allowed.
    expect(checkMemberChange({ ...owner, kind: "user" }, admin, { kind: "remove" }, 2)).toEqual({
      ok: true,
    });
  });

  test("member.remove needs members:manage in its scopes, not workspace:read, and only removes", () => {
    const store = shard();
    const remove = (context: MutationContext, role: Role, reason = "removed") =>
      runMutation(
        serverMutations,
        "member.remove",
        { id: role === "admin" ? "usr_bia" : "usr_caio", role, reason },
        store,
        context,
      );
    expect(remove(token("owner", ["incident:ack"]), "responder")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(remove(token("owner"), "responder", "left")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(remove(token("owner"), "admin")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    const removed = remove(token("owner"), "responder");
    expect(removed.ok && removed.events[0]).toMatchObject({
      type: "member.removed",
      data: { userId: "usr_caio", reason: "removed" },
    });
    expect(store.get("members", "usr_caio")).toBeUndefined();
    expect(store.scan("devices").filter((row) => row.userId === "usr_caio")).toEqual([]);
  });

  test("member.changeRole never moves anyone to or from owner or admin", () => {
    const store = shard();
    const change = (id: string, from: Role, to: Role) =>
      runMutation(serverMutations, "member.changeRole", { id, from, to }, store, token("owner"));
    expect(change("usr_caio", "responder", "admin")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(change("usr_bia", "admin", "viewer")).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(change("usr_caio", "responder", "viewer")).toMatchObject({ ok: true });
  });
});
