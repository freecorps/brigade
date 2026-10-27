// The Slack connection (RFC 0011): which Slack team a workspace is connected to, the channel incidents are posted
// in, and the bot token, encrypted by the API before it reaches the shard. The token is server-only (`slack_tokens`):
// it never syncs and no event carries it. The synced `slack` row is what the dashboard's Slack card shows.

import { isActive } from "./lifecycle.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { SlackRow } from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Validator } from "./validate.ts";

/** The one row of `slack` and of `slack_tokens`: a workspace connects to at most one Slack team. */
export const SLACK_ROW_ID = "slack";

/** Languages channel messages can be written in (RFC 0008); the same as `user.locale`'s. */
export const SLACK_LOCALES = ["en", "pt-BR"] as const;
export type SlackLocale = (typeof SLACK_LOCALES)[number];

/**
 * Whether declaring an incident creates a Slack channel for it (RFC 0011 "A channel per incident"): never, for every
 * incident, or only for SEV1 and SEV2 (`major`).
 */
export const SLACK_INCIDENT_CHANNELS = ["off", "all", "major"] as const;
export type SlackIncidentChannels = (typeof SLACK_INCIDENT_CHANNELS)[number];
/** The longest wait before a resolved incident's channel is archived: 30 days. */
export const SLACK_ARCHIVE_MAX_HOURS = 720;
/** Why Slack took the app's access away (Events API): the app was removed, or its tokens revoked. */
export const SLACK_REVOKED_REASONS = ["uninstalled", "tokens_revoked"] as const;
export type SlackRevokedReason = (typeof SLACK_REVOKED_REASONS)[number];
/** The longest channel name Slack allows, which is also what the card keeps of a picked one. */
export const SLACK_CHANNEL_NAME_MAX = 80;

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
  {
    channelId: string | null;
    channelName: string | null;
    locale: SlackLocale;
    incidentChannels: SlackIncidentChannels;
    privateChannels: boolean;
    archiveAfterHours: number | null;
  }
>;
export type SlackDisconnected = DomainEvent<"slack.disconnected", { teamId: string }>;
/** Slack removed the app or revoked its token (Events API): the token is forgotten and nothing more is sent. */
export type SlackRevoked = DomainEvent<
  "slack.revoked",
  { teamId: string; reason: SlackRevokedReason }
>;
/** A token Brigade let go of was given back to Slack (`auth.revoke`), or turned out to be still in use. */
export type SlackTokenForgotten = DomainEvent<"slack.token_forgotten", { teamId: string }>;
/** A resolved incident's channel is due to be archived (from the shard's alarm); the Slack notifier archives it. */
export type SlackArchiveDue = DomainEvent<"slack.archive_due", { incidentId: string }>;

/**
 * Keeps a token Brigade lets go of, sealed, until the notifier revokes it in Slack (RFC 0011 "Disconnecting"): the
 * newest per team wins.
 */
function keepForRevocation(
  store: MutationStore,
  token: { teamId: string; token: string },
  now: number,
): void {
  const row = { id: token.teamId, teamId: token.teamId, token: token.token, at: now };
  if (store.get("slack_revocations", token.teamId)) {
    store.update("slack_revocations", token.teamId, row);
  } else store.insert("slack_revocations", row);
}

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
    // The same team again (a new token): its channel and language stay.
    const same = current?.teamId === args.teamId ? current : undefined;
    const row: SlackRow = {
      id: SLACK_ROW_ID,
      teamId: args.teamId,
      teamName: args.teamName,
      channelId: same ? same.channelId : null,
      channelName: same ? (same.channelName ?? null) : null,
      locale: same ? same.locale : args.locale,
      incidentChannels: same?.incidentChannels ?? "off",
      privateChannels: same?.privateChannels ?? false,
      archiveAfterHours: same ? (same.archiveAfterHours ?? null) : null,
      revokedAt: null,
      revokedReason: null,
      connectedAt: ctx.now,
      connectedBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    if (current) store.update("slack", SLACK_ROW_ID, row);
    else store.insert("slack", row);
    // The token replaced, another team's or this team's own: given back to Slack by the notifier, like a disconnect's.
    // A reinstall Slack answered with the very same token keeps it: the notifier opens both and compares (sealed
    // twice, the same token never reads the same here).
    const previous = store.get("slack_tokens", SLACK_ROW_ID);
    if (previous) keepForRevocation(store, previous, ctx.now);
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

/**
 * The channel incidents are posted in (null: none), the language of channel messages, and the incident channels:
 * whether declaring creates one, private or public, and how long after resolving it is archived (null: kept). Owners
 * and admins. Settings left out (a client from before them) keep what they were.
 */
export const configureSlack = defineMutation({
  name: "slack.configure",
  args: v.object({
    channelId: v.nullable(slackChannelId),
    locale: v.picklist(SLACK_LOCALES),
    // Left out (a client from before them): kept as they are. `null` is a value: no name, or keep the channels.
    channelName: v.omittable(v.nullable(v.string({ min: 1, max: SLACK_CHANNEL_NAME_MAX }))),
    incidentChannels: v.omittable(v.picklist(SLACK_INCIDENT_CHANNELS)),
    privateChannels: v.omittable(v.boolean()),
    archiveAfterHours: v.omittable(v.nullable(v.integer({ min: 0, max: SLACK_ARCHIVE_MAX_HOURS }))),
  }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    const current = store.get("slack", SLACK_ROW_ID);
    if (!current) return fail("not_found", "Slack is not connected");
    const next = {
      channelId: args.channelId,
      // A name belongs to its channel: another id without one has no name yet.
      channelName:
        args.channelName !== undefined
          ? args.channelName
          : args.channelId === current.channelId
            ? (current.channelName ?? null)
            : null,
      locale: args.locale,
      incidentChannels: args.incidentChannels ?? current.incidentChannels ?? "off",
      privateChannels: args.privateChannels ?? current.privateChannels ?? false,
      archiveAfterHours:
        args.archiveAfterHours !== undefined
          ? args.archiveAfterHours
          : (current.archiveAfterHours ?? null),
    };
    if (
      current.channelId === next.channelId &&
      (current.channelName ?? null) === next.channelName &&
      current.locale === next.locale &&
      (current.incidentChannels ?? "off") === next.incidentChannels &&
      (current.privateChannels ?? false) === next.privateChannels &&
      (current.archiveAfterHours ?? null) === next.archiveAfterHours
    ) {
      return fail("conflict", "Slack settings are unchanged");
    }
    store.update("slack", SLACK_ROW_ID, { ...next, updatedAt: ctx.now });
    const event: SlackConfigured = { type: "slack.configured", subject: SLACK_ROW_ID, data: next };
    return ok(event);
  },
});

/**
 * Forgets the connection (RFC 0011 "Installing", "Disconnecting"); owners and admins. The token moves to
 * `slack_revocations`, where the Slack notifier finds it on `slack.disconnected` and revokes it in Slack.
 */
export const disconnectSlack = defineMutation({
  name: "slack.disconnect",
  args: v.object({}),
  permission: "workspace:manage",
  apply(store, _args, ctx) {
    const current = store.get("slack", SLACK_ROW_ID);
    if (!current) return fail("not_found", "Slack is not connected");
    store.delete("slack", SLACK_ROW_ID);
    const token = store.get("slack_tokens", SLACK_ROW_ID);
    if (token) {
      keepForRevocation(store, token, ctx.now);
      store.delete("slack_tokens", SLACK_ROW_ID);
    }
    const event: SlackDisconnected = {
      type: "slack.disconnected",
      subject: SLACK_ROW_ID,
      data: { teamId: current.teamId },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier, from Slack's Events API (`app_uninstalled`, `tokens_revoked` for the bot): Slack took
 * the app's access away, so the token is forgotten (it no longer works; nothing to revoke) and nothing more is sent.
 * The card says so until an owner or admin connects again. `not_found` for a team the workspace is not connected to.
 */
export const markSlackRevoked = defineMutation({
  name: "slack.markRevoked",
  args: v.object({ teamId: slackTeamId, reason: v.picklist(SLACK_REVOKED_REASONS) }),
  permission: "workspace:manage",
  apply(store, args, ctx) {
    const current = store.get("slack", SLACK_ROW_ID);
    if (!current || current.teamId !== args.teamId) {
      return fail("not_found", "Not connected to that Slack team");
    }
    if (current.revokedAt != null) return fail("conflict", "Already revoked");
    store.update("slack", SLACK_ROW_ID, {
      revokedAt: ctx.now,
      revokedReason: args.reason,
      updatedAt: ctx.now,
    });
    if (store.get("slack_tokens", SLACK_ROW_ID)) store.delete("slack_tokens", SLACK_ROW_ID);
    // A token let go of earlier for this team is no good any more either.
    if (store.get("slack_revocations", args.teamId)) store.delete("slack_revocations", args.teamId);
    const event: SlackRevoked = { type: "slack.revoked", subject: SLACK_ROW_ID, data: args };
    return ok(event);
  },
});

/**
 * Server only, as the notifier: the token kept for `teamId` was revoked in Slack (or is the one the workspace uses
 * again, so it stays), and is forgotten. `at` is the kept token's, so a newer one kept meanwhile stays.
 */
export const forgetSlackToken = defineMutation({
  name: "slack.forgetToken",
  args: v.object({ teamId: slackTeamId, at: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }) }),
  permission: "workspace:manage",
  apply(store, args) {
    const row = store.get("slack_revocations", args.teamId);
    if (!row || row.at !== args.at) return fail("not_found", "No such token kept");
    store.delete("slack_revocations", args.teamId);
    const event: SlackTokenForgotten = {
      type: "slack.token_forgotten",
      subject: SLACK_ROW_ID,
      data: { teamId: args.teamId },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier, from the shard's alarm: a closed incident's channel is due to be archived. Only an
 * incident still closed: one reopened meanwhile keeps its channel (`conflict`).
 */
export const slackArchiveDue = defineMutation({
  name: "slack.archiveDue",
  args: v.object({ incidentId: v.id("inc") }),
  permission: "incident:update",
  apply(store, args) {
    const incident = store.get("incidents", args.incidentId);
    if (!incident) return fail("not_found", "Incident not found");
    if (isActive(incident.status)) return fail("conflict", "Incident is active");
    const event: SlackArchiveDue = {
      type: "slack.archive_due",
      subject: incident.id,
      data: { incidentId: incident.id },
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
