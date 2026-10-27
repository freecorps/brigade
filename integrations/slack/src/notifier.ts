// The incident's Slack message (RFC 0011 "The incident message"): rendered from the incident as it is now, posted
// once and then updated in place. The API's queue consumer imports this (apps/api src/notify-slack.ts): the API does
// not bind to this Worker (no binding cycle), so the Slack code is shared as a module instead.

import { incident_role, slack_text } from "@freecorps/brigade-i18n/messages";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
  isBuiltinRole,
  type IncidentStatus,
  type Severity,
  type SlackFailure,
  type SlackLocale,
} from "@freecorps/brigade-schema";
import { callSlack, failureReason, type Fetch } from "./web-api.ts";

export { failureReason, type Fetch } from "./web-api.ts";

/** The Acknowledge button's `action_id` (src/index.ts handles its clicks). */
export const ACK_ACTION = "brigade_ack";
/** The link button's: Slack sends a click on a link too, which is answered and ignored. */
export const OPEN_ACTION = "brigade_open";

/** Who did something, as the message names them: a member (by name, maybe none), the monitors, or someone unknown. */
export type SlackPerson =
  | { kind: "member"; name: string | null }
  | { kind: "monitors" }
  | { kind: "teammate" };

/** What the message shows, read from the shard when it is posted or updated. */
export type SlackIncidentView = {
  id: string;
  number: number | null;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  /** Active and nobody acknowledged it: the Acknowledge button shows. */
  awaitingAck: boolean;
  declaredBy: SlackPerson;
  acknowledgedBy: SlackPerson | null;
};

/** A Block Kit message: `text` is the notification's and screen readers' fallback. */
export type SlackMessage = { text: string; blocks: Record<string, unknown>[] };

/**
 * Escapes user text for Slack's mrkdwn (titles, names): `&`, `<` and `>`, so nobody's title can mention
 * `@channel`, link anywhere or break the message's own links.
 */
export function escapeMrkdwn(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function personName(person: SlackPerson, locale: SlackLocale): string {
  const say = (part: string) => slack_text({ ...NO_ARGS, part }, { locale });
  if (person.kind === "monitors") return say("message_monitors");
  if (person.kind === "teammate") return say("message_teammate");
  return person.name === null ? say("message_unnamed") : escapeMrkdwn(person.name);
}

/** Every input `slack_text` declares, empty: each call fills the ones its part uses. */
export const NO_ARGS = {
  incident: "",
  title: "",
  name: "",
  workspace: "",
  list: "",
  detail: "",
  person: "",
};

/** The incident's link on the dashboard, when the instance knows its origin. */
export function incidentUrl(
  dashboard: string | undefined,
  number: number | null,
): string | undefined {
  if (!dashboard || number === null) return undefined;
  try {
    const url = new URL(dashboard);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return new URL(`/incidents/${number}`, url.origin).href;
  } catch {
    return undefined;
  }
}

/**
 * The incident's message in `locale`. `channel`: the incident's own channel (`C…`), linked from the main channel's
 * message (RFC 0011 "A channel per incident").
 */
export function incidentMessage(
  incident: SlackIncidentView,
  locale: SlackLocale,
  dashboard?: string,
  channel?: string | null,
): SlackMessage {
  const say = (part: string, name = "") =>
    slack_text({ ...NO_ARGS, part, name, detail: channel ? `<#${channel}>` : "" }, { locale });
  const number = formatIncidentNumber(incident.number) ?? "INC";
  const code = incident.severity.toUpperCase();
  const severity = severityLabels[incident.severity]({}, { locale });
  const status = incidentStatusLabels[incident.status]({}, { locale });
  const url = incidentUrl(dashboard, incident.number);
  const heading = url ? `<${url}|${number}>` : number;
  const ack = incident.acknowledgedBy
    ? say("message_acknowledged_by", personName(incident.acknowledgedBy, locale))
    : say("message_not_acknowledged");
  const buttons: Record<string, unknown>[] = [];
  if (incident.awaitingAck) {
    buttons.push({
      type: "button",
      action_id: ACK_ACTION,
      style: "primary",
      text: { type: "plain_text", text: say("message_ack_button"), emoji: false },
      value: incident.id,
    });
  }
  if (url) {
    buttons.push({
      type: "button",
      action_id: OPEN_ACTION,
      text: { type: "plain_text", text: say("message_open_button"), emoji: false },
      url,
    });
  }
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${code} · ${heading}*\n${escapeMrkdwn(incident.title)}`,
      },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*${escapeMrkdwn(severity)}* · ${escapeMrkdwn(status)}` },
        {
          type: "mrkdwn",
          text: say("message_declared_by", personName(incident.declaredBy, locale)),
        },
        { type: "mrkdwn", text: ack },
        // A channel id the notifier read from Slack's own answer: no user text, nothing to escape.
        ...(channel ? [{ type: "mrkdwn", text: say("message_channel") }] : []),
      ],
    },
  ];
  if (buttons.length > 0)
    blocks.push({ type: "actions", block_id: "brigade_incident", elements: buttons });
  // The fallback text (notifications, screen readers) is mrkdwn too: an unescaped `<!here>` would ping the channel.
  return {
    text: `${code} · ${number}: ${escapeMrkdwn(incident.title)} (${escapeMrkdwn(status)})`,
    blocks,
  };
}

/** What posting or updating the message did, for the shard's Slack ledger (apps/api src/slack.ts). */
export type SlackPostOutcome =
  | { ok: true; channel: string; ts: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      retryAfterMs?: number;
      /** How the failure reads on the timeline, once retrying stops. */
      reason: SlackFailure;
    };

/**
 * Posts the incident's message in `channel`, or updates the one at `ts`. An update whose message is gone
 * (`message_not_found`, deleted in Slack) posts a new one. Never throws.
 */
export async function deliverIncidentMessage(options: {
  token: string;
  channel: string;
  ts: string | null;
  message: SlackMessage;
  fetch: Fetch;
  /** Per Web API call; Slack's default when omitted. */
  timeoutMs?: number;
}): Promise<SlackPostOutcome> {
  const { token, channel, ts, message, fetch, timeoutMs } = options;
  if (ts !== null) {
    const updated = await callSlack(
      "chat.update",
      { channel, ts, text: message.text, blocks: message.blocks },
      { token, fetch, timeoutMs },
    );
    if (updated.ok) return { ok: true, channel, ts };
    if (updated.error !== "message_not_found") return failed(updated);
  }
  const posted = await callSlack(
    "chat.postMessage",
    { channel, text: message.text, blocks: message.blocks, unfurl_links: false },
    { token, fetch, timeoutMs },
  );
  if (!posted.ok) return failed(posted);
  const postedTs = posted.data.ts;
  if (typeof postedTs !== "string") {
    return { ok: false, error: "invalid_response", retryable: false, reason: "undelivered" };
  }
  return { ok: true, channel, ts: postedTs };
}

function failed(
  call: Extract<Awaited<ReturnType<typeof callSlack>>, { ok: false }>,
): SlackPostOutcome {
  return {
    ok: false,
    error: call.error,
    retryable: call.retryable,
    ...(call.retryAfterMs === undefined ? {} : { retryAfterMs: call.retryAfterMs }),
    reason: failureReason(call.error),
  };
}

/** One timeline entry mirrored into Slack (RFC 0011 "Timeline mirror"), from the event that wrote it. */
export type SlackEntryView =
  | { kind: "status"; by: SlackPerson; to: IncidentStatus }
  | { kind: "severity"; by: SlackPerson; to: Severity }
  | { kind: "ack"; by: SlackPerson }
  /** `role`: a built-in by its id (`name` null) or the workspace's name; `to` null: nobody holds it now. */
  | {
      kind: "role";
      by: SlackPerson;
      role: { id: string; name: string | null };
      to: SlackPerson | null;
    }
  | { kind: "update"; by: SlackPerson; body: string };

/** The entry's line in `locale`: who did it and what, with people's text escaped. */
export function entryMessage(entry: SlackEntryView, locale: SlackLocale): SlackMessage {
  const say = (part: string, more: Partial<typeof NO_ARGS> = {}) =>
    slack_text({ ...NO_ARGS, part, name: personName(entry.by, locale), ...more }, { locale });
  let text: string;
  switch (entry.kind) {
    case "status":
      text = say("mirror_status", {
        detail: escapeMrkdwn(incidentStatusLabels[entry.to]({}, { locale })),
      });
      break;
    case "severity":
      text = say("mirror_severity", {
        detail: `${entry.to.toUpperCase()} · ${escapeMrkdwn(severityLabels[entry.to]({}, { locale }))}`,
      });
      break;
    case "ack":
      text = say("mirror_ack");
      break;
    case "role": {
      const role =
        entry.role.name !== null
          ? escapeMrkdwn(entry.role.name)
          : incident_role(
              { role: isBuiltinRole(entry.role.id) ? entry.role.id : "deleted", form: "sentence" },
              { locale },
            );
      text = entry.to
        ? say("mirror_role", { detail: role, person: personName(entry.to, locale) })
        : say("mirror_role_cleared", { detail: role });
      break;
    }
    case "update":
      text = say("mirror_update", { detail: escapeMrkdwn(entry.body) });
      break;
  }
  // "A teammate …" rather than "a teammate …": a sentence starts with a capital; members' names are left as written.
  if (entry.by.kind !== "member" || entry.by.name === null) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text } }] };
}

/** Slack's longest channel name. */
export const CHANNEL_NAME_MAX = 80;

/**
 * The incident's channel name: `inc-<number>-<slug of the title>`, lowercase letters, digits and hyphens only (what
 * Slack allows, accents dropped), at most 80 characters. `suffix` tells apart a name already taken (`-2`).
 */
export function incidentChannelName(number: number | null, title: string, suffix?: number): string {
  const head = `inc-${number ?? "new"}`;
  const tail = suffix === undefined ? "" : `-${suffix}`;
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const room = CHANNEL_NAME_MAX - head.length - tail.length - 1;
  const cut = slug.slice(0, Math.max(0, room)).replace(/-+$/, "");
  return cut ? `${head}-${cut}${tail}` : `${head}${tail}`;
}

/** Posts `message` in `channel`, as a reply under `threadTs` when given. Never throws. */
export async function postEntry(options: {
  token: string;
  channel: string;
  threadTs: string | null;
  message: SlackMessage;
  fetch: Fetch;
  timeoutMs?: number;
}): Promise<SlackPostOutcome> {
  const { token, channel, threadTs, message, fetch, timeoutMs } = options;
  const posted = await callSlack(
    "chat.postMessage",
    {
      channel,
      text: message.text,
      blocks: message.blocks,
      unfurl_links: false,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
    { token, fetch, timeoutMs },
  );
  if (!posted.ok) return failed(posted);
  const ts = posted.data.ts;
  return typeof ts === "string"
    ? { ok: true, channel, ts }
    : { ok: false, error: "invalid_response", retryable: false, reason: "undelivered" };
}

/**
 * Creates the incident's channel (`conversations.create`), trying `-2` to `-4` when the name is taken. The bot that
 * creates it is in it. Never throws.
 */
export async function createIncidentChannel(options: {
  token: string;
  number: number | null;
  title: string;
  private: boolean;
  fetch: Fetch;
  timeoutMs?: number;
}): Promise<SlackPostOutcome & { name?: string }> {
  const { token, fetch, timeoutMs } = options;
  for (const suffix of [undefined, 2, 3, 4]) {
    const name = incidentChannelName(options.number, options.title, suffix);
    const created = await callSlack(
      "conversations.create",
      { name, is_private: options.private },
      { token, fetch, timeoutMs },
    );
    if (created.ok) {
      const id = Object(created.data.channel).id;
      return typeof id === "string"
        ? { ok: true, channel: id, ts: "", name }
        : { ok: false, error: "invalid_response", retryable: false, reason: "undelivered" };
    }
    if (created.error !== "name_taken") return failed(created);
  }
  return { ok: false, error: "name_taken", retryable: false, reason: "undelivered" };
}

/**
 * Invites Slack users to `channel` (`conversations.invite`, up to 1000 at once). Someone already in it, or one Slack
 * will not invite (a deactivated user, the bot itself), is not a failure. Never throws.
 */
export async function inviteToChannel(options: {
  token: string;
  channel: string;
  users: string[];
  fetch: Fetch;
  timeoutMs?: number;
}): Promise<SlackPostOutcome> {
  const { token, channel, users, fetch, timeoutMs } = options;
  if (users.length === 0) return { ok: true, channel, ts: "" };
  const invited = await callSlack(
    "conversations.invite",
    // `force`: invite the ones Slack can, even when it refuses some.
    { channel, users: users.slice(0, 1000).join(","), force: true },
    { token, fetch, timeoutMs },
  );
  if (invited.ok || HARMLESS_INVITE.has(invited.error)) return { ok: true, channel, ts: "" };
  return failed(invited);
}

/** Answers from `conversations.invite` that leave nothing to do. */
const HARMLESS_INVITE = new Set([
  "already_in_channel",
  "cant_invite_self",
  "user_not_found",
  "user_is_restricted",
  "user_is_ultra_restricted",
  "ura_max_channels",
]);

/** Archives the incident's channel; one archived already counts. Never throws. */
export async function archiveChannel(options: {
  token: string;
  channel: string;
  fetch: Fetch;
  timeoutMs?: number;
}): Promise<SlackPostOutcome> {
  const { token, channel, fetch, timeoutMs } = options;
  const archived = await callSlack(
    "conversations.archive",
    { channel },
    { token, fetch, timeoutMs },
  );
  if (archived.ok || archived.error === "already_archived") return { ok: true, channel, ts: "" };
  return failed(archived);
}

/**
 * The Slack user whose email is `email` (`users.lookupByEmail`), kept per isolate for a few minutes, so the people an
 * incident invites are not a burst of Tier 3 calls. Null for nobody or a failure (inviting is best effort).
 */
export async function slackUserByEmail(
  teamId: string,
  email: string,
  token: string,
  fetch: Fetch,
  now: number,
  timeoutMs?: number,
): Promise<string | null> {
  const key = `${teamId}:${email.toLowerCase()}`;
  const hit = byEmail.get(key);
  if (hit && hit.until > now) return hit.id;
  const found = await callSlack(
    "users.lookupByEmail",
    { email },
    { token, fetch, timeoutMs, form: true },
  );
  if (!found.ok && found.error !== "users_not_found") return null;
  const user = found.ok ? (Object(found.data.user) as Record<string, unknown>) : {};
  const id =
    typeof user.id === "string" &&
    user.team_id === teamId &&
    user.deleted !== true &&
    user.is_bot !== true
      ? user.id
      : null;
  if (byEmail.size >= 2000) byEmail.delete(byEmail.keys().next().value!);
  byEmail.set(key, { id, until: now + 5 * 60 * 1000 });
  return id;
}

const byEmail = new Map<string, { id: string | null; until: number }>();

/** Forgets the Slack users found by email: for tests. */
export function clearSlackUsersByEmail(): void {
  byEmail.clear();
}
