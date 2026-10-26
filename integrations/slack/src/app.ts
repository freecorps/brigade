// The Slack app's requests (RFC 0011), behind the Worker's entry (src/index.ts):
// - `POST /slack/commands`: `/inc`; `POST /slack/interactions`: the Acknowledge button. Both are verified first,
//   answered with an empty 200 at once, and done in `waitUntil`, answering through the request's `response_url`.
// - `GET /slack/install?state=…`: on to Slack's OAuth page; `GET /slack/oauth/callback`: back from it.
// Every read and write of Brigade's data, and every Web API call that needs the bot token, goes through the API's
// `SlackBridge` (src/bridge.ts): this Worker never holds a token.

import { slack_text } from "@freecorps/brigade-i18n/messages";
import { formatIncidentNumber, isId } from "@freecorps/brigade-schema";
import type { SlackActResult, SlackBridgeApi } from "./bridge.ts";
import { parseCommand, type ParsedCommand } from "./command.ts";
import { ACK_ACTION, escapeMrkdwn } from "./notifier.ts";
import { completeOAuth, startOAuth } from "./oauth.ts";
import { sha256Hex, verifySlackRequest } from "./verify.ts";
import { log, type Deps } from "./deps.ts";

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/slack/commands":
      return post(request, () => command(request, deps));
    case "/slack/interactions":
      return post(request, () => interaction(request, deps));
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
  if (!TEAM_ID.test(teamId) || !USER_ID.test(userId) || !isResponseUrl(responseUrl) || !triggerId) {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const parsed = parseCommand(form.get("text") ?? "");
  deps.waitUntil(
    runCommand(deps, { teamId, userId, responseUrl, triggerId }, parsed).catch((error: unknown) =>
      log("slack command failed", { error: String(error) }),
    ),
  );
  return acknowledged();
}

/** `POST /slack/interactions`: the Acknowledge button; every other interaction is answered and ignored. */
async function interaction(request: Request, deps: Deps): Promise<Response> {
  const body = await verified(request, deps);
  if (body instanceof Response) return body;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new URLSearchParams(body).get("payload") ?? "") as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || payload.type !== "block_actions") {
    return acknowledged();
  }
  const teamId = String(Object(payload.team).id ?? "");
  const userId = String(Object(payload.user).id ?? "");
  const responseUrl = typeof payload.response_url === "string" ? payload.response_url : "";
  const actions = Array.isArray(payload.actions) ? (payload.actions as unknown[]) : [];
  const action = actions.find((one) => Object(one).action_id === ACK_ACTION) as
    | Record<string, unknown>
    | undefined;
  // A link button's click, an org-level install (no team), or something else: nothing to do.
  if (!action || !TEAM_ID.test(teamId) || !USER_ID.test(userId) || !isResponseUrl(responseUrl)) {
    return acknowledged();
  }
  const incidentId = action.value;
  const actionTs = typeof action.action_ts === "string" ? action.action_ts : "";
  if (!isId("inc", incidentId) || !actionTs) return acknowledged();
  deps.waitUntil(
    act(
      deps,
      { teamId, userId, responseUrl },
      { kind: "ack", incidentId },
      // The incident is part of the key: Slack's `action_ts` is per click, and the key must never match another
      // incident's acknowledgement.
      await sha256Hex(`click:${userId}:${incidentId}:${actionTs}`),
    ).catch((error: unknown) => log("slack button failed", { error: String(error) })),
  );
  return acknowledged();
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
  requester: Requester & { triggerId: string },
  parsed: ParsedCommand,
): Promise<void> {
  const key = await sha256Hex(`command:${requester.triggerId}`);
  if (parsed.kind === "declare") {
    return act(deps, requester, parsed, key);
  }
  if (parsed.kind === "ack") {
    return act(
      deps,
      requester,
      { kind: "ack", ...(parsed.number === undefined ? {} : { number: parsed.number }) },
      key,
    );
  }
  // Help, or something this slice does not know: the usage, in the person's language when Slack says it.
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

/** Runs one action as the member the Slack user maps to, and tells them how it went. */
async function act(
  deps: Deps,
  requester: Requester,
  action: Parameters<SlackBridgeApi["act"]>[0]["action"],
  key: string,
): Promise<void> {
  const result = await deps.bridge.act({
    teamId: requester.teamId,
    slackUserId: requester.userId,
    action,
    key,
  });
  await reply(deps, requester.responseUrl, replyText(result));
}

const NO_ARGS = { incident: "", title: "", name: "", workspace: "", list: "" };

/** The ephemeral answer to an action, in the language the bridge chose. Titles and names are escaped: people's text. */
export function replyText(result: SlackActResult): string {
  const { incident, locale, workspaceName } = result;
  const args = {
    ...NO_ARGS,
    incident: (incident && formatIncidentNumber(incident.number)) ?? "",
    title: incident ? escapeMrkdwn(incident.title) : "",
    workspace: escapeMrkdwn(workspaceName),
  };
  const say = (part: string, more: Partial<typeof args> = {}) =>
    slack_text({ ...args, ...more, part }, { locale });
  if (result.ok) return say(result.did === "declared" ? "reply_declared" : "reply_acknowledged");
  switch (result.code) {
    case "ambiguous": {
      const choices = (result.choices ?? []).map((number) => formatIncidentNumber(number)!);
      return say("reply_ambiguous", { list: choices.join(", "), incident: choices[0] ?? "INC-1" });
    }
    case "already":
      return say("reply_already");
    case "not_active":
      return say("reply_not_active");
    case "not_found":
      return say("reply_not_found");
    case "none":
      return say("reply_none");
    case "forbidden":
      return say("reply_forbidden");
    case "unmapped":
      return say("reply_unmapped");
    case "not_connected":
      return say("reply_not_connected");
    case "unreadable":
      return say("reply_reconnect");
    case "unconfirmed":
      return say("reply_unconfirmed");
    case "invalid_title":
      return say("reply_invalid_title");
    case "failed":
      return say("reply_failed");
  }
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
