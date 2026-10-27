// The API's side of the Slack app (RFC 0011 "Shape"). `SlackBridge` is a named entrypoint the Slack Worker binds to
// (integrations/slack wrangler.jsonc): it reads D1 (which workspace a Slack team is, which member an email is, their
// role) and runs everything else in the workspace's shard, so the Slack Worker holds no D1 or Durable Object binding.
// The bot token stays here too: the bridge opens it to ask Slack who a user is (`users.info`), and the Slack Worker
// answers through each request's `response_url`, which needs no token.
// `beginSlackInstall` is the dashboard's `POST /workspaces/:id/slack/install`, which starts an install.

import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  SlackActRefusal,
  SlackActRequest,
  SlackActResult,
  SlackBridgeApi,
  SlackInstall,
  SlackInstallRefusal,
  SlackInstallResult,
  SlackOpenDeclare,
  SlackOpenDeclareResult,
  SlackRequester,
  SlackRevocation,
} from "@freecorps/brigade-slack/bridge";
import { declareModal } from "@freecorps/brigade-slack/modal";
import type { Fetch } from "@freecorps/brigade-slack/notifier";
import { lookUpPerson } from "@freecorps/brigade-slack/people";
import { replyText } from "@freecorps/brigade-slack/replies";
import { callSlack } from "@freecorps/brigade-slack/web-api";
import {
  can,
  isId,
  isRole,
  MAX_INCIDENT_SERVICES,
  SEVERITIES,
  SLACK_LOCALES,
  slackTeamId,
  slackTeamName,
  type Actor,
  type SlackLocale,
} from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import type { Auth } from "./auth.ts";
import type { SlackShardAction, SlackShardTarget } from "./slack.ts";
import { isTokenKey, openToken, sealToken, tokenBinding } from "./slack-token.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

/** The API's bindings as Slack needs them; `SLACK_TOKEN_KEY` is optional: without it Slack is off. */
export type SlackBridgeEnv = Pick<Env, "DB" | "WORKSPACE"> & { SLACK_TOKEN_KEY?: string };

/** The cookie the Slack Worker checks the OAuth callback's state against (integrations/slack src/oauth.ts). */
export const SLACK_STATE_COOKIE = "brigade_slack_oauth";
const STATE_COOKIE_SECONDS = 10 * 60;
/** The nonce half of a state: 32 bytes, base64url. */
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_KEY = /^[0-9a-f]{64}$/;
/** A Slack user id, as the Slack Worker checked it. */
const SLACK_USER_ID = /^[UW][A-Z0-9]{2,30}$/;
const MAX_TITLE_INPUT = 1000;
/** Longer than any update `incident.postUpdate` takes, so the mutation's own check words the refusal. */
const MAX_UPDATE_INPUT = 8000;
const CHANNEL_ID = /^[CG][A-Z0-9]{2,30}$/;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/;
/** Channels the dashboard's picker lists at most: 5 pages of Slack's suggested 200. */
const MAX_CHANNEL_PAGES = 5;

export class SlackBridge extends WorkerEntrypoint<Env> implements SlackBridgeApi {
  locale(requester: SlackRequester): Promise<SlackLocale> {
    return slackReplyLocale(this.env, requester);
  }

  act(request: SlackActRequest): Promise<SlackActResult> {
    return actAndAnswer(this.env, request);
  }

  openDeclare(request: SlackOpenDeclare): Promise<SlackOpenDeclareResult> {
    return openSlackDeclare(this.env, request);
  }

  revoked(revocation: SlackRevocation): Promise<void> {
    return slackRevoked(this.env, revocation);
  }

  completeInstall(state: string, install: SlackInstall): Promise<SlackInstallResult> {
    return completeSlackInstall(this.env, state, install);
  }
}

/** The workspace connected to `teamId` and its token, opened for this request only. */
export type SlackConnection =
  | { ok: true; workspaceId: string; workspaceName: string; token: string; locale: SlackLocale }
  /** `unreadable`: connected, but the token does not open (`SLACK_TOKEN_KEY` changed): the team must reconnect. */
  | { ok: false; code: "not_connected" | "unreadable" };

export async function slackConnection(
  env: SlackBridgeEnv,
  teamId: string,
): Promise<SlackConnection> {
  if (!slackTeamId(teamId).ok || !isTokenKey(env.SLACK_TOKEN_KEY)) {
    return { ok: false, code: "not_connected" };
  }
  const workspaceId = await teamWorkspace(env.DB, teamId);
  if (!workspaceId) return { ok: false, code: "not_connected" };
  const context = await env.WORKSPACE.getByName(workspaceId).slackContext(teamId);
  if (!context) return { ok: false, code: "not_connected" };
  try {
    const token = await openToken(
      env.SLACK_TOKEN_KEY,
      context.token,
      tokenBinding(workspaceId, teamId),
    );
    return {
      ok: true,
      workspaceId,
      workspaceName: context.workspaceName,
      token,
      locale: context.locale,
    };
  } catch (error) {
    // A rotated key, or a row moved between workspaces: Slack cannot be answered for this team until it reconnects.
    log("slack token could not be opened: the team must reconnect", {
      workspace: workspaceId,
      error: String(error),
    });
    return { ok: false, code: "unreadable" };
  }
}

/** The language for a reply no action words (the usage): Slack's for the user, else the connection's, else `en`. */
export async function slackReplyLocale(
  env: SlackBridgeEnv,
  requester: SlackRequester,
  send: Fetch = (request) => fetch(request),
  now: () => number = Date.now,
): Promise<SlackLocale> {
  if (!SLACK_USER_ID.test(String(requester.slackUserId))) return "en";
  try {
    const connection = await slackConnection(env, requester.teamId);
    if (!connection.ok) return "en";
    const person = await lookUpPerson(
      requester.teamId,
      requester.slackUserId,
      connection.token,
      send,
      now(),
    );
    return person.locale ?? connection.locale;
  } catch (error) {
    log("slack locale lookup failed", { error: String(error) });
    return "en";
  }
}

/**
 * Runs a Slack user's action as the member their email is in the team's workspace, with the role D1 has now. The
 * email is Slack's (`users.info`, confirmed, the team's own user) and must be a verified Brigade address; anyone else,
 * and roles that are not Brigade's, run nothing.
 */
export async function slackAct(
  env: SlackBridgeEnv,
  request: SlackActRequest,
  send: Fetch = (request) => fetch(request),
  now: () => number = Date.now,
): Promise<SlackActResult> {
  const refuse = (
    code: SlackActRefusal,
    locale: SlackLocale = "en",
    workspaceName = "",
  ): SlackActResult => ({ ok: false, code, locale, workspaceName });
  const action = parseAction(request.action);
  if (
    !slackTeamId(request.teamId).ok ||
    !SLACK_USER_ID.test(String(request.slackUserId)) ||
    !REQUEST_KEY.test(request.key) ||
    !action
  ) {
    return refuse("failed");
  }
  try {
    const connection = await slackConnection(env, request.teamId);
    if (!connection.ok) return refuse(connection.code);
    const { workspaceId, workspaceName } = connection;
    const person = await lookUpPerson(
      request.teamId,
      request.slackUserId,
      connection.token,
      send,
      now(),
    );
    const slackSide = person.locale ?? connection.locale;
    if (!person.ok) {
      return refuse(
        person.reason === "unconfirmed" ? "unconfirmed" : "failed",
        slackSide,
        workspaceName,
      );
    }
    const member = await memberByEmail(env.DB, workspaceId, person.email);
    if (!member) return refuse("unmapped", slackSide, workspaceName);
    const locale = userLocale(member.locale) ?? slackSide;
    if (!isRole(member.role)) return refuse("unmapped", locale, workspaceName);
    const actor: Actor = { kind: "user", id: member.userId, role: member.role };
    let shardAction: SlackShardAction;
    if (action.kind === "role") {
      // The person the role goes to is mapped as the requester is: Slack's confirmed email, a verified member.
      const assignee = await lookUpPerson(
        request.teamId,
        action.user,
        connection.token,
        send,
        now(),
      );
      if (!assignee.ok) {
        return refuse(
          assignee.reason === "failed" ? "failed" : "role_unmapped",
          locale,
          workspaceName,
        );
      }
      const holder = await memberByEmail(env.DB, workspaceId, assignee.email);
      if (!holder) return refuse("role_unmapped", locale, workspaceName);
      const { user: _user, ...rest } = action;
      shardAction = { ...rest, userId: holder.userId };
    } else {
      shardAction = action;
    }
    const outcome = await env.WORKSPACE.getByName(workspaceId).slackAct(
      workspaceId,
      request.teamId,
      actor,
      shardAction,
      request.key,
    );
    return { ...outcome, locale, workspaceName };
  } catch (error) {
    log("slack action failed", { error: String(error) });
    return refuse("failed");
  }
}

/**
 * `act`, and for a request with no `response_url` (an Events API message) the answer posted by the API itself, as an
 * ephemeral message to the person in that channel (and thread). The answer is best effort.
 */
export async function actAndAnswer(
  env: SlackBridgeEnv,
  request: SlackActRequest,
  send: Fetch = (request) => fetch(request),
  now: () => number = Date.now,
): Promise<SlackActResult> {
  const result = await slackAct(env, request, send, now);
  const answer = request.answer;
  if (!answer || !CHANNEL_ID.test(String(answer.channelId))) return result;
  try {
    const connection = await slackConnection(env, request.teamId);
    if (!connection.ok) return result;
    const verb = request.action.kind === "update" ? "update" : undefined;
    const posted = await callSlack(
      "chat.postEphemeral",
      {
        channel: answer.channelId,
        user: request.slackUserId,
        text: replyText(result, { verb }),
        ...(answer.threadTs && SLACK_TS.test(answer.threadTs)
          ? { thread_ts: answer.threadTs }
          : {}),
      },
      { token: connection.token, fetch: send },
    );
    if (!posted.ok) log("slack answer not posted", { error: posted.error });
  } catch (error) {
    log("slack answer failed", { error: String(error) });
  }
  return result;
}

/**
 * Opens the declare form (`views.open`) for a Slack user who may declare, with the workspace's incident types and
 * services. Refused like an action for anyone who could not declare, so they are told why without a form.
 */
export async function openSlackDeclare(
  env: SlackBridgeEnv,
  request: SlackOpenDeclare,
  send: Fetch = (request) => fetch(request),
  now: () => number = Date.now,
): Promise<SlackOpenDeclareResult> {
  const refuse = (
    code: SlackActRefusal,
    locale: SlackLocale = "en",
    workspaceName = "",
  ): SlackOpenDeclareResult => ({ ok: false, code, locale, workspaceName });
  const severity = SEVERITIES.find((value) => value === request.severity);
  if (
    !slackTeamId(request.teamId).ok ||
    !SLACK_USER_ID.test(String(request.slackUserId)) ||
    typeof request.triggerId !== "string" ||
    !request.triggerId ||
    request.triggerId.length > 256 ||
    typeof request.responseUrl !== "string" ||
    !request.responseUrl.startsWith("https://hooks.slack.com/") ||
    !severity
  ) {
    return refuse("failed");
  }
  try {
    const connection = await slackConnection(env, request.teamId);
    if (!connection.ok) return refuse(connection.code);
    const { workspaceId, workspaceName } = connection;
    const person = await lookUpPerson(
      request.teamId,
      request.slackUserId,
      connection.token,
      send,
      now(),
    );
    const slackSide = person.locale ?? connection.locale;
    if (!person.ok) {
      return refuse(
        person.reason === "unconfirmed" ? "unconfirmed" : "failed",
        slackSide,
        workspaceName,
      );
    }
    const member = await memberByEmail(env.DB, workspaceId, person.email);
    if (!member) return refuse("unmapped", slackSide, workspaceName);
    const locale = userLocale(member.locale) ?? slackSide;
    if (!isRole(member.role)) return refuse("unmapped", locale, workspaceName);
    if (!can(member.role, "incident:declare")) return refuse("forbidden", locale, workspaceName);
    const catalog = await env.WORKSPACE.getByName(workspaceId).slackCatalog();
    const opened = await callSlack(
      "views.open",
      {
        trigger_id: request.triggerId,
        view: declareModal({
          locale,
          severity,
          types: catalog.types,
          services: catalog.services,
          metadata: { responseUrl: request.responseUrl },
        }),
      },
      { token: connection.token, fetch: send },
    );
    if (!opened.ok) {
      log("slack form did not open", { error: opened.error });
      return refuse("failed", locale, workspaceName);
    }
    return { ok: true };
  } catch (error) {
    log("slack form failed", { error: String(error) });
    return refuse("failed");
  }
}

/** Slack took the app's access away (Events API): the team's workspace marks its connection revoked. */
export async function slackRevoked(
  env: SlackBridgeEnv,
  revocation: SlackRevocation,
): Promise<void> {
  if (!slackTeamId(revocation.teamId).ok) return;
  const reason = revocation.reason === "tokens_revoked" ? "tokens_revoked" : "uninstalled";
  const bots =
    reason === "tokens_revoked"
      ? (Array.isArray(Reflect.get(revocation, "botUserIds"))
          ? (Reflect.get(revocation, "botUserIds") as unknown[])
          : []
        )
          .filter((id): id is string => typeof id === "string" && SLACK_USER_ID.test(id))
          .slice(0, 100)
      : null;
  if (bots !== null && bots.length === 0) return;
  const workspaceId = await teamWorkspace(env.DB, revocation.teamId);
  if (!workspaceId) return;
  const changed = await env.WORKSPACE.getByName(workspaceId).slackRevoked(
    revocation.teamId,
    reason,
    bots,
  );
  if (changed) log("slack access revoked by Slack", { workspace: workspaceId, reason });
}

/**
 * `GET /workspaces/:id/slack/channels`: the channels the dashboard's Slack card picks from (`conversations.list`
 * with the workspace's bot token: public ones, and private ones Brigade was invited to). Owners and admins only, like
 * every Slack setting; the token never leaves the API.
 */
export async function listSlackChannels(
  request: Request,
  env: SlackBridgeEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  send: Fetch = (request) => fetch(request),
): Promise<Response> {
  if (request.method !== "GET") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET" } },
    );
  }
  if (!ORGANIZATION_ID.test(workspaceId)) {
    return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const noStore = { "Cache-Control": "private, no-store" };
  try {
    const role = await memberRole(env.DB, workspaceId, session.user.id);
    if (!role) return Response.json({ error: "not_a_member" }, { status: 403 });
    if (!can(role, "workspace:manage"))
      return Response.json({ error: "forbidden" }, { status: 403 });
    const teamId = await env.WORKSPACE.getByName(workspaceId).slackTeam();
    const connection = teamId ? await slackConnection(env, teamId) : null;
    if (!connection?.ok || connection.workspaceId !== workspaceId) {
      return Response.json({ error: "not_connected" }, { status: 409, headers: noStore });
    }
    const channels: { id: string; name: string; private: boolean }[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
      const listed = await callSlack(
        "conversations.list",
        {
          types: "public_channel,private_channel",
          exclude_archived: "true",
          limit: "200",
          ...(cursor ? { cursor } : {}),
        },
        { token: connection.token, form: true, fetch: send },
      );
      if (!listed.ok) {
        log("slack channels could not be listed", { workspace: workspaceId, error: listed.error });
        return Response.json({ error: "slack_failed" }, { status: 502, headers: noStore });
      }
      for (const one of Array.isArray(listed.data.channels) ? listed.data.channels : []) {
        const channel = Object(one) as Record<string, unknown>;
        if (typeof channel.id !== "string" || !CHANNEL_ID.test(channel.id)) continue;
        if (typeof channel.name !== "string") continue;
        // Private channels Brigade is not in cannot take its messages.
        if (channel.is_private === true && channel.is_member !== true) continue;
        channels.push({
          id: channel.id,
          name: channel.name.slice(0, 80),
          private: channel.is_private === true,
        });
      }
      const next = Object(listed.data.response_metadata).next_cursor;
      if (typeof next !== "string" || next === "") break;
      cursor = next;
    }
    channels.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ channels }, { headers: noStore });
  } catch (error) {
    log("slack channels failed", { workspace: workspaceId, error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
}

/**
 * Finishes an install (RFC 0011 "Installing", step 4): takes the one-time state from the shard, checks the member
 * who started it may still manage the workspace, claims the team in D1, seals the token and runs `slack.connect` as
 * that member. A refusal says whether the token may be revoked: not when a workspace still holds this very token.
 */
export async function completeSlackInstall(
  env: SlackBridgeEnv,
  state: string,
  install: SlackInstall,
): Promise<SlackInstallResult> {
  const result = await connectInstall(env, state, install);
  if (result.ok) return result;
  return { ok: false, code: result.code, revoke: await mayRevoke(env, install) };
}

async function connectInstall(
  env: SlackBridgeEnv,
  state: string,
  install: SlackInstall,
): Promise<{ ok: true } | { ok: false; code: SlackInstallRefusal }> {
  const [workspaceId = "", nonce = "", ...rest] = String(state).split(".");
  if (rest.length > 0 || !ORGANIZATION_ID.test(workspaceId) || !NONCE.test(nonce)) {
    return { ok: false, code: "invalid_state" };
  }
  if (!isTokenKey(env.SLACK_TOKEN_KEY)) return { ok: false, code: "not_configured" };
  if (!slackTeamId(install.teamId).ok || typeof install.token !== "string" || !install.token) {
    return { ok: false, code: "failed" };
  }
  try {
    const shard = env.WORKSPACE.getByName(workspaceId);
    const userId = await shard.slackTakeState(workspaceId, nonce);
    if (!userId) return { ok: false, code: "invalid_state" };
    const role = await memberRole(env.DB, workspaceId, userId);
    if (!role || !can(role, "workspace:manage")) return { ok: false, code: "forbidden" };
    if (!(await claimTeam(env, install.teamId, workspaceId)))
      return { ok: false, code: "team_taken" };
    const locale = userLocale(
      (
        await env.DB.prepare(`select locale from "user" where id = ?`)
          .bind(userId)
          .first<{ locale: string | null }>()
      )?.locale ?? null,
    );
    const teamName = slackTeamName(install.teamName);
    const token = await sealToken(
      env.SLACK_TOKEN_KEY,
      install.token,
      tokenBinding(workspaceId, install.teamId),
    );
    const result = await shard.slackConnect(
      workspaceId,
      { kind: "user", id: userId, role },
      {
        teamId: install.teamId,
        // A name the shard cannot keep (too long, invisible characters) is shown as the team id.
        teamName: teamName.ok ? teamName.value : install.teamId,
        botUserId: install.botUserId,
        token,
        scopes: install.scopes.filter((scope) => /^[a-z:.]{1,64}$/.test(scope)).slice(0, 50),
        locale: locale ?? "en",
      },
      nonce,
    );
    if (!result.ok) {
      log("slack connect refused", { workspace: workspaceId, code: result.code });
      return { ok: false, code: result.code === "forbidden" ? "forbidden" : "failed" };
    }
    return { ok: true };
  } catch (error) {
    log("slack install failed", { workspace: workspaceId, error: String(error) });
    return { ok: false, code: "failed" };
  }
}

/**
 * `POST /workspaces/:id/slack/install`: an owner or admin starts connecting Slack (RFC 0011 "Installing", step 1).
 * Same-origin only, like every cookie-authenticated write. Answers `{ state }` and sets the cookie the callback checks
 * it against, so only this browser can finish the install.
 */
export async function beginSlackInstall(
  request: Request,
  env: SlackBridgeEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  if (!ORGANIZATION_ID.test(workspaceId)) {
    return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
  }
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== url.origin) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let role: Actor["role"] | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    log("member lookup failed", { error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!role) return Response.json({ error: "not_a_member" }, { status: 403 });
  if (!can(role, "workspace:manage")) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!isTokenKey(env.SLACK_TOKEN_KEY)) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  let nonce: string | null;
  try {
    nonce = await env.WORKSPACE.getByName(workspaceId).slackBeginInstall(
      workspaceId,
      session.user.id,
    );
  } catch (error) {
    log("slack install could not start", { workspace: workspaceId, error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (nonce === null) return Response.json({ error: "too_many" }, { status: 429 });
  const state = `${workspaceId}.${nonce}`;
  const cookie = [
    `${SLACK_STATE_COOKIE}=${state}`,
    "Path=/slack/oauth",
    `Max-Age=${STATE_COOKIE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(url.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");
  return Response.json(
    { state },
    { headers: { "Set-Cookie": cookie, "Cache-Control": "private, no-store" } },
  );
}

/** The workspace D1 routes `teamId` to; the shard still checks it is connected to that team. */
async function teamWorkspace(db: D1Database, teamId: string): Promise<string | undefined> {
  const row = await db
    .prepare(`select workspace_id from "slack_team" where team_id = ?`)
    .bind(teamId)
    .first<{ workspace_id: string }>();
  return row?.workspace_id;
}

/**
 * Routes `teamId` to `workspaceId` in D1, unless another workspace's shard still has it connected (`team_taken`).
 * A row whose shard no longer has the team (disconnected, or connected elsewhere since) is stale and taken over. The
 * write is a compare-and-set on the row as it was read, so of two installs racing for one team only one routes it.
 */
async function claimTeam(
  env: SlackBridgeEnv,
  teamId: string,
  workspaceId: string,
): Promise<boolean> {
  const current = await teamWorkspace(env.DB, teamId);
  if (current && current !== workspaceId) {
    const holder = await env.WORKSPACE.getByName(current).slackTeam();
    if (holder === teamId) return false;
  }
  const { meta } = await env.DB.prepare(
    `insert into "slack_team" (team_id, workspace_id, updated_at) values (?1, ?2, ?3)
     on conflict (team_id) do update set workspace_id = excluded.workspace_id, updated_at = excluded.updated_at
     where "slack_team".workspace_id = ?2 or "slack_team".workspace_id = ?4`,
  )
    .bind(teamId, workspaceId, Date.now(), current ?? workspaceId)
    .run();
  return meta.changes > 0;
}

/**
 * Whether a token from a refused install may be revoked in Slack. Slack can give a reinstall the bot token the team's
 * workspace already holds, and revoking that would cut the holder off; so the answer is yes only when no workspace
 * holds the team, or the token it holds opens and differs. Anything unknown (D1 or the shard down, no key, a token
 * that does not open) keeps it: an unused token costs less than a workspace that silently stops getting messages.
 */
async function mayRevoke(env: SlackBridgeEnv, install: SlackInstall): Promise<boolean> {
  if (typeof install.token !== "string" || !install.token) return false;
  if (!slackTeamId(install.teamId).ok) return true;
  try {
    const workspaceId = await teamWorkspace(env.DB, install.teamId);
    if (!workspaceId) return true;
    const held = await env.WORKSPACE.getByName(workspaceId).slackContext(install.teamId);
    if (!held) return true;
    if (!isTokenKey(env.SLACK_TOKEN_KEY)) return false;
    const token = await openToken(
      env.SLACK_TOKEN_KEY,
      held.token,
      tokenBinding(workspaceId, install.teamId),
    );
    return !sameToken(token, install.token);
  } catch (error) {
    log("slack install: could not tell whether the token is held", { error: String(error) });
    return false;
  }
}

/** Equal tokens, compared in constant time. */
function sameToken(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

/**
 * The member of `workspaceId` whose verified Brigade email is `email`, case-insensitively. An unverified address maps
 * to nobody: anyone can sign up with someone else's address, and only verification proves it is theirs (RFC 0002
 * "Auth"). Two matches (an address D1 holds twice in different cases) map to nobody rather than to either.
 */
async function memberByEmail(
  db: D1Database,
  workspaceId: string,
  email: string,
): Promise<{ userId: string; role: string; locale: string | null } | undefined> {
  const { results } = await db
    .prepare(
      `select u.id as userId, m.role as role, u.locale as locale
       from "member" m join "user" u on u.id = m."userId"
       where m."organizationId" = ? and lower(u.email) = ? and u."emailVerified" = 1 limit 2`,
    )
    .bind(workspaceId, email.trim().toLowerCase())
    .all<{ userId: string; role: string; locale: string | null }>();
  return results.length === 1 ? results[0] : undefined;
}

function userLocale(value: string | null): SlackLocale | null {
  return (SLACK_LOCALES as readonly (string | null)[]).includes(value)
    ? (value as SlackLocale)
    : null;
}

/** The action as the shard takes it, or undefined when it is not one. `role`'s user is still Slack's. */
function parseAction(
  input: unknown,
):
  | Exclude<SlackShardAction, { kind: "role" }>
  | ({ kind: "role"; role: string; user: string } & SlackShardTarget)
  | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const action = input as Record<string, unknown>;
  if (action.kind === "declare") {
    const severity = SEVERITIES.find((value) => value === action.severity);
    if (typeof action.title !== "string" || action.title.length > MAX_TITLE_INPUT || !severity) {
      return undefined;
    }
    const typeId = isId("typ", action.typeId) ? action.typeId : undefined;
    const serviceIds = Array.isArray(action.serviceIds)
      ? [...new Set(action.serviceIds.filter((id): id is string => isId("svc", id)))].slice(
          0,
          MAX_INCIDENT_SERVICES,
        )
      : [];
    return {
      kind: "declare",
      title: action.title,
      severity,
      ...(typeId ? { typeId } : {}),
      ...(serviceIds.length > 0 ? { serviceIds } : {}),
    };
  }
  const target = parseTarget(action);
  if (!target) return undefined;
  switch (action.kind) {
    case "ack":
    case "resolve":
    case "escalate":
      return { kind: action.kind, ...target };
    case "update":
      if (typeof action.body !== "string" || action.body.length > MAX_UPDATE_INPUT)
        return undefined;
      return {
        kind: "update",
        body: action.body,
        ...(action.fromMessage === true ? { fromMessage: true } : {}),
        ...target,
      };
    case "severity": {
      const severity = SEVERITIES.find((value) => value === action.severity);
      return severity ? { kind: "severity", severity, ...target } : undefined;
    }
    case "role":
      if (typeof action.role !== "string" || action.role.length < 1 || action.role.length > 100) {
        return undefined;
      }
      if (!SLACK_USER_ID.test(String(action.user))) return undefined;
      return { kind: "role", role: action.role, user: String(action.user), ...target };
    default:
      return undefined;
  }
}

/** Which incident an action names, checked; undefined when something in it is not what it should be. */
function parseTarget(action: Record<string, unknown>): SlackShardTarget | undefined {
  const target: SlackShardTarget = {};
  if (action.incidentId !== undefined) {
    if (!isId("inc", action.incidentId)) return undefined;
    target.incidentId = action.incidentId;
  }
  if (action.number !== undefined) {
    if (!Number.isSafeInteger(action.number) || (action.number as number) <= 0) return undefined;
    target.number = action.number as number;
  }
  if (action.channelId !== undefined) {
    if (typeof action.channelId !== "string" || !CHANNEL_ID.test(action.channelId))
      return undefined;
    target.channelId = action.channelId;
  }
  if (action.threadTs !== undefined) {
    if (typeof action.threadTs !== "string" || !SLACK_TS.test(action.threadTs)) return undefined;
    target.threadTs = action.threadTs;
  }
  return target;
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, integration: "slack", ...fields }));
}
