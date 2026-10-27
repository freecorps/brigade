// The shard's side of paging (RFC 0005 "Notifiers", RFC 0006 "Who is paged"): which events page, who a page goes
// to, and what each page did. The queue consumer (src/notify.ts) asks the shard for a plan, sends, and reports
// back; the shard keeps the ledger that makes a redelivered event page nobody twice, and records failed pages on
// the incident's timeline through `notification.fail`.

import {
  ALERTS_ACTOR,
  deliveryId,
  type DeliveryError,
  ESCALATION_ACTOR,
  isActive,
  NOTIFIER_ACTOR,
  type Actor,
  type BrigadeTables,
  type Escalation,
  type EscalationMiss,
  type EscalationPage,
  type EscalationPaged,
  type DevicePlatform,
  incidentPolicy,
  type IncidentRow,
  type IncidentSeverityChanged,
  type IncidentStatus,
  type PageFailure,
  prefixRange,
  type PushEnvironment,
  type Severity,
  type Store,
} from "@freecorps/brigade-schema";
import type { BrigadeEvent } from "./outbox.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** Severities that page (urgency `page`: time-sensitive, some ringing as a call too); lower ones notify (`high`). */
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
  create table if not exists page_steps (
    event_id text primary key,
    run text not null,
    step integer not null,
    at integer not null
  ) without rowid;
  create index if not exists page_deliveries_at on page_deliveries (at);
  create index if not exists page_events_at on page_events (at);
  create index if not exists page_steps_run on page_steps (run, step);
  create index if not exists page_steps_at on page_steps (at);
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
  /** PushKit's token, for a page that rings as a call (RFC 0010); null without one. */
  voipToken: string | null;
  /**
   * Whether the member allowed Critical Alerts on this device (RFC 0006 "Critical Alerts"). Absent from a shard of the
   * version before them (during a deploy): not allowed.
   */
  criticalAlerts?: boolean;
  /** This page's delivery receipt token for the device (src/receipts.ts); absent when none could be minted. */
  receipt?: string;
};

/**
 * A member the page is for but is not sent to, or an escalation level's schedule nobody was on call for (`userId`
 * null, `schedule` its name); recorded as not paged once the page settles.
 */
export type SkippedMember = {
  userId: string | null;
  reason: PageFailure;
  scheduleId?: string | null;
  schedule?: string | null;
};

export type PagePlan =
  | {
      send: true;
      incident: Pick<IncidentRow, "id" | "number" | "title" | "severity">;
      urgency: Urgency;
      /**
       * Whether the page also rings as a call on devices with a VoIP token (`ringsAsCall`), after its alert push.
       * Absent from a shard of the version before calls (during a deploy): no call.
       */
      call?: boolean;
      targets: PageTarget[];
      /** Handed back with the outcomes (`Pager.record`). */
      skipped: SkippedMember[];
    }
  | {
      send: false;
      /**
       * Why nothing is sent: not a paging event, already done, the incident moved on, an escalation page from a run
       * that has stopped (or an older one), or nobody to page.
       */
      reason:
        | "not_a_page"
        | "done"
        | "not_found"
        | "acknowledged"
        | "inactive"
        | "stale"
        | "nobody";
    };

/** Why one device's push failed, as the notifier reports it. */
export type SendFailure = Extract<
  PageFailure,
  "undelivered" | "token_invalid" | "unsupported" | "not_configured"
>;

/**
 * What the relay's answer says about one device, for its delivery row (RFC 0006 "Delivery receipts"): `ms` is how
 * long the relay took; `error` and APNs' `apnsReason` say why it failed. Absent from a consumer of the version
 * before receipts (during a deploy).
 */
export type DeliveryDetail = { ms?: number; error?: DeliveryError; apnsReason?: string };

/** One device's outcome, as the notifier reports it. */
export type DeviceOutcome =
  | ({ deviceId: string; userId: string; ok: true } & DeliveryDetail)
  | ({
      deviceId: string;
      userId: string;
      ok: false;
      /**
       * The push service says this token, the one the push went to, is gone: the device is dropped
       * (`device.expire`) unless it was registered again with another token meanwhile.
       */
      expiredToken?: string;
      reason: SendFailure;
    } & DeliveryDetail);

/**
 * Whether an event asks for a page (RFC 0006 "Who is paged"), from the event alone: a declared incident (any
 * severity; SEV1 and SEV2 at `page` urgency), a severity raised into SEV1 or SEV2, or an escalation level fired by
 * the shard's alarm (the level a run starts with is sent on the event that started it). Monitors open incidents with
 * `incident.declared` as `sys_monitors` (SEV2), so they page through the same rule. An incident reopened by the
 * alerts' actor pages too: its alert fired again soon after it resolved by itself, unacknowledged (RFC 0005 "Alert
 * sources", flapping); a reopen by a member does not. The severity that reopen raised it to first (`reopening`) is
 * paged by the reopen, so it asks for nothing more.
 */
export function asksForPage(event: BrigadeEvent): boolean {
  if (event.subject === undefined) return false;
  if (event.type === "incident.declared") return true;
  if (event.type === "incident.status_changed") {
    const { from, to } = (event.data ?? {}) as { from?: IncidentStatus; to?: IncidentStatus };
    return (
      event.actor.id === ALERTS_ACTOR.id &&
      from !== undefined &&
      to !== undefined &&
      !isActive(from) &&
      isActive(to)
    );
  }
  if (event.type === "escalation.paged") {
    return (event.data as Partial<EscalationPaged["data"]> | null)?.started === false;
  }
  if (event.type !== "incident.severity_changed") return false;
  const { from, to, reopening } = (event.data ?? {}) as Partial<IncidentSeverityChanged["data"]>;
  return (
    reopening !== true &&
    to !== undefined &&
    from !== undefined &&
    PAGING_SEVERITIES.includes(to) &&
    rank(to) < rank(from)
  );
}

/**
 * Whether a page also rings as a call (RFC 0010 "When a page rings"): a page at `page` urgency for a SEV1, or an
 * escalation level fired because nobody acknowledged (SEV1 or SEV2). A SEV2's first page and anything lower are an
 * alert push only. The alert push is sent either way, and first.
 */
export function ringsAsCall(event: BrigadeEvent, severity: Severity): boolean {
  if (!PAGING_SEVERITIES.includes(severity)) return false;
  return severity === "sev1" || event.type === "escalation.paged";
}

/**
 * Whether one device's alert push is a Critical Alert (RFC 0006 "Critical Alerts"): a SEV1 page, to an iPhone whose
 * member allowed Critical Alerts. Everything else, a SEV2 page included, stays time-sensitive.
 */
export function sendsCritical(
  plan: { urgency: Urgency; incident: Pick<IncidentRow, "severity"> },
  target: Pick<PageTarget, "platform" | "criticalAlerts">,
): boolean {
  return (
    plan.urgency === "page" &&
    plan.incident.severity === "sev1" &&
    target.platform === "ios" &&
    target.criticalAlerts === true
  );
}

const rank = (severity: Severity) => ["sev1", "sev2", "sev3", "sev4"].indexOf(severity);

/**
 * Who a page goes to, until on-call schedules exist (Phase 2): the incident commander, if one is assigned, is still a
 * member who can respond, did not cause the event and has a device; otherwise every member who can respond (owner,
 * admin, responder; viewers only read), except who caused it. `targets` are their registered devices, in member then
 * device order; `noDevices` the members it is for who have none (a commander without a device included), so a page
 * that missed them says so. With `everyone` (an escalation run's fallback after nobody acknowledged, or a level that
 * kept failing to fire) the commander is not asked first: every member who can respond is paged, the commander
 * included, except who caused it.
 *
 * Members are the shard's member list (`member.sync`), never D1, so a D1 outage cannot delay a page. Member changes
 * made through Brigade update it with D1 (`member.changeRole`, `member.remove`: row and devices); one made outside
 * Brigade reaches it on the next sync upgrade into the workspace (`member.reconcile`, RFC 0006 "Who is paged").
 */
export function pageTargets(
  store: Store<BrigadeTables>,
  incident: Pick<IncidentRow, "roles">,
  actorId: string,
  everyone = false,
): { targets: PageTarget[]; noDevices: string[] } {
  const members = store.scan("members");
  const devices = store.scan("devices");
  const devicesOf = (userId: string): PageTarget[] =>
    devices
      .filter((device) => device.userId === userId)
      .map(({ id, platform, environment, pushToken, voipToken, criticalAlerts, publicKey }) => ({
        deviceId: id,
        userId,
        platform,
        environment,
        pushToken,
        voipToken,
        criticalAlerts: criticalAlerts === true,
        publicKey,
      }));
  const noDevices: string[] = [];
  const commander = everyone ? undefined : incident.roles?.commander;
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
  /** Brings the shard's alarm forward to `at` (an escalation's next level). Must not throw. */
  wake: (at: number) => void;
};

/** Who an escalation page is for: the members a level reached, or the interim rule (`level` null). */
type Recipients = { targets: PageTarget[]; noDevices: string[]; skipped: SkippedMember[] };

/**
 * Whether an `escalation.paged` event belongs to the incident's run as it is now: any page of the run under way, or
 * of the run that ended on paging everyone (a level's event still being retried when a later level ended the run
 * still pages). One from a run since stopped or closed (acknowledged or resolved, an ended run included, then
 * reopened) or replaced pages nobody.
 */
function current(event: BrigadeEvent, incident: IncidentRow): boolean {
  const data = event.data as Partial<EscalationPaged["data"]> | null;
  const run = incident.escalation;
  if (!run || data?.run !== run.eventId) return false;
  return run.status === "running" || run.status === "exhausted";
}

/**
 * Whether `event` asked for a page the incident's last run already answered: an event from before that run started,
 * not the one that started it, once the run is no longer under way (a SEV3 declaration still being retried after a
 * severity raise started a run that has since ended). It starts no new run and pages nobody; it belongs to no page of
 * the run (`pageOf`).
 */
function superseded(event: BrigadeEvent, run: Escalation | null | undefined): boolean {
  return (
    run != null &&
    event.type !== "escalation.paged" &&
    run.eventId !== event.id &&
    run.status !== "running" &&
    Date.parse(event.time) < run.startedAt
  );
}

const fromMiss = (miss: EscalationMiss): SkippedMember => ({
  userId: miss.userId,
  reason: miss.reason,
  scheduleId: miss.scheduleId,
  schedule: miss.schedule,
});

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
    if (event.type === "escalation.paged" && !current(event, incident)) {
      // Acknowledged and then reopened, or a new run since: this page belongs to a run that stopped.
      this.finish(event.id, now);
      return { send: false, reason: "stale" };
    }
    const run = incident.escalation;
    if (superseded(event, run)) {
      // An older page than the run's own, which has ended since: the run paged for it.
      this.finish(event.id, now);
      return { send: false, reason: "stale" };
    }
    if (run?.eventId === event.id && run.paged > run.pages.length) {
      // A redelivery of the event that started the run, long after: the row no longer keeps its first page (only the
      // last few), and the run moved on from it many pages ago.
      this.finish(event.id, now);
      return { send: false, reason: "stale" };
    }

    const recipients =
      this.escalated(event, incident, now) ??
      ({
        ...pageTargets(this.options.shard.store, incident, event.actor.id),
        skipped: [],
      } satisfies Recipients);
    const { targets: all, noDevices } = recipients;
    const skipped: SkippedMember[] = [
      ...recipients.skipped,
      ...noDevices.map((userId): SkippedMember => ({ userId, reason: "no_devices" })),
    ];
    if (all.length === 0) {
      // Each member the page was for is told apart; with none at all, a member who declared it by hand knows, and a
      // monitor's incident says nobody was paged.
      if (skipped.length > 0) this.settle(event, incident.id, skipped, now);
      else if (event.actor.kind !== "user") {
        this.fail(
          event,
          incident.id,
          null,
          this.nobodyElse(event, incident) ? "nobody_else" : "no_devices",
          now,
        );
      }
      this.finish(event.id, now);
      // A level whose members have no device left by now reached nobody: its timeout would only wait.
      this.unreached(event, incident.id, now);
      return { send: false, reason: "nobody" };
    }
    // A page made again for a lost one skips the devices the lost one reached before the Queue gave up on it.
    const lost =
      event.type === "escalation.paged"
        ? (event.data as Partial<EscalationPaged["data"]> | null)?.lost
        : undefined;
    const delivered = new Set(
      sql
        .exec<{ device_id: string }>(
          "select device_id from page_deliveries where event_id in (?, ?)",
          event.id,
          lost ?? event.id,
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
    this.planStep(event, incident.id, now);
    this.planDeliveries(event, incident.id, targets, now);
    return {
      send: true,
      incident: {
        id: incident.id,
        number: incident.number,
        title: incident.title,
        severity: incident.severity,
      },
      urgency: PAGING_SEVERITIES.includes(incident.severity) ? "page" : "high",
      call: ringsAsCall(event, incident.severity),
      targets,
      skipped,
    };
  }

  /**
   * Remembers which page of the run (its run and step) `event` is sending, as it is planned: a severity raise paging
   * a level again is the same page as the level's own event, so a device that took either counts as reached on it
   * (`reached`), even when the delivery rows that say so could not be written. Never in the page's way.
   */
  private planStep(event: BrigadeEvent, incidentId: string, now: number): void {
    try {
      const page = this.pageOf(event, incidentId);
      if (!page) return;
      this.options.storage.sql.exec(
        "insert into page_steps (event_id, run, step, at) values (?, ?, ?, ?) on conflict do nothing",
        event.id,
        page.run,
        page.step,
        now,
      );
    } catch (error) {
      this.options.log("recording a page's step failed", {
        event: event.id,
        incident: incidentId,
        error: String(error),
      });
    }
  }

  /**
   * Records the devices a page is about to go to (`delivery.plan`), each a `planned` delivery row, so the incident
   * can say what happened on each. Never in the page's way: a failure is logged and the page goes out regardless.
   */
  private planDeliveries(
    event: BrigadeEvent,
    incidentId: string,
    targets: readonly PageTarget[],
    now: number,
  ): void {
    try {
      const { store } = this.options.shard;
      const fresh = targets.filter(
        (target) => !store.get("deliveries", deliveryId(incidentId, event.id, target.deviceId)),
      );
      if (fresh.length === 0) return;
      this.run(
        NOTIFIER_ACTOR,
        "notifier",
        `plan:${event.id}:${fresh[0]!.deviceId}:${fresh.length}`,
        "delivery.plan",
        {
          incidentId,
          eventId: event.id,
          page: this.pageOf(event, incidentId) ?? null,
          devices: fresh.map(({ deviceId, userId, platform, environment }) => ({
            deviceId,
            userId,
            platform,
            environment,
          })),
        },
        now,
      );
    } catch (error) {
      this.options.log("recording a page's deliveries failed", {
        event: event.id,
        incident: incidentId,
        error: String(error),
      });
    }
  }

  /** Records what the relay answered for each device of one attempt (`delivery.report`); never throws. */
  private reportDeliveries(
    event: BrigadeEvent,
    outcomes: readonly DeviceOutcome[],
    now: number,
  ): void {
    if (outcomes.length === 0) return;
    try {
      this.run(
        NOTIFIER_ACTOR,
        "notifier",
        `report:${event.id}:${now}`,
        "delivery.report",
        {
          incidentId: event.subject!,
          eventId: event.id,
          outcomes: outcomes.map((outcome) => ({
            deviceId: outcome.deviceId,
            ok: outcome.ok,
            error: outcome.ok ? null : (outcome.error ?? null),
            reason: outcome.ok ? null : (outcome.apnsReason ?? null),
            ms: Math.min(60_000, Math.max(0, Math.round(outcome.ms ?? 0))),
          })),
        },
        now,
      );
    } catch (error) {
      this.options.log("recording a page's sends failed", {
        event: event.id,
        error: String(error),
      });
    }
  }

  /**
   * Who an event's page goes to under the incident's escalation run (RFC 0006 "Who is paged"), or undefined when no
   * run applies (no default policy): the interim rule then. A level fired by the alarm pages the members the level
   * reached; the first page of an incident starts a run (`escalation.start`, de-duplicated by the event) and pages
   * its first level here, on the same event; a severity raised while a run is under way pages the level paged last
   * again. A level that reached nobody pages everyone who can respond (`level` null).
   */
  private escalated(
    event: BrigadeEvent,
    incident: IncidentRow,
    now: number,
  ): Recipients | undefined {
    const { store } = this.options.shard;
    if (event.type === "escalation.paged") {
      const data = event.data as EscalationPaged["data"];
      const missed = (data.missed ?? []).map(fromMiss);
      // The interim rule as the last fallback: whoever caused the run's first page still knows. After nobody
      // acknowledged (or a level kept failing) it is everyone, not the commander first: the commander had their chance.
      if (data.level === null) {
        return this.interim(
          incident,
          missed,
          data.reason === "exhausted" || data.reason === "stalled",
        );
      }
      return { ...this.devicesOf(data.userIds ?? [], null), skipped: missed };
    }
    let run = incident.escalation;
    let page: EscalationPage | undefined;
    let missed: SkippedMember[] = [];
    if (run?.eventId !== event.id && run?.status !== "running") {
      if (!this.start(event, incident, now)) return undefined;
      run = store.get("incidents", incident.id)?.escalation;
    }
    if (run?.eventId === event.id) {
      // This event started the run (now, or before a redelivery): its first page, and what that level missed. Still
      // kept on the row: `plan` drops a redelivery that came after the run moved past what the row keeps.
      page = run.pages[0];
      missed = (page?.missed ?? []).map(fromMiss);
    } else if (run?.status === "running") {
      page = run.pages[run.pages.length - 1];
    }
    if (!page) return undefined;
    if (page.level === null) return this.interim(incident, missed);
    return { ...this.devicesOf(page.userIds, event.actor.id), skipped: missed };
  }

  /**
   * Starts a run for the page `event` asked for, on the policy of the incident's type, else of the monitor that opened
   * it, else the default (`escalation.start` by `incidentPolicy`, de-duplicated by the event), and brings the alarm
   * forward to its next level. False with no policy (the interim rule pages).
   */
  private start(event: BrigadeEvent, incident: IncidentRow, now: number): boolean {
    if (!incidentPolicy(this.options.shard.store, incident.id)) return false;
    this.run(
      ESCALATION_ACTOR,
      "escalation",
      `start:${event.id}`,
      "escalation.start",
      { incidentId: incident.id, eventId: event.id, causedBy: event.actor.id },
      now,
    );
    const run = this.options.shard.store.get("incidents", incident.id)?.escalation;
    if (run?.status === "running" && run.nextAt !== null) this.options.wake(run.nextAt);
    return true;
  }

  /**
   * RFC 0006's interim rule, excluding whoever caused the run's first page (they know); with `everyone`, every member
   * who can respond, without asking the commander first.
   */
  private interim(incident: IncidentRow, skipped: SkippedMember[], everyone = false): Recipients {
    const causedBy = incident.escalation?.causedBy ?? "";
    return { ...pageTargets(this.options.shard.store, incident, causedBy, everyone), skipped };
  }

  /**
   * Whether an escalation's page to everyone who can respond found nobody because the only member who can respond is
   * whoever caused the run's first page (they declared it, and know).
   */
  private nobodyElse(event: BrigadeEvent, incident: IncidentRow): boolean {
    if (event.type !== "escalation.paged") return false;
    if ((event.data as Partial<EscalationPaged["data"]> | null)?.level !== null) return false;
    const causedBy = incident.escalation?.causedBy;
    const member =
      causedBy === undefined ? undefined : this.options.shard.store.get("members", causedBy);
    return member !== undefined && member.role !== "viewer";
  }

  /** The devices of `userIds` who are still members who can respond; `except` (who caused the page) is not sent to. */
  private devicesOf(
    userIds: readonly string[],
    except: string | null,
  ): { targets: PageTarget[]; noDevices: string[] } {
    const { store } = this.options.shard;
    const targets: PageTarget[] = [];
    const noDevices: string[] = [];
    const devices = store.scan("devices");
    for (const userId of new Set(userIds)) {
      if (userId === except) continue;
      const member = store.get("members", userId);
      if (!member || member.role === "viewer") continue;
      const mine = devices.filter((device) => device.userId === userId);
      if (mine.length === 0) noDevices.push(userId);
      for (const device of mine) {
        const { id, platform, environment, pushToken, voipToken, publicKey } = device;
        targets.push({
          deviceId: id,
          userId,
          platform,
          environment,
          pushToken,
          voipToken,
          criticalAlerts: device.criticalAlerts === true,
          publicKey,
        });
      }
    }
    return { targets, noDevices };
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
    this.reportDeliveries(event, outcomes, now);
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
          NOTIFIER_ACTOR,
          "notifier",
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
    const missed: SkippedMember[] = [...failures].map(([userId, reasons]) => ({
      userId,
      // The most telling reason: a missing relay, an unsupported platform or a refused token explains more than
      // "undelivered".
      reason: reasons.includes("not_configured")
        ? "not_configured"
        : reasons.every((r) => r === "unsupported")
          ? "unsupported"
          : reasons.every((r) => r === "token_invalid")
            ? "token_invalid"
            : "undelivered",
    }));
    for (const one of skipped) {
      if (one.userId === null || !failures.has(one.userId)) missed.push(one);
    }
    this.settle(event, event.subject!, missed, now);
    this.finish(event.id, now);
    this.unreached(event, event.subject!, now);
  }

  /**
   * Escalates early (RFC 0006 "Who is paged"): when `event` is the running run's last page, a level's, and it settled
   * with no device taking any push (every one refused, or failed with its retries spent), the next level of its round
   * fires now (`escalation.unreached`) instead of at the level's timeout; the round's last level waits for it. Not when a device of that page took it (even one
   * nobody has acknowledged yet: a missing receipt is not a missed page), when whoever caused the run's first page is
   * on it (they count as reached), for a severity raise paging the level again, or for a lost page (the dead-letter
   * consumer pages it again instead). De-duplicated by the run and its step, and refused once the run moved on or
   * stopped, so a redelivered result never advances twice. Never throws: the level's timeout still fires the next
   * level if this cannot.
   */
  private unreached(event: BrigadeEvent, incidentId: string, now: number): void {
    try {
      const { store } = this.options.shard;
      const incident = store.get("incidents", incidentId);
      const run = incident?.escalation;
      if (!incident || !run || run.status !== "running") return;
      if (!isActive(incident.status) || incident.acknowledgedAt != null) return;
      const last = run.pages[run.pages.length - 1];
      if (!last || last.level === null || this.stepOf(event, run) !== run.paged) return;
      // The run's first page (or that page made again) on which whoever caused it was reached without a push.
      const first = run.paged === 1 || (run.paged === 2 && last.again === true);
      if (first && run.pages[0]?.userIds.includes(run.causedBy)) return;
      if (this.reached(event, incidentId, run.eventId, run.paged)) return;
      this.run(
        ESCALATION_ACTOR,
        "escalation",
        `unreached:${run.eventId}:${run.paged}`,
        "escalation.unreached",
        { incidentId, step: run.paged },
        now,
      );
      const after = store.get("incidents", incidentId)?.escalation;
      if (after?.status === "running" && after.nextAt !== null) this.options.wake(after.nextAt);
    } catch (error) {
      this.options.log("escalating early failed", {
        event: event.id,
        incident: incidentId,
        error: String(error),
      });
    }
  }

  /** The step of `run` that `event` is the own page of: a level's event, or the event that started the run (1). */
  private stepOf(event: BrigadeEvent, run: Escalation): number | undefined {
    if (event.type === "escalation.paged") {
      const data = event.data as Partial<EscalationPaged["data"]> | null;
      return data?.run === run.eventId && typeof data.step === "number" ? data.step : undefined;
    }
    return run.eventId === event.id ? 1 : undefined;
  }

  /**
   * Whether a device took any push of the page `step` of run `runId`: this event's or the lost one's it was made
   * again for (the ledger), any event planned as that page (the ledger by `page_steps`: a severity raise paging the
   * level again), or any push of that page the relay accepted (its delivery rows, a severity raise's included).
   */
  private reached(event: BrigadeEvent, incidentId: string, runId: string, step: number): boolean {
    const lost =
      event.type === "escalation.paged"
        ? (event.data as Partial<EscalationPaged["data"]> | null)?.lost
        : undefined;
    const ledger = this.options.storage.sql
      .exec(
        "select 1 from page_deliveries where event_id in (?, ?) limit 1",
        event.id,
        lost ?? event.id,
      )
      .toArray();
    if (ledger.length > 0) return true;
    const again = this.options.storage.sql
      .exec(
        `select 1 from page_deliveries d join page_steps s on s.event_id = d.event_id
         where s.run = ? and s.step = ? limit 1`,
        runId,
        step,
      )
      .toArray();
    if (again.length > 0) return true;
    const { from, to } = prefixRange(`${incidentId}:`);
    return this.options.shard.store
      .range("deliveries", from, to)
      .some((row) => row.run === runId && row.step === step && row.acceptedAt !== null);
  }

  /**
   * A page the Queue gave up on (the dead-letter consumer, src/notify.ts): if nothing settled it, its incident says
   * the page may not have gone out (`dead_lettered`), and the page is closed. Not for an incident that is
   * acknowledged or no longer active, which `plan` would not page either. A first page that never reached the plan
   * never started its escalation run: it starts here (its first level recorded as not paged), so the next levels
   * still fire on time.
   */
  deadLettered(event: BrigadeEvent, now: number): DeadLetterResult {
    if (!asksForPage(event)) return "not_a_page";
    if (this.done(event.id)) return "settled";
    const incident = this.options.shard.store.get("incidents", event.subject!);
    if (!incident) return "no_incident";
    const open = isActive(incident.status) && incident.acknowledgedAt == null;
    const run = incident.escalation;
    if (
      open &&
      event.type !== "escalation.paged" &&
      run?.eventId !== event.id &&
      run?.status !== "running" &&
      !superseded(event, run)
    ) {
      this.start(event, incident, now);
    }
    if (open) this.fail(event, incident.id, null, "dead_lettered", now);
    // The lost page is still the run's last: nothing would page its members until the next level's timeout, or ever,
    // when the run ended on it (everyone who can respond). It is paged again, on an event of its own, once: that
    // event lost too is only recorded (`lastPage`).
    const after = this.options.shard.store.get("incidents", incident.id)?.escalation;
    const step = after && this.lastPage(event, after);
    if (open && after && step !== undefined) {
      const ended = after.status === "exhausted";
      this.run(
        ESCALATION_ACTOR,
        "escalation",
        `${ended ? "fallback" : "repage"}:${after.eventId}:${step}`,
        ended ? "escalation.fallback" : "escalation.repage",
        { incidentId: incident.id, step, lost: event.id },
        now,
      );
    }
    this.finish(event.id, now);
    return open ? "recorded" : "closed";
  }

  /**
   * The step of `run`'s last page when `event` is that page (a level's or an end's own event, or the event that
   * started the run while its first page is the only one): a page the dead-letter consumer can page again. Not a page
   * that was itself made again (`lost`): a lost page is paged again once.
   */
  private lastPage(event: BrigadeEvent, run: Escalation): number | undefined {
    const last = run.pages[run.pages.length - 1];
    if (!last || (run.status !== "running" && run.status !== "exhausted")) return undefined;
    // A run ends only on everyone who can respond, and runs on only after a level.
    if ((run.status === "exhausted") !== (last.level === null)) return undefined;
    if (event.type === "escalation.paged") {
      const data = event.data as Partial<EscalationPaged["data"]> | null;
      if (data?.lost !== undefined) return undefined;
      return data?.run === run.eventId && data.step === run.paged ? run.paged : undefined;
    }
    return run.eventId === event.id && run.paged === 1 ? 1 : undefined;
  }

  /** Records each member in `missed` as not paged, except who the page reached on some device. */
  private settle(
    event: BrigadeEvent,
    incidentId: string,
    missed: readonly SkippedMember[],
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
    const seen = new Set<string>();
    const refused = this.refused(incidentId);
    for (const { userId, reason, scheduleId, schedule } of missed) {
      if (userId !== null && (reached.has(userId) || seen.has(userId))) continue;
      if (userId !== null) seen.add(userId);
      const where =
        scheduleId === undefined ? undefined : { id: scheduleId ?? null, name: schedule ?? null };
      // No device left because the push service refused the one this incident paged (the retry after a
      // `BadDeviceToken`, or a later level): say that, not that they never registered one.
      const why =
        reason === "no_devices" && userId !== null && refused.has(userId)
          ? "token_invalid"
          : reason;
      this.fail(event, incidentId, userId, why, now, where);
    }
  }

  /** The members a page of the incident went to a device of that the push service refused as gone (`token_invalid`). */
  private refused(incidentId: string): Set<string> {
    const { from, to } = prefixRange(`${incidentId}:`);
    return new Set(
      this.options.shard.store
        .range("deliveries", from, to)
        .filter((row) => row.error === "token_invalid")
        .map((row) => row.userId),
    );
  }

  private fail(
    event: BrigadeEvent,
    incidentId: string,
    userId: string | null,
    reason: PageFailure,
    now: number,
    schedule?: { id: string | null; name: string | null },
  ): void {
    this.options.log("page failed", { event: event.id, incident: incidentId, userId, reason });
    // One entry per member, and per schedule nobody was on call for.
    const key = schedule?.id && userId === null ? `-:${schedule.id}` : (userId ?? "-");
    const page = this.pageOf(event, incidentId);
    this.run(
      NOTIFIER_ACTOR,
      "notifier",
      `fail:${event.id}:${key}`,
      "notification.fail",
      {
        incidentId,
        eventId: event.id,
        userId,
        reason,
        ...(schedule ? { schedule: schedule.name } : {}),
        ...(page && { page }),
      },
      now,
    );
  }

  /**
   * Which page of the incident's escalation run `event` is, so its failures go with that page: a level's own event,
   * the event that started the run (its first page), or a severity raised mid-run (the level paged last, again).
   */
  private pageOf(
    event: BrigadeEvent,
    incidentId: string,
  ): { run: string; step: number } | undefined {
    const run = this.options.shard.store.get("incidents", incidentId)?.escalation;
    if (!run) return undefined;
    if (event.type === "escalation.paged") {
      const data = event.data as Partial<EscalationPaged["data"]> | null;
      return data?.run === run.eventId && typeof data.step === "number"
        ? { run: data.run, step: data.step }
        : undefined;
    }
    if (run.eventId === event.id) return { run: run.eventId, step: 1 };
    // Only a severity raised while the run was under way pages its last level again; another event (an incident
    // declared before that run started, whose page never went out) belongs to no page of it.
    const raised =
      event.type === "incident.severity_changed" && Date.parse(event.time) >= run.startedAt;
    if (raised && run.status === "running" && run.paged > 0) {
      return { run: run.eventId, step: run.paged };
    }
    return undefined;
  }

  /** A server-only mutation as `actor`, de-duplicated by `mutationId`. */
  private run(
    actor: Actor,
    clientId: string,
    mutationId: string,
    name: string,
    args: unknown,
    now: number,
  ): void {
    const { shard } = this.options;
    if (shard.storedResult(actor.id, clientId, mutationId, now)) return;
    const { result, changes } = shard.mutate({
      clientId,
      mutationId,
      actor,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    else if (result.error.code !== "not_found") {
      this.options.log(`${clientId} mutation refused`, { mutation: name, code: result.error.code });
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
      sql.exec("delete from page_steps where at < ?", before);
    } catch (error) {
      this.options.log("pruning the page ledger failed", { error });
    }
  }
}
