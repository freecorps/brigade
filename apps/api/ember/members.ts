// Member changes on a workspace's Ember shard (RFC 0003 "Members", RFC 0006 "Who is paged"): the shard's part of what
// `Membership` does for `WorkspaceDO` (src/members.ts). D1 stays the authority; the API Worker reads and writes it
// (src/ember-members.ts) and these functions keep the shard's copy in line:
//
// - `state`: what the shard holds of a member (their copy, any device left), for the Worker's rules.
// - `apply`: one `member.changeRole` or `member.remove` for a change D1 already has, as the caller's actor.
// - `reconcile`: `member.reconcile` with D1's whole member list, as `MEMBERS_ACTOR`.
// - `armRepair` / `repair`: when `apply` failed after D1 committed, a scheduled action reads D1 again and reconciles,
//   retried by Ember's scheduler until it succeeds (the Durable Object's repair alarm).
//
// No tombstone: on Ember a removed member's token is refused by the auth hook, which checks D1 on every admission and
// refresh, and the Worker revokes their sockets right after `apply` (`revokeSockets`, by user and by API token
// creator).

import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
  type QueryCtx,
} from "@freecorps/ember-server";
import {
  createEmberStore,
  isRole,
  MAX_RECONCILED_MEMBERS,
  MEMBERS_ACTOR,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type Role,
} from "@freecorps/brigade-schema";
import { readDirectory } from "../src/members.ts";
import { BRIGADE_TABLES } from "./schema.ts";
import { run, workspaceId, workspaceLimits, type MutateResult } from "./workspace.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

// This module's own functions, for the repair action to call (`ctx.runQuery`/`ctx.runMutation`).
const STATE = makeFunctionReference<"query">("members:state");
const APPLY = makeFunctionReference<"mutation">("members:apply");
const RECONCILE = makeFunctionReference<"mutation">("members:reconcile");

/** After a change D1 has and the shard missed, the repair runs this soon (`MEMBER_REPAIR_DELAY_MS` on the DO). */
export const EMBER_MEMBER_REPAIR_DELAY_MS = 10 * 1000;

const actorArg = v.object({
  kind: v.union(
    v.literal("user"),
    v.literal("system"),
    v.literal("integration"),
    v.literal("token"),
  ),
  id: v.string(),
  role: v.string(),
  by: v.optional(v.string()),
  scopes: v.optional(v.array(v.string())),
});

/** What the shard holds of `targetId`; `tokenBacked` whether the API token `tokenId` is still good here. */
export type MemberState =
  | { found: false }
  | { found: true; copy: { role: Role } | null; leftovers: boolean; tokenBacked?: boolean };

export const state = internalQueryGeneric({
  args: { workspaceId: v.string(), targetId: v.string(), tokenId: v.optional(v.string()) },
  handler: (ctx, input): MemberState => {
    const store = createEmberStore<BrigadeTables>((ctx as QueryCtx).db as never, TABLE_SET);
    if (workspaceId(store) !== input.workspaceId) return { found: false };
    const copy = store.get("members", input.targetId);
    const leftovers =
      copy !== undefined ||
      store.scan("devices").some((device) => device.userId === input.targetId);
    let tokenBacked: boolean | undefined;
    if (input.tokenId !== undefined) {
      const token = store.get("api_tokens", input.tokenId);
      const now = (ctx as QueryCtx).now;
      tokenBacked =
        token !== undefined &&
        token.revokedAt === null &&
        (token.expiresAt === null || token.expiresAt > now);
    }
    return {
      found: true,
      copy: copy ? { role: copy.role } : null,
      leftovers,
      ...(tokenBacked === undefined ? {} : { tokenBacked }),
    };
  },
});

/** One member change D1 already has, as `actor`. Refused, it writes nothing. */
export const apply = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: actorArg,
    name: v.union(v.literal("member.changeRole"), v.literal("member.remove")),
    args: v.any(),
  },
  handler: (ctx, input): MutateResult => {
    const c = ctx as MutationCtx;
    const store = createEmberStore<BrigadeTables>(c.db as never, TABLE_SET);
    if (workspaceId(store) !== input.workspaceId) {
      return { ok: false, error: { code: "not_found", message: "No such workspace here" } };
    }
    if (!isRole(input.actor.role)) {
      return { ok: false, error: { code: "forbidden", message: "Not a Brigade role" } };
    }
    const actor = input.actor as Actor;
    return run(c, serverMutations, input.name, input.args, () => actor, workspaceLimits());
  },
});

/** A member as `member.reconcile` takes them. */
export type ReconciledMember = { id: string; role: Role; resetAt: number | null };

/**
 * `member.reconcile` with D1's `members`, as `MEMBERS_ACTOR`. Answers who it removed and whose role it changed, so
 * the Worker can close their sockets; `conflict` (nothing to repair) is `{ ok: true }` with neither.
 */
export const reconcile = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    members: v.array(
      v.object({ id: v.string(), role: v.string(), resetAt: v.union(v.number(), v.null()) }),
    ),
  },
  handler: (
    ctx,
    input,
  ): { ok: true; removed: string[]; changed: string[] } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const before = createEmberStore<BrigadeTables>(c.db as never, TABLE_SET);
    if (workspaceId(before) !== input.workspaceId) return { ok: false, code: "not_found" };
    const was = new Map(before.scan("members").map((member) => [member.id, member.role]));
    const out = run(
      c,
      serverMutations,
      "member.reconcile",
      { members: input.members },
      () => MEMBERS_ACTOR,
      workspaceLimits(),
    );
    if (!out.ok && out.error.code !== "conflict") return { ok: false, code: out.error.code };
    const now = new Map(input.members.map((member) => [member.id, member.role]));
    const removed = [...was.keys()].filter((id) => !now.has(id));
    const changed = [...was]
      .filter(([id, role]) => now.has(id) && now.get(id) !== role)
      .map(([id]) => id);
    return { ok: true, removed, changed };
  },
});

/** Schedules `repair` (a change D1 has and this shard missed); the DO's `armRepair`. */
export const armRepair = internalMutationGeneric({
  args: { workspaceId: v.string(), targetId: v.optional(v.string()) },
  handler: (ctx, input): null => {
    (ctx as MutationCtx).scheduler.runAfter(EMBER_MEMBER_REPAIR_DELAY_MS, "members:repair", input);
    return null;
  },
});

/**
 * Reads D1's members and reconciles the shard with them; throws when D1 or the shard failed, so Ember's scheduler
 * tries again. A workspace too large for one `member.reconcile` catches up `targetId` alone, as the DO does.
 */
export const repair = internalActionGeneric({
  args: { workspaceId: v.string(), targetId: v.optional(v.string()) },
  handler: async (ctx, input): Promise<null> => {
    const db = ctx.env.DB as D1Database;
    const members: ReconciledMember[] = (await readDirectory(db, input.workspaceId)).flatMap((m) =>
      isRole(m.role) ? [{ id: m.userId, role: m.role, resetAt: m.resetAt ?? null }] : [],
    );
    // A workspace D1 does not know (a dev shard): nothing to repair.
    if (members.length === 0) return null;
    if (members.length > MAX_RECONCILED_MEMBERS) {
      console.error(
        JSON.stringify({
          message: "too many members to reconcile on Ember: catching up the one member only",
          workspace: input.workspaceId,
          members: members.length,
          error: "member_limit",
        }),
      );
      if (input.targetId === undefined) return null;
      const target = members.find((member) => member.id === input.targetId);
      const held = (await ctx.runQuery(STATE, {
        workspaceId: input.workspaceId,
        targetId: input.targetId,
      } as never)) as MemberState;
      if (!held.found) return null;
      // Caught up already: the copy agrees with D1, or there is nothing of a removed member left.
      if (target ? !held.copy || held.copy.role === target.role : !held.leftovers) return null;
      const out = (await ctx.runMutation(APPLY, {
        workspaceId: input.workspaceId,
        actor: MEMBERS_ACTOR,
        ...(target
          ? {
              name: "member.changeRole",
              args: { id: target.id, from: held.copy!.role, to: target.role },
            }
          : {
              name: "member.remove",
              args: { id: input.targetId, role: held.copy?.role ?? null, reason: "reconciled" },
            }),
      } as never)) as MutateResult;
      if (!out.ok && out.error.code !== "conflict")
        throw new Error(`member repair: ${out.error.code}`);
      if (out.ok) await closeSockets(ctx.env, input.workspaceId, [input.targetId]);
      return null;
    }
    const out = (await ctx.runMutation(RECONCILE, {
      workspaceId: input.workspaceId,
      members,
    } as never)) as
      | { ok: true; removed: string[]; changed: string[] }
      | { ok: false; code: string };
    if (!out.ok) {
      if (out.code !== "not_found") throw new Error(`member reconcile: ${out.code}`);
      return null;
    }
    await closeSockets(ctx.env, input.workspaceId, [...out.removed, ...out.changed]);
    return null;
  },
});

/**
 * Closes the sockets of `userIds` and of the API tokens they created, as `Membership.repair` does after a reconcile:
 * they reconnect with D1's answer (refused when removed, with the new role otherwise). A failure is logged, not
 * thrown: the reconcile committed, and each socket's next token refresh reads D1 anyway.
 */
async function closeSockets(env: Record<string, unknown>, workspaceId: string, userIds: string[]) {
  if (userIds.length === 0) return;
  try {
    // Imported here: src/ember.ts builds the runtime from this module.
    const { ember, workspaceShard } = await import("../src/ember.ts");
    const shard = workspaceShard(workspaceId);
    await Promise.all(
      userIds.flatMap((userId) => [
        ember.revokeSockets(env as never, shard, { subject: userId }, { close: true }),
        ember.revokeSockets(env as never, shard, { claim: "by", value: userId }, { close: true }),
      ]),
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "closing repaired members' Ember sockets failed",
        workspace: workspaceId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
