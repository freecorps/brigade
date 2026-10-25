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
/** A page goes to at most this many devices; more is a misconfiguration, and the rest are logged. */
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

export type PagePlan =
  | {
      send: true;
      incident: Pick<IncidentRow, "id" | "number" | "title" | "severity">;
      urgency: Urgency;
      targets: PageTarget[];
    }
  | {
      send: false;
      /** Why nothing is sent: not a paging event, already done, the incident moved on, or nobody to page. */
      reason: "not_a_page" | "done" | "not_found" | "acknowledged" | "inactive" | "nobody";
    };

/** One device's outcome, as the notifier reports it. */
export type DeviceOutcome =
  | { deviceId: string; userId: string; ok: true }
  | {
      deviceId: string;
      userId: string;
      ok: false;
      /** The push service says the token is gone: the device is dropped (`device.expire`). */
      expired?: boolean;
      reason: Exclude<PageFailure, "no_devices">;
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
 * Who a page goes to, until on-call schedules exist (Phase 2): the incident commander, if one is assigned and is
 * not who caused the event; otherwise every member who can respond (owner, admin, responder; viewers only read),
 * except who caused it. Their registered devices, in member then device order.
 */
export function pageTargets(
  store: Store<BrigadeTables>,
  incident: Pick<IncidentRow, "roles">,
  actorId: string,
): PageTarget[] {
  const members = store.scan("members");
  const commander = incident.roles?.commander;
  const users =
    commander !== undefined &&
    commander !== actorId &&
    members.some((member) => member.id === commander)
      ? [commander]
      : members
          .filter((member) => member.role !== "viewer" && member.id !== actorId)
          .map((member) => member.id);
  const devices = store.scan("devices");
  return users.flatMap((userId) =>
    devices
      .filter((device) => device.userId === userId)
      .map(({ id, platform, environment, pushToken, publicKey }) => ({
        deviceId: id,
        userId,
        platform,
        environment,
        pushToken,
        publicKey,
      })),
  );
}

export type PagerOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
};

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

    const all = pageTargets(this.options.shard.store, incident, event.actor.id);
    if (all.length === 0) {
      // Someone declared it by hand: they know. A monitor did: nobody would hear of it, so say so.
      if (event.actor.kind !== "user") this.fail(event, incident.id, null, "no_devices", now);
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
    const targets = all.filter((target) => !delivered.has(target.deviceId));
    if (targets.length > MAX_PAGE_DEVICES) {
      this.options.log("page has too many devices, some skipped", {
        event: event.id,
        devices: targets.length,
      });
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
      targets: targets.slice(0, MAX_PAGE_DEVICES),
    };
  }

  /**
   * Records what a send did. Delivered devices go in the ledger (a retry skips them); expired ones are dropped.
   * When `final` (retries spent, or nothing left worth retrying), every member who got the page on none of their
   * devices gets a `page_failed` entry and `notification.failed`, and the event is closed in the ledger.
   */
  record(event: BrigadeEvent, outcomes: DeviceOutcome[], final: boolean, now: number): void {
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
      } else if (outcome.expired) {
        this.run(`expire:${outcome.deviceId}`, "device.expire", { id: outcome.deviceId }, now);
      }
    }
    if (!final) return;
    const reached = new Set(
      sql
        .exec<{ user_id: string }>(
          "select distinct user_id from page_deliveries where event_id = ?",
          event.id,
        )
        .toArray()
        .map((row) => row.user_id),
    );
    const failures = new Map<string, Exclude<PageFailure, "no_devices">[]>();
    for (const outcome of outcomes) {
      if (outcome.ok || reached.has(outcome.userId)) continue;
      failures.set(outcome.userId, [...(failures.get(outcome.userId) ?? []), outcome.reason]);
    }
    for (const [userId, reasons] of failures) {
      // The most telling reason: a missing relay or an unsupported platform explains more than "undelivered".
      const reason = reasons.includes("not_configured")
        ? "not_configured"
        : reasons.every((r) => r === "unsupported")
          ? "unsupported"
          : "undelivered";
      this.fail(event, event.subject!, userId, reason, now);
    }
    this.finish(event.id, now);
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
