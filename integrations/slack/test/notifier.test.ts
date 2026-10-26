import { describe, expect, test } from "vite-plus/test";
import {
  deliverIncidentMessage,
  incidentMessage,
  type SlackIncidentView,
} from "../src/notifier.ts";
import { BOT_TOKEN, fakeSlack } from "./fakes.ts";

const incident: SlackIncidentView = {
  id: "inc_01JB0000000000000000000000",
  number: 12,
  title: "Checkout <!here> & payments down",
  severity: "sev1",
  status: "triage",
  awaitingAck: true,
  declaredBy: { kind: "member", name: "Ana <Ops>" },
  acknowledgedBy: null,
};

const texts = (blocks: Record<string, unknown>[]) => JSON.stringify(blocks);

describe("incidentMessage", () => {
  test("links the incident, escapes its title and names, and offers Acknowledge while it waits", () => {
    const message = incidentMessage(incident, "en", "https://brigade.test");
    expect(message.text).toBe("SEV1 · INC-12: Checkout <!here> & payments down (Triage)");
    expect(message.blocks[0]).toEqual({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*SEV1 · <https://brigade.test/incidents/12|INC-12>*\nCheckout &lt;!here&gt; &amp; payments down",
      },
    });
    expect(texts(message.blocks)).toContain("Declared by Ana &lt;Ops&gt;");
    expect(texts(message.blocks)).toContain("Nobody has acknowledged it yet");
    const actions = message.blocks.at(-1) as { elements: Record<string, unknown>[] };
    expect(actions.elements.map((element) => element.action_id)).toEqual([
      "brigade_ack",
      "brigade_open",
    ]);
    expect(actions.elements[0]).toMatchObject({
      value: incident.id,
      text: { text: "Acknowledge" },
    });
  });

  test("drops the button once acknowledged and says who did, in the connection's language", () => {
    const message = incidentMessage(
      {
        ...incident,
        status: "investigating",
        awaitingAck: false,
        acknowledgedBy: { kind: "member", name: "Caio" },
        declaredBy: { kind: "monitors" },
      },
      "pt-BR",
    );
    expect(texts(message.blocks)).not.toContain("brigade_ack");
    expect(texts(message.blocks)).toContain("Confirmado por Caio");
    expect(texts(message.blocks)).toContain("Declarado por Monitores do Brigade");
    expect(texts(message.blocks)).toContain("*Crítica* · Investigando");
    // No dashboard origin: no link, no buttons at all.
    expect(message.blocks.some((block) => block.type === "actions")).toBe(false);
  });
});

describe("deliverIncidentMessage", () => {
  const message = incidentMessage(incident, "en");

  test("posts a new message and returns its ts", async () => {
    const slack = fakeSlack({
      methods: { "chat.postMessage": () => Response.json({ ok: true, ts: "1790000000.000100" }) },
    });
    const outcome = await deliverIncidentMessage({
      token: BOT_TOKEN,
      channel: "C0CHAN0001",
      ts: null,
      message,
      fetch: slack.fetch,
    });
    expect(outcome).toEqual({ ok: true, channel: "C0CHAN0001", ts: "1790000000.000100" });
    expect(slack.to("chat.postMessage")[0]).toMatchObject({
      auth: `Bearer ${BOT_TOKEN}`,
      body: { channel: "C0CHAN0001", text: message.text, blocks: message.blocks },
    });
  });

  test("updates the message it posted before", async () => {
    const slack = fakeSlack();
    const outcome = await deliverIncidentMessage({
      token: BOT_TOKEN,
      channel: "C0CHAN0001",
      ts: "1790000000.000100",
      message,
      fetch: slack.fetch,
    });
    expect(outcome).toEqual({ ok: true, channel: "C0CHAN0001", ts: "1790000000.000100" });
    expect(slack.to("chat.update")[0]?.body).toMatchObject({ ts: "1790000000.000100" });
    expect(slack.to("chat.postMessage")).toHaveLength(0);
  });

  test("a message deleted in Slack is posted again", async () => {
    const slack = fakeSlack({
      methods: {
        "chat.update": () => Response.json({ ok: false, error: "message_not_found" }),
        "chat.postMessage": () => Response.json({ ok: true, ts: "1790000000.000200" }),
      },
    });
    const outcome = await deliverIncidentMessage({
      token: BOT_TOKEN,
      channel: "C0CHAN0001",
      ts: "1790000000.000100",
      message,
      fetch: slack.fetch,
    });
    expect(outcome).toEqual({ ok: true, channel: "C0CHAN0001", ts: "1790000000.000200" });
  });

  test("429: retry after Slack's Retry-After", async () => {
    const slack = fakeSlack({
      methods: {
        "chat.postMessage": () =>
          new Response("", { status: 429, headers: { "Retry-After": "30" } }),
      },
    });
    const outcome = await deliverIncidentMessage({
      token: BOT_TOKEN,
      channel: "C0CHAN0001",
      ts: null,
      message,
      fetch: slack.fetch,
    });
    expect(outcome).toEqual({
      ok: false,
      error: "ratelimited",
      retryable: true,
      retryAfterMs: 30_000,
      reason: "rate_limited",
    });
  });

  test("5xx and network failures may pass; a missing channel or a revoked token will not", async () => {
    const cases: [() => Response | Promise<Response>, Record<string, unknown>][] = [
      [() => new Response("", { status: 503 }), { retryable: true, reason: "undelivered" }],
      [
        () => Promise.reject(new TypeError("network down")),
        { retryable: true, error: "unreachable" },
      ],
      [
        () => Response.json({ ok: false, error: "channel_not_found" }),
        { retryable: false, reason: "no_channel" },
      ],
      [
        () => Response.json({ ok: false, error: "token_revoked" }),
        { retryable: false, reason: "not_authorized" },
      ],
      [
        () => Response.json({ ok: false, error: "internal_error" }),
        { retryable: true, reason: "undelivered" },
      ],
    ];
    for (const [answer, expected] of cases) {
      const slack = fakeSlack({ methods: { "chat.postMessage": answer as () => Response } });
      const outcome = await deliverIncidentMessage({
        token: BOT_TOKEN,
        channel: "C0CHAN0001",
        ts: null,
        message,
        fetch: slack.fetch,
      });
      expect(outcome).toMatchObject({ ok: false, ...expected });
    }
  });
});
