// The workspace itself (RFC 0003). Users, sessions and membership live in D1 (Better Auth's organization plugin,
// RFC 0002); the workspace shard keeps one `workspace` row and announces the workspace with `workspace.created`
// through its outbox (RFC 0005), run by the API Worker right after Better Auth creates the organization.

import { ROLES } from "./access.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { MemberRow, WorkspaceRow } from "./tables.ts";
import { v } from "./validate.ts";

export const WORKSPACE_NAME_MAX = 80;
/** The longest member name the shard keeps; Better Auth's own limit is the dashboard's sign-up form. */
export const MEMBER_NAME_MAX = 100;

/** A workspace name as people type it; the API checks it with this before Better Auth stores it. */
export const workspaceName = v.string({ min: 1, max: WORKSPACE_NAME_MAX });

export type WorkspaceCreated = DomainEvent<
  "workspace.created",
  Pick<WorkspaceRow, "id" | "name" | "createdBy">
>;

/**
 * Server only: run by the API Worker when it provisions a shard, never from a socket, so it is not in `mutations`
 * (the registry clients send names from) but only in `serverMutations` (registry.ts).
 */
export const createWorkspace = defineMutation({
  name: "workspace.create",
  // The id is the shard's workspace (the Better Auth organization id), not a client-made one.
  args: v.object({ id: v.id("ws"), name: workspaceName }),
  permission: "workspace:create",
  apply(store, args, ctx) {
    // Run once per shard, by the Worker as the creating owner; anything else finds the row already there.
    if (store.scan("workspace").length > 0) return fail("conflict", "Workspace already exists");
    const row: WorkspaceRow = {
      id: args.id,
      name: args.name,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
    };
    store.insert("workspace", row);
    const event: WorkspaceCreated = {
      type: "workspace.created",
      subject: row.id,
      data: { id: row.id, name: row.name, createdBy: row.createdBy },
    };
    return ok(event);
  },
});

/**
 * Server only: copies the member a socket acts as into the shard's member list (`members`), from what the Worker
 * read in D1 when it authenticated the upgrade (RFC 0004 "Socket topology"). D1 stays the authority on membership:
 * this is a cache of it, so roles can point at members and the dashboard can show their names, and like a
 * monitor's refreshed latency it is `silent` (no outbox event). Membership changes themselves (`member.added`,
 * `member.role_changed`, `member.removed`) are announced by the mutations that make them once invitations exist
 * (RFC 0005), and those will write this table too. A member can only copy themselves; no change is a `conflict`.
 */
export const syncMember = defineMutation({
  name: "member.sync",
  args: v.object({
    id: v.string({ min: 1, max: 64 }),
    name: v.string({ min: 1, max: MEMBER_NAME_MAX }),
    role: v.picklist(ROLES),
  }),
  permission: "workspace:read",
  silent: true,
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user" || ctx.actor.id !== args.id || ctx.actor.role !== args.role) {
      return fail("forbidden", "Only a member's own socket copies them");
    }
    const current = store.get("members", args.id);
    if (current && current.name === args.name && current.role === args.role) {
      return fail("conflict", "Member is up to date");
    }
    const row: MemberRow = { ...args, updatedAt: ctx.now };
    if (current) store.update("members", args.id, row);
    else store.insert("members", row);
    return ok();
  },
});

/** By name, then id (code point order, the same on every replica). */
const byName = (a: MemberRow, b: MemberRow) =>
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The members the shard knows (see `member.sync`). */
export const allMembers = defineQuery({
  name: "members.all",
  args: v.object({}),
  permission: "workspace:read",
  table: "members",
  filter: () => true,
  sort: byName,
});
