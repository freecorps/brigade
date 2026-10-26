import { describe, expect, test } from "vite-plus/test";
import {
  checkInvite,
  createMemoryStore,
  invitationAddressKey,
  invitationEmail,
  inviteRoles,
  MEMBERS_ACTOR,
  mutations,
  runMutation,
  serverMutations,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);

const ctx = (id: string, role: Role, kind: "user" | "system" = "user"): MutationContext => ({
  actor: { kind, id, role },
  now: T,
  server: true,
});
const members: MutationContext = { actor: MEMBERS_ACTOR, now: T, server: true };

describe("checkInvite", () => {
  test("owners invite as any role; admins as anything but owner; nobody else invites", () => {
    expect(inviteRoles({ role: "owner" })).toEqual(["owner", "admin", "responder", "viewer"]);
    expect(inviteRoles({ role: "admin" })).toEqual(["admin", "responder", "viewer"]);
    expect(inviteRoles({ role: "responder" })).toEqual([]);
    expect(inviteRoles({ role: "viewer" })).toEqual([]);
    expect(checkInvite({ role: "admin" }, "owner")).toEqual({ ok: false, code: "forbidden" });
  });
});

describe("invitationAddressKey", () => {
  test("drops a `+tag` from the local part, and nothing else", () => {
    expect(invitationAddressKey("jane+1@example.com")).toBe("jane@example.com");
    expect(invitationAddressKey("jane+2@example.com")).toBe("jane@example.com");
    expect(invitationAddressKey("jane+a+b@example.com")).toBe("jane@example.com");
    expect(invitationAddressKey("jane@example.com")).toBe("jane@example.com");
    // A local part that is only a tag keeps it: there is no inbox name to fall back on.
    expect(invitationAddressKey("+ops@example.com")).toBe("+ops@example.com");
  });
});

describe("invitationEmail", () => {
  test("trimmed and lower-cased; anything that could break a header or markup is refused", () => {
    expect(invitationEmail("  Ana.Souza+ops@Example.COM ")).toBe("ana.souza+ops@example.com");
    for (const bad of [
      undefined,
      42,
      "",
      "ana",
      "ana@example",
      "ana@@example.com",
      "a na@example.com",
      "ana@example.com\r\nBcc: x@example.com",
      "<ana@example.com>",
      '"ana"@example.com',
      `${"a".repeat(250)}@example.com`,
    ]) {
      expect(invitationEmail(bad), String(bad)).toBeUndefined();
    }
  });
});

describe("the invitation mutations", () => {
  const store = () => createMemoryStore<BrigadeTables>();
  const invite = (role: Role, by = "usr_bia") => ({
    id: "inv_1",
    role,
    expiresAt: T + 1000,
    send: 1,
    invitedBy: by,
  });

  test("none of them can be sent over a socket", () => {
    for (const name of [
      "invitation.create",
      "invitation.revoke",
      "invitation.decline",
      "member.add",
    ]) {
      expect(name in mutations, name).toBe(false);
      expect(name in serverMutations, name).toBe(true);
    }
  });

  test("`invitation.create` follows `checkInvite`, as the inviter it names, and emits `member.invited`", () => {
    const run = (args: object, context: MutationContext) =>
      runMutation(serverMutations, "invitation.create", args, store(), context);
    expect(run(invite("responder"), ctx("usr_bia", "admin"))).toEqual({
      ok: true,
      events: [
        {
          type: "member.invited",
          subject: "inv_1",
          data: {
            invitationId: "inv_1",
            role: "responder",
            invitedBy: "usr_bia",
            expiresAt: T + 1000,
            send: 1,
          },
        },
      ],
    });
    expect(run(invite("owner"), ctx("usr_bia", "admin"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(run(invite("viewer"), ctx("usr_caio", "responder"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    // Someone else's name on it.
    expect(run(invite("viewer", "usr_ana"), ctx("usr_bia", "admin"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    // The repair, as `sys_members`.
    expect(run(invite("owner", "usr_ana"), members)).toMatchObject({ ok: true });
  });

  test("`invitation.revoke`: an admin never revokes an owner's", () => {
    const run = (role: Role, context: MutationContext) =>
      runMutation(
        serverMutations,
        "invitation.revoke",
        { id: "inv_1", role, revokedBy: context.actor.id },
        store(),
        context,
      );
    expect(run("admin", ctx("usr_bia", "admin"))).toMatchObject({
      ok: true,
      events: [
        { type: "invitation.revoked", data: { invitationId: "inv_1", revokedBy: "usr_bia" } },
      ],
    });
    expect(run("owner", ctx("usr_bia", "admin"))).toMatchObject({ ok: false });
    expect(run("owner", ctx("usr_ana", "owner"))).toMatchObject({ ok: true });
  });

  test("`member.add` and `invitation.decline` run as `sys_members` only; adding copies the member", () => {
    const shard = store();
    const add = { id: "usr_gil", name: "Gil", role: "responder", invitationId: "inv_1" };
    expect(
      runMutation(serverMutations, "member.add", add, shard, ctx("usr_ana", "owner")),
    ).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(runMutation(serverMutations, "member.add", add, shard, members)).toEqual({
      ok: true,
      events: [
        {
          type: "member.added",
          subject: "usr_gil",
          data: { userId: "usr_gil", role: "responder", invitationId: "inv_1" },
        },
      ],
    });
    expect(shard.get("members", "usr_gil")).toEqual({
      id: "usr_gil",
      name: "Gil",
      role: "responder",
      updatedAt: T,
    });
    const decline = { id: "inv_2", userId: "usr_hugo" };
    expect(
      runMutation(serverMutations, "invitation.decline", decline, shard, ctx("usr_ana", "owner")),
    ).toMatchObject({ ok: false });
    expect(
      runMutation(serverMutations, "invitation.decline", decline, shard, members),
    ).toMatchObject({
      ok: true,
      events: [{ type: "invitation.declined", subject: "inv_2" }],
    });
  });
});
