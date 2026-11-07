// Emails on a workspace's Ember shard (RFC 0005 "Notifiers", RFC 0013 "Reminders", RFC 0016 "Parity"): the queue
// consumer's calls into the shard for the email a failed page asks for, a reminder of follow-ups due and the owners'
// email about a member taken out of schedules, run by `WorkspaceDO`'s own `Mailer` unchanged over an Ember mutation
// (ember/shard-facade.ts), its ledger in Ember's private SQL tables.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import type { EmailAbout } from "@freecorps/brigade-schema";
import {
  Mailer,
  type EmailOutcome,
  type EmailPlan,
  type ReminderPlan,
  type RotationPlan,
} from "../src/mailer.ts";
import type { BrigadeEvent } from "../src/outbox.ts";
import { emberWorkspace } from "./shard-facade.ts";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * `fn` with a `Mailer` over this mutation, or `missing` for a shard that holds another workspace (or none). A storage
 * failure the mailer caught fails the whole mutation (`EmberShard.check`).
 */
function withMailer<T>(
  ctx: MutationCtx,
  event: BrigadeEvent,
  missing: T,
  fn: (mailer: Mailer) => T,
): T {
  const { shard, storage } = emberWorkspace(ctx);
  if (shard.workspace() !== event.workspaceId) return missing;
  const out = fn(new Mailer({ storage, shard: shard as never, log, committed: () => {} }));
  shard.check();
  return out;
}

const event = v.any();
const NOT_FOUND = { send: false, reason: "not_found" } as const;

/** `WorkspaceDO.planEmail`. */
export const plan = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): EmailPlan =>
    withMailer(ctx as MutationCtx, e, NOT_FOUND as EmailPlan, (m) => m.plan(e, ctx.now)),
});

/** `WorkspaceDO.recordEmail`. */
export const record = internalMutationGeneric({
  args: { event, key: v.string(), about: v.any(), outcomes: v.any(), final: v.boolean() },
  handler: (
    ctx,
    input: {
      event: BrigadeEvent;
      key: string;
      about: EmailAbout;
      outcomes: EmailOutcome[];
      final: boolean;
    },
  ): null =>
    withMailer(ctx as MutationCtx, input.event, null, (m) => {
      m.record(input.event, input.key, input.about, input.outcomes, input.final, ctx.now);
      return null;
    }),
});

/** `WorkspaceDO.planReminder`. */
export const planReminder = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): ReminderPlan =>
    withMailer(ctx as MutationCtx, e, NOT_FOUND as ReminderPlan, (m) => m.planReminder(e, ctx.now)),
});

/** `WorkspaceDO.recordReminder`. */
export const recordReminder = internalMutationGeneric({
  args: { event, outcome: v.any(), final: v.boolean() },
  handler: (ctx, input: { event: BrigadeEvent; outcome: EmailOutcome; final: boolean }): null =>
    withMailer(ctx as MutationCtx, input.event, null, (m) => {
      m.recordReminder(input.event, input.outcome, input.final, ctx.now);
      return null;
    }),
});

/** `WorkspaceDO.planRotationEmail`. */
export const planRotation = internalMutationGeneric({
  args: { event },
  handler: (ctx, { event: e }: { event: BrigadeEvent }): RotationPlan =>
    withMailer(ctx as MutationCtx, e, NOT_FOUND as RotationPlan, (m) => m.planRotation(e, ctx.now)),
});

/** `WorkspaceDO.recordRotationEmail`. */
export const recordRotation = internalMutationGeneric({
  args: { event, outcomes: v.any(), final: v.boolean() },
  handler: (ctx, input: { event: BrigadeEvent; outcomes: EmailOutcome[]; final: boolean }): null =>
    withMailer(ctx as MutationCtx, input.event, null, (m) => {
      m.recordRotation(input.event, input.outcomes, input.final, ctx.now);
      return null;
    }),
});
