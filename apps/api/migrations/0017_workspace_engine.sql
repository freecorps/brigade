-- Which engine holds a workspace (RFC 0016 "Data migration"): `brigade`, its `WorkspaceDO` as before, or `ember`, its
-- Ember shard (`workspace:<id>`, apps/api/ember). A workspace with no row is on `brigade`. The migration route copies a
-- workspace's rows into its Ember shard and then writes `ember` here; writing `brigade` again turns it back.
-- `switchedAt` (ms since the epoch) is when it last changed.
create table "workspace_engine" (
  "workspaceId" text not null primary key,
  "engine" text not null check ("engine" in ('brigade', 'ember')),
  "switchedAt" integer not null
);
