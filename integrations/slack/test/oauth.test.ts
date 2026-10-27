import { describe, expect, test } from "vite-plus/test";
import { handle } from "../src/app.ts";
import { BOT_SCOPES, STATE_COOKIE } from "../src/oauth.ts";
import { BOT_TOKEN, deps, fakeBridge, fakeSlack, TEAM, WORKSPACE } from "./fakes.ts";

const STATE = `${WORKSPACE}.${"a".repeat(43)}`;
const OTHER_STATE = `${WORKSPACE}.${"b".repeat(43)}`;

const install = (state = STATE) =>
  new Request(`https://brigade.test/slack/install?state=${encodeURIComponent(state)}`);
const callback = (query: string, cookie: string | null = STATE) =>
  new Request(`https://brigade.test/slack/oauth/callback?${query}`, {
    headers: cookie === null ? {} : { Cookie: `theme=dark; ${STATE_COOKIE}=${cookie}` },
  });

const granted =
  (overrides: Record<string, unknown> = {}) =>
  () =>
    Response.json({
      ok: true,
      access_token: BOT_TOKEN,
      token_type: "bot",
      scope: BOT_SCOPES.join(","),
      bot_user_id: "U0BOT00001",
      app_id: "A0APP00001",
      team: { id: TEAM, name: "Acme Slack" },
      enterprise: null,
      is_enterprise_install: false,
      ...overrides,
    });

const location = (response: Response) => new URL(response.headers.get("Location") ?? "");

describe("GET /slack/install", () => {
  test("sends the browser to Slack with the state, the bot scopes and the callback", async () => {
    const { deps: d } = deps(fakeSlack(), fakeBridge().bridge);
    const response = await handle(install(), d);
    expect(response.status).toBe(302);
    const url = location(response);
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(url.searchParams.get("state")).toBe(STATE);
    expect(url.searchParams.get("scope")).toBe(
      "commands,chat:write,chat:write.public,users:read,users:read.email,channels:read,groups:read," +
        "channels:manage,groups:write,channels:history,groups:history",
    );
    expect(url.searchParams.get("redirect_uri")).toBe("https://brigade.test/slack/oauth/callback");
    expect(url.searchParams.get("user_scope")).toBeNull();
  });

  test("a state that is not one of the API's goes back to the dashboard", async () => {
    const { deps: d } = deps(fakeSlack(), fakeBridge().bridge);
    const response = await handle(install("ws_x.y"), d);
    expect(location(response).searchParams.get("slack")).toBe("failed");
  });
});

describe("GET /slack/oauth/callback", () => {
  test("exchanges the code and connects the team through the bridge, clearing the cookie", async () => {
    const slack = fakeSlack({ methods: { "oauth.v2.access": granted() } });
    const { bridge, installs } = fakeBridge();
    const { deps: d } = deps(slack, bridge);
    const response = await handle(callback(`code=test-code&state=${STATE}`), d);
    expect(location(response).href).toBe("https://brigade.test/?slack=connected");
    expect(response.headers.get("Set-Cookie")).toContain(
      `${STATE_COOKIE}=; Path=/slack/oauth; Max-Age=0`,
    );
    expect(slack.to("oauth.v2.access")[0]?.body).toEqual({
      client_id: "0000000000.0000000000",
      client_secret: "test-client-secret-not-real",
      code: "test-code",
      redirect_uri: "https://brigade.test/slack/oauth/callback",
    });
    expect(installs).toEqual([
      {
        state: STATE,
        install: {
          teamId: TEAM,
          teamName: "Acme Slack",
          botUserId: "U0BOT00001",
          token: BOT_TOKEN,
          scopes: [...BOT_SCOPES],
        },
      },
    ]);
  });

  test("CSRF: without the cookie, or with another install's, nothing is exchanged", async () => {
    for (const cookie of [null, OTHER_STATE, ""]) {
      const slack = fakeSlack({ methods: { "oauth.v2.access": granted() } });
      const { bridge, installs } = fakeBridge();
      const { deps: d } = deps(slack, bridge);
      const response = await handle(callback(`code=test-code&state=${STATE}`, cookie), d);
      expect(location(response).searchParams.get("slack"), String(cookie)).toBe("failed");
      expect(slack.calls).toHaveLength(0);
      expect(installs).toHaveLength(0);
    }
  });

  test("cancelling on Slack's page comes back as cancelled", async () => {
    const slack = fakeSlack();
    const { deps: d } = deps(slack, fakeBridge().bridge);
    const response = await handle(callback(`error=access_denied&state=${STATE}`), d);
    expect(location(response).searchParams.get("slack")).toBe("cancelled");
    expect(slack.calls).toHaveLength(0);
  });

  test("a refusal from the API (state used, team taken) gives the token back to Slack when the API allows it", async () => {
    for (const code of ["invalid_state", "team_taken", "forbidden"] as const) {
      const slack = fakeSlack({ methods: { "oauth.v2.access": granted() } });
      const { bridge } = fakeBridge({ install: { ok: false, code, revoke: true } });
      const { deps: d } = deps(slack, bridge);
      const response = await handle(callback(`code=test-code&state=${STATE}`), d);
      expect(location(response).searchParams.get("slack")).toBe(code);
      expect(slack.to("auth.revoke")[0]?.auth).toBe(`Bearer ${BOT_TOKEN}`);
    }
  });

  test("a token a workspace still holds is never revoked: the holder would lose Slack", async () => {
    // Slack can answer a reinstall with the bot token the team already has; the API checked and said keep it.
    for (const code of ["invalid_state", "team_taken"] as const) {
      const slack = fakeSlack({ methods: { "oauth.v2.access": granted() } });
      const { bridge } = fakeBridge({ install: { ok: false, code, revoke: false } });
      const { deps: d } = deps(slack, bridge);
      const response = await handle(callback(`code=test-code&state=${STATE}`), d);
      expect(location(response).searchParams.get("slack")).toBe(code);
      expect(slack.to("auth.revoke")).toHaveLength(0);
    }
  });

  test("when the API fails the token is kept too: it may be held", async () => {
    const slack = fakeSlack({ methods: { "oauth.v2.access": granted() } });
    const { bridge } = fakeBridge();
    bridge.completeInstall = () => Promise.reject(new Error("binding down"));
    const { deps: d } = deps(slack, bridge);
    const response = await handle(callback(`code=test-code&state=${STATE}`), d);
    expect(location(response).searchParams.get("slack")).toBe("failed");
    expect(slack.to("auth.revoke")).toHaveLength(0);
  });

  test("an Enterprise Grid org install, or a user token, is refused and revoked", async () => {
    for (const overrides of [
      { is_enterprise_install: true, team: null },
      { token_type: "user", access_token: "xoxp-test-not-real" },
    ]) {
      const slack = fakeSlack({ methods: { "oauth.v2.access": granted(overrides) } });
      const { bridge, installs } = fakeBridge();
      const { deps: d } = deps(slack, bridge);
      const response = await handle(callback(`code=test-code&state=${STATE}`), d);
      expect(location(response).searchParams.get("slack")).toBe("failed");
      expect(installs).toHaveLength(0);
      expect(slack.to("auth.revoke")).toHaveLength(1);
    }
  });

  test("a code Slack refuses goes back as failed", async () => {
    const slack = fakeSlack({
      methods: { "oauth.v2.access": () => Response.json({ ok: false, error: "invalid_code" }) },
    });
    const { bridge, installs } = fakeBridge();
    const { deps: d } = deps(slack, bridge);
    const response = await handle(callback(`code=old&state=${STATE}`), d);
    expect(location(response).searchParams.get("slack")).toBe("failed");
    expect(installs).toHaveLength(0);
  });
});
