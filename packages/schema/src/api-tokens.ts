// API tokens (RFC 0014): per-workspace bearer tokens for scripts and integrations. The token itself and its digest
// live in D1 only (the API Worker mints, hashes and resolves them); the shard keeps this list (`api_tokens`, synced to
// owners and admins, never the token or its digest) for the dashboard and for naming a token's timeline entries, and runs
// `apiToken.create` and `apiToken.revoke` so each is an event through its outbox (RFC 0005).

import { can, PERMISSIONS, type Permission, type Role } from "./access.ts";
import { defineMutation, fail, ok, type Actor, type DomainEvent } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { ApiTokenRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";

/** What a token is never given: the workspace exists already, devices are a person's, and tokens never mint tokens. */
const NEVER_SCOPES: readonly Permission[] = ["workspace:create", "device:register", "token:manage"];

/** Every permission a token may carry, in the access table's order. */
export const TOKEN_SCOPES: readonly Permission[] = PERMISSIONS.filter(
  (permission) => !NEVER_SCOPES.includes(permission),
);

export const API_TOKEN_NAME_MAX = 60;
/** The longest expiry a token may have, in days; none means until revoked. */
export const API_TOKEN_MAX_DAYS = 365;
/** Tokens a workspace may hold that are neither revoked nor expired. */
export const MAX_API_TOKENS = 50;
/** How long a revoked or expired token stays listed before minting another drops it. */
export const API_TOKEN_LISTED_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The system actor that copies a token's last use into the list (`apiToken.touch`). */
export const TOKENS_ACTOR: Actor = { kind: "system", id: "sys_tokens", role: "admin" };

/** The prefix every token starts with, so leaked ones can be found by secret scanning (RFC 0014). */
export const API_TOKEN_PREFIX = "brg_";
/** A whole token: the prefix and 32 random bytes as base64url (43 characters). */
export const API_TOKEN_PATTERN = /^brg_[A-Za-z0-9_-]{43}$/;

const scope: Validator<Permission> = v.picklist(TOKEN_SCOPES);
export const apiTokenScopes: Validator<Permission[]> = v.array(scope, {
  min: 1,
  max: TOKEN_SCOPES.length,
  unique: true,
});
export const apiTokenName: Validator<string> = v.string({ min: 1, max: API_TOKEN_NAME_MAX });

/** What minting asks for (`POST /workspaces/:id/api-tokens`). */
export type ApiTokenRequest = {
  name: string;
  scopes: Permission[];
  /** null: until revoked. */
  expiresInDays: number | null;
};

export const apiTokenRequest: Validator<ApiTokenRequest> = v.object({
  name: apiTokenName,
  scopes: apiTokenScopes,
  expiresInDays: v.nullable(v.integer({ min: 1, max: API_TOKEN_MAX_DAYS })),
});

/** The scopes `role` cannot grant: a token never carries more than its creator. */
export function scopesBeyond(role: Role, scopes: readonly Permission[]): Permission[] {
  return scopes.filter((permission) => !can(role, permission));
}

/** When a token minted at `now` for `days` expires, or null. */
export function apiTokenExpiry(now: number, days: number | null): number | null {
  return days === null ? null : now + days * DAY_MS;
}

/**
 * How a listed token stands: `revoked`, `expired`, `disabled` (its creator is no longer in the shard's member list:
 * they left or were removed, RFC 0014), else `active`.
 */
export function apiTokenState(
  row: ApiTokenRow,
  now: number,
  isMember: (userId: string) => boolean,
): "active" | "revoked" | "expired" | "disabled" {
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt !== null && row.expiresAt <= now) return "expired";
  if (!isMember(row.createdBy)) return "disabled";
  return "active";
}

export type ApiTokenCreated = DomainEvent<
  "apiToken.created",
  { id: string; name: string; scopes: Permission[]; expiresAt: number | null; createdBy: string }
>;
export type ApiTokenRevoked = DomainEvent<"apiToken.revoked", { id: string; name: string }>;

/**
 * Server only (`WorkspaceDO.apiTokenRun`, as the member who mints it, after the API Worker stored its digest in D1):
 * lists the token and emits `apiToken.created`. Refuses scopes the member's role does not grant and more than
 * `MAX_API_TOKENS` live ones; drops tokens revoked or expired more than `API_TOKEN_LISTED_MS` ago.
 */
export const createApiToken = defineMutation({
  name: "apiToken.create",
  args: v.object({
    id: v.id("tok"),
    name: apiTokenName,
    scopes: apiTokenScopes,
    expiresAt: v.nullable(v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })),
  }),
  permission: "token:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only a member mints a token");
    if (scopesBeyond(ctx.actor.role, args.scopes).length > 0) {
      return fail("forbidden", "A token never carries more than its creator's role");
    }
    if (store.get("api_tokens", args.id)) return fail("conflict", "Token already exists");
    const rows = store.scan("api_tokens");
    let live = 0;
    for (const row of rows) {
      const ended =
        row.revokedAt ??
        (row.expiresAt !== null && row.expiresAt <= ctx.now ? row.expiresAt : null);
      if (ended === null) live++;
      else if (ctx.now - ended >= API_TOKEN_LISTED_MS) store.delete("api_tokens", row.id);
    }
    if (live >= MAX_API_TOKENS) return fail("limit_reached", `At most ${MAX_API_TOKENS} tokens`);
    const row: ApiTokenRow = {
      id: args.id,
      name: args.name,
      scopes: args.scopes,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
      expiresAt: args.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      revokedBy: null,
    };
    store.insert("api_tokens", row);
    const event: ApiTokenCreated = {
      type: "apiToken.created",
      subject: row.id,
      data: {
        id: row.id,
        name: row.name,
        scopes: [...row.scopes],
        expiresAt: row.expiresAt,
        createdBy: row.createdBy,
      },
    };
    return ok(event);
  },
});

/**
 * Server only (`WorkspaceDO.apiTokenRun`, after the API Worker marked the D1 row revoked): marks the listed token
 * revoked and emits `apiToken.revoked`. `conflict` when it already is. Only a member revokes, like minting.
 */
export const revokeApiToken = defineMutation({
  name: "apiToken.revoke",
  args: v.object({ id: v.id("tok") }),
  permission: "token:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only a member revokes a token");
    const row = store.get("api_tokens", args.id);
    if (!row) return fail("not_found", "No such token");
    if (row.revokedAt !== null) return fail("conflict", "Token already revoked");
    store.update("api_tokens", row.id, { revokedAt: ctx.now, revokedBy: ctx.actor.id });
    const event: ApiTokenRevoked = {
      type: "apiToken.revoked",
      subject: row.id,
      data: { id: row.id, name: row.name },
    };
    return ok(event);
  },
});

/**
 * Server only, as `TOKENS_ACTOR`: copies when the token was last used (D1 has it, written at most every few minutes)
 * into the list. An observed value, not a change to the workspace, so `silent`.
 */
export const touchApiToken = defineMutation({
  name: "apiToken.touch",
  args: v.object({ id: v.id("tok"), at: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }) }),
  permission: "token:manage",
  silent: true,
  apply(store, args, ctx) {
    if (ctx.actor.kind !== TOKENS_ACTOR.kind || ctx.actor.id !== TOKENS_ACTOR.id) {
      return fail("forbidden", "Only the API records a use");
    }
    const row = store.get("api_tokens", args.id);
    if (!row) return fail("not_found", "No such token");
    if (row.lastUsedAt !== null && row.lastUsedAt >= args.at)
      return fail("conflict", "Already newer");
    store.update("api_tokens", row.id, { lastUsedAt: args.at });
    return ok();
  },
});

export const apiTokenServerMutations = [createApiToken, revokeApiToken, touchApiToken] as const;

/**
 * The workspace's tokens, newest first: which scripts act in it, and by whom. Owners and admins only (decided, Q25),
 * the ones who mint and revoke them; to everyone else a token's timeline entries read "An API token". Never a token's
 * own scope (`token:manage` is not one), so a script never lists its siblings.
 */
export const allApiTokens = defineQuery({
  name: "apiToken.all",
  args: v.object({}),
  permission: "token:manage",
  table: "api_tokens",
  filter: () => true,
  sort: (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1),
});
