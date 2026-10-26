// The Slack notifier in the `brigade-events` consumer (RFC 0011 "The incident message"): for an incident's events,
// the shard plans the channel message (src/slack.ts), this opens the bot token, renders and sends it with the Slack
// code shared from integrations/slack, and reports back. It runs next to push for the same event and never decides
// whether a page is retried: a page that went out is settled in the page ledger, so a retry for Slack's sake pages
// nobody again.

import {
  deliverIncidentMessage,
  incidentMessage,
  type Fetch,
  type SlackPostOutcome,
} from "@freecorps/brigade-slack/notifier";
import type { BrigadeEvent } from "./outbox.ts";
import { asksForSlack } from "./slack.ts";
import { isTokenKey, openToken, tokenBinding } from "./slack-token.ts";

export type SlackNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  /** Without it, Slack is off: nothing is planned or sent. */
  SLACK_TOKEN_KEY?: string;
  /** The dashboard's origin, for the message's link; optional. */
  DASHBOARD_URL?: string;
};

/**
 * Posts or updates `event`'s incident message. Returns the seconds until the event should come back for Slack, or
 * undefined when Slack is done with it (sent, recorded as failed, or nothing to do). A shard that cannot be reached
 * throws, like the other notifiers.
 */
export async function notifySlack(
  event: BrigadeEvent,
  env: SlackNotifyEnv,
  send: Fetch,
  now: () => number = Date.now,
): Promise<number | undefined> {
  if (!asksForSlack(event) || !isTokenKey(env.SLACK_TOKEN_KEY)) return undefined;
  const shard = env.WORKSPACE.getByName(event.workspaceId);
  const plan = await shard.planSlack(event);
  if (!plan.send) return plan.reason === "held" ? secondsUntil(plan.until, now()) : undefined;
  let outcome: SlackPostOutcome;
  try {
    const token = await openToken(
      env.SLACK_TOKEN_KEY,
      plan.token,
      tokenBinding(event.workspaceId, plan.teamId),
    );
    outcome = await deliverIncidentMessage({
      token,
      channel: plan.channel,
      ts: plan.ts,
      message: incidentMessage(plan.incident, plan.locale, env.DASHBOARD_URL),
      fetch: send,
    });
  } catch (error) {
    // The key was rotated without re-sealing, or the row is not this workspace's: retrying cannot open it.
    log("slack token could not be opened", { event: event.id, error: String(error) });
    outcome = { ok: false, error: "token_unreadable", retryable: false, reason: "not_authorized" };
  }
  const { retryAt } = await shard.recordSlack(event, outcome);
  return retryAt === null ? undefined : secondsUntil(retryAt, now());
}

/** Whole seconds until `at`, at least 1: the Queue's `delaySeconds`. */
function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "slack", ...fields }));
}
