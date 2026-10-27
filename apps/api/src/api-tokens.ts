// API tokens (RFC 0014): minting and revoking them (`POST` and `DELETE /workspaces/:id/api-tokens…`, the dashboard's
// API tokens card, cookie only), and resolving `Authorization: Bearer brg_…` on the public routes into an actor
// (`kind: "token"`) for the workspace's shard. D1 holds each token's digest (`api_token`); the token is shown once, in
// the answer to the request that minted it, and is never logged, stored, sent to a shard or put in an event.

import {
  allows,
  API_TOKEN_PATTERN,
  API_TOKEN_PREFIX,
  apiTokenExpiry,
  apiTokenRequest,
  can,
  isId,
  isRole,
  newId,
  scopesBeyond,
  type Actor,
  type Permission,
  type Role,
} from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import type { Auth } from "./auth.ts";
import { readBounded } from "./body.ts";
import { fromBase64url, isTokenKey } from "./slack-token.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

export type ApiTokenEnv = Pick<Env, "DB" | "WORKSPACE" | "API_TOKEN_LIMIT"> & {
  API_TOKEN_KEY?: string;
};

/** How long an isolate trusts a token it resolved in D1; revoking drops it from the revoking isolate at once. */
export const TOKEN_CACHE_MS = 10 * 1000;
const TOKEN_CACHE_MAX = 1000;
/** How often a token's last use is written to D1 (and copied to the shard's list), at most. */
export const LAST_USED_EVERY_MS = 5 * 60 * 1000;
/** Largest mint request body read: a name and the scopes fit well under it. */
const MAX_BODY_BYTES = 4096;

/** A token's own row as D1 has it, cached per isolate. Never the token itself. */
type TokenRow = {
  id: string;
  workspaceId: string;
  hash: string;
  createdBy: string;
  scopes: Permission[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
};

/**
 * Tokens found lately, per isolate, by digest, until the time they expire: found and not revoked then. Only the
 * token's row: its creator's membership and role are read on every use.
 */
const resolved = new Map<string, { token: TokenRow; until: number }>();

/** Drops `tokenId` from this isolate's cache (a revoke). Other isolates keep it at most `TOKEN_CACHE_MS`. */
export function forgetToken(tokenId: string): void {
  for (const [hash, entry] of resolved) {
    if (entry.token.id === tokenId) resolved.delete(hash);
  }
}

/** TEST ONLY: empties this isolate's cache. */
export function forgetAllTokens(): void {
  resolved.clear();
}

/**
 * The token a request carries as `Authorization: Bearer …`, or undefined when it carries none (no header, or another
 * scheme: the cookie decides then). A `Bearer` header with nothing usable after it is the empty string, refused.
 */
export function bearerToken(request: Request): string | undefined {
  const header = request.headers.get("Authorization");
  if (header === null) return undefined;
  const match = /^Bearer(?:\s+(\S*))?\s*$/i.exec(header);
  if (!match) return /^Bearer\b/i.test(header) ? "" : undefined;
  return match[1] ?? "";
}

/**
 * A token's digest, hex: HMAC-SHA-256 under `API_TOKEN_KEY` when it is set, else SHA-256. A key that is set but is
 * not 32 bytes of base64url throws: falling back to the plain hash would quietly change every digest. A token minted
 * before the key was set keeps its SHA-256 row until its next use (`resolveBearer` moves it over).
 */
export async function tokenDigest(token: string, key: string | undefined): Promise<string> {
  const data = new TextEncoder().encode(token);
  if (key === undefined || key === "") {
    return toHex(await crypto.subtle.digest("SHA-256", data));
  }
  if (!isTokenKey(key)) throw new Error("API_TOKEN_KEY is not 32 bytes of base64url");
  const hmac = await crypto.subtle.importKey(
    "raw",
    fromBase64url(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", hmac, data));
}

/** A new token: the prefix and 32 random bytes as base64url. */
export function newApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const base64 = btoa(String.fromCharCode(...bytes));
  return `${API_TOKEN_PREFIX}${base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

/** Whether two hex digests are the same, in time that does not depend on where they differ. */
export function sameDigest(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.byteLength !== right.byteLength) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

export type BearerResult =
  | { ok: true; actor: Actor; emailVerified: boolean }
  | { ok: false; response: Response };

/**
 * The actor a bearer token acts as in `workspaceId`: the token's creator's current role (read in D1 on every use),
 * its scopes, its id, its creator (`by`). Every refusal of the token itself is the same `401 unauthenticated`:
 * malformed, unknown, revoked, expired, another workspace's, or its creator no longer a member (or a member again
 * since, after leaving). The token's rate limit (`429`) is counted once the token itself is valid, before its creator
 * is read. Its last use is recorded at most every `LAST_USED_EVERY_MS` (`waitUntil` when given).
 */
export async function resolveBearer(
  token: string,
  env: ApiTokenEnv,
  workspaceId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
  now = Date.now(),
): Promise<BearerResult> {
  if (!API_TOKEN_PATTERN.test(token)) return { ok: false, response: unauthenticated() };
  let hash: string;
  try {
    hash = await tokenDigest(token, env.API_TOKEN_KEY);
  } catch (error) {
    log("hashing an API token failed", { error: String(error) });
    return { ok: false, response: answer({ error: "unavailable" }, 503) };
  }
  let found: TokenRow | undefined;
  const cached = resolved.get(hash);
  if (cached !== undefined && cached.until > now) found = cached.token;
  else {
    resolved.delete(hash);
    try {
      found = await lookUp(env.DB, hash);
      // Minted before `API_TOKEN_KEY` was set: its row holds the plain SHA-256. Found by it once, and moved to the
      // keyed digest, so setting the key never ends a token (RFC 0014 "At rest").
      if (found === undefined && env.API_TOKEN_KEY) found = await migrate(env.DB, token, hash);
    } catch (error) {
      log("API token lookup failed", { error: String(error) });
      return { ok: false, response: answer({ error: "unavailable" }, 503) };
    }
    if (found !== undefined) remember(hash, found, now);
  }
  // The digest is D1's index, so the lookup itself compares it; this compares again in constant time, so nothing
  // about the token's bytes ever depends on how far a comparison ran.
  if (found === undefined || !sameDigest(found.hash, hash)) {
    return { ok: false, response: unauthenticated() };
  }
  if (found.workspaceId !== workspaceId || (found.expiresAt !== null && found.expiresAt <= now)) {
    return { ok: false, response: unauthenticated() };
  }
  // Before its creator is read: a token over its limit costs no more D1 reads.
  if (!(await withinLimit(env.API_TOKEN_LIMIT, found.id))) {
    return {
      ok: false,
      response: answer({ error: "rate_limited" }, 429, { "Retry-After": "60" }),
    };
  }
  let creator: { role: Role; emailVerified: boolean } | undefined;
  try {
    creator = await creatorNow(env.DB, found);
  } catch (error) {
    log("API token creator lookup failed", { error: String(error) });
    return { ok: false, response: answer({ error: "unavailable" }, 503) };
  }
  if (creator === undefined) return { ok: false, response: unauthenticated() };
  if (found.lastUsedAt === null || now - found.lastUsedAt >= LAST_USED_EVERY_MS) {
    found.lastUsedAt = now;
    const recording = recordUse(env, found, now);
    if (waitUntil) waitUntil(recording);
    else await recording;
  }
  return {
    ok: true,
    actor: {
      kind: "token",
      id: found.id,
      role: creator.role,
      by: found.createdBy,
      scopes: found.scopes,
    },
    emailVerified: creator.emailVerified,
  };
}

/** The token with this digest, unless revoked; undefined for none. */
async function lookUp(db: D1Database, hash: string): Promise<TokenRow | undefined> {
  const row = await db
    .prepare(
      `select id, workspace_id as workspaceId, hash, created_by as createdBy, scopes, created_at as createdAt,
         expires_at as expiresAt, last_used_at as lastUsedAt
       from api_token where hash = ? and revoked_at is null limit 1`,
    )
    .bind(hash)
    .first<Omit<TokenRow, "scopes"> & { scopes: string }>();
  if (!row) return undefined;
  let scopes: unknown;
  try {
    scopes = JSON.parse(row.scopes);
  } catch {
    return undefined;
  }
  return Array.isArray(scopes) ? { ...row, scopes: scopes as Permission[] } : undefined;
}

/**
 * The token whose row still holds its plain SHA-256 (minted before `API_TOKEN_KEY` was set), with that row moved to
 * `keyed` (its HMAC digest) in one conditional update; undefined for none. A row another isolate moved meanwhile is
 * found by `keyed` again.
 */
async function migrate(
  db: D1Database,
  token: string,
  keyed: string,
): Promise<TokenRow | undefined> {
  const plain = await tokenDigest(token, undefined);
  const row = await lookUp(db, plain);
  if (row === undefined || !sameDigest(row.hash, plain)) return undefined;
  const moved = await db
    .prepare(`update api_token set hash = ? where id = ? and hash = ?`)
    .bind(keyed, row.id, plain)
    .run();
  if (moved.meta.changes !== 1) return lookUp(db, keyed);
  log("API token digest moved to API_TOKEN_KEY", { token: row.id });
  return { ...row, hash: keyed };
}

/**
 * The token's creator as D1 has them now: a member of its workspace with a Brigade role, whose membership is older
 * than the token (one who left, or was removed, and came back does not revive it). Undefined otherwise.
 */
async function creatorNow(
  db: D1Database,
  token: TokenRow,
): Promise<{ role: Role; emailVerified: boolean } | undefined> {
  const row = await db
    .prepare(
      `select m.role, m."createdAt" as since, u."emailVerified" as emailVerified
       from member m left join "user" u on u.id = m."userId"
       where m."organizationId" = ? and m."userId" = ? limit 1`,
    )
    .bind(token.workspaceId, token.createdBy)
    .first<{ role: string; since: string | number | null; emailVerified: number | null }>();
  if (!row || !isRole(row.role)) return undefined;
  const since = typeof row.since === "number" ? row.since : Date.parse(String(row.since));
  if (since > token.createdAt) return undefined;
  return { role: row.role, emailVerified: row.emailVerified === 1 };
}

function remember(hash: string, token: TokenRow, now: number): void {
  // Oldest first: a Map iterates in insertion order.
  if (resolved.size >= TOKEN_CACHE_MAX) resolved.delete(resolved.keys().next().value!);
  resolved.set(hash, { token, until: now + TOKEN_CACHE_MS });
}

/** One of the token's requests on `API_TOKEN_LIMIT`; true when there was one left, or the limiter failed (fail open). */
async function withinLimit(limiter: RateLimit, tokenId: string): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key: tokenId });
    return success;
  } catch (error) {
    log("API token rate limit failed", { token: tokenId, error: String(error) });
    return true;
  }
}

/**
 * Writes the token's last use to D1, once per `LAST_USED_EVERY_MS` across isolates (a conditional update), then has
 * the shard copy it into its list. Never rejects: a failure is logged and the next use tries again.
 */
async function recordUse(env: ApiTokenEnv, token: TokenRow, now: number): Promise<void> {
  try {
    const written = await env.DB.prepare(
      `update api_token set last_used_at = ?
       where id = ? and (last_used_at is null or last_used_at <= ?)`,
    )
      .bind(now, token.id, now - LAST_USED_EVERY_MS)
      .run();
    if (written.meta.changes !== 1) return;
    await env.WORKSPACE.getByName(token.workspaceId).apiTokenUsed(token.workspaceId, token.id, now);
  } catch (error) {
    log("recording an API token's use failed", { token: token.id, error: String(error) });
  }
}

/** Who made a request to a route that takes a session or a token (RFC 0014 "Using one"). */
export type Caller =
  | { kind: "session"; userId: string; emailVerified: boolean }
  | { kind: "token"; userId: string; emailVerified: boolean; actor: Actor };

/**
 * The caller of a route that takes both: with `Authorization: Bearer`, the token alone (its cookie ignored, no
 * `Origin` check: a page cannot set that header on a request to another site without CORS), and `403 forbidden`
 * unless it may use `permission`; else the session cookie, refusing another site's `Origin` and answering `401`
 * without one. The route checks a session caller's membership itself, as it always did.
 */
export async function callerOf(
  request: Request,
  env: ApiTokenEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  permission: Permission,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<{ ok: true; caller: Caller } | { ok: false; response: Response }> {
  const token = bearerToken(request);
  if (token !== undefined) {
    const result = await resolveBearer(token, env, workspaceId, waitUntil);
    if (!result.ok) return result;
    if (!allows(result.actor, permission)) {
      return { ok: false, response: answer({ error: "forbidden" }, 403) };
    }
    return {
      ok: true,
      caller: {
        kind: "token",
        userId: result.actor.by!,
        emailVerified: result.emailVerified,
        actor: result.actor,
      },
    };
  }
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return { ok: false, response: answer({ error: "forbidden_origin" }, 403) };
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return { ok: false, response: answer({ error: "unauthenticated" }, 401) };
  return {
    ok: true,
    caller: {
      kind: "session",
      userId: session.user.id,
      emailVerified: session.user.emailVerified,
    },
  };
}

/** The `401` every refused token gets, whatever the reason. */
export function unauthenticated(): Response {
  return answer({ error: "unauthenticated" }, 401, { "WWW-Authenticate": "Bearer" });
}

/** How the shard's refusals of a mint or revoke answer. */
const STATUS: Partial<Record<string, number>> = {
  forbidden: 403,
  not_a_member: 403,
  not_found: 404,
  conflict: 409,
  limit_reached: 409,
  invalid_args: 400,
};

/**
 * `POST /workspaces/:id/api-tokens` `{ name, scopes, expiresInDays }` mints a token (201 `{ id, token, name, scopes,
 * expiresAt }`, the only time the token is shown); `DELETE /workspaces/:id/api-tokens/:tokenId` revokes one (200).
 * Owners and admins (`token:manage`), with the session cookie: a request with a bearer token is refused (`403
 * forbidden`), since a token never mints or revokes tokens. D1 first, then the shard's mutation and event; a mint the
 * shard refuses is deleted from D1 again, so it never works.
 */
export async function apiTokenRoute(
  request: Request,
  env: ApiTokenEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  tokenId: string | undefined,
): Promise<Response> {
  const method = tokenId === undefined ? "POST" : "DELETE";
  if (request.method !== method) {
    return answer({ error: "method_not_allowed" }, 405, { Allow: method });
  }
  if (!ORGANIZATION_ID.test(workspaceId)) return answer({ error: "invalid_workspace_id" }, 400);
  if (tokenId !== undefined && !isId("tok", tokenId)) return answer({ error: "not_found" }, 404);
  if (bearerToken(request) !== undefined) return answer({ error: "forbidden" }, 403);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return answer({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return answer({ error: "unauthenticated" }, 401);
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    log("member lookup failed", { error: String(error) });
    return answer({ error: "unavailable" }, 503);
  }
  if (role === undefined) return answer({ error: "not_a_member" }, 403);
  if (!can(role, "token:manage")) return answer({ error: "forbidden" }, 403);
  const actor: Actor = { kind: "user", id: session.user.id, role };
  return tokenId === undefined
    ? mint(request, env, workspaceId, actor)
    : revoke(env, workspaceId, actor, tokenId);
}

async function mint(
  request: Request,
  env: ApiTokenEnv,
  workspaceId: string,
  actor: Actor,
): Promise<Response> {
  const text = await readBounded(request, MAX_BODY_BYTES);
  let body: unknown;
  try {
    body = text === undefined ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const parsed = apiTokenRequest(body);
  if (!parsed.ok) return answer({ error: "invalid_args", issues: parsed.issues }, 400);
  const { name, scopes, expiresInDays } = parsed.value;
  if (scopesBeyond(actor.role, scopes).length > 0) return answer({ error: "forbidden" }, 403);

  const now = Date.now();
  const id = newId("tok", now, (length) => crypto.getRandomValues(new Uint8Array(length)));
  const token = newApiToken();
  let hash: string;
  try {
    hash = await tokenDigest(token, env.API_TOKEN_KEY);
  } catch (error) {
    log("hashing an API token failed", { error: String(error) });
    return answer({ error: "not_configured" }, 503);
  }
  const expiresAt = apiTokenExpiry(now, expiresInDays);
  try {
    await env.DB.prepare(
      `insert into api_token (id, workspace_id, hash, name, created_by, scopes, created_at, expires_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, workspaceId, hash, name, actor.id, JSON.stringify(scopes), now, expiresAt)
      .run();
  } catch (error) {
    log("storing an API token failed", { error: String(error) });
    return answer({ error: "unavailable" }, 503);
  }
  let result: { ok: true } | { ok: false; code: string };
  try {
    result = await env.WORKSPACE.getByName(workspaceId).apiTokenRun(
      workspaceId,
      actor,
      "apiToken.create",
      { id, name, scopes, expiresAt },
    );
  } catch (error) {
    log("WorkspaceDO.apiTokenRun failed", { workspace: workspaceId, error: String(error) });
    await unmint(env.DB, id);
    return answer({ error: "unavailable" }, 503);
  }
  if (!result.ok) {
    await unmint(env.DB, id);
    const status = STATUS[result.code];
    return answer({ error: status === undefined ? "internal" : result.code }, status ?? 500);
  }
  return answer({ id, token, name, scopes, expiresAt }, 201, { "Cache-Control": "no-store" });
}

/** Deletes a minted token the shard did not list; if that fails too, it stays unusable only once revoked by hand. */
async function unmint(db: D1Database, id: string): Promise<void> {
  try {
    await db.prepare(`delete from api_token where id = ?`).bind(id).run();
  } catch (error) {
    log("deleting an unlisted API token failed", { token: id, error: String(error) });
  }
}

async function revoke(
  env: ApiTokenEnv,
  workspaceId: string,
  actor: Actor,
  tokenId: string,
): Promise<Response> {
  try {
    const revoked = await env.DB.prepare(
      `update api_token set revoked_at = ? where id = ? and workspace_id = ? and revoked_at is null`,
    )
      .bind(Date.now(), tokenId, workspaceId)
      .run();
    if (revoked.meta.changes !== 1) {
      // Revoked already (a retry whose shard step failed): the shard catches up below. Never there: 404.
      const row = await env.DB.prepare(
        `select 1 as found from api_token where id = ? and workspace_id = ?`,
      )
        .bind(tokenId, workspaceId)
        .first();
      if (!row) return answer({ error: "not_found" }, 404);
    }
  } catch (error) {
    log("revoking an API token failed", { error: String(error) });
    return answer({ error: "unavailable" }, 503);
  }
  forgetToken(tokenId);
  try {
    const result = await env.WORKSPACE.getByName(workspaceId).apiTokenRun(
      workspaceId,
      actor,
      "apiToken.revoke",
      { id: tokenId },
    );
    // D1 has it revoked either way; `not_found`: the shard never listed it (its mint failed there).
    if (result.ok || result.code === "conflict" || result.code === "not_found") {
      return answer({ ok: true }, 200);
    }
    const status = STATUS[result.code];
    return answer({ error: status === undefined ? "internal" : result.code }, status ?? 500);
  } catch (error) {
    log("WorkspaceDO.apiTokenRun failed", { workspace: workspaceId, error: String(error) });
    return answer({ error: "unavailable" }, 503);
  }
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function answer(body: unknown, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, route: "api-tokens", ...fields }));
}
