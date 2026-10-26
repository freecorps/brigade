// Member management (RFC 0003 "Members"): who may change a member's role or remove them, and the server-only
// mutations that apply a change to the workspace shard's copy of the members (`members`, see `member.sync`) and
// announce it (RFC 0005). D1 (Better Auth's `member` table) is the authority: the API Worker's shard writes it
// first, then runs these, so they never decide a change on their own (apps/api/src/members.ts).

import { can, ROLES, type Role } from "./access.ts";
import { dropDevices } from "./devices.ts";
import { defineMutation, fail, ok, type Actor, type DomainEvent } from "./mutation.ts";
import { dropFromSchedules } from "./schedules.ts";
import { v } from "./validate.ts";

/**
 * Who repairs the shard's member list from D1 (`member.reconcile`): a change D1 has and the shard missed (its step
 * failed after D1 committed, or someone edited D1 outside Brigade). Server only, so its role grants no member
 * anything.
 */
export const MEMBERS_ACTOR: Actor = { kind: "system", id: "sys_members", role: "admin" };

/** Why a member left the workspace: removed by an owner or admin, left on their own, or gone from D1. */
export const MEMBER_REMOVALS = ["removed", "left", "reconciled"] as const;
export type MemberRemoval = (typeof MEMBER_REMOVALS)[number];

export type MemberRoleChanged = DomainEvent<
  "member.role_changed",
  { userId: string; from: Role; to: Role }
>;
export type MemberRemoved = DomainEvent<
  "member.removed",
  /** `role` is theirs before, or null when the shard no longer knew it (a leaver finishing with only devices left). */
  { userId: string; role: Role | null; reason: MemberRemoval }
>;

/** A change one member asks for on another (or on themselves). */
export type MemberChange = { kind: "role"; role: Role } | { kind: "remove" };

/** Why a change is refused: not allowed, it would leave the workspace without an owner, or it changes nothing. */
export type MemberChangeRefusal = "forbidden" | "last_owner" | "conflict";

/**
 * Whether `actor` may make `change` to `target` (RFC 0003 "Members"), given how many owners the workspace has:
 * - owners and admins (`members:manage`) change roles and remove members; an admin never touches an owner, nor
 *   makes anyone an owner;
 * - anyone may leave (remove themselves); a responder or viewer changes no role, their own included;
 * - nobody demotes or removes the last owner, themselves included: an owner may step down or leave only while
 *   another owner remains.
 * The API checks it against D1 before writing; the dashboard uses it to show only what will be accepted.
 */
export function checkMemberChange(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
  change: MemberChange,
  owners: number,
): { ok: true } | { ok: false; code: MemberChangeRefusal } {
  const self = actor.id === target.id;
  if (!(self && change.kind === "remove")) {
    if (!can(actor.role, "members:manage")) return { ok: false, code: "forbidden" };
    if (
      actor.role !== "owner" &&
      (target.role === "owner" || (change.kind === "role" && change.role === "owner"))
    ) {
      return { ok: false, code: "forbidden" };
    }
  }
  // After the rules: a caller who may not make the change learns nothing from it already being made.
  if (change.kind === "role" && change.role === target.role) return { ok: false, code: "conflict" };
  if (target.role === "owner" && owners <= 1) return { ok: false, code: "last_owner" };
  return { ok: true };
}

/** Deletes every device of `userId` (they stop being paged right away), with a `device.unregistered` each. */
const memberId = v.string({ min: 1, max: 64 });

/**
 * Server only: a member's role changed in D1 (`from` → `to`, as D1 had them). Updates the shard's copy if it has
 * one (a member who never opened Brigade has none, and gets the new role from `member.sync` when they do) and
 * emits `member.role_changed`. Run once per change D1 made: the caller decides whether the shard still lags.
 */
export const changeMemberRole = defineMutation({
  name: "member.changeRole",
  args: v.object({ id: memberId, from: v.picklist(ROLES), to: v.picklist(ROLES) }),
  permission: "members:manage",
  apply(store, args, ctx) {
    if (args.from === args.to) return fail("conflict", "Role is unchanged");
    if (store.get("members", args.id))
      store.update("members", args.id, { role: args.to, updatedAt: ctx.now });
    const event: MemberRoleChanged = {
      type: "member.role_changed",
      subject: args.id,
      data: { userId: args.id, from: args.from, to: args.to },
    };
    // Viewers only read: a member made one leaves the rotations (RFC 0003 "Schedules").
    const schedules = args.to === "viewer" ? dropFromSchedules(store, args.id, ctx) : [];
    return ok(event, ...schedules);
  },
});

/**
 * Server only: a member left or was removed in D1 (`role`: theirs before, null if unknown). Deletes their copy and every device of
 * theirs in the same transaction, so no page plan made after it counts them (RFC 0006 "Who is paged"), and emits
 * `member.removed` (and `device.unregistered` per device). `left` is the actor themselves (any role); `removed`
 * needs `members:manage`; `reconciled` is `MEMBERS_ACTOR` catching the shard up with one removal D1 already has
 * (without reconciling every member). Emits even when the shard had neither (a member who never opened Brigade):
 * the caller runs it once per removal D1 made.
 */
export const removeMember = defineMutation({
  name: "member.remove",
  args: v.object({
    id: memberId,
    role: v.nullable(v.picklist(ROLES)),
    reason: v.picklist(MEMBER_REMOVALS),
  }),
  // Leaving needs only membership; removing someone else is checked below.
  permission: "workspace:read",
  apply(store, args, ctx) {
    const allowed =
      args.reason === "left"
        ? ctx.actor.id === args.id
        : args.reason === "reconciled"
          ? ctx.actor.kind === MEMBERS_ACTOR.kind && ctx.actor.id === MEMBERS_ACTOR.id
          : can(ctx.actor.role, "members:manage");
    if (!allowed) {
      return fail("forbidden", "Not allowed to remove this member");
    }
    if (store.get("members", args.id)) store.delete("members", args.id);
    const devices = dropDevices(store, args.id, "member_removed");
    const schedules = dropFromSchedules(store, args.id, ctx);
    const event: MemberRemoved = {
      type: "member.removed",
      subject: args.id,
      data: { userId: args.id, role: args.role, reason: args.reason },
    };
    return ok(event, ...devices, ...schedules);
  },
});

/** The most members one reconcile carries: well past any workspace today; a larger one is not reconciled. */
export const MAX_RECONCILED_MEMBERS = 1000;

/**
 * Server only, as `MEMBERS_ACTOR`: makes the shard's member list agree with D1's (`members`, every member with a
 * Brigade role). A copy D1 no longer has is deleted with its devices (`member.removed`, `reconciled`); a copy whose
 * role differs takes D1's (`member.role_changed`); a device whose member D1 no longer has is dropped. Members D1
 * has and the shard does not are left to `member.sync` (it needs their name). An empty list changes nothing: a
 * workspace always has an owner, so it can only be a read of the wrong workspace. Nothing to repair is a
 * `conflict`.
 */
export const reconcileMembers = defineMutation({
  name: "member.reconcile",
  args: v.object({
    members: v.array(v.object({ id: memberId, role: v.picklist(ROLES) }), {
      max: MAX_RECONCILED_MEMBERS,
    }),
  }),
  permission: "members:manage",
  apply(store, args, ctx) {
    if (args.members.length === 0) return fail("invalid_args", "No members to reconcile with");
    const roles = new Map<string, Role>(
      args.members.map((member: { id: string; role: Role }) => [member.id, member.role]),
    );
    const events: DomainEvent[] = [];
    for (const current of store.scan("members")) {
      const role = roles.get(current.id);
      if (role === undefined) {
        store.delete("members", current.id);
        const event: MemberRemoved = {
          type: "member.removed",
          subject: current.id,
          data: { userId: current.id, role: current.role, reason: "reconciled" },
        };
        events.push(
          event,
          ...dropDevices(store, current.id, "member_removed"),
          ...dropFromSchedules(store, current.id, ctx),
        );
      } else if (role !== current.role) {
        store.update("members", current.id, { role, updatedAt: ctx.now });
        const event: MemberRoleChanged = {
          type: "member.role_changed",
          subject: current.id,
          data: { userId: current.id, from: current.role, to: role },
        };
        events.push(event);
        if (role === "viewer") events.push(...dropFromSchedules(store, current.id, ctx));
      }
    }
    // Devices of someone with no copy (their `member.sync` failed, or the copy went before this rule existed).
    const orphans = new Set(
      store
        .scan("devices")
        .map((device) => device.userId)
        .filter((userId) => !roles.has(userId)),
    );
    for (const userId of orphans) events.push(...dropDevices(store, userId, "member_removed"));
    if (events.length === 0) return fail("conflict", "Members are up to date");
    return ok(...events);
  },
});
