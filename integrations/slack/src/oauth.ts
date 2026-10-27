// Installing the Slack app into a Slack workspace (RFC 0011 "Installing (OAuth v2)"). The install starts on the API
// (`POST /api/workspaces/:id/slack/install`), which checks the member and sets a cookie holding a one-time state; this
// Worker sends the browser to Slack with that state and, on the way back, checks the state against the cookie before
// it exchanges the code, so the callback belongs to the browser that started it.

import { log, type Deps } from "./deps.ts";
import { callSlack } from "./web-api.ts";

/** Set by the API with the state, read and cleared here (path `/slack/oauth`, 10 minutes). */
export const STATE_COOKIE = "brigade_slack_oauth";
/** `<workspace id>.<32 random bytes, base64url>`, as the API makes it. */
export const STATE = /^ws_[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/;
/**
 * What the bot needs (RFC 0011): `/inc` and the shortcut, posting (public channels without an invitation), users by
 * email, the channel picker (`conversations.list`), incident channels (create, invite, archive: public and private),
 * and `!update` messages in them (the Events API's `message.channels` and `message.groups`).
 */
export const BOT_SCOPES = [
  "commands",
  "chat:write",
  "chat:write.public",
  "users:read",
  "users:read.email",
  "channels:read",
  "groups:read",
  "channels:manage",
  "groups:write",
  "channels:history",
  "groups:history",
] as const;

const AUTHORIZE = "https://slack.com/oauth/v2/authorize";

/** `GET /slack/install?state=…`: on to Slack's consent page. */
export async function startOAuth(request: Request, deps: Deps): Promise<Response> {
  const origin = dashboard(deps);
  if (!origin || !deps.clientId) return Response.json({ error: "not_configured" }, { status: 503 });
  const state = new URL(request.url).searchParams.get("state") ?? "";
  if (!STATE.test(state)) return back(origin, "failed");
  const url = new URL(AUTHORIZE);
  url.searchParams.set("client_id", deps.clientId);
  url.searchParams.set("scope", BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri(origin));
  url.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: { Location: url.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

/**
 * `GET /slack/oauth/callback?code&state` (or `?error=access_denied&state`): checks the state against the cookie,
 * exchanges the code, and hands the result to the API, which checks the state is one it made, still unused, for a
 * member who may still connect Slack. Always back to the dashboard with `?slack=<outcome>`, the cookie cleared.
 */
export async function completeOAuth(request: Request, deps: Deps): Promise<Response> {
  const origin = dashboard(deps);
  if (!origin || !deps.clientId || !deps.clientSecret) {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const cookie = readCookie(request.headers.get("Cookie"), STATE_COOKIE) ?? "";
  if (!STATE.test(state) || !(await sameText(state, cookie))) {
    log("slack install refused: state does not match the cookie", {});
    return back(origin, "failed");
  }
  if (params.get("error")) return back(origin, "cancelled");
  const code = params.get("code") ?? "";
  if (!code || code.length > 512) return back(origin, "failed");

  const exchanged = await callSlack(
    "oauth.v2.access",
    {
      client_id: deps.clientId,
      client_secret: deps.clientSecret,
      code,
      redirect_uri: redirectUri(origin),
    },
    { form: true, fetch: deps.fetch },
  );
  if (!exchanged.ok) {
    log("slack install: code exchange failed", { error: exchanged.error });
    return back(origin, "failed");
  }
  const data = exchanged.data;
  const team = Object(data.team) as Record<string, unknown>;
  const token = typeof data.access_token === "string" ? data.access_token : "";
  const install = {
    teamId: typeof team.id === "string" ? team.id : "",
    teamName: typeof team.name === "string" ? team.name : "",
    botUserId: typeof data.bot_user_id === "string" ? data.bot_user_id : "",
    token,
    scopes: typeof data.scope === "string" ? data.scope.split(",").filter(Boolean) : [],
  };
  // A bot token for one team; Enterprise Grid org installs (no team) are not supported yet (RFC 0011).
  const usable =
    data.token_type === "bot" &&
    token.startsWith("xoxb-") &&
    data.is_enterprise_install !== true &&
    /^T[A-Z0-9]{2,30}$/.test(install.teamId) &&
    /^[UW][A-Z0-9]{2,30}$/.test(install.botUserId);
  if (!usable) {
    log("slack install refused: not a team bot token", {
      enterprise: data.is_enterprise_install === true,
    });
    await revoke(token, deps);
    return back(origin, "failed");
  }
  let outcome: string;
  try {
    const result = await deps.bridge.completeInstall(state, install);
    outcome = result.ok ? "connected" : result.code;
    // Slack issued a token Brigade will not keep: give it back, unless the API could not rule out that a workspace
    // holds this very token (Slack can hand a reinstall the token the team already has).
    if (!result.ok && result.revoke) await revoke(token, deps);
  } catch (error) {
    // The API did not answer: it may have kept the token, or another workspace may hold it, so it stays.
    log("slack install: the API failed", { error: String(error) });
    outcome = "failed";
  }
  return back(origin, outcome);
}

/** `auth.revoke` on a token Brigade got and will not keep. Best effort, never throws. */
async function revoke(token: string, deps: Deps): Promise<void> {
  if (!token) return;
  const result = await callSlack("auth.revoke", {}, { token, form: true, fetch: deps.fetch });
  if (!result.ok) log("slack install: revoking the token failed", { error: result.error });
}

/** The dashboard's origin, or undefined when `DASHBOARD_URL` is missing or not http(s). */
function dashboard(deps: Deps): string | undefined {
  if (!deps.dashboardUrl) return undefined;
  try {
    const url = new URL(deps.dashboardUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export function redirectUri(origin: string): string {
  return `${origin}/slack/oauth/callback`;
}

/** Back to the dashboard with the outcome, the state cookie cleared. */
function back(origin: string, outcome: string): Response {
  const url = new URL("/", origin);
  url.searchParams.set("slack", outcome);
  const headers = new Headers({ Location: url.href, "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    `${STATE_COOKIE}=; Path=/slack/oauth; Max-Age=0; HttpOnly; SameSite=Lax${origin.startsWith("https:") ? "; Secure" : ""}`,
  );
  return new Response(null, { status: 302, headers });
}

function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Equal strings, compared in constant time (HMAC both under a random key, then compare the MACs). */
async function sameText(a: string, b: string): Promise<boolean> {
  const key = (await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ])) as CryptoKey;
  const encoder = new TextEncoder();
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(a));
  return crypto.subtle.verify("HMAC", key, mac, encoder.encode(b));
}
