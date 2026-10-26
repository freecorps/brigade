// The incident's Slack message (RFC 0011 "The incident message"): rendered from the incident as it is now, posted
// once and then updated in place. The API's queue consumer imports this (apps/api src/notify-slack.ts): the API does
// not bind to this Worker (no binding cycle), so the Slack code is shared as a module instead.

import { slack_text } from "@freecorps/brigade-i18n/messages";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  formatIncidentNumber,
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

const NO_ARGS = { incident: "", title: "", name: "", workspace: "", list: "" };

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

/** The incident's message in `locale`. */
export function incidentMessage(
  incident: SlackIncidentView,
  locale: SlackLocale,
  dashboard?: string,
): SlackMessage {
  const say = (part: string, name = "") => slack_text({ ...NO_ARGS, part, name }, { locale });
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
