// Slack bot tokens at rest (RFC 0011 "Where the token lives"): AES-256-GCM under `SLACK_TOKEN_KEY` (a secret on this
// Worker, 32 random bytes in base64url), a random 96-bit IV per token, and the workspace and team ids as additional
// data, so a sealed token copied into another workspace's row does not open. Stored as `v1.<iv>.<ciphertext>`; a key
// rotation adds `v2` next to it.

const VERSION = "v1";

/** Whether `key` is a usable `SLACK_TOKEN_KEY` (32 bytes, base64url). */
export function isTokenKey(key: string | undefined): key is string {
  if (!key) return false;
  try {
    return fromBase64url(key).byteLength === 32;
  } catch {
    return false;
  }
}

/** What a sealed token is bound to: it opens only for the same workspace and team. */
export function tokenBinding(workspaceId: string, teamId: string): string {
  return `${workspaceId}:${teamId}`;
}

export async function sealToken(key: string, token: string, binding: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(binding) },
    await importKey(key),
    new TextEncoder().encode(token),
  );
  return `${VERSION}.${toBase64url(iv)}.${toBase64url(new Uint8Array(sealed))}`;
}

/** The token, or a thrown error when the key, the binding or the bytes are wrong. */
export async function openToken(key: string, sealed: string, binding: string): Promise<string> {
  const [version, iv, data] = sealed.split(".");
  if (version !== VERSION || !iv || !data) throw new Error("Unknown sealed token format");
  const opened = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv), additionalData: new TextEncoder().encode(binding) },
    await importKey(key),
    fromBase64url(data),
  );
  return new TextDecoder().decode(opened);
}

function importKey(key: string): Promise<CryptoKey> {
  const bytes = fromBase64url(key);
  if (bytes.byteLength !== 32) throw new Error("SLACK_TOKEN_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("Not base64url");
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
