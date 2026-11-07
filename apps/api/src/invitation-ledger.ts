// The shard's side of invitations (RFC 0003 "Invitations", src/invitations.ts): the invitation emails' ledger
// (`invitation_sends`), the server-only mutation for a change D1 already has, and what a failed one owes
// (`invitation_repair`). Its own module, without Better Auth, so an Ember mutation (ember/invitations.ts) and the
// Node tests can use it.

import { MEMBERS_ACTOR, newId, type Actor, type RandomBytes } from "@freecorps/brigade-schema";
import type { InvitationResult } from "./invitations.ts";
import { readRole } from "./members.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Logger, Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The shard's invitation tables: the email ledger and what a failed mutation owes (ember/ledgers.ts too). */
export const INVITATIONS_SCHEMA = `
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

export type InvitationEmailPlan =
  | { send: true; key: string; origin: string | null }
  | { send: false; reason: "held"; until: number }
  | { send: false; reason: "nothing" };

/** How long a plan holds an invitation email for the delivery that asked (like `EMAIL_CLAIM_MS`). */
export const INVITATION_CLAIM_MS = 60_000;

type Maybe<T> = T | Promise<T>;

/**
 * The shard's side of an invitation change, which `Invitations` runs after D1's: the email ledger
 * (`invitation_sends`) and the server-only mutation, with its repair when it fails. `InvitationLedger` is it over a
 * shard's own storage, in `WorkspaceDO` and in an Ember mutation alike; on Ember the Worker reaches it by RPC
 * (src/ember-invitations.ts).
 */
export interface InvitationShardSide {
  prune(now: number): Maybe<void>;
  /** Invitation emails asked for in the last day, for `INVITATIONS_DAILY_CAP`. */
  sentToday(now: number): Maybe<number>;
  /** How many emails one invitation asked for, and when the last one was. */
  sends(invitationId: string): Maybe<{ count: number; last: number | null }>;
  recordSend(invitationId: string, send: number, now: number, origin: string | null): Maybe<void>;
  /** One invitation mutation for a change D1 already has: `not_applied` (and owed to the repair) when it fails. */
  apply(
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
    now: number,
  ): Maybe<InvitationResult>;
}

/**
 * The shard's side of invitations (`InvitationShardSide`) over its own storage: the email ledger, the server-only
 * mutation and what a failed one owes (`invitation_repair`). `WorkspaceDO` holds one; an Ember mutation builds one over
 * its `ctx.sql` and shard (ember/invitations.ts).
 */
export class InvitationLedger implements InvitationShardSide {
  constructor(
    private readonly options: {
      shard: Shard;
      sql: SqlStorage;
      randomBytes: RandomBytes;
      log: Logger;
      committed(version: number, changes: RowChange[]): void;
      /** Schedules the repair of an owed mutation (the DO's member repair alarm). */
      armRepair(now: number): void;
      /** D1, for the repair's member check (`repair`); the DO's only. */
      db?: D1Database;
    },
  ) {
    options.sql.exec(INVITATIONS_SCHEMA);
  }

  /**
   * Runs one invitation mutation for a change D1 already has. A failure is `not_applied`, logged as an error, and
   * the mutation is recorded for the repair alarm, which runs it as `MEMBERS_ACTOR`.
   */
  apply(actor: Actor, name: string, args: Record<string, unknown>, now: number): InvitationResult {
    if (this.run(actor, name, args, now)) return { ok: true };
    this.owe(name, args, now);
    return { ok: false, code: "not_applied" };
  }

  /** Records `name` as owed to the repair, and arms it. Never throws. */
  owe(name: string, args: Record<string, unknown>, now: number): void {
    try {
      this.options.sql.exec(
        `insert into invitation_repair (key, name, args, at) values (?, ?, ?, ?)
         on conflict (key) do update set args = excluded.args`,
        `${name}:${String(args.id)}:${typeof args.send === "number" ? args.send : ""}`,
        name,
        JSON.stringify(args),
        now,
      );
      this.options.armRepair(now);
    } catch (error) {
      this.options.log("arming the invitation repair failed", { error });
    }
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
   * gone) since must not be added back, nor announced after their removal; one whose arguments cannot be read is
   * dropped (logged). True when none is left. Never throws.
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(args);
      } catch (error) {
        // Nothing can ever run it: drop it rather than hold up the rest on every alarm.
        this.options.log("invitation repair: dropping an owed mutation it cannot read", {
          name,
          error,
        });
        done = this.settleRepair(key) && done;
        continue;
      }
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
          role = await readRole(this.options.db!, workspaceId, userId);
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

  /** What failed shard steps owe, oldest first (`repair` on Ember runs it from an action: ember/invitations.ts). */
  owed(): { key: string; name: string; args: string }[] {
    return this.options.sql
      .exec<{ key: string; name: string; args: string }>(
        "select key, name, args from invitation_repair order by at, key",
      )
      .toArray();
  }

  /**
   * One owed mutation settled: run as `MEMBERS_ACTOR` first unless `run` is false (no longer owed: dropped), then
   * forgotten. False when it could not run.
   */
  settle(key: string, name: string, args: unknown, run: boolean): boolean {
    if (run && !this.run(MEMBERS_ACTOR, name, args, Date.now())) return false;
    return this.settleRepair(key);
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

  recordSend(invitationId: string, send: number, now: number, origin: string | null): void {
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

  /** Invitation emails asked for in the last day, for `INVITATIONS_DAILY_CAP`. */
  sentToday(now: number): number {
    return this.options.sql
      .exec<{ sends: number }>(
        "select count(*) as sends from invitation_sends where at > ?",
        now - DAY_MS,
      )
      .one().sends;
  }

  /** How many emails one invitation asked for, and when the last one was. */
  sends(invitationId: string): { count: number; last: number | null } {
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

  prune(now: number): void {
    try {
      // Long past any retry and the daily cap.
      this.options.sql.exec("delete from invitation_sends where at < ?", now - LEDGER_RETENTION_MS);
    } catch (error) {
      this.options.log("pruning the invitation ledger failed", { error });
    }
  }
}
