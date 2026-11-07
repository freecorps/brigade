// Invitations on a workspace's Ember shard (RFC 0003 "Invitations", RFC 0016 "Parity"): the shard's side of
// `Invitations` (`InvitationLedger`: the email ledger, the server-only mutation, what a failed one owes) over an Ember
// mutation (ember/shard-facade.ts), its tables in Ember's private SQL. The orchestration with D1 runs in the Worker
// (src/ember-invitations.ts), the same `Invitations` the DO runs, without the member lock: D1's conditional writes
// re-check every condition in SQL. A failed shard step is repaired by `invitations:repair`, an action, since an owed
// `member.add` reads D1 first.

import {
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import type { Actor } from "@freecorps/brigade-schema";
import { InvitationLedger, type InvitationEmailPlan } from "../src/invitation-ledger.ts";
import type { InvitationResult } from "../src/invitations.ts";
import { readRole } from "../src/members.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  bumpFence,
  EMBER_MEMBER_REPAIR_DELAY_MS,
  EMBER_MEMBER_REPAIR_RETRY_MS,
} from "./members.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";

const REPAIR = "invitations:repair";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** The ledger over this mutation, or undefined for a shard that holds another workspace (or none). */
function ledgerOf(
  ctx: MutationCtx,
  workspaceId: string,
): { ledger: InvitationLedger; shard: EmberShard } | undefined {
  const { shard, storage } = emberWorkspace(ctx);
  if (shard.workspace() !== workspaceId) return undefined;
  const ledger = new InvitationLedger({
    shard: shard as never,
    sql: storage.sql,
    randomBytes: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
      return bytes;
    },
    log,
    // Ember's subscriptions follow the rows: nothing to broadcast.
    committed: () => {},
    armRepair: () => {
      ctx.scheduler.runAfter(EMBER_MEMBER_REPAIR_DELAY_MS, REPAIR, { workspaceId });
    },
  });
  return { ledger, shard };
}

/** `fn` over the ledger, then any storage failure it caught fails the mutation (`EmberShard.check`). */
function withLedger<T>(
  ctx: unknown,
  workspaceId: string,
  missing: T,
  fn: (ledger: InvitationLedger, shard: EmberShard) => T,
): T {
  const got = ledgerOf(ctx as MutationCtx, workspaceId);
  if (!got) return missing;
  const out = fn(got.ledger, got.shard);
  got.shard.check();
  return out;
}

const ws = { workspaceId: v.string() };

/**
 * Whether this shard holds the workspace, and backs `token` (an API token the change is sent through, RFC 0014): the
 * DO's checks before an invitation change.
 */
export const check = internalMutationGeneric({
  args: { ...ws, token: v.optional(v.any()) },
  handler: (ctx, input: { workspaceId: string; token?: Actor }) =>
    withLedger(ctx, input.workspaceId, { found: false, tokenBacked: false }, (_ledger, shard) => ({
      found: true,
      tokenBacked:
        input.token === undefined || shard.tokenActor(input.token, ctx.now) !== undefined,
    })),
});

export const prune = internalMutationGeneric({
  args: { ...ws, now: v.number() },
  handler: (ctx, input: { workspaceId: string; now: number }): null =>
    withLedger(ctx, input.workspaceId, null, (ledger) => {
      ledger.prune(input.now);
      return null;
    }),
});

export const sentToday = internalMutationGeneric({
  args: { ...ws, now: v.number() },
  handler: (ctx, input: { workspaceId: string; now: number }): number =>
    withLedger(ctx, input.workspaceId, 0, (ledger) => ledger.sentToday(input.now)),
});

export const sends = internalMutationGeneric({
  args: { ...ws, invitationId: v.string() },
  handler: (ctx, input: { workspaceId: string; invitationId: string }) =>
    withLedger(ctx, input.workspaceId, { count: 0, last: null as number | null }, (ledger) =>
      ledger.sends(input.invitationId),
    ),
});

export const recordSend = internalMutationGeneric({
  args: {
    ...ws,
    invitationId: v.string(),
    send: v.number(),
    now: v.number(),
    origin: v.union(v.string(), v.null()),
  },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      invitationId: string;
      send: number;
      now: number;
      origin: string | null;
    },
  ): null =>
    withLedger(ctx, input.workspaceId, null, (ledger) => {
      ledger.recordSend(input.invitationId, input.send, input.now, input.origin);
      return null;
    }),
});

/** One invitation mutation for a change D1 already has (`InvitationLedger.apply`). */
export const apply = internalMutationGeneric({
  args: { ...ws, actor: v.any(), name: v.string(), args: v.any(), now: v.number() },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      name: string;
      args: Record<string, unknown>;
      now: number;
    },
  ): InvitationResult =>
    withLedger(
      ctx,
      input.workspaceId,
      { ok: false, code: "not_found" } as InvitationResult,
      (ledger) => {
        const out = ledger.apply(input.actor, input.name, input.args, input.now);
        if (out.ok) fenced(ctx, input.name);
        return out;
      },
    ),
});

/**
 * A member change an invitation brought (`member.add` on accept) fences the member repair as `members:apply` does: a
 * repair holding a snapshot of D1 from before it is `stale`, rather than reconcile the new member away.
 */
function fenced(ctx: unknown, name: string): void {
  if (name.startsWith("member.")) bumpFence((ctx as MutationCtx).db);
}

/**
 * Records a mutation as owed to the repair (`InvitationLedger.owe`): the Worker's fallback when `apply` itself failed
 * (the shard reset mid-call), so a change D1 already has is never left unowed.
 */
export const owe = internalMutationGeneric({
  args: { ...ws, name: v.string(), args: v.any(), now: v.number() },
  handler: (
    ctx,
    input: { workspaceId: string; name: string; args: Record<string, unknown>; now: number },
  ): null =>
    withLedger(ctx, input.workspaceId, null, (ledger) => {
      ledger.owe(input.name, input.args, input.now);
      return null;
    }),
});

/** `WorkspaceDO.planInvitationEmail`. */
export const planEmail = internalMutationGeneric({
  args: { event: v.any() },
  handler: (ctx, { event }: { event: BrigadeEvent }): InvitationEmailPlan => {
    const data = event.data as { invitationId?: unknown; send?: unknown } | null;
    if (
      event.type !== "member.invited" ||
      typeof data?.invitationId !== "string" ||
      typeof data.send !== "number"
    ) {
      return { send: false, reason: "nothing" };
    }
    const { invitationId, send } = data as { invitationId: string; send: number };
    return withLedger(
      ctx,
      event.workspaceId,
      { send: false, reason: "nothing" } as InvitationEmailPlan,
      (ledger) => ledger.planEmail(invitationId, send, ctx.now),
    );
  },
});

/** `WorkspaceDO.recordInvitationEmail`. */
export const recordEmail = internalMutationGeneric({
  args: { event: v.any(), key: v.string(), done: v.boolean() },
  handler: (ctx, input: { event: BrigadeEvent; key: string; done: boolean }): null =>
    withLedger(ctx, input.event.workspaceId, null, (ledger) => {
      ledger.recordEmail(input.key, input.done);
      return null;
    }),
});

/** What failed shard steps owe, for the repair. */
export const owed = internalMutationGeneric({
  args: ws,
  handler: (ctx, input: { workspaceId: string }) =>
    withLedger(
      ctx,
      input.workspaceId,
      [] as { key: string; name: string; args: string }[],
      (ledger) => ledger.owed(),
    ),
});

/** One owed mutation run (`run`) or dropped, then forgotten; false when it could not run. */
export const settle = internalMutationGeneric({
  args: { ...ws, key: v.string(), name: v.string(), args: v.any(), run: v.boolean() },
  handler: (
    ctx,
    input: { workspaceId: string; key: string; name: string; args: unknown; run: boolean },
  ): boolean =>
    withLedger(ctx, input.workspaceId, false, (ledger) => {
      const settled = ledger.settle(input.key, input.name, input.args, input.run);
      if (settled && input.run) fenced(ctx, input.name);
      return settled;
    }),
});

const OWED = makeFunctionReference<"mutation">("invitations:owed");
const SETTLE = makeFunctionReference<"mutation">("invitations:settle");

/**
 * `InvitationLedger.repair` on Ember: every owed mutation, oldest first, as `MEMBERS_ACTOR`; an owed `member.add` only
 * while D1 still has that member (one removed since must not be added back), one whose arguments cannot be read
 * dropped. Scheduled again `EMBER_MEMBER_REPAIR_RETRY_MS` later while any is left.
 */
export const repair = internalActionGeneric({
  args: ws,
  handler: async (ctx, input: { workspaceId: string }): Promise<null> => {
    let done = true;
    try {
      const rows = (await ctx.runMutation(OWED, input)) as {
        key: string;
        name: string;
        args: string;
      }[];
      for (const row of rows) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.args);
        } catch (error) {
          log("invitation repair: dropping an owed mutation it cannot read", {
            name: row.name,
            error: String(error),
          });
          await ctx.runMutation(SETTLE, {
            ...input,
            key: row.key,
            name: row.name,
            args: null,
            run: false,
          });
          continue;
        }
        let run = true;
        if (row.name === "member.add") {
          const userId = String(Reflect.get(Object(parsed), "id"));
          // Gone from D1: the removal (or a reconcile) already settled the shard.
          run =
            (await readRole((ctx.env as { DB: D1Database }).DB, input.workspaceId, userId)) !==
            undefined;
        }
        const settled = (await ctx.runMutation(SETTLE, {
          ...input,
          key: row.key,
          name: row.name,
          args: parsed,
          run,
        })) as boolean;
        done = settled && done;
      }
    } catch (error) {
      log("invitation repair failed; trying again", { error: String(error) });
      done = false;
    }
    if (!done) await ctx.scheduler.runAfter(EMBER_MEMBER_REPAIR_RETRY_MS, REPAIR, input);
    return null;
  },
});
