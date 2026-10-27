// The workspace shard's side of status page emails (RFC 0012 "Email subscriptions"): what each event tells the page's
// subscribers, and a ledger that makes each event's emails go out once, in batches, under the page's daily cap. The
// queue consumer reaches it through `planStatusEmail` / `recordStatusEmail` (src/notify-status.ts); the addresses are
// in D1 and never here. A batch that ran out of budget with subscribers left brings the event back through the outbox
// (`status_email.continue`), so a long list never rides the original message's Queue retries.

import {
  STATUS_PAGE_ID,
  type MaintenanceRow,
  type PublicStatus,
  type StatusLocale,
} from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "./outbox.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Shard } from "./shard.ts";

/** Emails one page sends in a UTC day, every event together; past it the rest of the day's are dropped (logged). */
export const STATUS_EMAIL_DAILY_CAP = 5000;
/** Subscribers one batch emails at most. */
export const STATUS_EMAIL_BATCH = 50;
/** How long a plan holds an event's emails, so two deliveries never send the same batch at once. */
export const STATUS_EMAIL_CLAIM_MS = 60_000;
/** Failed batches of one event before it is given up (logged). */
export const STATUS_EMAIL_MAX_FAILURES = 5;

/** The events that email a page's subscribers, and the ones that carry on or confirm. */
const NOTIFYING = new Set([
  "incident.update_published",
  "maintenance.scheduled",
  "maintenance.started",
  "maintenance.ended",
  "maintenance.cancelled",
]);

/** Whether `event` asks for a status page email. */
export function asksForStatusEmail(event: Pick<BrigadeEvent, "type">): boolean {
  return (
    NOTIFYING.has(event.type) ||
    event.type === "status_email.continue" ||
    event.type === "status_subscriber.requested"
  );
}

/** What one notification says; everything in it was written for the public. */
export type StatusEmailContent =
  | {
      kind: "incident_created" | "incident_updated" | "incident_resolved";
      title: string;
      status: PublicStatus;
      body: string;
      components: string[];
    }
  | {
      kind:
        | "maintenance_scheduled"
        | "maintenance_started"
        | "maintenance_ended"
        | "maintenance_cancelled";
      title: string;
      body: string | null;
      startsAt: number;
      endsAt: number;
      components: string[];
    };

export type StatusEmailPage = { title: string; slug: string; locale: StatusLocale };

export type StatusEmailPlan =
  | { send: false; reason: "done" | "nothing" | "capped" }
  | { send: false; reason: "held"; until: number }
  | {
      send: true;
      /** The ledger's key: the event the emails are about, or `confirm:<subscriber>:<send>`. */
      key: string;
      page: StatusEmailPage;
      /** A notification: who to email next (ids after `cursor`, at most `limit`) and what. */
      notify?: { cursor: string; limit: number; content: StatusEmailContent };
      /** A confirmation: the subscriber to email. */
      confirm?: { subscriberId: string };
    };

/** What a batch did, as the consumer saw it. */
export type StatusEmailReport = {
  /** The last subscriber handled in order (sent, or refused for good). */
  cursor: string;
  /** Emails that went out. */
  sent: number;
  /** Subscribers are left after `cursor`. */
  more: boolean;
  /** A send failed in a way a retry may fix: the batch stopped there. */
  failed: boolean;
};

const SCHEMA = `
  create table if not exists status_emails (
    key text primary key,
    event text,
    cursor text not null default '',
    sent integer not null default 0,
    failures integer not null default 0,
    claimed_until integer not null default 0,
    done integer not null default 0,
    at integer not null
  ) without rowid;
  create index if not exists status_emails_at on status_emails (at);
  create table if not exists status_email_days (
    day text primary key,
    sent integer not null
  ) without rowid;
`;

type Row = {
  key: string;
  event: string | null;
  cursor: string;
  sent: number;
  failures: number;
  claimed_until: number;
  done: number;
};

type Deps = {
  shard: Shard;
  sql: SqlStorage;
  log: (message: string, fields: Record<string, unknown>) => void;
  /** Runs `statusEmail.continue` for `eventId` (a server mutation, so its event goes through the outbox). */
  carryOn: (eventId: string) => void;
};

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

export class StatusMailer {
  constructor(private readonly deps: Deps) {
    deps.sql.exec(SCHEMA);
  }

  /**
   * What to email for `event`, claimed for `STATUS_EMAIL_CLAIM_MS`. Nothing when the page is not public, when what the
   * event was about is gone (an update removed, an incident taken off the page), once the event is done, or once the
   * page reached its daily cap (logged, and the event is done).
   */
  plan(event: BrigadeEvent, now: number): StatusEmailPlan {
    const { shard, sql } = this.deps;
    this.prune(now);
    const page = shard.store.get("status_page", STATUS_PAGE_ID);
    let key: string;
    let original: BrigadeEvent | null = null;
    let subscriberId: string | null = null;
    if (event.type === "status_subscriber.requested") {
      const data = event.data as { subscriberId?: unknown; send?: unknown } | null;
      if (typeof data?.subscriberId !== "string" || typeof data.send !== "number") {
        return { send: false, reason: "nothing" };
      }
      subscriberId = data.subscriberId;
      key = `confirm:${data.subscriberId}:${data.send}`;
    } else if (event.type === "status_email.continue") {
      const eventId = (event.data as { eventId?: unknown } | null)?.eventId;
      if (typeof eventId !== "string") return { send: false, reason: "nothing" };
      key = eventId;
      const row = this.row(key);
      if (!row?.event) return { send: false, reason: "nothing" };
      original = JSON.parse(row.event) as BrigadeEvent;
    } else if (NOTIFYING.has(event.type)) {
      key = event.id;
      original = event;
    } else {
      return { send: false, reason: "nothing" };
    }
    const row = this.row(key);
    if (row?.done) return { send: false, reason: "done" };
    if (row && row.claimed_until > now) {
      return { send: false, reason: "held", until: row.claimed_until };
    }
    if (!row) {
      sql.exec(
        "insert into status_emails (key, event, at) values (?, ?, ?)",
        key,
        original ? JSON.stringify(original) : null,
        now,
      );
    }
    if (!page?.enabled) {
      this.finish(key);
      return { send: false, reason: "nothing" };
    }
    const facts: StatusEmailPage = { title: page.title, slug: page.slug, locale: page.locale };
    if (subscriberId !== null) {
      this.claim(key, now);
      return { send: true, key, page: facts, confirm: { subscriberId } };
    }
    const content = original ? this.content(original) : null;
    if (!content) {
      this.finish(key);
      return { send: false, reason: "nothing" };
    }
    const left = STATUS_EMAIL_DAILY_CAP - this.sentOn(dayOf(now));
    if (left <= 0) {
      this.deps.log("status page emails capped for today", { event: key });
      this.finish(key);
      return { send: false, reason: "capped" };
    }
    this.claim(key, now);
    return {
      send: true,
      key,
      page: facts,
      notify: { cursor: row?.cursor ?? "", limit: Math.min(STATUS_EMAIL_BATCH, left), content },
    };
  }

  /**
   * What a batch did: the cursor moves on, the day's count grows, and the hold is released. Subscribers left and no
   * failure: `status_email.continue` brings the event back. A failure counts towards `STATUS_EMAIL_MAX_FAILURES`; past
   * it the event is given up. Returns whether the consumer should retry the message (a failure with tries left).
   */
  record(key: string, report: StatusEmailReport, now: number): { retry: boolean } {
    const row = this.row(key);
    if (!row || row.done) return { retry: false };
    const failures = row.failures + (report.failed ? 1 : 0);
    const givenUp = failures >= STATUS_EMAIL_MAX_FAILURES;
    const done = givenUp || (!report.more && !report.failed);
    this.deps.sql.exec(
      `update status_emails set cursor = ?, sent = sent + ?, failures = ?, claimed_until = 0, done = ?
       where key = ?`,
      report.cursor,
      report.sent,
      failures,
      done ? 1 : 0,
      key,
    );
    if (report.sent > 0) {
      this.deps.sql.exec(
        `insert into status_email_days (day, sent) values (?, ?)
         on conflict (day) do update set sent = sent + excluded.sent`,
        dayOf(now),
        report.sent,
      );
    }
    if (givenUp) this.deps.log("status page emails given up", { event: key, failures });
    if (!done && report.more && !report.failed && !key.startsWith("confirm:")) {
      this.deps.carryOn(key);
    }
    return { retry: report.failed && !givenUp };
  }

  /** What `event` tells subscribers, read now (so a corrected update goes out corrected); null when nothing. */
  private content(event: BrigadeEvent): StatusEmailContent | null {
    const { store } = this.deps.shard;
    const names = (ids: readonly string[]) =>
      ids.flatMap((id) => store.get("status_components", id)?.name ?? []);
    if (event.type === "incident.update_published") {
      const entryId = (event.data as { entryId?: unknown } | null)?.entryId;
      const row = event.subject ? store.get("status_incidents", event.subject) : undefined;
      const index = row ? row.updates.findIndex((update) => update.id === entryId) : -1;
      if (!row || index < 0) return null;
      const update = row.updates[index]!;
      return {
        kind:
          index === 0
            ? "incident_created"
            : update.status === "resolved"
              ? "incident_resolved"
              : "incident_updated",
        title: row.title,
        status: update.status,
        body: update.body,
        components: names(row.componentIds),
      };
    }
    const data = event.data as Partial<MaintenanceRow> | null;
    if (
      typeof data?.title !== "string" ||
      typeof data.startsAt !== "number" ||
      typeof data.endsAt !== "number"
    ) {
      return null;
    }
    const row = event.subject ? store.get("status_maintenance", event.subject) : undefined;
    const kind = `maintenance_${event.type.slice("maintenance.".length)}` as
      | "maintenance_scheduled"
      | "maintenance_started"
      | "maintenance_ended"
      | "maintenance_cancelled";
    // A window called off since it was scheduled: its scheduled email is no longer true.
    if (kind === "maintenance_scheduled" && !row) return null;
    return {
      kind,
      title: row?.title ?? data.title,
      body: row?.body ?? null,
      startsAt: row?.startsAt ?? data.startsAt,
      endsAt: row?.endsAt ?? data.endsAt,
      components: names(row?.componentIds ?? data.componentIds ?? []),
    };
  }

  private row(key: string): Row | undefined {
    return this.deps.sql
      .exec<Row>(
        "select key, event, cursor, sent, failures, claimed_until, done from status_emails where key = ?",
        key,
      )
      .toArray()[0];
  }

  private claim(key: string, now: number): void {
    this.deps.sql.exec(
      "update status_emails set claimed_until = ? where key = ?",
      now + STATUS_EMAIL_CLAIM_MS,
      key,
    );
  }

  private finish(key: string): void {
    this.deps.sql.exec("update status_emails set done = 1, claimed_until = 0 where key = ?", key);
  }

  private sentOn(day: string): number {
    return (
      this.deps.sql
        .exec<{ sent: number }>("select sent from status_email_days where day = ?", day)
        .toArray()[0]?.sent ?? 0
    );
  }

  private prune(now: number): void {
    this.deps.sql.exec("delete from status_emails where at < ?", now - LEDGER_RETENTION_MS);
    this.deps.sql.exec("delete from status_email_days where day < ?", dayOf(now - 2 * 86_400_000));
  }
}
