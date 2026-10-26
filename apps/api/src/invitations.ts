// Workspace invitations in the workspace shard (RFC 0003 "Invitations"). D1 (Better Auth's `invitation` and
// `member` tables) is the authority, as for member changes (src/members.ts), and a change goes the same way:
//
// 1. D1 first, from inside the shard and under its member lock, so an invitation, an acceptance and a member change
//    of one workspace never interleave between reading D1 and writing it. Every write re-checks its condition in
//    SQL (still pending, not expired), in case D1 moved meanwhile.
// 2. Then the shard: a server-only mutation (`invitation.create`, `invitation.revoke`, `invitation.decline`,
//    `member.add`) writes the event to the outbox (RFC 0005); `member.invited` is what the email notifier turns into
//    the invitation email (src/notify-invite.ts).
//
// If step 2 fails after D1 committed, the request answers `not_applied`, and the shard records the mutation it owes
// (`invitation_repair`) and arms the member repair alarm, which runs it again (as `MEMBERS_ACTOR`) until it is in.
//
// The shard also keeps the invitation emails' ledger (`invitation_sends`): one row per email asked for, which counts
// toward `INVITATIONS_DAILY_CAP` and `INVITATION_RESEND_INTERVAL_MS` and makes a redelivered event send nobody twice.
// The caps that span workspaces (per invited address, per inviter, per invitation) are counted in D1's
// `invitation_send` instead, written in the same batch as the invitation, so no other shard can slip past them.

import {
  checkInvite,
  fitMemberName,
  INVITATION_MAX_SENDS,
  INVITATION_RESEND_INTERVAL_MS,
  INVITATION_TTL_MS,
  INVITATIONS_DAILY_CAP,
  INVITATIONS_PER_ADDRESS_DAILY_CAP,
  invitationAddressKey,
  INVITATIONS_PER_INVITER_DAILY_CAP,
  isRole,
  MAX_PENDING_INVITATIONS,
  MAX_WORKSPACE_MEMBERS,
  MEMBERS_ACTOR,
  newId,
  type Actor,
  type RandomBytes,
  type Role,
} from "@freecorps/brigade-schema";
import { authId, WORKSPACE_LIMIT } from "./auth.ts";
import { readRole, type Membership } from "./members.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Logger, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** An invitation as D1 has it (Better Auth's row; dates as ISO strings, as Better Auth writes them to SQLite). */
export type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviterId: string;
};

/** Better Auth's statuses, and `expired` for a pending one replaced after it ran out. */
export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled" | "expired";

/**
 * Why an invitation request was refused:
 * - `forbidden`: the rules (`checkInvite`), or the caller is not a member who manages invitations;
 * - `already_member`, `already_invited` (a pending one for that address), `limit_reached` (`MAX_PENDING_INVITATIONS`),
 *   `rate_limited` (`INVITATIONS_DAILY_CAP`), `address_limited` (`INVITATIONS_PER_ADDRESS_DAILY_CAP`),
 *   `inviter_limited` (`INVITATIONS_PER_INVITER_DAILY_CAP`), `send_limit` (`INVITATION_MAX_SENDS`), `too_soon`
 *   (`INVITATION_RESEND_INTERVAL_MS`);
 * - `not_found` (no such pending invitation in this workspace), `expired`, `wrong_email` (signed in with another
 *   address), `unverified` (that address is not verified yet), `workspace_full` (`MAX_WORKSPACE_MEMBERS`),
 *   `workspace_limit` (the invitee already belongs to `WORKSPACE_LIMIT` workspaces);
 * - `conflict` (D1 changed while this ran), `unavailable` (D1 failed: nothing changed), `not_applied` (D1 changed,
 *   the shard did not yet: the repair alarm finishes it).
 */
export type InvitationCode =
  | "forbidden"
  | "already_member"
  | "already_invited"
  | "limit_reached"
  | "rate_limited"
  | "address_limited"
  | "inviter_limited"
  | "send_limit"
  | "too_soon"
  | "not_found"
  | "expired"
  | "wrong_email"
  | "unverified"
  | "workspace_full"
  | "workspace_limit"
  | "conflict"
  | "unavailable"
  | "not_applied";

export type InvitationResult<T = object> = ({ ok: true } & T) | { ok: false; code: InvitationCode };

/** A pending invitation as the API lists it. */
export type ListedInvitation = {
  id: string;
  email: string;
  role: Role;
  /** Epoch milliseconds. */
  expiresAt: number;
  createdAt: number;
  invitedBy: { id: string; name: string | null };
};

/** The invitee, as the Worker read them from the session (the shard reads the address and its status again). */
export type Invitee = { id: string; email: string };

/** One invitation email the notifier should send (`WorkspaceDO.planInvitationEmail`). */
export type InvitationEmailPlan =
  | { send: true; key: string; origin: string | null }
  | { send: false; reason: "held"; until: number }
  | { send: false; reason: "nothing" };

/** How long a plan holds an invitation email for the delivery that asked (like `EMAIL_CLAIM_MS`). */
export const INVITATION_CLAIM_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SCHEMA = `
  create table if not exists invitation_sends (
    key text primary key,
    invitation_id text not null,
    at integer not null,
    origin text,
    done integer not null default 0,
    claimed_until integer not null default 0
  ) without rowid;
  create index if not exists invitation_sends_at on invitation_sends (at);
  create index if not exists invitation_sends_invitation on invitation_sends (invitation_id, at);
  create table if not exists invitation_repair (
    key text primary key,
    name text not null,
    args text not null,
    at integer not null
  ) without rowid;
`;

const iso = (ms: number) => new Date(ms).toISOString();

/** One invitation of this workspace, whatever its status, or undefined. */
async function readInvitation(
  db: D1Database,
  workspaceId: string,
  id: string,
): Promise<InvitationRow | undefined> {
  const row = await db
    .prepare(`select * from invitation where id = ? and "organizationId" = ?`)
    .bind(id, workspaceId)
    .first<InvitationRow>();
  return row ?? undefined;
}

/** The workspace an invitation belongs to, for the accept and decline routes (which only have its id). */
export async function invitationWorkspace(db: D1Database, id: string): Promise<string | undefined> {
  const row = await db
    .prepare(`select "organizationId" as workspace from invitation where id = ?`)
    .bind(id)
    .first<{ workspace: string }>();
  return row?.workspace;
}

/**
 * What the invitee's page shows about an invitation: the workspace, who invited, the role, whether it can still be
 * accepted, and whether it is for the signed-in address. The invited address itself is never returned.
 */
export type InvitationPreview = {
  id: string;
  workspace: { id: string; name: string };
  invitedBy: string | null;
  role: Role | null;
  status: InvitationStatus | "unknown";
  expiresAt: number;
  forYou: boolean;
};

const STATUSES: readonly string[] = ["pending", "accepted", "rejected", "canceled", "expired"];

export async function previewInvitation(
  db: D1Database,
  id: string,
  email: string,
  now: number,
): Promise<InvitationPreview | undefined> {
  const row = await db
    .prepare(
      `select i.id, i.email, i.role, i.status, i."expiresAt" as expiresAt, o.id as workspaceId,
              o.name as workspaceName, u.name as inviter
       from invitation i join organization o on o.id = i."organizationId"
       left join "user" u on u.id = i."inviterId"
       where i.id = ?`,
    )
    .bind(id)
    .first<{
      id: string;
      email: string;
      role: string | null;
      status: string;
      expiresAt: string;
      workspaceId: string;
      workspaceName: string;
      inviter: string | null;
    }>();
  if (!row) return undefined;
  const expiresAt = Date.parse(row.expiresAt);
  const status = !STATUSES.includes(row.status)
    ? "unknown"
    : row.status === "pending" && expiresAt <= now
      ? "expired"
      : (row.status as InvitationStatus);
  const forYou = row.email.toLowerCase() === email.toLowerCase();
  // Someone else's invitation: whose it is and what it offers are none of their business.
  return {
    id: row.id,
    workspace: { id: row.workspaceId, name: row.workspaceName },
    invitedBy: forYou ? row.inviter : null,
    role: forYou && isRole(row.role) ? row.role : null,
    status,
    expiresAt,
    forYou,
  };
}

/**
 * The workspace's pending invitations, newest first, those that ran out included (Resend brings one back; the
 * dashboard says it expired).
 */
export async function listInvitations(
  db: D1Database,
  workspaceId: string,
): Promise<ListedInvitation[]> {
  const { results } = await db
    .prepare(
      `select i.id, i.email, i.role, i."expiresAt" as expiresAt, i."createdAt" as createdAt,
              i."inviterId" as inviterId, u.name as inviterName
       from invitation i left join "user" u on u.id = i."inviterId"
       where i."organizationId" = ? and i.status = 'pending'
       order by i."createdAt" desc, i.id desc
       limit ?`,
    )
    .bind(workspaceId, MAX_PENDING_INVITATIONS * 2)
    .all<{
      id: string;
      email: string;
      role: string | null;
      expiresAt: string;
      createdAt: string;
      inviterId: string;
      inviterName: string | null;
    }>();
  return results.flatMap((row) =>
    isRole(row.role)
      ? [
          {
            id: row.id,
            email: row.email,
            role: row.role,
            expiresAt: Date.parse(row.expiresAt),
            createdAt: Date.parse(row.createdAt),
            invitedBy: { id: row.inviterId, name: row.inviterName },
          },
        ]
      : [],
  );
}

export class Invitations {
  constructor(
    private readonly options: {
      db: D1Database;
      shard: Shard;
      sql: SqlStorage;
      membership: Membership;
      randomBytes: RandomBytes;
      log: Logger;
      committed(version: number, changes: RowChange[]): void;
    },
  ) {
    options.sql.exec(SCHEMA);
  }

  /**
   * `actorId` invites `email` (already `invitationEmail`) as `role`. `origin`: the dashboard the request came
   * through, for the email's link when `DASHBOARD_URL` is not set. A pending invitation for that address that ran
   * out is replaced.
   */
  invite(
    workspaceId: string,
    actorId: string,
    email: string,
    role: Role,
    origin: string | null,
  ): Promise<InvitationResult<{ invitation: ListedInvitation }>> {
    return this.options.membership.locked(async () => {
      const { db, log } = this.options;
      const now = Date.now();
      this.prune(now);
      const actor = await this.manager(workspaceId, actorId);
      if (!actor.ok) return actor;
      if (!checkInvite(actor, role).ok) return { ok: false, code: "forbidden" };
      let found: { pending: number; same: number; member: number };
      try {
        found = (await db
          .prepare(
            `select
               (select count(*) from invitation
                where "organizationId" = ?1 and status = 'pending' and "expiresAt" > ?3) as pending,
               (select count(*) from invitation
                where "organizationId" = ?1 and status = 'pending' and "expiresAt" > ?3 and email = ?2) as same,
               (select count(*) from member m join "user" u on u.id = m."userId"
                where m."organizationId" = ?1 and lower(u.email) = ?2) as member`,
          )
          .bind(workspaceId, email, iso(now))
          .first<{ pending: number; same: number; member: number }>())!;
      } catch (error) {
        log("invitation: reading D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (found.member > 0) return { ok: false, code: "already_member" };
      if (found.same > 0) return { ok: false, code: "already_invited" };
      if (found.pending >= MAX_PENDING_INVITATIONS) return { ok: false, code: "limit_reached" };
      if (this.sentToday(now) >= INVITATIONS_DAILY_CAP) return { ok: false, code: "rate_limited" };

      const id = authId("invitation", now, this.options.randomBytes);
      const expiresAt = now + INVITATION_TTL_MS;
      try {
        const [, reserved] = await db.batch([
          // One that ran out still holds the address's pending slot (`invitation_pending_email_idx`).
          db
            .prepare(
              `update invitation set status = 'expired'
               where "organizationId" = ? and email = ? and status = 'pending' and "expiresAt" <= ?`,
            )
            .bind(workspaceId, email, iso(now)),
          this.reserveSend(id, email, actorId, now, false),
          // `changes()` is the reservation's: no invitation without its email counted.
          db
            .prepare(
              `insert into invitation (id, "organizationId", email, role, status, "expiresAt", "createdAt", "inviterId")
               select ?, ?, ?, ?, 'pending', ?, ?, ? where changes() = 1`,
            )
            .bind(id, workspaceId, email, role, iso(expiresAt), iso(now), actorId),
        ]);
        if (reserved!.meta.changes !== 1) return await this.capped(id, email, actorId, now);
      } catch (error) {
        // The unique index: another pending invitation for that address got in first (D1 edited meanwhile).
        if (String(error).includes("UNIQUE")) return { ok: false, code: "already_invited" };
        log("invitation: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      await this.pruneSends(now);
      const invitation: ListedInvitation = {
        id,
        email,
        role,
        expiresAt,
        createdAt: now,
        invitedBy: { id: actorId, name: actor.name },
      };
      this.recordSend(id, 1, now, origin);
      const applied = this.apply(
        { kind: "user", id: actorId, role: actor.role },
        "invitation.create",
        { id, role, expiresAt, send: 1, invitedBy: actorId },
        now,
      );
      return applied.ok ? { ok: true, invitation } : applied;
    });
  }

  /** Sends a pending invitation again, with a new expiry: at most once per `INVITATION_RESEND_INTERVAL_MS`. */
  resend(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    origin: string | null,
  ): Promise<InvitationResult<{ expiresAt: number }>> {
    return this.options.membership.locked(async () => {
      const { db, log } = this.options;
      const now = Date.now();
      this.prune(now);
      const actor = await this.manager(workspaceId, actorId);
      if (!actor.ok) return actor;
      let row: InvitationRow | undefined;
      try {
        row = await readInvitation(db, workspaceId, invitationId);
      } catch (error) {
        log("invitation: reading D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      // Expired but still pending: sending it again is how it comes back.
      if (!row || row.status !== "pending" || !isRole(row.role)) {
        return { ok: false, code: "not_found" };
      }
      if (!checkInvite(actor, row.role).ok) return { ok: false, code: "forbidden" };
      const sends = this.sends(invitationId);
      if (sends.last !== null && now - sends.last < INVITATION_RESEND_INTERVAL_MS) {
        return { ok: false, code: "too_soon" };
      }
      if (this.sentToday(now) >= INVITATIONS_DAILY_CAP) return { ok: false, code: "rate_limited" };
      const expiresAt = now + INVITATION_TTL_MS;
      try {
        const [reserved, updated] = await db.batch([
          this.reserveSend(invitationId, row.email, actorId, now, true),
          db
            .prepare(
              `update invitation set "expiresAt" = ?
               where id = ? and "organizationId" = ? and status = 'pending' and changes() = 1`,
            )
            .bind(iso(expiresAt), invitationId, workspaceId),
        ]);
        if (reserved!.meta.changes !== 1) {
          return await this.capped(invitationId, row.email, actorId, now);
        }
        if (updated!.meta.changes !== 1) return { ok: false, code: "conflict" };
      } catch (error) {
        log("invitation: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      const send = sends.count + 1;
      this.recordSend(invitationId, send, now, origin);
      const applied = this.apply(
        { kind: "user", id: actorId, role: actor.role },
        "invitation.create",
        { id: invitationId, role: row.role, expiresAt, send, invitedBy: actorId },
        now,
      );
      return applied.ok ? { ok: true, expiresAt } : applied;
    });
  }

  /** Revokes a pending invitation (an admin never one for an owner). */
  revoke(workspaceId: string, actorId: string, invitationId: string): Promise<InvitationResult> {
    return this.options.membership.locked(async () => {
      const { db, log } = this.options;
      const actor = await this.manager(workspaceId, actorId);
      if (!actor.ok) return actor;
      let row: InvitationRow | undefined;
      try {
        row = await readInvitation(db, workspaceId, invitationId);
      } catch (error) {
        log("invitation: reading D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (!row || row.status !== "pending" || !isRole(row.role)) {
        return { ok: false, code: "not_found" };
      }
      if (!checkInvite(actor, row.role).ok) return { ok: false, code: "forbidden" };
      try {
        const result = await db
          .prepare(`update invitation set status = 'canceled' where id = ? and status = 'pending'`)
          .bind(invitationId)
          .run();
        if (result.meta.changes !== 1) return { ok: false, code: "conflict" };
      } catch (error) {
        log("invitation: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      return this.apply(
        { kind: "user", id: actorId, role: actor.role },
        "invitation.revoke",
        { id: invitationId, role: row.role, revokedBy: actorId },
        Date.now(),
      );
    });
  }

  /**
   * The invitee accepts: signed in with the invited address, and that address verified. D1 marks the invitation
   * accepted and adds the member in one batch (the insert runs only when the update changed the row), then
   * `member.add` writes the shard's copy and `member.added`. Answers the role they joined with.
   */
  accept(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
  ): Promise<InvitationResult<{ role: Role }>> {
    return this.options.membership.locked(async () => {
      const { db, log } = this.options;
      const now = Date.now();
      const checked = await this.answerable(workspaceId, invitationId, invitee, now);
      if (!checked.ok) return checked;
      const { row, role, name, email } = checked;
      let counts: { members: number; memberships: number; already: number };
      try {
        counts = (await db
          .prepare(
            `select
               (select count(*) from member where "organizationId" = ?1) as members,
               (select count(*) from member where "userId" = ?2) as memberships,
               (select count(*) from member where "organizationId" = ?1 and "userId" = ?2) as already`,
          )
          .bind(workspaceId, invitee.id)
          .first<{ members: number; memberships: number; already: number }>())!;
      } catch (error) {
        log("invitation: reading D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (counts.already > 0) return { ok: false, code: "already_member" };
      if (counts.members >= MAX_WORKSPACE_MEMBERS) return { ok: false, code: "workspace_full" };
      if (counts.memberships >= WORKSPACE_LIMIT) return { ok: false, code: "workspace_limit" };
      let added: boolean;
      try {
        const [, inserted] = await db.batch([
          // The limits again, in SQL: another workspace's shard may have added the invitee meanwhile (it holds
          // its own member lock, not this one), and a member change outside the shards may have filled this one.
          db
            .prepare(
              `update invitation set status = 'accepted'
               where id = ?1 and status = 'pending' and "expiresAt" > ?2 and lower(email) = ?3
                 and (select count(*) from member where "userId" = ?4) < ?5
                 and (select count(*) from member where "organizationId" = ?6) < ?7`,
            )
            .bind(
              row.id,
              iso(now),
              email,
              invitee.id,
              WORKSPACE_LIMIT,
              workspaceId,
              MAX_WORKSPACE_MEMBERS,
            ),
          // `changes()` is the update's: the member goes in only with the invitation it accepts.
          db
            .prepare(
              `insert into member (id, "organizationId", "userId", role, "createdAt")
               select ?1, ?2, ?3, ?4, ?5 where changes() = 1
                 and not exists (select 1 from member where "organizationId" = ?2 and "userId" = ?3)`,
            )
            .bind(
              authId("member", now, this.options.randomBytes),
              workspaceId,
              invitee.id,
              role,
              iso(now),
            ),
        ]);
        added = inserted!.meta.changes === 1;
      } catch (error) {
        log("invitation: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      if (!added) return { ok: false, code: "conflict" };
      const applied = this.apply(
        MEMBERS_ACTOR,
        "member.add",
        { id: invitee.id, name, role, invitationId: row.id },
        now,
      );
      return applied.ok ? { ok: true, role } : applied;
    });
  }

  /** The invitee turns the invitation down (signed in with the invited address, verified, as for accepting). */
  decline(workspaceId: string, invitationId: string, invitee: Invitee): Promise<InvitationResult> {
    return this.options.membership.locked(async () => {
      const { db, log } = this.options;
      const now = Date.now();
      const checked = await this.answerable(workspaceId, invitationId, invitee, now);
      if (!checked.ok) return checked;
      try {
        const result = await db
          .prepare(`update invitation set status = 'rejected' where id = ? and status = 'pending'`)
          .bind(invitationId)
          .run();
        if (result.meta.changes !== 1) return { ok: false, code: "conflict" };
      } catch (error) {
        log("invitation: writing D1 failed", { error });
        return { ok: false, code: "unavailable" };
      }
      return this.apply(
        MEMBERS_ACTOR,
        "invitation.decline",
        { id: invitationId, userId: invitee.id },
        now,
      );
    });
  }

  /**
   * Whether `invitee` may answer the invitation, read from D1: pending, for their address, not run out, and that
   * address verified (read again here, not taken from the session).
   */
  private async answerable(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
    now: number,
  ): Promise<
    InvitationResult<{ row: InvitationRow; role: Role; name: string | null; email: string }>
  > {
    const { db, log } = this.options;
    let row: InvitationRow | undefined;
    let user: { email: string; emailVerified: number; name: string } | null;
    try {
      row = await readInvitation(db, workspaceId, invitationId);
      user = await db
        .prepare(`select email, "emailVerified", name from "user" where id = ?`)
        .bind(invitee.id)
        .first();
    } catch (error) {
      log("invitation: reading D1 failed", { error });
      return { ok: false, code: "unavailable" };
    }
    if (!row || !user || row.status !== "pending" || !isRole(row.role)) {
      return { ok: false, code: "not_found" };
    }
    const email = user.email.toLowerCase();
    if (row.email.toLowerCase() !== email) return { ok: false, code: "wrong_email" };
    if (Date.parse(row.expiresAt) <= now) return { ok: false, code: "expired" };
    if (user.emailVerified !== 1) return { ok: false, code: "unverified" };
    return { ok: true, row, role: row.role, name: fitMemberName(user.name), email };
  }

  /** The caller as a member of the workspace (any Brigade role), with their name for the list. */
  private async manager(
    workspaceId: string,
    actorId: string,
  ): Promise<InvitationResult<{ id: string; role: Role; name: string | null }>> {
    let role: string | undefined;
    let name: string | null = null;
    try {
      role = await readRole(this.options.db, workspaceId, actorId);
      const user = await this.options.db
        .prepare(`select name from "user" where id = ?`)
        .bind(actorId)
        .first<{ name: string }>();
      name = user?.name ?? null;
    } catch (error) {
      this.options.log("invitation: reading D1 failed", { error });
      return { ok: false, code: "unavailable" };
    }
    if (role === undefined || !isRole(role)) return { ok: false, code: "forbidden" };
    return { ok: true, id: actorId, role, name };
  }

  /**
   * Runs one invitation mutation for a change D1 already has. A failure is `not_applied`, logged as an error, and
   * the mutation is recorded for the repair alarm, which runs it as `MEMBERS_ACTOR`.
   */
  private apply(
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
    now: number,
  ): InvitationResult {
    if (this.run(actor, name, args, now)) return { ok: true };
    try {
      this.options.sql.exec(
        `insert into invitation_repair (key, name, args, at) values (?, ?, ?, ?)
         on conflict (key) do update set args = excluded.args`,
        `${name}:${String(args.id)}:${typeof args.send === "number" ? args.send : ""}`,
        name,
        JSON.stringify(args),
        now,
      );
      this.options.membership.armRepair(now);
    } catch (error) {
      this.options.log("arming the invitation repair failed", { error });
    }
    return { ok: false, code: "not_applied" };
  }

  private run(actor: Actor, name: string, args: unknown, now: number): boolean {
    const { shard, log } = this.options;
    try {
      const { result, changes } = shard.mutate({
        clientId: "api",
        mutationId: newId("mut", now, this.options.randomBytes),
        actor,
        name,
        args,
        now,
        internal: true,
      });
      if (!result.ok) {
        log("invitation change not applied to the shard", { name, code: result.error.code });
        return false;
      }
      this.options.committed(result.version, changes);
      return true;
    } catch (error) {
      log("invitation change not applied to the shard", { name, error });
      return false;
    }
  }

  /**
   * The repair alarm's share, run under the member lock: runs every mutation a failed shard step left owed, as
   * `MEMBERS_ACTOR`, oldest first. An owed `member.add` runs only while D1 still has that member: one removed (or
   * gone) since must not be added back, nor announced after their removal. True when none is left. Never throws.
   */
  async repair(workspaceId: string | undefined): Promise<boolean> {
    let owed: { key: string; name: string; args: string }[];
    try {
      owed = this.options.sql
        .exec<{
          key: string;
          name: string;
          args: string;
        }>("select key, name, args from invitation_repair order by at, key")
        .toArray();
    } catch (error) {
      this.options.log("reading the invitation repair failed", { error });
      return false;
    }
    let done = true;
    for (const { key, name, args } of owed) {
      const parsed: unknown = JSON.parse(args);
      if (name === "member.add") {
        // Without the workspace's id D1 cannot be asked, and "not in D1" would drop an add that is still owed:
        // leave it for a later alarm.
        if (workspaceId === undefined) {
          this.options.log("invitation repair: the shard has no workspace id yet", { name });
          done = false;
          continue;
        }
        let role: string | undefined;
        try {
          const userId = String(Reflect.get(Object(parsed), "id"));
          role = await readRole(this.options.db, workspaceId, userId);
        } catch (error) {
          this.options.log("invitation repair: reading D1 failed", { error });
          done = false;
          continue;
        }
        // Gone from D1: the removal (or the reconcile) already settled the shard. Nothing is owed any more.
        if (role === undefined) {
          done = this.settleRepair(key) && done;
          continue;
        }
      }
      if (!this.run(MEMBERS_ACTOR, name, parsed, Date.now())) {
        done = false;
        continue;
      }
      done = this.settleRepair(key) && done;
    }
    return done;
  }

  /** Forgets an owed mutation once it ran (or is no longer owed); false when that failed. */
  private settleRepair(key: string): boolean {
    try {
      this.options.sql.exec("delete from invitation_repair where key = ?", key);
      return true;
    } catch (error) {
      this.options.log("settling the invitation repair failed", { error });
      return false;
    }
  }

  /**
   * The email `member.invited` asks for, claimed for the caller for `INVITATION_CLAIM_MS`: `held` while another
   * delivery has it, `nothing` once it is done (or unknown: pruned, or never recorded).
   */
  planEmail(invitationId: string, send: number, now: number): InvitationEmailPlan {
    const key = `${invitationId}:${send}`;
    const { sql } = this.options;
    const row = sql
      .exec<{
        done: number;
        claimed_until: number;
        origin: string | null;
      }>("select done, claimed_until, origin from invitation_sends where key = ?", key)
      .toArray()[0];
    if (!row || row.done) return { send: false, reason: "nothing" };
    if (row.claimed_until > now) return { send: false, reason: "held", until: row.claimed_until };
    sql.exec(
      "update invitation_sends set claimed_until = ? where key = ?",
      now + INVITATION_CLAIM_MS,
      key,
    );
    return { send: true, key, origin: row.origin };
  }

  /** What the email's send did: `done` (sent, or given up) ends it; otherwise the claim goes, for the retry. */
  recordEmail(key: string, done: boolean): void {
    this.options.sql.exec(
      done
        ? "update invitation_sends set done = 1, claimed_until = 0 where key = ?"
        : "update invitation_sends set claimed_until = 0 where key = ?",
      key,
    );
  }

  private recordSend(invitationId: string, send: number, now: number, origin: string | null): void {
    try {
      this.options.sql.exec(
        `insert into invitation_sends (key, invitation_id, at, origin) values (?, ?, ?, ?)
         on conflict (key) do nothing`,
        `${invitationId}:${send}`,
        invitationId,
        now,
        origin,
      );
    } catch (error) {
      // Without its row the email is not sent (`planEmail` finds nothing); the dashboard's Resend is the way back.
      this.options.log("recording an invitation send failed", { error });
    }
  }

  /**
   * Counts one more email of `invitationId` in D1's `invitation_send`, only while the caps that span workspaces all
   * have room: `INVITATIONS_PER_ADDRESS_DAILY_CAP` for `email` (its `invitationAddressKey`, which is what the row's
   * `email` holds, so `+tags` share one count), `INVITATIONS_PER_INVITER_DAILY_CAP` for `inviterId`
   * and `INVITATION_MAX_SENDS` for the invitation (and, with `pending`, only while it is still pending). One
   * statement, so D1 decides it atomically whichever shards are inviting at once.
   */
  private reserveSend(
    invitationId: string,
    email: string,
    inviterId: string,
    now: number,
    pending: boolean,
  ): D1PreparedStatement {
    return this.options.db
      .prepare(
        `insert into invitation_send (id, "invitationId", email, "inviterId", at)
         select ?1, ?2, ?3, ?4, ?5
         where (select count(*) from invitation_send where email = ?3 and at > ?6) < ?7
           and (select count(*) from invitation_send where "inviterId" = ?4 and at > ?6) < ?8
           and (select count(*) from invitation_send where "invitationId" = ?2) < ?9
           and (?10 = 0 or exists (select 1 from invitation where id = ?2 and status = 'pending'))`,
      )
      .bind(
        newId("snd", now, this.options.randomBytes),
        invitationId,
        invitationAddressKey(email),
        inviterId,
        now,
        now - DAY_MS,
        INVITATIONS_PER_ADDRESS_DAILY_CAP,
        INVITATIONS_PER_INVITER_DAILY_CAP,
        INVITATION_MAX_SENDS,
        pending ? 1 : 0,
      );
  }

  /** Which cap refused a `reserveSend` (read again after it); `conflict` when none did (no longer pending). */
  private async capped(
    invitationId: string,
    email: string,
    inviterId: string,
    now: number,
  ): Promise<InvitationResult<never>> {
    const counts = await this.options.db
      .prepare(
        `select
           (select count(*) from invitation_send where email = ?1 and at > ?4) as address,
           (select count(*) from invitation_send where "inviterId" = ?2 and at > ?4) as inviter,
           (select count(*) from invitation_send where "invitationId" = ?3) as sends`,
      )
      .bind(invitationAddressKey(email), inviterId, invitationId, now - DAY_MS)
      .first<{ address: number; inviter: number; sends: number }>();
    if (counts && counts.sends >= INVITATION_MAX_SENDS) return { ok: false, code: "send_limit" };
    if (counts && counts.address >= INVITATIONS_PER_ADDRESS_DAILY_CAP) {
      return { ok: false, code: "address_limited" };
    }
    if (counts && counts.inviter >= INVITATIONS_PER_INVITER_DAILY_CAP) {
      return { ok: false, code: "inviter_limited" };
    }
    return { ok: false, code: "conflict" };
  }

  /**
   * Forgets D1's sends past every daily window, except those of a pending invitation (`INVITATION_MAX_SENDS` counts
   * them for as long as it is pending). Best effort, after an invite.
   */
  private async pruneSends(now: number): Promise<void> {
    try {
      await this.options.db
        .prepare(
          `delete from invitation_send where at < ? and "invitationId" not in
             (select id from invitation where status = 'pending')`,
        )
        .bind(now - 2 * DAY_MS)
        .run();
    } catch (error) {
      this.options.log("pruning the invitation sends failed", { error });
    }
  }

  /** Invitation emails asked for in the last day, for `INVITATIONS_DAILY_CAP`. */
  private sentToday(now: number): number {
    return this.options.sql
      .exec<{ sends: number }>(
        "select count(*) as sends from invitation_sends where at > ?",
        now - DAY_MS,
      )
      .one().sends;
  }

  /** How many emails one invitation asked for, and when the last one was. */
  private sends(invitationId: string): { count: number; last: number | null } {
    return this.options.sql
      .exec<{
        count: number;
        last: number | null;
      }>(
        "select count(*) as count, max(at) as last from invitation_sends where invitation_id = ?",
        invitationId,
      )
      .one();
  }

  private prune(now: number): void {
    try {
      // Long past any retry and the daily cap.
      this.options.sql.exec("delete from invitation_sends where at < ?", now - LEDGER_RETENTION_MS);
    } catch (error) {
      this.options.log("pruning the invitation ledger failed", { error });
    }
  }
}
