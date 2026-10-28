import { generateKeyPairSync } from "node:crypto";
import { describe, expect, test } from "vite-plus/test";
import { NO_DEVICE_TOKEN } from "../src/deep-health.ts";
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
const serviceAccount = JSON.stringify({
  project_id: "brigade-test",
  private_key_id: "key-1",
  client_email: "relay@example.iam.gserviceaccount.com",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  token_uri: "https://oauth2.example.com/token",
});

const deep = (token: string | null = "test-token") =>
  new Request("https://relay.test/health?deep=1", {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });

/** APNs answering `apns` for the check, Google answering `google`; records every request. */
function providers(
  apns: { status: number; reason?: string },
  google = { status: 200, token: true },
) {
  const sent: Request[] = [];
  const send = async (request: Request) => {
    sent.push(request);
    if (new URL(request.url).hostname.endsWith("apple.com")) {
      return Response.json(apns.reason ? { reason: apns.reason } : {}, { status: apns.status });
    }
    return Response.json(
      google.token ? { access_token: "ya29.x", expires_in: 3599 } : { error: "invalid_grant" },
      { status: google.status },
    );
  };
  return { sent, send };
}

describe("GET /health?deep=1", () => {
  test("only for the send token's holder; the plain /health stays open and says nothing more", async () => {
    const calls = providers({ status: 400, reason: "BadDeviceToken" });
    for (const token of [null, "wrong"]) {
      const response = await handle(deep(token), env, calls.send);
      expect(response.status).toBe(401);
    }
    const plain = await handle(new Request("https://relay.test/health"), env, calls.send);
    expect(await plain.json()).toEqual({ ok: true });
    expect(calls.sent).toEqual([]);
  });

  test("APNs taking the provider token for a device that cannot exist is ok; FCM without its secret is not configured", async () => {
    const calls = providers({ status: 400, reason: "BadDeviceToken" });
    const response = await handle(deep(), env, calls.send);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      apns: { status: "ok" },
      fcm: { status: "not_configured" },
    });
    // One request, to no device: nothing is pushed to anyone.
    expect(calls.sent.map((request) => request.url)).toEqual([
      `https://api.sandbox.push.apple.com/3/device/${NO_DEVICE_TOKEN}`,
    ]);
    expect(calls.sent[0]!.headers.get("authorization")).toMatch(/^bearer ey/);
  });

  test("a revoked APNs key, or APNs not answering, is an error by reason (503)", async () => {
    for (const [answer, reason] of [
      [{ status: 403, reason: "InvalidProviderToken" }, "InvalidProviderToken"],
      [{ status: 403, reason: "ExpiredProviderToken" }, "ExpiredProviderToken"],
      [{ status: 500 }, "status_500"],
    ] as const) {
      const response = await handle(deep(), env, providers(answer).send);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, apns: { status: "error", reason } });
    }
    const down = await handle(deep(), env, async () => {
      throw new Error("connection refused");
    });
    expect(await down.json()).toMatchObject({ apns: { status: "error", reason: "unreachable" } });
    const badKey = await handle(
      deep(),
      { ...env, APNS_KEY: "not a key" },
      providers({ status: 400 }).send,
    );
    expect(await badKey.json()).toMatchObject({ apns: { status: "error", reason: "key_invalid" } });
  });

  test("FCM with a service account asks Google for a fresh access token each time, and says when it refuses", async () => {
    const withFcm = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount };
    const ok = providers({ status: 400, reason: "BadDeviceToken" });
    expect(await (await handle(deep(), withFcm, ok.send)).json()).toEqual({
      ok: true,
      apns: { status: "ok" },
      fcm: { status: "ok" },
    });
    // Not the pages' cached token: a second check asks again.
    await handle(deep(), withFcm, ok.send);
    expect(
      ok.sent.filter((request) => request.url === "https://oauth2.example.com/token"),
    ).toHaveLength(2);
    const google = ok.sent.find((request) => request.url === "https://oauth2.example.com/token")!;
    const form = new URLSearchParams(await google.text());
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);

    const refused = providers(
      { status: 400, reason: "BadDeviceToken" },
      { status: 400, token: false },
    );
    const response = await handle(deep(), withFcm, refused.send);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      fcm: { status: "error", reason: "refused" },
    });
    const broken = await handle(deep(), { ...env, FCM_SERVICE_ACCOUNT: "{" }, ok.send);
    expect(await broken.json()).toMatchObject({
      fcm: { status: "error", reason: "account_invalid" },
    });
  });
});
