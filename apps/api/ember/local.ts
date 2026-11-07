// The page a workspace's Ember shard sends itself when the Queue has not brought it in time (RFC 0006 "Who is paged",
// RFC 0016 "Parity"): `WorkspaceDO.pageLocally`, as an Ember action, since it sends through the relay. Every page a
// mutation writes is watched (`page_pending`, ember/ticks.ts `expectPages`) and armed for `PAGE_QUEUE_GRACE_MS`
// later; a Queue that stalls, or a drain that cannot send, must not hold a page or the escalation run its plan
// starts. The Queue's copy, if it comes, plans only the devices not reached yet. A device the relay could not reach
// is tried again a lease later, up to `PAGE_LOCAL_TRIES` times while the Queue still has not come.
//
// Unlike the consumer's page, this one skips the member check against D1 before it (`freshMembers`): it runs inside
// the shard, which cannot call itself, and the check fails open anyway. Its own module, so the Node tests of the
// shard's functions need not load the notifier.

import { internalActionGeneric, makeFunctionReference } from "@freecorps/ember-server";
import type { DeviceOutcome, PagePlan, SkippedMember } from "../src/paging.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  notifyPush,
  RETRY_AFTER_MAX_SECONDS,
  type NotifyEnv,
  type PageShard,
  type PushAgain,
} from "../src/notify.ts";
import { withReceipts } from "../src/ember-receipts.ts";

const OVERDUE = makeFunctionReference<"mutation">("paging:overdue");
const PLAN = makeFunctionReference<"mutation">("paging:plan");
const RECORD = makeFunctionReference<"mutation">("paging:record");
const DONE = makeFunctionReference<"mutation">("paging:localDone");

/** At most this many leases of 20 pages per run; the rest come back with the next one. */
const MAX_BATCHES = 5;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

export type ActionCtx = {
  env: Record<string, unknown>;
  runMutation(ref: unknown, args: unknown): Promise<unknown>;
};

/** Sends every page the Queue has not brought in time, through the relay this Worker uses. */
export const send = internalActionGeneric({
  args: {},
  handler: (ctx): Promise<{ sent: number }> => {
    const c = ctx as unknown as ActionCtx;
    return sendOverdue(c, c.env as unknown as LocalEnv, (request) => fetch(request));
  },
});

type LocalEnv = NotifyEnv & { BETTER_AUTH_SECRET?: string };

/**
 * Every page the Queue has not brought in time, 20 at a time (`paging:overdue`), each sent through `send` as the
 * consumer would (`notifyPush`, with this shard's plan and record as the planner). Never throws.
 */
export async function sendOverdue(
  ctx: ActionCtx,
  env: LocalEnv,
  send: (request: Request) => Promise<Response>,
): Promise<{ sent: number }> {
  const shard: PageShard = {
    planPage: async (event) =>
      withReceipts(
        env,
        event.workspaceId,
        event.id,
        (await ctx.runMutation(PLAN, { event, local: true })) as PagePlan,
        Date.now(),
      ),
    recordPage: async (
      event: BrigadeEvent,
      outcomes: DeviceOutcome[],
      final: boolean,
      skipped: SkippedMember[],
    ) => {
      await ctx.runMutation(RECORD, { event, outcomes, final, skipped });
    },
  };
  let sent = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    let due: { event: BrigadeEvent; tries: number }[];
    try {
      due = (await ctx.runMutation(OVERDUE, {})) as { event: BrigadeEvent; tries: number }[];
    } catch (error) {
      log("reading the pages the queue has not brought failed", { error: String(error) });
      break;
    }
    if (due.length === 0) break;
    const done = await Promise.all(
      due.map(({ event, tries }) => pageOne(ctx, env, shard, send, event, tries)),
    );
    sent += done.filter(Boolean).length;
  }
  return { sent };
}

/** One page on its `tries`th try, then how it ended (`paging:localDone`). Never throws; true when it went. */
async function pageOne(
  ctx: ActionCtx,
  env: NotifyEnv,
  shard: PageShard,
  send: (request: Request) => Promise<Response>,
  event: BrigadeEvent,
  tries: number,
): Promise<boolean> {
  log("page not brought by the queue in time; sending it from the shard", {
    event: event.id,
    type: event.type,
    incident: event.subject,
    tries,
  });
  let again: false | PushAgain;
  try {
    again = await notifyPush(event, tries, env, send, shard);
  } catch (error) {
    log("sending a page from the shard failed", { event: event.id, error: String(error) });
    again = {};
  }
  try {
    await ctx.runMutation(DONE, {
      eventId: event.id,
      tries,
      sent: !again,
      ...(again && again.retryAfter !== undefined
        ? { until: Date.now() + Math.min(RETRY_AFTER_MAX_SECONDS, again.retryAfter) * 1000 }
        : {}),
    });
  } catch (error) {
    // Still leased otherwise: it comes back a lease later.
    log("ending a page sent from the shard failed", { event: event.id, error: String(error) });
  }
  return !again;
}
