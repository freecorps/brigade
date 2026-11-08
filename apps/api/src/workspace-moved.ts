// What a `WorkspaceDO` whose workspace moved to Ember does with a call that still reaches it (RFC 0016 "Data
// migration", step 3): a call that can arrive after the switch (one routed by an engine cached or last known while
// D1 was out, `pageEngine`) goes to the workspace's Ember shard, through the same facades the Worker uses; any other
// is refused, so nothing writes to the old copy. Loaded lazily by src/workspace.ts: these facades import it back.

import type { Actor } from "@freecorps/brigade-schema";
import type { AckResult } from "./workspace.ts";
import { emberAlerts } from "./ember-alerts.ts";
import { emberIntegrations } from "./ember-integrations.ts";
import { emberMonitors } from "./ember-monitors.ts";
import { emberPager } from "./ember-paging.ts";
import { emberMutation } from "./ember-workspace.ts";

/** The calls a moved `WorkspaceDO` forwards, by name, and the facade that runs each on Ember. */
export const FORWARDED = {
  // The Queue consumer's page path (`workspacePager`).
  planPage: "pager",
  recordPage: "pager",
  recordDeadLetter: "pager",
  planEmail: "pager",
  recordEmail: "pager",
  planReminder: "pager",
  recordReminder: "pager",
  planRotationEmail: "pager",
  recordRotationEmail: "pager",
  // `POST /ack` (src/index.ts).
  acknowledge: "ack",
  // Alert routes (`workspaceAlerts`) and probes (`workspaceMonitors`).
  alert: "alerts",
  alertTooLarge: "alerts",
  report: "monitors",
  heartbeat: "monitors",
  // Slack and webhooks (`workspaceIntegrations`, the Queue's notifiers).
  slackBeginInstall: "integrations",
  slackTakeState: "integrations",
  slackConnect: "integrations",
  slackTeam: "integrations",
  slackContext: "integrations",
  slackAct: "integrations",
  planSlack: "integrations",
  recordSlack: "integrations",
  slackCatalog: "integrations",
  slackRevoked: "integrations",
  webhookRun: "integrations",
  planWebhooks: "integrations",
  recordWebhook: "integrations",
  planWebhookEmail: "integrations",
  recordWebhookEmail: "integrations",
} as const;

export type Forwarded = keyof typeof FORWARDED;

type Calls = Record<string, (...args: never[]) => Promise<unknown>>;

/** Runs `name` with `args` on `workspaceId`'s Ember shard, as the Worker would have. */
export async function forward(
  env: Env,
  workspaceId: string,
  name: Forwarded,
  args: unknown[],
): Promise<unknown> {
  const kind = FORWARDED[name];
  if (kind === "ack") {
    const [ws, actor, incidentId, mutationId] = args as [string, Actor, string, string];
    // As the DO answers for another workspace's call.
    if (ws !== workspaceId) return { ok: false, code: "not_found" } satisfies AckResult;
    return emberMutation<AckResult>(env, workspaceId, "paging:acknowledge", {
      workspaceId: ws,
      actor,
      incidentId,
      mutationId,
    });
  }
  const facade = {
    pager: () => emberPager(env, workspaceId),
    alerts: () => emberAlerts(env, workspaceId),
    monitors: () => emberMonitors(env, workspaceId),
    integrations: () => emberIntegrations(env, workspaceId),
  }[kind]() as unknown as Calls;
  return facade[name]!(...(args as never[]));
}
