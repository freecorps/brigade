// The verifier against the Standard Webhooks specification's own example, against deliveries Brigade's API signed
// (fixtures/server-signed.json, made by apps/api test/sdk-fixture.ts, which checks it is current), and against every
// way a delivery can be wrong.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import fixture from "./fixtures/server-signed.json" with { type: "json" };
import {
  DEFAULT_TOLERANCE_SECONDS,
  verifyWebhook,
  WebhookVerificationError,
  type UnknownWebhookPayload,
  type WebhookPayload,
  type WebhookVerification,
} from "../src/index.ts";

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Signs like the specification says, for deliveries the fixture has no case for. */
async function sign(secret: string, id: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (char) => char.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${toBase64(new Uint8Array(mac))}`;
}

const code = (result: WebhookVerification) => (result.ok ? "ok" : result.error.code);

describe("the specification's example", () => {
  // spec/standard-webhooks.md, "Signature scheme".
  const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
  const headers = {
    "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJek",
    "webhook-timestamp": "1614265330",
    "webhook-signature": "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
  };
  const body = '{"test": 2432232314}';
  const now = 1614265330 * 1000;

  test("its signature verifies; its body is no Brigade payload", async () => {
    const result = await verifyWebhook({ secret, headers, body, now });
    expect(code(result)).toBe("invalid_payload");
    expect(!result.ok && result.error.body).toEqual({ test: 2432232314 });
    // Without the prefix too, as the specification allows.
    expect(code(await verifyWebhook({ secret: secret.slice(6), headers, body, now }))).toBe(
      "invalid_payload",
    );
  });

  test("a changed byte anywhere fails", async () => {
    expect(code(await verifyWebhook({ secret, headers, body: `${body} `, now }))).toBe(
      "invalid_signature",
    );
    expect(
      code(
        await verifyWebhook({
          secret,
          headers: { ...headers, "webhook-id": "msg_p5jXN8AQM9LWM0D4loKWxJel" },
          body,
          now,
        }),
      ),
    ).toBe("invalid_signature");
    expect(
      code(
        await verifyWebhook({
          secret,
          headers: { ...headers, "webhook-timestamp": "1614265331" },
          body,
          now,
        }),
      ),
    ).toBe("invalid_signature");
    expect(
      code(
        await verifyWebhook({
          secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx",
          headers,
          body,
          now,
        }),
      ),
    ).toBe("invalid_signature");
  });
});

describe("deliveries Brigade's API signed", () => {
  const [current, previous] = fixture.secrets as [string, string];
  const now = fixture.now;

  test("each verifies and parses into its payload type", async () => {
    const types: string[] = [];
    for (const delivery of fixture.deliveries) {
      const result = await verifyWebhook({
        secret: [current, previous],
        headers: delivery.headers,
        body: delivery.body,
        now,
      });
      expect(result, delivery.headers["webhook-id"]).toMatchObject({
        ok: true,
        known: true,
        webhookId: delivery.headers["webhook-id"],
        timestamp: Number(delivery.headers["webhook-timestamp"]),
      });
      if (!result.ok) continue;
      expect(result.payload).toEqual(JSON.parse(delivery.body));
      expect(result.payload.id).toBe(result.webhookId);
      types.push(result.payload.type);
    }
    expect(types).toEqual(["incident.declared", "incident.update_posted", "webhook.test"]);
  });

  test("during a rotation, either secret alone verifies the delivery signed with both", async () => {
    const both = fixture.deliveries[0]!;
    expect(both.headers["webhook-signature"].split(" ")).toHaveLength(2);
    for (const secret of [current, previous]) {
      expect(code(await verifyWebhook({ secret, ...both, now }))).toBe("ok");
    }
    // One signed with the current secret only does not verify with the previous one.
    const one = fixture.deliveries[1]!;
    expect(code(await verifyWebhook({ secret: previous, ...one, now }))).toBe("invalid_signature");
  });

  test("the body as bytes, headers as Headers or in any case", async () => {
    const delivery = fixture.deliveries[1]!;
    const bytes = new TextEncoder().encode(delivery.body);
    const request = new Request("https://hooks.example.com/brigade", {
      method: "POST",
      headers: delivery.headers,
      body: delivery.body,
    });
    for (const options of [
      { headers: request.headers, body: await request.clone().arrayBuffer() },
      { headers: delivery.headers, body: bytes },
      {
        headers: Object.fromEntries(
          Object.entries(delivery.headers).map(([name, value]) => [name.toUpperCase(), value]),
        ),
        body: delivery.body,
      },
    ]) {
      const result = await verifyWebhook({ secret: current, now, ...options });
      expect(code(result)).toBe("ok");
      // A body decoded as anything but UTF-8 would not match its signature: this one is not ASCII.
      expect(
        result.ok &&
          result.known &&
          result.payload.type === "incident.update_posted" &&
          result.payload.data.body,
      ).toBe("Revertendo a implantação. ETA 10 min");
    }
  });

  test("the payload narrows by type", async () => {
    const result = await verifyWebhook({ secret: current, ...fixture.deliveries[0]!, now });
    if (!result.ok) throw result.error;
    expectTypeOf(result.payload).toEqualTypeOf<WebhookPayload | UnknownWebhookPayload>();
    if (!result.known) throw new Error("Expected a known type");
    expectTypeOf(result.payload).toEqualTypeOf<WebhookPayload>();
    if (result.payload.type === "incident.declared") {
      // The severities known now, or one added since.
      expectTypeOf(result.payload.data.incident.severity).toEqualTypeOf<
        "sev1" | "sev2" | "sev3" | "sev4" | (string & {})
      >();
      expect(result.payload.data.incident.number).toBe(142);
    } else throw new Error("Expected incident.declared");
  });
});

describe("refused", () => {
  const secret = `whsec_${toBase64(new Uint8Array(32).fill(7))}`;
  const id = "evt_01M5W19VG01C5GP2RB1C5GP2RB";
  const now = Date.UTC(2026, 9, 26, 12, 0, 0);
  const seconds = now / 1000;
  const body = JSON.stringify({
    version: 1,
    id,
    type: "webhook.test",
    time: new Date(now).toISOString(),
    workspaceId: "ws_01M5W19VG0040G2081040G2081",
    actor: { kind: "user", id: "usr_ana" },
    data: { webhookId: "whk_01M5W19VG0040G2081040G2081" },
  });
  const signed = async (timestamp = seconds, text = body) => ({
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": await sign(secret, id, timestamp, text),
  });

  test("a timestamp out of tolerance, either way, signed or not", async () => {
    const at = async (offset: number, toleranceSeconds?: number) =>
      code(
        await verifyWebhook({
          secret,
          headers: await signed(seconds + offset),
          body,
          now,
          toleranceSeconds,
        }),
      );
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(300);
    expect(await at(-300)).toBe("ok");
    expect(await at(300)).toBe("ok");
    expect(await at(-301)).toBe("timestamp_too_old");
    expect(await at(301)).toBe("timestamp_too_new");
    expect(await at(-30, 10)).toBe("timestamp_too_old");
    expect(
      code(
        await verifyWebhook({
          secret,
          headers: await signed(),
          body,
          now: new Date(now + 3_600_000),
        }),
      ),
    ).toBe("timestamp_too_old");
    for (const stamp of ["", "abc", "1.5", "-1", "1e9", "9".repeat(16)]) {
      const headers = { ...(await signed()), "webhook-timestamp": stamp };
      expect(code(await verifyWebhook({ secret, headers, body, now })), stamp).toBe(
        stamp === "" ? "missing_header" : "invalid_timestamp",
      );
    }
  });

  test("an option that would turn the replay check off", async () => {
    const headers = await signed(seconds - 3_600);
    for (const toleranceSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const result = await verifyWebhook({ secret, headers, body, now, toleranceSeconds });
      expect(code(result), String(toleranceSeconds)).toBe("invalid_option");
    }
    for (const at of [Number.NaN, Number.POSITIVE_INFINITY, new Date(Number.NaN)]) {
      const result = await verifyWebhook({ secret, headers, body, now: at });
      expect(code(result), String(at)).toBe("invalid_option");
    }
    // 0 is no tolerance at all, not an invalid one.
    expect(
      code(
        await verifyWebhook({ secret, headers: await signed(), body, now, toleranceSeconds: 0 }),
      ),
    ).toBe("ok");
  });

  test("missing headers; one sent twice reads the same from Headers or a plain object", async () => {
    const headers = await signed();
    for (const name of Object.keys(headers)) {
      const without = { ...headers, [name]: undefined };
      expect(code(await verifyWebhook({ secret, headers: without, body, now })), name).toBe(
        "missing_header",
      );
    }
    for (const [name, values, expected] of [
      ["webhook-signature", ["v1,eA==", headers["webhook-signature"]], "ok"],
      ["webhook-signature", ["v1,eA==", "v1,eQ=="], "invalid_signature"],
      [
        "webhook-timestamp",
        [headers["webhook-timestamp"], headers["webhook-timestamp"]],
        "invalid_timestamp",
      ],
      ["webhook-id", [id, id], "invalid_signature"],
    ] as const) {
      const plain = { ...headers, [name]: values };
      const real = new Headers(headers);
      real.delete(name);
      for (const value of values) real.append(name, value);
      for (const one of [plain, real]) {
        expect(code(await verifyWebhook({ secret, headers: one, body, now })), name).toBe(expected);
      }
    }
  });

  test("signatures: other versions skipped, any v1 may match, garbage never does", async () => {
    const headers = await signed();
    const good = headers["webhook-signature"];
    const variants: [string, string][] = [
      [`v1,${toBase64(new Uint8Array(32))} ${good}`, "ok"],
      [`v1a,${good.slice(3)} ${good}`, "ok"],
      [`v1a,${good.slice(3)}`, "invalid_signature"],
      [good.slice(3), "invalid_signature"],
      [`v2,${good.slice(3)}`, "invalid_signature"],
      ["v1,not base64!", "invalid_signature"],
      [`v1,${good.slice(3, -8)}`, "invalid_signature"],
      ["v1,", "invalid_signature"],
    ];
    for (const [signature, expected] of variants) {
      const result = await verifyWebhook({
        secret,
        headers: { ...headers, "webhook-signature": signature },
        body,
        now,
      });
      expect(code(result), signature).toBe(expected);
    }
  });

  test("a secret that is no secret", async () => {
    const headers = await signed();
    for (const bad of [[], [""], ["whsec_"], ["whsec_not base64"], [secret, "whsec_!"]]) {
      const result = await verifyWebhook({ secret: bad, headers, body, now });
      expect(code(result), JSON.stringify(bad)).toBe("invalid_secret");
      expect(!result.ok && result.error).toBeInstanceOf(WebhookVerificationError);
    }
  });

  test("signed, but not JSON, or not a payload", async () => {
    const text = "not json";
    expect(
      code(await verifyWebhook({ secret, headers: await signed(seconds, text), body: text, now })),
    ).toBe("invalid_json");
    const v2 = body.replace('"version":1', '"version":2');
    const result = await verifyWebhook({
      secret,
      headers: await signed(seconds, v2),
      body: v2,
      now,
    });
    expect(code(result)).toBe("invalid_payload");
    expect(!result.ok && result.error.issues).toEqual([{ path: "version", message: "Expected 1" }]);
  });
});

describe("what a newer Brigade may send within version 1", () => {
  const secret = `whsec_${toBase64(new Uint8Array(32).fill(9))}`;
  const id = "evt_01M5W19VG01C5GP2RB1C5GP2RB";
  const now = Date.UTC(2026, 9, 26, 12, 0, 0);
  const seconds = now / 1000;
  const envelope = {
    version: 1,
    id,
    time: new Date(now).toISOString(),
    workspaceId: "ws_01M5W19VG0040G2081040G2081",
    actor: { kind: "user", id: "usr_ana" },
  };
  const deliver = async (payload: object) => {
    const text = JSON.stringify(payload);
    const headers = {
      "webhook-id": id,
      "webhook-timestamp": String(seconds),
      "webhook-signature": await sign(secret, id, seconds, text),
    };
    return verifyWebhook({ secret, headers, body: text, now });
  };

  test("a type added since verifies, as an unknown payload", async () => {
    const payload = { ...envelope, type: "incident.merged", data: { into: "inc_x" } };
    const result = await deliver(payload);
    expect(result).toMatchObject({ ok: true, known: false, webhookId: id, payload });
    if (!result.ok || result.known) throw new Error("Expected an unknown payload");
    expectTypeOf(result.payload).toEqualTypeOf<UnknownWebhookPayload>();
    expectTypeOf(result.payload.data).toEqualTypeOf<unknown>();
  });

  test("a payload of a type added since still needs its data", async () => {
    const result = await deliver({ ...envelope, type: "incident.merged" });
    expect(result).toMatchObject({ ok: false });
  });

  test("a value added to a list, and a longer text, are kept as sent", async () => {
    const incident = {
      id: "inc_01M5W19VG0081040G2081040G2",
      number: 7,
      title: "Checkout down ".repeat(100).trim(),
      severity: "sev0",
      status: "postmortem",
      declaredAt: envelope.time,
      acknowledgedAt: null,
    };
    const payload = {
      ...envelope,
      actor: { kind: "robot", id: "sys_new" },
      type: "incident.status_changed",
      data: { incident, from: "resolved", to: "postmortem", extra: true },
    };
    const result = await deliver(payload);
    expect(result).toMatchObject({ ok: true, known: true });
    expect(result.ok && result.payload).toEqual({
      ...payload,
      data: { incident, from: "resolved", to: "postmortem" },
    });
  });
});
