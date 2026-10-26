// Workspace invitations (RFC 0003 "Invitations"): who may invite whom, the limits that bound them, and the
// server-only mutations that announce each change (RFC 0005). D1 (Better Auth's `invitation` and `member` tables)
// is the authority: the workspace shard writes it first, under its member lock, then runs these, so they never
// decide a change on their own (apps/api/src/invitations.ts).

import { can, ROLES, type Role } from "./access.ts";
import { MEMBERS_ACTOR } from "./members.ts";
import { defineMutation, fail, ok, type Actor, type DomainEvent } from "./mutation.ts";
import type { MemberRow } from "./tables.ts";
import { memberName } from "./workspaces.ts";
import { v } from "./validate.ts";

/** How long an invitation can be accepted; sending it again restarts the clock. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Pending invitations one workspace may have at once. */
export const MAX_PENDING_INVITATIONS = 50;
/**
 * Invitation emails (new invitations and resends) one workspace may send in a day (RFC 0005 "Abuse"): each one is
 * an email from Brigade's domain to an address the inviter typed, naming the workspace they chose.
 */
export const INVITATIONS_DAILY_CAP = 30;
/** The shortest time between two sends of one invitation, so Resend cannot flood one inbox. */
export const INVITATION_RESEND_INTERVAL_MS = 5 * 60 * 1000;
/** The most members a workspace may have; accepting past it is refused (the dashboard lists 100 at most). */
export const MAX_WORKSPACE_MEMBERS = 100;
/** The longest email address an invitation takes (RFC 5321's path limit). */
export const INVITATION_EMAIL_MAX = 254;

/** Why an invitation stopped being pending without an acceptance. */
export const INVITATION_ENDINGS = ["revoked", "declined"] as const;

export type MemberInvited = DomainEvent<
  "member.invited",
  /** `send`: 1 for the first email, then one more per resend. Never the address: D1 keeps it. */
  { invitationId: string; role: Role; invitedBy: string; expiresAt: number; send: number }
>;
export type MemberAdded = DomainEvent<
  "member.added",
  { userId: string; role: Role; invitationId: string }
>;
export type InvitationRevoked = DomainEvent<
  "invitation.revoked",
  { invitationId: string; revokedBy: string }
>;
export type InvitationDeclined = DomainEvent<
  "invitation.declined",
  { invitationId: string; userId: string }
>;

/** Why an invite is refused by the rules alone (before limits and D1). */
export type InviteRefusal = "forbidden";

/**
 * Whether `actor` may invite someone as `role` (RFC 0003 "Invitations"): owners and admins (`members:manage`)
 * invite, and only an owner invites an owner, as only an owner makes someone one. Revoking and resending follow the
 * same rule for the invitation's role. The API checks it against D1; the dashboard uses it to offer only the roles
 * that will be accepted.
 */
export function checkInvite(actor: { role: Role }, role: Role): { ok: true } | { ok: false; code: InviteRefusal } {
  if (!can(actor.role, "members:manage")) return { ok: false, code: "forbidden" };
  if (role === "owner" && actor.role !== "owner") return { ok: false, code: "forbidden" };
  return { ok: true };
}

/** The roles `actor` may invite as, most powerful first; empty when they may invite nobody. */
export function inviteRoles(actor: { role: Role }): Role[] {
  return ROLES.filter((role) => checkInvite(actor, role).ok);
}

const EMAIL = /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;

/**
 * An address as an invitation stores it: trimmed and lower-cased (Better Auth stores and compares them so), at most
 * `INVITATION_EMAIL_MAX`, one `@`, a dot in the domain, and nothing that could break a header or markup. Undefined
 * when it is not one.
 */
export function invitationEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > INVITATION_EMAIL_MAX) return undefined;
  for (const char of email) {
    const code = char.codePointAt(0)!;
    if (code < 0x21 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return undefined;
  }
  return EMAIL.test(email) ? email : undefined;
}

const invitationId = v.string({ min: 1, max: 64 });
const userId = v.string({ min: 1, max: 64 });

/** Whether the actor running an invitation mutation for a member's request is that member, with `members:manage`. */
const manages = (actor: Actor, role: Role) => actor.kind === "user" && checkInvite(actor, role).ok;
const isMembersActor = (actor: Actor) =>
  actor.kind === MEMBERS_ACTOR.kind && actor.id === MEMBERS_ACTOR.id;

/**
 * Server only: an invitation D1 now has pending (a new one, `send` 1, or sent again with a new expiry). Emits
 * `member.invited`, which the email notifier turns into the invitation email. Run by the inviter (an owner or admin
 * who may invite as `role`), or by `MEMBERS_ACTOR` catching the shard up with one D1 has.
 */
export const inviteMember = defineMutation({
  name: "invitation.create",
  args: v.object({
    id: invitationId,
    role: v.picklist(ROLES),
    expiresAt: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    send: v.integer({ min: 1, max: 1000 }),
    invitedBy: userId,
  }),
  permission: "members:manage",
  apply(_store, args, ctx) {
    if (!isMembersActor(ctx.actor) && (!manages(ctx.actor, args.role) || ctx.actor.id !== args.invitedBy)) {
      return fail("forbidden", "Not allowed to invite as this role");
    }
    const event: MemberInvited = {
      type: "member.invited",
      subject: args.id,
      data: {
        invitationId: args.id,
        role: args.role,
        invitedBy: args.invitedBy,
        expiresAt: args.expiresAt,
        send: args.send,
      },
    };
    return ok(event);
  },
});

/** Server only: an invitation D1 no longer has pending because an owner or admin revoked it. */
export const revokeInvitation = defineMutation({
  name: "invitation.revoke",
  args: v.object({ id: invitationId, role: v.picklist(ROLES), revokedBy: userId }),
  permission: "members:manage",
  apply(_store, args, ctx) {
    if (!isMembersActor(ctx.actor) && (!manages(ctx.actor, args.role) || ctx.actor.id !== args.revokedBy)) {
      return fail("forbidden", "Not allowed to revoke this invitation");
    }
    const event: InvitationRevoked = {
      type: "invitation.revoked",
      subject: args.id,
      data: { invitationId: args.id, revokedBy: args.revokedBy },
    };
    return ok(event);
  },
});

/**
 * Server only, as `MEMBERS_ACTOR`: the invitee turned the invitation down (D1 has it declined). The invitee is no
 * member, so no member actor could run it; the API checked that they are the invitee.
 */
export const declineInvitation = defineMutation({
  name: "invitation.decline",
  args: v.object({ id: invitationId, userId }),
  permission: "members:manage",
  apply(_store, args, ctx) {
    if (!isMembersActor(ctx.actor)) return fail("forbidden", "Only the API declines invitations");
    const event: InvitationDeclined = {
      type: "invitation.declined",
      subject: args.id,
      data: { invitationId: args.id, userId: args.userId },
    };
    return ok(event);
  },
});

/**
 * Server only, as `MEMBERS_ACTOR`: the invitee accepted, and D1 has them as a member with the invitation's role.
 * Writes the shard's copy of the member (so they can be put on call before they first open Brigade; `member.sync`
 * keeps it current after that) and emits `member.added`. Run once per acceptance D1 made.
 */
export const addMember = defineMutation({
  name: "member.add",
  args: v.object({
    id: userId,
    // Null: D1's name is not one the shard can keep (see `fitMemberName`).
    name: v.nullable(memberName),
    role: v.picklist(ROLES),
    invitationId,
  }),
  permission: "members:manage",
  apply(store, args, ctx) {
    if (!isMembersActor(ctx.actor)) return fail("forbidden", "Only the API adds members");
    const row: MemberRow = { id: args.id, name: args.name, role: args.role, updatedAt: ctx.now };
    if (store.get("members", args.id)) store.update("members", args.id, row);
    else store.insert("members", row);
    const event: MemberAdded = {
      type: "member.added",
      subject: args.id,
      data: { userId: args.id, role: args.role, invitationId: args.invitationId },
    };
    return ok(event);
  },
});

export const invitationMutations = [
  inviteMember,
  revokeInvitation,
  declineInvitation,
  addMember,
] as const;
