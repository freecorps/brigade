// Member changes for a workspace on Ember (RFC 0003 "Members"): what `Membership.change` and `finishLeave` do for
// `WorkspaceDO` (src/members.ts), with the same rules, D1 writes and answers, and the shard's part as Ember functions
// (ember/members.ts). This copy goes once `WorkspaceDO`'s engine is removed (RFC 0016 step 8).
//
// The Durable Object runs a change under its member lock, so no two changes (or a change and a reconcile) of one
// workspace interleave between reading D1 and writing it. Here D1's own conditional writes are the guard: the write
// happens only if the target and the caller still hold the roles the rules were checked against (and never drops the
// last owner), so a change that lost a race answers `conflict`, as the DO does when D1 moved. The repair is fenced
// too: `members:reconcile` refuses a snapshot of D1 read before a change the shard applied since (ember/members.ts). The shard's step runs after D1's, as on the DO; if
// it fails, the shard schedules a repair that reads D1 again (`members:armRepair`), and the request answers
// `not_applied`.

import type { EmberEnv } from "@freecorps/ember-runtime";
import {
  can,
  checkMemberChange,
  isRole,
  MEMBERS_ACTOR,
  tokenReaches,
  type Actor,
  type MemberChange,
} from "@freecorps/brigade-schema";
import type { MemberState, ReconciledMember } from "../ember/members.ts";
import type { MutateResult } from "../ember/workspace.ts";
import { ember, workspaceShard } from "./ember.ts";
import {
  deleteMembership,
  readDirectory,
  writeRole,
  type DirectoryMember,
  type MemberChangeResult,
} from "./members.ts";
import type { TokenRefused } from "./workspace.ts";

type Outcome = { ok: true; value: unknown } | { ok: false; error: { code: string } };
type EmberShardRpc = {
  mutation(
    s: string,
    fn: string,
    args: unknown,
    identity: null,
    internal: boolean,
  ): Promise<Outcome>;
  query(s: string, fn: string, args: unknown, identity: null, internal: boolean): Promise<Outcome>;
};

type MembersEnv = Pick<Env, "DB" | "SHARD">;

const log = (message: string, fields: { name?: string; error: unknown }) =>
  console.error(
    JSON.stringify({
      message,
      ...(fields.name === undefined ? {} : { name: fields.name }),
      error: fields.error instanceof Error ? fields.error.message : JSON.stringify(fields.error),
    }),
  );

/** The member calls of a workspace on Ember, with `WorkspaceDO`'s signatures. */
export function emberMembers(env: MembersEnv) {
  const call = async (
    kind: "query" | "mutation",
    workspaceId: string,
    fn: string,
    args: object,
  ) => {
    const shard = workspaceShard(workspaceId);
    const stub = env.SHARD.getByName(shard) as unknown as EmberShardRpc;
    const out = await stub[kind](shard, fn, args, null, true);
    if (!out.ok) throw new Error(`${fn} failed on Ember: ${out.error.code}`);
    return out.value;
  };
  const state = (workspaceId: string, targetId: string, tokenId?: string) =>
    call("query", workspaceId, "members:state", {
      workspaceId,
      targetId,
      ...(tokenId === undefined ? {} : { tokenId }),
    }) as Promise<MemberState>;

  /** Closes the target's sockets and their API tokens' on the shard (a token acts with its creator's role). */
  const closeSockets = async (workspaceId: string, userId: string) => {
    const shard = workspaceShard(workspaceId);
    const e = env as unknown as EmberEnv;
    await Promise.all([
      ember.revokeSockets(e, shard, { subject: userId }, { close: true }),
      ember.revokeSockets(e, shard, { claim: "by", value: userId }, { close: true }),
    ]);
  };

  /** A `member.*` mutation for a change D1 already has, then the target's sockets close; `not_applied` on failure. */
  const apply = async (
    workspaceId: string,
    actor: Actor,
    name: "member.changeRole" | "member.remove",
    targetId: string,
    args: object,
  ): Promise<MemberChangeResult> => {
    let result: MutateResult;
    try {
      result = (await call("mutation", workspaceId, "members:apply", {
        workspaceId,
        actor,
        name,
        args,
      })) as MutateResult;
    } catch (error) {
      result = { ok: false, error: { code: "internal", message: String(error) } };
    }
    if (!result.ok) {
      log("member change not applied to the Ember shard", { name, error: result.error.code });
      // D1 has the change: their sockets go now, as on success; the repair brings the copy along.
      try {
        await closeSockets(workspaceId, targetId);
      } catch (error) {
        log("closing a changed member's Ember sockets failed", { error });
      }
      try {
        await call("mutation", workspaceId, "members:armRepair", { workspaceId, targetId });
      } catch (error) {
        // The next change, or a reconcile, finds D1 and the copy apart and catches up; the auth hook already reads
        // the role from D1 on every admission and refresh.
        log("arming the Ember member repair failed", { error });
      }
      return { ok: false, code: "not_applied" };
    }
    try {
      await closeSockets(workspaceId, targetId);
    } catch (error) {
      // Their next token refresh ends them anyway: the hook reads D1, which already has the change.
      log("closing a changed member's Ember sockets failed", { error });
    }
    return { ok: true };
  };

  /** One member's copy in line with D1, as `MEMBERS_ACTOR` (`Membership.catchUp`). */
  const catchUp = async (
    workspaceId: string,
    targetId: string,
    members: ReconciledMember[],
    held: Extract<MemberState, { found: true }>,
  ): Promise<MemberChangeResult> => {
    const target = members.find((member) => member.id === targetId);
    if (!target) {
      if (!held.leftovers) return { ok: true };
      return apply(workspaceId, MEMBERS_ACTOR, "member.remove", targetId, {
        id: targetId,
        role: held.copy?.role ?? null,
        reason: "reconciled",
      });
    }
    if (!held.copy || held.copy.role === target.role) return { ok: true };
    return apply(workspaceId, MEMBERS_ACTOR, "member.changeRole", targetId, {
      id: targetId,
      from: held.copy.role,
      to: target.role,
    });
  };

  const change = async (
    workspaceId: string,
    actorId: string,
    targetId: string,
    memberChange: MemberChange,
    token?: Actor,
  ): Promise<MemberChangeResult | TokenRefused> => {
    let held: MemberState;
    try {
      held = await state(workspaceId, targetId, token?.id);
    } catch (error) {
      log("member change: reading the Ember shard failed", { error });
      return { ok: false, code: "unavailable" };
    }
    if (!held.found) return { ok: false, code: "not_found" };
    if (token && !held.tokenBacked) return { ok: false, code: "unauthenticated" };
    let directory: DirectoryMember[];
    try {
      directory = await readDirectory(env.DB, workspaceId);
    } catch (error) {
      log("member change: reading D1 failed", { error });
      return { ok: false, code: "unavailable" };
    }
    const members = brigadeMembers(directory);
    const actor = members.find((member) => member.id === actorId);
    const target = members.find((member) => member.id === targetId);
    const inD1 = (id: string) => directory.some((member) => member.userId === id);
    if ((!actor && inD1(actorId)) || (!target && inD1(targetId))) {
      return { ok: false, code: "forbidden" };
    }

    if (!actor) {
      // A leave whose shard step failed after D1 deleted the leaver: they may finish it themselves.
      if (actorId !== targetId || memberChange.kind !== "remove")
        return { ok: false, code: "forbidden" };
      if (!held.leftovers) return { ok: false, code: "not_found" };
      return apply(
        workspaceId,
        { kind: "user", id: actorId, role: held.copy?.role ?? "viewer" },
        "member.remove",
        targetId,
        { id: targetId, role: held.copy?.role ?? null, reason: "left" },
      );
    }

    if (!target) {
      const allowed =
        can(actor.role, "members:manage") &&
        (held.copy?.role !== "owner" || actor.role === "owner") &&
        (!token || tokenReaches(held.copy?.role ?? null));
      if (!allowed) return { ok: false, code: "forbidden" };
      if (memberChange.kind === "role" || !held.leftovers) return { ok: false, code: "not_found" };
      return catchUp(workspaceId, targetId, members, held);
    }

    const owners = members.filter((member) => member.role === "owner").length;
    const check = checkMemberChange(
      { ...actor, kind: token ? "token" : "user" },
      target,
      memberChange,
      owners,
    );
    if (!check.ok && check.code !== "conflict") return check;
    if (!check.ok) return catchUp(workspaceId, targetId, members, held);

    let written: boolean;
    try {
      // Conditional on what the rules were checked against, the caller's role included: without the Durable
      // Object's member lock, a change that raced another (or the caller's own demotion) answers `conflict`.
      const by = { id: actor.id, role: actor.role };
      written =
        memberChange.kind === "role"
          ? await writeRole(env.DB, workspaceId, targetId, target.role, memberChange.role, by)
          : await deleteMembership(env.DB, workspaceId, targetId, {
              role: target.role,
              ...(actorId === targetId ? {} : { by }),
            });
    } catch (error) {
      log("member change: writing D1 failed", { error });
      return { ok: false, code: "unavailable" };
    }
    if (!written) return { ok: false, code: "conflict" };

    const by: Actor = token
      ? { ...token, role: actor.role }
      : { kind: "user", id: actor.id, role: actor.role };
    return memberChange.kind === "role"
      ? apply(workspaceId, by, "member.changeRole", targetId, {
          id: targetId,
          from: target.role,
          to: memberChange.role,
        })
      : apply(workspaceId, by, "member.remove", targetId, {
          id: targetId,
          role: target.role,
          reason: actorId === targetId ? "left" : "removed",
        });
  };

  return {
    changeMember: change,
    /** A leave D1 already has, sent again by the leaver; nothing of theirs left is `not_found`. */
    async finishLeave(workspaceId: string, userId: string): Promise<MemberChangeResult> {
      let held: MemberState;
      try {
        held = await state(workspaceId, userId);
      } catch (error) {
        log("finishing a leave: reading the Ember shard failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (!held.found || !held.leftovers) return { ok: false, code: "not_found" };
      return change(workspaceId, userId, userId, { kind: "remove" }) as Promise<MemberChangeResult>;
    },
  };
}

/** D1's members that hold a Brigade role (`brigadeMembers` in src/members.ts). */
function brigadeMembers(directory: DirectoryMember[]): ReconciledMember[] {
  return directory.flatMap((member) =>
    isRole(member.role)
      ? [{ id: member.userId, role: member.role, resetAt: member.resetAt ?? null }]
      : [],
  );
}
