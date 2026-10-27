// The Slack app's requests (RFC 0011), behind the Worker's entry (src/index.ts):
// - `POST /slack/commands`: `/inc`; `POST /slack/interactions`: the Acknowledge button, the message shortcut and the
//   declare form; `POST /slack/events`: the Events API. All are verified first, answered at once (an empty 200), and
//   done in `waitUntil`, answering through the request's `response_url` (or, for an event, through the API).
// - `GET /slack/install?state=…`: on to Slack's OAuth page; `GET /slack/oauth/callback`: back from it.
// Every read and write of Brigade's data, and every Web API call that needs the bot token, goes through the API's
// `SlackBridge` (src/bridge.ts): this Worker never holds a token.

import { slack_text } from "@freecorps/brigade-i18n/messages";
import { isId, type Severity } from "@freecorps/brigade-schema";
import type { SlackAction } from "./bridge.ts";
import { parseCommand, plainText, type ParsedCommand } from "./command.ts";
import { readDeclareSubmission } from "./modal.ts";
import { ACK_ACTION, NO_ARGS } from "./notifier.ts";
import { replyText, type SlackVerb } from "./replies.ts";
import { completeOAuth, startOAuth } from "./oauth.ts";
import { sha256Hex, verifySlackRequest } from "./verify.ts";
import { log, type Deps } from "./deps.ts";

export { replyText } from "./replies.ts";

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/slack/commands":
      return post(request, () => command(request, deps));
    case "/slack/interactions":
      return post(request, () => interaction(request, deps));
    case "/slack/events":
      return post(request, () => events(request, deps));
    case "/slack/install":
      return get(request, () => startOAuth(request, deps));
    case "/slack/oauth/callback":
      return get(request, () => completeOAuth(request, deps));
    default:
      return Response.json({ error: "not_found" }, { status: 404 });
  }
}

const post = (request: Request, run: () => Promise<Response>) =>
  request.method === "POST"
    ? run()
    : Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "POST" } });
const get = (request: Request, run: () => Promise<Response>) =>
  request.method === "GET"
    ? run()
    : Response.json({ error: "method_not_allowed" }, { status: 405, headers: { Allow: "GET" } });

/** Slack's ids: a team (`T…`), a user (`U…`, `W…`). */
const TEAM_ID = /^T[A-Z0-9]{2,30}$/;
const USER_ID = /^[UW][A-Z0-9]{2,30}$/;
/** A public (`C…`) or private (`G…`) channel; a DM (`D…`) is no incident's. */
const CHANNEL_ID = /^[CG][A-Z0-9]{2,30}$/;
/** The message shortcut's `callback_id` (manifest.yaml): the message as an update on its incident's timeline. */
export const POST_UPDATE_SHORTCUT = "brigade_post_update";

/** The empty 200 Slack waits for within 3 seconds; the answer comes later through `response_url`. */
const acknowledged = () => new Response(null, { status: 200 });

/** A verified body, or the response refusing it. */
async function verified(request: Request, deps: Deps): Promise<string | Response> {
  if (!deps.signingSecret) {
    log("slack request refused: no signing secret", {});
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const result = await verifySlackRequest(request, deps.signingSecret, deps.now());
  if (result.ok) return result.body;
  log("slack request refused", { reason: result.reason });
  return Response.json(
    { error: result.status === 413 ? "too_large" : "unauthorized" },
    {
      status: result.status,
    },
  );
}

/** `POST /slack/commands`: `/inc …`. */
async function command(request: Request, deps: Deps): Promise<Response> {
  const body = await verified(request, deps);
  if (body instanceof Response) return body;
  const form = new URLSearchParams(body);
  // Slack's periodic certificate check: acknowledged, nothing else.
  if (form.get("ssl_check") === "1") return acknowledged();
  const teamId = form.get("team_id") ?? "";
  const userId = form.get("user_id") ?? "";
  const responseUrl = form.get("response_url") ?? "";
  const triggerId = form.get("trigger_id") ?? "";
  const channelId = form.get("channel_id") ?? "";
  if (!TEAM_ID.test(teamId) || !USER_ID.test(userId) || !isResponseUrl(responseUrl) || !triggerId) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseCommand(form.get("text") ?? "");
  deps.waitUntil(
    runCommand(
      deps,
      {
        teamId,
        userId,
        responseUrl,
        triggerId,
        channelId: CHANNEL_ID.test(channelId) ? channelId : "",
      },
      parsed,
    ).catch((error: unknown) => log("slack command failed", { error: String(error) })),
  );
  return acknowledged();
}

/**
 * `POST /slack/interactions`: the Acknowledge button (`block_actions`), the "Post to Brigade timeline" message
 * shortcut (`message_action`) and the declare form (`view_submission`). Every other interaction is answered and
 * ignored.
 */
async function interaction(request: Request, deps: Deps): Promise<Response> {
  const body = await verified(request, deps);
  if (body instanceof Response) return body;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new URLSearchParams(body).get("payload") ?? "") as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const teamId = String(Object(payload.team).id ?? "");
  const userId = String(Object(payload.user).id ?? "");
  // An org-level install (no team), or a bot: nothing to do.
  if (!TEAM_ID.test(teamId) || !USER_ID.test(userId)) return acknowledged();
  if (payload.type === "block_actions") return button(payload, { teamId, userId }, deps);
  if (payload.type === "message_action") return shortcut(payload, { teamId, userId }, deps);
  if (payload.type === "view_submission") return submission(payload, { teamId, userId }, deps);
  return acknowledged();
}

/** The Acknowledge button on the incident's message. */
async function button(
  payload: Record<string, unknown>,
  who: { teamId: string; userId: string },
  deps: Deps,
): Promise<Response> {
  const responseUrl = typeof payload.response_url === "string" ? payload.response_url : "";
  const actions = Array.isArray(payload.actions) ? (payload.actions as unknown[]) : [];
  const action = actions.find((one) => Object(one).action_id === ACK_ACTION) as
    | Record<string, unknown>
    | undefined;
  // A link button's click, or something else: nothing to do.
  if (!action || !isResponseUrl(responseUrl)) return acknowledged();
  const incidentId = action.value;
  const actionTs = typeof action.action_ts === "string" ? action.action_ts : "";
  if (!isId("inc", incidentId) || !actionTs) return acknowledged();
  deps.waitUntil(
    act(
      deps,
      { ...who, responseUrl },
      { kind: "ack", incidentId },
      // The incident is part of the key: Slack's `action_ts` is per click, and the key must never match another
      // incident's acknowledgement.
      await sha256Hex(`click:${who.userId}:${incidentId}:${actionTs}`),
    ).catch((error: unknown) => log("slack button failed", { error: String(error) })),
  );
  return acknowledged();
}

/**
 * "Post to Brigade timeline" on a message in an incident's channel (or its thread): the message as an update, by
 * whoever clicked. Only their own messages (RFC 0011 "Commands"): an update is in its poster's name, so someone else's
 * words, or an app's or a bot's, are refused rather than put in the clicker's mouth.
 */
async function shortcut(
  payload: Record<string, unknown>,
  who: { teamId: string; userId: string },
  deps: Deps,
): Promise<Response> {
  if (payload.callback_id !== POST_UPDATE_SHORTCUT) return acknowledged();
  const responseUrl = typeof payload.response_url === "string" ? payload.response_url : "";
  const channelId = String(Object(payload.channel).id ?? "");
  const message = Object(payload.message) as Record<string, unknown>;
  const ts = typeof message.ts === "string" ? message.ts : "";
  const threadTs = typeof message.thread_ts === "string" ? message.thread_ts : undefined;
  const text = typeof message.text === "string" ? plainText(message.text).trim() : "";
  if (!isResponseUrl(responseUrl) || !CHANNEL_ID.test(channelId) || !ts) return acknowledged();
  const own =
    message.user === who.userId &&
    message.bot_id === undefined &&
    message.app_id === undefined &&
    message.subtype === undefined;
  if (!own) {
    deps.waitUntil(
      (async () => {
        const locale = await deps.bridge.locale({ teamId: who.teamId, slackUserId: who.userId });
        const text = slack_text({ ...NO_ARGS, part: "reply_not_own_message" }, { locale });
        await reply(deps, responseUrl, text);
      })().catch((error: unknown) => log("slack shortcut failed", { error: String(error) })),
    );
    return acknowledged();
  }
  deps.waitUntil(
    act(
      deps,
      { ...who, responseUrl },
      {
        kind: "update",
        body: text,
        fromMessage: true,
        channelId,
        ...(threadTs && threadTs !== ts ? { threadTs } : {}),
      },
      // Per message, as `!update` keys it: the same message posted twice, either way, is one update.
      await sha256Hex(`message:${channelId}:${ts}`),
      "update",
    ).catch((error: unknown) => log("slack shortcut failed", { error: String(error) })),
  );
  return acknowledged();
}

/** The declare form, submitted: an empty 200 closes it, and the declaration answers through the command's URL. */
async function submission(
  payload: Record<string, unknown>,
  who: { teamId: string; userId: string },
  deps: Deps,
): Promise<Response> {
  const view = Object(payload.view) as Record<string, unknown>;
  const submitted = readDeclareSubmission(view);
  const viewId = typeof view.id === "string" ? view.id : "";
  if (!submitted || !viewId) return acknowledged();
  const responseUrl = submitted.metadata?.responseUrl ?? "";
  const { metadata: _metadata, ...declare } = submitted;
  deps.waitUntil(
    (async () => {
      // One form declares once, however often Slack delivers its submission.
      const key = await sha256Hex(`view:${viewId}`);
      const result = await deps.bridge.act({
        teamId: who.teamId,
        slackUserId: who.userId,
        action: { kind: "declare", ...declare },
        key,
      });
      if (isResponseUrl(responseUrl)) await reply(deps, responseUrl, replyText(result));
    })().catch((error: unknown) => log("slack form failed", { error: String(error) })),
  );
  return acknowledged();
}

/**
 * `POST /slack/events` (the Events API): Slack's URL check, `app_uninstalled` and `tokens_revoked` (the team's
 * connection is marked revoked), and `!update <text>` messages in an incident's channel or thread. Answered at once;
 * Slack retries an event it got no 200 for, and every write here is keyed, so a retry changes nothing.
 */
async function events(request: Request, deps: Deps): Promise<Response> {
  const body = await verified(request, deps);
  if (body instanceof Response) return body;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (payload.type === "url_verification") {
    const challenge = typeof payload.challenge === "string" ? payload.challenge.slice(0, 256) : "";
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (payload.type !== "event_callback") return acknowledged();
  const teamId = typeof payload.team_id === "string" ? payload.team_id : "";
  const event = Object(payload.event) as Record<string, unknown>;
  if (!TEAM_ID.test(teamId)) return acknowledged();
  if (event.type === "app_uninstalled") {
    deps.waitUntil(
      deps.bridge
        .revoked({ teamId, reason: "uninstalled" })
        .catch((error: unknown) => log("slack revocation failed", { error: String(error) })),
    );
    return acknowledged();
  }
  if (event.type === "tokens_revoked") {
    const bots = Object(event.tokens).bot;
    const botUserIds = (Array.isArray(bots) ? bots : []).filter(
      (id: unknown): id is string => typeof id === "string" && USER_ID.test(id),
    );
    // Only user tokens: Brigade holds none.
    if (botUserIds.length === 0) return acknowledged();
    deps.waitUntil(
      deps.bridge
        .revoked({ teamId, reason: "tokens_revoked", botUserIds })
        .catch((error: unknown) => log("slack revocation failed", { error: String(error) })),
    );
    return acknowledged();
  }
  if (event.type === "message") {
    const update = bangUpdate(event);
    if (update) {
      deps.waitUntil(
        (async () => {
          const result = await deps.bridge.act({
            teamId,
            slackUserId: update.userId,
            action: {
              kind: "update",
              body: update.body,
              fromMessage: true,
              channelId: update.channelId,
              ...(update.threadTs ? { threadTs: update.threadTs } : {}),
            },
            key: await sha256Hex(`message:${update.channelId}:${update.ts}`),
            // No `response_url` for an event: the API answers in the channel, to the person only.
            answer: {
              channelId: update.channelId,
              ...(update.threadTs ? { threadTs: update.threadTs } : {}),
            },
          });
          return result;
        })().catch((error: unknown) => log("slack message failed", { error: String(error) })),
      );
    }
  }
  return acknowledged();
}

/** What starts an update in an incident's channel. */
export const UPDATE_PREFIX = "!update ";

/**
 * A person's new message (no subtype: not an edit, a join or a bot's) in a channel that starts with `!update `: the
 * rest is the update. Undefined for anything else.
 */
function bangUpdate(
  event: Record<string, unknown>,
): { userId: string; channelId: string; ts: string; threadTs?: string; body: string } | undefined {
  if (event.subtype !== undefined || event.bot_id !== undefined) return undefined;
  const text = typeof event.text === "string" ? event.text : "";
  const userId = typeof event.user === "string" ? event.user : "";
  const channelId = typeof event.channel === "string" ? event.channel : "";
  const ts = typeof event.ts === "string" ? event.ts : "";
  if (!text.toLowerCase().startsWith(UPDATE_PREFIX) || !USER_ID.test(userId)) return undefined;
  if (!CHANNEL_ID.test(channelId) || !ts) return undefined;
  const body = plainText(text.slice(UPDATE_PREFIX.length)).trim();
  if (!body) return undefined;
  const threadTs =
    typeof event.thread_ts === "string" && event.thread_ts !== ts ? event.thread_ts : undefined;
  return { userId, channelId, ts, body, ...(threadTs ? { threadTs } : {}) };
}

/**
 * Slack's `response_url`s are on hooks.slack.com: never post anywhere else, so a forged body (it would also need the
 * signing secret) cannot point this Worker at another host.
 */
function isResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

type Requester = { teamId: string; userId: string; responseUrl: string };

async function runCommand(
  deps: Deps,
  requester: Requester & { triggerId: string; channelId: string },
  parsed: ParsedCommand,
): Promise<void> {
  const key = await sha256Hex(`command:${requester.triggerId}`);
  // The channel the command was typed in: an incident's own channel names that incident.
  const where = requester.channelId ? { channelId: requester.channelId } : {};
  const number = (target: { number?: number }) =>
    target.number === undefined ? {} : { number: target.number };
  switch (parsed.kind) {
    case "declare":
      if (parsed.title === "") return openForm(deps, requester, parsed.severity);
      return act(deps, requester, parsed, key);
    case "ack":
      return act(deps, requester, { kind: "ack", ...where, ...number(parsed) }, key, "ack");
    case "update":
      return act(
        deps,
        requester,
        { kind: "update", body: parsed.body, ...where, ...number(parsed) },
        key,
        "update",
      );
    case "severity":
      return act(
        deps,
        requester,
        { kind: "severity", severity: parsed.severity, ...where, ...number(parsed) },
        key,
        "sev",
      );
    case "resolve":
      return act(deps, requester, { kind: "resolve", ...where, ...number(parsed) }, key, "resolve");
    case "role":
      return act(
        deps,
        requester,
        { kind: "role", role: parsed.role, user: parsed.user, ...where, ...number(parsed) },
        key,
        "role",
        { assignee: parsed.user, typedRole: parsed.role },
      );
    case "escalate":
      return act(
        deps,
        requester,
        { kind: "escalate", ...where, ...number(parsed) },
        key,
        "escalate",
      );
    case "help":
    case "unknown":
      break;
  }
  // Help, or something `/inc` does not know: the usage, in the person's language when Slack says it.
  const locale = await deps.bridge.locale({
    teamId: requester.teamId,
    slackUserId: requester.userId,
  });
  const say = (part: string) => slack_text({ ...NO_ARGS, part }, { locale });
  await reply(
    deps,
    requester.responseUrl,
    parsed.kind === "unknown" ? `${say("reply_unknown")} ${say("usage")}` : say("usage"),
  );
}

/** `/inc declare` alone: the form. When it cannot open, the person is told why. */
async function openForm(
  deps: Deps,
  requester: Requester & { triggerId: string },
  severity: Severity,
): Promise<void> {
  const opened = await deps.bridge.openDeclare({
    teamId: requester.teamId,
    slackUserId: requester.userId,
    triggerId: requester.triggerId,
    responseUrl: requester.responseUrl,
    severity,
  });
  if (opened.ok) return;
  const text =
    opened.code === "failed"
      ? slack_text({ ...NO_ARGS, part: "reply_modal_failed" }, { locale: opened.locale })
      : replyText({ ...opened, ok: false });
  await reply(deps, requester.responseUrl, text);
}

/** Runs one action as the member the Slack user maps to, and tells them how it went. */
async function act(
  deps: Deps,
  requester: Requester,
  action: SlackAction,
  key: string,
  verb?: SlackVerb,
  more: { assignee?: string; typedRole?: string } = {},
): Promise<void> {
  const result = await deps.bridge.act({
    teamId: requester.teamId,
    slackUserId: requester.userId,
    action,
    key,
  });
  await reply(deps, requester.responseUrl, replyText(result, { verb, ...more }));
}

/** Answers through `response_url`, ephemeral, never replacing the message it came from. Never throws. */
async function reply(deps: Deps, responseUrl: string, text: string): Promise<void> {
  try {
    const response = await deps.fetch(
      new Request(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
        signal: AbortSignal.timeout(10_000),
      }),
    );
    await response.body?.cancel();
    if (!response.ok) log("slack reply refused", { status: response.status });
  } catch (error) {
    log("slack reply failed", { error: String(error) });
  }
}
