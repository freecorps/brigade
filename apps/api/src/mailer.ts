// The shard's side of the email notifier (RFC 0005 "Email"): which `notification.failed` events lead to an email, to
// whom, and what each email did. The queue consumer (src/notify-email.ts) asks for a plan, looks the recipients up
// in D1, sends, and reports back; the shard keeps the ledger that makes a redelivered event (or another event that
// asks for the same email) email nobody twice, and records an email that could not be sent on the incident's
// timeline through `notification.failEmail`. Nothing here is on the paging path: it reads the page ledger
// (src/paging.ts) and never writes it.

import {
  emailSettings,
  isActive,
  followUpsDue,
  memberEmailOf,
  REMINDER_MAX_LISTED,
  type FollowUpReminderDue,
  NOTIFIER_ACTOR,
  type EmailAbout,
  type EmailFailure,
  type NotificationFailed,
  type Store,
  type BrigadeTables,
} from "@freecorps/brigade-schema";
import { UNPAGED_REASONS, type EmailIncident, type UnpagedReason } from "./email-templates.ts";
import type { BrigadeEvent } from "./outbox.ts";
import { LEDGER_RETENTION_MS, PAGING_SEVERITIES } from "./paging.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/**
 * How long a plan holds an email for the delivery that asked. Another delivery asking for the same email meanwhile
 * (two members' failures of one page in one batch, or a redelivery of this event after its Worker died or its
 * report to the shard failed) is told it is `held` until then and retried after it, never acked: by then the email
 * is done (and it finds nothing to send) or the hold has passed (and it takes the email). Longer than a send can take
 * (each is cut at `EMAIL_TIMEOUT_MS`, all of a plan's in parallel, plus the D1 read).
 */
export const EMAIL_CLAIM_MS = 60_000;
/**
 * The most emails one user gets from a workspace in an hour, and a workspace sends in a day (RFC 0005 "Email",
 * "Abuse"): until email verification exists, an address is whatever someone signed up with, and the incident's
 * title is whatever its declarer typed. Over either, the email is dropped, logged and noted on the timeline.
 */
export const EMAIL_USER_HOURLY_CAP = 5;
export const EMAIL_WORKSPACE_DAILY_CAP = 200;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SCHEMA = `
  create table if not exists email_sends (
    key text not null,
    user_id text not null,
    at integer not null,
    capped integer not null default 0,
    primary key (key, user_id)
  ) without rowid;
  create table if not exists email_keys (
    key text primary key,
    done integer not null,
    claimed_until integer not null,
    at integer not null
  ) without rowid;
  create index if not exists email_sends_at on email_sends (at);
  create index if not exists email_keys_at on email_keys (at);
`;

/**
 * One email the consumer should send: to members by id (the one a page missed), or to the workspace's owners, read
 * from D1 (the shard's member list holds only those who opened Brigade). `key` names the email in the ledger:
 * `unpaged:<incident>:<member>` (once per incident) or `nobody:<page event>` (once per page that reached nobody).
 */
export type EmailJob = {
  key: string;
  about: EmailAbout;
  to: { userIds: string[] } | { owners: true };
  /** Who this email already reached (a redelivery, or a retry after some sends failed). */
  sent: string[];
  /** Why the member's page failed (`unpaged` only). */
  reason?: UnpagedReason;
};

/**
 * What the caps leave (`EMAIL_USER_HOURLY_CAP`, `EMAIL_WORKSPACE_DAILY_CAP`), from the ledger when the plan was made:
 * the emails the workspace may still send today, and how many each user got in the last hour (those with any).
 */
export type EmailBudget = { workspace: number; users: Record<string, number> };

export type EmailPlan =
  | {
      send: true;
      incident: EmailIncident;
      workspace: string;
      jobs: EmailJob[];
      budget: EmailBudget;
      /** Another email this event asks for is held by another delivery until then: retry after it. */
      heldUntil?: number;
    }
  /**
   * Each email it asks for is held by another delivery (another event's, or an earlier one of this event that may
   * have died) until `until`: retry after it, so the email is neither sent twice nor lost.
   */
  | { send: false; reason: "held"; until: number }
  /**
   * Nothing to send: not a page's failure, the incident moved on (or is gone), or each email it asks for is off, not
   * called for, or done.
   */
  | { send: false; reason: "not_an_email" | "not_found" | "moved_on" | "nothing" };

/** One follow-up a reminder lists: what members typed, and its due date (`YYYY-MM-DD`). */
export type ReminderItem = {
  title: string;
  incidentNumber: number | null;
  incidentTitle: string;
  dueDate: string;
  /** Due before the reminder's day. */
  overdue: boolean;
};

export type ReminderPlan =
  | {
      send: true;
      workspace: string;
      userId: string;
      /** The member's calendar day it is for. */
      date: string;
      /** At most `REMINDER_MAX_LISTED`, soonest due first. */
      items: ReminderItem[];
      /** How many are due in all. */
      total: number;
      budget: EmailBudget;
    }
  | { send: false; reason: "held"; until: number }
  | { send: false; reason: "not_a_reminder" | "not_found" | "nothing" };

/** Whether `event` asks for a reminder of follow-ups due (`follow_up.reminder_due`, from `followUp.remind`). */
export function asksForReminder(event: BrigadeEvent): boolean {
  if (event.type !== "follow_up.reminder_due") return false;
  const data = event.data as Partial<FollowUpReminderDue["data"]> | null;
  return typeof data?.userId === "string" && typeof data.date === "string";
}

/** A reminder's key in the email ledger: one per member and day. */
const reminderKey = (userId: string, date: string) => `reminder:${userId}:${date}`;

/**
 * What one recipient's send did, as the consumer reports it. `capped`: not sent, because the recipient or the
 * workspace was over its cap; final at once, and never retried.
 */
export type EmailOutcome = { userId: string; ok: boolean; capped?: boolean };

export type MailerOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
};

type PushFailed = Extract<NotificationFailed["data"], { channel: "push" }>;

/**
 * Whether `event` is a failed page the email notifier acts on: `notification.failed` from the push notifier. Its own
 * failures (`channel: "email"`) never lead to another email.
 */
export function asksForEmail(event: BrigadeEvent): boolean {
  if (event.type !== "notification.failed" || event.subject === undefined) return false;
  const data = event.data as Partial<NotificationFailed["data"]> | null;
  return data?.channel === "push" && typeof data.incidentId === "string";
}

export class Mailer {
  constructor(private readonly options: MailerOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  /**
   * The emails a failed page asks for (RFC 0005 "Email"), claimed for the caller until `EMAIL_CLAIM_MS` from `now`:
   * - **unpaged**: the member it missed, when the incident is SEV1 or SEV2, once per incident;
   * - **nobody_paged**: the owners, when the page settled having reached nobody and nothing else will page on its
   *   own: no escalation run (the interim rule was the page), or the page was the last of a run that ended
   *   (everyone who can respond, after nobody acknowledged). A level that missed everyone is not it: the next level
   *   fires (at once when it was unreachable, at its timeout when its pushes failed).
   * Neither once the incident is acknowledged or no longer active, nor when the workspace turned it off; the member's
   * email neither when they turned it off themselves (`member.setEmail`). The owners' email has no such opt-out.
   */
  plan(event: BrigadeEvent, now: number): EmailPlan {
    this.prune(now);
    if (!asksForEmail(event)) return { send: false, reason: "not_an_email" };
    const data = event.data as PushFailed;
    const { store } = this.options.shard;
    const incident = store.get("incidents", data.incidentId);
    const [workspace] = store.scan("workspace");
    if (!incident || !workspace) return { send: false, reason: "not_found" };
    if (!isActive(incident.status) || incident.acknowledgedAt != null) {
      return { send: false, reason: "moved_on" };
    }
    const settings = emailSettings(workspace);
    const wanted: Omit<EmailJob, "sent">[] = [];
    // The member's own opt-out applies to their email only: the owners' below is the fallback when paging fails.
    if (
      settings.unpaged &&
      data.userId !== null &&
      memberEmailOf(store.scan("member_settings"), data.userId).missedPages &&
      isUnpagedReason(data.reason) &&
      PAGING_SEVERITIES.includes(incident.severity)
    ) {
      wanted.push({
        key: `unpaged:${incident.id}:${data.userId}`,
        about: "unpaged",
        to: { userIds: [data.userId] },
        reason: data.reason,
      });
    }
    if (settings.nobodyPaged && this.nobodyPaged(data, store)) {
      wanted.push({ key: `nobody:${data.eventId}`, about: "nobody_paged", to: { owners: true } });
    }

    const jobs: EmailJob[] = [];
    let heldUntil: number | undefined;
    for (const job of wanted) {
      const claim = this.claim(job.key, now);
      if (claim === "done") continue;
      if (claim !== "claimed") {
        heldUntil = Math.max(heldUntil ?? 0, claim.until);
        continue;
      }
      jobs.push({ ...job, sent: this.sent(job.key) });
    }
    if (jobs.length === 0) {
      return heldUntil === undefined
        ? { send: false, reason: "nothing" }
        : { send: false, reason: "held", until: heldUntil };
    }
    return {
      send: true,
      incident: {
        id: incident.id,
        number: incident.number,
        title: incident.title,
        severity: incident.severity,
      },
      workspace: workspace.name,
      jobs,
      budget: this.budget(now),
      ...(heldUntil === undefined ? {} : { heldUntil }),
    };
  }

  /**
   * Records what one email's sends did. Sent recipients go in the ledger (a retry skips them, and they count toward
   * the caps). A capped recipient is final at once: in the ledger as capped (skipped, not counted) with an
   * `email_failed` entry (`capped`). When `final` (retries spent, or nothing left worth retrying), each recipient in
   * `outcomes` it never reached gets an `email_failed` entry on the incident's timeline and `notification.failed`
   * (`channel: "email"`), and the email is done; otherwise its claim is let go, so the retry can take it at once.
   */
  record(
    event: BrigadeEvent,
    key: string,
    about: EmailAbout,
    outcomes: readonly EmailOutcome[],
    final: boolean,
    now: number,
  ): void {
    if (!asksForEmail(event)) return;
    const { sql } = this.options.storage;
    const claim = sql
      .exec<{ done: number }>("select done from email_keys where key = ?", key)
      .toArray()[0];
    if (!claim || claim.done) return;
    const data = event.data as PushFailed;
    for (const outcome of outcomes) {
      if (!outcome.ok && !outcome.capped) continue;
      sql.exec(
        "insert into email_sends (key, user_id, at, capped) values (?, ?, ?, ?) on conflict do nothing",
        key,
        outcome.userId,
        now,
        outcome.ok ? 0 : 1,
      );
      if (outcome.ok) continue;
      this.options.log("email capped", {
        event: event.id,
        incident: data.incidentId,
        about,
        recipient: recipientHash(key, outcome.userId),
      });
      this.fail(event, key, about, outcome.userId, "capped", now);
    }
    if (!final) {
      sql.exec("update email_keys set claimed_until = 0 where key = ?", key);
      return;
    }
    const sent = new Set(this.sent(key));
    for (const { userId } of outcomes) {
      if (sent.has(userId)) continue;
      sent.add(userId);
      this.options.log("email failed", {
        event: event.id,
        incident: data.incidentId,
        about,
        recipient: recipientHash(key, userId),
      });
      this.fail(event, key, about, userId, "undelivered", now);
    }
    sql.exec("update email_keys set done = 1, claimed_until = 0 where key = ?", key);
  }

  /**
   * The reminder `event` asks for (RFC 0013 "Reminders"), claimed for the caller until `EMAIL_CLAIM_MS` from `now`
   * like the notifier's emails: the member's open follow-ups due on its day or before, read now, so one done since
   * the alarm asked is left out (and none left is nothing to send). Nothing either when the member turned reminders
   * off meanwhile.
   */
  planReminder(event: BrigadeEvent, now: number): ReminderPlan {
    this.prune(now);
    if (!asksForReminder(event)) return { send: false, reason: "not_a_reminder" };
    const { userId, date } = event.data as FollowUpReminderDue["data"];
    const { store } = this.options.shard;
    const [workspace] = store.scan("workspace");
    if (!workspace) return { send: false, reason: "not_found" };
    if (!memberEmailOf(store.scan("member_settings"), userId).followUpReminders) {
      return { send: false, reason: "nothing" };
    }
    const due = followUpsDue(store.scan("follow_ups"), userId, date);
    if (due.length === 0) return { send: false, reason: "nothing" };
    const key = reminderKey(userId, date);
    const claim = this.claim(key, now);
    if (claim === "done") return { send: false, reason: "nothing" };
    if (claim !== "claimed") return { send: false, reason: "held", until: claim.until };
    return {
      send: true,
      workspace: workspace.name,
      userId,
      date,
      items: due.slice(0, REMINDER_MAX_LISTED).map((row) => ({
        title: row.title,
        incidentNumber: row.incidentNumber,
        incidentTitle: row.incidentTitle,
        dueDate: row.dueDate!,
        overdue: row.dueDate! < date,
      })),
      total: due.length,
      budget: this.budget(now),
    };
  }

  /**
   * Records what a reminder's send did: sent (in the ledger, counted toward the caps) or capped (in the ledger, not
   * counted, logged) is done; a failure is done when `final` (logged: a reminder has no incident to put it on) and
   * otherwise lets its claim go, so the retry can take it at once.
   */
  recordReminder(event: BrigadeEvent, outcome: EmailOutcome, final: boolean, now: number): void {
    if (!asksForReminder(event)) return;
    const { userId, date } = event.data as FollowUpReminderDue["data"];
    const key = reminderKey(userId, date);
    const { sql } = this.options.storage;
    const claim = sql
      .exec<{ done: number }>("select done from email_keys where key = ?", key)
      .toArray()[0];
    if (!claim || claim.done) return;
    if (outcome.ok || outcome.capped) {
      sql.exec(
        "insert into email_sends (key, user_id, at, capped) values (?, ?, ?, ?) on conflict do nothing",
        key,
        userId,
        now,
        outcome.ok ? 0 : 1,
      );
    }
    if (!outcome.ok && (outcome.capped || final)) {
      this.options.log(outcome.capped ? "reminder capped" : "reminder failed", {
        event: event.id,
        recipient: recipientHash(key, userId),
      });
    }
    if (outcome.ok || outcome.capped || final) {
      sql.exec("update email_keys set done = 1, claimed_until = 0 where key = ?", key);
    } else {
      sql.exec("update email_keys set claimed_until = 0 where key = ?", key);
    }
  }

  /**
   * Takes `key` for the caller until `EMAIL_CLAIM_MS` from `now`: `claimed`, or `done` (sent or given up), or held by
   * another delivery until `until`.
   */
  private claim(key: string, now: number): "claimed" | "done" | { until: number } {
    const { sql } = this.options.storage;
    const claim = sql
      .exec<{ done: number; claimed_until: number }>(
        "select done, claimed_until from email_keys where key = ?",
        key,
      )
      .toArray()[0];
    if (claim?.done) return "done";
    if (claim && claim.claimed_until > now) return { until: claim.claimed_until };
    // `at` is when the email was first asked for and is not refreshed by a later claim: the ledger is pruned from
    // it, and `LEDGER_RETENTION_MS` outlasts every retry of an email by far.
    sql.exec(
      `insert into email_keys (key, done, claimed_until, at) values (?, 0, ?, ?)
       on conflict (key) do update set claimed_until = excluded.claimed_until`,
      key,
      now + EMAIL_CLAIM_MS,
      now,
    );
    return "claimed";
  }

  /** `email_failed` on the incident's timeline and `notification.failed` (`channel: "email"`), once per recipient. */
  private fail(
    event: BrigadeEvent,
    key: string,
    about: EmailAbout,
    userId: string,
    reason: EmailFailure,
    now: number,
  ): void {
    const data = event.data as PushFailed;
    this.run(
      `emailfail:${key}:${userId}`,
      "notification.failEmail",
      { incidentId: data.incidentId, eventId: event.id, userId, reason, about },
      now,
    );
  }

  /** What the caps leave now (see `EmailBudget`); capped recipients do not count. */
  private budget(now: number): EmailBudget {
    const { sql } = this.options.storage;
    const today = sql
      .exec<{ sends: number }>(
        "select count(*) as sends from email_sends where capped = 0 and at > ?",
        now - DAY_MS,
      )
      .one().sends;
    const users: Record<string, number> = {};
    for (const row of sql.exec<{ user_id: string; sends: number }>(
      "select user_id, count(*) as sends from email_sends where capped = 0 and at > ? group by user_id",
      now - HOUR_MS,
    )) {
      users[row.user_id] = row.sends;
    }
    return { workspace: Math.max(0, EMAIL_WORKSPACE_DAILY_CAP - today), users };
  }

  /**
   * Whether the page `data` failed for reached nobody and nothing will page on its own after it (see `plan`). Read
   * from the page ledger once the page is settled; a dead-lettered page (paged again on an event of its own), a
   * stalled level (everyone is paged after it) and one only its declarer could answer are not it.
   */
  private nobodyPaged(data: PushFailed, store: Store<BrigadeTables>): boolean {
    if (
      data.reason === "dead_lettered" ||
      data.reason === "escalation_stalled" ||
      data.reason === "nobody_else"
    ) {
      return false;
    }
    const { sql } = this.options.storage;
    const settled =
      sql.exec("select 1 from page_events where event_id = ?", data.eventId).toArray().length > 0;
    if (!settled) return false;
    const reached =
      sql.exec("select 1 from page_deliveries where event_id = ? limit 1", data.eventId).toArray()
        .length > 0;
    if (reached) return false;
    const run = store.get("incidents", data.incidentId)?.escalation;
    if (!run) return true;
    return (
      run.status === "exhausted" &&
      data.page !== undefined &&
      data.page.run === run.eventId &&
      data.page.step === run.paged
    );
  }

  private sent(key: string): string[] {
    return this.options.storage.sql
      .exec<{ user_id: string }>("select user_id from email_sends where key = ?", key)
      .toArray()
      .map((row) => row.user_id);
  }

  /** A server-only mutation as the notifier, de-duplicated by `mutationId`. */
  private run(mutationId: string, name: string, args: unknown, now: number): void {
    const { shard } = this.options;
    if (shard.storedResult(NOTIFIER_ACTOR.id, "email", mutationId, now)) return;
    const { result, changes } = shard.mutate({
      clientId: "email",
      mutationId,
      actor: NOTIFIER_ACTOR,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    else if (result.error.code !== "not_found") {
      this.options.log("email mutation refused", { mutation: name, code: result.error.code });
    }
  }

  private prune(now: number): void {
    const { sql } = this.options.storage;
    const before = now - LEDGER_RETENTION_MS;
    try {
      sql.exec("delete from email_sends where at < ?", before);
      sql.exec("delete from email_keys where at < ?", before);
    } catch (error) {
      this.options.log("pruning the email ledger failed", { error: String(error) });
    }
  }
}

function isUnpagedReason(reason: string): reason is UnpagedReason {
  return (UNPAGED_REASONS as readonly string[]).includes(reason);
}

/**
 * A short, stable tag for one email's recipient in logs (FNV-1a of the key and user id): enough to follow one through
 * retries, without the user id or the address.
 */
export function recipientHash(key: string, userId: string): string {
  let hash = 0x811c9dc5;
  for (const char of `${key}:${userId}`) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
