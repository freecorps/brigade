-- API tokens (RFC 0014): what the API Worker resolves an `Authorization: Bearer brg_…` against. Only the token's
-- digest is kept (`hash`: HMAC-SHA-256 under `API_TOKEN_KEY`, else SHA-256, hex), never the token. `scopes` is a
-- JSON array of permissions; times are ms since the epoch. A token works while it is not revoked, not expired, and
-- its creator is still a member of the workspace whose membership is older than the token. The workspace shard keeps
-- the list the dashboard shows (`api_tokens`), without the digest.

create table "api_token" (
  "id" text not null primary key,
  "workspace_id" text not null,
  "hash" text not null unique,
  "name" text not null,
  "created_by" text not null,
  "scopes" text not null,
  "created_at" integer not null,
  "expires_at" integer,
  "last_used_at" integer,
  "revoked_at" integer
);

create index "api_token_workspace_id_idx" on "api_token" ("workspace_id");
