-- Email subscribers of each workspace's public status page (RFC 0012 "Email subscriptions", src/status-subscribers.ts).
-- Kept here and never in the workspace shard: the shard keeps no email addresses (RFC 0005 "Email"), and the public
-- subscribe path never wakes a shard for a refused or duplicate request. `email` is lower-cased. A row is `pending`
-- until its owner follows the confirmation link; only `confirmed` rows are ever emailed anything but that one
-- confirmation. `confirm_sends` counts the confirmation emails asked for since `confirm_since` (capped per address).

create table "status_subscriber" (
  "id" text not null primary key,
  "workspace_id" text not null,
  "email" text not null,
  "status" text not null,
  "created_at" integer not null,
  "confirmed_at" integer,
  "confirm_sends" integer not null,
  "confirm_since" integer not null,
  "origin" text
);

create unique index "status_subscriber_email_idx" on "status_subscriber" ("workspace_id", "email");
create index "status_subscriber_send_idx" on "status_subscriber" ("workspace_id", "status", "id");

-- Confirmation emails across every page, per address and UTC day: one address cannot be flooded by many pages.
create table "status_confirmation_send" (
  "email" text not null,
  "day" text not null,
  "count" integer not null,
  primary key ("email", "day")
);
