// The API's side of the Slack app (RFC 0011 "Shape"). `SlackBridge` is a named entrypoint the Slack Worker binds to
// (integrations/slack wrangler.jsonc): it reads D1 (which workspace a Slack team is, which member an email is, their
// role) and runs everything else in the workspace's shard, so the Slack Worker holds no D1 or Durable Object binding.
// `beginSlackInstall` is the dashboard's `POST /workspaces/:id/slack/install`, which starts an install.

import { WorkerEntrypoint } from "cloudflare:workers";
import type {
  SlackActRequest,
  SlackActResult,
  SlackBridgeApi,
  SlackContext,
  SlackInstall,
  SlackInstallResult,
} from "@freecorps/brigade-slack/bridge";
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
const MAX_EMAIL = 320;
const MAX_TITLE_INPUT = 1000;

export class SlackBridge extends WorkerEntrypoint<Env> implements SlackBridgeApi {
  context(teamId: string): Promise<SlackContext | null> {
    return slackContext(this.env, teamId);
  }

  act(request: SlackActRequest): Promise<SlackActResult> {
    return slackAct(this.env, request);
  }

  completeInstall(state: string, install: SlackInstall): Promise<SlackInstallResult> {
    return completeSlackInstall(this.env, state, install);
  }
}

/** The workspace connected to `teamId`, with its token opened; null when none is (or the token cannot be opened). */
export async function slackContext(
  env: SlackBridgeEnv,
  teamId: string,
): Promise<SlackContext | null> {
  if (!slackTeamId(teamId).ok || !isTokenKey(env.SLACK_TOKEN_KEY)) return null;
  const workspaceId = await teamWorkspace(env.DB, teamId);
  if (!workspaceId) return null;
  const context = await env.WORKSPACE.getByName(workspaceId).slackContext(teamId);
  if (!context) return null;
  try {
    const token = await openToken(
      env.SLACK_TOKEN_KEY,
      context.token,
      tokenBinding(workspaceId, teamId),
    );
    return { workspaceId, workspaceName: context.workspaceName, token, locale: context.locale };
  } catch (error) {
    // A rotated key, or a row moved between workspaces: Slack cannot be answered for this team until it reconnects.
    log("slack token could not be opened", { workspace: workspaceId, error: String(error) });
    return null;
  }
}

/**
 * Runs a Slack user's action as the member their (Slack-confirmed) email is in the team's workspace, with the role
 * D1 has now. Unmapped emails, and roles that are not Brigade's, run nothing.
 */
export async function slackAct(
  env: SlackBridgeEnv,
  request: SlackActRequest,
): Promise<SlackActResult> {
  const refuse = (
    code: Extract<SlackActResult, { ok: false }>["code"],
    locale: SlackLocale | null = null,
  ) => ({ ok: false, code, locale }) as const;
  const action = parseAction(request.action);
  if (
    !slackTeamId(request.teamId).ok ||
    typeof request.email !== "string" ||
    request.email.length > MAX_EMAIL ||
    !REQUEST_KEY.test(request.key) ||
    !action
  ) {
    return refuse("failed");
  }
  try {
    const workspaceId = await teamWorkspace(env.DB, request.teamId);
    if (!workspaceId) return refuse("not_connected");
    const member = await memberByEmail(env.DB, workspaceId, request.email);
    if (!member) return refuse("unmapped");
    const locale = userLocale(member.locale);
    if (!isRole(member.role)) return refuse("unmapped", locale);
    const actor: Actor = { kind: "user", id: member.userId, role: member.role };
    const result = await env.WORKSPACE.getByName(workspaceId).slackAct(
      workspaceId,
      request.teamId,
      actor,
      action,
      request.key,
    );
    return { ...result, locale };
  } catch (error) {
    log("slack action failed", { error: String(error) });
    return refuse("failed");
  }
}

/**
 * Finishes an install (RFC 0011 "Installing", step 4): takes the one-time state from the shard, checks the member
 * who started it may still manage the workspace, claims the team in D1, seals the token and runs `slack.connect` as
 * that member.
 */
export async function completeSlackInstall(
  env: SlackBridgeEnv,
  state: string,
  install: SlackInstall,
): Promise<SlackInstallResult> {
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
 * A row whose shard no longer has the team (disconnected, or connected elsewhere since) is stale and taken over.
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
  await env.DB.prepare(
    `insert into "slack_team" (team_id, workspace_id, updated_at) values (?, ?, ?)
     on conflict (team_id) do update set workspace_id = excluded.workspace_id, updated_at = excluded.updated_at`,
  )
    .bind(teamId, workspaceId, Date.now())
    .run();
  return true;
}

/**
 * The member of `workspaceId` whose Brigade email is `email`, case-insensitively. Two matches (an address D1 holds
 * twice in different cases) map to nobody rather than to either.
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
       where m."organizationId" = ? and lower(u.email) = ? limit 2`,
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
