// Member management (RFC 0003 "Members"): who may change a member's role or remove them, and the server-only
// mutations that apply a change to the workspace shard's copy of the members (`members`, see `member.sync`) and
// announce it (RFC 0005). D1 (Better Auth's `member` table) is the authority: the API Worker's shard writes it
// first, then runs these, so they never decide a change on their own (apps/api/src/members.ts).

import { allows, can, ROLES, type Role } from "./access.ts";
import {
  DEFAULT_CALL_CHOICE,
  forgetMemberSettings,
  type MemberCallsChanged,
} from "./calls.ts";
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

/**
 * The roles an API token (RFC 0014) never grants (inviting or changing a role), changes or removes: making or
 * unmaking an owner or an admin is a person's call, never a script's, whatever its creator's role.
 */
export const TOKEN_OUT_OF_REACH: readonly Role[] = ["owner", "admin"];

/** Whether an API token may touch `role`: grant it, or change or remove someone who has it. */
export const tokenReaches = (role: Role | null) =>
  role !== null && !TOKEN_OUT_OF_REACH.includes(role);

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
 *   another owner remains;
 * - an API token (`kind: "token"`, `actor` being its creator, RFC 0014) never makes anyone an owner or admin, nor
 *   changes or removes one (`TOKEN_OUT_OF_REACH`); the API also keeps it off its creator.
 * The API checks it against D1 before writing; the dashboard uses it to show only what will be accepted.
 */
export function checkMemberChange(
  actor: { id: string; role: Role; kind?: Actor["kind"] },
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
    if (
      actor.kind === "token" &&
      (!tokenReaches(target.role) || (change.kind === "role" && !tokenReaches(change.role)))
    ) {
      return { ok: false, code: "forbidden" };
    }
  }
  // After the rules: a caller who may not make the change learns nothing from it already being made.
  if (change.kind === "role" && change.role === target.role) return { ok: false, code: "conflict" };
  if (target.role === "owner" && owners <= 1) return { ok: false, code: "last_owner" };
  return { ok: true };
}

const memberId = v.string({ min: 1, max: 64 });

/**
 * Server only: a member's role changed in D1 (`from` → `to`, as D1 had them). Updates the shard's copy if it has
 * one (a member who never opened Brigade has none, and gets the new role from `member.sync` when they do) and
 * emits `member.role_changed`. Run once per change D1 made: the caller decides whether the shard still lags. An API
 * token never moves anyone to or from owner or admin (`TOKEN_OUT_OF_REACH`).
 */
export const changeMemberRole = defineMutation({
  name: "member.changeRole",
  args: v.object({ id: memberId, from: v.picklist(ROLES), to: v.picklist(ROLES) }),
  permission: "members:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind === "token" && !(tokenReaches(args.from) && tokenReaches(args.to))) {
      return fail("forbidden", "A token never changes an owner's or admin's role, nor makes one");
    }
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
 * the caller runs it once per removal D1 made. An API token only ever removes (it never leaves): `members:manage` in
 * its scopes, never an owner or admin.
 */
export const removeMember = defineMutation({
  name: "member.remove",
  args: v.object({
    id: memberId,
    role: v.nullable(v.picklist(ROLES)),
    reason: v.picklist(MEMBER_REMOVALS),
  }),
  // Leaving needs only membership; removing someone else is checked below. A token never leaves, so it needs
  // `members:manage` in its scopes to run this at all (the Worker checked it already).
  permission: "workspace:read",
  tokenPermission: "members:manage",
  apply(store, args, ctx) {
    const allowed =
      ctx.actor.kind === "token"
        ? args.reason === "removed" && tokenReaches(args.role)
        : args.reason === "left"
          ? ctx.actor.id === args.id
          : args.reason === "reconciled"
            ? ctx.actor.kind === MEMBERS_ACTOR.kind && ctx.actor.id === MEMBERS_ACTOR.id
            : allows(ctx.actor, "members:manage");
    if (!allowed) {
      return fail("forbidden", "Not allowed to remove this member");
    }
    if (store.get("members", args.id)) store.delete("members", args.id);
    forgetMemberSettings(store, args.id);
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
 * role differs takes D1's (`member.role_changed`); a device whose member D1 no longer has is dropped, and so is one
 * last registered before its member's password was reset (`resetAt`, D1's `user.passwordResetAt`). Members D1
 * has and the shard does not are left to `member.sync` (it needs their name). An empty list changes nothing: a
 * workspace always has an owner, so it can only be a read of the wrong workspace. Nothing to repair is a
 * `conflict`.
 */
export const reconcileMembers = defineMutation({
  name: "member.reconcile",
  args: v.object({
    members: v.array(
      v.object({
        id: memberId,
        role: v.picklist(ROLES),
        resetAt: v.optional(v.nullable(v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }))),
      }),
      { max: MAX_RECONCILED_MEMBERS },
    ),
  }),
  permission: "members:manage",
  apply(store, args, ctx) {
    if (args.members.length === 0) return fail("invalid_args", "No members to reconcile with");
    const members: { id: string; role: Role; resetAt: number | null }[] = args.members;
    const roles = new Map<string, Role>(members.map((member) => [member.id, member.role]));
    const events: DomainEvent[] = [];
    // Devices last registered before their member's password was reset: the reset's own `device.signOut` failed in
    // this shard, and they may be someone else's phone (RFC 0002 "Auth"). The app registers again after signing in.
    for (const { id, resetAt } of members) {
      if (resetAt !== null) events.push(...dropDevices(store, id, "password_reset", resetAt));
    }
    for (const current of store.scan("members")) {
      const role = roles.get(current.id);
      if (role === undefined) {
        store.delete("members", current.id);
        forgetMemberSettings(store, current.id);
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
    // Settings of someone with no copy, likewise: a member who rejoins starts from the defaults.
    for (const settings of store.scan("member_settings")) {
      if (roles.has(settings.id)) continue;
      forgetMemberSettings(store, settings.id);
      const event: MemberCallsChanged = {
        type: "member.calls_changed",
        subject: settings.id,
        data: { userId: settings.id, calls: DEFAULT_CALL_CHOICE },
      };
      events.push(event);
    }
    if (events.length === 0) return fail("conflict", "Members are up to date");
    return ok(...events);
  },
});
