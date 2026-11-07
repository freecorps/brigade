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
// refresh, and the Worker revokes their sockets right after `apply`, whether it succeeded or not (`revokeSockets`, by
// user and by API token creator).

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
import { markGone, run, workspaceId, workspaceLimits, type MutateResult } from "./workspace.ts";

const TABLE_SET: ReadonlySet<string> = new Set(BRIGADE_TABLES);

// This module's own functions, for the repair action to call (`ctx.runQuery`/`ctx.runMutation`).
const STATE = makeFunctionReference<"query">("members:state");
const APPLY = makeFunctionReference<"mutation">("members:apply");
const RECONCILE = makeFunctionReference<"mutation">("members:reconcile");

/** After a change D1 has and the shard missed, the repair runs this soon (`MEMBER_REPAIR_DELAY_MS` on the DO). */
export const EMBER_MEMBER_REPAIR_DELAY_MS = 10 * 1000;
/** A repair that failed (D1 or the shard) runs again this much later, until it succeeds (`MEMBER_REPAIR_RETRY_MS`). */
export const EMBER_MEMBER_REPAIR_RETRY_MS = 30 * 1000;
/** A repair whose snapshot of D1 a member change overtook reads D1 again this soon. */
const STALE_RETRY_MS = 1000;

type FenceDoc = { _id: string; key: string; n: number };
type FenceDb = {
  query(t: "member_fence"): {
    withIndex(
      i: "by_key",
      r: (q: { eq(f: "key", v: string): unknown }) => unknown,
    ): {
      first(): FenceDoc | null;
    };
  };
  insert(t: "member_fence", v: { key: string; n: number }): string;
  patch(id: string, v: { n: number }): void;
};

/**
 * How many member changes this shard applied: a repair reads it before D1 and hands it back with its snapshot, and
 * `reconcile` refuses the snapshot if a change came in between (the Durable Object's member lock, as a fence).
 */
function fence(db: unknown): FenceDoc | null {
  return (db as FenceDb)
    .query("member_fence")
    .withIndex("by_key", (q) => q.eq("key", "members"))
    .first();
}

function bumpFence(db: unknown): void {
  const doc = fence(db);
  if (doc) (db as FenceDb).patch(doc._id, { n: doc.n + 1 });
  else (db as FenceDb).insert("member_fence", { key: "members", n: 1 });
}

/** When the copy last agreed with D1 (`member_fence` row `reconciled`, its `n` the time): the DO's `reconciled`. */
function reconciledDoc(db: unknown): FenceDoc | null {
  return (db as FenceDb)
    .query("member_fence")
    .withIndex("by_key", (q) => q.eq("key", "reconciled"))
    .first();
}

function markReconciled(db: unknown, at: number): void {
  const doc = reconciledDoc(db);
  if (doc) (db as FenceDb).patch(doc._id, { n: at });
  else (db as FenceDb).insert("member_fence", { key: "reconciled", n: at });
}

/** When the member list last agreed with D1, or null: a page checks it first when that is long ago. */
export const reconciledAt = internalQueryGeneric({
  args: {},
  handler: (ctx): number | null => reconciledDoc(ctx.db)?.n ?? null,
});

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
  | {
      found: true;
      copy: { role: Role } | null;
      leftovers: boolean;
      tokenBacked?: boolean;
      /** The member fence (`fence`), for a repair to hand back with its snapshot of D1. */
      gen: number;
    };

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
      gen: fence((ctx as QueryCtx).db)?.n ?? 0,
      ...(tokenBacked === undefined ? {} : { tokenBacked }),
    };
  },
});

/** What `apply` answers: the mutation's result, or `stale` when a repair's fence no longer holds. */
export type ApplyResult = MutateResult | { ok: false; error: { code: "stale"; message: string } };

/** One member change D1 already has, as `actor`. Refused, it writes nothing. */
export const apply = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: actorArg,
    name: v.union(v.literal("member.changeRole"), v.literal("member.remove")),
    args: v.any(),
    /** A repair's fence, read before D1 was: a change applied since makes it `stale`, and nothing is written. */
    gen: v.optional(v.number()),
  },
  handler: (ctx, input): ApplyResult => {
    const c = ctx as MutationCtx;
    const store = createEmberStore<BrigadeTables>(c.db as never, TABLE_SET);
    if (workspaceId(store) !== input.workspaceId) {
      return { ok: false, error: { code: "not_found", message: "No such workspace here" } };
    }
    if (!isRole(input.actor.role)) {
      return { ok: false, error: { code: "forbidden", message: "Not a Brigade role" } };
    }
    if (input.gen !== undefined && (fence(c.db)?.n ?? 0) !== input.gen) {
      return {
        ok: false,
        error: { code: "stale", message: "A member change came in since D1 was read" },
      };
    }
    const actor = input.actor as Actor;
    const out = run(c, serverMutations, input.name, input.args, () => actor, workspaceLimits());
    if (out.ok) bumpFence(c.db);
    return out;
  },
});

/** A member as `member.reconcile` takes them. */
export type ReconciledMember = { id: string; role: Role; resetAt: number | null };

/**
 * `member.reconcile` with D1's `members`, as `MEMBERS_ACTOR`. Answers who it removed and whose role it changed, for a
 * caller outside the shard to close their sockets; `conflict` (nothing to repair) is `{ ok: true }` with neither.
 */
export const reconcile = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    members: v.array(
      v.object({ id: v.string(), role: v.string(), resetAt: v.union(v.number(), v.null()) }),
    ),
    /** The fence read before D1 was: a member change applied since makes this snapshot `stale`. */
    gen: v.optional(v.number()),
  },
  handler: (
    ctx,
    input,
  ): { ok: true; removed: string[]; changed: string[] } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const before = createEmberStore<BrigadeTables>(c.db as never, TABLE_SET);
    if (workspaceId(before) !== input.workspaceId) return { ok: false, code: "not_found" };
    if (input.gen !== undefined && (fence(c.db)?.n ?? 0) !== input.gen) {
      return { ok: false, code: "stale" };
    }
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
    if (out.ok) bumpFence(c.db);
    // Applied, or nothing to apply (`conflict`): the copy agrees with D1 as of now.
    markReconciled(c.db, c.now);
    const now = new Map(input.members.map((member) => [member.id, member.role]));
    const removed = [...was.keys()].filter((id) => !now.has(id));
    markGone(c, removed);
    // Whoever D1 lists is a member again: no tombstone of theirs stands, as `member.sync` clears one.
    for (const member of input.members) {
      c.sql.exec("delete from member_gone where user_id = ?", member.id);
    }
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
 * Reads D1's members and reconciles the shard with them. It closes no socket: it runs in the shard itself (as a job
 * from its alarm), and closing goes through the shard's own RPC. The sockets were already closed by the Worker when
 * the change it repairs was made (`ember-members.ts`, on success and on failure alike); one D1 changed outside
 * Brigade ends at its next token refresh, at most 5 minutes later, since the auth hook reads the member from D1
 * (RFC 0016 "Auth"). Never gives up: a failure (D1, the shard) schedules the
 * repair again `EMBER_MEMBER_REPAIR_RETRY_MS` later, and a snapshot a member change overtook (`stale`) reads D1 again
 * at once, so the copy catches up however long D1 is out. A workspace too large for one `member.reconcile` catches
 * up `targetId` alone, as the DO does.
 */
export const repair = internalActionGeneric({
  args: { workspaceId: v.string(), targetId: v.optional(v.string()) },
  handler: async (ctx, input): Promise<null> => {
    let again: number | null;
    try {
      again = await repairOnce(ctx, input);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "Ember member repair failed; trying again",
          workspace: input.workspaceId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      again = EMBER_MEMBER_REPAIR_RETRY_MS;
    }
    if (again !== null) await ctx.scheduler.runAfter(again, "members:repair", input);
    return null;
  },
});

/** One repair; answers when to try again (null: done). Throws when D1 or the shard failed. */
export async function repairOnce(
  ctx: {
    env: Record<string, unknown>;
    runQuery(ref: unknown, args: unknown): Promise<unknown>;
    runMutation(ref: unknown, args: unknown): Promise<unknown>;
  },
  input: { workspaceId: string; targetId?: string },
): Promise<number | null> {
  // The fence first, then D1: a change the shard applies after this read makes the snapshot stale.
  const before = (await ctx.runQuery(STATE, {
    workspaceId: input.workspaceId,
    targetId: input.targetId ?? "",
  })) as MemberState;
  if (!before.found) return null;
  const db = ctx.env.DB as D1Database;
  const members: ReconciledMember[] = (await readDirectory(db, input.workspaceId)).flatMap((m) =>
    isRole(m.role) ? [{ id: m.userId, role: m.role, resetAt: m.resetAt ?? null }] : [],
  );
  // A workspace D1 does not know (a dev shard): nothing to repair, as on the DO.
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
    // Caught up already: the copy agrees with D1, or there is nothing of a removed member left.
    if (target ? !before.copy || before.copy.role === target.role : !before.leftovers) return null;
    const out = (await ctx.runMutation(APPLY, {
      workspaceId: input.workspaceId,
      actor: MEMBERS_ACTOR,
      gen: before.gen,
      ...(target
        ? {
            name: "member.changeRole",
            args: { id: target.id, from: before.copy!.role, to: target.role },
          }
        : {
            name: "member.remove",
            args: { id: input.targetId, role: before.copy?.role ?? null, reason: "reconciled" },
          }),
    })) as ApplyResult;
    if (!out.ok && out.error.code === "stale") return STALE_RETRY_MS;
    if (!out.ok && out.error.code !== "conflict")
      throw new Error(`member repair: ${out.error.code}`);
    return null;
  }
  const out = (await ctx.runMutation(RECONCILE, {
    workspaceId: input.workspaceId,
    members,
    gen: before.gen,
  })) as { ok: true; removed: string[]; changed: string[] } | { ok: false; code: string };
  if (!out.ok) {
    if (out.code === "not_found") return null;
    if (out.code === "stale") return STALE_RETRY_MS;
    throw new Error(`member reconcile: ${out.code}`);
  }
  return null;
}
