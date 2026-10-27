-- Sessions that ended and whose end some workspace shard has yet to act on (RFC 0004 "Session revocation", RFC 0006
-- "Device registration"; src/session-end.ts). Better Auth's session-delete hook writes one row per workspace of the
-- user before the session row goes, so a sign-out whose shard call then fails is not lost: the shard closes the
-- session's sockets and takes the phone that signed out (`deviceId`, when the mobile app named it) off the member's
-- devices, then the row is deleted. The hook does that right away; the Worker's cron sweeps what is left, and a shard
-- catches up on its own rows before a phone registers in it and after every sync upgrade. `endedAt` (ms since the
-- epoch) keeps a phone its member signed in on again since.
create table "session_end" (
  "workspaceId" text not null,
  "sessionId" text not null,
  "userId" text not null,
  "deviceId" text,
  "endedAt" integer not null,
  primary key ("workspaceId", "sessionId")
);

create index "session_end_endedAt_idx" on "session_end" ("endedAt");
