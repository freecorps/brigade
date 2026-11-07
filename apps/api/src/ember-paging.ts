// The queue consumer's calls into a workspace's shard for a page (RFC 0005 "Notifiers", RFC 0016 "Parity"), sent to
// whichever engine holds it: its `WorkspaceDO`, or its Ember shard (ember/paging.ts) once D1's `workspace_engine`
// says `ember`. The Ember side does what `WorkspaceDO.planPage`, `recordPage` and `recordDeadLetter` do, with the
// member check before a page (`Membership.fresh`) run from here, since it reads D1.
//
// Not yet on Ember (RFC 0016 "Parity"): delivery receipts (a page there goes out without them, as the DO's does when
// minting fails, and only its delivered stage stays unknown) and the page the shard sends itself when the Queue is
// late (`pageLocally`).

import { getFunctionName } from "@freecorps/ember-server";
import { repairOnce } from "../ember/members.ts";
import { workspaceEngine, workspaceShard } from "./ember.ts";
import { MEMBER_CHECK_BACKOFF_MS, MEMBER_CHECK_BUDGET_MS, MEMBER_STALE_MS } from "./members.ts";
import type { PageShard } from "./notify.ts";
import type { BrigadeEvent } from "./outbox.ts";
import type { DeadLetterResult, PagePlan } from "./paging.ts";

type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message?: string } };

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

/** A page's shard: `PageShard` and the dead-letter consumer's call. */
export type WorkspacePager = PageShard & {
  recordDeadLetter(event: BrigadeEvent): Promise<DeadLetterResult> | DeadLetterResult;
};

export type PagingEnv = {
  WORKSPACE: Env["WORKSPACE"];
  DB?: Env["DB"];
  SHARD?: Env["SHARD"];
};

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** `workspaceId`'s pager, on `WorkspaceDO` or on Ember as D1 says (`WorkspaceDO` without D1 or an Ember binding). */
export async function workspacePager(env: PagingEnv, workspaceId: string): Promise<WorkspacePager> {
  if (env.DB && env.SHARD && (await workspaceEngine(env.DB, workspaceId)) === "ember") {
    return emberPager({ DB: env.DB, SHARD: env.SHARD }, workspaceId);
  }
  return env.WORKSPACE.getByName(workspaceId);
}

type EmberPagingEnv = Pick<Env, "DB" | "SHARD">;

/** Calls `fn` on the workspace's Ember shard; throws when Ember refused it. */
async function call(
  env: EmberPagingEnv,
  workspaceId: string,
  kind: "query" | "mutation",
  fn: string,
  args: unknown,
): Promise<unknown> {
  const shard = workspaceShard(workspaceId);
  const stub = env.SHARD.getByName(shard) as unknown as EmberShardRpc;
  const out = await stub[kind](shard, fn, args, null, true);
  if (!out.ok)
    throw new Error(`${fn} failed on Ember: ${out.error.code} ${out.error.message ?? ""}`);
  return out.value;
}

/** The page calls on the workspace's Ember shard. */
export function emberPager(env: EmberPagingEnv, workspaceId: string): WorkspacePager {
  return {
    async planPage(event) {
      await freshMembers(env, workspaceId, Date.now());
      return (await call(env, workspaceId, "mutation", "paging:plan", { event })) as PagePlan;
    },
    async recordPage(event, outcomes, final, skipped) {
      await call(env, workspaceId, "mutation", "paging:record", {
        event,
        outcomes,
        final,
        skipped,
      });
    },
    async recordDeadLetter(event) {
      return (await call(env, workspaceId, "mutation", "paging:deadLettered", {
        event,
      })) as DeadLetterResult;
    },
  };
}

/** Per isolate, as the DO keeps it in memory: no member check before this time after one failed or was late. */
const checkAfter = new Map<string, number>();

/**
 * `Membership.fresh` for an Ember shard: when the member list last agreed with D1 more than `MEMBER_STALE_MS` ago,
 * it is reconciled with D1 first (`repairOnce`), for at most `MEMBER_CHECK_BUDGET_MS` (the reconcile then finishes on
 * its own). A D1 or shard that fails or is late leaves the page to the shard's copy, logged, with the check skipped
 * for `MEMBER_CHECK_BACKOFF_MS`. Never throws.
 */
export async function freshMembers(
  env: EmberPagingEnv,
  workspaceId: string,
  now: number,
  budgetMs = MEMBER_CHECK_BUDGET_MS,
): Promise<void> {
  if (now < (checkAfter.get(workspaceId) ?? 0)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), budgetMs);
  });
  const check = (async (): Promise<"ok"> => {
    const at = (await call(env, workspaceId, "query", "members:reconciledAt", {})) as number | null;
    if (at !== null && now - at < MEMBER_STALE_MS) return "ok";
    await repairOnce(
      {
        env: env as unknown as Record<string, unknown>,
        runQuery: (ref, args) =>
          call(env, workspaceId, "query", getFunctionName(ref as never), args),
        runMutation: (ref, args) =>
          call(env, workspaceId, "mutation", getFunctionName(ref as never), args),
      },
      { workspaceId },
    );
    return "ok";
  })().catch((error: unknown) => error);
  const outcome = await Promise.race([check, late]).finally(() => clearTimeout(timer));
  if (outcome === "ok") return;
  checkAfter.set(workspaceId, Date.now() + MEMBER_CHECK_BACKOFF_MS);
  log(
    outcome === "late"
      ? "member check before a page was late; paging from the shard's copy"
      : "member check before a page failed; paging from the shard's copy",
    {
      workspace: workspaceId,
      ...(outcome === "late" ? {} : { error: String(outcome) }),
    },
  );
}
