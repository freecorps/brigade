import { generateKeyPairSync } from "node:crypto";
import { generateRecipient, sealPush, toBase64url } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";

const env: RelayEnv = {
  APNS_ENVIRONMENT: "sandbox",
  APNS_TOPIC: "app.freecorps.brigade",
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

  test("a push may name its device's APNs environment; anything but sandbox or production is refused", async () => {
    const apns = fakeApns();
    const response = await handle(
      post(await sendBody({ environment: "production" })),
      env,
      apns.send,
    );
    expect(response.status).toBe(200);
    expect(apns.sent[0]?.url).toBe(`https://api.push.apple.com/3/device/${DEVICE_TOKEN}`);
    const refused = await handle(post(await sendBody({ environment: "staging" })), env, apns.send);
    expect(refused.status).toBe(400);
    expect(apns.sent).toHaveLength(1);
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
      await sendBody({ ttlSeconds: -1 }),
      await sendBody({ ttlSeconds: 1.5 }),
      await sendBody({ ttlSeconds: "60" }),
      await sendBody({ ttlSeconds: 31 * 24 * 60 * 60 }),
      await sendBody({ urgency: "page", ttlSeconds: 0 }),
    ];
    for (const body of bodies) {
      expect((await handle(post(body), env, apns.send)).status).toBe(400);
    }
    expect(apns.sent).toHaveLength(0);
  });

  test("an oversized body without Content-Length is refused", async () => {
    const apns = fakeApns();
    const chunk = new TextEncoder().encode("x".repeat(4096));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("https://relay.test/send", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body,
      duplex: "half",
    } as RequestInit);
    expect((await handle(request, env, apns.send)).status).toBe(400);
    expect(apns.sent).toHaveLength(0);
  });

  test("keeps trying an offline phone for a while, by urgency or as asked", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiration = async (overrides: Record<string, unknown>) => {
      const apns = fakeApns();
      await handle(post(await sendBody(overrides)), env, apns.send);
      return Number(apns.sent[0]?.headers.get("apns-expiration"));
    };
    expect(await expiration({ urgency: "page" })).toBeGreaterThanOrEqual(now + 15 * 60);
    expect(await expiration({ urgency: "page" })).toBeLessThan(now + 15 * 60 + 5);
    const within = async (overrides: Record<string, unknown>, seconds: number) => {
      const value = await expiration(overrides);
      expect(value, JSON.stringify(overrides)).toBeGreaterThanOrEqual(now + seconds);
      expect(value, JSON.stringify(overrides)).toBeLessThan(now + seconds + 5);
    };
    await within({ urgency: "high" }, 60 * 60);
    await within({ urgency: "low" }, 4 * 60 * 60);
    await within({ ttlSeconds: 120 }, 120);
    await within({ ttlSeconds: 30 * 24 * 60 * 60 }, 30 * 24 * 60 * 60);
    expect(await expiration({ urgency: "high", ttlSeconds: 0 })).toBe(0);
  });

  test("a call goes to the VoIP topic as a voip push that only rings for a minute", async () => {
    const apns = fakeApns();
    const callId = "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f";
    const now = Math.floor(Date.now() / 1000);
    const response = await handle(
      post(await sendBody({ kind: "call", callId, urgency: undefined })),
      env,
      apns.send,
    );
    expect(response.status).toBe(200);
    const sent = apns.sent[0];
    expect(sent?.headers.get("apns-topic")).toBe("app.freecorps.brigade.voip");
    expect(sent?.headers.get("apns-push-type")).toBe("voip");
    expect(sent?.headers.get("apns-priority")).toBe("10");
    const expiration = Number(sent?.headers.get("apns-expiration"));
    expect(expiration).toBeGreaterThanOrEqual(now + 60);
    expect(expiration).toBeLessThan(now + 65);
    const payload = (await sent?.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({ call: { id: callId }, brigade: { v: 1 } });
    // No alert: nothing in a call push lets the app skip reporting the call.
    expect(payload.aps).toBeUndefined();
  });

  test("never sends a call the app could not ring for", async () => {
    const apns = fakeApns();
    const callId = "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f";
    const bodies = [
      await sendBody({ kind: "call" }),
      await sendBody({ kind: "call", callId: "not-a-uuid" }),
      await sendBody({ kind: "call", callId: callId.toUpperCase() }),
      await sendBody({ kind: "call", callId, urgency: "high" }),
      await sendBody({ kind: "call", callId, urgency: "low" }),
      await sendBody({ kind: "call", callId, ttlSeconds: 0 }),
      await sendBody({ kind: "call", callId, ttlSeconds: 301 }),
      await sendBody({ kind: "alert", callId }),
      await sendBody({ kind: "voip", callId }),
    ];
    for (const body of bodies) {
      expect((await handle(post(body), env, apns.send)).status, JSON.stringify(body)).toBe(400);
    }
    expect(apns.sent).toHaveLength(0);
  });

  test("an alert is still the default", async () => {
    const apns = fakeApns();
    await handle(post(await sendBody()), env, apns.send);
    expect(apns.sent[0]?.headers.get("apns-topic")).toBe("app.freecorps.brigade");
    expect(apns.sent[0]?.headers.get("apns-push-type")).toBe("alert");
  });

  test("a broken APNs key is the relay's error, not the caller's", async () => {
    const apns = fakeApns();
    const response = await handle(post(await sendBody()), { ...env, APNS_KEY: "nope" }, apns.send);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "relay_misconfigured" });
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
