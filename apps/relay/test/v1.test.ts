import { generateKeyPairSync } from "node:crypto";
import { generateRecipient, sealPush, toBase64url } from "@freecorps/brigade-push";
import { generateInstanceKey, signKeyProof, signRequest } from "@freecorps/brigade-push/instance";
import { describe, expect, test, vi } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";
import type { InstanceRecord } from "../src/registry.ts";
import { fakeRegistry } from "./fake-registry.ts";

type Key = Awaited<ReturnType<typeof generateInstanceKey>>;

// Throwaway keys, never real ones; example.com, not Google's domains.
const APNS_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const FCM_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "brigade-test",
  private_key_id: "key-1",
  private_key: generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString(),
  client_email: "relay@brigade-test.example.com",
  token_uri: "https://oauth2.example.com/token",
});
const PUSH_TOKEN = "a".repeat(64);
const VOIP_TOKEN = "c".repeat(64);
const FCM_TOKEN = "fcm-token_ABC:" + "x".repeat(140);
const CALL_ID = "6f1c2a4e-9b3d-4c5e-8f70-1a2b3c4d5e6f";

const randomKey = () => toBase64url(crypto.getRandomValues(new Uint8Array(32)));
const keyring = (current: string, keys: Record<string, string>) =>
  JSON.stringify({ current, keys });

const K1 = randomKey();
const K2 = randomKey();
const TAG_KEY = randomKey();

const RECORD: InstanceRecord = {
  status: "registered",
  keys: [],
  terms: "draft-2026-11",
  contact: "oncall@example.com",
  registeredAt: "2026-11-01T00:00:00.000Z",
};

/** A limiter that lets `max` calls through per key, and records the keys it saw. */
function limiter(max: number) {
  const counts = new Map<string, number>();
  return {
    counts,
    async limit({ key }: { key: string }) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: (counts.get(key) ?? 0) <= max };
    },
  };
}

/** Runs `fn` with the clock 61 s ahead, past the registry cache's 60 s: every read goes to the registry again. */
async function pastTheCache<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ["Date"] });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

const throwing = {
  async limit(): Promise<{ success: boolean }> {
    throw new Error("rate limiter unavailable");
  },
};

/** Fake APNs, Google's token endpoint and FCM, recording every request. */
function providers(apnsStatus = 200, apnsReason?: string) {
  const sent: Request[] = [];
  const send = async (request: Request) => {
    sent.push(request);
    const url = new URL(request.url);
    if (url.hostname === "oauth2.example.com") {
      return Response.json({ access_token: "access", expires_in: 3599 });
    }
    if (url.hostname === "fcm.googleapis.com") {
      return Response.json({ name: "projects/brigade-test/messages/0:123" });
    }
    return new Response(apnsReason ? JSON.stringify({ reason: apnsReason }) : null, {
      status: apnsStatus,
      headers: { "apns-id": "11111111-2222-3333-4444-555555555555" },
    });
  };
  const apns = () => sent.filter((r) => r.url.includes("push.apple.com"));
  const fcm = () => sent.filter((r) => r.url.startsWith("https://fcm.googleapis.com/"));
  return { sent, send, apns, fcm };
}

function setup(overrides: Partial<RelayEnv> = {}) {
  const registry = fakeRegistry();
  const env: RelayEnv = {
    APNS_ENVIRONMENT: "sandbox",
    APNS_TOPIC: "app.freecorps.brigade",
    APNS_KEY,
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    RELAY_SEND_TOKEN: "test-token",
    FCM_SERVICE_ACCOUNT,
    REGISTRY: registry,
    RELAY_TERMS_VERSION: "draft-2026-11",
    RELAY_HANDLE_KEYS: keyring("k1", { k1: K1 }),
    RELAY_TAG_KEY: TAG_KEY,
    ...overrides,
  };
  const fake = providers();

  /** A new instance, registered unless told otherwise. */
  const instance = async (record: Partial<InstanceRecord> | null = {}) => {
    const key = await generateInstanceKey();
    if (record !== null) {
      registry
        .storage(`instance:${key.instance}`)
        .set("record", { ...RECORD, keys: [key.publicKey], ...record });
    }
    return key;
  };

  const mint = (body: unknown, options: { ip?: string; env?: RelayEnv } = {}) =>
    handle(
      new Request("https://relay.test/v1/handles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.ip ? { "CF-Connecting-IP": options.ip } : {}),
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      options.env ?? env,
      fake.send,
    );

  /** Mints and answers `{ handle, tag }`, failing the test unless it is a 200. */
  const handleFor = async (key: Key, body: Record<string, unknown> = {}, useEnv = env) => {
    const response = await mint(
      {
        instance: key.instance,
        platform: "ios",
        environment: "production",
        pushToken: PUSH_TOKEN,
        voipToken: VOIP_TOKEN,
        ...body,
      },
      { env: useEnv },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { handle: string; tag: string };
  };

  const signed = async (
    key: Key,
    method: string,
    path: string,
    body: unknown,
    options: {
      signer?: Key;
      now?: number;
      env?: RelayEnv;
      send?: typeof fake.send;
      ip?: string;
    } = {},
  ) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const signer = options.signer ?? key;
    const headers = await signRequest({
      privateKey: signer.privateKey,
      publicKey: signer.publicKey,
      instance: key.instance,
      method,
      path,
      body: text,
      now: options.now ?? Date.now(),
    });
    return handle(
      new Request(`https://relay.test${path}`, {
        method,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          ...(options.ip ? { "CF-Connecting-IP": options.ip } : {}),
        },
        ...(body === undefined ? {} : { body: text }),
      }),
      options.env ?? env,
      options.send ?? fake.send,
    );
  };

  const sendV1 = async (
    key: Key,
    handleValue: unknown,
    overrides: Record<string, unknown> = {},
    options: Parameters<typeof signed>[4] = {},
  ) => {
    const recipient = await generateRecipient();
    const envelope = await sealPush(toBase64url(recipient.publicKey), { title: "t", body: "b" });
    return signed(
      key,
      "POST",
      "/v1/send",
      { handle: handleValue, envelope, urgency: "page", ...overrides },
      options,
    );
  };

  return { env, registry, fake, instance, mint, handleFor, signed, sendV1 };
}

describe("POST /v1/handles", () => {
  test("seals a phone's tokens for a registered instance; the instance sends with the handle alone", async () => {
    const { instance, handleFor, sendV1, fake } = setup();
    const key = await instance();
    const { handle: sealed, tag } = await handleFor(key);
    expect(sealed).toMatch(/^k1\.[A-Za-z0-9_-]+$/);
    // Nothing of the token shows.
    expect(sealed).not.toContain(PUSH_TOKEN);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const alert = await sendV1(key, sealed);
    expect(alert.status).toBe(200);
    expect(await alert.json()).toMatchObject({
      status: 200,
      apnsId: "11111111-2222-3333-4444-555555555555",
    });
    // The sealed environment's host, and the push token.
    expect(fake.apns()[0]?.url).toBe(`https://api.push.apple.com/3/device/${PUSH_TOKEN}`);
    expect(fake.apns()[0]?.headers.get("apns-push-type")).toBe("alert");

    // A call rings through the PushKit token.
    const call = await sendV1(key, sealed, { kind: "call", callId: CALL_ID, urgency: undefined });
    expect(call.status).toBe(200);
    expect(fake.apns()[1]?.url).toBe(`https://api.push.apple.com/3/device/${VOIP_TOKEN}`);
    expect(fake.apns()[1]?.headers.get("apns-push-type")).toBe("voip");
  });

  test("an Android handle goes through FCM", async () => {
    const { instance, handleFor, sendV1, fake } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key, {
      platform: "android",
      environment: undefined,
      pushToken: FCM_TOKEN,
      voipToken: undefined,
    });
    const response = await sendV1(key, sealed, {
      kind: "call",
      callId: CALL_ID,
      urgency: undefined,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 200, fcmId: "0:123" });
    const message = ((await fake.fcm()[0]!.json()) as { message: { token: string } }).message;
    expect(message.token).toBe(FCM_TOKEN);
    expect(fake.apns()).toHaveLength(0);
  });

  test("validates the body strictly; unknown fields are ignored", async () => {
    const { instance, mint } = setup();
    const key = await instance();
    const good = {
      instance: key.instance,
      platform: "ios",
      environment: "sandbox",
      pushToken: PUSH_TOKEN,
    };
    expect((await mint({ ...good, appVersion: "2.0" })).status).toBe(200);
    for (const body of [
      "not json",
      [],
      { ...good, instance: "ins_short" },
      { ...good, instance: 1 },
      { ...good, platform: "windows" },
      { ...good, environment: undefined },
      { ...good, environment: "staging" },
      { ...good, pushToken: "nothex" },
      { ...good, pushToken: "a".repeat(63) },
      { ...good, pushToken: undefined },
      { ...good, voipToken: "nothex" },
      { ...good, voipToken: 5 },
      { ...good, platform: "android", pushToken: "bad token with spaces" },
      { ...good, platform: "android", pushToken: FCM_TOKEN, voipToken: VOIP_TOKEN },
      { ...good, pad: "x".repeat(9000) },
    ]) {
      expect((await mint(body)).status, JSON.stringify(body).slice(0, 120)).toBe(400);
    }
  });

  test("an iOS token's case never changes its tag", async () => {
    const { instance, handleFor } = setup();
    const key = await instance();
    const lower = await handleFor(key, { pushToken: PUSH_TOKEN });
    const upper = await handleFor(key, { pushToken: PUSH_TOKEN.toUpperCase() });
    expect(upper.tag).toBe(lower.tag);
  });

  test("only for a registered instance that is not revoked, and fails closed when the registry cannot say", async () => {
    const { instance, mint, registry } = setup();
    const body = (key: Key) => ({
      instance: key.instance,
      platform: "ios",
      environment: "sandbox",
      pushToken: PUSH_TOKEN,
    });
    const unknown = await instance(null);
    const unregistered = await mint(body(unknown));
    expect(unregistered.status).toBe(403);
    expect(await unregistered.json()).toEqual({ error: "instance_unregistered" });
    const revoked = await mint(body(await instance({ status: "revoked" })));
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).toEqual({ error: "instance_revoked" });
    // A registered instance this isolate has not cached yet: the registry must answer.
    const fresh = await instance();
    registry.failing = true;
    const down = await mint(body(fresh));
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ error: "registry_unavailable" });
  });

  test("without the handle keys, or the registry, it is not configured; a broken keyring is the relay's error", async () => {
    const { instance, mint, env } = setup();
    const key = await instance();
    const body = {
      instance: key.instance,
      platform: "ios",
      environment: "sandbox",
      pushToken: PUSH_TOKEN,
    };
    for (const broken of [
      { ...env, RELAY_HANDLE_KEYS: undefined },
      { ...env, RELAY_TAG_KEY: undefined },
      { ...env, REGISTRY: undefined },
    ]) {
      const response = await mint(body, { env: broken });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
    for (const broken of [
      { ...env, RELAY_HANDLE_KEYS: "not json" },
      { ...env, RELAY_HANDLE_KEYS: keyring("k9", { k1: K1 }) },
      { ...env, RELAY_HANDLE_KEYS: keyring("k1", { k1: "c2hvcnQ" }) },
      { ...env, RELAY_TAG_KEY: "c2hvcnQ" },
    ]) {
      const response = await mint(body, { env: broken });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "relay_misconfigured" });
    }
  });

  test("HANDLE_LIMIT bounds minting per caller IP; a limiter that throws lets it through", async () => {
    const perIp = limiter(2);
    const { instance, mint, env } = setup({ HANDLE_LIMIT: perIp });
    const key = await instance();
    const body = {
      instance: key.instance,
      platform: "ios",
      environment: "sandbox",
      pushToken: PUSH_TOKEN,
    };
    expect((await mint(body, { ip: "192.0.2.1" })).status).toBe(200);
    expect((await mint(body, { ip: "192.0.2.1" })).status).toBe(200);
    const limited = await mint(body, { ip: "192.0.2.1" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "ip" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    // Counted before the body is read: a bad one counts too.
    expect((await mint("junk", { ip: "192.0.2.1" })).status).toBe(429);
    expect((await mint(body, { ip: "192.0.2.2" })).status).toBe(200);
    expect(
      (await mint(body, { ip: "192.0.2.1", env: { ...env, HANDLE_LIMIT: throwing } })).status,
    ).toBe(200);
  });
});

describe("handle keys and tags", () => {
  test("after a rotation the old key id still opens, and new handles use the current key", async () => {
    const { instance, handleFor, sendV1, env } = setup();
    const key = await instance();
    const old = await handleFor(key);
    const rotated = { ...env, RELAY_HANDLE_KEYS: keyring("k2", { k1: K1, k2: K2 }) };
    const fresh = await handleFor(key, {}, rotated);
    expect(old.handle.startsWith("k1.")).toBe(true);
    expect(fresh.handle.startsWith("k2.")).toBe(true);
    expect((await sendV1(key, old.handle, {}, { env: rotated })).status).toBe(200);
    expect((await sendV1(key, fresh.handle, {}, { env: rotated })).status).toBe(200);
    // The tag never rotates with the handle keys.
    expect(fresh.tag).toBe(old.tag);
    // A retired key (a leaked one) opens nothing any more.
    const retired = { ...env, RELAY_HANDLE_KEYS: keyring("k2", { k2: K2 }) };
    const refused = await sendV1(key, old.handle, {}, { env: retired });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "bad_handle" });
  });

  test("every sealing differs; the tag is the same for one token at one instance, and differs per instance and token", async () => {
    const { instance, handleFor } = setup();
    const a = await instance();
    const b = await instance();
    const first = await handleFor(a);
    const second = await handleFor(a);
    expect(second.handle).not.toBe(first.handle);
    expect(second.tag).toBe(first.tag);
    // Without the VoIP token, or with another one: the same phone, the same tag.
    expect((await handleFor(a, { voipToken: undefined })).tag).toBe(first.tag);
    expect((await handleFor(b)).tag).not.toBe(first.tag);
    expect((await handleFor(a, { pushToken: "d".repeat(64) })).tag).not.toBe(first.tag);
  });

  test("a tampered, foreign or malformed handle is a 400 bad_handle, and nothing is sent", async () => {
    const { instance, handleFor, sendV1, fake } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    const [id, body] = sealed.split(".") as [string, string];
    const flipped = body.slice(0, 20) + (body[20] === "A" ? "B" : "A") + body.slice(21);
    // Sealed by another relay under the same key id.
    const foreign = setup({ RELAY_HANDLE_KEYS: keyring("k1", { k1: randomKey() }) });
    foreign.registry
      .storage(`instance:${key.instance}`)
      .set("record", { ...RECORD, keys: [key.publicKey] });
    const { handle: theirs } = await foreign.handleFor(key);
    for (const bad of [
      `${id}.${flipped}`,
      `k2.${body}`,
      theirs,
      body,
      `${id}.`,
      `${id}.!!!`,
      `${id}.${"A".repeat(5000)}`,
      42,
      undefined,
    ]) {
      const response = await sendV1(key, bad);
      expect(response.status, String(bad).slice(0, 40)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad_handle" });
    }
    expect(fake.sent).toHaveLength(0);
  });

  test("a handle sealed for another instance is 403 handle_not_yours", async () => {
    const { instance, handleFor, sendV1, fake } = setup();
    const owner = await instance();
    const other = await instance();
    const { handle: sealed } = await handleFor(owner);
    const response = await sendV1(other, sealed);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "handle_not_yours" });
    expect(fake.sent).toHaveLength(0);
  });
});

describe("POST /v1/send", () => {
  test("needs a valid, fresh signature", async () => {
    const { instance, handleFor, sendV1, env, fake } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    const stale = await sendV1(key, sealed, {}, { now: Date.now() - 10 * 60_000 });
    expect(await stale.json()).toEqual({ error: "stale_timestamp" });
    expect(stale.status).toBe(401);
    const forged = await sendV1(key, sealed, {}, { signer: await generateInstanceKey() });
    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({ error: "bad_signature" });
    // The bearer token of `/send` is no signature.
    const bearer = await handle(
      new Request("https://relay.test/v1/send", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: JSON.stringify({ handle: sealed }),
      }),
      env,
      fake.send,
    );
    expect(bearer.status).toBe(401);
    expect(await bearer.json()).toEqual({ error: "missing_signature" });
    expect(fake.sent).toHaveLength(0);
  });

  test("answers like /send: a provider's refusal is a 502 with its reason, a bad body a 400", async () => {
    const { instance, handleFor, sendV1 } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    const refused = await sendV1(key, sealed, {}, { send: providers(410, "Unregistered").send });
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ status: 410, reason: "Unregistered" });
    for (const body of [
      { urgency: "urgent" },
      { envelope: { v: 1, enc: "AAAA", ct: "AAAA" } },
      { urgency: "page", ttlSeconds: 0 },
      { collapseId: 5 },
    ]) {
      expect((await sendV1(key, sealed, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  test("calls and Critical Alerts are still a page's only; a handle without a VoIP token cannot ring", async () => {
    const { instance, handleFor, sendV1, fake } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    for (const body of [
      { kind: "call", callId: CALL_ID, urgency: "high" },
      { kind: "call" },
      { critical: true, urgency: "high" },
      { critical: true, kind: "call", callId: CALL_ID },
    ]) {
      expect((await sendV1(key, sealed, body)).status, JSON.stringify(body)).toBe(400);
    }
    const { handle: noVoip } = await handleFor(key, { voipToken: undefined });
    const call = await sendV1(key, noVoip, { kind: "call", callId: CALL_ID, urgency: undefined });
    expect(call.status).toBe(400);
    expect(await call.json()).toMatchObject({ error: "invalid_body" });
    expect(fake.sent).toHaveLength(0);
    expect((await sendV1(key, sealed, { critical: true })).status).toBe(200);
  });

  test("a revoked instance is 403 instance_revoked", async () => {
    const { instance, handleFor, sendV1, registry, fake } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    // Revoked after the handle was minted. The mint cached the record: the revocation applies once its 60 s pass.
    registry
      .storage(`instance:${key.instance}`)
      .set("record", { ...RECORD, status: "revoked", keys: [] });
    expect((await sendV1(key, sealed)).status).toBe(200);
    const response = await pastTheCache(() => sendV1(key, sealed));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "instance_revoked" });
    expect(fake.apns()).toHaveLength(1);
  });

  test("an unreachable registry never stops a page on the original key, but a rotated key it cannot confirm is a 503", async () => {
    const { instance, handleFor, sendV1, registry, fake } = setup();
    // Both minted while the registry answered; neither read since by this isolate's send path.
    const original = await instance();
    const { handle: sealed } = await handleFor(original);
    const rotatedKey = await generateInstanceKey();
    const rotating = await instance();
    registry
      .storage(`instance:${rotating.instance}`)
      .set("record", { ...RECORD, keys: [rotating.publicKey, rotatedKey.publicKey] });
    const { handle: rotatingHandle } = await handleFor(rotating);
    // The rotated key works while the registry confirms it.
    expect((await sendV1(rotating, rotatingHandle, {}, { signer: rotatedKey })).status).toBe(200);

    registry.failing = true;
    // Past the cache's 60 s, so each send has to ask the registry, which does not answer: the page goes out anyway.

    const page = await pastTheCache(() => sendV1(original, sealed));
    expect(page.status).toBe(200);
    const unconfirmed = await pastTheCache(() =>
      sendV1(rotating, rotatingHandle, {}, { signer: rotatedKey }),
    );
    expect(unconfirmed.status).toBe(503);
    expect(await unconfirmed.json()).toEqual({ error: "registry_unavailable" });
    expect(fake.apns()).toHaveLength(2);
  });

  test("a key the instance's record does not list is a 401", async () => {
    const { instance, handleFor, sendV1 } = setup();
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    const stranger = await generateInstanceKey();
    const response = await sendV1(key, sealed, {}, { signer: stranger });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "bad_signature" });
  });

  test("a retired original key (one that leaked) cannot send, in this isolate or another", async () => {
    const { instance, handleFor, sendV1, signed, registry, fake } = setup();
    const original = await instance();
    const next = await generateInstanceKey();
    const { handle: sealed } = await handleFor(original);
    expect((await sendV1(original, sealed)).status).toBe(200);
    // Add the new key, then retire the original with it, through the relay (this isolate's cache follows).
    const add = await signed(original, "POST", "/v1/instances/keys", {
      add: next.publicKey,
      proof: await signKeyProof(next.privateKey, original.instance),
    });
    expect(add.status).toBe(200);
    const retire = await signed(
      original,
      "POST",
      "/v1/instances/keys",
      { retire: original.publicKey },
      { signer: next },
    );
    expect(retire.status).toBe(200);
    const refused = await sendV1(original, sealed);
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "bad_signature" });
    // The new key sends with the same handle.
    expect((await sendV1(original, sealed, {}, { signer: next })).status).toBe(200);

    // Retired in another isolate: this one's cached record still lists the key until its 60 s pass.
    const other = await instance();
    const { handle: theirs } = await handleFor(other);
    registry
      .storage(`instance:${other.instance}`)
      .set("record", { ...RECORD, keys: [next.publicKey] });
    const later = await pastTheCache(() => sendV1(other, theirs));
    expect(later.status).toBe(401);
    expect(await later.json()).toEqual({ error: "bad_signature" });
    // Neither refusal reached APNs.
    expect(fake.apns()).toHaveLength(2);
  });

  test("a made-up instance id never forces a registry read: the handle is checked first", async () => {
    const { instance, handleFor, sendV1, registry } = setup();
    const owner = await instance();
    const { handle: sealed } = await handleFor(owner);
    const reads = () => registry.calls.get("record") ?? 0;
    const before = reads();
    for (let i = 0; i < 5; i++) {
      // Self-signed by a brand-new id: a junk handle, then a real one sealed for someone else.
      const stranger = await generateInstanceKey();
      expect((await sendV1(stranger, "k1.AAAA")).status).toBe(400);
      expect((await sendV1(stranger, sealed)).status).toBe(403);
    }
    expect(reads()).toBe(before);
  });
});

describe("limits on /v1/send", () => {
  test("narrowest first: a send refused per phone or as a call does not use up the instance's minute", async () => {
    const perPhone = limiter(1);
    const calls = limiter(1);
    const perInstance = limiter(100);
    const { instance, handleFor, sendV1 } = setup({
      PHONE_LIMIT: perPhone,
      CALL_LIMIT: calls,
      SEND_LIMIT: perInstance,
    });
    const key = await instance();
    const first = await handleFor(key);
    const second = await handleFor(key, { pushToken: "d".repeat(64) });
    const call = { kind: "call", callId: CALL_ID, urgency: undefined };
    expect((await sendV1(key, first.handle)).status).toBe(200);
    expect(perInstance.counts.get(key.instance)).toBe(1);
    // The phone is over its limit: neither the calls nor the instance are charged.
    expect((await sendV1(key, first.handle, call)).status).toBe(429);
    expect(calls.counts.get(key.instance)).toBeUndefined();
    expect(perInstance.counts.get(key.instance)).toBe(1);
    // Another phone: the call goes out, and the next one is over the call limit, which charges the instance nothing.
    expect((await sendV1(key, second.handle, call)).status).toBe(200);
    expect(perInstance.counts.get(key.instance)).toBe(2);
    const third = await handleFor(key, { pushToken: "e".repeat(64) });
    const overCalls = await sendV1(key, third.handle, call);
    expect(await overCalls.json()).toEqual({ error: "rate_limited", limit: "calls" });
    expect(perInstance.counts.get(key.instance)).toBe(2);
    // It still counted against the narrower phone limit it passed.
    expect(perPhone.counts.get(third.tag)).toBe(1);
  });

  test("SEND_LIMIT per instance id, pages included", async () => {
    const perInstance = limiter(2);
    const { instance, handleFor, sendV1, fake } = setup({ SEND_LIMIT: perInstance });
    const key = await instance();
    const other = await instance();
    const { handle: sealed } = await handleFor(key);
    expect((await sendV1(key, sealed)).status).toBe(200);
    expect((await sendV1(key, sealed, { urgency: "high" })).status).toBe(200);
    const limited = await sendV1(key, sealed, { urgency: "page" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "instance" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect([...perInstance.counts.keys()]).toEqual([key.instance]);
    // Another instance has its own.
    const { handle: theirs } = await handleFor(other);
    expect((await sendV1(other, theirs)).status).toBe(200);
    expect(fake.apns()).toHaveLength(3);
  });

  test("CALL_LIMIT counts calls only, per instance id", async () => {
    const calls = limiter(1);
    const { instance, handleFor, sendV1 } = setup({ CALL_LIMIT: calls });
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    const call = { kind: "call", callId: CALL_ID, urgency: undefined };
    expect((await sendV1(key, sealed, call)).status).toBe(200);
    const limited = await sendV1(key, sealed, call);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "calls" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    // Alerts still go out.
    expect((await sendV1(key, sealed)).status).toBe(200);
    expect(calls.counts.get(key.instance)).toBe(2);
  });

  test("PHONE_LIMIT is keyed by the tag: every handle of one token counts together", async () => {
    const perPhone = limiter(2);
    const { instance, handleFor, sendV1 } = setup({ PHONE_LIMIT: perPhone });
    const key = await instance();
    const first = await handleFor(key);
    const second = await handleFor(key, { voipToken: undefined });
    const otherPhone = await handleFor(key, { pushToken: "d".repeat(64) });
    expect((await sendV1(key, first.handle)).status).toBe(200);
    expect((await sendV1(key, second.handle)).status).toBe(200);
    const limited = await sendV1(key, first.handle);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "phone" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await sendV1(key, otherPhone.handle)).status).toBe(200);
    expect([...perPhone.counts.keys()].sort()).toEqual([first.tag, otherPhone.tag].sort());
  });

  test("a malformed send uses up nothing; a limiter that throws lets the page through", async () => {
    const perInstance = limiter(1);
    const { instance, handleFor, sendV1, env } = setup({ SEND_LIMIT: perInstance });
    const key = await instance();
    const { handle: sealed } = await handleFor(key);
    expect((await sendV1(key, sealed, { urgency: "urgent" })).status).toBe(400);
    expect((await sendV1(key, "nope")).status).toBe(400);
    expect(perInstance.counts.size).toBe(0);
    const failing = { ...env, SEND_LIMIT: throwing, CALL_LIMIT: throwing, PHONE_LIMIT: throwing };
    expect((await sendV1(key, sealed, {}, { env: failing })).status).toBe(200);
    expect(
      (
        await sendV1(
          key,
          sealed,
          { kind: "call", callId: CALL_ID, urgency: undefined },
          { env: failing },
        )
      ).status,
    ).toBe(200);
  });
});

describe("GET /v1/health?deep=1", () => {
  test("signed by a registered instance, it answers the providers' state", async () => {
    const { instance, signed } = setup({ FCM_SERVICE_ACCOUNT: undefined });
    const key = await instance();
    const response = await signed(key, "GET", "/v1/health?deep=1", undefined, {
      send: providers(400, "BadDeviceToken").send,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      apns: { status: "ok" },
      fcm: { status: "not_configured" },
      handles: true,
      instance: key.instance,
    });
    const down = await signed(key, "GET", "/v1/health?deep=1", undefined, {
      send: providers(403, "InvalidProviderToken").send,
    });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({
      ok: false,
      apns: { reason: "InvalidProviderToken" },
    });
  });

  test("HEALTH_LIMIT bounds checks per caller IP before the registry is read; a limiter that throws lets it through", async () => {
    const perIp = limiter(2);
    const { instance, signed, registry, env } = setup({
      FCM_SERVICE_ACCOUNT: undefined,
      HEALTH_LIMIT: perIp,
    });
    const ok = providers(400, "BadDeviceToken").send;
    const ip = "192.0.2.7";
    const reads = () => registry.calls.get("record") ?? 0;
    // Made-up ids, each a registry read (a missing record is never cached), until the IP's limit.
    for (let i = 0; i < 2; i++) {
      const response = await signed(await instance(null), "GET", "/v1/health?deep=1", undefined, {
        send: ok,
        ip,
      });
      expect(response.status).toBe(403);
    }
    const before = reads();
    const limited = await signed(await instance(null), "GET", "/v1/health?deep=1", undefined, {
      send: ok,
      ip,
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "ip" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect(reads()).toBe(before);
    // Another IP is not limited, nor is anyone when the limiter fails.
    const key = await instance();
    expect(
      (await signed(key, "GET", "/v1/health?deep=1", undefined, { send: ok, ip: "192.0.2.8" }))
        .status,
    ).toBe(200);
    expect(
      (
        await signed(key, "GET", "/v1/health?deep=1", undefined, {
          send: ok,
          ip,
          env: { ...env, HEALTH_LIMIT: throwing },
        })
      ).status,
    ).toBe(200);
  });

  test("says why an instance cannot page: unregistered, revoked, a bad signature, no handle keys, the limit", async () => {
    const { instance, signed, env } = setup({ FCM_SERVICE_ACCOUNT: undefined });
    const ok = providers(400, "BadDeviceToken").send;
    const unregistered = await signed(await instance(null), "GET", "/v1/health?deep=1", undefined, {
      send: ok,
    });
    expect(unregistered.status).toBe(403);
    expect(await unregistered.json()).toEqual({ error: "instance_unregistered" });
    const revoked = await signed(
      await instance({ status: "revoked" }),
      "GET",
      "/v1/health?deep=1",
      undefined,
      { send: ok },
    );
    expect(await revoked.json()).toEqual({ error: "instance_revoked" });
    const key = await instance();
    // The query is signed: a signature for `/v1/health` does not fit `?deep=1`.
    const headers = await signRequest({
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      instance: key.instance,
      method: "GET",
      path: "/v1/health",
      body: "",
      now: Date.now(),
    });
    const unsigned = await handle(
      new Request("https://relay.test/v1/health?deep=1", { headers }),
      env,
      ok,
    );
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toEqual({ error: "bad_signature" });
    const noKeys = await signed(key, "GET", "/v1/health?deep=1", undefined, {
      send: ok,
      env: { ...env, RELAY_HANDLE_KEYS: undefined },
    });
    expect(noKeys.status).toBe(503);
    expect(await noKeys.json()).toMatchObject({
      ok: false,
      apns: { status: "ok" },
      handles: false,
    });
    const limited = await signed(key, "GET", "/v1/health?deep=1", undefined, {
      send: ok,
      env: { ...env, SEND_LIMIT: limiter(0) },
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", limit: "instance" });
  });

  test("without deep=1 it is the plain health; other methods are refused", async () => {
    const { env, fake } = setup();
    expect(
      await (await handle(new Request("https://relay.test/v1/health"), env, fake.send)).json(),
    ).toEqual({ ok: true });
    expect((await handle(new Request("https://relay.test/v1/send"), env, fake.send)).status).toBe(
      405,
    );
    expect(
      (
        await handle(
          new Request("https://relay.test/v1/health?deep=1", { method: "POST" }),
          env,
          fake.send,
        )
      ).status,
    ).toBe(405);
  });
});

describe("the old /send", () => {
  test("keeps working with the bearer token, untouched by the v1 limits", async () => {
    const none = limiter(0);
    const { env, fake } = setup({
      SEND_LIMIT: none,
      PHONE_LIMIT: none,
      CALL_LIMIT: none,
      HANDLE_LIMIT: none,
    });
    const recipient = await generateRecipient();
    const envelope = await sealPush(toBase64url(recipient.publicKey), { title: "t", body: "b" });
    const response = await handle(
      new Request("https://relay.test/send", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: JSON.stringify({
          deviceToken: PUSH_TOKEN,
          envelope,
          urgency: "page",
          environment: "production",
        }),
      }),
      env,
      fake.send,
    );
    expect(response.status).toBe(200);
    expect(fake.apns()[0]?.url).toBe(`https://api.push.apple.com/3/device/${PUSH_TOKEN}`);
    expect(none.counts.size).toBe(0);
    // Nor does it take a handle.
    const withHandle = await handle(
      new Request("https://relay.test/send", {
        method: "POST",
        headers: { Authorization: "Bearer test-token" },
        body: JSON.stringify({ handle: "k1.AAAA", envelope }),
      }),
      env,
      fake.send,
    );
    expect(withHandle.status).toBe(400);
  });
});
