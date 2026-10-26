-- The language Brigade writes to a user in (RFC 0008): the email notifier renders each email in it (RFC 0005
-- "Email"). Better Auth's `user.additionalFields.locale` (src/auth.ts); null reads as English.

alter table "user" add column "locale" text;
