import { describe, expect, test } from "vite-plus/test";
import { handle } from "../src/app.ts";
import {
  click,
  deps,
  interact,
  slackEvent,
  fakeBridge,
  fakeSlack,
  NOW,
  refusal,
  RESPONSE_URL,
  slashCommand,
  TEAM,
  USER,
} from "./fakes.ts";

describe("POST /slack/commands", () => {
  test("answers at once with an empty 200 and declares through the bridge as the Slack user", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const response = await handle(await slashCommand("declare Checkout down sev1"), run.deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    // Nothing ran before the answer: the work is in waitUntil.
    expect(acts).toHaveLength(0);
    await run.settled();
    expect(acts).toEqual([
      {
        teamId: TEAM,
        slackUserId: USER,
        action: { kind: "declare", title: "Checkout down", severity: "sev1" },
        key: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    // The bridge asks Slack who the user is, with the token it keeps: this Worker calls no Web API and sends no token.
    expect(slack.calls.map((call) => call.url)).toEqual([RESPONSE_URL]);
    expect(slack.calls.every((call) => call.auth === null)).toBe(true);
    expect(slack.replies()).toEqual([
      {
        response_type: "ephemeral",
        replace_original: false,
        text: "Declared INC-7: Checkout down",
      },
    ]);
  });

  test("refuses an unsigned or stale request before anything runs", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const unsigned = new Request("https://brigade.test/slack/commands", {
      method: "POST",
      body: "team_id=T0TEST0001",
    });
    expect((await handle(unsigned, run.deps)).status).toBe(401);
    const stale = await slashCommand("declare Old", {}, Math.floor(NOW / 1000) - 400);
    expect((await handle(stale, run.deps)).status).toBe(401);
    await run.settled();
    expect(acts).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  test("a replayed command carries the same key, so the shard runs it once", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare Checkout down"), run.deps);
    await handle(await slashCommand("declare Checkout down"), run.deps);
    await handle(
      await slashCommand("declare Checkout down", { trigger_id: "another.trigger" }),
      run.deps,
    );
    await run.settled();
    expect(acts[0]!.key).toBe(acts[1]!.key);
    expect(acts[2]!.key).not.toBe(acts[0]!.key);
  });

  test("an unmapped user is told so, and nothing else happens", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("unmapped") });
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare Checkout down"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toBe(
      "Your Slack email isn't the confirmed email of a member of Acme in Brigade, so Brigade can't act for you. Use the same email in both and confirm it in Brigade, or ask an owner to add you.",
    );
  });

  test("a user Slack does not vouch for (unconfirmed email, a guest from another team) is told so", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("unconfirmed") });
    const run = deps(slack, bridge);
    await handle(await slashCommand("ack"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toContain("hasn't confirmed your email");
  });

  test("a connection whose token no longer opens says to reconnect, not that Slack is not connected", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("unreadable", { workspaceName: "" }) });
    const run = deps(slack, bridge);
    await handle(await slashCommand("ack"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toContain("needs to connect Slack again");
    expect(slack.replies()[0]?.text).not.toContain("isn't connected");
  });

  test("a viewer is refused by the shard and told why", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("forbidden") });
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare Checkout down"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toBe(
      "Your role in Acme can't do that. Ask an owner or admin.",
    );
  });

  test("answers in the language the bridge chose", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({
      result: refusal("already", {
        locale: "pt-BR",
        incident: { id: "inc_x", number: 3, title: "x" },
      }),
    });
    const run = deps(slack, bridge);
    await handle(await slashCommand("ack 3"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toBe("INC-3 já foi confirmado.");

    const ptSlack = fakeSlack();
    const none = fakeBridge({ result: refusal("none", { locale: "pt-BR" }) });
    const ptRun = deps(ptSlack, none.bridge);
    await handle(await slashCommand("ack"), ptRun.deps);
    await ptRun.settled();
    expect(ptSlack.replies()[0]?.text).toBe("Nenhum incidente ativo está esperando confirmação.");
  });

  test("ack with several waiting lists them", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge({
      result: refusal("ambiguous", { choices: [4, 9] }),
    });
    const run = deps(slack, bridge);
    await handle(await slashCommand("ack"), run.deps);
    await run.settled();
    expect(acts[0]?.action).toEqual({ kind: "ack" });
    expect(slack.replies()[0]?.text).toBe(
      "More than one incident is waiting to be acknowledged: INC-4, INC-9. Say which one, for example /inc ack INC-4.",
    );
  });

  test("titles in replies are escaped: no mentions, no links", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({
      result: {
        ok: true,
        did: "declared",
        incident: { id: "inc_x", number: 8, title: "<!channel> & <https://evil.test|click>" },
        workspaceName: "Acme",
        locale: "en",
      },
    });
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare whatever"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toBe(
      "Declared INC-8: &lt;!channel&gt; &amp; &lt;https://evil.test|click&gt;",
    );
  });

  test("help and unknown subcommands get the usage, in the language the bridge finds for the user", async () => {
    const slack = fakeSlack();
    const { bridge, acts, locales } = fakeBridge();
    const run = deps(slack, bridge);
    await handle(await slashCommand(""), run.deps);
    await handle(await slashCommand("status 4"), run.deps);
    await run.settled();
    expect(acts).toHaveLength(0);
    expect(locales).toEqual([
      { teamId: TEAM, slackUserId: USER },
      { teamId: TEAM, slackUserId: USER },
    ]);
    const [help, unknown] = slack.replies();
    expect(help?.text).toMatch(/^Declare an incident: \/inc declare/);
    expect(unknown?.text).toMatch(/^Unknown command\. Declare an incident/);

    const pt = fakeSlack();
    const ptRun = deps(pt, fakeBridge({ locale: "pt-BR" }).bridge);
    await handle(await slashCommand(""), ptRun.deps);
    await ptRun.settled();
    expect(pt.replies()[0]?.text).toMatch(/^Declarar um incidente: \/inc declare/);
  });

  test("a team not connected to Brigade is told so", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("not_connected", { workspaceName: "" }) });
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare Checkout down"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toContain("isn't connected to Brigade");
  });

  test("never posts to a response URL that is not Slack's", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const response = await handle(
      await slashCommand("declare x", { response_url: "https://evil.test/hook" }),
      run.deps,
    );
    expect(response.status).toBe(400);
    await run.settled();
    expect(acts).toHaveLength(0);
    expect(slack.calls).toHaveLength(0);
  });

  test("answers Slack's certificate check", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge();
    const run = deps(slack, bridge);
    const response = await handle(await slashCommand("", { ssl_check: "1" }), run.deps);
    expect(response.status).toBe(200);
  });
});

describe("POST /slack/interactions", () => {
  test("the Acknowledge button acknowledges that incident as the Slack user", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const id = "inc_01JB0000000000000000000000";
    const response = await handle(await click(id), run.deps);
    expect(response.status).toBe(200);
    await run.settled();
    expect(acts).toEqual([
      {
        teamId: TEAM,
        slackUserId: USER,
        action: { kind: "ack", incidentId: id },
        key: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    expect(slack.calls.find((call) => call.url === RESPONSE_URL)?.body).toMatchObject({
      response_type: "ephemeral",
      replace_original: false,
      text: "Acknowledged INC-7: Checkout down. Paging has stopped.",
    });
  });

  test("the same click twice is one key; the link button and other ids are ignored", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const id = "inc_01JB0000000000000000000000";
    await handle(await click(id), run.deps);
    await handle(await click(id), run.deps);
    await handle(await click(id, { actionId: "brigade_open" }), run.deps);
    await handle(await click("not-an-incident"), run.deps);
    await run.settled();
    expect(acts).toHaveLength(2);
    expect(acts[0]!.key).toBe(acts[1]!.key);
  });
});

describe("the subcommands beyond declare and ack", () => {
  test("run through the bridge with the channel they were typed in, and answer in words", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge({
      result: (request) => ({
        ok: true,
        did:
          request.action.kind === "update"
            ? "updated"
            : request.action.kind === "severity"
              ? "severity"
              : request.action.kind === "role"
                ? "role"
                : request.action.kind === "resolve"
                  ? "resolved"
                  : "escalated",
        incident: { id: "inc_x", number: 12, title: "Checkout down" },
        severity: "sev1",
        role: { id: "commander", name: null },
        workspaceName: "Acme",
        locale: "en",
      }),
    });
    const run = deps(slack, bridge);
    const channel = { channel_id: "C0INC00012" };
    for (const text of [
      "update Rolled back &amp; watching",
      "sev 1",
      "role commander <@U0USER0002|bia>",
      "resolve",
      "escalate INC-12",
    ]) {
      await handle(await slashCommand(text, channel), run.deps);
    }
    await run.settled();
    expect(acts.map((act) => act.action)).toEqual([
      { kind: "update", body: "Rolled back & watching", channelId: "C0INC00012" },
      { kind: "severity", severity: "sev1", channelId: "C0INC00012" },
      { kind: "role", role: "commander", user: "U0USER0002", channelId: "C0INC00012" },
      { kind: "resolve", channelId: "C0INC00012" },
      { kind: "escalate", channelId: "C0INC00012", number: 12 },
    ]);
    expect(slack.replies().map((reply) => reply.text)).toEqual([
      "Posted to INC-12's timeline.",
      "INC-12 is now SEV1 · Critical.",
      "<@U0USER0002> is now the incident commander of INC-12.",
      "Resolved INC-12: Checkout down",
      "Paged the next level of INC-12 now.",
    ]);
  });

  test("several active incidents: the answer says which subcommand to repeat with a number", async () => {
    const slack = fakeSlack();
    const { bridge } = fakeBridge({ result: refusal("which", { choices: [3, 5] }) });
    const run = deps(slack, bridge);
    await handle(await slashCommand("sev 2"), run.deps);
    await run.settled();
    expect(slack.replies()[0]?.text).toBe(
      "More than one incident is active: INC-3, INC-5. Say which one, for example /inc sev INC-3.",
    );
  });

  test("an escalation someone just paged, and a form whose picks are gone, are worded so", async () => {
    const slack = fakeSlack();
    let call = 0;
    const { bridge } = fakeBridge({
      result: () =>
        ++call === 1
          ? refusal("just_paged", {
              incident: { id: "inc_x", number: 12, title: "Checkout down" },
              level: 2,
            })
          : {
              ok: true,
              did: "declared",
              dropped: true,
              incident: { id: "inc_x", number: 7, title: "Checkout down" },
              workspaceName: "Acme",
              locale: "en",
            },
    });
    const run = deps(slack, bridge);
    await handle(await slashCommand("escalate INC-12"), run.deps);
    await run.settled();
    await handle(await slashCommand("declare Checkout down", { trigger_id: "t.2" }), run.deps);
    await run.settled();
    expect(slack.replies().map((reply) => reply.text)).toEqual([
      "Level 2 of INC-12 was paged just now, so Brigade didn't page the next one too. Wait a moment, or run /inc escalate again if nobody answers.",
      "Declared INC-7: Checkout down\nThe incident type or a service you picked no longer exists, so it was declared without it. Set them from the dashboard.",
    ]);
  });

  test("/inc declare alone opens the form through the bridge, and says so when it cannot", async () => {
    const slack = fakeSlack();
    const { bridge, opens, acts } = fakeBridge({
      open: { ok: false, code: "failed", locale: "en", workspaceName: "Acme" },
    });
    const run = deps(slack, bridge);
    await handle(await slashCommand("declare sev2"), run.deps);
    await run.settled();
    expect(acts).toHaveLength(0);
    expect(opens).toEqual([
      {
        teamId: TEAM,
        slackUserId: USER,
        triggerId: "1000000000.1000000000.test",
        responseUrl: RESPONSE_URL,
        severity: "sev2",
      },
    ]);
    expect(slack.replies()[0]?.text).toMatch(/^Brigade couldn't open the form/);
  });
});

describe("POST /slack/interactions: the form and the shortcut", () => {
  const view = (more: Record<string, unknown> = {}) => ({
    id: "V0VIEW0001",
    callback_id: "brigade_declare",
    private_metadata: JSON.stringify({ responseUrl: RESPONSE_URL }),
    state: {
      values: {
        title: { value: { type: "plain_text_input", value: "  Checkout down  " } },
        severity: { value: { selected_option: { value: "sev2" } } },
        type: { value: { selected_option: { value: "typ_01JB0000000000000000000000" } } },
        services: {
          value: {
            selected_options: [{ value: "svc_01JB0000000000000000000000" }, { value: "nope" }],
          },
        },
      },
    },
    ...more,
  });

  test("a submitted form declares once with what it holds, and answers through the command's URL", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const payload = {
      type: "view_submission",
      team: { id: TEAM },
      user: { id: USER },
      view: view(),
    };
    const response = await handle(await interact(payload), run.deps);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    await handle(await interact(payload), run.deps);
    await run.settled();
    expect(acts.map((act) => act.action)).toEqual([
      {
        kind: "declare",
        title: "Checkout down",
        severity: "sev2",
        typeId: "typ_01JB0000000000000000000000",
        serviceIds: ["svc_01JB0000000000000000000000"],
      },
      expect.anything(),
    ]);
    // The same form twice is the same key: the shard declares once.
    expect(acts[0]?.key).toBe(acts[1]?.key);
    expect(slack.replies()[0]?.text).toBe("Declared INC-7: Checkout down");
  });

  test("a form whose metadata points anywhere but Slack answers nobody", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const payload = {
      type: "view_submission",
      team: { id: TEAM },
      user: { id: USER },
      view: view({ private_metadata: JSON.stringify({ responseUrl: "https://evil.test/x" }) }),
    };
    await handle(await interact(payload), run.deps);
    await run.settled();
    expect(acts).toHaveLength(1);
    expect(slack.calls).toHaveLength(0);
  });

  test("the message shortcut posts the message as an update from its channel, keyed like `!update` on it", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge({
      result: {
        ok: true,
        did: "updated",
        incident: { id: "inc_x", number: 12, title: "Checkout down" },
        workspaceName: "Acme",
        locale: "en",
      },
    });
    const run = deps(slack, bridge);
    const payload = {
      type: "message_action",
      callback_id: "brigade_post_update",
      team: { id: TEAM },
      user: { id: USER },
      channel: { id: "C0INC00012" },
      response_url: RESPONSE_URL,
      message: {
        ts: "1790000000.000100",
        user: USER,
        text: "DB failover done <@U0USER0002|bia>",
      },
    };
    await handle(await interact(payload), run.deps);
    // The same message as `!update`: the shard sees one key for both, so it is one update.
    await handle(
      await slackEvent({
        type: "event_callback",
        team_id: TEAM,
        event: {
          type: "message",
          channel: "C0INC00012",
          user: USER,
          ts: "1790000000.000100",
          text: "!update DB failover done",
        },
      }),
      run.deps,
    );
    await run.settled();
    expect(acts[0]?.action).toEqual({
      kind: "update",
      body: "DB failover done @bia",
      fromMessage: true,
      channelId: "C0INC00012",
    });
    expect(acts[0]?.key).toBe(acts[1]?.key);
    expect(slack.replies()[0]?.text).toBe("Posted to INC-12's timeline.");
  });

  test("the shortcut on someone else's message, an app's or a bot's posts nothing in the clicker's name", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge({ locale: "pt-BR" });
    const run = deps(slack, bridge);
    const payload = (message: Record<string, unknown>) => ({
      type: "message_action",
      callback_id: "brigade_post_update",
      team: { id: TEAM },
      user: { id: USER },
      channel: { id: "C0INC00012" },
      response_url: RESPONSE_URL,
      message: { ts: "1790000000.000100", text: "Rolled back", ...message },
    });
    await handle(await interact(payload({ user: "U0USER0002" })), run.deps);
    await handle(await interact(payload({ bot_id: "B0BOT00001" })), run.deps);
    await handle(await interact(payload({ user: USER, bot_id: "B0BOT00001" })), run.deps);
    await handle(await interact(payload({ user: USER, app_id: "A0APP00001" })), run.deps);
    await handle(await interact(payload({ user: USER, subtype: "bot_message" })), run.deps);
    await run.settled();
    expect(acts).toHaveLength(0);
    const replies = slack.replies();
    expect(replies).toHaveLength(5);
    // Told why, in their language.
    expect(replies[0]?.text).toContain("suas próprias mensagens");
  });
});

describe("POST /slack/events", () => {
  test("answers Slack's URL check with the challenge, and only when signed", async () => {
    const slack = fakeSlack();
    const run = deps(slack, fakeBridge().bridge);
    const response = await handle(
      await slackEvent({ type: "url_verification", challenge: "challenge-value" }),
      run.deps,
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("challenge-value");
    const unsigned = new Request("https://brigade.test/slack/events", {
      method: "POST",
      body: JSON.stringify({ type: "url_verification", challenge: "x" }),
    });
    expect((await handle(unsigned, run.deps)).status).toBe(401);
  });

  test("app_uninstalled and the bot's tokens_revoked mark the team revoked; a user token's does not", async () => {
    const slack = fakeSlack();
    const { bridge, revocations } = fakeBridge();
    const run = deps(slack, bridge);
    const callback = (event: Record<string, unknown>) =>
      slackEvent({ type: "event_callback", team_id: TEAM, event_id: "Ev0001", event });
    await handle(await callback({ type: "app_uninstalled" }), run.deps);
    await handle(
      await callback({ type: "tokens_revoked", tokens: { bot: ["U0BOT00001"] } }),
      run.deps,
    );
    await handle(
      await callback({ type: "tokens_revoked", tokens: { oauth: ["U0USER0001"] } }),
      run.deps,
    );
    await run.settled();
    expect(revocations).toEqual([
      { teamId: TEAM, reason: "uninstalled" },
      { teamId: TEAM, reason: "tokens_revoked", botUserIds: ["U0BOT00001"] },
    ]);
  });

  test("`!update` in a channel is an update as its author, answered by the API in the channel", async () => {
    const slack = fakeSlack();
    const { bridge, acts } = fakeBridge();
    const run = deps(slack, bridge);
    const message = (more: Record<string, unknown>) =>
      slackEvent({
        type: "event_callback",
        team_id: TEAM,
        event_id: "Ev0002",
        event: {
          type: "message",
          channel: "C0INC00012",
          user: USER,
          ts: "1790000000.000200",
          text: "!update Traffic is back &gt; 90%",
          ...more,
        },
      });
    await handle(await message({}), run.deps);
    // Not an update: other messages, edits, bots' messages.
    await handle(await message({ text: "looking into it" }), run.deps);
    await handle(await message({ subtype: "message_changed" }), run.deps);
    await handle(await message({ bot_id: "B0BOT00001" }), run.deps);
    await run.settled();
    expect(acts).toEqual([
      {
        teamId: TEAM,
        slackUserId: USER,
        action: {
          kind: "update",
          body: "Traffic is back > 90%",
          fromMessage: true,
          channelId: "C0INC00012",
        },
        key: expect.stringMatching(/^[0-9a-f]{64}$/),
        answer: { channelId: "C0INC00012" },
      },
    ]);
    // The Worker has no response_url for an event: it posts nothing itself.
    expect(slack.calls).toHaveLength(0);
  });
});
