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
  SlackRequester,
} from "@freecorps/brigade-slack/bridge";
import type { Fetch } from "@freecorps/brigade-slack/notifier";
import { lookUpPerson } from "@freecorps/brigade-slack/people";
import {
  can,
  isId,
  isRole,
  SEVERITIES,
  SLACK_LOCALES,
  slackTeamId,
  slackTeamName,
  type Actor,
  type SlackLocale,
} from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import type { Auth } from "./auth.ts";
import type { SlackShardAction } from "./slack.ts";
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

export class SlackBridge extends WorkerEntrypoint<Env> implements SlackBridgeApi {
  locale(requester: SlackRequester): Promise<SlackLocale> {
    return slackReplyLocale(this.env, requester);
  }

  act(request: SlackActRequest): Promise<SlackActResult> {
    return slackAct(this.env, request);
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
    const outcome = await env.WORKSPACE.getByName(workspaceId).slackAct(
      workspaceId,
      request.teamId,
      actor,
      action,
      request.key,
    );
    return { ...outcome, locale, workspaceName };
  } catch (error) {
    log("slack action failed", { error: String(error) });
    return refuse("failed");
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

/** The action as the shard takes it, or undefined when it is not one. */
function parseAction(input: unknown): SlackShardAction | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const action = input as Record<string, unknown>;
  if (action.kind === "declare") {
    const severity = SEVERITIES.find((value) => value === action.severity);
    if (typeof action.title !== "string" || action.title.length > MAX_TITLE_INPUT || !severity) {
      return undefined;
    }
    return { kind: "declare", title: action.title, severity };
  }
  if (action.kind === "ack") {
    if (action.incidentId !== undefined) {
      return isId("inc", action.incidentId)
        ? { kind: "ack", incidentId: action.incidentId }
        : undefined;
    }
    if (action.number !== undefined) {
      return Number.isSafeInteger(action.number) && (action.number as number) > 0
        ? { kind: "ack", number: action.number as number }
        : undefined;
    }
    return { kind: "ack" };
  }
  return undefined;
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, integration: "slack", ...fields }));
}
