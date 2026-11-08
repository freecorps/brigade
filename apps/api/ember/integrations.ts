// Slack and webhooks on a workspace's Ember shard (RFC 0011, RFC 0005 "Webhooks", RFC 0016 "Parity"): the shard's
// side of `WorkspaceDO`'s Slack and webhook calls, with the same `SlackDesk` and `WebhookDesk` the DO runs, over the
// shard facade and their ledgers in Ember's private SQL tables. Everything here is synchronous, as on the DO; the
// Worker computes the one hash an install state needs (src/ember-integrations.ts). The DO's alarm work is two ticks
// (ember/ticks.ts): `webhooks` (deliveries due again go back to the Queue, `WebhookDesk.redrive`) and `slack`
// (incident channels due to be archived, `SlackDesk.archiveDue`), each armed when its desk asks to be woken.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import type { Actor } from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "../src/outbox.ts";
import {
  SlackDesk,
  type SlackJobOutcome,
  type SlackPlan,
  type SlackShardAction,
} from "../src/slack.ts";
import {
  WebhookDesk,
  type WebhookEmailPlan,
  type WebhookEventRef,
  type WebhookOutcome,
  type WebhookPlan,
  type WebhookRunName,
  type WebhookRunResult,
} from "../src/webhooks.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

const random = (ctx: MutationCtx) => (n: number) => {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
  return bytes;
};

function slackOf(ctx: MutationCtx): { shard: EmberShard; slack: SlackDesk } {
  const { shard, storage } = emberWorkspace(ctx);
  const slack = new SlackDesk({
    storage,
    shard: shard as never,
    randomBytes: random(ctx),
    log,
    committed: () => {},
    wake: (at) => tickAt(ctx, at, "slack"),
  });
  return { shard, slack };
}

function webhooksOf(ctx: MutationCtx): { shard: EmberShard; webhooks: WebhookDesk } {
  const { shard, storage } = emberWorkspace(ctx);
  const webhooks = new WebhookDesk({
    storage,
    shard: shard as never,
    log,
    committed: () => {},
    wake: (at) => tickAt(ctx, at, "webhooks"),
  });
  return { shard, webhooks };
}

/** `fn`, then any storage failure the desk caught fails the mutation (`EmberShard.check`). */
function checked<T>(shard: EmberShard, out: T): T {
  shard.check();
  return out;
}

const ws = { workspaceId: v.string() };

/** A Slack install state kept under `hash` for `userId` (`SlackDesk.keepState`); false past the pending cap. */
export const slackKeepState = internalMutationGeneric({
  args: { ...ws, userId: v.string(), hash: v.string() },
  handler: (ctx, input: { workspaceId: string; userId: string; hash: string }): boolean => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== input.workspaceId) return false;
    return checked(shard, slack.keepState(input.userId, input.hash, c.now));
  },
});

/** The member who started the install whose state hashes to `hash`, once (`SlackDesk.takeStateHash`). */
export const slackTakeState = internalMutationGeneric({
  args: { ...ws, hash: v.string() },
  handler: (ctx, input: { workspaceId: string; hash: string }): string | null => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== input.workspaceId) return null;
    return checked(shard, slack.takeStateHash(input.hash, c.now));
  },
});

/** `slack.connect` as the member who installed (`WorkspaceDO.slackConnect`). */
export const slackConnect = internalMutationGeneric({
  args: { ...ws, actor: v.any(), args: v.any(), key: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; actor: Actor; args: Record<string, unknown>; key: string },
  ): { ok: true } | { ok: false; code: string } => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    if (shard.gone(input.actor.id, c.now)) return { ok: false, code: "not_a_member" };
    const result = slack.connect(input.actor, input.args, input.key, c.now);
    return checked(shard, result.ok ? { ok: true } : { ok: false, code: result.error.code });
  },
});

/** The Slack team this workspace is connected to, if any (`WorkspaceDO.slackTeam`). */
export const slackTeam = internalMutationGeneric({
  args: {},
  handler: (ctx): string | null => slackOf(ctx as MutationCtx).slack.team(),
});

/** The sealed token and names for `teamId` (`WorkspaceDO.slackContext`). */
export const slackContext = internalMutationGeneric({
  args: { teamId: v.string() },
  handler: (ctx, input: { teamId: string }) =>
    slackOf(ctx as MutationCtx).slack.context(input.teamId),
});

/** A Slack user's action as the member their email maps to (`WorkspaceDO.slackAct`). */
export const slackAct = internalMutationGeneric({
  args: { ...ws, teamId: v.string(), actor: v.any(), action: v.any(), key: v.string() },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      teamId: string;
      actor: Actor;
      action: SlackShardAction;
      key: string;
    },
  ) => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_connected" };
    if (shard.gone(input.actor.id, c.now)) return { ok: false, code: "unmapped" };
    return checked(shard, slack.act(input.teamId, input.actor, input.action, input.key, c.now));
  },
});

/** What the Slack notifier should do for `event` (`WorkspaceDO.planSlack`). */
export const slackPlan = internalMutationGeneric({
  args: { event: v.any() },
  handler: (ctx, { event }: { event: BrigadeEvent }): SlackPlan => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return checked(shard, slack.plan(event, c.now));
  },
});

/** What doing one job of `event` in Slack did (`WorkspaceDO.recordSlack`). */
export const slackRecord = internalMutationGeneric({
  args: { event: v.any(), job: v.string(), outcome: v.any() },
  handler: (
    ctx,
    input: { event: BrigadeEvent; job: string; outcome: SlackJobOutcome },
  ): { retryAt: number | null } => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    if (shard.workspace() !== input.event.workspaceId) return { retryAt: null };
    return checked(shard, slack.record(input.event, input.job, input.outcome, c.now));
  },
});

/** The declare form's incident types and services (`WorkspaceDO.slackCatalog`). */
export const slackCatalog = internalMutationGeneric({
  args: {},
  handler: (ctx) => slackOf(ctx as MutationCtx).slack.catalog(),
});

/** Slack removed the app or revoked its bot token (`WorkspaceDO.slackRevoked`). */
export const slackRevoked = internalMutationGeneric({
  args: {
    teamId: v.string(),
    reason: v.union(v.literal("uninstalled"), v.literal("tokens_revoked")),
    botUserIds: v.union(v.array(v.string()), v.null()),
  },
  handler: (
    ctx,
    input: {
      teamId: string;
      reason: "uninstalled" | "tokens_revoked";
      botUserIds: string[] | null;
    },
  ): boolean => {
    const c = ctx as MutationCtx;
    const { shard, slack } = slackOf(c);
    return checked(shard, slack.revoke(input.teamId, input.reason, input.botUserIds, c.now));
  },
});

/** Incident channels due to be archived (`SlackDesk.archiveDue`), then the next one armed. */
export const slackArchive = internalMutationGeneric({
  args: {},
  handler: (ctx): { archived: number } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard, slack } = slackOf(c);
    if (shard.workspace() === undefined) return { archived: 0 };
    // The keys as parameters: `ctx.sql` refuses a schema table's name (`slack`, `webhooks`) quoted in a statement.
    c.sql.exec("delete from ember_ticks where key = ?", "slack");
    const archived = slack.archiveDue(c.now);
    const next = slack.nextArchiveAt();
    if (next !== null) tickAt(c, next, "slack");
    return checked(shard, { archived });
  },
});

/** `webhook.create`, `webhook.rotateSecret` or `webhook.setHeaders` as `actor` (`WorkspaceDO.webhookRun`). */
export const webhookRun = internalMutationGeneric({
  args: { ...ws, actor: v.any(), name: v.string(), args: v.any(), key: v.string() },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      name: string;
      args: Record<string, unknown>;
      key: string;
    },
  ): WebhookRunResult => {
    const c = ctx as MutationCtx;
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    if (!["webhook.create", "webhook.rotateSecret", "webhook.setHeaders"].includes(input.name)) {
      return { ok: false, code: "invalid_args" };
    }
    const acting = shard.tokenActor(input.actor, c.now);
    if (!acting) return { ok: false, code: "unauthenticated" } as WebhookRunResult;
    if (shard.gone(acting.by ?? acting.id, c.now)) return { ok: false, code: "not_a_member" };
    const result = webhooks.run(acting, input.name as WebhookRunName, input.args, input.key, c.now);
    shard.check();
    if (result.ok) {
      if (input.name !== "webhook.setHeaders") return { ok: true };
      const id = typeof input.args.id === "string" ? input.args.id : "";
      return { ok: true, headers: shard.store.get("webhooks", id)?.headers ?? [] };
    }
    const { code, issues } = result.error;
    return (issues ? { ok: false, code, issues } : { ok: false, code }) as WebhookRunResult;
  },
});

/** What the webhook notifier should deliver for `event` (`WorkspaceDO.planWebhooks`). */
export const webhookPlan = internalMutationGeneric({
  args: { event: v.any() },
  handler: (ctx, { event }: { event: BrigadeEvent }): WebhookPlan => {
    const c = ctx as MutationCtx;
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() !== event.workspaceId) return { event: null, body: null, sends: [] };
    return checked(shard, webhooks.plan(event, c.now));
  },
});

/** What one webhook delivery attempt did (`WorkspaceDO.recordWebhook`). */
export const webhookRecord = internalMutationGeneric({
  args: { event: v.any(), webhookId: v.string(), outcome: v.any() },
  handler: (
    ctx,
    input: { event: WebhookEventRef; webhookId: string; outcome: WebhookOutcome },
  ): { retryAt: number | null } => {
    const c = ctx as MutationCtx;
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() !== input.event.workspaceId) return { retryAt: null };
    return checked(shard, webhooks.record(input.event, input.webhookId, input.outcome, c.now));
  },
});

/** The owners' email for an endpoint turned off (`WorkspaceDO.planWebhookEmail`). */
export const webhookPlanEmail = internalMutationGeneric({
  args: { event: v.any() },
  handler: (ctx, { event }: { event: BrigadeEvent }): WebhookEmailPlan => {
    const c = ctx as MutationCtx;
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return checked(shard, webhooks.planEmail(event, c.now));
  },
});

/** What that email did (`WorkspaceDO.recordWebhookEmail`). */
export const webhookRecordEmail = internalMutationGeneric({
  args: { event: v.any(), done: v.boolean() },
  handler: (ctx, input: { event: BrigadeEvent; done: boolean }): null => {
    const c = ctx as MutationCtx;
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() !== input.event.workspaceId) return null;
    webhooks.recordEmail(input.event, input.done, c.now);
    return checked(shard, null);
  },
});

/** Deliveries due again go back to the Queue with the drain (`WebhookDesk.redrive`), then the next one armed. */
export const webhookRedrive = internalMutationGeneric({
  args: {},
  handler: (ctx): { redriven: number } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard, webhooks } = webhooksOf(c);
    if (shard.workspace() === undefined) return { redriven: 0 };
    c.sql.exec("delete from ember_ticks where key = ?", "webhooks");
    const redriven = webhooks.redrive(c.now);
    const next = webhooks.nextAt();
    if (next !== null) tickAt(c, next, "webhooks");
    return checked(shard, { redriven });
  },
});
