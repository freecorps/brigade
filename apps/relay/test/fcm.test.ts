import { createVerify, generateKeyPairSync } from "node:crypto";
import { fromBase64url, generateRecipient, sealPush, toBase64url } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import {
  ACCESS_TOKEN_MARGIN_MS,
  buildFcmRequest,
  FCM_SCOPE,
  fcmData,
  GoogleTokenCache,
  parseFcmError,
  parseServiceAccount,
  signGoogleAssertion,
} from "../src/fcm.ts";
import { handle, type RelayEnv } from "../src/index.ts";
import { hang } from "./hang.ts";

// A throwaway RSA key in a service account's shape; never a real one. example.com, not Google's domains.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TOKEN_URI = "https://oauth2.example.com/token";
const serviceAccount = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    project_id: "brigade-test",
    private_key_id: "key-1",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    client_email: "relay@brigade-test.example.com",
    token_uri: TOKEN_URI,
    ...overrides,
  });
const account = parseServiceAccount(serviceAccount());

const env: RelayEnv = {
  APNS_ENVIRONMENT: "sandbox",
  APNS_TOPIC: "app.freecorps.brigade",
  APNS_KEY: "",
  APNS_KEY_ID: "KEYID12345",
  APNS_TEAM_ID: "TEAMID1234",
  RELAY_SEND_TOKEN: "test-token",
  FCM_SERVICE_ACCOUNT: serviceAccount(),
};
const FCM_TOKEN = "fcm-token_ABC:" + "x".repeat(140);
const CALL_ID = "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f";

async function envelope() {
  const recipient = await generateRecipient();
  return sealPush(toBase64url(recipient.publicKey), {
    title: "SEV1 · INC-1",
    body: "Checkout down",
  });
}

async function sendBody(overrides: Record<string, unknown> = {}) {
  return {
    platform: "android",
    deviceToken: FCM_TOKEN,
    envelope: await envelope(),
    urgency: "page",
    ...overrides,
  };
}

function post(body: unknown): Request {
  return new Request("https://relay.test/send", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * A fake Google token endpoint and a fake FCM: the token endpoint hands out `access-<n>`, FCM answers with
 * `fcm(request)` (200 by default).
 */
function fakeGoogle(
  fcm: (request: Request, count: number) => Response | Promise<Response> = () =>
    Response.json({ name: "projects/brigade-test/messages/0:123" }),
  tokenEndpoint: () => Response = () => Response.json({ access_token: "", expires_in: 3599 }),
) {
  const tokenRequests: Request[] = [];
  const fcmRequests: Request[] = [];
  const send = async (request: Request) => {
    if (request.url === TOKEN_URI) {
      tokenRequests.push(request);
      const answer = tokenEndpoint();
      if (!answer.ok) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return Response.json({ ...body, access_token: `access-${tokenRequests.length}` });
    }
    fcmRequests.push(request);
    return fcm(request, fcmRequests.length);
  };
  return { send, tokenRequests, fcmRequests };
}

const fcmError = (status: number, code: string, errorCode?: string, message = "error") =>
  Response.json(
    {
      error: {
        code: status,
        message,
        status: code,
        details: errorCode
          ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]
          : [],
      },
    },
    { status },
  );

describe("service account and access token", () => {
  test("reads the key file; refuses one without its fields, never echoing the key", () => {
    expect(account).toMatchObject({
      projectId: "brigade-test",
      clientEmail: "relay@brigade-test.example.com",
      privateKeyId: "key-1",
      tokenUri: TOKEN_URI,
    });
    expect(parseServiceAccount(serviceAccount({ token_uri: undefined })).tokenUri).toBe(
      "https://oauth2.googleapis.com/token",
    );
    for (const text of [
      undefined,
      "",
      "not json",
      serviceAccount({ project_id: undefined }),
      serviceAccount({ project_id: "../other" }),
      serviceAccount({ private_key: "" }),
      serviceAccount({ token_uri: "http://oauth2.example.com/token" }),
    ]) {
      expect(() => parseServiceAccount(text)).toThrow(/FCM_SERVICE_ACCOUNT/);
      try {
        parseServiceAccount(text);
      } catch (error) {
        expect(String(error)).not.toContain("PRIVATE KEY");
      }
    }
  });

  test("the assertion is an RS256 JWT for the FCM scope, verifiable with the account's public key", async () => {
    const jwt = await signGoogleAssertion(account, 1_760_000_000_500);
    const [header, claims, signature] = jwt.split(".");
    const decode = (part: string | undefined) =>
      JSON.parse(new TextDecoder().decode(fromBase64url(part ?? ""))) as unknown;
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
    expect(decode(claims)).toEqual({
      iss: "relay@brigade-test.example.com",
      scope: FCM_SCOPE,
      aud: TOKEN_URI,
      iat: 1_760_000_000,
      exp: 1_760_003_600,
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(publicKey, fromBase64url(signature ?? ""))).toBe(true);
  });

  test("an access token is fetched once and reused until shortly before it expires", async () => {
    const cache = new GoogleTokenCache();
    const google = fakeGoogle();
    const now = 1_760_000_000_000;
    const [a, b] = await Promise.all([
      cache.get(account, now, google.send),
      cache.get(account, now, google.send),
    ]);
    expect(a).toBe("access-1");
    expect(b).toBe("access-1");
    expect(google.tokenRequests).toHaveLength(1);
    const form = new URLSearchParams(await google.tokenRequests[0]!.text());
    expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
    expect(form.get("assertion")?.split(".")).toHaveLength(3);
    const almost = now + 3599 * 1000 - ACCESS_TOKEN_MARGIN_MS - 1;
    expect(await cache.get(account, almost, google.send)).toBe("access-1");
    expect(await cache.get(account, almost + 1, google.send)).toBe("access-2");
    // Another token refused (one already replaced) keeps this one; this one refused drops it.
    await cache.clear("access-1");
    expect(await cache.get(account, almost + 1, google.send)).toBe("access-2");
    await cache.clear("access-2");
    expect(await cache.get(account, almost + 1, google.send)).toBe("access-3");
    // A rotated key gets its own.
    expect(await cache.get({ ...account, privateKeyId: "key-2" }, almost + 1, google.send)).toBe(
      "access-4",
    );
  });

  test("a failed exchange is not cached", async () => {
    const cache = new GoogleTokenCache();
    let fail = true;
    const google = fakeGoogle(undefined, () =>
      fail
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: "", expires_in: 3599 }),
    );
    await expect(cache.get(account, 0, google.send)).rejects.toThrow(/invalid_grant/);
    fail = false;
    expect(await cache.get(account, 0, google.send)).toBe("access-2");
  });
});

describe("the FCM message", () => {
  test("a data message, high priority, with a TTL and nothing but the envelope and what it is", async () => {
    const sealed = await envelope();
    const request = buildFcmRequest(
      {
        token: FCM_TOKEN,
        kind: "alert",
        envelope: sealed,
        urgency: "page",
        collapseId: "inc_1",
        ttlSeconds: 900,
      },
      { projectId: "brigade-test", accessToken: "access" },
    );
    expect(request.url).toBe("https://fcm.googleapis.com/v1/projects/brigade-test/messages:send");
    expect(request.headers.get("authorization")).toBe("Bearer access");
    const body = (await request.json()) as { message: Record<string, unknown> };
    expect(body.message).toEqual({
      token: FCM_TOKEN,
      data: {
        v: "1",
        enc: sealed.enc,
        ct: sealed.ct,
        kind: "alert",
        urgency: "page",
        tag: "inc_1",
      },
      android: { priority: "HIGH", ttl: "900s" },
    });
    // No `notification`: FCM never shows anything the app did not decrypt.
    expect(body.message.notification).toBeUndefined();
  });

  test("low urgency is normal priority; a call carries its id", async () => {
    const sealed = await envelope();
    const low = buildFcmRequest(
      { token: FCM_TOKEN, kind: "alert", envelope: sealed, urgency: "low", ttlSeconds: 60 },
      { projectId: "p", accessToken: "a" },
    );
    expect(((await low.json()) as { message: { android: unknown } }).message.android).toEqual({
      priority: "NORMAL",
      ttl: "60s",
    });
    expect(
      fcmData({ kind: "call", callId: CALL_ID, envelope: sealed, urgency: "page" }),
    ).toMatchObject({ kind: "call", callId: CALL_ID });
  });

  test("refuses a malformed token, a call that is not a page, and a long collapse id", async () => {
    const sealed = await envelope();
    const base = {
      kind: "alert" as const,
      envelope: sealed,
      urgency: "page" as const,
      ttlSeconds: 1,
    };
    const options = { projectId: "p", accessToken: "a" };
    expect(() => buildFcmRequest({ ...base, token: "short" }, options)).toThrow();
    expect(() => buildFcmRequest({ ...base, token: `${FCM_TOKEN} x` }, options)).toThrow();
    expect(() =>
      buildFcmRequest({ ...base, token: FCM_TOKEN, collapseId: "x".repeat(65) }, options),
    ).toThrow();
    expect(() =>
      buildFcmRequest(
        { ...base, token: FCM_TOKEN, kind: "call", callId: CALL_ID, urgency: "high" },
        options,
      ),
    ).toThrow();
  });

  test("FCM's errors: which mean the token is done", () => {
    const parse = async (response: Response) => parseFcmError(await response.text());
    return Promise.all([
      parse(fcmError(404, "NOT_FOUND", "UNREGISTERED")).then((r) =>
        expect(r).toEqual({ reason: "UNREGISTERED", tokenInvalid: true }),
      ),
      parse(
        fcmError(
          400,
          "INVALID_ARGUMENT",
          "INVALID_ARGUMENT",
          "The registration token is not a valid FCM registration token",
        ),
      ).then((r) => expect(r).toEqual({ reason: "INVALID_ARGUMENT", tokenInvalid: true })),
      parse(fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid ttl")).then((r) =>
        expect(r).toEqual({ reason: "INVALID_ARGUMENT", tokenInvalid: false }),
      ),
      // Another Firebase project's token: the relay's service account, not a dead phone.
      parse(fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")).then((r) =>
        expect(r).toEqual({ reason: "SENDER_ID_MISMATCH", tokenInvalid: false }),
      ),
      parse(fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED")).then((r) =>
        expect(r).toEqual({ reason: "QUOTA_EXCEEDED", tokenInvalid: false }),
      ),
      parse(fcmError(503, "UNAVAILABLE")).then((r) =>
        expect(r).toEqual({ reason: "UNAVAILABLE", tokenInvalid: false }),
      ),
      parse(new Response("<html>")).then((r) =>
        expect(r).toEqual({ reason: "unknown", tokenInvalid: false }),
      ),
    ]);
  });
});

describe("POST /send to an Android device", () => {
  test("goes to FCM with an access token, never to APNs", async () => {
    const google = fakeGoogle();
    const response = await handle(post(await sendBody()), env, google.send);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 200, fcmId: "0:123" });
    expect(google.fcmRequests).toHaveLength(1);
    const request = google.fcmRequests[0]!;
    expect(request.url).toBe("https://fcm.googleapis.com/v1/projects/brigade-test/messages:send");
    expect(request.headers.get("authorization")).toMatch(/^Bearer access-\d+$/);
    const { message } = (await request.json()) as {
      message: { android: { ttl: string; priority: string } };
    };
    // A page waits 15 minutes for an offline phone, as on APNs.
    expect(message.android).toEqual({ priority: "HIGH", ttl: "900s" });
  });

  test("a call is a data message of kind call that lives a minute", async () => {
    const google = fakeGoogle();
    const response = await handle(
      post(await sendBody({ kind: "call", callId: CALL_ID, urgency: undefined })),
      env,
      google.send,
    );
    expect(response.status).toBe(200);
    const { message } = (await google.fcmRequests[0]!.json()) as {
      message: { data: Record<string, string>; android: Record<string, string> };
    };
    expect(message.data).toMatchObject({ kind: "call", callId: CALL_ID, urgency: "page" });
    expect(message.android).toEqual({ priority: "HIGH", ttl: "60s" });
  });

  test("FCM's refusals are 502s with its status and reason; a token that is done says so", async () => {
    for (const [answer, expected] of [
      [
        fcmError(404, "NOT_FOUND", "UNREGISTERED"),
        { status: 404, reason: "UNREGISTERED", tokenInvalid: true },
      ],
      [
        fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"),
        { status: 429, reason: "QUOTA_EXCEEDED" },
      ],
      // Another Firebase project's token: the relay's service account is wrong, the phone is kept.
      [
        fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"),
        { status: 403, reason: "SENDER_ID_MISMATCH" },
      ],
      [fcmError(503, "UNAVAILABLE", "UNAVAILABLE"), { status: 503, reason: "UNAVAILABLE" }],
      [fcmError(500, "INTERNAL", "INTERNAL"), { status: 500, reason: "INTERNAL" }],
    ] as const) {
      const response = await handle(
        post(await sendBody()),
        env,
        fakeGoogle(() => answer.clone()).send,
      );
      expect(response.status).toBe(502);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject(expected);
      if (!("tokenInvalid" in expected)) expect(body.tokenInvalid).toBeUndefined();
    }
  });

  test("an access token FCM refuses is fetched again and the send tried once more", async () => {
    const google = fakeGoogle((_, count) =>
      count === 1
        ? fcmError(401, "UNAUTHENTICATED")
        : Response.json({ name: "projects/brigade-test/messages/0:9" }),
    );
    const response = await handle(post(await sendBody()), env, google.send);
    expect(response.status).toBe(200);
    expect(google.fcmRequests).toHaveLength(2);
    // The retry went with a token fetched after the 401 (the isolate may have held one from before).
    expect(google.tokenRequests.length).toBeGreaterThanOrEqual(1);
    expect(google.fcmRequests[1]!.headers.get("authorization")).toBe(
      `Bearer access-${google.tokenRequests.length}`,
    );
    // Twice refused: answered as FCM's refusal, not tried forever.
    const always = fakeGoogle(() => fcmError(401, "UNAUTHENTICATED"));
    const refused = await handle(post(await sendBody()), env, always.send);
    expect(refused.status).toBe(502);
    expect(always.fcmRequests).toHaveLength(2);
  });

  test("the retry after a 401 gets only what is left of the call's time", async () => {
    const other = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-13" }) };
    let sends = 0;
    const started = Date.now();
    const response = await handle(post(await sendBody()), other, async (request) => {
      if (request.url === TOKEN_URI) return Response.json({ access_token: "x", expires_in: 3599 });
      // A 401 just inside the first send's bound, then a retry that never answers.
      if (++sends === 1) {
        await new Promise((resolve) => setTimeout(resolve, 4900));
        return fcmError(401, "UNAUTHENTICATED");
      }
      return hang(request);
    });
    expect(await response.json()).toMatchObject({ error: "fcm_unreachable" });
    // Under the API's 10 s for the whole call (apps/api RELAY_TIMEOUT_MS).
    expect(Date.now() - started).toBeLessThan(9500);
  }, 20_000);

  test("sends refused together fetch one new access token between them, not one each", async () => {
    // Its own account, so no token cached by another test answers for it.
    const own = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-401" }) };
    // The refusals come back one after another, each after the first one's retry has a new token.
    const google = fakeGoogle(async (request, count) => {
      if (request.headers.get("authorization") !== "Bearer access-1") {
        return Response.json({ name: "projects/brigade-test/messages/0:9" });
      }
      await new Promise((resolve) => setTimeout(resolve, count * 10));
      return fcmError(401, "UNAUTHENTICATED");
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, async () => handle(post(await sendBody()), own, google.send)),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(google.tokenRequests).toHaveLength(2);
    expect(google.fcmRequests).toHaveLength(10);
  });

  test("FCM or the token endpoint out of reach is fcm_unreachable; a refused key is the relay's error", async () => {
    const down = await handle(post(await sendBody()), env, async (request) => {
      if (request.url === TOKEN_URI) return Response.json({ access_token: "x", expires_in: 3599 });
      throw new Error("Network connection lost.");
    });
    expect(down.status).toBe(502);
    expect(await down.json()).toMatchObject({ error: "fcm_unreachable" });

    // Another account, so the module's cached token does not answer for it.
    const other = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-9" }) };
    const tokenDown = await handle(post(await sendBody()), other, async () => {
      throw new Error("Network connection lost.");
    });
    expect(await tokenDown.json()).toMatchObject({ error: "fcm_unreachable" });
    const google = fakeGoogle(undefined, () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const refused = await handle(
      post(await sendBody()),
      { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-10" }) },
      google.send,
    );
    expect(refused.status).toBe(500);
    expect(await refused.json()).toEqual({ error: "relay_misconfigured" });
    expect(google.fcmRequests).toHaveLength(0);
  });

  test("a token exchange that hangs fails every send waiting on it soon, and is not cached", async () => {
    const other = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-11" }) };
    const exchanges: string[] = [];
    const counted = (request: Request) => {
      exchanges.push(request.url);
      return hang(request);
    };
    const bodies = await Promise.all([sendBody(), sendBody(), sendBody()]);
    const started = Date.now();
    const answers = await Promise.all(bodies.map((body) => handle(post(body), other, counted)));
    // One exchange for all of them, failing them together.
    expect(exchanges).toEqual([TOKEN_URI]);
    for (const answer of answers) {
      expect(await answer.json()).toMatchObject({ error: "fcm_unreachable" });
    }
    // Under the API's 10 s for the whole call (apps/api RELAY_TIMEOUT_MS).
    expect(Date.now() - started).toBeLessThan(9000);
    // Google answering again: the next send gets a token and goes to FCM.
    const google = fakeGoogle();
    const back = await handle(post(await sendBody()), other, google.send);
    expect(back.status).toBe(200);
  }, 20_000);

  test("FCM that never answers is fcm_unreachable", async () => {
    const other = { ...env, FCM_SERVICE_ACCOUNT: serviceAccount({ private_key_id: "key-12" }) };
    const response = await handle(post(await sendBody()), other, async (request) =>
      request.url === TOKEN_URI
        ? Response.json({ access_token: "x", expires_in: 3599 })
        : hang(request),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "fcm_unreachable" });
  }, 15_000);

  test("a relay without FCM_SERVICE_ACCOUNT refuses Android sends as misconfigured", async () => {
    const google = fakeGoogle();
    const { FCM_SERVICE_ACCOUNT: _, ...ios } = env;
    const response = await handle(post(await sendBody()), ios, google.send);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "relay_misconfigured" });
    expect(google.fcmRequests).toHaveLength(0);
  });

  test("refuses what Android cannot take, without calling anyone", async () => {
    const google = fakeGoogle();
    for (const body of [
      await sendBody({ platform: "windows" }),
      await sendBody({ deviceToken: "has spaces in it, so it is not a token" }),
      await sendBody({ critical: true }),
      await sendBody({ kind: "call", callId: "not-a-uuid" }),
      await sendBody({ kind: "call", callId: CALL_ID, urgency: "high" }),
      await sendBody({ urgency: "page", ttlSeconds: 0 }),
    ]) {
      expect((await handle(post(body), env, google.send)).status, JSON.stringify(body)).toBe(400);
    }
    expect(google.tokenRequests).toHaveLength(0);
    expect(google.fcmRequests).toHaveLength(0);
  });
});
