// The workspace shard's side of Slack (RFC 0011): one-time install states, the actions Slack users run as members
// (`/inc` and its form, the Acknowledge button, `!update` and the message shortcut: the dashboard's own mutations,
// RBAC and events), and the ledger that makes everything the notifier sends idempotent per event: the incident's
// message, its channel (created, people invited, archived), the timeline mirror, and giving a token back to Slack.
// The Slack Worker reaches this through the API's `SlackBridge` (src/slack-bridge.ts); the queue consumer through
// `planSlack` / `recordSlack` (src/notify-slack.ts).

import type {
  SlackActOutcome,
  SlackIncident,
  SlackRoleName,
} from "@freecorps/brigade-slack/bridge";
import type {
  SlackEntryView,
  SlackIncidentView,
  SlackPerson,
  SlackPostOutcome,
} from "@freecorps/brigade-slack/notifier";
import {
  can,
  isActive,
  isLiveRole,
  MONITOR_ACTOR,
  newId,
  NOTIFIER_ACTOR,
  roleDefinitions,
  SLACK_ROW_ID,
  type Actor,
  type IncidentRow,
  type IncidentStatus,
  type MutationErrorCode,
  type RandomBytes,
  type Severity,
  type SlackLocale,
  type SlackRow,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { BrigadeEvent } from "./outbox.ts";
import { LEDGER_RETENTION_MS } from "./paging.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** How long an install state lasts, and how many may be pending per workspace. */
export const SLACK_STATE_MS = 10 * 60 * 1000;
export const SLACK_MAX_PENDING_STATES = 20;
/** How long a plan holds an incident's Slack work, so two events of one incident never both post or create. */
export const SLACK_CLAIM_MS = 30_000;
/** Attempts at one job of an event before it is recorded as failed (`notification.failSlack`). */
export const SLACK_MAX_ATTEMPTS = 5;
/** Backoff between attempts: 5, 10, 20, 40 s, or Slack's `Retry-After` when longer. */
export const SLACK_RETRY_FIRST_MS = 5000;
export const SLACK_RETRY_MAX_MS = 60_000;
/** The client id Slack users' mutations run under. */
export const SLACK_CLIENT_ID = "slack";
/** People one invite asks Slack for: an incident's roles and pages stay far below. */
export const SLACK_MAX_INVITES = 50;
/** Channels archived per alarm; more wait for the next one. */
export const SLACK_ARCHIVE_BATCH = 20;
/** After the alarm asked for an archive, how long before it asks again if the notifier did not get to it. */
export const SLACK_ARCHIVE_REQUEUE_MS = 10 * 60_000;
const HOUR_MS = 60 * 60_000;

/** Incident events the Slack notifier acts on: the message, the channel, the mirror and the invitations. */
const INCIDENT_EVENTS = new Set([
  "incident.declared",
  "incident.acknowledged",
  "incident.status_changed",
  "incident.severity_changed",
  "incident.update_posted",
  "incident.role_assigned",
  "escalation.paged",
  "slack.archive_due",
]);
/** Connection events that may leave a token to give back to Slack. */
const TOKEN_EVENTS = new Set(["slack.disconnected", "slack.connected"]);

/** Whether the Slack notifier acts on `event` (src/notify-slack.ts). */
export function asksForSlack(event: BrigadeEvent): boolean {
  if (TOKEN_EVENTS.has(event.type)) return event.subject === SLACK_ROW_ID;
  return INCIDENT_EVENTS.has(event.type) && event.subject?.startsWith("inc_") === true;
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
  create table if not exists slack_jobs (
    event_id text not null,
    job text not null,
    attempts integer not null,
    retry_at integer not null,
    done integer not null,
    at integer not null,
    primary key (event_id, job)
  ) without rowid;
  create table if not exists slack_channels (
    incident_id text primary key,
    channel_id text not null,
    name text not null,
    ts text,
    archive_at integer,
    queued_until integer not null default 0,
    archived integer not null default 0,
    at integer not null
  ) without rowid;
  create index if not exists slack_channels_by_channel on slack_channels (channel_id);
  create table if not exists slack_inbound (
    entry_id text primary key,
    at integer not null
  ) without rowid;
`;

/** What a Slack user asked for, as the bridge passes it on (the assignee of `role` already mapped to a member). */
export type SlackShardTarget = {
  incidentId?: string;
  number?: number;
  channelId?: string;
  threadTs?: string;
};
export type SlackShardAction =
  | { kind: "declare"; title: string; severity: Severity; typeId?: string; serviceIds?: string[] }
  | ({ kind: "ack" } & SlackShardTarget)
  | ({ kind: "update"; body: string; fromMessage?: boolean } & SlackShardTarget)
  | ({ kind: "severity"; severity: Severity } & SlackShardTarget)
  | ({ kind: "resolve" } & SlackShardTarget)
  | ({ kind: "role"; role: string; userId: string } & SlackShardTarget)
  | ({ kind: "escalate" } & SlackShardTarget);

/** One thing the notifier does in Slack for an event, in order (see `SlackDesk.plan`). */
export type SlackWork =
  /** Post the incident's message in `channel`, or update the one at `ts`; `link`: its own channel, to link to. */
  | {
      kind: "message";
      channel: string;
      ts: string | null;
      incident: SlackIncidentView;
      link: string | null;
    }
  /** Create the incident's channel. */
  | { kind: "channel"; number: number | null; title: string; private: boolean }
  /** Invite these members (by their verified email, mapped to Slack users) to the incident's channel. */
  | { kind: "invite"; channel: string; userIds: string[] }
  /** Mirror a timeline entry: in the incident's channel, or under the main message (`threadTs`). */
  | { kind: "entry"; channel: string; threadTs: string | null; entry: SlackEntryView }
  | { kind: "archive"; channel: string }
  /**
   * Give a token Brigade let go of back to Slack (`auth.revoke`), unless it is the one the workspace holds again for
   * the same team (`keep`, sealed too: Slack can hand a reinstall the same token).
   */
  | { kind: "revoke"; keep: string | null; at: number };

/** What the queue consumer should do for an event next. */
export type SlackPlan =
  | {
      send: true;
      /** Names this job of the event in the ledger; `recordSlack` takes it back. */
      job: string;
      /** The team the sealed token is bound to. */
      teamId: string;
      /** The sealed bot token (src/slack-token.ts); the consumer opens it. */
      token: string;
      locale: SlackLocale;
      work: SlackWork;
    }
  /** Another delivery holds this incident's Slack work, or a job waits for its backoff: retry after `until`. */
  | { send: false; reason: "held"; until: number }
  /**
   * Nothing (more) to send: not an event Slack acts on, Slack not connected (or revoked), the incident gone, the
   * event done, or nothing for it to change (an incident with no message and no channel).
   */
  | { send: false; reason: "not_slack" | "not_configured" | "not_found" | "done" | "no_message" };

/** A job, before it is planned: its ledger key and what it does, with the token it uses. */
type Job = {
  key: string;
  work: SlackWork;
  teamId: string;
  token: string;
};

export type SlackDeskOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  randomBytes: RandomBytes;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
  /** Brings the shard's alarm forward to `at` (a channel to archive). Never throws. */
  wake?: (at: number) => void;
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
    switch (action.kind) {
      case "declare":
        return this.declare(actor, action, key, now);
      case "ack":
        return this.acknowledge(actor, action, key, now);
      default:
        return this.change(actor, action, key, now);
    }
  }

  private declare(
    actor: Actor,
    action: Extract<SlackShardAction, { kind: "declare" }>,
    key: string,
    now: number,
  ): SlackActOutcome {
    if (!can(actor.role, "incident:declare")) return refused("forbidden");
    const { shard } = this.options;
    const mutationId = `declare:${key}`;
    const stored = shard.storedResult(actor.id, SLACK_CLIENT_ID, mutationId, now);
    const [reserved] = this.sql
      .exec<{ incident_id: string }>("select incident_id from slack_commands where key = ?", key)
      .toArray();
    // A replay never runs the mutation again: it answers with what the first request did.
    if (reserved) {
      const incident = shard.store.get("incidents", reserved.incident_id);
      if (incident) return declared(incident);
      if (stored) return stored.ok ? refused("not_found") : refusedBy(stored.error.code);
    } else if (stored) {
      // Ran, but which incident it declared is unknown: refuse rather than declare a second one.
      return stored.ok ? refused("failed") : refusedBy(stored.error.code);
    }
    // The incident's id is kept before the mutation runs, so a retry declares that same incident or none.
    const id = reserved?.incident_id ?? newId("inc", now, this.options.randomBytes);
    if (!reserved) {
      this.sql.exec(
        "insert into slack_commands (key, incident_id, at) values (?, ?, ?)",
        key,
        id,
        now,
      );
    }
    const { result, changes } = shard.mutate({
      clientId: SLACK_CLIENT_ID,
      mutationId,
      actor,
      name: "incident.declare",
      args: {
        id,
        title: action.title,
        severity: action.severity,
        ...(action.typeId === undefined ? {} : { typeId: action.typeId }),
        ...(action.serviceIds === undefined ? {} : { serviceIds: action.serviceIds }),
      },
      now,
    });
    if (!result.ok) return refusedBy(result.error.code);
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
    const found = this.target(action, { waiting: true });
    if (!found.ok) return found.refusal;
    const incident = found.incident;
    const { result } = this.run(actor, "incident.ack", { id: incident.id }, `ack:${key}`, now);
    if (!result.ok) return { ...refusedBy(result.error.code), incident: summary(incident) };
    return { ok: true, did: "acknowledged", incident: summary(incident) };
  }

  /** `/inc update`, `sev`, `resolve`, `role`, `escalate`, and `!update` / the shortcut. */
  private change(
    actor: Actor,
    action: Exclude<SlackShardAction, { kind: "declare" | "ack" }>,
    key: string,
    now: number,
  ): SlackActOutcome {
    if (!can(actor.role, "incident:update")) return refused("forbidden");
    const found = this.target(action, {
      channelOnly: action.kind === "update" && action.fromMessage === true,
    });
    if (!found.ok) return found.refusal;
    const { incident } = found;
    const { store } = this.options.shard;
    const mutationId = `${action.kind}:${key}`;
    const done = (did: Extract<SlackActOutcome, { ok: true }>["did"], more = {}) => ({
      ok: true as const,
      did,
      incident: summary(store.get("incidents", incident.id) ?? incident),
      ...more,
    });
    const refuse = (
      code: MutationErrorCode,
      instead: Partial<Record<MutationErrorCode, Code>>,
    ) => ({
      ...(instead[code] ? refused(instead[code]) : refusedBy(code)),
      incident: summary(incident),
    });
    switch (action.kind) {
      case "update": {
        const { result, changes } = this.run(
          actor,
          "incident.postUpdate",
          { id: incident.id, body: action.body },
          mutationId,
          now,
        );
        if (!result.ok) return refuse(result.error.code, { invalid_args: "invalid_update" });
        // Already in the channel as a Slack message: the mirror does not post it again.
        const entry = changes.find((change) => change.table === "timeline" && change.after);
        if (action.fromMessage && entry) {
          this.sql.exec(
            "insert or ignore into slack_inbound (entry_id, at) values (?, ?)",
            entry.id,
            now,
          );
        }
        return done("updated");
      }
      case "severity": {
        const { result } = this.run(
          actor,
          "incident.setSeverity",
          { id: incident.id, severity: action.severity },
          mutationId,
          now,
        );
        if (!result.ok) return refuse(result.error.code, { conflict: "unchanged" });
        return done("severity", { severity: action.severity });
      }
      case "resolve": {
        const { result } = this.run(
          actor,
          "incident.setStatus",
          { id: incident.id, status: "resolved" satisfies IncidentStatus },
          mutationId,
          now,
        );
        if (!result.ok) return refuse(result.error.code, { conflict: "not_active" });
        return done("resolved");
      }
      case "role": {
        const roles = roleDefinitions(store.scan("incident_roles")).filter(isLiveRole);
        const wanted = normalize(action.role);
        const role = roles.find(
          (one) =>
            one.id === action.role ||
            normalize(one.id) === wanted ||
            ROLE_ALIASES[wanted] === one.id ||
            (one.name !== null && normalize(one.name) === wanted),
        );
        if (!role) {
          return {
            ...refused("unknown_role"),
            roles: roles.map((one): SlackRoleName => ({ id: one.id, name: one.name })),
          };
        }
        const { result } = this.run(
          actor,
          "incident.assignRole",
          { id: incident.id, role: role.id, userId: action.userId },
          mutationId,
          now,
        );
        if (!result.ok) {
          // The member chosen is what is wrong: a viewer, or not in the shard's member list.
          if (result.error.code === "invalid_args") {
            const member = store.get("members", action.userId);
            return refused(member ? "role_viewer" : "role_unmapped");
          }
          return refuse(result.error.code, { conflict: "unchanged" });
        }
        return done("role", { role: { id: role.id, name: role.name } satisfies SlackRoleName });
      }
      case "escalate": {
        const run = incident.escalation;
        if (incident.acknowledgedAt != null && isActive(incident.status)) {
          return { ...refused("already"), incident: summary(incident) };
        }
        if (!isActive(incident.status))
          return { ...refused("not_active"), incident: summary(incident) };
        if (!run || run.status !== "running") {
          return { ...refused("not_escalating"), incident: summary(incident) };
        }
        const { result } = this.run(
          actor,
          "escalation.now",
          { incidentId: incident.id, step: run.paged },
          mutationId,
          now,
          true,
        );
        if (!result.ok) {
          return refuse(result.error.code, {
            not_found: "not_escalating",
            conflict: "unchanged",
          });
        }
        return done("escalated");
      }
    }
  }

  /** Runs `name` once per `mutationId` as `actor`: a replay answers with the stored result and changes nothing. */
  private run(
    actor: Actor,
    name: string,
    args: Record<string, unknown>,
    mutationId: string,
    now: number,
    internal = false,
  ): { result: MutationResultMessage; changes: readonly RowChange[] } {
    const { shard } = this.options;
    const stored = shard.storedResult(actor.id, SLACK_CLIENT_ID, mutationId, now);
    if (stored) return { result: stored, changes: [] };
    const { result, changes } = shard.mutate({
      clientId: SLACK_CLIENT_ID,
      mutationId,
      actor,
      name,
      args,
      now,
      ...(internal ? { internal: true } : {}),
    });
    if (result.ok) this.options.committed(result.version, changes);
    return { result, changes };
  }

  /**
   * The incident an action is about: by id, by number, by the channel it was asked in (an incident's own channel, or
   * a thread under an incident's message), else the only active one (`waiting`: the only one nobody acknowledged).
   * `channelOnly`: only the channel counts (a message posted there).
   */
  private target(
    action: SlackShardTarget,
    options: { waiting?: boolean; channelOnly?: boolean },
  ): { ok: true; incident: IncidentRow } | { ok: false; refusal: SlackActOutcome & { ok: false } } {
    const { store } = this.options.shard;
    const miss = (code: Code) => ({ ok: false as const, refusal: refused(code) });
    const hit = (incident: IncidentRow | undefined) =>
      incident ? { ok: true as const, incident } : miss("not_found");
    if (action.incidentId !== undefined) return hit(store.get("incidents", action.incidentId));
    if (action.number !== undefined) {
      return hit(store.scan("incidents").find((row) => row.number === action.number));
    }
    if (action.channelId !== undefined) {
      const [own] = this.sql
        .exec<{ incident_id: string }>(
          "select incident_id from slack_channels where channel_id = ? order by at desc limit 1",
          action.channelId,
        )
        .toArray();
      if (own) return hit(store.get("incidents", own.incident_id));
      if (action.threadTs !== undefined) {
        const [thread] = this.sql
          .exec<{ incident_id: string }>(
            "select incident_id from slack_messages where channel = ? and ts = ? limit 1",
            action.channelId,
            action.threadTs,
          )
          .toArray();
        if (thread) return hit(store.get("incidents", thread.incident_id));
      }
    }
    if (options.channelOnly) return miss("not_incident_channel");
    const candidates = store
      .scan("incidents")
      .filter((row) => isActive(row.status) && (!options.waiting || row.acknowledgedAt == null))
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    if (candidates.length === 0) return miss(options.waiting ? "none" : "no_active");
    if (candidates.length > 1) {
      return {
        ok: false,
        refusal: {
          ...refused(options.waiting ? "ambiguous" : "which"),
          choices: candidates
            .slice(0, 5)
            .flatMap((row) => (row.number === null ? [] : [row.number])),
        },
      };
    }
    return { ok: true, incident: candidates[0]! };
  }

  /** The declare form's choices: the workspace's incident types and services, by name. */
  catalog(): { types: { id: string; name: string }[]; services: { id: string; name: string }[] } {
    const { store } = this.options.shard;
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      types: store
        .scan("incident_types")
        .map(({ id, name }) => ({ id, name }))
        .sort(byName),
      services: store
        .scan("services")
        .map(({ id, name }) => ({ id, name }))
        .sort(byName),
    };
  }

  /**
   * Slack took the app's access away (Events API): `slack.markRevoked` as the notifier, for the team connected now.
   * `botUserIds` (`tokens_revoked`): only when the revoked tokens include this workspace's bot. False when nothing
   * changed (another team, another bot, already revoked).
   */
  revoke(
    teamId: string,
    reason: "uninstalled" | "tokens_revoked",
    botUserIds: string[] | null,
    now: number,
  ): boolean {
    const { shard } = this.options;
    const connection = shard.store.get("slack", SLACK_ROW_ID);
    const token = shard.store.get("slack_tokens", SLACK_ROW_ID);
    if (!connection || connection.teamId !== teamId) return false;
    if (botUserIds !== null && (!token || !botUserIds.includes(token.botUserId))) return false;
    const { result } = this.run(
      NOTIFIER_ACTOR,
      "slack.markRevoked",
      { teamId, reason },
      `revoked:${teamId}:${connection.connectedAt}`,
      now,
      true,
    );
    if (!result.ok && result.error.code !== "conflict") {
      this.options.log("slack revocation not recorded", { code: result.error.code });
    }
    return result.ok;
  }

  /**
   * What the Slack notifier should do next for `event` (RFC 0011 "The incident message", "A channel per incident",
   * "Timeline mirror"): one job at a time, in order, each done once (the ledger keeps which), with the incident's
   * Slack work claimed for `SLACK_CLAIM_MS` so two events of one incident never post or create at once. The consumer
   * plans again after recording each job, until nothing is left.
   */
  plan(event: BrigadeEvent, now: number): SlackPlan {
    this.prune(now);
    if (!asksForSlack(event)) return { send: false, reason: "not_slack" };
    if (this.event(event.id)?.done) return { send: false, reason: "done" };
    if (TOKEN_EVENTS.has(event.type)) return this.planRevoke(event, now);
    const { store } = this.options.shard;
    const connection = store.get("slack", SLACK_ROW_ID);
    const token = store.get("slack_tokens", SLACK_ROW_ID);
    if (
      !connection ||
      !token ||
      token.teamId !== connection.teamId ||
      connection.revokedAt != null
    ) {
      return { send: false, reason: "not_configured" };
    }
    const incident = store.get("incidents", event.subject!);
    if (!incident) return { send: false, reason: "not_found" };
    const message = this.message(incident.id);
    if (message && message.claimed_until > now) {
      return { send: false, reason: "held", until: message.claimed_until };
    }
    const jobs = this.jobs(event, incident, connection, now);
    for (const job of jobs) {
      const row = this.job(event.id, job.key);
      if (row?.done) continue;
      if (row && row.retry_at > now) return { send: false, reason: "held", until: row.retry_at };
      this.sql.exec(
        `insert into slack_messages (incident_id, channel, ts, claimed_until, at) values (?, null, null, ?, ?)
         on conflict (incident_id) do update set claimed_until = excluded.claimed_until, at = excluded.at`,
        incident.id,
        now + SLACK_CLAIM_MS,
        now,
      );
      return {
        send: true,
        job: job.key,
        teamId: connection.teamId,
        token: token.token,
        locale: connection.locale,
        work: job.work,
      };
    }
    this.finish(event.id, now);
    return jobs.length === 0
      ? { send: false, reason: "no_message" }
      : { send: false, reason: "done" };
  }

  /** The jobs `event` asks for, in the order they run, from the incident and its Slack state as they are now. */
  private jobs(
    event: BrigadeEvent,
    incident: IncidentRow,
    connection: SlackRow,
    now: number,
  ): Omit<Job, "teamId" | "token">[] {
    const channel = this.channel(incident.id);
    const open = channel && !channel.archived ? channel : undefined;
    const message = this.message(incident.id);
    const main =
      message?.ts && connection.channelId && message.channel === connection.channelId
        ? message.ts
        : null;
    const jobs: Omit<Job, "teamId" | "token">[] = [];
    const view = () => this.view(incident);
    const updateMessages = () => {
      if (main && connection.channelId) {
        jobs.push({
          key: "message:main",
          work: {
            kind: "message",
            channel: connection.channelId,
            ts: main,
            incident: view(),
            link: channel?.channel_id ?? null,
          },
        });
      }
      if (open?.ts) {
        jobs.push({
          key: "message:incident",
          work: {
            kind: "message",
            channel: open.channel_id,
            ts: open.ts,
            incident: view(),
            link: null,
          },
        });
      }
    };
    const mirror = () => {
      const entry = this.entry(event);
      if (!entry) return;
      // In the incident's channel when it has one; else a reply under its message in the main channel.
      if (open) {
        jobs.push({
          key: "entry",
          work: { kind: "entry", channel: open.channel_id, threadTs: null, entry },
        });
      } else if (main && connection.channelId) {
        jobs.push({
          key: "entry",
          work: { kind: "entry", channel: connection.channelId, threadTs: main, entry },
        });
      }
    };
    const invite = (userIds: string[]) => {
      const members = this.members(userIds);
      if (open && members.length > 0) {
        jobs.push({
          key: "invite",
          work: { kind: "invite", channel: open.channel_id, userIds: members },
        });
      }
    };
    switch (event.type) {
      case "incident.declared": {
        const wanted = connection.incidentChannels ?? "off";
        const wants =
          wanted === "all" ||
          (wanted === "major" && (incident.severity === "sev1" || incident.severity === "sev2"));
        if (wants && !channel) {
          jobs.push({
            key: "channel",
            work: {
              kind: "channel",
              number: incident.number,
              title: incident.title,
              private: connection.privateChannels ?? false,
            },
          });
        }
        if (open) {
          invite(this.responders(incident));
          jobs.push({
            key: "message:incident",
            work: {
              kind: "message",
              channel: open.channel_id,
              ts: open.ts,
              incident: view(),
              link: null,
            },
          });
        }
        if (connection.channelId) {
          jobs.push({
            key: "message:main",
            work: {
              kind: "message",
              channel: connection.channelId,
              ts: main,
              incident: view(),
              link: channel?.channel_id ?? null,
            },
          });
        }
        break;
      }
      case "incident.status_changed":
        this.scheduleArchive(incident, connection, now);
        updateMessages();
        mirror();
        break;
      case "incident.acknowledged":
      case "incident.severity_changed":
        updateMessages();
        mirror();
        break;
      case "incident.role_assigned": {
        const to = Reflect.get(Object(event.data), "to");
        if (typeof to === "string") invite([to]);
        mirror();
        break;
      }
      case "incident.update_posted":
        mirror();
        break;
      case "escalation.paged": {
        const userIds = Reflect.get(Object(event.data), "userIds");
        invite(Array.isArray(userIds) ? userIds.filter((id) => typeof id === "string") : []);
        break;
      }
      case "slack.archive_due":
        if (open && !isActive(incident.status)) {
          jobs.push({ key: "archive", work: { kind: "archive", channel: open.channel_id } });
        }
        break;
    }
    return jobs;
  }

  /** `slack.disconnected`, or `slack.connected` replacing another team: the token kept for that team, revoked. */
  private planRevoke(event: BrigadeEvent, now: number): SlackPlan {
    const data = Object(event.data) as Record<string, unknown>;
    const teamId = event.type === "slack.disconnected" ? data.teamId : data.replaced;
    const { store } = this.options.shard;
    const kept = typeof teamId === "string" ? store.get("slack_revocations", teamId) : undefined;
    const key = kept ? `revoke:${kept.at}` : "";
    const row = kept ? this.job(event.id, key) : undefined;
    if (!kept || row?.done) {
      this.finish(event.id, now);
      return { send: false, reason: "done" };
    }
    if (row && row.retry_at > now) return { send: false, reason: "held", until: row.retry_at };
    const current = store.get("slack_tokens", SLACK_ROW_ID);
    return {
      send: true,
      job: key,
      teamId: kept.teamId,
      token: kept.token,
      locale: "en",
      work: {
        kind: "revoke",
        keep: current && current.teamId === kept.teamId ? current.token : null,
        at: kept.at,
      },
    };
  }

  /**
   * What doing `job` of `event` did. Done: its result is kept (the message's `ts`, the channel's id) and the job is
   * done. Failed: retried with backoff (or Slack's `Retry-After`) while attempts remain and retrying may help;
   * otherwise the job is done and `notification.failSlack` puts a `slack_failed` entry on the incident's timeline.
   * Returns when to retry, or null: plan the next job.
   */
  record(
    event: BrigadeEvent,
    job: string,
    outcome: SlackPostOutcome & { name?: string },
    now: number,
  ): { retryAt: number | null } {
    if (!asksForSlack(event)) return { retryAt: null };
    const incidentId = event.subject?.startsWith("inc_") ? event.subject : null;
    if (incidentId) {
      this.sql.exec(
        "update slack_messages set claimed_until = 0 where incident_id = ?",
        incidentId,
      );
    }
    if (outcome.ok) {
      this.kept(job, incidentId, outcome, now);
      this.doneJob(event.id, job, now);
      return { retryAt: null };
    }
    const attempts = (this.job(event.id, job)?.attempts ?? 0) + 1;
    this.options.log("slack job failed", {
      event: event.id,
      job,
      ...(incidentId ? { incident: incidentId } : {}),
      error: outcome.error,
      attempts,
    });
    if (outcome.retryable && attempts < SLACK_MAX_ATTEMPTS) {
      const backoff = Math.min(SLACK_RETRY_MAX_MS, SLACK_RETRY_FIRST_MS * 2 ** (attempts - 1));
      const retryAt = now + Math.max(backoff, outcome.retryAfterMs ?? 0);
      this.sql.exec(
        `insert into slack_jobs (event_id, job, attempts, retry_at, done, at) values (?, ?, ?, ?, 0, ?)
         on conflict (event_id, job) do update set attempts = excluded.attempts, retry_at = excluded.retry_at`,
        event.id,
        job,
        attempts,
        retryAt,
        now,
      );
      return { retryAt };
    }
    this.doneJob(event.id, job, now, attempts);
    // A token that could not be given back is forgotten anyway: Brigade keeps nothing it does not use.
    if (job.startsWith("revoke:")) {
      this.kept(job, null, { ok: true, channel: "", ts: "" }, now);
      return { retryAt: null };
    }
    if (!incidentId) return { retryAt: null };
    const { shard } = this.options;
    const mutationId = `slackfail:${event.id}:${job}`;
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

  /** Keeps what a job that worked made: the message's `ts`, the channel, that it was archived or revoked. */
  private kept(
    job: string,
    incidentId: string | null,
    outcome: Extract<SlackPostOutcome, { ok: true }> & { name?: string },
    now: number,
  ): void {
    if (job === "message:main" && incidentId) {
      this.sql.exec(
        `insert into slack_messages (incident_id, channel, ts, claimed_until, at) values (?, ?, ?, 0, ?)
         on conflict (incident_id) do update set channel = excluded.channel, ts = excluded.ts, at = excluded.at`,
        incidentId,
        outcome.channel,
        outcome.ts,
        now,
      );
    } else if (job === "message:incident" && incidentId) {
      this.sql.exec(
        "update slack_channels set ts = ?, at = ? where incident_id = ?",
        outcome.ts,
        now,
        incidentId,
      );
    } else if (job === "channel" && incidentId) {
      this.sql.exec(
        `insert into slack_channels (incident_id, channel_id, name, ts, archive_at, archived, at)
         values (?, ?, ?, null, null, 0, ?)
         on conflict (incident_id) do update set channel_id = excluded.channel_id, name = excluded.name`,
        incidentId,
        outcome.channel,
        outcome.name ?? "",
        now,
      );
    } else if (job === "archive" && incidentId) {
      this.sql.exec(
        "update slack_channels set archived = 1, archive_at = null, at = ? where incident_id = ?",
        now,
        incidentId,
      );
    } else if (job.startsWith("revoke:")) {
      const at = Number(job.slice("revoke:".length));
      const kept = this.options.shard.store.scan("slack_revocations").find((row) => row.at === at);
      if (!kept) return;
      const { result } = this.run(
        NOTIFIER_ACTOR,
        "slack.forgetToken",
        { teamId: kept.teamId, at },
        `forget:${kept.teamId}:${at}`,
        now,
        true,
      );
      if (!result.ok && result.error.code !== "not_found") {
        this.options.log("slack token not forgotten", { code: result.error.code });
      }
    }
  }

  /**
   * After an incident's status changed: a closed incident's channel is due to be archived `archiveAfterHours` later
   * (when the workspace archives them), and a reopened one's is kept. Brings the alarm forward for it.
   */
  private scheduleArchive(incident: IncidentRow, connection: SlackRow, now: number): void {
    const channel = this.channel(incident.id);
    if (!channel || channel.archived) return;
    if (isActive(incident.status)) {
      if (channel.archive_at !== null) {
        this.sql.exec(
          "update slack_channels set archive_at = null where incident_id = ?",
          incident.id,
        );
      }
      return;
    }
    const hours = connection.archiveAfterHours ?? null;
    if (hours === null || channel.archive_at !== null) return;
    const at = now + hours * HOUR_MS;
    this.sql.exec(
      "update slack_channels set archive_at = ?, at = ? where incident_id = ?",
      at,
      now,
      incident.id,
    );
    this.options.wake?.(at);
  }

  /**
   * From the shard's alarm: channels due to be archived, each as `slack.archiveDue` (its event goes through the
   * outbox to the notifier, which archives it). Asked again `SLACK_ARCHIVE_REQUEUE_MS` later if nothing archived it.
   */
  archiveDue(now: number): number {
    const due = this.sql
      .exec<{ incident_id: string }>(
        `select incident_id from slack_channels
         where archived = 0 and archive_at is not null and archive_at <= ? and queued_until <= ? limit ?`,
        now,
        now,
        SLACK_ARCHIVE_BATCH,
      )
      .toArray();
    let asked = 0;
    for (const { incident_id: incidentId } of due) {
      // Set first, so one that fails is asked for again later, never in a loop.
      this.sql.exec(
        "update slack_channels set queued_until = ? where incident_id = ?",
        now + SLACK_ARCHIVE_REQUEUE_MS,
        incidentId,
      );
      const { result } = this.run(
        NOTIFIER_ACTOR,
        "slack.archiveDue",
        { incidentId },
        `archive:${incidentId}:${now}`,
        now,
        true,
      );
      if (result.ok) asked++;
      else if (result.error.code === "conflict") {
        // Reopened meanwhile: it keeps its channel.
        this.sql.exec(
          "update slack_channels set archive_at = null where incident_id = ?",
          incidentId,
        );
      } else this.options.log("slack archive not asked for", { code: result.error.code });
    }
    return asked;
  }

  /** When the alarm should next ask for an archive, or null. */
  nextArchiveAt(): number | null {
    const [row] = this.sql
      .exec<{ at: number | null }>(
        `select min(max(archive_at, queued_until)) as at from slack_channels
         where archived = 0 and archive_at is not null`,
      )
      .toArray();
    return row?.at ?? null;
  }

  /** The incident's own channel, if it has one. */
  channelOf(incidentId: string): string | null {
    return this.channel(incidentId)?.channel_id ?? null;
  }

  /** The timeline entry `event` wrote, as the mirror posts it; null for one it does not post. */
  private entry(event: BrigadeEvent): SlackEntryView | null {
    const data = Object(event.data) as Record<string, unknown>;
    const by = this.person(event.actor.id);
    switch (event.type) {
      case "incident.acknowledged":
        return { kind: "ack", by };
      case "incident.status_changed":
        return { kind: "status", by, to: data.to as IncidentStatus };
      case "incident.severity_changed":
        return { kind: "severity", by, to: data.to as Severity };
      case "incident.update_posted": {
        const [inbound] = this.sql
          .exec("select entry_id from slack_inbound where entry_id = ?", String(data.entryId))
          .toArray();
        // Posted from a Slack message: it is in the channel already.
        if (inbound || typeof data.body !== "string") return null;
        return { kind: "update", by, body: data.body };
      }
      case "incident.role_assigned": {
        const id = typeof data.roleId === "string" ? data.roleId : String(data.role);
        return {
          kind: "role",
          by,
          role: { id, name: typeof data.roleName === "string" ? data.roleName : null },
          to: typeof data.to === "string" ? this.person(data.to) : null,
        };
      }
      default:
        return null;
    }
  }

  /** Who an incident's channel invites when it is made: who declared it, its role holders and whoever was paged. */
  private responders(incident: IncidentRow): string[] {
    return [
      incident.declaredBy,
      ...Object.values(incident.roles ?? {}),
      ...(incident.escalation?.pages ?? []).flatMap((page) => page.userIds),
    ];
  }

  /** `userIds` that are members, each once, at most `SLACK_MAX_INVITES`. */
  private members(userIds: string[]): string[] {
    const { store } = this.options.shard;
    return [...new Set(userIds)]
      .filter((id) => store.get("members", id) !== undefined)
      .slice(0, SLACK_MAX_INVITES);
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

  private job(eventId: string, job: string) {
    return this.sql
      .exec<{ attempts: number; retry_at: number; done: number }>(
        "select attempts, retry_at, done from slack_jobs where event_id = ? and job = ?",
        eventId,
        job,
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

  private channel(incidentId: string) {
    return this.sql
      .exec<{ channel_id: string; ts: string | null; archive_at: number | null; archived: number }>(
        "select channel_id, ts, archive_at, archived from slack_channels where incident_id = ?",
        incidentId,
      )
      .toArray()[0];
  }

  private doneJob(eventId: string, job: string, now: number, attempts = 0): void {
    this.sql.exec(
      `insert into slack_jobs (event_id, job, attempts, retry_at, done, at) values (?, ?, ?, 0, 1, ?)
       on conflict (event_id, job) do update set done = 1, retry_at = 0`,
      eventId,
      job,
      attempts,
      now,
    );
  }

  private finish(eventId: string, now: number): void {
    this.sql.exec(
      `insert into slack_events (event_id, attempts, retry_at, done, at) values (?, 0, 0, 1, ?)
       on conflict (event_id) do update set done = 1, retry_at = 0`,
      eventId,
      now,
    );
  }

  private prune(now: number): void {
    try {
      const before = now - LEDGER_RETENTION_MS;
      this.sql.exec("delete from slack_events where at < ?", before);
      this.sql.exec("delete from slack_jobs where at < ?", before);
      this.sql.exec("delete from slack_inbound where at < ?", before);
      // By last use, and never an active incident's: its next change still updates the message it has.
      const { store } = this.options.shard;
      for (const table of ["slack_messages", "slack_channels"] as const) {
        const stale = this.sql
          .exec<{ incident_id: string }>(`select incident_id from ${table} where at < ?`, before)
          .toArray();
        for (const { incident_id } of stale) {
          const incident = store.get("incidents", incident_id);
          if (incident && isActive(incident.status)) continue;
          // A channel still waiting to be archived stays until it is.
          if (table === "slack_channels" && this.channel(incident_id)?.archive_at != null) continue;
          this.sql.exec(`delete from ${table} where incident_id = ?`, incident_id);
        }
      }
      this.sql.exec("delete from slack_commands where at < ?", before);
      this.sql.exec("delete from slack_states where expires_at <= ?", now);
    } catch (error) {
      this.options.log("pruning the slack ledger failed", { error: String(error) });
    }
  }
}

type Code = Extract<SlackActOutcome, { ok: false }>["code"];

/** Short names people type for the built-in roles. */
const ROLE_ALIASES: Record<string, string> = {
  ic: "commander",
  "incident commander": "commander",
  comms: "communications",
  "communications lead": "communications",
  ops: "operations",
  "operations lead": "operations",
};

/** A role's name as typed and as kept, compared without case, accents or punctuation. */
function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function summary(incident: IncidentRow): SlackIncident {
  return { id: incident.id, number: incident.number, title: incident.title };
}

function declared(incident: IncidentRow): SlackActOutcome {
  return { ok: true, did: "declared", incident: summary(incident) };
}

function refused(code: Code): SlackActOutcome & { ok: false } {
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
