// The workspace shard's side of Slack (RFC 0011): one-time install states, the actions Slack users run as members
// (`incident.declare`, `incident.ack`, with the same RBAC and events as the dashboard), and the ledger that makes the
// incident's channel message idempotent per event. The Slack Worker reaches this through the API's `SlackBridge`
// (src/slack-bridge.ts); the queue consumer through `planSlack` / `recordSlack` (src/notify-slack.ts).

import type { SlackActOutcome, SlackIncident } from "@freecorps/brigade-slack/bridge";
import type {
  SlackIncidentView,
  SlackPerson,
  SlackPostOutcome,
} from "@freecorps/brigade-slack/notifier";
import {
  can,
  isActive,
  MONITOR_ACTOR,
  newId,
  NOTIFIER_ACTOR,
  SLACK_ROW_ID,
  type Actor,
  type IncidentRow,
  type MutationErrorCode,
  type RandomBytes,
  type Severity,
  type SlackLocale,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { BrigadeEvent } from "./outbox.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** How long an install state lasts, and how many may be pending per workspace. */
export const SLACK_STATE_MS = 10 * 60 * 1000;
export const SLACK_MAX_PENDING_STATES = 20;
/** How long a plan holds an incident's message, so two events of one incident never both post it. */
export const SLACK_CLAIM_MS = 30_000;
/** Attempts at one event's message before it is recorded as failed (`notification.failSlack`). */
export const SLACK_MAX_ATTEMPTS = 5;
/** Backoff between attempts: 5, 10, 20, 40 s, or Slack's `Retry-After` when longer. */
export const SLACK_RETRY_FIRST_MS = 5000;
export const SLACK_RETRY_MAX_MS = 60_000;
/** The client id Slack users' mutations run under. */
export const SLACK_CLIENT_ID = "slack";

/** Events that post or update an incident's Slack message. */
const SLACK_EVENTS = new Set([
  "incident.declared",
  "incident.acknowledged",
  "incident.status_changed",
  "incident.severity_changed",
]);

/** Whether the Slack notifier acts on `event` (src/notify-slack.ts). */
export function asksForSlack(event: BrigadeEvent): boolean {
  return SLACK_EVENTS.has(event.type) && event.subject?.startsWith("inc_") === true;
}

const SCHEMA = `
  create table if not exists slack_states (
    hash text primary key,
    user_id text not null,
    expires_at integer not null
  ) without rowid;
  create table if not exists slack_commands (
    key text primary key,
    incident_id text not null,
    at integer not null
  ) without rowid;
  create table if not exists slack_messages (
    incident_id text primary key,
    channel text,
    ts text,
    claimed_until integer not null,
    at integer not null
  ) without rowid;
  create table if not exists slack_events (
    event_id text primary key,
    attempts integer not null,
    retry_at integer not null,
    done integer not null,
    at integer not null
  ) without rowid;
`;

/** What a Slack user asked for, as the bridge passes it on. */
export type SlackShardAction =
  | { kind: "declare"; title: string; severity: Severity }
  | { kind: "ack"; incidentId?: string; number?: number };

/** What the queue consumer should do for an event (see `SlackDesk.plan`). */
export type SlackPlan =
  | {
      send: true;
      channel: string;
      /** The incident's message in that channel, to update; null: post one. */
      ts: string | null;
      teamId: string;
      /** The sealed bot token (src/slack-token.ts); the consumer opens it. */
      token: string;
      locale: SlackLocale;
      incident: SlackIncidentView;
    }
  /** Another delivery holds this incident's message, or this event waits for its backoff: retry after `until`. */
  | { send: false; reason: "held"; until: number }
  /**
   * Nothing to send: not an incident event, Slack not connected or no channel, the incident gone, the event done, or
   * an update for an incident that has no message in the channel.
   */
  | { send: false; reason: "not_slack" | "not_configured" | "not_found" | "done" | "no_message" };

export type SlackDeskOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  randomBytes: RandomBytes;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
};

export class SlackDesk {
  constructor(private readonly options: SlackDeskOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.options.storage.sql;
  }

  /**
   * A one-time state for an install `userId` starts (RFC 0011 "Installing"): 32 random bytes, kept only as their
   * SHA-256, for `SLACK_STATE_MS`. Null when the workspace already has `SLACK_MAX_PENDING_STATES` pending.
   */
  async beginInstall(userId: string, now: number): Promise<string | null> {
    this.sql.exec("delete from slack_states where expires_at <= ?", now);
    const pending = this.sql.exec<{ n: number }>("select count(*) as n from slack_states").one().n;
    if (pending >= SLACK_MAX_PENDING_STATES) return null;
    const nonce = toBase64url(this.options.randomBytes(32));
    this.sql.exec(
      "insert into slack_states (hash, user_id, expires_at) values (?, ?, ?)",
      await sha256(nonce),
      userId,
      now + SLACK_STATE_MS,
    );
    return nonce;
  }

  /** The member who started the install `nonce` names, once: the state is deleted whatever happens next. */
  async takeState(nonce: string, now: number): Promise<string | null> {
    const hash = await sha256(nonce);
    const [row] = this.sql
      .exec<{ user_id: string; expires_at: number }>(
        "select user_id, expires_at from slack_states where hash = ?",
        hash,
      )
      .toArray();
    this.sql.exec("delete from slack_states where hash = ?", hash);
    return row && row.expires_at > now ? row.user_id : null;
  }

  /** `slack.connect` as the member who installed, de-duplicated by the install's state. */
  connect(
    actor: Actor,
    args: Record<string, unknown>,
    key: string,
    now: number,
  ): MutationResultMessage {
    const { shard } = this.options;
    const stored = shard.storedResult(actor.id, SLACK_CLIENT_ID, `connect:${key}`, now);
    if (stored) return stored;
    const { result, changes } = shard.mutate({
      clientId: SLACK_CLIENT_ID,
      mutationId: `connect:${key}`,
      actor,
      name: "slack.connect",
      args,
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    return result;
  }

  /** The Slack team this workspace is connected to, if any. */
  team(): string | null {
    return this.options.shard.store.get("slack", SLACK_ROW_ID)?.teamId ?? null;
  }

  /** What the bridge needs to act for `teamId`: the sealed token and names; null when not connected to that team. */
  context(teamId: string): { workspaceName: string; token: string; locale: SlackLocale } | null {
    const { store } = this.options.shard;
    const connection = store.get("slack", SLACK_ROW_ID);
    const token = store.get("slack_tokens", SLACK_ROW_ID);
    if (!connection || !token || connection.teamId !== teamId || token.teamId !== teamId)
      return null;
    const [workspace] = store.scan("workspace");
    return { workspaceName: workspace?.name ?? "", token: token.token, locale: connection.locale };
  }

  /**
   * Runs a Slack user's action as `actor`, the member their email maps to (RFC 0011 "Commands"): the same named
   * mutations, RBAC and outbox events as the dashboard, under client id `slack`, de-duplicated by `key` so a replayed
   * request gets the first answer. The bridge adds the reply's language and the workspace's name.
   */
  act(
    teamId: string,
    actor: Actor,
    action: SlackShardAction,
    key: string,
    now: number,
  ): SlackActOutcome {
    if (this.team() !== teamId) return refused("not_connected");
    if (action.kind === "declare") return this.declare(actor, action, key, now);
    return this.acknowledge(actor, action, key, now);
  }

  private declare(
    actor: Actor,
    action: Extract<SlackShardAction, { kind: "declare" }>,
    key: string,
    now: number,
  ): SlackActOutcome {
    if (!can(actor.role, "incident:declare")) return refused("forbidden");
    const { shard } = this.options;
    const [done] = this.sql
      .exec<{ incident_id: string }>("select incident_id from slack_commands where key = ?", key)
      .toArray();
    if (done) {
      const incident = shard.store.get("incidents", done.incident_id);
      return incident ? declared(incident) : refused("not_found");
    }
    const mutationId = `declare:${key}`;
    const stored = shard.storedResult(actor.id, SLACK_CLIENT_ID, mutationId, now);
    if (stored && !stored.ok) return refusedBy(stored.error.code);
    const id = newId("inc", now, this.options.randomBytes);
    const { result, changes } = shard.mutate({
      clientId: SLACK_CLIENT_ID,
      mutationId,
      actor,
      name: "incident.declare",
      args: { id, title: action.title, severity: action.severity },
      now,
    });
    if (!result.ok) return refusedBy(result.error.code);
    this.sql.exec(
      "insert into slack_commands (key, incident_id, at) values (?, ?, ?) on conflict do nothing",
      key,
      id,
      now,
    );
    this.options.committed(result.version, changes);
    return declared(shard.store.get("incidents", id)!);
  }

  private acknowledge(
    actor: Actor,
    action: Extract<SlackShardAction, { kind: "ack" }>,
    key: string,
    now: number,
  ): SlackActOutcome {
    if (!can(actor.role, "incident:ack")) return refused("forbidden");
    const { shard } = this.options;
    const incidents = shard.store.scan("incidents");
    let incident: IncidentRow | undefined;
    if (action.incidentId !== undefined) {
      incident = shard.store.get("incidents", action.incidentId);
    } else if (action.number !== undefined) {
      incident = incidents.find((row) => row.number === action.number);
    } else {
      const waiting = incidents
        .filter((row) => isActive(row.status) && row.acknowledgedAt == null)
        .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
      if (waiting.length === 0) return refused("none");
      if (waiting.length > 1) {
        return {
          ...refused("ambiguous"),
          choices: waiting.slice(0, 5).flatMap((row) => (row.number === null ? [] : [row.number])),
        };
      }
      incident = waiting[0];
    }
    if (!incident) return refused("not_found");
    const mutationId = `ack:${key}`;
    const stored = shard.storedResult(actor.id, SLACK_CLIENT_ID, mutationId, now);
    const { result, changes } = stored
      ? { result: stored, changes: [] }
      : shard.mutate({
          clientId: SLACK_CLIENT_ID,
          mutationId,
          actor,
          name: "incident.ack",
          args: { id: incident.id },
          now,
        });
    if (!result.ok) return { ...refusedBy(result.error.code), incident: summary(incident) };
    if (!stored) this.options.committed(result.version, changes);
    return { ok: true, did: "acknowledged", incident: summary(incident) };
  }

  /**
   * What the Slack notifier should do for `event` (RFC 0011 "The incident message"), claiming the incident's message
   * for `SLACK_CLAIM_MS`: post it (`incident.declared`, or any event once the channel changed and the incident was
   * declared since), or update the one it has. Rendered from the incident as it is now.
   */
  plan(event: BrigadeEvent, now: number): SlackPlan {
    this.prune(now);
    if (!asksForSlack(event)) return { send: false, reason: "not_slack" };
    const { store } = this.options.shard;
    const connection = store.get("slack", SLACK_ROW_ID);
    const token = store.get("slack_tokens", SLACK_ROW_ID);
    if (!connection?.channelId || !token || token.teamId !== connection.teamId) {
      return { send: false, reason: "not_configured" };
    }
    const ledger = this.event(event.id);
    if (ledger?.done) return { send: false, reason: "done" };
    if (ledger && ledger.retry_at > now)
      return { send: false, reason: "held", until: ledger.retry_at };
    const incident = store.get("incidents", event.subject!);
    if (!incident) return { send: false, reason: "not_found" };
    const message = this.message(incident.id);
    if (message && message.claimed_until > now) {
      return { send: false, reason: "held", until: message.claimed_until };
    }
    const ts = message?.ts && message.channel === connection.channelId ? message.ts : null;
    // Only a declaration posts: an incident from before Slack was connected (or whose post failed) gets no message
    // when it changes later.
    if (ts === null && event.type !== "incident.declared") {
      this.finish(event.id, now);
      return { send: false, reason: "no_message" };
    }
    this.sql.exec(
      `insert into slack_messages (incident_id, channel, ts, claimed_until, at) values (?, null, null, ?, ?)
       on conflict (incident_id) do update set claimed_until = excluded.claimed_until`,
      incident.id,
      now + SLACK_CLAIM_MS,
      now,
    );
    return {
      send: true,
      channel: connection.channelId,
      ts,
      teamId: connection.teamId,
      token: token.token,
      locale: connection.locale,
      incident: this.view(incident),
    };
  }

  /**
   * What delivering `event`'s message did. Posted or updated: the message's `ts` is kept and the event is done.
   * Failed: retried with backoff (or Slack's `Retry-After`) while attempts remain and retrying may help; otherwise the
   * event is done and `notification.failSlack` puts a `slack_failed` entry on the timeline. Returns when to retry.
   */
  record(event: BrigadeEvent, outcome: SlackPostOutcome, now: number): { retryAt: number | null } {
    if (!asksForSlack(event)) return { retryAt: null };
    const incidentId = event.subject!;
    this.sql.exec("update slack_messages set claimed_until = 0 where incident_id = ?", incidentId);
    if (outcome.ok) {
      this.sql.exec(
        `insert into slack_messages (incident_id, channel, ts, claimed_until, at) values (?, ?, ?, 0, ?)
         on conflict (incident_id) do update set channel = excluded.channel, ts = excluded.ts, at = excluded.at`,
        incidentId,
        outcome.channel,
        outcome.ts,
        now,
      );
      this.finish(event.id, now);
      return { retryAt: null };
    }
    const attempts = (this.event(event.id)?.attempts ?? 0) + 1;
    this.options.log("slack message failed", {
      event: event.id,
      incident: incidentId,
      error: outcome.error,
      attempts,
    });
    if (outcome.retryable && attempts < SLACK_MAX_ATTEMPTS) {
      const backoff = Math.min(SLACK_RETRY_MAX_MS, SLACK_RETRY_FIRST_MS * 2 ** (attempts - 1));
      const retryAt = now + Math.max(backoff, outcome.retryAfterMs ?? 0);
      this.sql.exec(
        `insert into slack_events (event_id, attempts, retry_at, done, at) values (?, ?, ?, 0, ?)
         on conflict (event_id) do update set attempts = excluded.attempts, retry_at = excluded.retry_at`,
        event.id,
        attempts,
        retryAt,
        now,
      );
      return { retryAt };
    }
    this.finish(event.id, now, attempts);
    const { shard } = this.options;
    const mutationId = `slackfail:${event.id}`;
    if (!shard.storedResult(NOTIFIER_ACTOR.id, "slack-notifier", mutationId, now)) {
      const { result, changes } = shard.mutate({
        clientId: "slack-notifier",
        mutationId,
        actor: NOTIFIER_ACTOR,
        name: "notification.failSlack",
        args: { incidentId, eventId: event.id, reason: outcome.reason },
        now,
        internal: true,
      });
      if (result.ok) this.options.committed(result.version, changes);
      else if (result.error.code !== "not_found") {
        this.options.log("slack failure not recorded", { code: result.error.code });
      }
    }
    return { retryAt: null };
  }

  private view(incident: IncidentRow): SlackIncidentView {
    return {
      id: incident.id,
      number: incident.number,
      title: incident.title,
      severity: incident.severity,
      status: incident.status,
      awaitingAck: isActive(incident.status) && incident.acknowledgedAt == null,
      declaredBy: this.person(incident.declaredBy),
      acknowledgedBy: incident.acknowledgedBy == null ? null : this.person(incident.acknowledgedBy),
    };
  }

  private person(id: string): SlackPerson {
    if (id === MONITOR_ACTOR.id) return { kind: "monitors" };
    const member = this.options.shard.store.get("members", id);
    return member ? { kind: "member", name: member.name } : { kind: "teammate" };
  }

  private event(id: string) {
    return this.sql
      .exec<{ attempts: number; retry_at: number; done: number }>(
        "select attempts, retry_at, done from slack_events where event_id = ?",
        id,
      )
      .toArray()[0];
  }

  private message(incidentId: string) {
    return this.sql
      .exec<{ channel: string | null; ts: string | null; claimed_until: number }>(
        "select channel, ts, claimed_until from slack_messages where incident_id = ?",
        incidentId,
      )
      .toArray()[0];
  }

  private finish(eventId: string, now: number, attempts = 0): void {
    this.sql.exec(
      `insert into slack_events (event_id, attempts, retry_at, done, at) values (?, ?, 0, 1, ?)
       on conflict (event_id) do update set done = 1, retry_at = 0`,
      eventId,
      attempts,
      now,
    );
  }

  private prune(now: number): void {
    try {
      const before = now - LEDGER_RETENTION_MS;
      this.sql.exec("delete from slack_events where at < ?", before);
      this.sql.exec("delete from slack_messages where at < ?", before);
      this.sql.exec("delete from slack_commands where at < ?", before);
      this.sql.exec("delete from slack_states where expires_at <= ?", now);
    } catch (error) {
      this.options.log("pruning the slack ledger failed", { error: String(error) });
    }
  }
}

function summary(incident: IncidentRow): SlackIncident {
  return { id: incident.id, number: incident.number, title: incident.title };
}

function declared(incident: IncidentRow): SlackActOutcome {
  return { ok: true, did: "declared", incident: summary(incident) };
}

function refused(
  code: Extract<SlackActOutcome, { ok: false }>["code"],
): SlackActOutcome & { ok: false } {
  return { ok: false, code };
}

/** A mutation's refusal as Slack words it. */
function refusedBy(code: MutationErrorCode): SlackActOutcome & { ok: false } {
  switch (code) {
    case "forbidden":
      return refused("forbidden");
    case "conflict":
      return refused("already");
    case "invalid_transition":
      return refused("not_active");
    case "not_found":
      return refused("not_found");
    case "invalid_args":
      return refused("invalid_title");
    default:
      return refused("failed");
  }
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
