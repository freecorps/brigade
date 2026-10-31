import { generateInstanceKey, signKeyProof, signRequest } from "@freecorps/brigade-push";
import { describe, expect, test } from "vite-plus/test";
import { handle, type RelayEnv } from "../src/index.ts";
import {
  RegistryDO,
  isRevoked,
  type InstanceRecord,
  type RegistryNamespace,
  type RegistryStub,
} from "../src/registry.ts";

type Key = Awaited<ReturnType<typeof generateInstanceKey>>;
type Answer = { error?: string; triesLeft?: number };

/**
 * The registry's namespace over real `RegistryDO`s, each with a Map for its storage. Like an RPC call, every call
 * yields once and copies its arguments and result; the methods are synchronous, so calls to one object never
 * interleave, as in workerd. `failing` makes every call throw, like an unreachable object.
 */
function fakeRegistry() {
  const storage = new Map<string, Map<string, unknown>>();
  const objects = new Map<string, RegistryDO>();
  const alarms = new Map<string, number>();
  const object = (name: string): RegistryDO => {
    let found = objects.get(name);
    if (!found) {
      const data = registry.storage(name);
      const kv = {
        get: (key: string) => structuredClone(data.get(key)),
        put: (key: string, value: unknown) => void data.set(key, structuredClone(value)),
        delete: (key: string) => data.delete(key),
      };
      // Only `storage.kv`, the alarm and `deleteAll` are used by the class.
      const state = {
        storage: {
          kv,
          setAlarm: async (at: number) => void alarms.set(name, at),
          deleteAll: async () => {
            data.clear();
            alarms.delete(name);
          },
        },
      };
      found = new RegistryDO(state as unknown as DurableObjectState, {} as Cloudflare.Env);
      objects.set(name, found);
    }
    return found;
  };
  const registry = {
    failing: false,
    /** How many times each method was called, on any object. */
    calls: new Map<string, number>(),
    storage(name: string): Map<string, unknown> {
      let data = storage.get(name);
      if (!data) storage.set(name, (data = new Map()));
      return data;
    },
    /** When the object's alarm is set for, if it is. */
    alarmAt: (name: string) => alarms.get(name),
    /** Runs the object's alarm, as workerd would at its time. */
    async fireAlarm(name: string) {
      alarms.delete(name);
      await object(name).alarm();
    },
    getByName(name: string): RegistryStub {
      const target = object(name);
      const rpc = <K extends keyof RegistryStub>(name: K) =>
        (async (...args: unknown[]) => {
          await Promise.resolve();
          if (registry.failing) throw new Error("Durable Object unreachable");
          registry.calls.set(name, (registry.calls.get(name) ?? 0) + 1);
          // Awaited for the async methods, whose check-and-update runs before their first await.
          const result: unknown = await Reflect.apply(target[name], target, structuredClone(args));
          return structuredClone(result);
        }) as RegistryStub[K];
      return {
        record: rpc("record"),
        canRequestCode: rpc("canRequestCode"),
        requestCode: rpc("requestCode"),
        takeAddressSlot: rpc("takeAddressSlot"),
        releaseAddressSlot: rpc("releaseAddressSlot"),
        register: rpc("register"),
        changeKeys: rpc("changeKeys"),
      };
    },
  } satisfies RegistryNamespace & Record<string, unknown>;
  return registry;
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

type CallOptions = {
  signer?: Key;
  now?: number;
  headers?: Record<string, string>;
  /** The path signed, when it differs from the one requested. */
  signedPath?: string;
};

function setup(overrides: Partial<RelayEnv> = {}) {
  const registry = fakeRegistry();
  const email = fakeEmail();
  const env: RelayEnv = {
    APNS_ENVIRONMENT: "sandbox",
    APNS_TOPIC: "app.freecorps.brigade",
    APNS_KEY: "unused",
    APNS_KEY_ID: "KEYID12345",
    APNS_TEAM_ID: "TEAMID1234",
    RELAY_SEND_TOKEN: "test-token",
    REGISTRY: registry,
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
    options: CallOptions = {},
  ) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const signer = options.signer ?? key;
    const signed = await signRequest({
      privateKey: signer.privateKey,
      publicKey: signer.publicKey,
      instance: key.instance,
      method,
      path: options.signedPath ?? path,
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
  const askCode = (key: Key, contact = "oncall@example.com", options: CallOptions = {}) =>
    call(key, "POST", "/v1/instances/contact", { contact }, options);
  const register = async (key: Key, contact = "oncall@example.com") => {
    expect((await askCode(key, contact)).status).toBe(200);
    return call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact,
      code: email.code(),
    });
  };
  const addKey = async (key: Key, added: Key, options: CallOptions = {}) =>
    call(
      key,
      "POST",
      "/v1/instances/keys",
      { add: added.publicKey, proof: await signKeyProof(added.privateKey, key.instance) },
      options,
    );
  const record = (key: Key) =>
    registry.storage(`instance:${key.instance}`).get("record") as InstanceRecord | undefined;
  return { env, registry, email, call, askCode, register, addKey, record };
}

const REVOKED: InstanceRecord = {
  status: "revoked",
  keys: [],
  terms: "draft-2026-11",
  contact: "oncall@example.com",
  registeredAt: "2026-11-01T00:00:00.000Z",
  revokedAt: "2026-11-02T00:00:00.000Z",
};

describe("registration on the hosted relay", () => {
  test("terms, contact and the emailed code register the original key", async () => {
    const { email, call, register, record, registry } = setup();
    const key = await generateInstanceKey();
    // Not registered yet, and never remembered as such: the same isolate sees the registration at once.
    expect((await call(key, "GET", "/v1/instances/me")).status).toBe(403);
    const response = await register(key);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      instance: key.instance,
      status: "registered",
      terms: "draft-2026-11",
      termsCurrent: true,
    });
    expect(record(key)).toMatchObject({
      status: "registered",
      keys: [key.publicKey],
      terms: "draft-2026-11",
      contact: "oncall@example.com",
    });
    expect(email.sent[0]).toMatchObject({ from: "relay@example.com", to: "oncall@example.com" });
    // The code is stored hashed, never as typed.
    const pending = registry.storage(`instance:${key.instance}`).get("code");
    expect(JSON.stringify(pending)).not.toContain(email.code());

    const again = await call(key, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(again.status).toBe(200);
    const me = await call(key, "GET", "/v1/instances/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ status: "registered", termsCurrent: true });
  });

  test("a wrong code counts a try; after five the code is spent", async () => {
    const { email, call, askCode } = setup();
    const key = await generateInstanceKey();
    await askCode(key);
    const wrong = email.code() === "000000" ? "000001" : "000000";
    const body = { terms: "draft-2026-11", contact: "oncall@example.com", code: wrong };
    const first = await call(key, "POST", "/v1/instances", body);
    expect(first.status).toBe(400);
    expect(await first.json()).toEqual({ error: "code_invalid", triesLeft: 4 });
    for (let i = 0; i < 4; i++) await call(key, "POST", "/v1/instances", body);
    const right = await call(key, "POST", "/v1/instances", { ...body, code: email.code() });
    expect(await right.json()).toEqual({ error: "code_expired" });
  });

  test("parallel guesses get five tries in all, not five each", async () => {
    const { email, call, askCode } = setup();
    const key = await generateInstanceKey();
    await askCode(key);
    const wrong = email.code() === "000000" ? "000001" : "000000";
    const body = { terms: "draft-2026-11", contact: "oncall@example.com", code: wrong };
    const answers = await Promise.all(
      Array.from({ length: 20 }, () =>
        call(key, "POST", "/v1/instances", body).then((r) => r.json() as Promise<Answer>),
      ),
    );
    const left = answers.map((a) => a.triesLeft).filter((t) => t !== undefined);
    expect(left.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(answers.filter((a) => a.error === "code_expired")).toHaveLength(15);
    const right = await call(key, "POST", "/v1/instances", { ...body, code: email.code() });
    expect(await right.json()).toEqual({ error: "code_expired" });
  });

  test("twenty wrong guesses and the right one at once: the right one counts as one of the five", async () => {
    const { email, call, askCode } = setup();
    const key = await generateInstanceKey();
    await askCode(key);
    const wrong = email.code() === "000000" ? "000001" : "000000";
    const body = { terms: "draft-2026-11", contact: "oncall@example.com" };
    const responses = await Promise.all([
      ...Array.from({ length: 20 }, () =>
        call(key, "POST", "/v1/instances", { ...body, code: wrong }),
      ),
      call(key, "POST", "/v1/instances", { ...body, code: email.code() }),
    ]);
    const answers = await Promise.all(responses.map((r) => r.json() as Promise<Answer>));
    const invalid = answers.filter((a) => a.error === "code_invalid").length;
    const created = responses.filter((r) => r.status === 201).length;
    expect(created).toBeLessThanOrEqual(1);
    expect(invalid + created).toBeLessThanOrEqual(5);
    // Once the tries were used up, the right code no longer registers.
    if (created === 0) expect(answers.at(-1)).toEqual({ error: "code_expired" });
  });

  test("the code is for the address it went to, and expires after 15 minutes", async () => {
    const { registry, email, call, askCode } = setup();
    const key = await generateInstanceKey();
    await askCode(key);
    const other = await call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact: "someone@example.com",
      code: email.code(),
    });
    expect(await other.json()).toMatchObject({ error: "code_invalid" });

    const storage = registry.storage(`instance:${key.instance}`);
    storage.set("code", { ...(storage.get("code") as object), expiresAt: Date.now() - 1 });
    const late = await call(key, "POST", "/v1/instances", {
      terms: "draft-2026-11",
      contact: "oncall@example.com",
      code: email.code(),
    });
    expect(await late.json()).toEqual({ error: "code_expired" });
  });

  test("at most 3 codes an hour per instance", async () => {
    const { email, askCode } = setup();
    const key = await generateInstanceKey();
    const addresses = ["a@example.com", "b@example.com", "c@example.com", "d@example.com"];
    for (const address of addresses.slice(0, 3))
      expect((await askCode(key, address)).status).toBe(200);
    const fourth = await askCode(key, addresses[3]);
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: "too_many_codes" });
    expect(Number(fourth.headers.get("Retry-After"))).toBeGreaterThan(3500);
    expect(email.sent).toHaveLength(3);
  });

  test("at most 3 codes an hour per address, whichever instances ask", async () => {
    const { email, askCode } = setup();
    for (let i = 0; i < 3; i++) {
      expect((await askCode(await generateInstanceKey(), "OnCall@example.com")).status).toBe(200);
    }
    // Another instance, same address in another case.
    const refused = await askCode(await generateInstanceKey(), "oncall@example.com");
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too_many_codes" });
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(3500);
    expect(email.sent).toHaveLength(3);
  });

  test("an address that is not one, or could break out of a header, is refused", async () => {
    const { askCode, email } = setup();
    const key = await generateInstanceKey();
    for (const contact of [
      "not an address",
      "a@b",
      "a@example.com\r\nBcc: x@example.com",
      '"a"@example.com',
      "a@example.com,b@example.com",
      "Name <a@example.com>",
      "a;b@example.com",
      "a\u0001@example.com",
      `${"a".repeat(250)}@example.com`,
    ]) {
      const response = await askCode(key, contact);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_contact" });
    }
    expect(email.sent).toHaveLength(0);
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
      const { askCode } = setup(env);
      const response = await askCode(await generateInstanceKey());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
  });

  test("a key other than the original cannot start an unregistered instance", async () => {
    const { call, askCode } = setup();
    const key = await generateInstanceKey();
    const stranger = await generateInstanceKey();
    const code = await call(
      key,
      "POST",
      "/v1/instances/contact",
      { contact: "oncall@example.com" },
      { signer: stranger },
    );
    expect(code.status).toBe(401);
    expect(await code.json()).toEqual({ error: "bad_signature" });
    await askCode(key);
    const registered = await call(
      key,
      "POST",
      "/v1/instances",
      { terms: "draft-2026-11", contact: "oncall@example.com", code: "123456" },
      { signer: stranger },
    );
    expect(registered.status).toBe(403);
    expect(await registered.json()).toEqual({ error: "instance_unregistered" });
  });

  test("a revoked instance cannot register again, ask for a code or pass /me", async () => {
    const { registry, call, askCode } = setup();
    const key = await generateInstanceKey();
    registry
      .storage(`instance:${key.instance}`)
      .set("record", { ...REVOKED, keys: [key.publicKey] });
    const again = await call(key, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({ error: "instance_revoked" });
    expect(await (await call(key, "GET", "/v1/instances/me")).json()).toEqual({
      error: "instance_revoked",
    });
    const code = await askCode(key);
    expect(code.status).toBe(403);
    expect(await code.json()).toEqual({ error: "instance_revoked" });
  });
});

describe("closed registration (an own relay)", () => {
  test("refuses registration and codes", async () => {
    const { call, askCode } = setup({ RELAY_REGISTRATION: "closed" });
    const key = await generateInstanceKey();
    const refused = await call(key, "POST", "/v1/instances", { terms: "draft-2026-11" });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "registration_closed" });
    expect(await (await askCode(key)).json()).toEqual({ error: "registration_closed" });
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
    for (const timestamp of ["-1", "1762000000.5", "1762000000000"]) {
      const odd = await call(key, "GET", "/v1/instances/me", undefined, {
        headers: { "Brigade-Timestamp": timestamp },
      });
      expect(await odd.json()).toEqual({ error: "bad_signature" });
    }
    const missing = await handle(new Request("https://relay.test/v1/instances/me"), env, fetch);
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "missing_signature" });
  });

  test("the query string is signed", async () => {
    const { call, register } = setup();
    const key = await generateInstanceKey();
    await register(key);
    const withQuery = await call(key, "GET", "/v1/instances/me?verbose=1");
    expect(withQuery.status).toBe(200);
    const dropped = await call(key, "GET", "/v1/instances/me", undefined, {
      signedPath: "/v1/instances/me?verbose=1",
    });
    expect(await dropped.json()).toEqual({ error: "bad_signature" });
  });

  test("a body over 8 KB is refused before anything else", async () => {
    const { call } = setup();
    const response = await call(await generateInstanceKey(), "POST", "/v1/instances", {
      terms: "x".repeat(9 * 1024),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_body" });
  });

  test("an unknown instance is unregistered; an unknown path, a 404", async () => {
    const { call } = setup();
    const key = await generateInstanceKey();
    const me = await call(key, "GET", "/v1/instances/me");
    expect(me.status).toBe(403);
    expect(await me.json()).toEqual({ error: "instance_unregistered" });
    expect((await call(key, "POST", "/v1/nothing", {})).status).toBe(404);
  });

  test("an unreachable registry fails every /v1/instances route closed", async () => {
    const { registry, call, register, addKey, askCode } = setup();
    const key = await generateInstanceKey();
    const next = await generateInstanceKey();
    await register(key);
    // A fresh instance, so the per-isolate cache does not answer for the registry.
    const other = await generateInstanceKey();
    registry.storage(`instance:${other.instance}`).set("record", {
      ...REVOKED,
      status: "registered",
      keys: [other.publicKey],
    });
    registry.failing = true;
    for (const response of [
      await call(other, "GET", "/v1/instances/me"),
      await addKey(key, next),
      await askCode(next),
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

  test("the send path's revocation check fails open, and caches only what exists", async () => {
    const registry = fakeRegistry();
    const [revoked, registered, failing] = await Promise.all([
      generateInstanceKey(),
      generateInstanceKey(),
      generateInstanceKey(),
    ]);
    registry.storage(`instance:${revoked.instance}`).set("record", REVOKED);
    registry
      .storage(`instance:${registered.instance}`)
      .set("record", { ...REVOKED, status: "registered" });
    expect(await isRevoked(registry, revoked.instance, Date.now())).toBe(true);
    expect(await isRevoked(registry, registered.instance, Date.now())).toBe(false);
    registry.failing = true;
    expect(await isRevoked(registry, failing.instance, Date.now())).toBe(false);
    // Cached for 60 s: a revocation read before the outage still holds, and is read again after.
    expect(await isRevoked(registry, revoked.instance, Date.now())).toBe(true);
    expect(await isRevoked(registry, revoked.instance, Date.now() + 61_000)).toBe(false);
  });

  test("without REGISTRY every /v1 path is not_configured, before routing, and /send still answers", async () => {
    const { call, env } = setup({ REGISTRY: undefined });
    for (const path of ["/v1/instances/me", "/v1/nothing"]) {
      const response = await call(await generateInstanceKey(), "GET", path);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
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
    const { call, register, addKey, record } = setup();
    const key = await generateInstanceKey();
    const [second, third, fourth] = await Promise.all([
      generateInstanceKey(),
      generateInstanceKey(),
      generateInstanceKey(),
    ]);
    await register(key);
    expect((await addKey(key, second)).status).toBe(200);
    expect((await addKey(key, third)).status).toBe(200);
    const full = await addKey(key, fourth);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ error: "too_many_keys" });

    const self = await call(key, "POST", "/v1/instances/keys", { retire: key.publicKey });
    expect(await self.json()).toEqual({ error: "cannot_retire_signer" });
    // The rotated key signs, and retires the original while adding another, in one call.
    const retired = await call(
      key,
      "POST",
      "/v1/instances/keys",
      {
        retire: key.publicKey,
        add: fourth.publicKey,
        proof: await signKeyProof(fourth.privateKey, key.instance),
      },
      { signer: second },
    );
    expect(retired.status).toBe(200);
    expect(record(key)?.keys).toEqual([second.publicKey, third.publicKey, fourth.publicKey]);
    // The retired original is refused, even though its id still matches.
    const old = await call(key, "GET", "/v1/instances/me");
    expect(await old.json()).toEqual({ error: "bad_signature" });
    const stranger = await addKey(key, await generateInstanceKey(), {
      signer: await generateInstanceKey(),
    });
    expect(stranger.status).toBe(401);
    const unknown = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { retire: key.publicKey },
      { signer: second },
    );
    expect(await unknown.json()).toEqual({ error: "unknown_key" });
    const invalid = await call(
      key,
      "POST",
      "/v1/instances/keys",
      { add: "short" },
      { signer: second },
    );
    expect(await invalid.json()).toEqual({ error: "invalid_body" });
  });

  test("a key is only added with its own proof", async () => {
    const { call, register, record } = setup();
    const key = await generateInstanceKey();
    const added = await generateInstanceKey();
    await register(key);
    const proofs = [
      undefined,
      "junk",
      // Signed by the signer, not by the new key.
      await signKeyProof(key.privateKey, key.instance),
      // The new key's proof, for another instance.
      await signKeyProof(added.privateKey, added.instance),
    ];
    for (const proof of proofs) {
      const response = await call(key, "POST", "/v1/instances/keys", {
        add: added.publicKey,
        ...(proof === undefined ? {} : { proof }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_proof" });
    }
    expect(record(key)?.keys).toEqual([key.publicKey]);
  });

  test("keys compare canonically: one key in two encodings counts once", async () => {
    const { call, register, record } = setup();
    const key = await generateInstanceKey();
    const added = await generateInstanceKey();
    await register(key);
    const proof = await signKeyProof(added.privateKey, key.instance);
    for (const encoding of [added.publicKey + "=", added.publicKey]) {
      const response = await call(key, "POST", "/v1/instances/keys", { add: encoding, proof });
      expect(response.status).toBe(200);
    }
    expect(record(key)?.keys).toEqual([key.publicKey, added.publicKey]);
    // A signer presenting its key padded is still the key in the record.
    const padded = await call(key, "GET", "/v1/instances/me", undefined, {
      headers: { "Brigade-Key": key.publicKey + "=" },
    });
    expect(padded.status).toBe(200);
    const retired = await call(key, "POST", "/v1/instances/keys", {
      retire: added.publicKey + "=",
    });
    expect(retired.status).toBe(200);
    expect(record(key)?.keys).toEqual([key.publicKey]);
  });

  test("two adds at once against two keys: exactly one fits", async () => {
    const { register, addKey, record } = setup();
    const key = await generateInstanceKey();
    const [second, third, fourth] = await Promise.all([
      generateInstanceKey(),
      generateInstanceKey(),
      generateInstanceKey(),
    ]);
    await register(key);
    await addKey(key, second);
    const responses = await Promise.all([addKey(key, third), addKey(key, fourth)]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const refused = responses.find((r) => r.status === 409)!;
    expect(await refused.json()).toEqual({ error: "too_many_keys" });
    expect(record(key)?.keys).toHaveLength(3);
  });

  test("a key retired in the last 10 minutes cannot be added back", async () => {
    const { registry, call, register, addKey, record } = setup();
    const key = await generateInstanceKey();
    const second = await generateInstanceKey();
    await register(key);
    await addKey(key, second);
    await call(key, "POST", "/v1/instances/keys", { retire: second.publicKey });
    const replayed = await addKey(key, second);
    expect(replayed.status).toBe(409);
    expect(await replayed.json()).toEqual({ error: "key_recently_retired" });
    // Eleven minutes later it may come back.
    const stored = record(key)!;
    registry.storage(`instance:${key.instance}`).set("record", {
      ...stored,
      retired: stored.retired?.map((r) => ({ ...r, at: r.at - 11 * 60_000 })),
    });
    expect((await addKey(key, second)).status).toBe(200);
  });
});

/** The contact object's name for an address, as src/instances.ts derives it. */
async function contactObject(address: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address));
  return `contact:${Buffer.from(digest).toString("hex")}`;
}

describe("limits on codes", () => {
  test("a registered instance cannot ask for a code, and costs the address nothing", async () => {
    const { registry, email, askCode, register } = setup();
    const key = await generateInstanceKey();
    await register(key);
    const again = await askCode(key, "other@example.com");
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_registered" });
    expect(email.sent).toHaveLength(1);
    expect(registry.storage(await contactObject("other@example.com")).get("sent")).toBeUndefined();
  });

  test("an instance over its own limit costs the address nothing", async () => {
    const { registry, askCode } = setup();
    const key = await generateInstanceKey();
    for (const address of ["a@example.com", "b@example.com", "c@example.com"]) {
      await askCode(key, address);
    }
    expect((await askCode(key, "victim@example.com")).status).toBe(429);
    expect(registry.storage(await contactObject("victim@example.com")).get("sent")).toBeUndefined();
  });

  test("several instances asking for one address at once: exactly 3 codes go out", async () => {
    const { email, askCode } = setup();
    const keys = await Promise.all(Array.from({ length: 6 }, () => generateInstanceKey()));
    const responses = await Promise.all(keys.map((key) => askCode(key, "oncall@example.com")));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    expect(email.sent).toHaveLength(3);
  });

  test("an instance refused in a race gives the address's slot back", async () => {
    const { registry, email, askCode } = setup();
    const key = await generateInstanceKey();
    // Two codes already this hour: both requests below pass the first check, only one can store a code.
    await askCode(key, "a@example.com");
    await askCode(key, "b@example.com");
    const responses = await Promise.all([
      askCode(key, "victim@example.com"),
      askCode(key, "victim@example.com"),
    ]);
    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([200, 429]);
    expect(email.sent).toHaveLength(3);
    // Both took a slot (the race happened); one code reached the address, and one slot is counted.
    expect(registry.calls.get("releaseAddressSlot")).toBe(1);
    expect(registry.storage(await contactObject("victim@example.com")).get("sent")).toHaveLength(1);
  });

  test("an email that fails gives the address's slot back", async () => {
    const { registry, askCode } = setup({
      EMAIL: {
        async send() {
          throw Object.assign(new Error("refused for oncall@example.com"), {
            code: "E_DELIVERY_FAILED",
          });
        },
      },
    });
    const response = await askCode(await generateInstanceKey());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "email_failed" });
    expect(registry.storage(await contactObject("oncall@example.com")).get("sent")).toEqual([]);
  });

  test("at most 10 codes a day per address", async () => {
    const { registry, askCode } = setup();
    const now = Date.now();
    const storage = registry.storage(await contactObject("oncall@example.com"));
    // Nine over the day, none in the last hour: one more fits, then the day is full.
    storage.set(
      "sent",
      Array.from({ length: 9 }, (_, i) => now - (2 + i) * 3600_000),
    );
    expect((await askCode(await generateInstanceKey())).status).toBe(200);
    const refused = await askCode(await generateInstanceKey());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: "too_many_codes" });
    // Until the oldest, 10 hours ago, leaves the 24-hour window.
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(13 * 3600);
  });

  test("CODE_LIMIT bounds codes and guesses per caller IP, before anything else", async () => {
    const counts = new Map<string, number>();
    const limiter = {
      async limit({ key }: { key: string }) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        // Two a key; calls without an IP (the helpers', from "unknown") are not limited here.
        return { success: key === "unknown" || (counts.get(key) ?? 0) <= 2 };
      },
    };
    const { email, call, askCode, register, addKey } = setup({ CODE_LIMIT: limiter });
    const ip = { headers: { "CF-Connecting-IP": "192.0.2.1" } };
    const key = await generateInstanceKey();
    expect((await askCode(key, "a@example.com", ip)).status).toBe(200);
    const guess = { terms: "draft-2026-11", contact: "a@example.com", code: "000000" };
    expect((await call(key, "POST", "/v1/instances", guess, ip)).status).toBe(400);
    const limited = await call(key, "POST", "/v1/instances", guess, ip);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(limited.headers.get("Retry-After")).toBe("60");
    expect((await askCode(key, "b@example.com", ip)).status).toBe(429);
    expect(email.sent).toHaveLength(1);
    // /me and key changes are limited too: a key a record does not list forces a fresh read each time.
    expect((await call(key, "GET", "/v1/instances/me", undefined, ip)).status).toBe(429);
    expect((await addKey(key, await generateInstanceKey(), ip)).status).toBe(429);
    // Another caller is not limited.
    const other = await generateInstanceKey();
    expect((await register(other, "c@example.com")).status).toBe(201);
    expect((await call(other, "GET", "/v1/instances/me")).status).toBe(200);
  });
});

describe("the per-isolate cache", () => {
  test("a key missing from a cached record is looked up again before it is refused", async () => {
    const { registry, call, register, record } = setup();
    const key = await generateInstanceKey();
    const added = await generateInstanceKey();
    await register(key);
    expect((await call(key, "GET", "/v1/instances/me")).status).toBe(200);
    // Another isolate adds a key: this one's cache does not have it.
    registry
      .storage(`instance:${key.instance}`)
      .set("record", { ...record(key)!, keys: [key.publicKey, added.publicKey] });
    const rotated = await call(key, "GET", "/v1/instances/me", undefined, { signer: added });
    expect(rotated.status).toBe(200);
  });

  test("and when that lookup fails, the answer is 503, not a refusal", async () => {
    const { registry, call, register } = setup();
    const key = await generateInstanceKey();
    await register(key);
    expect((await call(key, "GET", "/v1/instances/me")).status).toBe(200);
    registry.failing = true;
    // The cached record answers for its own key...
    expect((await call(key, "GET", "/v1/instances/me")).status).toBe(200);
    // ...but a key it does not list needs the object.
    const unknown = await call(key, "GET", "/v1/instances/me", undefined, {
      signer: await generateInstanceKey(),
    });
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ error: "registry_unavailable" });
  });
});

describe("cleanup alarms", () => {
  test("an instance that never registers and every address leave nothing behind", async () => {
    const { registry, askCode } = setup();
    const key = await generateInstanceKey();
    const before = Date.now();
    await askCode(key);
    const instance = `instance:${key.instance}`;
    const contact = await contactObject("oncall@example.com");
    expect(registry.alarmAt(instance)).toBeGreaterThanOrEqual(before + 3600_000);
    expect(registry.alarmAt(contact)).toBeGreaterThanOrEqual(before + 24 * 3600_000);
    await registry.fireAlarm(instance);
    await registry.fireAlarm(contact);
    expect(registry.storage(instance).size).toBe(0);
    expect(registry.storage(contact).size).toBe(0);
  });

  test("a registered instance keeps its record and loses its spent code", async () => {
    const { registry, register } = setup();
    const key = await generateInstanceKey();
    await register(key);
    const instance = `instance:${key.instance}`;
    await registry.fireAlarm(instance);
    expect([...registry.storage(instance).keys()]).toEqual(["record"]);
  });
});
