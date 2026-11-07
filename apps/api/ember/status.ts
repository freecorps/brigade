// The public status page on a workspace's Ember shard (RFC 0012, RFC 0016 "Parity"): `WorkspaceDO.configureStatusPage`
// and the alarm's snapshot push and maintenance windows. The page's settings run on the shard as on the DO; D1's slug
// claim and release run in the Worker (src/ember-status.ts), around `current` and `configure`. The snapshot push is
// the `status` tick (ember/ticks.ts), an action since it writes KV and D1: `plan` builds what is due with the DO's
// `StatusPublisher` (`planPush`), the action does it, and `record` writes what it did (`recordPush`) and arms the next
// one. Every mutation that puts the snapshot out of date arms it (`run()`'s `markStatus`), as the DO's alarm.
// Maintenance windows that start or end are moved on by the `maintenance` tick (`maintenance.advance`).

import {
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  nextMaintenanceAt,
  STATUS_PAGE_ID,
  type Actor,
} from "@freecorps/brigade-schema";
import { DeadlineError, within } from "../src/deadline.ts";
import { StatusPublisher, type StatusPushDone, type StatusPushPlan } from "../src/status-page.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

const PLAN = makeFunctionReference<"mutation">("status:plan");
const RECORD = makeFunctionReference<"mutation">("status:record");

/** How long one KV or D1 call of a push may take before the push is given up on (and its page marked to go again). */
export const STATUS_CALL_MS = 30 * 1000;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * A `StatusPublisher` over this mutation's shard facade. `kv`: whether the Worker has the snapshots' namespace (the
 * action says; a mutation that only arms the tick assumes it does). It never waits on KV or D1 itself.
 */
function publisherOf(ctx: MutationCtx, shard: EmberShard, kv = true): StatusPublisher {
  const { storage } = emberWorkspace(ctx);
  return new StatusPublisher({
    shard: shard as never,
    sql: storage.sql,
    kv: kv ? ({} as KVNamespace) : undefined,
    db: undefined as never,
    randomBytes: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
      return bytes;
    },
    log,
    committed: () => {},
    wake: (at) => tickAt(ctx, at, "status"),
  });
}

type Refused = { ok: false; code: "not_found" | "unauthenticated" | "not_a_member" };

/**
 * The DO's checks before a page change, and what D1's claim needs: the shard holds the workspace, backs the API token
 * (`acting`, its role possibly lowered), the member is not removed within the tombstone; then the page as it is.
 */
export const current = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor },
  ):
    | Refused
    | {
        ok: true;
        acting: Actor;
        page: { slug: string; claimed: boolean; updatedAt: number } | null;
      } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" };
    if (shard.gone(acting.by ?? acting.id, c.now)) return { ok: false, code: "not_a_member" };
    const page = shard.store.get("status_page", STATUS_PAGE_ID);
    return {
      ok: true,
      acting,
      page: page
        ? { slug: page.slug, claimed: page.claimed !== false, updatedAt: page.updatedAt }
        : null,
    };
  },
});

/**
 * `statusPage.configure` as `actor`, at `now` or later (after the page's last save, so claims and retirements stay
 * ordered), as `StatusPublisher.configure` runs it once D1's claim is done. `releasable`: whether a slug just claimed
 * may go back to D1 when it was refused (the page does not use it, nor still retires it).
 */
export const configure = internalMutationGeneric({
  args: { workspaceId: v.string(), actor: v.any(), args: v.any(), now: v.number() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; args: { slug: string }; now: number },
  ): { ok: true } | { ok: false; code: string; releasable: boolean } => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) {
      return { ok: false, code: "not_found", releasable: true };
    }
    const now = Math.max(
      c.now,
      input.now,
      (shard.store.get("status_page", STATUS_PAGE_ID)?.updatedAt ?? 0) + 1,
    );
    const { result } = shard.mutate({
      clientId: "api",
      mutationId: `status:${now}:${Math.floor(c.random() * 2 ** 32)}`,
      actor: input.actor,
      name: "statusPage.configure",
      args: input.args,
      now,
      internal: true,
    });
    if (result.ok) return { ok: true };
    return {
      ok: false,
      code: result.error.code,
      releasable: publisherOf(c, shard).releasable(input.args.slug),
    };
  },
});

/** What the push is to do now (`StatusPublisher.planPush`), or null, with the next push armed for when it is due. */
export const plan = internalMutationGeneric({
  args: { kv: v.boolean() },
  handler: (
    ctx,
    input: { kv: boolean },
  ): { workspaceId: string; plan: StatusPushPlan; now: number } | null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    const workspaceId = shard.workspace();
    if (workspaceId === undefined) return null;
    c.sql.exec("delete from ember_ticks where key = 'status'");
    const publisher = publisherOf(c, shard, input.kv);
    const due = publisher.planPush(workspaceId, c.now);
    if (due === null) {
      const at = publisher.nextAt(c.now);
      if (at !== null) tickAt(c, at, "status");
    }
    // A fallback while a push is under way: an action that dies before `record` never ends the chain (its page stays
    // dirty, so the fallback's plan pushes it again).
    else tickAt(c, c.now + STATUS_CALL_MS * 4, "status");
    shard.check();
    return due === null ? null : { workspaceId, plan: due, now: c.now };
  },
});

/**
 * What the push did (`StatusPublisher.recordPush`; `late`: a call outlasted `STATUS_CALL_MS` and may land after a
 * newer push, so the page goes again), then the next push armed.
 */
export const record = internalMutationGeneric({
  args: { kv: v.boolean(), plan: v.any(), done: v.any(), now: v.number(), late: v.boolean() },
  handler: (
    ctx,
    input: { kv: boolean; plan: StatusPushPlan; done: StatusPushDone; now: number; late: boolean },
  ): null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return null;
    const publisher = publisherOf(c, shard, input.kv);
    publisher.recordPush(input.plan, input.done, input.now);
    if (input.late) publisher.markRepush(c.now);
    const at = publisher.nextAt(c.now);
    if (at !== null) tickAt(c, at, "status");
    shard.check();
    return null;
  },
});

type PushEnv = { STATUS?: KVNamespace; DB: D1Database };
type ActionCtx = { env: PushEnv; runMutation(ref: unknown, args: unknown): Promise<unknown> };

/**
 * The snapshot push (the DO's `StatusPublisher.publish`): the page's snapshot put (or deleted) in KV, each retired
 * slug's snapshot deleted, and the slugs past their grace released in D1, in order, stopping at the first failure,
 * then recorded. A call that outlasts `STATUS_CALL_MS` counts as failed, and the page is pushed again after it.
 */
export const push = internalActionGeneric({
  args: {},
  handler: async (ctx): Promise<{ pushed: boolean }> => {
    const c = ctx as unknown as ActionCtx;
    const kv = c.env.STATUS;
    const due = (await c.runMutation(PLAN, { kv: kv !== undefined })) as {
      workspaceId: string;
      plan: StatusPushPlan;
      now: number;
    } | null;
    if (!due) return { pushed: false };
    const done: StatusPushDone = { page: false, cleared: [], released: [] };
    let late = false;
    const call = async <T>(p: Promise<T>, what: string): Promise<T> => {
      try {
        return await within(p, STATUS_CALL_MS, what);
      } catch (error) {
        if (error instanceof DeadlineError) late = true;
        throw error;
      }
    };
    try {
      const { page, retired } = due.plan;
      if (page && kv) {
        await (page.put !== undefined
          ? call(kv.put(page.key, page.put), "status snapshot put")
          : call(kv.delete(page.key), "status snapshot delete"));
        done.page = true;
      }
      for (const one of retired) {
        if (one.op === "kv_delete") {
          if (!kv) continue;
          await call(kv.delete(`status:${one.id}`), "retired status snapshot delete");
          done.cleared.push(one.id);
        } else {
          // Only a row stamped before it was given up: one stamped later is a claim made since.
          await call(
            c.env.DB.prepare(
              "delete from status_slug where slug = ? and workspace_id = ? and created_at < ?",
            )
              .bind(one.id, due.workspaceId, one.at)
              .run(),
            "status slug release",
          );
          done.released.push(one.id);
        }
      }
    } catch (error) {
      done.error = String(error);
    }
    await c.runMutation(RECORD, { kv: kv !== undefined, plan: due.plan, done, now: due.now, late });
    return { pushed: done.page };
  },
});

/** Moves on every maintenance window whose start or end passed (`maintenance.advance`), then arms the next one. */
export const maintenance = internalMutationGeneric({
  args: {},
  handler: (ctx): { advanced: number } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return { advanced: 0 };
    c.sql.exec("delete from ember_ticks where key = 'maintenance'");
    let advanced = 0;
    for (const row of shard.store.scan("status_maintenance")) {
      const at =
        row.phase === "scheduled" ? row.startsAt : row.phase === "in_progress" ? row.endsAt : null;
      if (at === null || at > c.now) continue;
      const { result } = shard.mutate({
        clientId: "api",
        mutationId: `maintenance:${row.id}:${row.phase}`,
        actor: ACCOUNT_ACTOR,
        name: "maintenance.advance",
        args: { id: row.id },
        now: c.now,
        internal: true,
      });
      if (result.ok) advanced++;
      else if (result.error.code !== "conflict") {
        log("moving a maintenance window on failed", { id: row.id, code: result.error.code });
      }
    }
    const next = nextMaintenanceAt(shard.store.scan("status_maintenance"));
    // One that could not move on is tried again a minute later, not in a loop (the DO's alarm tick).
    if (next !== null) tickAt(c, next <= c.now ? c.now + 60 * 1000 : next, "maintenance");
    shard.check();
    return { advanced };
  },
});
