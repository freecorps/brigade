// The calls the API Worker makes into a workspace's shard for Slack and webhooks (RFC 0011, RFC 0005, RFC 0016
// "Parity"), sent to the engine D1's `workspace_engine` names: `WorkspaceDO`, or its Ember shard
// (ember/integrations.ts). Each has the signature of the `WorkspaceDO` method it stands for. A Slack install state's
// nonce and hash are made here on Ember (a mutation runs no crypto). The engine lookup is bounded: one that stalls
// throws, so the Queue retries its message and a route answers `unavailable`.

import type { Actor } from "@freecorps/brigade-schema";
import { within } from "./deadline.ts";
import { workspaceEngine } from "./ember.ts";
import { emberMutation } from "./ember-workspace.ts";
import type { BrigadeEvent } from "./outbox.ts";
import {
  slackStateHash,
  toBase64url,
  type SlackDesk,
  type SlackJobOutcome,
  type SlackPlan,
  type SlackShardAction,
} from "./slack.ts";
import type {
  WebhookEmailPlan,
  WebhookEventRef,
  WebhookOutcome,
  WebhookPlan,
  WebhookRunName,
  WebhookRunResult,
} from "./webhooks.ts";
import type { WorkspaceDO } from "./workspace.ts";

/** How long the engine lookup may take (see the header). */
export const INTEGRATIONS_ENGINE_BUDGET_MS = 5000;

type Awaited2<T> = T extends Promise<infer U> ? U : T;

/** `WorkspaceDO`'s Slack and webhook calls, each answering a promise. */
export type WorkspaceIntegrations = {
  slackBeginInstall(workspaceId: string, userId: string): Promise<string | null>;
  slackTakeState(workspaceId: string, nonce: string): Promise<string | null>;
  slackConnect(
    workspaceId: string,
    actor: Actor,
    args: Record<string, unknown>,
    key: string,
  ): Promise<Awaited2<ReturnType<WorkspaceDO["slackConnect"]>>>;
  slackTeam(): Promise<string | null>;
  slackContext(teamId: string): Promise<ReturnType<SlackDesk["context"]>>;
  slackAct(
    workspaceId: string,
    teamId: string,
    actor: Actor,
    action: SlackShardAction,
    key: string,
  ): Promise<Awaited2<ReturnType<WorkspaceDO["slackAct"]>>>;
  planSlack(event: BrigadeEvent): Promise<SlackPlan>;
  recordSlack(
    event: BrigadeEvent,
    job: string,
    outcome: SlackJobOutcome,
  ): Promise<{ retryAt: number | null }>;
  slackCatalog(): Promise<ReturnType<SlackDesk["catalog"]>>;
  slackRevoked(
    teamId: string,
    reason: "uninstalled" | "tokens_revoked",
    botUserIds: string[] | null,
  ): Promise<boolean>;
  webhookRun(
    workspaceId: string,
    actor: Actor,
    name: WebhookRunName,
    args: Record<string, unknown>,
    key: string,
  ): Promise<WebhookRunResult>;
  planWebhooks(event: BrigadeEvent): Promise<WebhookPlan>;
  recordWebhook(
    event: WebhookEventRef,
    webhookId: string,
    outcome: WebhookOutcome,
  ): Promise<{ retryAt: number | null }>;
  planWebhookEmail(event: BrigadeEvent): Promise<WebhookEmailPlan>;
  recordWebhookEmail(event: BrigadeEvent, done: boolean): Promise<void>;
};

type IntegrationsEnv = Pick<Env, "WORKSPACE"> & { DB?: Env["DB"]; SHARD?: Env["SHARD"] };

/** `workspaceId`'s Slack and webhook calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceIntegrations(
  env: IntegrationsEnv,
  workspaceId: string,
): Promise<WorkspaceIntegrations> {
  const { DB, SHARD } = env;
  if (
    DB &&
    SHARD &&
    (await within(
      workspaceEngine(DB, workspaceId),
      INTEGRATIONS_ENGINE_BUDGET_MS,
      "engine lookup",
    )) === "ember"
  ) {
    return emberIntegrations({ SHARD }, workspaceId);
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    slackBeginInstall: async (...a) => stub.slackBeginInstall(...a),
    slackTakeState: async (...a) => stub.slackTakeState(...a),
    slackConnect: async (...a) => stub.slackConnect(...a),
    slackTeam: async () => stub.slackTeam(),
    slackContext: async (teamId) => stub.slackContext(teamId) as never,
    slackAct: async (...a) => stub.slackAct(...a),
    planSlack: async (event) => stub.planSlack(event) as never,
    recordSlack: async (...a) => stub.recordSlack(...a),
    slackCatalog: async () => stub.slackCatalog() as never,
    slackRevoked: async (...a) => stub.slackRevoked(...a),
    webhookRun: async (...a) => stub.webhookRun(...a) as never,
    planWebhooks: async (event) => stub.planWebhooks(event) as never,
    recordWebhook: async (...a) => stub.recordWebhook(...a),
    planWebhookEmail: async (event) => stub.planWebhookEmail(event) as never,
    recordWebhookEmail: async (...a) => stub.recordWebhookEmail(...a),
  };
}

/** The calls on `workspaceId`'s Ember shard. */
export function emberIntegrations(
  env: { SHARD: Env["SHARD"] },
  workspaceId: string,
): WorkspaceIntegrations {
  const call = <T>(fn: string, args: Record<string, unknown>) =>
    emberMutation<T>(env, workspaceId, `integrations:${fn}`, args);
  return {
    async slackBeginInstall(id, userId) {
      const nonce = toBase64url(crypto.getRandomValues(new Uint8Array(32)));
      const kept = await call<boolean>("slackKeepState", {
        workspaceId: id,
        userId,
        hash: await slackStateHash(nonce),
      });
      return kept ? nonce : null;
    },
    async slackTakeState(id, nonce) {
      return call("slackTakeState", { workspaceId: id, hash: await slackStateHash(nonce) });
    },
    slackConnect: (id, actor, args, key) =>
      call("slackConnect", { workspaceId: id, actor, args, key }),
    slackTeam: () => call("slackTeam", {}),
    slackContext: (teamId) => call("slackContext", { teamId }),
    slackAct: (id, teamId, actor, action, key) =>
      call("slackAct", { workspaceId: id, teamId, actor, action, key }),
    planSlack: (event) => call("slackPlan", { event }),
    recordSlack: (event, job, outcome) => call("slackRecord", { event, job, outcome }),
    slackCatalog: () => call("slackCatalog", {}),
    slackRevoked: (teamId, reason, botUserIds) =>
      call("slackRevoked", { teamId, reason, botUserIds }),
    webhookRun: (id, actor, name, args, key) =>
      call("webhookRun", { workspaceId: id, actor, name, args, key }),
    planWebhooks: (event) => call("webhookPlan", { event }),
    recordWebhook: (event, webhookId, outcome) =>
      call("webhookRecord", { event, webhookId, outcome }),
    planWebhookEmail: (event) => call("webhookPlanEmail", { event }),
    async recordWebhookEmail(event, done) {
      await call("webhookRecordEmail", { event, done });
    },
  };
}
