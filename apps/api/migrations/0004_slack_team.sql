-- Which Brigade workspace each Slack team is connected to (RFC 0011 "Where the token lives"): a slash command names
-- a Slack team, and the API needs the workspace before it can reach a shard. The shard stays the authority (its
-- `slack` row); a row here whose shard no longer has the team is stale, ignored, and overwritten by the next install.

create table "slack_team" (
  "team_id" text not null primary key,
  "workspace_id" text not null,
  "updated_at" integer not null
);

create index "slack_team_workspace_id_idx" on "slack_team" ("workspace_id");
