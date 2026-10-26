-- Workspace invitations (RFC 0003 "Invitations", src/invitations.ts): at most one pending invitation per address
-- per workspace, kept by D1 itself, so two invites racing for one address cannot both get in. Addresses are stored
-- lower-cased. The workspace shard writes these rows; Better Auth's own invitation routes stay refused.

create unique index "invitation_pending_email_idx" on "invitation" ("organizationId", "email") where "status" = 'pending';
