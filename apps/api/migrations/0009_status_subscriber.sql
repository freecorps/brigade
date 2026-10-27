-- Email subscribers of each workspace's public status page (RFC 0012 "Email subscriptions", src/status-subscribers.ts).
-- Kept here and never in the workspace shard: the shard keeps no email addresses (RFC 0005 "Email"), and the public
-- subscribe path never wakes a shard for a refused or duplicate request. `email` is lower-cased; `canonical` is the
-- inbox it reaches (no `+tag`, and no dots at Gmail), so one inbox is one subscriber per page and one count in the
-- caps. A row is `pending` until its owner follows the confirmation link, and is deleted once the link has expired
-- (`requested_at` plus 48 hours); only `confirmed` rows are ever emailed anything but that one confirmation.
-- `confirm_sends` counts the confirmation emails asked for since `confirm_since` (capped per address).

create table "status_subscriber" (
  "id" text not null primary key,
  "workspace_id" text not null,
  "email" text not null,
  "canonical" text not null,
  "status" text not null,
  "created_at" integer not null,
  "confirmed_at" integer,
  "requested_at" integer not null,
  "confirm_sends" integer not null,
  "confirm_since" integer not null,
  "origin" text
);

create unique index "status_subscriber_canonical_idx" on "status_subscriber" ("workspace_id", "canonical");
create index "status_subscriber_send_idx" on "status_subscriber" ("workspace_id", "status", "id");
create index "status_subscriber_pending_idx" on "status_subscriber" ("status", "requested_at");

-- Confirmation emails across every page, per inbox (`canonical`) and UTC day: one inbox cannot be flooded by many
-- pages or many spellings of its address.
create table "status_confirmation_send" (
  "email" text not null,
  "day" text not null,
  "count" integer not null,
  primary key ("email", "day")
);

-- Confirmation emails across every page, per recipient domain and UTC day: a domain that accepts every local part
-- cannot be flooded with made-up addresses.
create table "status_confirmation_domain" (
  "domain" text not null,
  "day" text not null,
  "count" integer not null,
  primary key ("domain", "day")
);
