// The token a client sends Ember to act in a workspace shard (RFC 0016 "Auth"): a compact JWT, HS256, signed with a key
// derived from BETTER_AUTH_SECRET for this one purpose, so an instance needs no new secret. The API mints it at
// `POST /ember-token/:workspace` for a caller it resolved as it resolves a sync upgrade (`resolveActor`: the session
// or an API token, then the member in D1); the Ember auth hook (ember/auth.ts) verifies it and checks D1 again.
//
// Claims: `sub` (the user id, or the API token's `tok_…` id), `ws` (the one workspace it is for: the shard refuses a
// token for another), `role` (the member's role as D1 held it), `kind` (`token` for an API token), `sid` (the session
// id, never the session token; absent for an API token), `iat` and `exp` (seconds). `exp` is the earlier of 5 minutes
// and the session's own expiry, so a token never outlives its session.

import { isRole, type Role } from "@freecorps/brigade-schema";

/** How long a token lives at most: the bound RFC 0016 "Auth" puts on a revocation that the socket close missed. */
export const EMBER_TOKEN_TTL_S = 5 * 60;

export type EmberTokenClaims = {
  sub: string;
  ws: string;
  role: Role;
  kind?: "token";
  sid?: string;
  iat: number;
  exp: number;
};

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

/** The HMAC key for Ember tokens, derived from `BETTER_AUTH_SECRET` (as the status page's link key is). */
function tokenKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          {
            name: "HKDF",
            hash: "SHA-256",
            salt: new Uint8Array(),
            info: encoder.encode("brigade-ember-token:v1"),
          },
          base,
          { name: "HMAC", hash: "SHA-256", length: 256 },
          false,
          ["sign", "verify"],
        ),
      );
    keys.set(secret, key);
  }
  return key;
}

const base64url = (bytes: Uint8Array): string => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64url = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
};

const HEADER = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));

/**
 * A token for `claims` minus its times: issued at `now` (ms), expiring after `EMBER_TOKEN_TTL_S` or at
 * `sessionExpiresAt` (ms) if that is sooner. Undefined for a session already past its expiry: it gets no token.
 */
export async function mintEmberToken(
  secret: string,
  claims: Omit<EmberTokenClaims, "iat" | "exp">,
  now: number,
  sessionExpiresAt?: number,
): Promise<{ token: string; expiresAt: number } | undefined> {
  const iat = Math.floor(now / 1000);
  let exp = iat + EMBER_TOKEN_TTL_S;
  if (sessionExpiresAt !== undefined) exp = Math.min(exp, Math.floor(sessionExpiresAt / 1000));
  if (exp <= iat) return undefined;
  const body = base64url(encoder.encode(JSON.stringify({ ...claims, iat, exp })));
  const signed = `${HEADER}.${body}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await tokenKey(secret),
    encoder.encode(signed),
  );
  return { token: `${signed}.${base64url(new Uint8Array(signature))}`, expiresAt: exp * 1000 };
}

/** The claims of `token` if this instance signed it, it is well formed and it has not expired at `now` (ms). */
export async function verifyEmberToken(
  secret: string,
  token: string,
  now: number,
): Promise<EmberTokenClaims | undefined> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return undefined;
  const signature = fromBase64url(parts[2]!);
  const body = fromBase64url(parts[1]!);
  if (!signature || !body) return undefined;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await tokenKey(secret),
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
  if (typeof claims !== "object" || claims === null) return undefined;
  const { sub, ws, role, kind, sid, iat, exp } = claims as Record<string, unknown>;
  if (typeof sub !== "string" || typeof ws !== "string" || !isRole(role)) return undefined;
  if (typeof iat !== "number" || typeof exp !== "number" || exp * 1000 <= now) return undefined;
  if (kind !== undefined && kind !== "token") return undefined;
  if (sid !== undefined && typeof sid !== "string") return undefined;
  return {
    sub,
    ws,
    role,
    iat,
    exp,
    ...(kind === undefined ? {} : { kind }),
    ...(sid === undefined ? {} : { sid }),
  };
}
