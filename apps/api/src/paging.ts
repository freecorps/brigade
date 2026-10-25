// The shard's side of paging (RFC 0005 "Notifiers", RFC 0006 "Who is paged"): which events page, who a page goes
// to, and what each page did. The queue consumer (src/notify.ts) asks the shard for a plan, sends, and reports
// back; the shard keeps the ledger that makes a redelivered event page nobody twice, and records failed pages on
// the incident's timeline through `notification.fail`.

import {
  isActive,
  NOTIFIER_ACTOR,
  type BrigadeTables,
  type DevicePlatform,
  type IncidentRow,
  type PageFailure,
  type PushEnvironment,
  type Severity,
  type Store,
} from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "./outbox.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** Severities that page (urgency `page`: time-sensitive, and later a call); lower ones notify (`high`). */
export const PAGING_SEVERITIES: readonly Severity[] = ["sev1", "sev2"];
/** How long the ledger remembers an event: past the Queue's longest retention (14 days), so a redelivery is known. */
export const LEDGER_RETENTION_MS = 15 * 24 * 60 * 60 * 1000;
/**
 * A page goes to at most this many devices. More is a misconfiguration (over 20 members with 10 phones each): it is
 * logged, and a member none of whose devices fit is recorded as not paged (`over_limit`).
 */
export const MAX_PAGE_DEVICES = 200;

const SCHEMA = `
  create table if not exists page_deliveries (
    event_id text not null,
    device_id text not null,
    user_id text not null,
    at integer not null,
    primary key (event_id, device_id)
  ) without rowid;
  create table if not exists page_events (event_id text primary key, at integer not null) without rowid;
  create index if not exists page_deliveries_at on page_deliveries (at);
  create index if not exists page_events_at on page_events (at);
`;

export type Urgency = "high" | "page";

/** What one device needs for a push. Tokens and keys leave the shard only for the notifier, never in an event. */
export type PageTarget = {
  deviceId: string;
  userId: string;
  platform: DevicePlatform;
  environment: PushEnvironment;
  pushToken: string;
  publicKey: string;
};

/** A member the page is for but is not sent to; recorded as not paged once the page settles. */
export type SkippedMember = { userId: string; reason: "no_devices" | "over_limit" };

export type PagePlan =
  | {
      send: true;
      incident: Pick<IncidentRow, "id" | "number" | "title" | "severity">;
      urgency: Urgency;
      targets: PageTarget[];
      /** Handed back with the outcomes (`Pager.record`). */
      skipped: SkippedMember[];
    }
  | {
      send: false;
      /** Why nothing is sent: not a paging event, already done, the incident moved on, or nobody to page. */
      reason: "not_a_page" | "done" | "not_found" | "acknowledged" | "inactive" | "nobody";
    };

/** Why one device's push failed, as the notifier reports it. */
export type SendFailure = Extract<PageFailure, "undelivered" | "unsupported" | "not_configured">;

/** One device's outcome, as the notifier reports it. */
export type DeviceOutcome =
  | { deviceId: string; userId: string; ok: true }
  | {
      deviceId: string;
      userId: string;
      ok: false;
      /**
       * The push service says this token, the one the push went to, is gone: the device is dropped
       * (`device.expire`) unless it was registered again with another token meanwhile.
       */
      expiredToken?: string;
      reason: SendFailure;
    };

/**
 * Whether an event asks for a page (RFC 0006 "Who is paged"), from the event alone: a declared incident (any
 * severity; SEV1 and SEV2 at `page` urgency), or a severity raised into SEV1 or SEV2. Monitors open incidents with
 * `incident.declared` as `sys_monitors` (SEV2), so they page through the same rule.
 */
export function asksForPage(event: BrigadeEvent): boolean {
  if (event.subject === undefined) return false;
  if (event.type === "incident.declared") return true;
  if (event.type !== "incident.severity_changed") return false;
  const { from, to } = (event.data ?? {}) as { from?: Severity; to?: Severity };
  return (
    to !== undefined &&
    from !== undefined &&
    PAGING_SEVERITIES.includes(to) &&
    rank(to) < rank(from)
  );
}

const rank = (severity: Severity) => ["sev1", "sev2", "sev3", "sev4"].indexOf(severity);

/**
 * Who a page goes to, until on-call schedules exist (Phase 2): the incident commander, if one is assigned, is still a
 * member who can respond, did not cause the event and has a device; otherwise every member who can respond (owner,
 * admin, responder; viewers only read), except who caused it. `targets` are their registered devices, in member then
 * device order; `noDevices` the members it is for who have none (a commander without a device included), so a page
 * that missed them says so.
 *
 * Members are the shard's member list (`member.sync`): a member removed or demoted in D1 is still paged until the
 * shard's list says otherwise (RFC 0006 "Who is paged").
 */
export function pageTargets(
  store: Store<BrigadeTables>,
  incident: Pick<IncidentRow, "roles">,
  actorId: string,
): { targets: PageTarget[]; noDevices: string[] } {
  const members = store.scan("members");
  const devices = store.scan("devices");
  const devicesOf = (userId: string): PageTarget[] =>
    devices
      .filter((device) => device.userId === userId)
      .map(({ id, platform, environment, pushToken, publicKey }) => ({
        deviceId: id,
        userId,
        platform,
        environment,
        pushToken,
        publicKey,
      }));
  const noDevices: string[] = [];
  const commander = incident.roles?.commander;
  if (
    commander !== undefined &&
    commander !== actorId &&
    members.some((member) => member.id === commander && member.role !== "viewer")
  ) {
    const targets = devicesOf(commander);
    if (targets.length > 0) return { targets, noDevices };
    // A commander who cannot be reached must not leave the incident unpaged: fall back to everyone who can respond.
    noDevices.push(commander);
  }
  const targets: PageTarget[] = [];
  for (const member of members) {
    if (member.role === "viewer" || member.id === actorId || member.id === commander) continue;
    const mine = devicesOf(member.id);
    if (mine.length === 0) noDevices.push(member.id);
    targets.push(...mine);
  }
  return { targets, noDevices };
}

export type PagerOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
};

/** What the dead-letter consumer's record did, so its log says what happened. */
export type DeadLetterResult =
  | "recorded"
  | "closed"
  | "settled"
  | "no_incident"
  | "not_a_page"
  | "other_workspace";

export class Pager {
  constructor(private readonly options: PagerOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  /**
   * What the notifier should send for `event`: the incident's content, the urgency and the devices that have not
   * had this page yet. A page for an incident that is acknowledged or no longer active is not sent. When nobody can
   * be paged and no person caused the event (a monitor opened it), that is recorded as a failed page at once.
   */
  plan(event: BrigadeEvent, now: number): PagePlan {
    const { sql } = this.options.storage;
    this.prune(now);
    if (!asksForPage(event)) return { send: false, reason: "not_a_page" };
    if (this.done(event.id)) return { send: false, reason: "done" };
    const incident = this.options.shard.store.get("incidents", event.subject!);
    if (!incident) return { send: false, reason: "not_found" };
    if (!isActive(incident.status)) return { send: false, reason: "inactive" };
    if (incident.acknowledgedAt != null) return { send: false, reason: "acknowledged" };

    const { targets: all, noDevices } = pageTargets(
      this.options.shard.store,
      incident,
      event.actor.id,
    );
    const skipped: SkippedMember[] = noDevices.map((userId) => ({ userId, reason: "no_devices" }));
    if (all.length === 0) {
      // Each member the page was for is told apart; with none at all, a member who declared it by hand knows, and a
      // monitor's incident says nobody was paged.
      if (skipped.length > 0) this.settle(event, incident.id, skipped, now);
      else if (event.actor.kind !== "user") this.fail(event, incident.id, null, "no_devices", now);
      this.finish(event.id, now);
      return { send: false, reason: "nobody" };
    }
    const delivered = new Set(
      sql
        .exec<{ device_id: string }>(
          "select device_id from page_deliveries where event_id = ?",
          event.id,
        )
        .toArray()
        .map((row) => row.device_id),
    );
    const pending = all.filter((target) => !delivered.has(target.deviceId));
    const targets = pending.slice(0, MAX_PAGE_DEVICES);
    if (pending.length > MAX_PAGE_DEVICES) {
      const sent = new Set(targets.map((target) => target.userId));
      const left = [...new Set(pending.slice(MAX_PAGE_DEVICES).map((target) => target.userId))];
      const missed = left.filter((userId) => !sent.has(userId));
      this.options.log("page has too many devices, some skipped", {
        event: event.id,
        incident: incident.id,
        devices: pending.length,
        limit: MAX_PAGE_DEVICES,
        membersMissed: missed.length,
      });
      for (const userId of missed) skipped.push({ userId, reason: "over_limit" });
    }
    return {
      send: true,
      incident: {
        id: incident.id,
        number: incident.number,
        title: incident.title,
        severity: incident.severity,
      },
      urgency: PAGING_SEVERITIES.includes(incident.severity) ? "page" : "high",
      targets,
      skipped,
    };
  }

  /**
   * Records what a send did. Delivered devices go in the ledger (a retry skips them); expired ones are dropped.
   * When `final` (retries spent, or nothing left worth retrying), every member who got the page on none of their
   * devices, and every member in `skipped` (the plan's) not reached, gets a `page_failed` entry and
   * `notification.failed`, and the event is closed in the ledger.
   */
  record(
    event: BrigadeEvent,
    outcomes: DeviceOutcome[],
    final: boolean,
    skipped: readonly SkippedMember[],
    now: number,
  ): void {
    const { sql } = this.options.storage;
    if (this.done(event.id)) return;
    for (const outcome of outcomes) {
      if (outcome.ok) {
        sql.exec(
          `insert into page_deliveries (event_id, device_id, user_id, at) values (?, ?, ?, ?)
           on conflict do nothing`,
          event.id,
          outcome.deviceId,
          outcome.userId,
          now,
        );
      } else if (outcome.expiredToken !== undefined) {
        this.run(
          `expire:${event.id}:${outcome.deviceId}`,
          "device.expire",
          { id: outcome.deviceId, pushToken: outcome.expiredToken },
          now,
        );
      }
    }
    if (!final) return;
    const failures = new Map<string, SendFailure[]>();
    for (const outcome of outcomes) {
      if (outcome.ok) continue;
      failures.set(outcome.userId, [...(failures.get(outcome.userId) ?? []), outcome.reason]);
    }
    const missed: { userId: string; reason: PageFailure }[] = [...failures].map(
      ([userId, reasons]) => ({
        userId,
        // The most telling reason: a missing relay or an unsupported platform explains more than "undelivered".
        reason: reasons.includes("not_configured")
          ? "not_configured"
          : reasons.every((r) => r === "unsupported")
            ? "unsupported"
            : "undelivered",
      }),
    );
    for (const one of skipped) {
      if (!failures.has(one.userId)) missed.push(one);
    }
    this.settle(event, event.subject!, missed, now);
    this.finish(event.id, now);
  }

  /**
   * A page the Queue gave up on (the dead-letter consumer, src/notify.ts): if nothing settled it, its incident says
   * the page may not have gone out (`dead_lettered`), and the page is closed. Not for an incident that is
   * acknowledged or no longer active, which `plan` would not page either.
   */
  deadLettered(event: BrigadeEvent, now: number): DeadLetterResult {
    if (!asksForPage(event)) return "not_a_page";
    if (this.done(event.id)) return "settled";
    const incident = this.options.shard.store.get("incidents", event.subject!);
    if (!incident) return "no_incident";
    const open = isActive(incident.status) && incident.acknowledgedAt == null;
    if (open) this.fail(event, incident.id, null, "dead_lettered", now);
    this.finish(event.id, now);
    return open ? "recorded" : "closed";
  }

  /** Records each member in `missed` as not paged, except who the page reached on some device. */
  private settle(
    event: BrigadeEvent,
    incidentId: string,
    missed: readonly { userId: string; reason: PageFailure }[],
    now: number,
  ): void {
    const reached = new Set(
      this.options.storage.sql
        .exec<{ user_id: string }>(
          "select distinct user_id from page_deliveries where event_id = ?",
          event.id,
        )
        .toArray()
        .map((row) => row.user_id),
    );
    for (const { userId, reason } of missed) {
      if (!reached.has(userId)) this.fail(event, incidentId, userId, reason, now);
    }
  }

  private fail(
    event: BrigadeEvent,
    incidentId: string,
    userId: string | null,
    reason: PageFailure,
    now: number,
  ): void {
    this.options.log("page failed", { event: event.id, incident: incidentId, userId, reason });
    this.run(
      `fail:${event.id}:${userId ?? "-"}`,
      "notification.fail",
      { incidentId, eventId: event.id, userId, reason },
      now,
    );
  }

  /** A server-only mutation as the notifier, de-duplicated by `mutationId`. */
  private run(mutationId: string, name: string, args: unknown, now: number): void {
    const { shard } = this.options;
    if (shard.storedResult(NOTIFIER_ACTOR.id, "notifier", mutationId, now)) return;
    const { result, changes } = shard.mutate({
      clientId: "notifier",
      mutationId,
      actor: NOTIFIER_ACTOR,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    else if (result.error.code !== "not_found") {
      this.options.log("notifier mutation refused", { mutation: name, code: result.error.code });
    }
  }

  private done(eventId: string): boolean {
    return (
      this.options.storage.sql
        .exec("select 1 from page_events where event_id = ?", eventId)
        .toArray().length > 0
    );
  }

  private finish(eventId: string, now: number): void {
    this.options.storage.sql.exec(
      "insert into page_events (event_id, at) values (?, ?) on conflict do nothing",
      eventId,
      now,
    );
  }

  private prune(now: number): void {
    const { sql } = this.options.storage;
    const before = now - LEDGER_RETENTION_MS;
    try {
      sql.exec("delete from page_deliveries where at < ?", before);
      sql.exec("delete from page_events where at < ?", before);
    } catch (error) {
      this.options.log("pruning the page ledger failed", { error });
    }
  }
}
