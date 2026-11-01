-- Signing in to the mobile app with a QR code from the dashboard (RFC 0015 section 6, D2; src/app-sign-in.ts). One row
-- per code a signed-in member asked for: the code and the secret the claiming phone got are kept only as SHA-256
-- digests; the 2-digit number is kept as it is (100 values, nothing to gain by hashing it), only until the row ends.
-- `state` moves `issued` → `claimed` → `approved` → `delivered`, or ends at `denied`, `wrong_number` or `signed_out`; each step is
-- one conditional `update … returning`, so a code is claimed once and a session handed out once. `expiresAt` (ms
-- since the epoch) is 2 minutes from the code, then 2 minutes from the claim. The cron deletes rows a day after
-- they ended. `sessionId` is the dashboard session that asked: only it may see, approve or deny the claim.
-- `deviceKind` (`apple`, `android`, `phone`) is all the dashboard shows of the claiming phone before the approval;
-- `deviceName`, the phone's own words, is only copied to the session it gets.
create table "app_sign_in" (
  "id" text not null primary key,
  "codeHash" text not null unique,
  "userId" text not null references "user" ("id") on delete cascade,
  "sessionId" text not null,
  "state" text not null,
  "createdAt" integer not null,
  "expiresAt" integer not null,
  "deviceName" text,
  "deviceKind" text,
  "secretHash" text,
  "number" text,
  "claimedAt" integer,
  "endedAt" integer
);

create index "app_sign_in_sessionId_idx" on "app_sign_in" ("sessionId");
create index "app_sign_in_expiresAt_idx" on "app_sign_in" ("expiresAt");

-- The device a session was made for by an approved QR sign-in and how it was made (Better Auth's
-- `session.deviceName` and `session.signInMethod`, `qr`; additional fields in src/auth.ts): listed with the account's
-- sessions, null for every other sign-in.
alter table "session" add column "deviceName" text;
alter table "session" add column "signInMethod" text;
