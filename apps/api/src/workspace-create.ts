// Creating a workspace in D1 without Better Auth's organization plugin (RFC 0017): what the plugin did for
// `POST /workspaces` and the first owner on D1's engine, done by Brigade itself on the Ember engine. Workspaces are
// Brigade's: `organization` and `member` keep their tables and columns, so everything that reads them is unchanged.

import type { Locale } from "@freecorps/brigade-i18n";
import { authId, WORKSPACE_LIMIT, type AuthBindings } from "./auth.ts";

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export type CreatedWorkspace =
  | { ok: true; id: string; name: string }
  | { ok: false; code: "workspace_limit" | "internal" };

/** Deletes a workspace just made, with its memberships, as the organization plugin's undo did. Never throws. */
async function undo(db: D1Database, workspaceId: string): Promise<void> {
  try {
    await db.batch([
      db.prepare(`delete from member where "organizationId" = ?`).bind(workspaceId),
      db.prepare(`delete from organization where id = ?`).bind(workspaceId),
    ]);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "undoing a new workspace failed",
        workspace: workspaceId,
        error: String(error),
      }),
    );
  }
}

/**
 * Makes workspace `name` (already checked by `workspaceName`) with `owner` as its owner, then provisions its shard
 * (`provision`, as `onWorkspaceCreated` does on D1). At most `WORKSPACE_LIMIT` memberships per user, checked in the
 * same transaction as the insert: both rows go in only while the owner has fewer, so creates at once cannot pass it
 * together. One whose shard could not be provisioned is deleted again, so no workspace is left without its shard.
 * Throws only when D1 cannot take the rows.
 */
export async function createWorkspaceInD1(
  db: D1Database,
  owner: { id: string; locale: Locale },
  name: string,
  provision: NonNullable<AuthBindings["onWorkspaceCreated"]>,
  now = Date.now(),
): Promise<CreatedWorkspace> {
  const id = authId("organization", now, randomBytes);
  const at = new Date(now).toISOString();
  // One D1 batch is one transaction: the count, then each insert, with no other write in between.
  const [workspace] = await db.batch([
    db
      .prepare(
        `insert into organization (id, name, slug, "createdAt")
         select ?1, ?2, ?3, ?4 where (select count(*) from member where "userId" = ?5) < ?6`,
      )
      // The slug is only a unique handle for now; the id names the shard.
      .bind(id, name, `ws-${crypto.randomUUID()}`, at, owner.id, WORKSPACE_LIMIT),
    db
      .prepare(
        `insert into member (id, "organizationId", "userId", role, "createdAt")
         select ?1, ?2, ?3, 'owner', ?4 where exists (select 1 from organization where id = ?2)`,
      )
      .bind(authId("member", now, randomBytes), id, owner.id, at),
  ]);
  if (workspace?.meta.changes !== 1) return { ok: false, code: "workspace_limit" };

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
