-- Which workspace owns each status page address (RFC 0012 "Addresses"): `/status/<slug>` is unique across the
-- instance, and a workspace shard cannot see the others, so the API claims a slug here before the shard takes it. A
-- slug the page gives up stays here until its shard has deleted the snapshot under it, so nobody else can claim it
-- while that snapshot may still be served.

create table "status_slug" (
  "slug" text not null primary key,
  "workspace_id" text not null,
  "created_at" integer not null
);

create index "status_slug_workspace_id_idx" on "status_slug" ("workspace_id");
