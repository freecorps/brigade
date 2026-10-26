-- Password reset (RFC 0002 "Auth").
--
-- `user.passwordResetAt`: when the password was last reset (ms since the epoch; Better Auth's
-- `user.additionalFields.passwordResetAt`, written by src/auth.ts only). Each shard's member reconcile drops the
-- devices and closes the sockets of a member from before it, so a phone of whoever held the account stops being paged
-- even when the reset's own sign-out failed in that shard.
--
-- `takeover_notice`: what the dashboard tells the owner of an address once, after they took back an account someone
-- else signed up with: the workspaces they inherited and what Brigade paused there (`workspaces`, JSON written by
-- src/index.ts). Deleted when they dismiss it, or with the user.
alter table "user" add column "passwordResetAt" integer;

create table "takeover_notice" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "workspaces" text not null,
  "createdAt" integer not null
);
