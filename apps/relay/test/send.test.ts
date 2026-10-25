import { generateKeyPairSync } from "node:crypto";
import { generateRecipient, sealPush, toBase64url } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";

const env: RelayEnv = {
  APNS_ENVIRONMENT: "sandbox",
  APNS_TOPIC: "app.example",
  APNS_KEY: generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  APNS_KEY_ID: "KEYID12345",
  APNS_TEAM_ID: "TEAMID1234",
  RELAY_SEND_TOKEN: "test-token",
};
const DEVICE_TOKEN = "b".repeat(64);

async function sendBody(overrides: Record<string, unknown> = {}) {
  const recipient = await generateRecipient();
  const envelope = await sealPush(toBase64url(recipient.publicKey), { title: "t", body: "b" });
  return { deviceToken: DEVICE_TOKEN, envelope, urgency: "page", ...overrides };
}

function post(body: unknown, token = "test-token"): Request {
  return new Request("https://relay.test/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Records what would go to APNs and answers like it. */
function fakeApns(status = 200, reason?: string) {
  const sent: Request[] = [];
  const send = async (request: Request) => {
    sent.push(request);
    return new Response(reason ? JSON.stringify({ reason }) : null, {
      status,
      headers: { "apns-id": "11111111-2222-3333-4444-555555555555" },
    });
  };
  return { sent, send };
}

describe("POST /send", () => {
  test("forwards a valid push to APNs and reports its answer", async () => {
    const apns = fakeApns();
    const response = await handle(post(await sendBody()), env, apns.send);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 200,
      apnsId: "11111111-2222-3333-4444-555555555555",
    });
    expect(apns.sent).toHaveLength(1);
    expect(apns.sent[0]?.url).toBe(`https://api.sandbox.push.apple.com/3/device/${DEVICE_TOKEN}`);
    expect(apns.sent[0]?.headers.get("authorization")).toMatch(/^bearer ey/);
  });

  test("an APNs rejection is a 502 with its reason", async () => {
    const response = await handle(
      post(await sendBody()),
      env,
      fakeApns(400, "BadDeviceToken").send,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 400, reason: "BadDeviceToken" });
  });

  test("a network failure is a 502 apns_unreachable", async () => {
    const response = await handle(post(await sendBody()), env, async () => {
      throw new Error("Network connection lost.");
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "apns_unreachable" });
  });

  test("needs the bearer token", async () => {
    const apns = fakeApns();
    for (const request of [
      post(await sendBody(), "wrong"),
      post(await sendBody(), ""),
      new Request("https://relay.test/send", { method: "POST", body: "{}" }),
    ]) {
      expect((await handle(request, env, apns.send)).status).toBe(401);
    }
    expect(
      (await handle(post(await sendBody()), { ...env, RELAY_SEND_TOKEN: "" }, apns.send)).status,
    ).toBe(401);
    expect(apns.sent).toHaveLength(0);
  });

  test("rejects bad bodies without calling APNs", async () => {
    const apns = fakeApns();
    const bodies = [
      "not json",
      [],
      await sendBody({ deviceToken: 1 }),
      await sendBody({ deviceToken: "nothex" }),
      await sendBody({ envelope: { v: 1, enc: "AAAA", ct: "AAAA" } }),
      await sendBody({ urgency: "urgent" }),
      await sendBody({ collapseId: 5 }),
      await sendBody({ pad: "x".repeat(9000) }),
    ];
    for (const body of bodies) {
      expect((await handle(post(body), env, apns.send)).status).toBe(400);
    }
    expect(apns.sent).toHaveLength(0);
  });

  test("other paths and methods", async () => {
    const apns = fakeApns();
    expect((await handle(new Request("https://relay.test/health"), env, apns.send)).status).toBe(
      200,
    );
    expect((await handle(new Request("https://relay.test/send"), env, apns.send)).status).toBe(405);
    expect((await handle(new Request("https://relay.test/other"), env, apns.send)).status).toBe(
      404,
    );
  });
});
