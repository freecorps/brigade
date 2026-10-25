import { describe, expect, test } from "vite-plus/test";
import { fromBase64url, toBase64url } from "../src/base64url.ts";
import {
  openPush,
  parseDevicePublicKey,
  parsePushEnvelope,
  PUSH_PLAINTEXT_MAX_BYTES,
  sealPush,
} from "../src/envelope.ts";
import { generateRecipient } from "../src/hpke.ts";

describe("sealPush and openPush", () => {
  test("round trip, with non-ASCII text", async () => {
    const recipient = await generateRecipient();
    const content = {
      title: "SEV1 · Pagamentos fora do ar",
      body: `Checkout ${String.fromCodePoint(0x1f525)} 502 em São Paulo`,
    };
    const envelope = await sealPush(toBase64url(recipient.publicKey), content);
    expect(envelope.v).toBe(1);
    expect(parsePushEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    expect(await openPush(recipient, envelope)).toEqual(content);
  });

  test("a page carries the incident its ack names", async () => {
    const recipient = await generateRecipient();
    const content = {
      title: "SEV1",
      body: "Checkout down",
      incident: "inc_01JB8Z0000000000000000000",
    };
    const envelope = await sealPush(toBase64url(recipient.publicKey), content);
    expect(await openPush(recipient, envelope)).toEqual(content);
  });

  test("another device cannot open it", async () => {
    const a = await generateRecipient();
    const b = await generateRecipient();
    const envelope = await sealPush(toBase64url(a.publicKey), { title: "t", body: "b" });
    await expect(openPush(b, envelope)).rejects.toThrow();
  });

  test("content over the limit is refused before sealing", async () => {
    const recipient = await generateRecipient();
    const body = "x".repeat(PUSH_PLAINTEXT_MAX_BYTES);
    await expect(sealPush(toBase64url(recipient.publicKey), { title: "t", body })).rejects.toThrow(
      /over 2048/,
    );
  });

  test("the largest content still fits APNs' 4 KB with room for the aps dictionary", async () => {
    const recipient = await generateRecipient();
    const body = "x".repeat(PUSH_PLAINTEXT_MAX_BYTES - '{"title":"","body":""}'.length);
    const envelope = await sealPush(toBase64url(recipient.publicKey), { title: "", body });
    expect(JSON.stringify(envelope).length).toBeLessThan(3000);
  });
});

describe("parsePushEnvelope", () => {
  test("rejects anything but a version 1 envelope with a P-256 enc and a tagged ciphertext", async () => {
    const recipient = await generateRecipient();
    const good = await sealPush(toBase64url(recipient.publicKey), { title: "t", body: "b" });
    expect(parsePushEnvelope(null)).toBeNull();
    expect(parsePushEnvelope([])).toBeNull();
    expect(parsePushEnvelope({ ...good, v: 2 })).toBeNull();
    expect(parsePushEnvelope({ ...good, enc: 1 })).toBeNull();
    expect(parsePushEnvelope({ ...good, enc: "AAAA" })).toBeNull();
    expect(parsePushEnvelope({ ...good, ct: toBase64url(new Uint8Array(15)) })).toBeNull();
    expect(parsePushEnvelope({ ...good, ct: "not base64!" })).toBeNull();
  });
});

describe("parseDevicePublicKey and base64url", () => {
  test("accepts the 65-byte uncompressed form only", async () => {
    const { publicKey } = await generateRecipient();
    expect(parseDevicePublicKey(toBase64url(publicKey))).toEqual(publicKey);
    expect(() => parseDevicePublicKey(toBase64url(publicKey.subarray(0, 33)))).toThrow();
    expect(() => parseDevicePublicKey(toBase64url(new Uint8Array(65)))).toThrow();
  });

  test("round trips every byte value, without padding, and accepts padded input", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const encoded = toBase64url(all);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64url(encoded)).toEqual(all);
    expect(fromBase64url("AQ==")).toEqual(Uint8Array.of(1));
    expect(() => fromBase64url("a+b/")).toThrow();
  });
});
