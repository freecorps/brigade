import { describe, expect, test } from "vite-plus/test";
import { fromBase64url } from "../src/base64url.ts";
import {
  generateInstanceKey,
  instanceId,
  signRequest,
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

  test("signs exactly METHOD, path with query, timestamp and the body's hex SHA-256", async () => {
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
    const digest = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
    ).toString("hex");
    const base = `GET\n/v1/health?deep=1\n${NOW / 1000}\n${digest}`;
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
