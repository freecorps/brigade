import { describe, expect, test } from "vite-plus/test";
import { handle } from "../src/app.ts";
import {
  click,
  deps,
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
    await handle(await slashCommand("resolve 4"), run.deps);
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
