import { createVerify, generateKeyPairSync } from "node:crypto";
import { fromBase64url, generateRecipient, sealPush, toBase64url } from "@freecorps/brigade-push";
import { beforeEach, describe, expect, test } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";
import { fcmAccessToken } from "@freecorps/ember-push";
import { APNS_TOKEN_TTL_MS } from "../src/apns.ts";
import { FALLBACK_MS, googleError, providerTokens } from "../src/provider-tokens.ts";

// RFC 0016 "Push", step 1: the relay's provider and access tokens come from Ember's push transport, with the relay's
// own signers as the fallback.

const apnsKey = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TOKEN_URI = "https://oauth2.example.com/token";
const env: RelayEnv = {
  APNS_ENVIRONMENT: "sandbox",
  APNS_TOPIC: "app.freecorps.brigade",
  APNS_KEY: apnsKey.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  APNS_KEY_ID: "KEYID12345",
  APNS_TEAM_ID: "TEAMID1234",
  RELAY_SEND_TOKEN: "test-token",
  FCM_SERVICE_ACCOUNT: JSON.stringify({
    project_id: "brigade-test",
    private_key_id: "key-1",
    client_email: "relay@brigade-test.example.com",
    private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    token_uri: TOKEN_URI,
  }),
};
const DEVICE_TOKEN = "c".repeat(64);
const FCM_TOKEN = "fcm-token_ABC:" + "y".repeat(140);

async function post(overrides: Record<string, unknown> = {}): Promise<Request> {
  const recipient = await generateRecipient();
  const envelope = await sealPush(toBase64url(recipient.publicKey), { title: "t", body: "b" });
  return new Request("https://relay.test/send", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ deviceToken: DEVICE_TOKEN, envelope, urgency: "page", ...overrides }),
  });
}

const decode = (part: string | undefined) =>
  JSON.parse(new TextDecoder().decode(fromBase64url(part ?? ""))) as Record<string, unknown>;

/** The provider token a request to APNs carried. */
const jwtOf = (request: Request | undefined) =>
  (request?.headers.get("authorization") ?? "").replace(/^bearer /, "");

/**
 * Ember's transport signs with `typ: "JWT"` in the header; the relay's own signer never did. That is how these tests
 * tell who signed a token, nothing else depends on it.
 */
const signerOf = (jwt: string) => ("typ" in decode(jwt.split(".")[0]) ? "ember" : "relay");

/** APNs answering each request with `answer(jwt, count)`; records every request. */
function fakeApns(answer: (jwt: string, count: number) => { status: number; reason?: string }) {
  const sent: Request[] = [];
  const send = async (request: Request) => {
    sent.push(request);
    const { status, reason } = answer(jwtOf(request), sent.length);
    return new Response(reason ? JSON.stringify({ reason }) : null, { status });
  };
  return { sent, send };
}

beforeEach(() => providerTokens.reset());

describe("APNs provider token from Ember's transport", () => {
  test("is an ES256 JWS with kid, iss and iat, verifiable with the key, and reused across sends", async () => {
    const apns = fakeApns(() => ({ status: 200 }));
    expect((await handle(await post(), env, apns.send)).status).toBe(200);
    expect((await handle(await post(), env, apns.send)).status).toBe(200);
    const jwt = jwtOf(apns.sent[0]);
    expect(jwtOf(apns.sent[1])).toBe(jwt);
    const [header, claims, signature] = jwt.split(".");
    expect(decode(header)).toMatchObject({ alg: "ES256", kid: "KEYID12345" });
    expect(signerOf(jwt)).toBe("ember");
    const iat = decode(claims).iat as number;
    expect(decode(claims)).toEqual({ iss: "TEAMID1234", iat });
    expect(Math.abs(iat - Date.now() / 1000)).toBeLessThan(60);
    // JWS ES256 is r || s; node verifies it with `dsaEncoding: ieee-p1363`.
    const verifier = createVerify("SHA256");
    verifier.update(`${header}.${claims}`);
    expect(
      verifier.verify(
        { key: apnsKey.publicKey, dsaEncoding: "ieee-p1363" },
        fromBase64url(signature ?? ""),
      ),
    ).toBe(true);
  });

  test("refused as invalid, the same send goes again at once with the relay's own signer, which then stays", async () => {
    const apns = fakeApns((jwt) =>
      signerOf(jwt) === "ember" ? { status: 403, reason: "InvalidProviderToken" } : { status: 200 },
    );
    const response = await handle(await post(), env, apns.send);
    expect(response.status).toBe(200);
    expect(apns.sent.map((request) => signerOf(jwtOf(request)))).toEqual(["ember", "relay"]);
    // The next page goes with the relay's own token straight away: the two signers never alternate on one key.
    expect((await handle(await post(), env, apns.send)).status).toBe(200);
    expect(apns.sent.map((request) => signerOf(jwtOf(request)))).toEqual([
      "ember",
      "relay",
      "relay",
    ]);
    expect(jwtOf(apns.sent[2])).toBe(jwtOf(apns.sent[1]));
  });

  test("a key APNs refuses from both signers answers as before: a 502 with APNs' reason", async () => {
    const apns = fakeApns(() => ({ status: 403, reason: "InvalidProviderToken" }));
    const response = await handle(await post(), env, apns.send);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ status: 403, reason: "InvalidProviderToken" });
    expect(apns.sent).toHaveLength(2);
  });

  test("goes back to Ember's transport once the fallback has run its time", async () => {
    const now = Date.now();
    const credentials = { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID };
    const first = await providerTokens.apns(credentials, now);
    expect(first.signer).toBe("ember");
    expect(await providerTokens.apnsRefused(credentials, first, "InvalidProviderToken", now)).toBe(
      true,
    );
    expect((await providerTokens.apns(credentials, now + 1)).signer).toBe("relay");
    // The relay's own token, signed at `now`, is past its 40 minutes by then: no second update in 20.
    expect((await providerTokens.apns(credentials, now + FALLBACK_MS)).signer).toBe("ember");
  });

  test("an expired token is signed again once for every send that saw it; the instance retries the page", async () => {
    let expired: string | undefined;
    const apns = fakeApns((jwt, count) => {
      if (count === 1) expired = jwt;
      return jwt === expired ? { status: 403, reason: "ExpiredProviderToken" } : { status: 200 };
    });
    const requests = [await post(), await post()];
    const answers = await Promise.all(requests.map((request) => handle(request, env, apns.send)));
    // Both went with the token APNs calls expired, and neither was tried with the relay's own signer.
    expect(answers.map((answer) => answer.status)).toEqual([502, 502]);
    expect(apns.sent).toHaveLength(2);
    const next = await handle(await post(), env, apns.send);
    expect(next.status).toBe(200);
    const renewed = jwtOf(apns.sent[2]);
    expect(renewed).not.toBe(expired);
    expect(signerOf(renewed)).toBe("ember");
  });
});

describe("APNs fallback edges", () => {
  const credentials = { key: env.APNS_KEY, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID };

  test("concurrent sends share one signing", async () => {
    const apns = fakeApns(() => ({ status: 200 }));
    const requests = await Promise.all([post(), post(), post()]);
    await Promise.all(requests.map((request) => handle(request, env, apns.send)));
    expect(new Set(apns.sent.map(jwtOf)).size).toBe(1);
  });

  test("after the fallback, Ember's signer comes back only once the relay's token is due anyway", async () => {
    const now = Date.now();
    const first = await providerTokens.apns(credentials, now);
    expect(await providerTokens.apnsRefused(credentials, first, "InvalidProviderToken", now)).toBe(
      true,
    );
    // The relay's own token, signed again 50 minutes in (its 40 minutes ran out).
    const resigned = now + 50 * 60 * 1000;
    expect((await providerTokens.apns(credentials, resigned)).signer).toBe("relay");
    // The hour is over, but that token is 10 minutes old: a new Ember token now would be a second update in 10.
    expect((await providerTokens.apns(credentials, now + FALLBACK_MS)).signer).toBe("relay");
    expect((await providerTokens.apns(credentials, resigned + APNS_TOKEN_TTL_MS - 1)).signer).toBe(
      "relay",
    );
    expect((await providerTokens.apns(credentials, resigned + APNS_TOKEN_TTL_MS)).signer).toBe(
      "ember",
    );
  });

  test("refused from both, the relay's own steps down: the next page starts with Ember's again", async () => {
    const apns = fakeApns(() => ({ status: 403, reason: "InvalidProviderToken" }));
    await handle(await post(), env, apns.send);
    await handle(await post(), env, apns.send);
    expect(apns.sent.map((request) => signerOf(jwtOf(request)))).toEqual([
      "ember",
      "relay",
      "ember",
      "relay",
    ]);
  });

  test("a key only Ember can read is never handed to the relay's own signer", async () => {
    // Escaped newlines, as some secret stores keep a .p8: Ember's PEM reader takes them, the relay's does not.
    const escaped = { ...env, APNS_KEY: env.APNS_KEY.replace(/\n/g, "\\n") };
    const apns = fakeApns(() => ({ status: 403, reason: "InvalidProviderToken" }));
    const response = await handle(await post(), escaped, apns.send);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ reason: "InvalidProviderToken" });
    const ok = fakeApns(() => ({ status: 200 }));
    expect((await handle(await post(), escaped, ok.send)).status).toBe(200);
    expect(signerOf(jwtOf(ok.sent[0]))).toBe("ember");
  });
});

describe("FCM access token from Ember's transport", () => {
  /** Google's token endpoint answering `token(count)`, FCM answering 200; records both. */
  function fakeGoogle(token: (count: number) => Response) {
    const exchanges: Request[] = [];
    const messages: Request[] = [];
    const send = async (request: Request) => {
      if (request.url === TOKEN_URI) {
        exchanges.push(request);
        return token(exchanges.length);
      }
      messages.push(request);
      return Response.json({ name: "projects/brigade-test/messages/0:1" });
    };
    return { exchanges, messages, send };
  }

  test("exchanged once for the scope with the account's key, and reused", async () => {
    const google = fakeGoogle((n) =>
      Response.json({ access_token: `ya29.${n}`, expires_in: 3599 }),
    );
    const android = { platform: "android", deviceToken: FCM_TOKEN };
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    expect(google.exchanges).toHaveLength(1);
    expect(google.messages.map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer ya29.1",
      "Bearer ya29.1",
    ]);
    const assertion = new URLSearchParams(await google.exchanges[0]!.text()).get("assertion");
    const [header, claims, signature] = (assertion ?? "").split(".");
    expect(decode(header)).toMatchObject({ alg: "RS256", kid: "key-1" });
    expect(decode(claims)).toMatchObject({
      iss: "relay@brigade-test.example.com",
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: TOKEN_URI,
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${claims}`);
    expect(verifier.verify(rsa.publicKey, fromBase64url(signature ?? ""))).toBe(true);
  });

  test("an assertion Google refuses from Ember goes again with the relay's own, which then stays", async () => {
    const google = fakeGoogle((n) =>
      n === 1
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: `ya29.${n}`, expires_in: 3599 }),
    );
    const android = { platform: "android", deviceToken: FCM_TOKEN };
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    // One refused exchange (Ember's), one from the relay's own signer, kept for the second page.
    expect(google.exchanges).toHaveLength(2);
    expect(google.messages.map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer ya29.2",
      "Bearer ya29.2",
    ]);
  });

  test("a token FCM refused is never sent again, even when a later refusal names an older one", async () => {
    const google = fakeGoogle((n) =>
      Response.json({ access_token: `ya29.${n}`, expires_in: 3599 }),
    );
    let fcm = 0;
    const send = async (request: Request) => {
      if (request.url === TOKEN_URI) return google.send(request);
      fcm++;
      google.messages.push(request);
      const auth = request.headers.get("authorization");
      return auth === "Bearer ya29.1" || auth === "Bearer ya29.2"
        ? new Response(null, { status: 401 })
        : Response.json({ name: "projects/brigade-test/messages/0:1" });
    };
    const android = { platform: "android", deviceToken: FCM_TOKEN };
    // Both tokens refused within one send: the send fails and the instance retries it.
    expect((await handle(await post(android), env, send)).status).toBe(502);
    // A late refusal of the first token arrives from another send.
    await providerTokens.googleRefused("ya29.1");
    expect((await handle(await post(android), env, send)).status).toBe(200);
    expect(google.messages.at(-1)?.headers.get("authorization")).toBe("Bearer ya29.3");
    expect(fcm).toBe(3);
  });

  test("an exchange Ember fails at in an unexpected way goes to the relay's own signer, which stays", async () => {
    const google = fakeGoogle((n) =>
      n === 1
        ? new Response("<html>not json</html>", { status: 200 })
        : Response.json({ access_token: `ya29.${n}`, expires_in: 3599 }),
    );
    const android = { platform: "android", deviceToken: FCM_TOKEN };
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    expect((await handle(await post(android), env, google.send)).status).toBe(200);
    expect(google.exchanges).toHaveLength(2);
  });

  test("a token endpoint that fails or is out of reach is fcm_unreachable, with no fallback", async () => {
    const google = fakeGoogle(() => new Response("busy", { status: 503 }));
    const response = await handle(
      await post({ platform: "android", deviceToken: FCM_TOKEN }),
      env,
      google.send,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "fcm_unreachable" });
    expect(google.exchanges).toHaveLength(1);
  });

  test("what Ember's exchange throws for Google's answers, as the relay tells it apart", async () => {
    const thrown = async (status: number) => {
      const fetch = (async () =>
        Response.json({ error: "x" }, { status })) as unknown as typeof globalThis.fetch;
      return fcmAccessToken(
        { serviceAccount: env.FCM_SERVICE_ACCOUNT!, retries: 0, fetch },
        true,
      ).catch((error: unknown) => error);
    };
    expect(googleError(await thrown(400)).kind).toBe("refused");
    expect(googleError(await thrown(401)).kind).toBe("refused");
    expect(googleError(await thrown(403)).kind).toBe("refused");
    expect(googleError(await thrown(429)).kind).toBe("unreachable");
    expect(googleError(await thrown(503)).kind).toBe("unreachable");
  });

  test("what Ember's exchange throws, as the relay tells it apart", () => {
    const credentials = Object.assign(new Error("bad key"), { credentials: true });
    expect(googleError(credentials).kind).toBe("refused");
    expect(googleError(new Error("Google token endpoint: 403 forbidden")).kind).toBe("refused");
    expect(googleError(new Error("Google token endpoint: 429")).kind).toBe("unreachable");
    expect(googleError(new Error("Google token endpoint: 503")).kind).toBe("unreachable");
    // Anything Ember did not expect falls back (refused), unless the relay's own fetch said it was out of reach.
    expect(googleError(new TypeError("x is not a function")).kind).toBe("refused");
  });
});

describe("deep health", () => {
  test("APNs refusing Ember's token is checked again with the relay's own, as a page would be", async () => {
    const apns = fakeApns((jwt) =>
      signerOf(jwt) === "ember"
        ? { status: 403, reason: "InvalidProviderToken" }
        : { status: 400, reason: "BadDeviceToken" },
    );
    const response = await handle(
      new Request("https://relay.test/health?deep=1", {
        headers: { Authorization: "Bearer test-token" },
      }),
      { ...env, FCM_SERVICE_ACCOUNT: undefined },
      apns.send,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ apns: { status: "ok" } });
    expect(apns.sent.map((request) => signerOf(jwtOf(request)))).toEqual(["ember", "relay"]);
  });
});
