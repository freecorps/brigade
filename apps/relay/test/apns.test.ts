import { generateKeyPairSync } from "node:crypto";
import { fromBase64url, sealPush, toBase64url } from "@freecorps/brigade-push";
import { generateRecipient } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import {
  APNS_TOKEN_TTL_MS,
  ApnsTokenCache,
  apnsPayload,
  buildApnsRequest,
  FALLBACK_ALERT,
  signApnsJwt,
} from "../src/apns.ts";

// A throwaway P-256 key in the `.p8` form Apple issues (PKCS #8 PEM); never a real one.
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const credentials = {
  key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  keyId: "KEYID12345",
  teamId: "TEAMID1234",
};
const DEVICE_TOKEN = "a".repeat(64);

async function envelope() {
  const recipient = await generateRecipient();
  return sealPush(toBase64url(recipient.publicKey), { title: "SEV1", body: "Checkout down" });
}

describe("signApnsJwt", () => {
  test("an ES256 JWS with kid, iss and iat in seconds, verifiable with the public key", async () => {
    const jwt = await signApnsJwt(credentials, 1_760_000_000_123);
    const [header, claims, signature] = jwt.split(".");
    const decode = (part: string | undefined) =>
      JSON.parse(new TextDecoder().decode(fromBase64url(part ?? ""))) as unknown;
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEYID12345" });
    expect(decode(claims)).toEqual({ iss: "TEAMID1234", iat: 1_760_000_000 });

    // JWS ES256 is the raw 64-byte r || s, not DER.
    const raw = fromBase64url(signature ?? "");
    expect(raw.length).toBe(64);
    const key = await crypto.subtle.importKey(
      "spki",
      new Uint8Array(publicKey.export({ type: "spki", format: "der" })),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      raw,
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(ok).toBe(true);
  });

  test("rejects a key that is not PKCS #8 P-256", async () => {
    await expect(signApnsJwt({ ...credentials, key: "not a key" }, 0)).rejects.toThrow();
  });
});

describe("ApnsTokenCache", () => {
  test("reuses a token for 40 minutes, then signs a new one", async () => {
    const cache = new ApnsTokenCache();
    const first = await cache.get(credentials, 0);
    expect(await cache.get(credentials, APNS_TOKEN_TTL_MS - 1)).toBe(first);
    const second = await cache.get(credentials, APNS_TOKEN_TTL_MS);
    expect(second).not.toBe(first);
  });

  test("signs again after clear() or for another key id", async () => {
    const cache = new ApnsTokenCache();
    const first = await cache.get(credentials, 0);
    cache.clear();
    expect(await cache.get(credentials, 1000)).not.toBe(first);
    const other = await cache.get({ ...credentials, keyId: "OTHERKEY12" }, 2000);
    expect(other.split(".")[0]).not.toBe(first.split(".")[0]);
  });

  test("does not keep a failed signature", async () => {
    const cache = new ApnsTokenCache();
    await expect(cache.get({ ...credentials, key: "bad" }, 0)).rejects.toThrow();
    await expect(cache.get(credentials, 0)).resolves.toMatch(/^ey/);
  });
});

describe("buildApnsRequest", () => {
  test("POST /3/device/<token> on the sandbox host with the provider token and alert headers", async () => {
    const request = buildApnsRequest(
      { deviceToken: DEVICE_TOKEN.toUpperCase(), envelope: await envelope(), urgency: "page" },
      { environment: "sandbox", topic: "app.example", jwt: "a.b.c" },
    );
    expect(request.method).toBe("POST");
    expect(request.url).toBe(`https://api.sandbox.push.apple.com/3/device/${DEVICE_TOKEN}`);
    expect(request.headers.get("authorization")).toBe("bearer a.b.c");
    expect(request.headers.get("apns-topic")).toBe("app.example");
    expect(request.headers.get("apns-push-type")).toBe("alert");
    expect(request.headers.get("apns-priority")).toBe("10");
    expect(request.headers.get("apns-expiration")).toBe("0");
    expect(request.headers.get("apns-collapse-id")).toBeNull();
  });

  test("production host, low priority, expiration and collapse id", async () => {
    const request = buildApnsRequest(
      {
        deviceToken: DEVICE_TOKEN,
        envelope: await envelope(),
        urgency: "low",
        collapseId: "inc_123",
        expiration: 1_760_000_000,
      },
      { environment: "production", topic: "app.example", jwt: "a.b.c" },
    );
    expect(new URL(request.url).host).toBe("api.push.apple.com");
    expect(request.headers.get("apns-priority")).toBe("5");
    expect(request.headers.get("apns-expiration")).toBe("1760000000");
    expect(request.headers.get("apns-collapse-id")).toBe("inc_123");
  });

  test("the body carries the localized fallback, mutable-content and the envelope only", async () => {
    const sealed = await envelope();
    const request = buildApnsRequest(
      { deviceToken: DEVICE_TOKEN, envelope: sealed, urgency: "page" },
      { environment: "sandbox", topic: "app.example", jwt: "a.b.c" },
    );
    const body = (await request.json()) as Record<string, unknown>;
    expect(body).toEqual({
      aps: {
        alert: FALLBACK_ALERT,
        "mutable-content": 1,
        sound: "default",
        "interruption-level": "time-sensitive",
      },
      brigade: sealed,
    });
    // The relay sees no content: nothing readable in what goes to Apple.
    expect(JSON.stringify(body)).not.toContain("Checkout");
  });

  test("only pages are time-sensitive", async () => {
    const sealed = await envelope();
    const level = (urgency: "low" | "high" | "page") =>
      (apnsPayload({ envelope: sealed, urgency }).aps as Record<string, unknown>)[
        "interruption-level"
      ];
    expect([level("low"), level("high"), level("page")]).toEqual([
      "active",
      "active",
      "time-sensitive",
    ]);
  });

  test("rejects malformed device tokens and long collapse ids", async () => {
    const sealed = await envelope();
    const options = { environment: "sandbox", topic: "app.example", jwt: "a.b.c" } as const;
    for (const deviceToken of ["", "zz".repeat(32), "a".repeat(63), `${"a".repeat(64)}/../x`]) {
      expect(() =>
        buildApnsRequest({ deviceToken, envelope: sealed, urgency: "high" }, options),
      ).toThrow(/device token/);
    }
    expect(() =>
      buildApnsRequest(
        {
          deviceToken: DEVICE_TOKEN,
          envelope: sealed,
          urgency: "high",
          collapseId: "x".repeat(65),
        },
        options,
      ),
    ).toThrow(/collapse id/);
  });
});
