// The Slack connection (RFC 0011): which Slack team a workspace is connected to, the channel incidents are posted
// in, and the bot token, encrypted by the API before it reaches the shard. The token is server-only (`slack_tokens`):
// it never syncs and no event carries it. The synced `slack` row is what the dashboard's Slack card shows.

import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { SlackRow } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Validator } from "./validate.ts";

/** The one row of `slack` and of `slack_tokens`: a workspace connects to at most one Slack team. */
export const SLACK_ROW_ID = "slack";

/** Languages channel messages can be written in (RFC 0008); the same as `user.locale`'s. */
export const SLACK_LOCALES = ["en", "pt-BR"] as const;
export type SlackLocale = (typeof SLACK_LOCALES)[number];

/** Slack ids: an uppercase letter that says what it is, then uppercase letters and digits. */
const slackId = (prefixes: string): Validator<string> => {
  const pattern = new RegExp(`^[${prefixes}][A-Z0-9]{2,30}$`);
  return (input, path = "") =>
    typeof input === "string" && pattern.test(input)
      ? { ok: true, value: input }
      : { ok: false, issues: [{ path, message: `Expected a Slack id starting with ${prefixes}` }] };
};

/** A Slack team (workspace) id: `T…`. */
export const slackTeamId = slackId("T");
/** A public (`C…`) or private (`G…`) channel id. */
export const slackChannelId = slackId("CG");
/** The bot's own user id: `U…` or `W…`. */
const slackUserId = slackId("UW");

/** Whether `value` is a channel id the card accepts (`C…` or `G…`), for the form's own check. */
export function isSlackChannelId(value: string): boolean {
  return slackChannelId(value).ok;
}

/** The longest team name kept; a longer or unprintable one is stored as the team id (the API fits it). */
export const SLACK_TEAM_NAME_MAX = 100;
export const slackTeamName = v.string({ min: 1, max: SLACK_TEAM_NAME_MAX });

/** An encrypted bot token as the API writes it: `v1.<iv>.<ciphertext>`, base64url (RFC 0011 "Where the token lives"). */
const sealedToken: Validator<string> = (input, path = "") =>
  typeof input === "string" &&
  input.length <= 2048 &&
  /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a sealed token" }] };

/**
 * Why the Slack notifier gave up on an incident's message (RFC 0011 "The incident message"):
 * - `no_channel`: the channel is gone, archived, or private without the bot in it;
 * - `not_authorized`: Slack refused the token (revoked, the app removed, a scope missing);
 * - `rate_limited`: Slack kept answering 429 until the retries ran out;
 * - `undelivered`: Slack kept failing, or refused the message for another reason.
 */
export const SLACK_FAILURES = [
  "no_channel",
  "not_authorized",
  "rate_limited",
  "undelivered",
] as const;
export type SlackFailure = (typeof SLACK_FAILURES)[number];

export type SlackConnected = DomainEvent<
  "slack.connected",
  { teamId: string; teamName: string; replaced: string | null }
>;
export type SlackConfigured = DomainEvent<
  "slack.configured",
  { channelId: string | null; locale: SlackLocale }
>;
export type SlackDisconnected = DomainEvent<"slack.disconnected", { teamId: string }>;

/**
 * Server only: run by the API once an owner or admin finished Slack's OAuth (RFC 0011 "Installing"), as that member,
 * so `workspace:manage` is checked here too. Replaces a previous connection (another team, or the same team with a
 * new token); the channel and language are kept when the team is the same.
 */
export const connectSlack = defineMutation({
  name: "slack.connect",
  args: v.object({
    teamId: slackTeamId,
    teamName: slackTeamName,
    botUserId: slackUserId,
    token: sealedToken,
    scopes: v.array(v.string({ min: 1, max: 64 }), { max: 50 }),
    locale: v.picklist(SLACK_LOCALES),
  }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    const current = store.get("slack", SLACK_ROW_ID);
    const same = current?.teamId === args.teamId;
    const row: SlackRow = {
      id: SLACK_ROW_ID,
      teamId: args.teamId,
      teamName: args.teamName,
      channelId: same ? current.channelId : null,
      locale: same ? current.locale : args.locale,
      connectedAt: ctx.now,
      connectedBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    if (current) store.update("slack", SLACK_ROW_ID, row);
    else store.insert("slack", row);
    const token = {
      id: SLACK_ROW_ID,
      teamId: args.teamId,
      botUserId: args.botUserId,
      token: args.token,
      scopes: args.scopes,
    };
    if (store.get("slack_tokens", SLACK_ROW_ID)) store.update("slack_tokens", SLACK_ROW_ID, token);
    else store.insert("slack_tokens", token);
    const event: SlackConnected = {
      type: "slack.connected",
      subject: SLACK_ROW_ID,
      data: {
        teamId: args.teamId,
        teamName: args.teamName,
        replaced: current && !same ? current.teamId : null,
      },
    };
    return ok(event);
  },
});

/** The channel incidents are posted in (null: none) and the language of channel messages; owners and admins. */
export const configureSlack = defineMutation({
  name: "slack.configure",
  args: v.object({ channelId: v.nullable(slackChannelId), locale: v.picklist(SLACK_LOCALES) }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    const current = store.get("slack", SLACK_ROW_ID);
    if (!current) return fail("not_found", "Slack is not connected");
    if (current.channelId === args.channelId && current.locale === args.locale) {
      return fail("conflict", "Slack settings are unchanged");
    }
    store.update("slack", SLACK_ROW_ID, {
      channelId: args.channelId,
      locale: args.locale,
      updatedAt: ctx.now,
    });
    const event: SlackConfigured = { type: "slack.configured", subject: SLACK_ROW_ID, data: args };
    return ok(event);
  },
});

/**
 * Forgets the connection and the token (RFC 0011 "Installing", "Disconnecting"); owners and admins. The token is not
 * revoked in Slack: this shard no longer has it.
 */
export const disconnectSlack = defineMutation({
  name: "slack.disconnect",
  args: v.object({}),
  permission: "workspace:manage",
  apply(store) {
    const current = store.get("slack", SLACK_ROW_ID);
    if (!current) return fail("not_found", "Slack is not connected");
    store.delete("slack", SLACK_ROW_ID);
    if (store.get("slack_tokens", SLACK_ROW_ID)) store.delete("slack_tokens", SLACK_ROW_ID);
    const event: SlackDisconnected = {
      type: "slack.disconnected",
      subject: SLACK_ROW_ID,
      data: { teamId: current.teamId },
    };
    return ok(event);
  },
});

export type SlackFailed = DomainEvent<
  "notification.failed",
  { incidentId: string; eventId: string; channel: "slack"; userId: null; reason: SlackFailure }
>;

/**
 * Server only, as the notifier: the incident's Slack message could not be posted or updated (RFC 0011), with a
 * `slack_failed` timeline entry and `notification.failed` (`channel: "slack"`), which no notifier acts on.
 */
export const failSlack = defineMutation({
  name: "notification.failSlack",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    reason: v.picklist(SLACK_FAILURES),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(store, incident, { kind: "slack_failed", reason: args.reason }, ctx);
    const event: SlackFailed = {
      type: "notification.failed",
      subject: incident.id,
      data: { ...args, channel: "slack", userId: null },
    };
    return ok(event);
  },
});

/** The workspace's Slack connection, without the token: none, or one row. */
export const slackConnection = defineQuery({
  name: "slack.connection",
  args: v.object({}),
  permission: "workspace:read",
  table: "slack",
  filter: () => true,
  sort: () => 0,
});
