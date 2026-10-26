// Member management in the workspace shard (RFC 0003 "Members", RFC 0006 "Who is paged"). D1 (Better Auth's
// `member` table) is the authority on who is a member and with which role; the shard keeps a copy (`members`) that
// paging and role assignment read, so a page never waits on D1. A change goes:
//
// 1. D1 first, from inside the shard and under its member lock, so no two changes (or a change and a reconcile) of
//    one workspace interleave between reading D1 and writing it. The write re-checks in SQL that it does not drop
//    the last owner, in case D1 was edited outside Brigade meanwhile.
// 2. Then the shard: a server-only `member.*` mutation updates the copy (removal deletes the member's devices in
//    the same transaction) and writes the event to the outbox (RFC 0005).
// 3. Then the member's open sockets close, so they reconnect with D1's answer (refused when removed, with the new
//    role otherwise).
//
// If step 2 fails after D1 committed, the request answers `not_applied`: the same request again finds D1 already
// changed and only applies the shard step, and every sync upgrade into the workspace reconciles the shard's copy
// with D1 (`member.reconcile`), which also closes sockets acting with a role D1 no longer gives them.

import {
  checkMemberChange,
  isRole,
  MAX_RECONCILED_MEMBERS,
  MEMBERS_ACTOR,
  newId,
  type Actor,
  type MemberChange,
  type RandomBytes,
  type Role,
} from "@freecorps/brigade-schema";
import type { Logger, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** A member as D1 has them; `role` is Better Auth's text, which may not be a Brigade role. */
export type DirectoryMember = { userId: string; role: string };

/** The workspace's members in D1, oldest first. */
export async function readDirectory(
  db: D1Database,
  workspaceId: string,
): Promise<DirectoryMember[]> {
  const { results } = await db
    .prepare(
      `select "userId", role from member where "organizationId" = ? order by "createdAt", id`,
    )
    .bind(workspaceId)
    .all<DirectoryMember>();
  return results;
}

/**
 * Sets a member's role in D1 if it is still `from`, and never takes the role of the last owner. False when nothing
 * changed (D1 moved since it was read).
 */
export async function writeRole(
  db: D1Database,
  workspaceId: string,
  userId: string,
  from: Role,
  to: Role,
): Promise<boolean> {
  const result = await db
    .prepare(
      `update member set role = ?4
       where "organizationId" = ?1 and "userId" = ?2 and role = ?3
         and (?3 != 'owner' or ?4 = 'owner'
              or (select count(*) from member where "organizationId" = ?1 and role = 'owner') > 1)`,
    )
    .bind(workspaceId, userId, from, to)
    .run();
  return result.meta.changes === 1;
}

/**
 * Deletes a membership in D1 (never the last owner's) and, in the same transaction, moves the member's sessions that
 * had this workspace active to their oldest remaining one (or none), so their next page load does not open a
 * workspace they left. False when nothing was deleted.
 */
export async function deleteMembership(
  db: D1Database,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [deleted] = await db.batch([
    db
      .prepare(
        `delete from member
         where "organizationId" = ?1 and "userId" = ?2
           and (role != 'owner'
                or (select count(*) from member where "organizationId" = ?1 and role = 'owner') > 1)`,
      )
      .bind(workspaceId, userId),
    db
      .prepare(
        `update session
         set "activeOrganizationId" =
           (select "organizationId" from member where "userId" = ?2 order by "createdAt", id limit 1)
         where "userId" = ?2 and "activeOrganizationId" = ?1
           and not exists (select 1 from member where "organizationId" = ?1 and "userId" = ?2)`,
      )
      .bind(workspaceId, userId),
  ]);
  return deleted!.meta.changes === 1;
}

/** What a member change answered (`WorkspaceDO.changeMember`, `PATCH`/`DELETE /workspaces/:id/members/:userId`). */
export type MemberChangeResult =
  | { ok: true }
  | {
      ok: false;
      /**
       * `forbidden`, `last_owner` (RFC 0003 rules), `not_found` (no such member), `conflict` (D1 changed while this
       * ran), `unavailable` (D1 failed: nothing changed), `not_applied` (D1 changed, the shard did not yet: send the
       * request again, or the next sync upgrade reconciles it).
       */
      code: "forbidden" | "last_owner" | "not_found" | "conflict" | "unavailable" | "not_applied";
    };

/** Why the shard closes a member's sockets: they are no longer a member, or their role changed. */
export type SocketVerdict = "removed" | "role_changed";

export class Membership {
  private tail: Promise<unknown> = Promise.resolve();
  private reconcileQueued = false;

  constructor(
    private readonly options: {
      db: D1Database;
      shard: Shard;
      randomBytes: RandomBytes;
      log: Logger;
      /** Sends a committed version's patches to the open sockets. */
      committed(version: number, changes: RowChange[]): void;
      /** Closes every socket whose actor `judge` returns a verdict for. */
      closeSockets(judge: (actor: Actor) => SocketVerdict | undefined): void;
    },
  ) {}

  /** Runs `task` after every earlier one of this shard's member changes and reconciles has finished. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => {});
    return run;
  }

  /** `actorId` makes `change` to `targetId` (themselves to leave); see the file's comment for the order. */
  change(
    workspaceId: string,
    actorId: string,
    targetId: string,
    change: MemberChange,
  ): Promise<MemberChangeResult> {
    return this.exclusive(async () => {
      const { db, shard, log } = this.options;
      let directory: DirectoryMember[];
      try {
        directory = await readDirectory(db, workspaceId);
      } catch (error) {
        log("member change: reading D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      const members = brigadeMembers(directory);
      const actor = members.find((member) => member.id === actorId);
      if (!actor) return { ok: false, code: "forbidden" };
      const target = members.find((member) => member.id === targetId);
      const copy = shard.store.get("members", targetId);

      if (!target) {
        // Gone from D1 already: a retry after the shard step failed, or an edit made outside Brigade. Only the
        // shard can still disagree, so apply it there.
        if (change.kind === "role") return { ok: false, code: "not_found" };
        const devices = shard.store.scan("devices").some((device) => device.userId === targetId);
        if (!copy && !devices) return { ok: true };
        const leaving = actorId === targetId;
        return this.apply(actor, "member.remove", targetId, {
          id: targetId,
          role: copy?.role ?? "viewer",
          reason: leaving ? "left" : "removed",
        });
      }

      const owners = members.filter((member) => member.role === "owner").length;
      const check = checkMemberChange(actor, target, change, owners);
      if (!check.ok && check.code !== "conflict") return check;
      if (!check.ok) {
        // D1 already has the role (a retry): bring the shard's copy along if it lags.
        if (change.kind !== "role" || !copy || copy.role === change.role) return { ok: true };
        return this.apply(actor, "member.changeRole", targetId, {
          id: targetId,
          from: copy.role,
          to: change.role,
        });
      }

      let written: boolean;
      try {
        written =
          change.kind === "role"
            ? await writeRole(db, workspaceId, targetId, target.role, change.role)
            : await deleteMembership(db, workspaceId, targetId);
      } catch (error) {
        log("member change: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (!written) return { ok: false, code: "conflict" };

      return change.kind === "role"
        ? this.apply(actor, "member.changeRole", targetId, {
            id: targetId,
            from: target.role,
            to: change.role,
          })
        : this.apply(actor, "member.remove", targetId, {
            id: targetId,
            role: target.role,
            reason: actorId === targetId ? "left" : "removed",
          });
    });
  }

  /**
   * Runs a `member.*` mutation for a change D1 already has (once per change: the callers skip it when the shard
   * already agrees), then closes the target's sockets. A failure is `not_applied`, logged as an error: D1 and the
   * shard disagree until the request is sent again or the next sync upgrade reconciles them.
   */
  private apply(
    actor: { id: string; role: Role },
    name: "member.changeRole" | "member.remove",
    targetId: string,
    args: object,
  ): MemberChangeResult {
    const { shard, log } = this.options;
    try {
      const now = Date.now();
      const { result, changes } = shard.mutate({
        clientId: "api",
        mutationId: newId("mut", now, this.options.randomBytes),
        actor: { kind: "user", id: actor.id, role: actor.role },
        name,
        args,
        now,
        internal: true,
      });
      if (!result.ok) {
        log("member change not applied to the shard", { name, code: result.error.code });
        return { ok: false, code: "not_applied" };
      }
      this.options.committed(result.version, changes);
    } catch (error) {
      log("member change not applied to the shard", { name, error });
      return { ok: false, code: "not_applied" };
    }
    this.options.closeSockets((socketActor) =>
      socketActor.kind === "user" && socketActor.id === targetId
        ? name === "member.remove"
          ? "removed"
          : "role_changed"
        : undefined,
    );
    return { ok: true };
  }

  /**
   * Makes the shard's member list agree with D1 (`member.reconcile`) and closes sockets acting as someone D1 no
   * longer has, or with a role it no longer gives them. Run after every sync upgrade, without holding it up; at
   * most one waits behind a running one. A workspace D1 does not know (a dev shard) is left alone. Never throws.
   */
  reconcile(workspaceId: string): Promise<void> {
    if (this.reconcileQueued) return Promise.resolve();
    this.reconcileQueued = true;
    return this.exclusive(async () => {
      this.reconcileQueued = false;
      const { db, shard, log } = this.options;
      try {
        const members = brigadeMembers(await readDirectory(db, workspaceId));
        if (members.length === 0) return;
        if (members.length > MAX_RECONCILED_MEMBERS) {
          log("too many members to reconcile", { members: members.length });
          return;
        }
        const { result, changes } = shard.mutate({
          clientId: "api",
          mutationId: newId("mut", Date.now(), this.options.randomBytes),
          actor: MEMBERS_ACTOR,
          name: "member.reconcile",
          args: { members },
          now: Date.now(),
          internal: true,
        });
        if (result.ok) this.options.committed(result.version, changes);
        else if (result.error.code !== "conflict") {
          log("member reconcile refused", { code: result.error.code });
        }
        const roles = new Map(members.map((member) => [member.id, member.role]));
        this.options.closeSockets((actor) => {
          if (actor.kind !== "user") return undefined;
          const role = roles.get(actor.id);
          if (role === undefined) return "removed";
          return role === actor.role ? undefined : "role_changed";
        });
      } catch (error) {
        log("member reconcile failed", { error });
      }
    });
  }
}

/** D1's members that hold a Brigade role: the only ones a socket may act as (src/actor.ts `memberRole`). */
function brigadeMembers(directory: DirectoryMember[]): { id: string; role: Role }[] {
  return directory.flatMap((member) =>
    isRole(member.role) ? [{ id: member.userId, role: member.role }] : [],
  );
}
