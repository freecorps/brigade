// The workspace itself (RFC 0003). Users, sessions and membership live in D1 (Better Auth's organization plugin,
// RFC 0002); the workspace shard keeps one `workspace` row and announces the workspace with `workspace.created`
// through its outbox (RFC 0005), run by the API Worker right after Better Auth creates the organization.

import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import type { WorkspaceRow } from "./tables.ts";
import { v } from "./validate.ts";

export const WORKSPACE_NAME_MAX = 80;

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
