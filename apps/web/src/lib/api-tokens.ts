// The dashboard's side of API tokens (RFC 0014): minting and revoking go through the API (the token is made and
// hashed there, and shown once), the list comes from the shard over sync (`apiToken.all`).

import { m } from "@freecorps/brigade-i18n";
import {
  API_TOKEN_NAME_MAX,
  can,
  TOKEN_SCOPES,
  type Permission,
  type Role,
} from "@freecorps/brigade-schema";

export function tokenText(part: string, args: { name?: string; when?: string } = {}): string {
  return m.api_tokens_card({ part, name: args.name ?? "", when: args.when ?? "" });
}

/** A scope as the form and the list name it. */
export function scopeLabel(scope: Permission): string {
  return m.api_token_scope({ scope: scope.replace(":", "_") });
}

/** The scopes, grouped by what they act on, in the access table's order. */
export const SCOPE_GROUPS: { resource: string; scopes: Permission[] }[] = TOKEN_SCOPES.reduce<
  { resource: string; scopes: Permission[] }[]
>((groups, scope) => {
  const resource = scope.split(":")[0]!;
  const last = groups.at(-1);
  if (last?.resource === resource) last.scopes.push(scope);
  else groups.push({ resource, scopes: [scope] });
  return groups;
}, []);

/** The scopes `role` may grant: a token never carries more than its creator. */
export function grantable(role: Role): Permission[] {
  return TOKEN_SCOPES.filter((scope) => can(role, scope));
}

export const EXPIRY_CHOICES = [30, 90, 365, null] as const;
export type Expiry = (typeof EXPIRY_CHOICES)[number];

export type TokenDraft = { name: string; scopes: Permission[]; expiresInDays: Expiry };

export const emptyTokenDraft = (): TokenDraft => ({ name: "", scopes: [], expiresInDays: 90 });

export type DraftIssues = { name?: string; scopes?: string };

/** What the form would refuse before sending: a name, and at least one scope. */
export function checkTokenDraft(draft: TokenDraft): DraftIssues {
  const issues: DraftIssues = {};
  const name = draft.name.trim();
  if (name === "" || Array.from(name).length > API_TOKEN_NAME_MAX) {
    issues.name = tokenText("name_invalid");
  }
  if (draft.scopes.length === 0) issues.scopes = tokenText("scopes_none");
  return issues;
}

export type MintResult = { ok: true; token: string; name: string } | { ok: false; part: string };

/**
 * Mints a token: `POST /api/workspaces/:id/api-tokens`. Never retried by itself: a mint whose answer was lost made a
 * token nobody saw, and the list shows it to revoke.
 */
export async function mintToken(
  workspaceId: string,
  draft: TokenDraft,
  fetcher: typeof fetch = fetch,
): Promise<MintResult> {
  let response: Response;
  try {
    response = await fetcher(`/api/workspaces/${encodeURIComponent(workspaceId)}/api-tokens`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name.trim(),
        scopes: TOKEN_SCOPES.filter((scope) => draft.scopes.includes(scope)),
        expiresInDays: draft.expiresInDays,
      }),
    });
  } catch {
    return { ok: false, part: "create_failed" };
  }
  const body = (await response.json().catch(() => ({}))) as {
    token?: unknown;
    name?: unknown;
    error?: unknown;
    issues?: { path?: unknown }[];
  };
  if (response.ok && typeof body.token === "string") {
    return { ok: true, token: body.token, name: typeof body.name === "string" ? body.name : "" };
  }
  if (body.error === "limit_reached") return { ok: false, part: "limit" };
  if (body.error === "forbidden" || body.error === "not_a_member") {
    return { ok: false, part: "forbidden" };
  }
  if (body.error === "invalid_args" && body.issues?.[0]?.path === "name") {
    return { ok: false, part: "name_invalid" };
  }
  return { ok: false, part: "create_failed" };
}

/** Revokes a token: `DELETE /api/workspaces/:id/api-tokens/:tokenId`. True once it is revoked. */
export async function revokeToken(
  workspaceId: string,
  tokenId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/api-tokens/${encodeURIComponent(tokenId)}`,
      { method: "DELETE", headers: { Accept: "application/json" } },
    );
    return response.ok;
  } catch {
    return false;
  }
}
