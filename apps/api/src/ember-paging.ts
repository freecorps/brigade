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
import { workspaceEngine, workspaceShard, type WorkspaceEngine } from "./ember.ts";
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

/** How long a workspace's engine, read from D1, is taken as known in this isolate. */
export const ENGINE_CACHE_MS = 60 * 1000;
/** How long a page waits on D1 for its workspace's engine before it goes to the one last known, or `WorkspaceDO`. */
export const ENGINE_LOOKUP_BUDGET_MS = 1000;

const engines = new Map<string, { engine: WorkspaceEngine; at: number }>();

/**
 * The engine holding `workspaceId`, for a page: D1's `workspace_engine`, kept `ENGINE_CACHE_MS` per isolate. A page
 * never fails on D1 (it did not read D1 before Ember): when D1 fails or takes longer than `ENGINE_LOOKUP_BUDGET_MS`,
 * the engine last known goes, or else `WorkspaceDO`, which hands a workspace on Ember to its shard once switched
 * (a switch needs that forwarding first: `setWorkspaceEngine`).
 */
export async function pageEngine(
  db: D1Database,
  workspaceId: string,
  now = Date.now(),
): Promise<WorkspaceEngine> {
  const known = engines.get(workspaceId);
  if (known && now - known.at < ENGINE_CACHE_MS) return known.engine;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), ENGINE_LOOKUP_BUDGET_MS);
  });
  const read = workspaceEngine(db, workspaceId).catch((error: unknown) => ({ error }));
  const out = await Promise.race([read, late]).finally(() => clearTimeout(timer));
  if (out === "ember" || out === "brigade") {
    engines.set(workspaceId, { engine: out, at: now });
    return out;
  }
  log("reading a workspace's engine for a page failed; using the one last known", {
    workspace: workspaceId,
    known: known?.engine ?? null,
    error: out === "late" ? "late" : String(out.error),
  });
  return known?.engine ?? "brigade";
}

/**
 * `workspaceId`'s pager, on `WorkspaceDO` or on Ember as D1 says (`WorkspaceDO` without D1 or an Ember binding). The
 * engine is read inside each call, so the caller's deadline on the call (`within`) covers the lookup too.
 */
export function workspacePager(env: PagingEnv, workspaceId: string): WorkspacePager {
  const { DB, SHARD } = env;
  const pick = async (): Promise<WorkspacePager> =>
    DB && SHARD && (await pageEngine(DB, workspaceId)) === "ember"
      ? emberPager({ DB, SHARD }, workspaceId)
      : env.WORKSPACE.getByName(workspaceId);
  return {
    planPage: async (event) => (await pick()).planPage(event),
    recordPage: async (event, outcomes, final, skipped) =>
      (await pick()).recordPage(event, outcomes, final, skipped),
    recordDeadLetter: async (event) => (await pick()).recordDeadLetter(event),
  };
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
      const checked = await freshMembers(env, workspaceId, Date.now());
      // A check that failed, was late or left the copy behind D1 has the shard repair it later (`repair`).
      return (await call(env, workspaceId, "mutation", "paging:plan", {
        event,
        ...(checked ? {} : { repair: true }),
      })) as PagePlan;
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

/** How many times a member check overtaken by a member change reads D1 again before the page goes without it. */
const STALE_ATTEMPTS = 3;

/** Per isolate, as the DO keeps it in memory: no member check before this time after one failed or was late. */
const checkAfter = new Map<string, number>();

/**
 * `Membership.fresh` for an Ember shard: when the member list last agreed with D1 more than `MEMBER_STALE_MS` ago,
 * it is reconciled with D1 first (`repairOnce`), for at most `MEMBER_CHECK_BUDGET_MS` (the reconcile then finishes on
 * its own). A D1 or shard that fails or is late, or a reconcile a member change overtook (`stale`), leaves the page to
 * the shard's copy, logged, with the check skipped for `MEMBER_CHECK_BACKOFF_MS`, and answers false: the page then has
 * the shard schedule a durable repair (`members:repair`), as the DO's repair alarm. Never throws.
 */
export async function freshMembers(
  env: EmberPagingEnv,
  workspaceId: string,
  now: number,
  budgetMs = MEMBER_CHECK_BUDGET_MS,
): Promise<boolean> {
  // Skipped after a failure: the repair that failure scheduled is on its way.
  if (now < (checkAfter.get(workspaceId) ?? 0)) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">((resolve) => {
    timer = setTimeout(() => resolve("late"), budgetMs);
  });
  const check = (async (): Promise<"ok" | "stale"> => {
    const at = (await call(env, workspaceId, "query", "members:reconciledAt", {})) as number | null;
    if (at !== null && now - at < MEMBER_STALE_MS) return "ok";
    const ctx = {
      env: env as unknown as Record<string, unknown>,
      runQuery: (ref: unknown, args: unknown) =>
        call(env, workspaceId, "query", getFunctionName(ref as never), args),
      runMutation: (ref: unknown, args: unknown) =>
        call(env, workspaceId, "mutation", getFunctionName(ref as never), args),
    };
    // A retry delay answers a snapshot a member change overtook: read D1 again at once, within the budget (the race
    // below), up to `STALE_ATTEMPTS` times; still overtaken, it is not checked.
    for (let attempt = 0; attempt < STALE_ATTEMPTS; attempt++) {
      if ((await repairOnce(ctx, { workspaceId })) === null) return "ok";
    }
    return "stale";
  })().catch((error: unknown) => error);
  const outcome = await Promise.race([check, late]).finally(() => clearTimeout(timer));
  if (outcome === "ok") return true;
  checkAfter.set(workspaceId, Date.now() + MEMBER_CHECK_BACKOFF_MS);
  log(
    outcome === "late"
      ? "member check before a page was late; paging from the shard's copy"
      : outcome === "stale"
        ? "member check before a page was overtaken by a member change; paging from the shard's copy"
        : "member check before a page failed; paging from the shard's copy",
    {
      workspace: workspaceId,
      ...(outcome === "late" || outcome === "stale" ? {} : { error: String(outcome) }),
    },
  );
  return false;
}
