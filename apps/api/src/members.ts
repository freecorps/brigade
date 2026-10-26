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
// If step 2 fails after D1 committed, the request answers `not_applied` and the shard arms its alarm to reconcile
// its copy with D1 (`member.reconcile`, as `MEMBERS_ACTOR`) within `MEMBER_REPAIR_DELAY_MS`, retrying until it
// succeeds; every sync upgrade into the workspace reconciles too, and closes sockets acting with a role D1 no longer
// gives them. The same request again also finishes it: a leaver D1 already dropped may repeat their leave, and a
// member who may make the change has the shard catch up (as `MEMBERS_ACTOR`, never as the caller).

import {
  can,
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
       * `forbidden`, `last_owner` (RFC 0003 rules), `not_found` (no such member, and nothing of theirs left in the
       * shard), `conflict` (D1 changed while this ran), `unavailable` (D1 failed: nothing changed), `not_applied`
       * (D1 changed, the shard did not yet: the repair alarm reconciles it within `MEMBER_REPAIR_DELAY_MS`).
       */
      code: "forbidden" | "last_owner" | "not_found" | "conflict" | "unavailable" | "not_applied";
    };

/** Why the shard closes a member's sockets: they are no longer a member, or their role changed. */
export type SocketVerdict = "removed" | "role_changed";

/** After a `not_applied`, the shard's alarm reconciles the members this soon, whether or not anyone connects. */
export const MEMBER_REPAIR_DELAY_MS = 10 * 1000;
/** A repair that failed (D1 down) is tried again this often until it succeeds. */
export const MEMBER_REPAIR_RETRY_MS = 30 * 1000;

const REPAIR_SCHEMA = `
  create table if not exists member_repair (key text primary key, value integer not null) without rowid;
`;

/** What running `member.reconcile` did: changed the shard, found it already agreeing, or failed. */
type Repair = "repaired" | "unchanged" | "failed";

export class Membership {
  private tail: Promise<unknown> = Promise.resolve();
  private queued: Promise<boolean> | undefined;

  constructor(
    private readonly options: {
      db: D1Database;
      shard: Shard;
      sql: SqlStorage;
      randomBytes: RandomBytes;
      log: Logger;
      /** Sends a committed version's patches to the open sockets. */
      committed(version: number, changes: RowChange[]): void;
      /** Closes every socket whose actor `judge` returns a verdict for. */
      closeSockets(judge: (actor: Actor) => SocketVerdict | undefined): void;
      /** Brings the shard's alarm forward to `at` (or earlier); the alarm calls `repairDue`. */
      wake(at: number): void;
    },
  ) {
    options.sql.exec(REPAIR_SCHEMA);
  }

  /** Runs `task` after every earlier one of this shard's member changes and reconciles has finished. */
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => {});
    return run;
  }

  /**
   * `actorId` makes `change` to `targetId` (themselves to leave); see the file's comment for the order. Every rule
   * is checked before anything is repaired, and a repair (D1 already has the change: a retry, or an edit made outside
   * Brigade) runs as `MEMBERS_ACTOR` through `member.reconcile`, so its events never name the caller.
   */
  change(
    workspaceId: string,
    actorId: string,
    targetId: string,
    change: MemberChange,
  ): Promise<MemberChangeResult> {
    return this.exclusive(async () => {
      const result = await this.decide(workspaceId, actorId, targetId, change);
      if (!result.ok && result.code === "not_applied") this.armRepair(Date.now());
      return result;
    });
  }

  /**
   * A leave D1 already has, sent again by the leaver: the shard's leftovers are checked first, so someone with none
   * (an outsider probing workspaces, or a leave already finished) never takes the member lock or reads D1.
   */
  finishLeave(workspaceId: string, userId: string): Promise<MemberChangeResult> {
    if (!this.leftovers(userId)) return Promise.resolve({ ok: false, code: "not_found" });
    return this.change(workspaceId, userId, userId, { kind: "remove" });
  }

  /** Whether the shard still has `userId`'s member copy or a device of theirs. */
  private leftovers(userId: string): boolean {
    const { store } = this.options.shard;
    return (
      store.get("members", userId) !== undefined ||
      store.scan("devices").some((device) => device.userId === userId)
    );
  }

  private async decide(
    workspaceId: string,
    actorId: string,
    targetId: string,
    change: MemberChange,
  ): Promise<MemberChangeResult> {
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
    const target = members.find((member) => member.id === targetId);
    const copy = shard.store.get("members", targetId);
    const leftovers = this.leftovers(targetId);

    if (!actor) {
      // A leave whose shard step failed after D1 deleted the leaver: they may finish it themselves, so they stop
      // being paged without waiting for the repair alarm or someone else to connect.
      if (actorId !== targetId || change.kind !== "remove") return { ok: false, code: "forbidden" };
      if (!leftovers) return { ok: false, code: "not_found" };
      // Without a copy their role is unknown: the event says so (null) rather than guess. Running as a viewer
      // grants nothing: leaving needs only membership.
      return this.apply({ id: actorId, role: copy?.role ?? "viewer" }, "member.remove", targetId, {
        id: targetId,
        role: copy?.role ?? null,
        reason: "left",
      });
    }

    if (!target) {
      // Gone from D1 already: a retry after the shard step failed, or an edit made outside Brigade. Only someone who
      // could have removed them may have the shard catch up, and only a real leftover answers anything but 404.
      const allowed =
        can(actor.role, "members:manage") && (copy?.role !== "owner" || actor.role === "owner");
      if (!allowed) return { ok: false, code: "forbidden" };
      if (change.kind === "role" || !leftovers) return { ok: false, code: "not_found" };
      return this.repairNow(members);
    }

    const owners = members.filter((member) => member.role === "owner").length;
    const check = checkMemberChange(actor, target, change, owners);
    if (!check.ok && check.code !== "conflict") return check;
    if (!check.ok) {
      // D1 already has the role (a retry): bring the shard's copy along if it lags.
      if (!copy || copy.role === target.role) return { ok: true };
      return this.repairNow(members);
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
  }

  /** A repair asked for by a change: `not_applied` when it failed, so the repair alarm takes over. */
  private repairNow(members: { id: string; role: Role }[]): MemberChangeResult {
    return this.repair(members) === "failed" ? { ok: false, code: "not_applied" } : { ok: true };
  }

  /**
   * Runs a `member.*` mutation for a change D1 already has (once per change: the callers skip it when the shard
   * already agrees), then closes the target's sockets. A failure is `not_applied`, logged as an error: D1 and the
   * shard disagree until the repair alarm (or the next sync upgrade) reconciles them.
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
   * Runs `member.reconcile` as `MEMBERS_ACTOR` with D1's `members` and closes sockets acting as someone D1 no longer
   * has, or with a role it no longer gives them. Never throws.
   */
  private repair(members: { id: string; role: Role }[]): Repair {
    const { shard, log } = this.options;
    let outcome: Repair;
    try {
      const now = Date.now();
      const { result, changes } = shard.mutate({
        clientId: "api",
        mutationId: newId("mut", now, this.options.randomBytes),
        actor: MEMBERS_ACTOR,
        name: "member.reconcile",
        args: { members },
        now,
        internal: true,
      });
      if (result.ok) {
        this.options.committed(result.version, changes);
        outcome = "repaired";
      } else if (result.error.code === "conflict") {
        outcome = "unchanged";
      } else {
        log("member reconcile refused", { code: result.error.code });
        return "failed";
      }
    } catch (error) {
      log("member reconcile failed", { error });
      return "failed";
    }
    const roles = new Map(members.map((member) => [member.id, member.role]));
    this.options.closeSockets((actor) => {
      if (actor.kind !== "user") return undefined;
      const role = roles.get(actor.id);
      if (role === undefined) return "removed";
      return role === actor.role ? undefined : "role_changed";
    });
    return outcome;
  }

  /**
   * Makes the shard's member list agree with D1 (`member.reconcile`) and closes sockets D1 no longer backs. Run after
   * every sync upgrade, without holding it up, and by the repair alarm; at most one waits behind a running one. A
   * workspace D1 does not know (a dev shard) is left alone. Resolves false when D1 or the shard failed; never throws.
   */
  reconcile(workspaceId: string): Promise<boolean> {
    if (this.queued) return this.queued;
    const run = this.exclusive(async () => {
      this.queued = undefined;
      let members: { id: string; role: Role }[];
      try {
        members = brigadeMembers(await readDirectory(this.options.db, workspaceId));
      } catch (error) {
        this.options.log("member reconcile failed", { error });
        return false;
      }
      if (members.length === 0) return true;
      if (members.length > MAX_RECONCILED_MEMBERS) {
        // Not retried: it would fail the same way every time. A due repair is dropped with it, so a member removed
        // or demoted whose shard step failed stays paged as before: an error to act on, not a retry (RFC 0006).
        this.options.log(
          "too many members to reconcile: the shard may page members D1 removed or demoted",
          {
            members: members.length,
            max: MAX_RECONCILED_MEMBERS,
            error: "member_limit",
          },
        );
        return true;
      }
      return this.repair(members) !== "failed";
    });
    this.queued = run;
    return run;
  }

  /** Asks the shard's alarm for a reconcile `MEMBER_REPAIR_DELAY_MS` from `now` (or sooner, if one is already due). */
  private armRepair(now: number): void {
    try {
      const current = this.repairAt();
      const at = Math.min(current ?? Infinity, now + MEMBER_REPAIR_DELAY_MS);
      this.setRepairAt(at);
      this.options.wake(at);
    } catch (error) {
      // The next sync upgrade reconciles anyway.
      this.options.log("arming the member repair failed", { error });
    }
  }

  /** When the repair alarm wants to run next; null with nothing to repair. */
  repairAt(): number | null {
    const row = this.options.sql
      .exec<{ value: number }>("select value from member_repair where key = 'at'")
      .toArray()[0];
    return row?.value ?? null;
  }

  private setRepairAt(at: number | null): void {
    if (at === null) this.options.sql.exec("delete from member_repair where key = 'at'");
    else {
      this.options.sql.exec(
        "insert into member_repair (key, value) values ('at', ?) on conflict (key) do update set value = excluded.value",
        at,
      );
    }
  }

  /**
   * The shard alarm's member work: reconciles when a repair is due, and tries again every `MEMBER_REPAIR_RETRY_MS`
   * until one succeeds. Returns when it wants the alarm next, or null with nothing to repair.
   */
  async repairDue(workspaceId: string | undefined, now: number): Promise<number | null> {
    const at = this.repairAt();
    if (at === null) return null;
    if (at > now) return at;
    if (workspaceId === undefined || (await this.reconcile(workspaceId))) {
      this.setRepairAt(null);
      return null;
    }
    const retry = now + MEMBER_REPAIR_RETRY_MS;
    this.setRepairAt(retry);
    return retry;
  }
}

/** D1's members that hold a Brigade role: the only ones a socket may act as (src/actor.ts `memberRole`). */
function brigadeMembers(directory: DirectoryMember[]): { id: string; role: Role }[] {
  return directory.flatMap((member) =>
    isRole(member.role) ? [{ id: member.userId, role: member.role }] : [],
  );
}
