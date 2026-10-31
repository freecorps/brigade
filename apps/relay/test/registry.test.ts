import { generateInstanceKey, signRequest } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";
import { isRevoked, type InstanceRecord } from "../src/registry.ts";

type Key = Awaited<ReturnType<typeof generateInstanceKey>>;

/** Workers KV over a Map; `failing` makes every call throw, like KV in an outage. */
function fakeKv() {
  const data = new Map<string, string>();
  const kv = {
    data,
    failing: false,
    ttls: new Map<string, number | undefined>(),
    async get(key: string) {
      if (kv.failing) throw new Error("KV GET failed: 503");
      return data.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      if (kv.failing) throw new Error("KV PUT failed: 503");
      data.set(key, value);
      kv.ttls.set(key, options?.expirationTtl);
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
  return kv;
}

/** Records the emails it would send, so a test can read the code. */
function fakeEmail() {
  const sent: { from: string; to: string; subject: string; text: string }[] = [];
  return {
    sent,
    async send(message: (typeof sent)[number]) {
      sent.push(message);
    },
    code: () => /: (\d{6})\n/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "",
  };
}

function setup(overrides: Partial<RelayEnv> = {}) {
  const kv = fakeKv();
  const email = fakeEmail();
  const env: RelayEnv = {
    APNS_ENVIRONMENT: "sandbox",
    APNS_TOPIC: "app.freecorps.brigade",
    APNS_KEY: "unused",
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    RELAY_SEND_TOKEN: "test-token",
    REGISTRY: kv,
    EMAIL: email,
    EMAIL_FROM: "relay@example.com",
    RELAY_TERMS_VERSION: "draft-2026-11",
    ...overrides,
  };
  const call = async (
    key: Key,
    method: string,
    path: string,
    body?: unknown,
    options: { signer?: Key; now?: number; headers?: Record<string, string> } = {},
  ) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const signer = options.signer ?? key;
    const signed = await signRequest({
      privateKey: signer.privateKey,
      publicKey: signer.publicKey,
      instance: key.instance,
      method,
      path,
      body: text,
      now: options.now ?? Date.now(),
    });
    const request = new Request(`https://relay.test${path}`, {
      method,
      headers: { ...signed, "Content-Type": "application/json", ...options.headers },
      ...(body === undefined ? {} : { body: text }),
    });
    return handle(request, env, async () => new Response(null, { status: 500 }));
  };
  const register = async (key: Key, contact = "oncall@example.com") => {
    expect((await call(key, "POST", "/v1/instances/contact", { contact })).status).toBe(200);
    return call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact,
      code: email.code(),
    });
  };
  return { env, kv, email, call, register };
}

function record(kv: ReturnType<typeof fakeKv>, key: Key): InstanceRecord {
  return JSON.parse(kv.data.get(`instance:${key.instance}`) ?? "null");
}

describe("registration on the hosted relay", () => {
  test("terms, contact and the emailed code register the original key", async () => {
    const { kv, email, call, register } = setup();
    const key = await generateInstanceKey();
    const response = await register(key);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      instance: key.instance,
      status: "registered",
      terms: "draft-2026-11",
      termsCurrent: true,
    });
    expect(record(kv, key)).toMatchObject({
      status: "registered",
      keys: [key.publicKey],
      terms: "draft-2026-11",
      contact: "oncall@example.com",
    });
    expect(email.sent[0]).toMatchObject({ from: "relay@example.com", to: "oncall@example.com" });
    // The code is stored hashed, never as typed.
    expect(kv.data.get(`code:${key.instance}`)).not.toContain(email.code());
    expect(kv.ttls.get(`code:${key.instance}`)).toBe(3600);

    // Again with the same key: idempotent.
    const again = await call(key, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(again.status).toBe(200);
    const me = await call(key, "GET", "/v1/instances/me");
    expect(await me.json()).toEqual({
      instance: key.instance,
      status: "registered",
      terms: "draft-2026-11",
      termsCurrent: true,
    });
  });

  test("a wrong code counts a try; after five the code is spent", async () => {
    const { email, call } = setup();
    const key = await generateInstanceKey();
    await call(key, "POST", "/v1/instances/contact", { contact: "oncall@example.com" });
    const wrong = email.code() === "000000" ? "000001" : "000000";
    const body = { terms: "draft-2026-11", contact: "oncall@example.com", code: wrong };
    const first = await call(key, "POST", "/v1/instances", body);
    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({ error: "code_invalid", triesLeft: 4 });
    for (let i = 0; i < 4; i++) await call(key, "POST", "/v1/instances", body);
    const right = await call(key, "POST", "/v1/instances", { ...body, code: email.code() });
    expect(await right.json()).toEqual({ error: "code_expired" });
  });

  test("the code is for the address it went to, and expires after 15 minutes", async () => {
    const { kv, email, call } = setup();
    const key = await generateInstanceKey();
    await call(key, "POST", "/v1/instances/contact", { contact: "oncall@example.com" });
    const other = await call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact: "someone@example.com",
      code: email.code(),
    });
    expect(await other.json()).toMatchObject({ error: "code_invalid" });

    const stored = JSON.parse(kv.data.get(`code:${key.instance}`)!);
    kv.data.set(`code:${key.instance}`, JSON.stringify({ ...stored, expiresAt: Date.now() - 1 }));
    const late = await call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact: "oncall@example.com",
      code: email.code(),
    });
    expect(await late.json()).toEqual({ error: "code_expired" });
  });

  test("at most 3 codes an hour, and a bad address is refused", async () => {
    const { email, call } = setup();
    const key = await generateInstanceKey();
    for (let i = 0; i < 3; i++) {
      expect(
        (await call(key, "POST", "/v1/instances/contact", { contact: "oncall@example.com" }))
          .status,
      ).toBe(200);
    }
    const fourth = await call(key, "POST", "/v1/instances/contact", {
      contact: "oncall@example.com",
    });
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers.get("Retry-After"))).toBeGreaterThan(3500);
    expect(email.sent).toHaveLength(3);
    const bad = await call(await generateInstanceKey(), "POST", "/v1/instances/contact", {
      contact: "not an address",
    });
    expect(await bad.json()).toEqual({ error: "invalid_contact" });
  });

  test("outdated terms answer the current version", async () => {
    const { call } = setup();
    const response = await call(await generateInstanceKey(), "POST", "/v1/instances", {
      terms: "draft-2026-01",
      contact: "oncall@example.com",
      code: "123456",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "terms_outdated", terms: "draft-2026-11" });
  });

  test("without an email binding or sender the code cannot be sent", async () => {
    for (const env of [{ EMAIL: undefined }, { EMAIL_FROM: undefined }]) {
      const { call } = setup(env);
      const response = await call(await generateInstanceKey(), "POST", "/v1/instances/contact", {
        contact: "oncall@example.com",
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
  });

  test("a revoked instance cannot register again or ask for a code", async () => {
    const { kv, call, register } = setup();
    const key = await generateInstanceKey();
    await register(key);
    // Another instance key, so the revocation is not already cached from this test's own reads.
    const revoked = await generateInstanceKey();
    kv.data.set(
      `instance:${revoked.instance}`,
      JSON.stringify({ ...record(kv, key), keys: [revoked.publicKey], status: "revoked" }),
    );
    const again = await call(revoked, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "instance_revoked" });
    const me = await call(revoked, "GET", "/v1/instances/me");
    expect(await me.json()).toEqual({ error: "instance_revoked" });
    const code = await call(revoked, "POST", "/v1/instances/contact", {
      contact: "oncall@example.com",
    });
    expect(code.status).toBe(403);
  });
});

describe("closed registration (an own relay)", () => {
  test("refuses registration and codes, and serves the record the setup script wrote", async () => {
    const { kv, call } = setup({ RELAY_REGISTRATION: "closed" });
    const key = await generateInstanceKey();
    const refused = await call(key, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "registration_closed" });
    const code = await call(key, "POST", "/v1/instances/contact", {
      contact: "oncall@example.com",
    });
    expect(await code.json()).toEqual({ error: "registration_closed" });

    const written = await generateInstanceKey();
    kv.data.set(
      `instance:${written.instance}`,
      JSON.stringify({
        status: "registered",
        keys: [written.publicKey],
        terms: "closed",
        contact: null,
        registeredAt: "2026-11-01T00:00:00.000Z",
      }),
    );
    const me = await call(written, "GET", "/v1/instances/me");
    expect(await me.json()).toEqual({
      instance: written.instance,
      status: "registered",
      terms: "closed",
      termsCurrent: true,
    });
  });
});

describe("signatures and admission", () => {
  test("a bad, stale or missing signature is a 401", async () => {
    const { call, env } = setup();
    const key = await generateInstanceKey();
    const bad = await call(key, "GET", "/v1/instances/me", undefined, {
      headers: { "Brigade-Signature": "A".repeat(86) },
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: "bad_signature" });
    // A body other than the one signed.
    const tampered = await handle(
      new Request("https://relay.test/v1/instances", {
        method: "POST",
        headers: await signRequest({
          ...key,
          method: "POST",
          path: "/v1/instances",
          body: '{"terms":"draft-2026-11"}',
          now: Date.now(),
        }),
        body: '{"terms":"other"}',
      }),
      env,
      fetch,
    );
    expect(await tampered.json()).toEqual({ error: "bad_signature" });
    const stale = await call(key, "GET", "/v1/instances/me", undefined, {
      now: Date.now() - 10 * 60_000,
    });
    expect(await stale.json()).toEqual({ error: "stale_timestamp" });
    const missing = await handle(new Request("https://relay.test/v1/instances/me"), env, fetch);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "missing_signature" });
  });

  test("an unknown instance is unregistered; an unknown path, a 404", async () => {
    const { call } = setup();
    const key = await generateInstanceKey();
    const me = await call(key, "GET", "/v1/instances/me");
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: "instance_unregistered" });
    expect((await call(key, "POST", "/v1/nothing", {})).status).toBe(404);
  });

  test("a KV error fails every /v1/instances route closed", async () => {
    const { kv, call, register } = setup();
    const key = await generateInstanceKey();
    const next = await generateInstanceKey();
    await register(key);
    // A fresh instance, so the per-isolate cache does not answer for KV.
    const other = await generateInstanceKey();
    kv.data.set(
      `instance:${other.instance}`,
      JSON.stringify({ ...record(kv, key), keys: [other.publicKey] }),
    );
    kv.failing = true;
    for (const response of [
      await call(other, "GET", "/v1/instances/me"),
      await call(key, "POST", "/v1/instances/keys", { add: next.publicKey }),
      await call(next, "POST", "/v1/instances/contact", { contact: "oncall@example.com" }),
      await call(next, "POST", "/v1/instances", {
        terms: "draft-2026-11",
        contact: "oncall@example.com",
        code: "123456",
      }),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "registry_unavailable" });
    }
  });

  test("the send path's revocation check fails open on a KV error", async () => {
    const kv = fakeKv();
    const [revoked, registered, failing] = await Promise.all([
      generateInstanceKey(),
      generateInstanceKey(),
      generateInstanceKey(),
    ]);
    const base = { keys: [], terms: "draft-2026-11", contact: null, registeredAt: "" };
    kv.data.set(`instance:${revoked.instance}`, JSON.stringify({ ...base, status: "revoked" }));
    kv.data.set(
      `instance:${registered.instance}`,
      JSON.stringify({ ...base, status: "registered" }),
    );
    expect(await isRevoked(kv, revoked.instance, Date.now())).toBe(true);
    expect(await isRevoked(kv, registered.instance, Date.now())).toBe(false);
    kv.failing = true;
    expect(await isRevoked(kv, failing.instance, Date.now())).toBe(false);
    // Cached for 60 s: a revocation read before the outage still holds.
    expect(await isRevoked(kv, revoked.instance, Date.now())).toBe(true);
  });

  test("without REGISTRY every /v1 route is not_configured and /send still answers", async () => {
    const { call, env } = setup({ REGISTRY: undefined });
    const response = await call(await generateInstanceKey(), "GET", "/v1/instances/me");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    const send = await handle(
      new Request("https://relay.test/send", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: "{}",
      }),
      env,
      fetch,
    );
    expect(send.status).toBe(400);
  });
});

describe("POST /v1/instances/keys", () => {
  test("adds up to 3 keys, retires any but the signer's, and a rotated key then signs", async () => {
    const { kv, call, register } = setup();
    const key = await generateInstanceKey();
    const [second, third, fourth] = await Promise.all([
      generateInstanceKey(),
      generateInstanceKey(),
      generateInstanceKey(),
    ]);
    await register(key);
    expect((await call(key, "POST", "/v1/instances/keys", { add: second.publicKey })).status).toBe(
      200,
    );
    expect((await call(key, "POST", "/v1/instances/keys", { add: third.publicKey })).status).toBe(
      200,
    );
    const full = await call(key, "POST", "/v1/instances/keys", { add: fourth.publicKey });
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "too_many_keys" });

    // The rotated key signs, and retires the original.
    const self = await call(key, "POST", "/v1/instances/keys", { retire: key.publicKey });
    expect(await self.json()).toEqual({ error: "cannot_retire_signer" });
    const retired = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { retire: key.publicKey, add: fourth.publicKey },
      { signer: second },
    );
    expect(retired.status).toBe(200);
    expect(record(kv, key).keys).toEqual([second.publicKey, third.publicKey, fourth.publicKey]);
    // The retired original is refused, even though its id still matches.
    const old = await call(key, "GET", "/v1/instances/me");
    expect(await old.json()).toEqual({ error: "bad_signature" });
    const stranger = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { add: key.publicKey },
      {
        signer: await generateInstanceKey(),
      },
    );
    expect(stranger.status).toBe(401);
    const unknown = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { retire: key.publicKey },
      {
        signer: second,
      },
    );
    expect(await unknown.json()).toEqual({ error: "unknown_key" });
    const invalid = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { add: "short" },
      { signer: second },
    );
    expect(invalid.status).toBe(400);
  });
});
