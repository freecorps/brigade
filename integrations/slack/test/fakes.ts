// Fakes for the Worker's tests: Slack (Web API and response URLs) and the API's bridge. No real ids, tokens or hosts:
// team, user and channel ids are made up, and hosts are Slack's public API names or `.test`.

import type {
  SlackActRequest,
  SlackActResult,
  SlackBridgeApi,
  SlackContext,
  SlackInstall,
  SlackInstallResult,
} from "../src/bridge.ts";
import type { Deps } from "../src/deps.ts";
import { signSlackRequest } from "../src/verify.ts";

export const SECRET = "test-signing-secret-not-real";
export const TEAM = "T0TEST0001";
export const USER = "U0USER0001";
export const WORKSPACE = "ws_01JB0000000000000000000000";
/** A made-up bot token: the right shape, no meaning. */
export const BOT_TOKEN = "xoxb-test-token-not-real";
export const RESPONSE_URL = "https://hooks.slack.com/commands/T0TEST0001/1/test";
export const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);

export type SlackCall = { url: string; body: unknown; auth: string | null };

/** A fake Slack: answers `users.info` with `user`, records every call, and lets a test override any method. */
export function fakeSlack(
  options: {
    user?: Record<string, unknown>;
    methods?: Record<string, (body: unknown) => Response>;
  } = {},
) {
  const calls: SlackCall[] = [];
  const user = options.user ?? {
    id: USER,
    deleted: false,
    is_bot: false,
    is_email_confirmed: true,
    locale: "en-US",
    profile: { email: "Ana@Example.com" },
  };
  const fetch = async (request: Request): Promise<Response> => {
    const text = await request.text();
    const body =
      request.headers.get("Content-Type")?.startsWith("application/json") === true
        ? (JSON.parse(text) as unknown)
        : Object.fromEntries(new URLSearchParams(text));
    calls.push({ url: request.url, body, auth: request.headers.get("Authorization") });
    const method = request.url.startsWith("https://slack.com/api/")
      ? request.url.slice("https://slack.com/api/".length)
      : undefined;
    if (method && options.methods?.[method]) return options.methods[method](body);
    if (method === "users.info") return Response.json({ ok: true, user });
    if (method) return Response.json({ ok: true });
    return new Response("ok");
  };
  const replies = () =>
    calls
      .filter((call) => call.url === RESPONSE_URL)
      .map((call) => call.body as Record<string, unknown>);
  const to = (method: string) =>
    calls.filter((call) => call.url === `https://slack.com/api/${method}`);
  return { calls, fetch, replies, to };
}

/** A fake API bridge: connected to `TEAM`, answering `act` with `result` and recording what it was asked. */
export function fakeBridge(
  options: {
    context?: SlackContext | null;
    result?: SlackActResult | ((request: SlackActRequest) => SlackActResult);
    install?: SlackInstallResult;
  } = {},
) {
  const acts: SlackActRequest[] = [];
  const installs: { state: string; install: SlackInstall }[] = [];
  const bridge: SlackBridgeApi = {
    context: async (teamId) =>
      teamId !== TEAM
        ? null
        : options.context === undefined
          ? { workspaceId: WORKSPACE, workspaceName: "Acme", token: BOT_TOKEN, locale: "en" }
          : options.context,
    act: async (request) => {
      acts.push(request);
      const result = options.result ?? {
        ok: true,
        did: request.action.kind === "declare" ? "declared" : "acknowledged",
        incident: { id: "inc_test", number: 7, title: "Checkout down" },
        locale: null,
      };
      return typeof result === "function" ? result(request) : result;
    },
    completeInstall: async (state, install) => {
      installs.push({ state, install });
      return options.install ?? { ok: true };
    },
  };
  return { bridge, acts, installs };
}

/** Deps with the fakes, a fixed clock, and the `waitUntil` work collected so a test can await it. */
export function deps(slack: ReturnType<typeof fakeSlack>, bridge: SlackBridgeApi, now = NOW) {
  const pending: Promise<unknown>[] = [];
  const value: Deps = {
    bridge,
    signingSecret: SECRET,
    clientId: "0000000000.0000000000",
    clientSecret: "test-client-secret-not-real",
    dashboardUrl: "https://brigade.test",
    fetch: slack.fetch,
    now: () => now,
    waitUntil: (promise) => pending.push(promise),
  };
  return { deps: value, settled: () => Promise.all(pending) };
}

/** A slash command as Slack sends it, signed. */
export async function slashCommand(
  text: string,
  fields: Record<string, string> = {},
  at = Math.floor(NOW / 1000),
): Promise<Request> {
  const body = new URLSearchParams({
    team_id: TEAM,
    user_id: USER,
    command: "/inc",
    text,
    response_url: RESPONSE_URL,
    trigger_id: "1000000000.1000000000.test",
    ...fields,
  }).toString();
  return signed("/slack/commands", body, at);
}

/** A button click as Slack sends it, signed. */
export async function click(
  value: string,
  fields: { actionTs?: string; actionId?: string; team?: string } = {},
): Promise<Request> {
  const payload = {
    type: "block_actions",
    team: { id: fields.team ?? TEAM },
    user: { id: USER },
    response_url: RESPONSE_URL,
    actions: [
      {
        action_id: fields.actionId ?? "brigade_ack",
        value,
        type: "button",
        action_ts: fields.actionTs ?? "1790000000.000001",
      },
    ],
  };
  return signed(
    "/slack/interactions",
    new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
    Math.floor(NOW / 1000),
  );
}

async function signed(path: string, body: string, at: number): Promise<Request> {
  return new Request(`https://brigade.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": String(at),
      "X-Slack-Signature": await signSlackRequest(body, SECRET, at),
    },
    body,
  });
}
