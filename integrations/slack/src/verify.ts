// Verifying that a request came from Slack (RFC 0011 "Requests from Slack"): the HMAC-SHA256 of
// `v0:<timestamp>:<raw body>` under the app's signing secret, in `X-Slack-Signature` as `v0=<hex>`, with the
// timestamp within 5 minutes. Nothing reads the body before this passes.

/** Slack's window for `X-Slack-Request-Timestamp`, in seconds either way. */
export const MAX_SKEW_SECONDS = 5 * 60;
/** The largest body read from Slack; interactions carry the message they came from, so some room. */
export const MAX_BODY_BYTES = 256 * 1024;

export type Verified =
  | { ok: true; body: string }
  | { ok: false; status: 401 | 413; reason: "too_large" | "unsigned" | "stale" | "bad_signature" };

const encoder = new TextEncoder();

/**
 * Reads at most `MAX_BODY_BYTES` of `request`'s body and checks Slack's signature on exactly those bytes. A declared
 * `Content-Length` over the limit is refused unread. `now` is epoch milliseconds.
 */
export async function verifySlackRequest(
  request: Request,
  secret: string,
  now: number,
): Promise<Verified> {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp") ?? "";
  const signature = request.headers.get("X-Slack-Signature") ?? "";
  // Checked before the body is read: a request with no signature costs nothing.
  if (!/^\d{1,12}$/.test(timestamp) || !/^v0=[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, status: 401, reason: "unsigned" };
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, reason: "stale" };
  }
  const bytes = await readBounded(request, MAX_BODY_BYTES);
  if (bytes === undefined) return { ok: false, status: 413, reason: "too_large" };
  const prefix = encoder.encode(`v0:${timestamp}:`);
  const message = new Uint8Array(prefix.byteLength + bytes.byteLength);
  message.set(prefix, 0);
  message.set(bytes, prefix.byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // `verify` compares in constant time, so the answer's timing says nothing about how much of the signature matched.
  const valid = await crypto.subtle.verify("HMAC", key, fromHex(signature.slice(3)), message);
  if (!valid) return { ok: false, status: 401, reason: "bad_signature" };
  return { ok: true, body: new TextDecoder().decode(bytes) };
}

/** Signs `body` as Slack would: for tests and local tools, never on a request path. */
export async function signSlackRequest(
  body: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`v0:${timestamp}:${body}`));
  return `v0=${toHex(new Uint8Array(mac))}`;
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The body's bytes, or undefined once they pass `max`: a declared `Content-Length` over the limit is refused unread,
 * and a stream (no length, or a wrong one) is read only up to the limit.
 */
export async function readBounded(
  request: Request,
  max: number,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return undefined;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** SHA-256 of `text`, hex: request keys that name a Slack request without carrying its ids. */
export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))));
}
