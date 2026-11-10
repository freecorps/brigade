// Creating a workspace in D1 without Better Auth's organization plugin (RFC 0017): what the plugin did for
// `POST /workspaces` and the first owner on D1's engine, done by Brigade itself on the Ember engine. Workspaces are
// Brigade's: `organization` and `member` keep their tables and columns, so everything that reads them is unchanged.

import type { Locale } from "@freecorps/brigade-i18n";
import { authId, WORKSPACE_LIMIT, type AuthBindings } from "./auth.ts";

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export type CreatedWorkspace =
  | { ok: true; id: string; name: string }
  | { ok: false; code: "workspace_limit" | "internal" };

/** Deletes a workspace just made, with its memberships, as the organization plugin's undo did. */
async function undo(db: D1Database, workspaceId: string): Promise<void> {
  await db.batch([
    db.prepare(`delete from member where "organizationId" = ?`).bind(workspaceId),
    db.prepare(`delete from organization where id = ?`).bind(workspaceId),
  ]);
}

/**
 * Makes workspace `name` (already checked by `workspaceName`) with `owner` as its owner, then provisions its shard
 * (`provision`, as `onWorkspaceCreated` does on D1). At most `WORKSPACE_LIMIT` memberships per user: counted first, and
 * again once the rows are in, since creates at once could all pass the first count; a create past the limit and one
 * whose shard could not be provisioned are deleted again, so no workspace exists without its shard.
 */
export async function createWorkspaceInD1(
  db: D1Database,
  owner: { id: string; locale: Locale },
  name: string,
  provision: NonNullable<AuthBindings["onWorkspaceCreated"]>,
  now = Date.now(),
): Promise<CreatedWorkspace> {
  const held = await db
    .prepare(`select count(*) as n from member where "userId" = ?`)
    .bind(owner.id)
    .first<{ n: number }>();
  if ((held?.n ?? 0) >= WORKSPACE_LIMIT) return { ok: false, code: "workspace_limit" };

  const id = authId("organization", now, randomBytes);
  const at = new Date(now).toISOString();
  await db.batch([
    db
      .prepare(`insert into organization (id, name, slug, "createdAt") values (?, ?, ?, ?)`)
      // The slug is only a unique handle for now; the id names the shard.
      .bind(id, name, `ws-${crypto.randomUUID()}`, at),
    db
      .prepare(
        `insert into member (id, "organizationId", "userId", role, "createdAt") values (?, ?, ?, 'owner', ?)`,
      )
      .bind(authId("member", now, randomBytes), id, owner.id, at),
  ]);

  // Keep the user's first WORKSPACE_LIMIT, oldest first (the order the plugin's recount used).
  const { results } = await db
    .prepare(
      `select "organizationId" as id from member where "userId" = ? order by "createdAt", id`,
    )
    .bind(owner.id)
    .all<{ id: string }>();
  const rank = results.findIndex((row) => row.id === id);
  if (rank === -1 || rank >= WORKSPACE_LIMIT) {
    await undo(db, id);
    return { ok: false, code: "workspace_limit" };
  }

  try {
    await provision({ id, name, ownerId: owner.id, locale: owner.locale });
  } catch (error) {
    console.error(
      JSON.stringify({ message: "provisioning a new workspace failed", error: String(error) }),
    );
    await undo(db, id);
    return { ok: false, code: "internal" };
  }
  return { ok: true, id, name };
}
