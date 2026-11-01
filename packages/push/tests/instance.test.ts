import { describe, expect, test } from "vite-plus/test";
import { fromBase64url } from "../src/base64url.ts";
import {
  canonicalKey,
  generateInstanceKey,
  importInstanceKey,
  instanceId,
  signKeyProof,
  signRequest,
  verifyKeyProof,
  verifyRequest,
  type SignRequestInput,
} from "../src/instance.ts";

const NOW = Date.UTC(2026, 10, 1, 12);

async function signed(overrides: Partial<SignRequestInput> = {}) {
  const key = await generateInstanceKey();
  const input: SignRequestInput = {
    privateKey: key.privateKey,
    publicKey: key.publicKey,
    instance: key.instance,
    method: "POST",
    path: "/v1/instances",
    body: '{"terms":"draft-2026-11"}',
    now: NOW,
    ...overrides,
  };
  const headers = new Headers(await signRequest(input));
  return { key, input, headers };
}

describe("instanceId", () => {
  test("is ins_ and 22 base64url characters of the key's SHA-256", async () => {
    const key = await generateInstanceKey();
    expect(key.instance).toMatch(/^ins_[A-Za-z0-9_-]{22}$/);
    expect(await instanceId(fromBase64url(key.publicKey))).toBe(key.instance);
    expect(fromBase64url(key.publicKey)).toHaveLength(32);
  });
});

describe("importInstanceKey", () => {
  test("reads the secret back into the public key and id it was made with, and signs as it", async () => {
    const key = await generateInstanceKey();
    const imported = await importInstanceKey(key.privateKey);
    expect(imported.publicKey).toBe(key.publicKey);
    expect(imported.instance).toBe(key.instance);
    expect(imported.privateKey.extractable).toBe(false);
    const headers = new Headers(
      await signRequest({
        privateKey: imported.privateKey,
        publicKey: imported.publicKey,
        instance: imported.instance,
        method: "GET",
        path: "/v1/health?deep=1",
        body: "",
        now: NOW,
      }),
    );
    const verified = await verifyRequest({
      method: "GET",
      path: "/v1/health?deep=1",
      headers,
      body: "",
      now: NOW,
    });
    expect(verified).toMatchObject({ ok: true, instance: key.instance, original: true });
  });

  test("a secret with a trailing newline still reads; anything else throws", async () => {
    const key = await generateInstanceKey();
    expect((await importInstanceKey(`${key.privateKey}\n`)).instance).toBe(key.instance);
    await expect(importInstanceKey("not a key")).rejects.toThrow();
    await expect(importInstanceKey(key.publicKey)).rejects.toThrow();
  });
});

describe("signRequest and verifyRequest", () => {
  test("round trip with the original key", async () => {
    const { key, input, headers } = await signed();
    expect(headers.get("Brigade-Timestamp")).toBe(String(NOW / 1000));
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: true,
      instance: key.instance,
      key: key.publicKey,
      original: true,
    });
  });

  test("a CryptoKey signs the same way, and an empty body is the empty string", async () => {
    const key = await generateInstanceKey();
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      fromBase64url(key.privateKey),
      { name: "Ed25519" },
      false,
      ["sign"],
    );
    const raw = fromBase64url(key.publicKey);
    const input = {
      privateKey,
      publicKey: raw,
      instance: await instanceId(raw),
      method: "GET",
      path: "/v1/instances/me",
      body: "",
      now: NOW,
    };
    const headers = new Headers(await signRequest(input));
    const result = await verifyRequest({ ...input, body: new Uint8Array(0), headers });
    expect(result).toMatchObject({ ok: true, original: true });
  });

  test("signs exactly METHOD, path with query, instance, timestamp and the body's hex SHA-256", async () => {
    const key = await generateInstanceKey();
    const body = '{"a":1}';
    const headers = await signRequest({
      privateKey: key.privateKey,
      publicKey: key.publicKey,
      instance: key.instance,
      method: "get",
      path: "/v1/health?deep=1",
      body,
      now: NOW,
    });
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const base = `GET\n/v1/health?deep=1\n${key.instance}\n${NOW / 1000}\n${digest}`;
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromBase64url(key.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        fromBase64url(headers["Brigade-Signature"]!),
        new TextEncoder().encode(base),
      ),
    ).toBe(true);
    // The query is part of what is signed.
    const result = await verifyRequest({
      method: "GET",
      path: "/v1/health",
      headers: new Headers(headers),
      body,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });

  test("a tampered body, path or method is a bad signature", async () => {
    const { input, headers } = await signed();
    for (const change of [
      { body: '{"terms":"x"}' },
      { path: "/v1/instances/keys" },
      { method: "PUT" },
    ]) {
      expect(await verifyRequest({ ...input, ...change, headers })).toEqual({
        ok: false,
        error: "bad_signature",
      });
    }
  });

  test("another key than the one that signed is a bad signature", async () => {
    const { input, headers } = await signed();
    headers.set("Brigade-Key", (await generateInstanceKey()).publicKey);
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: false,
      error: "bad_signature",
    });
    headers.set("Brigade-Key", "not base64url!");
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  test("more than 5 minutes off either way is stale", async () => {
    const { input, headers } = await signed();
    expect(await verifyRequest({ ...input, headers, now: NOW + 300_000 })).toMatchObject({
      ok: true,
    });
    expect(await verifyRequest({ ...input, headers, now: NOW + 301_000 })).toEqual({
      ok: false,
      error: "stale_timestamp",
    });
    expect(await verifyRequest({ ...input, headers, now: NOW - 301_000 })).toEqual({
      ok: false,
      error: "stale_timestamp",
    });
  });

  test("a negative, fractional or 13-digit timestamp is a bad signature", async () => {
    const { input, headers } = await signed();
    for (const timestamp of ["-1762000000", "1762000000.5", "1762000000000"]) {
      headers.set("Brigade-Timestamp", timestamp);
      expect(await verifyRequest({ ...input, headers })).toEqual({
        ok: false,
        error: "bad_signature",
      });
    }
  });

  test("the instance id is signed: the same signature under another id fails", async () => {
    const { input, headers } = await signed();
    // Same key and signature, presented as a rotated key of another instance.
    headers.set("Brigade-Instance", (await generateInstanceKey()).instance);
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: false,
      error: "bad_signature",
    });
  });

  test("the key comes back canonical, however it was padded", async () => {
    const { key, input, headers } = await signed();
    headers.set("Brigade-Key", key.publicKey + "=");
    expect(await verifyRequest({ ...input, headers })).toMatchObject({
      ok: true,
      key: key.publicKey,
      original: true,
    });
    expect(canonicalKey(key.publicKey + "=")).toBe(key.publicKey);
    expect(canonicalKey("AAAA")).toBeNull();
    expect(canonicalKey(42)).toBeNull();
  });

  test("a key proof is the new key's signature over the instance id", async () => {
    const instance = await generateInstanceKey();
    const added = await generateInstanceKey();
    const proof = await signKeyProof(added.privateKey, instance.instance);
    expect(await verifyKeyProof(added.publicKey, instance.instance, proof)).toBe(true);
    expect(await verifyKeyProof(added.publicKey, added.instance, proof)).toBe(false);
    expect(await verifyKeyProof(instance.publicKey, instance.instance, proof)).toBe(false);
    expect(await verifyKeyProof(added.publicKey, instance.instance, "junk")).toBe(false);
  });

  test("a missing header is missing_signature", async () => {
    const { input, headers } = await signed();
    headers.delete("Brigade-Signature");
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: false,
      error: "missing_signature",
    });
  });

  test("a rotated key verifies but is not original", async () => {
    const first = await generateInstanceKey();
    const second = await generateInstanceKey();
    const { input, headers } = await signed({
      privateKey: second.privateKey,
      publicKey: second.publicKey,
      instance: first.instance,
    });
    expect(await verifyRequest({ ...input, headers })).toEqual({
      ok: true,
      instance: first.instance,
      key: second.publicKey,
      original: false,
    });
  });
});
