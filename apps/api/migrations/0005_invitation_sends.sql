-- One row per invitation email asked for (RFC 0003 "Invitations", src/invitations.ts), across every workspace: what
-- the caps that span workspaces count (per invited address and per inviter a day, per invitation ever). A workspace
-- shard inserts a row only when every cap still has room, in the same batch as the invitation it sends, so two
-- workspaces racing for one address cannot both pass. `email` is lower-cased, like the invitation's.

create table "invitation_send" ("id" text not null primary key, "invitationId" text not null, "email" text not null, "inviterId" text not null, "at" integer not null);
create index "invitation_send_email_idx" on "invitation_send" ("email", "at");
create index "invitation_send_inviter_idx" on "invitation_send" ("inviterId", "at");
create index "invitation_send_invitation_idx" on "invitation_send" ("invitationId");
