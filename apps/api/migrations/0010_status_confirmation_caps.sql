-- Confirmation caps by recipient domain (RFC 0012 "Email subscriptions", src/notify-status.ts). Each page has its own
-- count per domain and UTC day, so one page's sign-ups never spend another's; `status_confirmation_domain` (0009)
-- stays the count across every page, kept only for domains that are not a large mail provider's.
create table "status_confirmation_page_domain" (
  "workspace_id" text not null,
  "domain" text not null,
  "day" text not null,
  "count" integer not null,
  primary key ("workspace_id", "domain", "day")
);

-- An inbox confirmed on any page of the instance skips the domain caps: found by its `canonical` alone.
create index "status_subscriber_inbox_idx" on "status_subscriber" ("canonical", "status");
