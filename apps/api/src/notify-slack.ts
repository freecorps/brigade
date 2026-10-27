// The Slack notifier in the `brigade-events` consumer (RFC 0011): for an incident's events, the shard plans what to
// do in Slack one job at a time (src/slack.ts): post or update the incident's message, create its channel and invite
// its people, mirror a timeline entry, archive the channel, give a token back. This opens the bot token, does the job
// with the Slack code shared from integrations/slack, and reports back, until nothing is left or a job must wait. It
// runs next to push for the same event and never decides whether a page is retried: a page that went out is settled
// in the page ledger, so a retry for Slack's sake pages nobody again.

import {
  archiveChannel,
  createIncidentChannel,
  deliverIncidentMessage,
  entryMessage,
  incidentMessage,
  inviteToChannel,
  postEntry,
  slackUserByEmail,
  type Fetch,
  type SlackPostOutcome,
} from "@freecorps/brigade-slack/notifier";
import { callSlack } from "@freecorps/brigade-slack/web-api";
import type { BrigadeEvent } from "./outbox.ts";
import { asksForSlack, type SlackJobOutcome, type SlackPlan } from "./slack.ts";
import { isTokenKey, openToken, tokenBinding } from "./slack-token.ts";

/**
 * How long one Slack Web API call gets in the consumer, well under the budget (src/notify.ts `SLACK_BUDGET_MS`) the
 * consumer gives Slack as a whole, so a slow Slack ends as a retryable failure the ledger records.
 */
export const SLACK_CALL_TIMEOUT_MS = 2500;
/** Jobs one delivery of an event runs at most; the rest come with the retry. Declaring with a channel takes four. */
export const SLACK_MAX_JOBS = 8;

export type SlackNotifyEnv = {
  WORKSPACE: Env["WORKSPACE"];
  /** Members' verified emails, for inviting them to an incident's channel; without it nobody is invited. */
  DB?: Env["DB"];
  /** Without it, Slack is off: nothing is planned or sent. */
  SLACK_TOKEN_KEY?: string;
  /** The dashboard's origin, for the message's link; optional. */
  DASHBOARD_URL?: string;
};

/**
 * Does `event`'s Slack jobs. Returns the seconds until the event should come back for Slack, or undefined when Slack
 * is done with it (sent, recorded as failed, or nothing to do). A shard that cannot be reached throws, like the
 * other notifiers.
 */
export async function notifySlack(
  event: BrigadeEvent,
  env: SlackNotifyEnv,
  send: Fetch,
  now: () => number = Date.now,
): Promise<number | undefined> {
  if (!asksForSlack(event) || !isTokenKey(env.SLACK_TOKEN_KEY)) return undefined;
  const shard = env.WORKSPACE.getByName(event.workspaceId);
  for (let step = 0; step < SLACK_MAX_JOBS; step++) {
    const plan = await shard.planSlack(event);
    if (!plan.send) return plan.reason === "held" ? secondsUntil(plan.until, now()) : undefined;
    let outcome: SlackJobOutcome;
    try {
      const token = await openToken(
        env.SLACK_TOKEN_KEY,
        plan.token,
        tokenBinding(event.workspaceId, plan.teamId),
      );
      outcome = await perform(plan, token, event, env, send, now);
    } catch (error) {
      // The key was rotated without re-sealing, or the row is not this workspace's: retrying cannot open it.
      log("slack token could not be opened", { event: event.id, error: String(error) });
      outcome = {
        ok: false,
        error: "token_unreadable",
        retryable: false,
        reason: "not_authorized",
      };
    }
    const { retryAt } = await shard.recordSlack(event, plan.job, outcome);
    if (retryAt !== null) return secondsUntil(retryAt, now());
  }
  // More jobs than one delivery runs: the next one picks up where this left.
  return 1;
}

/** One job, done in Slack. Never throws for Slack's reasons. */
async function perform(
  plan: Extract<SlackPlan, { send: true }>,
  token: string,
  event: BrigadeEvent,
  env: SlackNotifyEnv,
  send: Fetch,
  now: () => number,
): Promise<SlackJobOutcome> {
  const timeoutMs = SLACK_CALL_TIMEOUT_MS;
  const { work } = plan;
  switch (work.kind) {
    case "message":
      return deliverIncidentMessage({
        token,
        channel: work.channel,
        ts: work.ts,
        message: incidentMessage(work.incident, plan.locale, env.DASHBOARD_URL, work.link),
        fetch: send,
        timeoutMs,
      });
    case "channel":
      return createIncidentChannel({
        token,
        number: work.number,
        title: work.title,
        private: work.private,
        fetch: send,
        timeoutMs,
      });
    case "lookup":
      return slackUsers(plan.teamId, work.userIds, token, env, send, now);
    case "invite":
      return inviteToChannel({
        token,
        channel: work.channel,
        users: work.users,
        fetch: send,
        timeoutMs,
      });
    case "entry":
      return postEntry({
        token,
        channel: work.channel,
        threadTs: work.threadTs,
        message: entryMessage(work.entry, plan.locale),
        fetch: send,
        timeoutMs,
      });
    case "archive":
      return archiveChannel({ token, channel: work.channel, fetch: send, timeoutMs });
    case "revoke": {
      // Slack handed a reinstall this very token: it is in use again, so it stays.
      if (work.keep !== null && isTokenKey(env.SLACK_TOKEN_KEY)) {
        const current = await openToken(
          env.SLACK_TOKEN_KEY,
          work.keep,
          tokenBinding(event.workspaceId, plan.teamId),
        ).catch(() => null);
        if (current !== null && current === token) return { ok: true, channel: "", ts: "" };
      }
      const revoked = await callSlack(
        "auth.revoke",
        {},
        { token, form: true, fetch: send, timeoutMs },
      );
      // A token Slack no longer takes is as good as revoked.
      if (revoked.ok || DEAD_TOKEN.has(revoked.error)) return { ok: true, channel: "", ts: "" };
      return {
        ok: false,
        error: revoked.error,
        retryable: revoked.retryable,
        ...(revoked.retryAfterMs === undefined ? {} : { retryAfterMs: revoked.retryAfterMs }),
        reason: "not_authorized",
      };
    }
  }
}

const DEAD_TOKEN = new Set(["invalid_auth", "token_revoked", "account_inactive", "not_authed"]);

/**
 * The Slack users members are, by their verified Brigade email (the same rule as who a Slack user is, RFC 0011): an
 * unverified address, or one Slack does not vouch for, is nobody. A batch (`SLACK_LOOKUP_BATCH`) at once, each call
 * bounded, so the job fits the claim; Slack failing for any of them (a 429 with its `Retry-After`) fails the job, which
 * the ledger retries.
 */
async function slackUsers(
  teamId: string,
  userIds: string[],
  token: string,
  env: SlackNotifyEnv,
  send: Fetch,
  now: () => number,
): Promise<SlackJobOutcome> {
  const people: Record<string, string | null> = Object.fromEntries(userIds.map((id) => [id, null]));
  if (!env.DB || userIds.length === 0) return { ok: true, channel: "", ts: "", people };
  const { results } = await env.DB.prepare(
    `select id, email from "user" where "emailVerified" = 1 and id in (${userIds.map(() => "?").join(", ")})`,
  )
    .bind(...userIds)
    .all<{ id: string; email: string }>();
  const found = await Promise.all(
    results.map(async (row) => ({
      userId: row.id,
      lookup: await slackUserByEmail(teamId, row.email, token, send, now(), SLACK_CALL_TIMEOUT_MS),
    })),
  );
  let failure: Extract<SlackPostOutcome, { ok: false }> | undefined;
  for (const { userId, lookup } of found) {
    if (lookup.ok) {
      people[userId] = lookup.id;
      continue;
    }
    // The failure that speaks for the job: one worth retrying, then the one that waits longest (a 429's
    // `Retry-After` is never cut short).
    if (
      !failure ||
      (lookup.retryable && !failure.retryable) ||
      (lookup.retryable === failure.retryable &&
        (lookup.retryAfterMs ?? 0) > (failure.retryAfterMs ?? 0))
    ) {
      failure = lookup;
    }
  }
  return failure ?? { ok: true, channel: "", ts: "", people };
}

/** Whole seconds until `at`, at least 1: the Queue's `delaySeconds`. */
function secondsUntil(at: number, now: number): number {
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, notifier: "slack", ...fields }));
}
