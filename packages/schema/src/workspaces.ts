// The workspace itself (RFC 0003). Users, sessions and membership live in D1 (Better Auth's organization plugin,
// RFC 0002); the workspace shard keeps one `workspace` row and announces the workspace with `workspace.created`
// through its outbox (RFC 0005), run by the API Worker right after Better Auth creates the organization.

import { ROLES } from "./access.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { MemberRow, WorkspaceRow } from "./tables.ts";
import { trimSpace } from "./text.ts";
import { v } from "./validate.ts";

/**
 * How long a Better Auth session lasts without being used, in seconds (its `session.expiresIn`, Better Auth's
 * default of 7 days, apps/api/src/auth.ts). The mobile app drops a sign-out it kept from offline after this long.
 */
export const SESSION_LIFETIME_S = 60 * 60 * 24 * 7;

export const WORKSPACE_NAME_MAX = 80;
/** The longest member name, in UTF-16 code units after trimming: what the API accepts and the shard keeps. */
export const MEMBER_NAME_MAX = 100;

/**
 * A person's name: the title rules (no controls, bidi or other invisible characters) except that ZWNJ and ZWJ may
 * join two letters, which Persian, Arabic and Indic names need. The API checks it at sign-up and on a name change.
 */
export const memberName = v.string({ min: 1, max: MEMBER_NAME_MAX, joiners: true });

// Graphemes where the engine has them (Workers, browsers, Hermes), so a cut never splits an accent or an emoji.
const graphemes =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/**
 * The name the shard keeps for a member whose D1 name may predate `memberName` (or skipped it): trimmed, cut to
 * `MEMBER_NAME_MAX` at a grapheme, and checked. Null when even that is refused, so the member is still listed
 * (and assignable) and the dashboard shows them as unnamed instead of not at all.
 */
export function fitMemberName(raw: string): string | null {
  let name = trimSpace(raw);
  if (name.length > MEMBER_NAME_MAX) {
    const parts = graphemes
      ? Array.from(graphemes.segment(name), (part) => part.segment)
      : Array.from(name);
    let cut = "";
    for (const part of parts) {
      if (cut.length + part.length > MEMBER_NAME_MAX) break;
      cut += part;
    }
    // A joiner left at the end (ZWNJ, ZWJ) has nothing to join; trimming can expose one, so repeat until neither
    // a joiner nor a space ends the name.
    const joiner = (text: string) =>
      text.endsWith(String.fromCharCode(0x200c)) || text.endsWith(String.fromCharCode(0x200d));
    for (let before = ""; before !== cut;) {
      before = cut;
      while (joiner(cut)) cut = cut.slice(0, -1);
      cut = trimSpace(cut);
    }
    name = cut;
  }
  const result = memberName(name);
  return result.ok ? result.value : null;
}

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
 * monitor's refreshed latency it is `silent` (no outbox event). Membership changes themselves are announced by the
 * mutations that apply them (`member.changeRole`, `member.remove`, `member.reconcile` in members.ts; `member.added`
 * once invitations exist), which write this table too. A member can only copy themselves; no change is a
 * `conflict`.
 */
export const syncMember = defineMutation({
  name: "member.sync",
  args: v.object({
    id: v.string({ min: 1, max: 64 }),
    // Null: D1's name is not one the shard can keep (see `fitMemberName`).
    name: v.nullable(memberName),
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

/** By name, unnamed members last, then id (code point order, the same on every replica). */
const byName = (a: MemberRow, b: MemberRow) =>
  (a.name === b.name ? 0 : a.name === null ? 1 : b.name === null ? -1 : a.name < b.name ? -1 : 1) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The members the shard knows (see `member.sync`). */
export const allMembers = defineQuery({
  name: "members.all",
  args: v.object({}),
  permission: "workspace:read",
  table: "members",
  filter: () => true,
  sort: byName,
});
