import { describe, expect, test } from "vite-plus/test";
import { MAX_BODY_BYTES, signSlackRequest, verifySlackRequest } from "../src/verify.ts";

// A test-only signing secret: not a credential.
const SECRET = "test-signing-secret-not-real";
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const BODY = "team_id=T0TEST0001&user_id=U0USER0001&text=declare+Checkout+down";

async function signed(
  body = BODY,
  options: { at?: number; secret?: string; signature?: string } = {},
): Promise<Request> {
  const at = options.at ?? Math.floor(NOW / 1000);
  return new Request("https://brigade.test/slack/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": String(at),
      "X-Slack-Signature":
        options.signature ?? (await signSlackRequest(body, options.secret ?? SECRET, at)),
    },
    body,
  });
}

describe("verifySlackRequest", () => {
  test("accepts Slack's signature and returns the raw body", async () => {
    expect(await verifySlackRequest(await signed(), SECRET, NOW)).toEqual({ ok: true, body: BODY });
  });

  test("refuses another secret's signature", async () => {
    const request = await signed(BODY, { secret: "someone-elses-secret" });
    expect(await verifySlackRequest(request, SECRET, NOW)).toMatchObject({
      ok: false,
      status: 401,
      reason: "bad_signature",
    });
  });

  test("refuses a body changed after signing", async () => {
    const signature = await signSlackRequest(BODY, SECRET, Math.floor(NOW / 1000));
    const request = await signed(`${BODY}+sev1`, { signature });
    expect(await verifySlackRequest(request, SECRET, NOW)).toMatchObject({
      reason: "bad_signature",
    });
  });

  test("refuses a request without a signature or timestamp, or with a malformed one", async () => {
    const bare = new Request("https://brigade.test/slack/commands", { method: "POST", body: BODY });
    expect(await verifySlackRequest(bare, SECRET, NOW)).toMatchObject({ reason: "unsigned" });
    const short = await signed(BODY, { signature: "v0=abc" });
    expect(await verifySlackRequest(short, SECRET, NOW)).toMatchObject({ reason: "unsigned" });
    const upper = await signed(BODY, { signature: `v0=${"A".repeat(64)}` });
    expect(await verifySlackRequest(upper, SECRET, NOW)).toMatchObject({ reason: "unsigned" });
  });

  test("replay window: the same signed request passes within 5 minutes and is refused after", async () => {
    const at = Math.floor(NOW / 1000);
    const within = await verifySlackRequest(await signed(BODY, { at }), SECRET, NOW + 299_000);
    expect(within).toMatchObject({ ok: true });
    const stale = await verifySlackRequest(await signed(BODY, { at }), SECRET, NOW + 301_000);
    expect(stale).toMatchObject({ ok: false, status: 401, reason: "stale" });
  });

  test("refuses a timestamp from the future past the window too", async () => {
    const at = Math.floor(NOW / 1000) + 301;
    expect(await verifySlackRequest(await signed(BODY, { at }), SECRET, NOW)).toMatchObject({
      reason: "stale",
    });
  });

  test("refuses a body over the limit, declared or streamed", async () => {
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect(await verifySlackRequest(await signed(big), SECRET, NOW)).toMatchObject({
      status: 413,
      reason: "too_large",
    });
  });
});
