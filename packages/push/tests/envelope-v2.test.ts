import { describe, expect, test } from "vite-plus/test";
import { fromBase64url, toBase64url } from "../src/base64url.ts";
import {
  fallbackUrgency,
  openOnPhone,
  openPush,
  openPushV2,
  parsePushEnvelope,
  PUSH_CLOCK_SKEW_SECONDS,
  PUSH_PLAINTEXT_MAX_BYTES,
  pushKeyId,
  sealPush,
  sealPushV2,
  type PhoneKey,
  type PushEnvelopeV2,
  type PushSender,
} from "../src/envelope.ts";
import { generateRecipient, open, seal, type HpkeRecipient } from "../src/hpke.ts";

const ORIGIN = "https://brigade.example.com";
const OTHER = "https://other.example.org";
const NOW = Date.UTC(2026, 10, 1, 12, 0, 0);
const sender: PushSender = { origin: ORIGIN, urgency: "page", ttlSeconds: 900, now: NOW };
const content = {
  title: "SEV1 · INC-142",
  body: "Checkout down",
  incident: "inc_01JB8Z0000000000000000000",
  workspace: "ws_01JB8Z0000000000000000000",
  receipt: { url: `${ORIGIN}/api/receipts`, token: "v1.k1.abc" },
};
const pairedWith =
  (...origins: string[]) =>
  (origin: string) =>
    origins.includes(origin);

async function sealedFor(recipient: HpkeRecipient, overrides: Partial<PushSender> = {}) {
  return sealPushV2(toBase64url(recipient.publicKey), content, { ...sender, ...overrides });
}

describe("pushKeyId", () => {
  test("8 base64url characters: the first 6 bytes of SHA-256 over the uncompressed public key", async () => {
    const { publicKey } = await generateRecipient();
    const id = await pushKeyId(publicKey);
    expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(publicKey)));
    expect(fromBase64url(id)).toEqual(digest.subarray(0, 6));
    expect(await pushKeyId(toBase64url(publicKey))).toBe(id);
  });

  test("a fixed vector the native code checks against (BrigadePushCrypto.swift, PushPayload.kt)", async () => {
    // The key 0x04 followed by 64 bytes 0x01..0x40: not a point on the curve, only bytes to hash.
    const key = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
    expect(await pushKeyId(key)).toBe(KEY_ID_VECTOR);
  });

  test("differs between keys, and refuses anything but an uncompressed point", async () => {
    const a = await generateRecipient();
    const b = await generateRecipient();
    expect(await pushKeyId(a.publicKey)).not.toBe(await pushKeyId(b.publicKey));
    await expect(pushKeyId(a.publicKey.subarray(0, 33))).rejects.toThrow();
  });
});

describe("sealPushV2 and openPushV2", () => {
  test("round trip: the content, and iat, exp (iat + the TTL), origin and urgency, sealed", async () => {
    const recipient = await generateRecipient();
    const envelope = await sealedFor(recipient);
    expect(envelope.v).toBe(2);
    expect(envelope.k).toBe(await pushKeyId(recipient.publicKey));
    expect(parsePushEnvelope(JSON.parse(JSON.stringify(envelope)))).toEqual(envelope);
    const iat = Math.floor(NOW / 1000);
    expect(await openPushV2(recipient, envelope)).toEqual({
      ...content,
      iat,
      exp: iat + 900,
      origin: ORIGIN,
      urgency: "page",
    });
    // `openPush` takes either version.
    expect(await openPush(recipient, envelope)).toMatchObject({ ...content, origin: ORIGIN });
    // Nothing of it in clear.
    const clear = JSON.stringify(envelope);
    for (const secret of ["v1.k1.abc", "brigade.example.com", "page", "Checkout"]) {
      expect(clear).not.toContain(secret);
    }
  });

  test("a TTL of 0 (now or never) seals exp = iat", async () => {
    const recipient = await generateRecipient();
    const opened = await openPushV2(recipient, await sealedFor(recipient, { ttlSeconds: 0 }));
    expect(opened.exp).toBe(opened.iat);
  });

  test("refuses an origin that is not one, a path, an unknown urgency or a TTL out of range", async () => {
    const { publicKey } = await generateRecipient();
    const key = toBase64url(publicKey);
    for (const bad of [
      { origin: "brigade.example.com" },
      { origin: `${ORIGIN}/` },
      { origin: `${ORIGIN}/api` },
      { origin: "HTTPS://Brigade.example.com" },
      { origin: "https://brigade.example.com:443" },
      { origin: "ftp://brigade.example.com" },
      { urgency: "urgent" as never },
      { ttlSeconds: -1 },
      { ttlSeconds: 1.5 },
      { ttlSeconds: 31 * 24 * 60 * 60 },
    ]) {
      await expect(sealPushV2(key, content, { ...sender, ...bad })).rejects.toThrow();
    }
    await expect(
      sealPushV2(key, content, { ...sender, origin: "http://localhost:8787" }),
    ).resolves.toBeDefined();
  });

  test("a receipt on another origin than the sealed one is left out, not sealed", async () => {
    const recipient = await generateRecipient();
    const envelope = await sealPushV2(
      toBase64url(recipient.publicKey),
      { ...content, receipt: { url: `${OTHER}/api/receipts`, token: "t" } },
      sender,
    );
    const opened = await openPushV2(recipient, envelope);
    expect(opened.receipt).toBeUndefined();
    expect(opened.title).toBe(content.title);
  });

  test("the extra fields still fit: the largest content seals under APNs' 4 KB", async () => {
    const recipient = await generateRecipient();
    const sealedFields = JSON.stringify({ iat: 0, exp: 0, origin: ORIGIN, urgency: "page" });
    const body = "x".repeat(
      PUSH_PLAINTEXT_MAX_BYTES - '{"title":"","body":""}'.length - sealedFields.length - 30,
    );
    const envelope = await sealPushV2(
      toBase64url(recipient.publicKey),
      { title: "", body },
      sender,
    );
    expect(JSON.stringify(envelope).length).toBeLessThan(3000);
    await expect(
      sealPushV2(
        toBase64url(recipient.publicKey),
        { title: "", body: "x".repeat(PUSH_PLAINTEXT_MAX_BYTES) },
        sender,
      ),
    ).rejects.toThrow(/over 2048/);
  });

  test("versions do not cross: a v2 ciphertext relabelled v1 does not open, nor a v1 relabelled v2", async () => {
    const recipient = await generateRecipient();
    const v2 = await sealedFor(recipient);
    await expect(openPush(recipient, { v: 1, enc: v2.enc, ct: v2.ct })).rejects.toThrow();
    const v1 = await sealPush(toBase64url(recipient.publicKey), content);
    await expect(openPushV2(recipient, { ...v1, v: 2, k: v2.k })).rejects.toThrow();
  });

  test("tampered bytes do not open", async () => {
    const recipient = await generateRecipient();
    const envelope = await sealedFor(recipient);
    const ct = fromBase64url(envelope.ct);
    ct[3]! ^= 1;
    await expect(openPushV2(recipient, { ...envelope, ct: toBase64url(ct) })).rejects.toThrow();
  });

  test("a plaintext without valid sealed fields does not open as v2", async () => {
    const recipient = await generateRecipient();
    const info = new TextEncoder().encode("app.freecorps.brigade push v2");
    const k = await pushKeyId(recipient.publicKey);
    const iat = Math.floor(NOW / 1000);
    const good = { title: "t", body: "b", iat, exp: iat + 60, origin: ORIGIN, urgency: "page" };
    for (const bad of [
      { iat: undefined },
      { iat: "1" },
      { exp: iat - 1 },
      { exp: iat + 31 * 24 * 60 * 60 },
      { iat: 1.5 },
      { origin: `${ORIGIN}/` },
      { origin: undefined },
      { urgency: "urgent" },
    ]) {
      const sealed = await seal(
        recipient.publicKey,
        new TextEncoder().encode(JSON.stringify({ ...good, ...bad })),
        { info },
      );
      const envelope: PushEnvelopeV2 = {
        v: 2,
        k,
        enc: toBase64url(sealed.enc),
        ct: toBase64url(sealed.ct),
      };
      // Opens at the HPKE layer, refused as a push.
      expect(await open(recipient, { enc: sealed.enc, ct: sealed.ct }, { info })).toBeInstanceOf(
        Uint8Array,
      );
      await expect(openPushV2(recipient, envelope)).rejects.toThrow();
    }
  });
});

describe("parsePushEnvelope, version 2", () => {
  test("needs an 8-character base64url key id", async () => {
    const recipient = await generateRecipient();
    const good = await sealedFor(recipient);
    expect(parsePushEnvelope(good)).toEqual(good);
    for (const k of [undefined, 1, "", "short", "toolong12", "has space", "abc+/def"]) {
      expect(parsePushEnvelope({ ...good, k })).toBeNull();
    }
    expect(parsePushEnvelope({ ...good, v: 3 })).toBeNull();
    // A v1 envelope's own k is ignored, not carried.
    const v1 = await sealPush(toBase64url(recipient.publicKey), content);
    expect(parsePushEnvelope({ ...v1, k: good.k })).toEqual(v1);
  });
});

describe("openOnPhone: what the phone shows (every refusal is the fallback text, never silence)", () => {
  async function phone() {
    const mine = await generateRecipient();
    const other = await generateRecipient();
    const keys: PhoneKey[] = [
      { origin: OTHER, recipient: other },
      { origin: ORIGIN, recipient: mine },
    ];
    return { mine, other, keys };
  }

  test("v2 for a paired instance opens with the key its id names", async () => {
    const { mine, keys } = await phone();
    const opened = await openOnPhone(await sealedFor(mine), keys, {
      now: NOW + 60_000,
      paired: pairedWith(ORIGIN, OTHER),
    });
    expect(opened).toMatchObject({ ok: true, version: 2, content: { origin: ORIGIN } });
  });

  test("v1 still opens, with whichever key it was sealed to", async () => {
    const { mine, other, keys } = await phone();
    for (const recipient of [mine, other]) {
      const opened = await openOnPhone(
        await sealPush(toBase64url(recipient.publicKey), content),
        keys,
        { now: NOW, paired: pairedWith(ORIGIN) },
      );
      expect(opened).toEqual({ ok: true, version: 1, content });
    }
    // And the unclaimed key from before keys per instance.
    const legacy = await generateRecipient();
    const opened = await openOnPhone(
      await sealPush(toBase64url(legacy.publicKey), content),
      [{ origin: null, recipient: legacy }],
      { now: NOW, paired: pairedWith(ORIGIN) },
    );
    expect(opened.ok).toBe(true);
  });

  test("expired: past exp plus the clock skew; within it, shown", async () => {
    const { mine, keys } = await phone();
    const envelope = await sealedFor(mine, { ttlSeconds: 900 });
    const paired = pairedWith(ORIGIN);
    const edge = NOW + (900 + PUSH_CLOCK_SKEW_SECONDS) * 1000;
    expect((await openOnPhone(envelope, keys, { now: edge, paired })).ok).toBe(true);
    expect(await openOnPhone(envelope, keys, { now: edge + 1000, paired })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("wrong origin: sealed for another instance than the one its key belongs to", async () => {
    // The instance at OTHER holds only its own device key: it seals a page claiming ORIGIN to it.
    const { other, keys } = await phone();
    const forged = await sealPushV2(toBase64url(other.publicKey), content, sender);
    expect(
      await openOnPhone(forged, keys, { now: NOW, paired: pairedWith(ORIGIN, OTHER) }),
    ).toEqual({ ok: false, reason: "wrong_origin", urgency: "page" });
  });

  test("not paired: the phone never registered there, or the member signed out on it", async () => {
    const { mine, keys } = await phone();
    expect(
      await openOnPhone(await sealedFor(mine), keys, { now: NOW, paired: pairedWith(OTHER) }),
    ).toEqual({ ok: false, reason: "not_paired", urgency: "page" });
    // The unclaimed key counts as the paired instance's, and only that.
    const legacy = await generateRecipient();
    const envelope = await sealedFor(legacy);
    const legacyKeys: PhoneKey[] = [{ origin: null, recipient: legacy }];
    expect(
      (await openOnPhone(envelope, legacyKeys, { now: NOW, paired: pairedWith(ORIGIN) })).ok,
    ).toBe(true);
    expect(
      await openOnPhone(envelope, legacyKeys, { now: NOW, paired: pairedWith(OTHER) }),
    ).toEqual({
      ok: false,
      reason: "not_paired",
      urgency: "page",
    });
  });

  test("the fallback of a push that opened is no louder than its sealed urgency; one that did not keeps the clear one", async () => {
    const { mine, other, keys } = await phone();
    const low = await sealedFor(mine, { urgency: "low" });
    // The relay says "page" in clear (and could set aps to critical); the refusal says how loud it may be.
    const notPaired = await openOnPhone(low, keys, { now: NOW, paired: pairedWith(OTHER) });
    expect(notPaired).toEqual({ ok: false, reason: "not_paired", urgency: "low" });
    expect(fallbackUrgency(notPaired, "page")).toBe("low");
    const forged = await sealPushV2(toBase64url(other.publicKey), content, {
      ...sender,
      urgency: "low",
    });
    const wrong = await openOnPhone(forged, keys, { now: NOW, paired: pairedWith(ORIGIN, OTHER) });
    expect(fallbackUrgency(wrong, "page")).toBe("low");
    // Opened and shown: the sealed urgency, whatever the clear one says (a call sealed `low` is not rung).
    const shown = await openOnPhone(low, keys, { now: NOW, paired: pairedWith(ORIGIN) });
    expect(fallbackUrgency(shown, "page")).toBe("low");
    // Loud where nothing sealed counts: expired (a phone clock ahead must never quiet pages), unknown key, not opened.
    const expired = await openOnPhone(low, keys, {
      now: NOW + 3_600_000,
      paired: pairedWith(ORIGIN),
    });
    expect(expired).toEqual({ ok: false, reason: "expired" });
    expect(fallbackUrgency(expired, "page")).toBe("page");
    const stranger = await sealedFor(await generateRecipient(), { urgency: "low" });
    const unknown = await openOnPhone(stranger, keys, { now: NOW, paired: pairedWith(ORIGIN) });
    expect(fallbackUrgency(unknown, "page")).toBe("page");
    const relabelled = { ...low, k: await pushKeyId(other.publicKey) };
    const notOpened = await openOnPhone(relabelled, keys, { now: NOW, paired: pairedWith(ORIGIN) });
    expect(fallbackUrgency(notOpened, "page")).toBe("page");
    // Version 1 seals no urgency: the clear one.
    const v1 = await openOnPhone(await sealPush(toBase64url(mine.publicKey), content), keys, {
      now: NOW,
      paired: pairedWith(ORIGIN),
    });
    expect(fallbackUrgency(v1, "high")).toBe("high");
  });

  test("unknown key id: no key on the phone has it (an app from before keys per instance, a reinstall)", async () => {
    const { keys } = await phone();
    const stranger = await generateRecipient();
    expect(
      await openOnPhone(await sealedFor(stranger), keys, { now: NOW, paired: pairedWith(ORIGIN) }),
    ).toEqual({ ok: false, reason: "unknown_key" });
  });

  test("a key id changed in transit: the named key is tried, does not open", async () => {
    const { mine, other, keys } = await phone();
    const envelope = await sealedFor(mine);
    const relabelled = { ...envelope, k: await pushKeyId(other.publicKey) };
    expect(
      await openOnPhone(relabelled, keys, { now: NOW, paired: pairedWith(ORIGIN, OTHER) }),
    ).toEqual({ ok: false, reason: "not_opened" });
  });

  test("malformed: another version, broken fields, nothing at all", async () => {
    const { mine, keys } = await phone();
    const good = await sealedFor(mine);
    const options = { now: NOW, paired: pairedWith(ORIGIN) };
    for (const bad of [
      null,
      undefined,
      "x",
      { ...good, v: 3 },
      { ...good, enc: "AAAA" },
      { ...good, k: 1 },
    ]) {
      expect(await openOnPhone(bad, keys, options)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  test("no key on the phone: v1 and v2 both refused", async () => {
    const { mine } = await phone();
    const options = { now: NOW, paired: pairedWith(ORIGIN) };
    expect(await openOnPhone(await sealedFor(mine), [], options)).toEqual({
      ok: false,
      reason: "unknown_key",
    });
    expect(
      await openOnPhone(await sealPush(toBase64url(mine.publicKey), content), [], options),
    ).toEqual({ ok: false, reason: "not_opened" });
  });
});

/** `pushKeyId` of 0x04 || 0x01..0x40; BrigadePushCrypto.swift and the Kotlin tests pin the same value. */
const KEY_ID_VECTOR = "DtOmq5V_";
