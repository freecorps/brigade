import { DurableObject } from "cloudflare:workers";
import type { SlackActOutcome } from "@freecorps/brigade-slack/bridge";
import {
  ACCOUNT_ACTOR,
  AI_ACTOR,
  allows,
  exportChunks,
  fitMemberName,
  isRole,
  MAX_EXPORT_BYTES,
  newId,
  ROLES,
  nextMaintenanceAt,
  STATUS_PAGE_ID,
  TOKENS_ACTOR,
  type Actor,
  type EmailAbout,
  type MemberChange,
  type MutationErrorCode,
  type ExportScope,
  type PostmortemDraftFailure,
  type PostmortemSections,
  type ProbeRegion,
  type Role,
  type StatusLocale,
} from "@freecorps/brigade-schema";
import {
  encode,
  parseClientMessage,
  PING_FRAME,
  PONG_FRAME,
  PROTOCOL_VERSION,
  TOKEN,
  type ServerMessage,
  type SubscriptionChanges,
} from "@freecorps/brigade-sync/protocol";
import {
  readActor,
  readMemberName,
  readResetAt,
  readSessionExpiresAt,
  readSessionId,
  sessionTag,
} from "./actor.ts";
import {
  MEMBER_REPAIR_RETRY_MS,
  Membership,
  type MemberChangeResult,
  type SocketVerdict,
} from "./members.ts";
import { ESCALATION_RETRY_MS, Escalations } from "./escalation.ts";
import {
  Invitations,
  type InvitationEmailPlan,
  type InvitationResult,
  type Invitee,
  type ListedInvitation,
} from "./invitations.ts";
import {
  instanceMonitorCap,
  isProbeRegion,
  MONITOR_TICK_MS,
  Monitoring,
  type MonitorEnv,
} from "./monitors.ts";
import { Mailer, type EmailOutcome, type EmailPlan } from "./mailer.ts";
import { OutboxDrain, type BrigadeEvent } from "./outbox.ts";
import {
  asksForPage,
  Pager,
  type DeadLetterResult,
  type DeviceOutcome,
  type PagePlan,
  type SkippedMember,
} from "./paging.ts";
import type { ProbeReport } from "./probe.ts";
import { Receipts, type ReceiptResult } from "./receipts.ts";
import { AlertIntake, type AlertIntakeResult } from "./alert-intake.ts";
import { SlackDesk, type SlackJobOutcome, type SlackPlan, type SlackShardAction } from "./slack.ts";
import { StatusPublisher, type StatusConfigureResult } from "./status-page.ts";
import { StatusMailer, type StatusEmailPlan, type StatusEmailReport } from "./status-mail.ts";
import { findQuery, Shard, subscriptionChanges } from "./shard.ts";
import {
  WebhookDesk,
  type WebhookEmailPlan,
  type WebhookEventRef,
  type WebhookOutcome,
  type WebhookPlan,
  type WebhookRunName,
  type WebhookRunResult,
} from "./webhooks.ts";
import type { BuiltExport } from "./exports.ts";
import { AI_MODEL, draftSource, type DraftRequestResult } from "./postmortem.ts";
import type { RowChange } from "./store.ts";
import {
  keySeed,
  readRest,
  requestDigest,
  writeRest,
  type RestRead,
  type RestResult,
  type RestWrite,
} from "./rest.ts";

/** How much of an export the shard writes before it yields to other work (`buildExport`). */
const EXPORT_YIELD_BYTES = 256 * 1024;

export interface WorkspaceInfo {
  /** User tables in the object's SQLite database, read with SQL. */
  tables: number;
  /** Size of the object's SQLite database in bytes. */
  databaseSize: number;
}

/**
 * Workspace ids: a workspace's own id (`ws_<ULID>`, the Better Auth organization id), or 1-63 chars of `a-z`,
 * `0-9`, `-`, `_` starting with `a-z0-9` (dev shards such as `demo`, and the tests).
 */
export const WORKSPACE_ID = /^(?:ws_[0-9A-HJKMNP-TV-Z]{26}|[a-z0-9][a-z0-9_-]{0,62})$/;

/**
 * A workspace's own id alone (`ws_<ULID>`, src/auth.ts `authId`): what routes for D1's workspaces accept, so none
 * of them takes a short, guessable dev-shard name.
 */
export const ORGANIZATION_ID = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The header naming one ack from a notification, so a retry of a request whose answer was lost runs it once. Not in
 * src/index.ts: every export of the Worker's entry must be a handler.
 */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/** The client id acks from a notification action run under (`WorkspaceDO.acknowledge`). */
export const NOTIFICATION_CLIENT_ID = "notification";

/** An API token the shard's own list no longer backs (revoked, expired, or not this workspace's: RFC 0014). */
export type TokenRefused = { ok: false; code: "unauthenticated" };
const TOKEN_REFUSED: TokenRefused = { ok: false, code: "unauthenticated" };

/** What `WorkspaceDO.acknowledge` did. */
export type AckResult =
  | { ok: true }
  | { ok: false; code: MutationErrorCode | "not_a_member" }
  | TokenRefused;

/** Set by the Worker on the upgrade it forwards; the shard records it on first use. */
export const WORKSPACE_HEADER = "Brigade-Workspace";

/** Subscriptions per socket; each lives in the socket's attachment. */
export const MAX_SUBSCRIPTIONS = 32;
/**
 * Attachment budget, well under the runtime's 16 KiB limit. Measured approximately, as the UTF-8 length of the
 * state's JSON: the runtime stores the structured-clone encoding, whose size differs a little, so the margin
 * covers it.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024;

/** WebSocket close codes the shard uses. */
export const CLOSE_PROTOCOL_ERROR = 1002;
/** A member removed from the workspace: their client reconnects and the upgrade refuses them (403). */
export const CLOSE_POLICY_VIOLATION = 1008;
export const CLOSE_INTERNAL_ERROR = 1011;
export const CLOSE_SERVICE_RESTART = 1012;

type Subscription = {
  subId: string;
  query: string;
  /** Validated args, as the query's validator returned them. */
  args: unknown;
};

/**
 * Per-socket state, kept in the socket's attachment so it survives hibernation: the shard holds nothing about a
 * socket in memory.
 */
export type SocketState = {
  workspace: string;
  actor: Actor;
  /** Set by `hello`; every other frame needs it. */
  clientId: string | null;
  /** An array, not an object keyed by subId: `__proto__` is a valid subId. */
  subs: Subscription[];
  /** Set when the shard closes the socket: frames already queued behind the close are dropped unread. */
  closed?: true;
  /**
   * When the shard accepted it: a reconcile closes it when its member's password was reset after (`resetAt`). Absent
   * on sockets accepted before it was recorded, which count as older than any reset.
   */
  openedAt?: number;
  /**
   * When the session it was opened with expires: the shard closes it then (`expireSockets`), since Better Auth
   * deletes an expired session, and so fires its session hook, only when someone next presents it. Absent on sockets
   * accepted before it was recorded and on the dev actor's.
   */
  expiresAt?: number;
};

/**
 * How long a shard remembers a session that ended (`endSession`): longer than an upgrade the Worker authenticated
 * before the session ended can take to reach the shard, so that upgrade is refused rather than accepted with a
 * session that no longer exists (RFC 0004 "Session revocation").
 */
export const ENDED_SESSION_MS = 10 * 60 * 1000;

/**
 * What `registerDevice` answers: the code is `device.register`'s, `not_a_member`/`not_found` as for an ack, or
 * `unavailable` (D1 could not be read: tried again).
 */
export type DeviceRegisterResult =
  | { ok: true }
  | { ok: false; code: MutationErrorCode | "not_a_member" | "not_found" | "unavailable" };

/** The client id the phone's registrations over HTTP run under (`WorkspaceDO.registerDevice`). */
export const DEVICES_CLIENT_ID = "devices";

/** A session that ended and that this shard has yet to act on, as D1's `session_end` keeps it (src/session-end.ts). */
export type EndedSession = {
  userId: string;
  sessionId: string;
  deviceId?: string;
  /** When it ended: a device registered after it (the member signed in again) is not dropped. */
  endedAt?: number;
};

/**
 * What `signOutUser` did. With `takeOver`, `paused`: the names of the monitors it paused; `revoked`: how many heartbeat
 * URLs stopped working; `sources`: how many alert source URLs; `routes`: how many alert routes the account created were
 * disabled. All absent when it took nothing over (another member is here after all).
 */
export type SignOutResult =
  | { ok: true; paused?: string[]; revoked?: number; sources?: number; routes?: number }
  | { ok: false; code: "not_found" };

/** Largest frame the shard reads at all, to salvage the id of a refused `subscribe` or `mutate`. */
const MAX_SALVAGE_LENGTH = 1024 * 1024;

/**
 * Shard for one workspace (RFC 0002, RFC 0004): the incident index and the sync endpoint. Sockets use the
 * Hibernation API; every handler is synchronous, so a socket's frames are handled strictly in arrival order and
 * frames from different sockets never interleave.
 */
/** How long the alarm waits on a due member repair before it lets the repair finish in the background. */
export const REPAIR_BUDGET_MS = 5 * 1000;
/** How long the alarm waits on a status page push (RFC 0012) before it lets the push finish in the background. */
export const STATUS_PUSH_BUDGET_MS = 5 * 1000;
/** The soonest the alarm comes back for webhook retries after it ran: a backlog past one redrive waits this long. */
export const WEBHOOK_REDRIVE_MIN_MS = 1000;
/**
 * The least the alarm waits on a status page push when an escalation level is due sooner than
 * `STATUS_PUSH_BUDGET_MS`, so a level due at once (or one whose timer failed) still leaves the push a moment.
 */
export const STATUS_PUSH_MIN_BUDGET_MS = 100;

export class WorkspaceDO extends DurableObject<Env> {
  /** An export is being built (`buildExport`): in memory only, so a reset frees it. */
  private exporting = false;
  /** `REPAIR_BUDGET_MS`; a field so tests can shorten it. */
  private repairBudgetMs = REPAIR_BUDGET_MS;
  /** `STATUS_PUSH_BUDGET_MS`; a field so tests can shorten it. */
  private statusBudgetMs = STATUS_PUSH_BUDGET_MS;
  private readonly shard: Shard;
  private readonly monitoring: Monitoring;
  private readonly alerts: AlertIntake;
  private readonly drain: OutboxDrain;
  private readonly drainPaused: boolean;
  private readonly pager: Pager;
  private readonly receipts: Receipts;
  private readonly mailer: Mailer;
  private readonly slack: SlackDesk;
  private readonly webhooks: WebhookDesk;
  private readonly escalations: Escalations;
  private readonly membership: Membership;
  private readonly invitations: Invitations;
  private readonly status: StatusPublisher;
  private readonly statusMail: StatusMailer;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The sync heartbeat (RFC 0004 "Heartbeat"): the runtime answers a client's ping on every socket itself,
    // without waking the object or running `webSocketMessage`. Set on every wake; it is cheap.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME));
    const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
    // Sessions that ended lately (`endSession`), so an upgrade with one is refused.
    ctx.storage.sql.exec(
      "create table if not exists ended_session (id text primary key, until integer not null) without rowid",
    );
    // Runs on every wake from hibernation: only `create … if not exists`.
    this.shard = new Shard(ctx.storage, {
      shard: "workspace",
      randomBytes,
      limits: { monitors: instanceMonitorCap(env as Env & MonitorEnv) },
      log: (message, fields) => this.log(message, fields),
      onOutbox: () => {
        this.armDrain();
        this.armStatus();
        this.armMaintenance();
        // Activity: the alarm reconciles the member list with D1 a while after it (src/members.ts `periodic`).
        // Undefined only while the constructor runs, before anything commits.
        this.membership?.touched(Date.now());
      },
    });
    // TEST ONLY: the API's own tests (vite.config.ts) read events from the outbox, so they pause the drain; the
    // drain's tests drive it directly. No deployed environment sets it (apps/web test/worker-config.test.ts).
    this.drainPaused = Reflect.get(env, "OUTBOX_DRAIN") === "paused";
    this.drain = new OutboxDrain(
      ctx.storage.sql,
      async (messages) => {
        await env.EVENTS.sendBatch(messages);
      },
      (message, fields) => this.log(message, fields),
    );
    this.pager = new Pager({
      storage: ctx.storage,
      shard: this.shard,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      wake: (at) => this.wake(at, "escalation"),
    });
    this.receipts = new Receipts({
      storage: ctx.storage,
      shard: this.shard,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    // After the pager: it reads the page ledger the pager creates.
    this.mailer = new Mailer({
      storage: ctx.storage,
      shard: this.shard,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    this.slack = new SlackDesk({
      storage: ctx.storage,
      shard: this.shard,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      wake: (at) => this.wake(at, "slack archive"),
    });
    this.webhooks = new WebhookDesk({
      storage: ctx.storage,
      shard: this.shard,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      wake: (at) => this.wake(at, "webhook retry"),
    });
    this.escalations = new Escalations({
      shard: this.shard,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    this.monitoring = new Monitoring({
      storage: ctx.storage,
      shard: this.shard,
      probes: env.PROBE,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    this.alerts = new AlertIntake({
      shard: this.shard,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      allow: (sourceId) => this.alertAllowed(sourceId),
    });
    this.membership = new Membership({
      db: env.DB,
      shard: this.shard,
      randomBytes,
      sql: ctx.storage.sql,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      closeSockets: (judge) => this.closeSockets(judge),
      wake: (at) => this.wake(at, "member repair"),
      repairMore: (workspaceId) => this.invitations.repair(workspaceId),
    });
    this.invitations = new Invitations({
      db: env.DB,
      shard: this.shard,
      sql: ctx.storage.sql,
      membership: this.membership,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
    });
    // The public status page's snapshot (RFC 0012): pushed to KV from the alarm after every change to it.
    this.status = new StatusPublisher({
      shard: this.shard,
      sql: ctx.storage.sql,
      kv: env.STATUS,
      db: env.DB,
      randomBytes,
      log: (message, fields) => this.log(message, fields),
      committed: (version, changes) => this.broadcast(version, changes, undefined),
      wake: (at) => this.wake(at, "status page push"),
    });
    // The status page's emails (RFC 0012 "Email subscriptions"): its ledger; the addresses are in D1.
    this.statusMail = new StatusMailer({
      shard: this.shard,
      sql: ctx.storage.sql,
      log: (message, fields) => this.log(message, fields),
      carryOn: (eventId) => this.serverMutation("statusEmail.continue", { eventId }),
    });
    // Likewise a snapshot still to push (a failed push, a restart before the alarm ran), and a maintenance window that
    // starts or ends.
    this.armStatus();
    this.armMaintenance();
    // Events left in the outbox (an alarm that failed to arm, a restart) arm the drain again whenever the object
    // wakes, so a backlog never waits for an unrelated change.
    try {
      if (!this.drainPaused && this.drain.backlog() > 0) this.armDrain();
    } catch (error) {
      this.log("arming the outbox drain failed", { error: String(error) });
    }
    // A running escalation's next level (RFC 0006 "Who is paged"): stored with its run, so a restart or an eviction
    // mid-escalation resumes on time, or at once if it came due meanwhile.
    try {
      const escalationAt = this.escalations.nextAt();
      if (escalationAt !== null) this.wake(escalationAt, "escalation");
    } catch (error) {
      this.log("arming the escalation failed", { error: String(error) });
    }
    // Likewise a webhook delivery due again (src/webhooks.ts `redrive`).
    try {
      const webhookAt = this.webhooks.nextAt();
      if (webhookAt !== null) this.wake(webhookAt, "webhook retry");
    } catch (error) {
      this.log("arming the webhook retry failed", { error: String(error) });
    }
    // Likewise a member repair whose alarm failed to arm.
    try {
      const repairAt = this.membership.repairAt();
      if (repairAt !== null) this.wake(repairAt, "member repair");
    } catch (error) {
      this.log("arming the member repair failed", { error: String(error) });
    }
    // Likewise a lost page queued to be paged again (src/paging.ts `replayDue`).
    try {
      const replayAt = this.pager.replayAt();
      if (replayAt !== null) this.wake(replayAt, "page again");
    } catch (error) {
      this.log("arming the page again failed", { error: String(error) });
    }
    // Likewise a push held back behind a page (src/paging.ts `releaseDue`).
    try {
      const releaseAt = this.pager.releaseAt(Date.now());
      if (releaseAt !== null) this.wake(releaseAt, "held push");
    } catch (error) {
      this.log("arming the release of held pushes failed", { error: String(error) });
    }
  }

  info(): WorkspaceInfo {
    const { sql } = this.ctx.storage;
    // `sqlite_version()` is not authorized in Durable Object SQLite, so read the catalog instead.
    // Skip internal tables so every runtime reports the same: Cloudflare's `_cf_*`, SQLite's
    // `sqlite_sequence` and the `__miniflare_do_name` table that local Miniflare adds.
    const { tables } = sql
      .exec<{ tables: number }>(
        `select count(*) as tables from sqlite_master
         where type = 'table'
           and name not like '!_cf!_%' escape '!'
           and name not like '!_!_%' escape '!'
           and name != 'sqlite_sequence'`,
      )
      .one();
    return { tables, databaseSize: sql.databaseSize };
  }

  /**
   * The restore hook: every path that restores this object's storage (point-in-time recovery, importing a
   * nightly export; RFC 0004 "Shard server", open question Q3) calls this right after the restore, before the
   * shard is reachable again. It writes a new epoch and closes every open socket, so each client reconnects and
   * gets a snapshot instead of resuming from versions the restore reused. Returns the new epoch.
   */
  rotateEpoch(): string {
    const epoch = this.shard.rotateEpoch();
    this.log("epoch rotated", { epoch });
    for (const ws of this.ctx.getWebSockets()) close(ws, CLOSE_SERVICE_RESTART, "epoch rotated");
    return epoch;
  }

  /**
   * Runs `workspace.create` once Better Auth has created the workspace (RPC from the API Worker): records the
   * shard's workspace and writes `workspace.created` to the outbox, like any mutation (RFC 0005). Idempotent: a
   * second call finds the row and changes nothing.
   */
  provision(workspace: { id: string; name: string }, actor: Actor): { ok: boolean; code?: string } {
    if (!this.shard.claim(workspace.id)) {
      this.log("shard serves another workspace", { workspace: workspace.id });
      return { ok: false, code: "internal" };
    }
    const now = Date.now();
    // De-duplicated like a socket's mutation: a retry gets the stored result instead of running again.
    const stored = this.shard.storedResult(actor.id, "api", "provision", now);
    const { result, changes } = stored
      ? { result: stored, changes: [] }
      : this.shard.mutate({
          clientId: "api",
          mutationId: "provision",
          actor,
          name: "workspace.create",
          args: workspace,
          now,
          internal: true,
        });
    if (result.ok) {
      if (!stored) this.broadcast(result.version, changes, undefined);
      return { ok: true };
    }
    // Already provisioned (a retry): fine.
    if (result.error.code === "conflict") return { ok: true };
    return { ok: false, code: result.error.code };
  }

  /**
   * A member change from `PATCH`/`DELETE /workspaces/:id/members/:userId` (RPC from the API Worker, which checked
   * the session): `actorId` changes `targetId`'s role, removes them, or leaves (`targetId` is themselves). D1 first,
   * then this shard's copy and the outbox, then the target's sockets close (src/members.ts). A shard that serves
   * another workspace, or none yet, answers `not_found`.
   */
  changeMember(
    workspaceId: string,
    actorId: string,
    targetId: string,
    change: MemberChange,
    token?: Actor,
  ): Promise<MemberChangeResult | TokenRefused> {
    if (this.shard.workspace() !== workspaceId) {
      return Promise.resolve({ ok: false, code: "not_found" });
    }
    if (token && !this.tokenActor(token)) return Promise.resolve(TOKEN_REFUSED);
    return this.membership.change(workspaceId, actorId, targetId, change, token);
  }

  /**
   * Invitations (RPCs from `/workspaces/:id/invitations` and `/invitations/:id`, which checked the session and, for
   * the first, that the caller is a member): D1 first, then this shard's event (src/invitations.ts). A shard that
   * serves another workspace, or none yet, answers `not_found`.
   */
  invite(
    workspaceId: string,
    actorId: string,
    email: string,
    role: Role,
    origin: string | null,
    token?: Actor,
  ): Promise<InvitationResult<{ invitation: ListedInvitation }> | TokenRefused> {
    if (this.shard.workspace() !== workspaceId) return notFound();
    if (token && !this.tokenActor(token)) return Promise.resolve(TOKEN_REFUSED);
    return this.invitations.invite(workspaceId, actorId, email, role, origin, token);
  }

  resendInvitation(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    origin: string | null,
    token?: Actor,
  ): Promise<InvitationResult<{ expiresAt: number }> | TokenRefused> {
    if (this.shard.workspace() !== workspaceId) return notFound();
    if (token && !this.tokenActor(token)) return Promise.resolve(TOKEN_REFUSED);
    return this.invitations.resend(workspaceId, actorId, invitationId, origin, token);
  }

  revokeInvitation(
    workspaceId: string,
    actorId: string,
    invitationId: string,
    token?: Actor,
  ): Promise<InvitationResult | TokenRefused> {
    if (this.shard.workspace() !== workspaceId) return notFound();
    if (token && !this.tokenActor(token)) return Promise.resolve(TOKEN_REFUSED);
    return this.invitations.revoke(workspaceId, actorId, invitationId, token);
  }

  acceptInvitation(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
  ): Promise<InvitationResult<{ role: Role }>> {
    if (this.shard.workspace() !== workspaceId) return notFound();
    return this.invitations.accept(workspaceId, invitationId, invitee);
  }

  declineInvitation(
    workspaceId: string,
    invitationId: string,
    invitee: Invitee,
  ): Promise<InvitationResult> {
    if (this.shard.workspace() !== workspaceId) return notFound();
    return this.invitations.decline(workspaceId, invitationId, invitee);
  }

  /** The email a `member.invited` asks for (RPC from the queue consumer, src/notify-invite.ts). */
  planInvitationEmail(event: BrigadeEvent): InvitationEmailPlan {
    const data = event.data as { invitationId?: unknown; send?: unknown } | null;
    if (
      this.shard.workspace() !== event.workspaceId ||
      event.type !== "member.invited" ||
      typeof data?.invitationId !== "string" ||
      typeof data.send !== "number"
    ) {
      return { send: false, reason: "nothing" };
    }
    return this.invitations.planEmail(data.invitationId, data.send, Date.now());
  }

  /** What an invitation email's send did (RPC from the queue consumer). */
  recordInvitationEmail(event: BrigadeEvent, key: string, done: boolean): void {
    if (this.shard.workspace() !== event.workspaceId) return;
    this.invitations.recordEmail(key, done);
  }

  /**
   * Sets up or changes the status page (RPC from `PUT /workspaces/:id/status-page`, which checked the session or API
   * token and read the role in D1): see `StatusPublisher.configure`. An API token the shard no longer backs is refused
   * like one the Worker refused; a member removed within the tombstone as their sync upgrade would be; a shard that
   * serves another workspace, or none yet, answers `not_found`.
   */
  async configureStatusPage(
    workspaceId: string,
    actor: Actor,
    args: unknown,
  ): Promise<StatusConfigureResult | { ok: false; code: "not_a_member" } | TokenRefused> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    if (await this.membership.refuses(workspaceId, acting.by ?? acting.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    return this.status.configure(workspaceId, acting, args);
  }

  /**
   * A change to a status page subscription (RPC from src/status-subscribers.ts, after the subscriber's row changed in
   * D1): its event through the outbox, with the subscriber's id and never the address. A visitor's change runs as
   * `ACCOUNT_ACTOR`; an owner's or admin's deletion as them (the route checked `status:manage` in D1).
   */
  statusSubscription(
    workspaceId: string,
    change:
      | { action: "request"; subscriberId: string; send: number }
      | { action: "confirm"; subscriberId: string }
      | { action: "remove"; subscriberId: string; reason: "unsubscribed" | "deleted" | "expired" },
    actor: Actor = ACCOUNT_ACTOR,
  ): { ok: true } | { ok: false; code: string } {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    // A subscriber is confirmed and removed once: the route runs this before its D1 write and runs it again when
    // asked again after a failure, so a second call only says it is done.
    const once = change.action === "request" ? null : `${change.action}:${change.subscriberId}`;
    if (once !== null && this.statusMail.seen(once)) return { ok: true };
    const { action, ...args } = change;
    const now = Date.now();
    const { result, changes } = this.shard.mutate({
      clientId: "status-subscribers",
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor,
      name: `statusSubscriber.${action}`,
      args,
      now,
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    if (once !== null) this.statusMail.remember(once, now);
    this.broadcast(result.version, changes, undefined);
    return { ok: true };
  }

  /**
   * Pending subscribers whose confirmation link expired (RPC from the API's cron, src/status-subscribers.ts
   * `sweepSubscribers`, before it deletes their rows): a `status_subscriber.removed` event each, `expired`.
   */
  expireStatusSubscribers(
    workspaceId: string,
    subscriberIds: string[],
  ): { ok: true } | { ok: false; code: string } {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    for (const subscriberId of subscriberIds) {
      const result = this.statusSubscription(workspaceId, {
        action: "remove",
        subscriberId,
        reason: "expired",
      });
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  /** What a status page email event asks for (RPC from the queue consumer, src/notify-status.ts). */
  planStatusEmail(event: BrigadeEvent): StatusEmailPlan {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "nothing" };
    return this.statusMail.plan(event, Date.now());
  }

  /** What a batch of status page emails did (RPC from the queue consumer). */
  recordStatusEmail(
    event: BrigadeEvent,
    key: string,
    report: StatusEmailReport,
  ): { retry: boolean } {
    if (this.shard.workspace() !== event.workspaceId) return { retry: false };
    return this.statusMail.record(key, report, Date.now());
  }

  /**
   * `incident.ack` from a notification action (RPC from `POST /workspaces/:id/incidents/:incidentId/ack`, which
   * checked the session and read the member's role in D1; RFC 0004 "Clients"). The same named mutation, RBAC and
   * outbox event as an ack over Brigade Sync; it runs as a client mutation (never `internal`), from client id
   * `notification`, de-duplicated by the incident and the request's key like a socket's mutation, and its patch
   * reaches every open socket. It stops the incident's escalation run, as any ack does. A member removed within the
   * tombstone is refused as their sync upgrade would be (`not_a_member`); a shard that serves another workspace, or
   * none yet, answers `not_found`.
   */
  async acknowledge(
    workspaceId: string,
    actor: Actor,
    incidentId: string,
    mutationId: string,
  ): Promise<AckResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    actor = acting;
    if (await this.membership.refuses(workspaceId, actor.by ?? actor.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    const now = Date.now();
    // The key names a tap on one incident's page: the same key for another incident is another ack.
    const id = `${incidentId}:${mutationId}`;
    const stored = this.shard.storedResult(actor.id, NOTIFICATION_CLIENT_ID, id, now);
    const { result, changes } = stored
      ? { result: stored, changes: [] }
      : this.shard.mutate({
          clientId: NOTIFICATION_CLIENT_ID,
          mutationId: id,
          actor,
          name: "incident.ack",
          args: { id: incidentId },
          now,
        });
    if (!result.ok) return { ok: false, code: result.error.code };
    if (!stored) this.broadcast(result.version, changes, undefined);
    return { ok: true };
  }

  /**
   * A read of the public HTTP API's incident and catalog routes (RPC from src/rest-routes.ts, which checked the
   * session or the API token and read the member's role in D1): see `readRest`. An API token the shard no longer backs
   * is refused like one the Worker refused; a member removed within the tombstone as their sync upgrade would be.
   */
  async restRead(workspaceId: string, actor: Actor, read: RestRead): Promise<RestResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    if (await this.membership.refuses(workspaceId, acting.by ?? acting.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    return readRest(this.shard, acting, read);
  }

  /**
   * A write of the public HTTP API's incident and catalog routes (RPC from src/rest-routes.ts): the named mutations
   * the dashboard sends over sync, run as the member or token as a client mutation (never `internal`), de-duplicated
   * by the request's `Idempotency-Key`, their patches to every open socket (`writeRest`). Declaring pages as any
   * declare does: `incident.declared` through the outbox.
   */
  async restWrite(
    workspaceId: string,
    actor: Actor,
    write: RestWrite,
    key: string,
  ): Promise<RestResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    if (await this.membership.refuses(workspaceId, acting.by ?? acting.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    const [seed, request] = await Promise.all([
      keySeed(write.kind, acting.id, key),
      requestDigest(write),
    ]);
    return writeRest(
      {
        shard: this.shard,
        actor: acting,
        key,
        seed,
        request,
        now: Date.now(),
        committed: (version, changes) => this.broadcast(version, changes, undefined),
      },
      write,
    );
  }

  /**
   * Asks for an AI draft of the incident's postmortem (RPC from `POST
   * /workspaces/:id/incidents/:incidentId/postmortem/draft`, which checked the session or API token, the role and
   * that the deployment has the `AI` binding): runs the server-only `postmortem.requestDraft` as the member (RBAC, the
   * rate limit, its event) and hands back what the model may read (src/postmortem.ts). The language is the status
   * page's when the workspace has one, else `locale`, the asker's.
   */
  async requestPostmortemDraft(
    workspaceId: string,
    actor: Actor,
    incidentId: string,
    locale: StatusLocale,
  ): Promise<DraftRequestResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    actor = acting;
    if (await this.membership.refuses(workspaceId, actor.by ?? actor.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    // What the model reads comes first: an incident it cannot read is refused before the draft is pending and the
    // rate limit counts it. The mutation writes nothing `draftSource` reads, and nothing runs between the two.
    const language = this.shard.store.get("status_page", STATUS_PAGE_ID)?.locale ?? locale;
    const source = draftSource(this.shard.store, incidentId, language);
    if (!source) return { ok: false, code: "not_found" };
    const now = Date.now();
    const requestId = newId("drf", now, (length) => crypto.getRandomValues(new Uint8Array(length)));
    const { result, changes } = this.shard.mutate({
      clientId: "api",
      mutationId: requestId,
      actor,
      name: "postmortem.requestDraft",
      args: { id: incidentId, requestId },
      now,
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    this.broadcast(result.version, changes, undefined);
    return { ok: true, requestId, source };
  }

  /** Writes the model's draft, or why there is none, as `sys_ai` (RPC from the Worker's `waitUntil`). */
  finishPostmortemDraft(
    workspaceId: string,
    incidentId: string,
    requestId: string,
    outcome:
      | { ok: true; sections: PostmortemSections }
      | { ok: false; reason: PostmortemDraftFailure },
  ): { ok: boolean; code?: string } {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const run = (name: string, args: unknown) =>
      this.shard.mutate({
        clientId: "ai",
        mutationId: `${requestId}:${name}`,
        actor: AI_ACTOR,
        name,
        args,
        now: Date.now(),
        internal: true,
      });
    let { result, changes } = outcome.ok
      ? run("postmortem.writeDraft", {
          id: incidentId,
          requestId,
          sections: outcome.sections,
          model: AI_MODEL,
        })
      : run("postmortem.failDraft", { id: incidentId, requestId, reason: outcome.reason });
    // A draft the text rules still refuse is a failed draft, not a pending one.
    if (!result.ok && outcome.ok && result.error.code === "invalid_args") {
      this.log("an AI draft was refused", { issues: result.error.issues });
      ({ result, changes } = run("postmortem.failDraft", {
        id: incidentId,
        requestId,
        reason: "failed",
      }));
    }
    if (!result.ok) return { ok: false, code: result.error.code };
    this.broadcast(result.version, changes, undefined);
    return { ok: true };
  }

  /**
   * The export file for `scope` (RPC from `POST /workspaces/:id/exports`, which checked the session or API token and
   * that the caller may export): takes a slot of the hourly limit (`export.reserve`), then writes the file from this shard's
   * rows as UTF-8 parts, one incident at a time, counting the bytes and stopping at `MAX_EXPORT_BYTES` (`too_large`)
   * without ever holding the whole text. It yields between parts, so a large export never holds the shard: alarms
   * (escalations) and other requests run in between. The Worker streams the parts into R2; nothing else is written
   * until `recordExport`.
   */
  async buildExport(workspaceId: string, actor: Actor, scope: ExportScope): Promise<BuiltExport> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    actor = acting;
    if (await this.membership.refuses(workspaceId, actor.by ?? actor.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    if (!isRole(actor.role) || !allows(actor, "data:export"))
      return { ok: false, code: "forbidden" };
    // One build at a time: each holds up to MAX_EXPORT_BYTES of parts in this isolate, and yields, so several at once
    // could outgrow its memory and reset the shard that pages. A second one is told to try again shortly.
    if (this.exporting) return { ok: false, code: "rate_limited" };
    const now = Date.now();
    const plan = exportChunks(this.shard.store, scope, now);
    if (!plan.ok) return plan;
    const id = newId("exp", now, (length) => crypto.getRandomValues(new Uint8Array(length)));
    const { result } = this.shard.mutate({
      clientId: "api",
      mutationId: id,
      actor,
      name: "export.reserve",
      args: { id },
      now,
      internal: true,
    });
    if (!result.ok) {
      const code = result.error.code;
      return { ok: false, code: code === "limit_reached" ? "rate_limited" : code };
    }
    this.exporting = true;
    try {
      const encoder = new TextEncoder();
      const parts: Uint8Array[] = [];
      let bytes = 0;
      let sinceYield = 0;
      let yielded = false;
      for (let next = plan.chunks.next(); !next.done; next = plan.chunks.next(yielded)) {
        yielded = false;
        const part = encoder.encode(next.value);
        bytes += part.byteLength;
        if (bytes > MAX_EXPORT_BYTES) return { ok: false, code: "too_large" };
        parts.push(part);
        sinceYield += part.byteLength;
        if (sinceYield >= EXPORT_YIELD_BYTES) {
          sinceYield = 0;
          await new Promise((resolve) => setTimeout(resolve, 0));
          yielded = true;
        }
      }
      return { ok: true, id, parts, bytes, incidents: plan.incidents };
    } finally {
      this.exporting = false;
    }
  }

  /** Records an export the Worker wrote to R2 (`export.record`, as the member), so it is listed and an event. */
  recordExport(
    workspaceId: string,
    actor: Actor,
    args: { id: string; scope: ExportScope; incidents: number; bytes: number },
  ): { ok: boolean; code?: string } {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const { result, changes } = this.shard.mutate({
      clientId: "api",
      mutationId: args.id,
      actor,
      name: "export.record",
      args,
      now: Date.now(),
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    this.broadcast(result.version, changes, undefined);
    return { ok: true };
  }

  /**
   * A leave sent again by someone D1 no longer has (RPC from the API Worker, which checked that): finishes it when
   * this shard still has their copy or a device, and answers `not_found` otherwise, without reading D1.
   */
  finishLeave(workspaceId: string, userId: string): Promise<MemberChangeResult> {
    if (this.shard.workspace() !== workspaceId) {
      return Promise.resolve({ ok: false, code: "not_found" });
    }
    return this.membership.finishLeave(workspaceId, userId);
  }

  /**
   * After `userId`'s password was reset (RPC from the API Worker's Better Auth hook, RFC 0002 "Auth"): stops paging
   * their devices here (`device.signOut` as `ACCOUNT_ACTOR`, a `device.unregistered` for each) and closes their open
   * sockets, which then reconnect with no session and are refused. Better Auth has already deleted every session, so
   * this is what keeps a phone or a socket of whoever held the account before from going on as them. With `takeOver`
   * (the owner of the address took back an account someone else signed up with, and it is the only member here),
   * also pauses every monitor and revokes every heartbeat and alert source URL (`monitor.takeOver`,
   * `alertSource.takeOver`), so whoever set them up cannot page
   * the owner through them; answers the names of the monitors it paused and how many heartbeat URLs it revoked. The
   * shard checks its own member list again first: with anyone else in it, nothing is taken over. Nothing to change
   * is fine. A shard that serves another workspace, or none yet, answers `not_found`.
   *
   * The sockets close whatever happens. A storage failure throws, after arming the member repair: its reconcile
   * drops every device registered before D1's `user.passwordResetAt` (`member.reconcile`), so the phone stops being
   * paged even if the Worker's retries fail too.
   */
  signOutUser(
    workspaceId: string,
    userId: string,
    options: { takeOver?: boolean } = {},
  ): SignOutResult {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    try {
      this.serverMutation("device.signOut", { userId });
      // The Worker counted the members in D1 a moment ago; someone who joined since may have opened Brigade here.
      // Their monitors are not the account's to pause.
      const others = this.shard.store.scan("members").some((member) => member.id !== userId);
      if (!options.takeOver || others) return { ok: true };
      // Random bytes, not the hash of a token: no heartbeat URL matches it, so every one is revoked.
      const tokenHash = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      // Alert source URLs (RFC 0005 "Alert sources"): they page like a heartbeat does. And the routes the account
      // created, which could drop or suppress what the owner needs paged; what they kept quiet is routed again. Before
      // the monitors: a retry after this step failed must still find every monitor to name as paused. Counted so a
      // retry after it succeeded counts the same (the routes it disabled then are still the account's).
      const sources = this.shard.store.scan("alert_source_secrets").length;
      const routes = this.shard.store
        .scan("alert_routes")
        .filter(
          (route) =>
            route.createdBy === userId && (!route.disabled || route.disabled === "takeover"),
        ).length;
      this.serverMutation("alertSource.takeOver", { tokenHash, userId });
      if (routes > 0) this.alerts.reroute();
      const paused = this.shard.store
        .scan("monitors")
        .filter((monitor) => !monitor.paused)
        .map((monitor) => monitor.name);
      const revoked = this.shard.store.scan("heartbeats").length;
      this.serverMutation("monitor.takeOver", { tokenHash });
      return { ok: true, paused, revoked, sources, routes };
    } catch (error) {
      this.membership.armRepair(Date.now());
      throw error;
    } finally {
      this.closeSockets((actor) =>
        actor.kind === "user" && actor.id === userId ? "signed_out" : undefined,
      );
    }
  }

  /**
   * After a Better Auth session of `userId` ended (sign-out, a revoked or expired session; RPC from the API Worker's
   * session hook or its sweep of D1's `session_end`, RFC 0004 "Session revocation"): remembers it for
   * `ENDED_SESSION_MS`, so an upgrade the Worker authenticated with it just before is refused, and closes the sockets
   * opened with it (`1012`; they reconnect without a session and are refused). `deviceId`: the phone signed out on
   * names itself, and comes off this workspace too (`device.signOut`, only if last registered before `endedAt`, so a
   * member who signed in again on it since keeps it), since the app takes it off only the workspace it has open (RFC
   * 0006 "Device registration"). The sockets close whatever happens; a storage failure throws, and the Worker tries
   * again. A shard that serves another workspace, or none yet, answers `not_found`.
   */
  endSession(
    workspaceId: string,
    session: EndedSession,
  ): { ok: true } | { ok: false; code: "not_found" } {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    try {
      this.endedSession(session);
      return { ok: true };
    } finally {
      this.closeSession(session.sessionId);
    }
  }

  /** `endSession`'s storage half. Throws on a storage failure. */
  private endedSession(session: EndedSession): void {
    const now = Date.now();
    const { sql } = this.ctx.storage;
    sql.exec("delete from ended_session where until <= ?", now);
    sql.exec(
      "insert into ended_session (id, until) values (?, ?) on conflict (id) do update set until = excluded.until",
      session.sessionId,
      now + ENDED_SESSION_MS,
    );
    if (session.deviceId !== undefined) {
      this.serverMutation("device.signOut", {
        userId: session.userId,
        deviceId: session.deviceId,
        before: session.endedAt ?? now,
      });
    }
  }

  private closeSession(sessionId: string): void {
    for (const ws of this.ctx.getWebSockets(sessionTag(sessionId))) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (state?.closed) continue;
      close(ws, CLOSE_SERVICE_RESTART, "signed out");
    }
  }

  /** Whether `sessionId` ended within `ENDED_SESSION_MS`. A storage failure reads as no: the Worker's check stands. */
  private sessionEnded(sessionId: string): boolean {
    try {
      return (
        this.ctx.storage.sql
          .exec("select 1 from ended_session where id = ? and until > ?", sessionId, Date.now())
          .toArray().length > 0
      );
    } catch (error) {
      this.log("reading the ended sessions failed", { error });
      return false;
    }
  }

  /**
   * Acts on the sessions D1's `session_end` still lists for this workspace (src/session-end.ts): ended sessions whose
   * own `endSession` call never got through (the shard was unreachable for every try). Run before a phone registers
   * here, after every sync upgrade, and by the Worker's sweep. Deletes each row it acted on. A shard that serves
   * another workspace, or none, has nothing to act on: it deletes the rows, so the sweep never comes back to them.
   * False when D1 or the shard failed (logged); never throws.
   */
  async catchUpSessionEnds(workspaceId: string): Promise<boolean> {
    if (this.shard.workspace() !== workspaceId) {
      try {
        await this.env.DB.prepare(`delete from session_end where "workspaceId" = ?`)
          .bind(workspaceId)
          .run();
        return true;
      } catch (error) {
        this.log("deleting the sessions to end of no workspace failed", { error });
        return false;
      }
    }
    let rows: { sessionId: string; userId: string; deviceId: string | null; endedAt: number }[];
    try {
      ({ results: rows } = await this.env.DB.prepare(
        `select "sessionId", "userId", "deviceId", "endedAt" from session_end where "workspaceId" = ?
         order by "endedAt" limit 100`,
      )
        .bind(workspaceId)
        .all());
    } catch (error) {
      this.log("reading the sessions to end failed", { error });
      return false;
    }
    let done = true;
    for (const row of rows) {
      try {
        this.endedSession({
          userId: row.userId,
          sessionId: row.sessionId,
          endedAt: row.endedAt,
          ...(row.deviceId !== null ? { deviceId: row.deviceId } : {}),
        });
      } catch (error) {
        this.log("ending a session failed", { error });
        done = false;
        continue;
      } finally {
        this.closeSession(row.sessionId);
      }
      try {
        await this.env.DB.prepare(
          `delete from session_end where "workspaceId" = ? and "sessionId" = ?`,
        )
          .bind(workspaceId, row.sessionId)
          .run();
      } catch (error) {
        // Acted on again next time: every step is a no-op the second time.
        this.log("deleting an ended session failed", { error });
        done = false;
      }
    }
    return done;
  }

  /**
   * `device.register` as the member (RPC from `POST /devices/register`, which checked the session and read the
   * member's role in D1; RFC 0006 "Device registration"): the phone registers in every workspace it was opened in
   * with one request, not only the one it has a socket to. The same named mutation, RBAC and outbox event as over
   * Brigade Sync, run as a client mutation from client id `devices`. Before it: the sessions D1 still lists as
   * ended here (`catchUpSessionEnds`, so the phone a member signed out of is free for whoever signs in on it next),
   * and with `resetAt` the member's devices from before their password reset, as an upgrade does. Registered, or
   * unchanged (`conflict`), it records the time and `sessionId`, the session it was registered with (`device.touch`).
   * Another member's device (`forbidden`) is freed and tried once more when that member's session is gone
   * (`freeDevice`). A member removed within the tombstone is `not_a_member`; `unavailable` when D1 could not be read
   * (a catch-up that failed, a tombstone it could not check: the Worker saw the member in D1, so it is no leaving),
   * and the app tries again. A shard that serves another workspace, or none yet, answers `not_found`.
   */
  async registerDevice(
    workspaceId: string,
    actor: Actor,
    args: Record<string, unknown>,
    resetAt?: number,
    sessionId?: string,
  ): Promise<DeviceRegisterResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const standing = await this.membership.standing(workspaceId, actor.id, Date.now());
    if (standing === "gone") return { ok: false, code: "not_a_member" };
    if (standing === "unknown") return { ok: false, code: "unavailable" };
    // A phone left registered to a member who signed out on it must be free before anyone else registers it.
    if (!(await this.catchUpSessionEnds(workspaceId))) return { ok: false, code: "unavailable" };
    if (resetAt !== undefined && !this.signOutStale(actor.id, resetAt)) {
      return { ok: false, code: "internal" };
    }
    let result = this.runRegister(actor, args, sessionId);
    if (!result.ok && result.code === "forbidden" && typeof args.id === "string") {
      const freed = await this.freeDevice(workspaceId, args.id);
      if (freed === "unavailable") return { ok: false, code: "unavailable" };
      if (freed) result = this.runRegister(actor, args, sessionId);
    }
    return result;
  }

  /** `device.register` as the member over HTTP, then `device.touch` when it went through or changed nothing. */
  private runRegister(
    actor: Actor,
    args: Record<string, unknown>,
    sessionId: string | undefined,
  ): DeviceRegisterResult {
    const now = Date.now();
    const { result, changes } = this.shard.mutate({
      clientId: DEVICES_CLIENT_ID,
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor,
      name: "device.register",
      args,
      now,
    });
    if (result.ok) this.broadcast(result.version, changes, undefined);
    else if (result.error.code !== "conflict") return { ok: false, code: result.error.code };
    // Not done, a later sweep acting on a sign-out from before now could drop the phone just registered again.
    if (!this.touchDevice(actor, args.id, sessionId)) return { ok: false, code: "unavailable" };
    return result.ok ? { ok: true } : { ok: false, code: "conflict" };
  }

  /**
   * `device.touch` as the member, after their `device.register` (over HTTP or a socket) went through or changed
   * nothing. False when it failed (logged).
   */
  private touchDevice(actor: Actor, id: unknown, sessionId: string | undefined): boolean {
    if (typeof id !== "string") return true;
    const now = Date.now();
    const { result } = this.shard.mutate({
      clientId: DEVICES_CLIENT_ID,
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor,
      name: "device.touch",
      args: { id, ...(sessionId !== undefined ? { sessionId } : {}) },
      now,
      internal: true,
    });
    if (!result.ok) this.log("refreshing a registered device failed", { code: result.error.code });
    return result.ok;
  }

  /**
   * A phone another member registered, that someone else is registering now (RFC 0006 "Device registration"): free
   * when that member signed out on it (D1's `session_end`, caught up again here: the sign-out may have landed since)
   * or the session they last registered it with no longer exists or expired (`DeviceRow.sessionId`), in which case
   * it comes off them (`device.signOut`, only if not registered again since). True when the device is free now,
   * false when it is still theirs (or has no session to check), `unavailable` when D1 could not say.
   */
  private async freeDevice(workspaceId: string, id: string): Promise<boolean | "unavailable"> {
    if (!(await this.catchUpSessionEnds(workspaceId))) return "unavailable";
    const device = this.shard.store.get("devices", id);
    if (!device) return true;
    if (device.sessionId === undefined) return false;
    const checkedAt = Date.now();
    let session: { expiresAt: string | number } | null;
    try {
      session = await this.env.DB.prepare(`select "expiresAt" from "session" where id = ?`)
        .bind(device.sessionId)
        .first<{ expiresAt: string | number }>();
    } catch (error) {
      this.log("checking a device's session failed", { error });
      return "unavailable";
    }
    // However the adapter stored it (ISO text or ms); a value that cannot be read keeps the device its member's.
    const expiresAt =
      session === null
        ? 0
        : typeof session.expiresAt === "number"
          ? session.expiresAt
          : Date.parse(session.expiresAt);
    if (!(expiresAt <= checkedAt)) return false;
    try {
      this.serverMutation("device.signOut", {
        userId: device.userId,
        deviceId: id,
        before: checkedAt,
      });
    } catch (error) {
      this.log("freeing a device whose session ended failed", { error });
      return "unavailable";
    }
    return !this.shard.store.get("devices", id);
  }

  /**
   * `apiToken.create` or `apiToken.revoke` as the member (RPC from `POST` and `DELETE /workspaces/:id/api-tokens…`,
   * which checked the session, read the role in D1 and wrote D1 first: RFC 0014). The same RBAC as every mutation. A
   * revoke, or one already made, closes the token's sockets.
   */
  async apiTokenRun(
    workspaceId: string,
    actor: Actor,
    name: "apiToken.create" | "apiToken.revoke",
    args: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; code: MutationErrorCode | "not_a_member" }> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    if (await this.membership.refuses(workspaceId, actor.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    const now = Date.now();
    const { result, changes } = this.shard.mutate({
      clientId: "api",
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.broadcast(result.version, changes, undefined);
    if (name === "apiToken.revoke" && (result.ok || result.error.code === "conflict")) {
      this.closeSockets((socketActor) =>
        socketActor.kind === "token" && socketActor.id === args.id ? "removed" : undefined,
      );
    }
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  }

  /**
   * When an API token was last used, as the Worker recorded it in D1 (at most every few minutes): copied into the list
   * as `TOKENS_ACTOR` (`apiToken.touch`, silent). A token this shard does not list, or a newer time, is no change.
   */
  apiTokenUsed(workspaceId: string, tokenId: string, at: number): void {
    if (this.shard.workspace() !== workspaceId) return;
    const now = Date.now();
    const { result, changes } = this.shard.mutate({
      clientId: "api",
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor: TOKENS_ACTOR,
      name: "apiToken.touch",
      args: { id: tokenId, at },
      now,
      internal: true,
    });
    if (result.ok) this.broadcast(result.version, changes, undefined);
  }

  /**
   * An API token actor as this shard backs it (RFC 0014), or undefined: its listed copy must exist, be neither revoked
   * nor expired and have the same creator. Its role is the lower of what the Worker read in D1 and the creator's copy
   * here, so a demotion this shard already ran holds at once. Any other actor is returned as it is.
   */
  private tokenActor(actor: Actor): Actor | undefined {
    if (actor.kind !== "token") return actor;
    const row = this.shard.store.get("api_tokens", actor.id);
    if (!row || row.revokedAt !== null || row.createdBy !== actor.by) return undefined;
    if (row.expiresAt !== null && row.expiresAt <= Date.now()) return undefined;
    const copy = this.shard.store.get("members", row.createdBy);
    return copy && ROLES.indexOf(copy.role) > ROLES.indexOf(actor.role)
      ? { ...actor, role: copy.role }
      : actor;
  }

  /** Whether a socket acting as API token `actor` must close: no longer backed here, or its role lowered since. */
  private tokenVerdict(actor: Actor): SocketVerdict | undefined {
    const acting = this.tokenActor(actor);
    if (!acting) return "token_ended";
    return acting.role === actor.role ? undefined : "role_changed";
  }

  /**
   * The alarm's part of RFC 0014: closes every API token socket this shard no longer backs (`tokenVerdict`), so one
   * that expires while idle does not keep receiving patches, and answers when the next open one expires (null for
   * none). Never throws.
   */
  private closeEndedTokens(): number | null {
    const expiries: number[] = [];
    try {
      this.closeSockets((actor) => {
        if (actor.kind !== "token") return undefined;
        const verdict = this.tokenVerdict(actor);
        const expiresAt = this.shard.store.get("api_tokens", actor.id)?.expiresAt ?? null;
        if (verdict === undefined && expiresAt !== null) expiries.push(expiresAt);
        return verdict;
      });
    } catch (error) {
      this.log("closing ended API token sockets failed", { error });
    }
    return expiries.length === 0 ? null : Math.min(...expiries);
  }

  /** Runs a server-only mutation as `ACCOUNT_ACTOR`; a `conflict` is nothing to do. Throws on anything else. */
  private serverMutation(name: string, args: Record<string, unknown>): void {
    const now = Date.now();
    const { result, changes } = this.shard.mutate({
      clientId: "api",
      mutationId: newId("mut", now, (length) => crypto.getRandomValues(new Uint8Array(length))),
      actor: ACCOUNT_ACTOR,
      name,
      args,
      now,
      internal: true,
    });
    if (result.ok) this.broadcast(result.version, changes, undefined);
    else if (result.error.code !== "conflict") {
      throw new Error(`${name} refused: ${result.error.code}`);
    }
  }

  /**
   * Makes this shard's member list agree with D1 and closes sockets D1 no longer backs (src/members.ts). Every sync
   * upgrade starts one; exposed so a repair can be asked for directly.
   */
  async reconcileMembers(): Promise<void> {
    const workspace = this.shard.workspace();
    if (workspace !== undefined) await this.membership.reconcile(workspace);
  }

  /**
   * A probe's verdicts for its region (RPC from `ProbeDO`), each run as `monitor.report` by the monitors' system
   * actor and de-duplicated by its report id. Returns, per report, whether the probe may stop sending it: true
   * when it committed or can never apply (a paused or deleted monitor, a region it no longer uses, a result from
   * before its last restart or older than one recorded), false when it should be sent again. A storage failure
   * throws, and the probe sends them all again.
   */
  report(region: ProbeRegion, reports: ProbeReport[]): boolean[] {
    if (!isProbeRegion(region) || this.shard.workspace() === undefined)
      return reports.map(() => true);
    return reports.map(({ reportId, ...report }) => {
      const result = this.monitoring.report(`probe:${region}`, reportId, {
        ...report,
        source: region,
      });
      return result.ok || ["conflict", "not_found", "invalid_args"].includes(result.error.code);
    });
  }

  /**
   * A heartbeat ping (RPC from the Worker's `POST /heartbeat/:token`) with the SHA-256 of the token's secret.
   * False for an unknown monitor or a wrong token, alike; a shard that serves no workspace yet answers false
   * without claiming one.
   */
  async heartbeat(monitorId: string, digest: ArrayBuffer): Promise<boolean> {
    if (this.shard.workspace() === undefined) return false;
    return this.monitoring.ping(monitorId, digest);
  }

  /**
   * An alert source's payload (RPC from the Worker's `POST /alerts/:token`) with the SHA-256 of the URL's secret,
   * its text and its headers (RFC 0005 "Alert sources"). Every refusal is `not_found`, alike; a shard that serves no
   * workspace yet answers it without claiming one.
   */
  async alert(
    sourceId: string,
    digest: ArrayBuffer,
    body: ArrayBuffer,
    headers: Record<string, string>,
  ): Promise<AlertIntakeResult> {
    if (this.shard.workspace() === undefined) return { status: "not_found" };
    return this.alerts.receive(sourceId, digest, body, headers);
  }

  /**
   * An alert source's payload the Worker would not read, past `MAX_ALERT_BODY` (RPC from `POST /alerts/:token`): it
   * pages as the unreadable alert when the URL's secret and the source's header check out (`AlertIntake.receiveTooLarge`).
   */
  async alertTooLarge(
    sourceId: string,
    digest: ArrayBuffer,
    headers: Record<string, string>,
  ): Promise<AlertIntakeResult> {
    if (this.shard.workspace() === undefined) return { status: "not_found" };
    return this.alerts.receiveTooLarge(sourceId, digest, headers);
  }

  /**
   * Whether a verified payload of `sourceId` may go on: `ALERT_LIMIT` (wrangler.jsonc), keyed on the workspace and the
   * source, spent only once the shard checked the secrets, so a flood with a wrong secret cannot use up the real
   * source's budget. Approximate and per Cloudflare location; a limiter that fails lets the payload through, since a
   * lost alert is worse than a busy shard.
   */
  private async alertAllowed(sourceId: string): Promise<boolean> {
    const workspace = this.shard.workspace() ?? "";
    try {
      const { success } = await this.env.ALERT_LIMIT.limit({ key: `${workspace}:${sourceId}` });
      return success;
    } catch (error) {
      this.log("alert rate limit failed", { source: sourceId, error: String(error) });
      return true;
    }
  }

  /**
   * What the push notifier should send for `event` (RPC from the queue consumer, src/notify.ts): see `Pager.plan`.
   * A shard that serves no workspace yet plans nothing.
   */
  async planPage(event: BrigadeEvent): Promise<PagePlan> {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    // A member list that has not been checked against D1 lately is checked first, so a member removed or demoted
    // outside Brigade is not paged; never in the page's way (it waits a moment at most, and fails open).
    if (asksForPage(event)) await this.membership.fresh(event.workspaceId, Date.now());
    const now = Date.now();
    const plan = this.pager.plan(event, now);
    if (!plan.send) return plan;
    // Each device's receipt token (RFC 0006 "Delivery receipts"). Never in the page's way: without one the page
    // goes out all the same, and only its delivered stage stays unknown.
    try {
      const tokens = await this.receipts.mint(
        { workspaceId: event.workspaceId, incidentId: plan.incident.id, eventId: event.id },
        plan.targets.map((target) => target.deviceId),
        now,
      );
      return {
        ...plan,
        targets: plan.targets.map((target) => ({
          ...target,
          receipt: tokens.get(target.deviceId),
        })),
      };
    } catch (error) {
      this.log("minting receipt tokens failed", { event: event.id, error: String(error) });
      return plan;
    }
  }

  /**
   * A phone's delivery receipt (RPC from the Worker's `POST /receipts`, which read nothing but the token's
   * workspace): see `Receipts.receive`. A shard that serves no workspace yet, or another, answers `invalid`.
   */
  async receipt(token: string): Promise<ReceiptResult> {
    const result = await this.receipts.receive(token, Date.now());
    // The page the phone confirmed no longer holds a lower-urgency push back from it: that goes out now
    // (src/paging.ts `releaseDue`). Never in the receipt's way: the alarm releases it otherwise.
    if (result === "recorded") {
      try {
        if (this.pager.releaseDue(Date.now()) > 0) await this.drainOutbox();
      } catch (error) {
        this.log("releasing held pushes after a receipt failed", { error: String(error) });
      }
    }
    return result;
  }

  /**
   * What a page did (RPC from the queue consumer): see `Pager.record`. `skipped` defaults to none, so a consumer
   * from the version before it (during a deploy) still records its outcomes.
   */
  recordPage(
    event: BrigadeEvent,
    outcomes: DeviceOutcome[],
    final: boolean,
    skipped: SkippedMember[] = [],
  ): void {
    if (this.shard.workspace() !== event.workspaceId) return;
    this.pager.record(event, outcomes, final, skipped, Date.now());
  }

  /**
   * The emails a failed page asks for (RPC from the queue consumer, src/notify-email.ts): see `Mailer.plan`. A shard
   * that serves no workspace yet plans nothing.
   */
  planEmail(event: BrigadeEvent): EmailPlan {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return this.mailer.plan(event, Date.now());
  }

  /** What one email's sends did (RPC from the queue consumer): see `Mailer.record`. */
  recordEmail(
    event: BrigadeEvent,
    key: string,
    about: EmailAbout,
    outcomes: EmailOutcome[],
    final: boolean,
  ): void {
    if (this.shard.workspace() !== event.workspaceId) return;
    this.mailer.record(event, key, about, outcomes, final, Date.now());
  }

  /**
   * Starts a Slack install for `userId` (RPC from `POST /workspaces/:id/slack/install`, which checked the session and
   * that they manage the workspace; RFC 0011 "Installing"): a one-time state nonce, or null when too many are pending
   * or this shard serves another workspace.
   */
  slackBeginInstall(workspaceId: string, userId: string): Promise<string | null> {
    if (this.shard.workspace() !== workspaceId) return Promise.resolve(null);
    return this.slack.beginInstall(userId, Date.now());
  }

  /** The member who started the install `nonce` names, once (RPC from `SlackBridge.completeInstall`). */
  slackTakeState(workspaceId: string, nonce: string): Promise<string | null> {
    if (this.shard.workspace() !== workspaceId) return Promise.resolve(null);
    return this.slack.takeState(nonce, Date.now());
  }

  /** `slack.connect` as the member who installed (RPC from `SlackBridge.completeInstall`). */
  async slackConnect(
    workspaceId: string,
    actor: Actor,
    args: Record<string, unknown>,
    key: string,
  ): Promise<{ ok: true } | { ok: false; code: MutationErrorCode | "not_a_member" }> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    if (await this.membership.refuses(workspaceId, actor.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    const result = this.slack.connect(actor, args, key, Date.now());
    return result.ok ? { ok: true } : { ok: false, code: result.error.code };
  }

  /** The Slack team this workspace is connected to, if any (RPC from `SlackBridge`, when a team changes hands). */
  slackTeam(): string | null {
    return this.slack.team();
  }

  /** The sealed token and names for `teamId` (RPC from `SlackBridge`); null when not connected to it. */
  slackContext(teamId: string): ReturnType<SlackDesk["context"]> {
    return this.slack.context(teamId);
  }

  /**
   * A Slack user's action as `actor`, the member their email maps to (RPC from `SlackBridge.act`, which read the role
   * in D1). A member removed within the tombstone is refused as for a sync upgrade.
   */
  async slackAct(
    workspaceId: string,
    teamId: string,
    actor: Actor,
    action: SlackShardAction,
    key: string,
  ): Promise<SlackActOutcome> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_connected" };
    if (await this.membership.refuses(workspaceId, actor.id, Date.now())) {
      return { ok: false, code: "unmapped" };
    }
    return this.slack.act(teamId, actor, action, key, Date.now());
  }

  /** What the Slack notifier should do for `event` (RPC from the queue consumer): see `SlackDesk.plan`. */
  planSlack(event: BrigadeEvent): SlackPlan {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return this.slack.plan(event, Date.now());
  }

  /** What doing one job of `event` in Slack did (RPC from the queue consumer): see `SlackDesk.record`. */
  recordSlack(
    event: BrigadeEvent,
    job: string,
    outcome: SlackJobOutcome,
  ): { retryAt: number | null } {
    if (this.shard.workspace() !== event.workspaceId) return { retryAt: null };
    return this.slack.record(event, job, outcome, Date.now());
  }

  /** The declare form's incident types and services (RPC from `SlackBridge.openDeclare`). */
  slackCatalog(): ReturnType<SlackDesk["catalog"]> {
    return this.slack.catalog();
  }

  /**
   * Slack removed the app or revoked its bot token (RPC from `SlackBridge.revoked`, the Events API): the connection
   * is marked revoked and its token forgotten. False when it was not this workspace's team or bot.
   */
  slackRevoked(
    teamId: string,
    reason: "uninstalled" | "tokens_revoked",
    botUserIds: string[] | null,
  ): boolean {
    return this.slack.revoke(teamId, reason, botUserIds, Date.now());
  }

  /**
   * `webhook.create`, `webhook.rotateSecret` or `webhook.setHeaders` as `actor` (RPC from src/webhook-routes.ts, which
   * checked the session or API token, read the role in D1 and sealed what it was given or made). The same RBAC as
   * every mutation; an API token the shard no longer backs is refused like one the Worker refused, and a member removed
   * within the tombstone as their sync upgrade would be.
   */
  async webhookRun(
    workspaceId: string,
    actor: Actor,
    name: WebhookRunName,
    args: Record<string, unknown>,
    key: string,
  ): Promise<WebhookRunResult> {
    if (this.shard.workspace() !== workspaceId) return { ok: false, code: "not_found" };
    const acting = this.tokenActor(actor);
    if (!acting) return TOKEN_REFUSED;
    if (await this.membership.refuses(workspaceId, acting.by ?? acting.id, Date.now())) {
      return { ok: false, code: "not_a_member" };
    }
    const result = this.webhooks.run(acting, name, args, key, Date.now());
    if (result.ok) {
      if (name !== "webhook.setHeaders") return { ok: true };
      const id = typeof args.id === "string" ? args.id : "";
      return { ok: true, headers: this.shard.store.get("webhooks", id)?.headers ?? [] };
    }
    const { code, issues } = result.error;
    return issues ? { ok: false, code, issues } : { ok: false, code };
  }

  /** What the webhook notifier should deliver for `event` (RPC from the queue consumer): see `WebhookDesk.plan`. */
  planWebhooks(event: BrigadeEvent): WebhookPlan {
    if (this.shard.workspace() !== event.workspaceId) return { event: null, body: null, sends: [] };
    return this.webhooks.plan(event, Date.now());
  }

  /** What one webhook delivery attempt did (RPC from the queue consumer): see `WebhookDesk.record`. */
  recordWebhook(
    event: WebhookEventRef,
    webhookId: string,
    outcome: WebhookOutcome,
  ): { retryAt: number | null } {
    if (this.shard.workspace() !== event.workspaceId) return { retryAt: null };
    return this.webhooks.record(event, webhookId, outcome, Date.now());
  }

  /** The owners' email for an endpoint turned off (RPC from the queue consumer): see `WebhookDesk.planEmail`. */
  planWebhookEmail(event: BrigadeEvent): WebhookEmailPlan {
    if (this.shard.workspace() !== event.workspaceId) return { send: false, reason: "not_found" };
    return this.webhooks.planEmail(event, Date.now());
  }

  /** What that email did (RPC from the queue consumer): see `WebhookDesk.recordEmail`. */
  recordWebhookEmail(event: BrigadeEvent, done: boolean): void {
    if (this.shard.workspace() !== event.workspaceId) return;
    this.webhooks.recordEmail(event, done, Date.now());
  }

  /** A page the Queue gave up on (RPC from the dead-letter consumer): see `Pager.deadLettered`. */
  recordDeadLetter(event: BrigadeEvent): DeadLetterResult {
    if (this.shard.workspace() !== event.workspaceId) return "other_workspace";
    return this.pager.deadLettered(event, Date.now());
  }

  /**
   * The shard's one alarm (RFC 0005, RFC 0007, RFC 0006 "Who is paged"): escalation levels that came due
   * (`Escalations.fireDue`, synchronous, drained at once when any fired), monitor upkeep (`Monitoring.tick`), webhook
   * deliveries due again (`WebhookDesk.redrive`) and incident channels due to be archived (`SlackDesk.archiveDue`), draining the outbox to the Queue, then a due member repair (`Membership.repairDue`: a member change D1 has and the shard
   * missed), and the outbox again when the repair wrote events. The drain goes before the repair because the repair
   * waits on D1 (and on any member change ahead of it in the member lock): a page never waits on D1. A fallback a
   * tick from now is set first, so a failure never ends the chain; then the alarm moves to the earliest any of them
   * needs, or goes when none needs it.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    await this.ctx.storage.setAlarm(now + MONITOR_TICK_MS);
    // Pages first: a level is a mutation in this object's storage and its events go out before the monitor tick
    // (which waits on probes), the repair (which waits on D1) or anything else.
    let escalations: number | null = now + MONITOR_TICK_MS;
    let escalationsFailed = false;
    try {
      const { fired, next } = this.escalations.fireDue(now);
      escalations = next;
      if (fired > 0) await this.drainOutbox();
    } catch (error) {
      escalationsFailed = true;
      this.log("escalation failed", { error });
    }
    // Lost declarations due to be paged again (src/paging.ts `replayDue`): pages too, so before anything that waits.
    try {
      if (this.pager.replayDue(Date.now()) > 0) await this.drainOutbox();
    } catch (error) {
      this.log("paging lost pages again failed", { error });
    }
    // Pushes held back behind a page whose hold ended (src/paging.ts `releaseDue`).
    try {
      if (this.pager.releaseDue(Date.now()) > 0) await this.drainOutbox();
    } catch (error) {
      this.log("releasing held pushes failed", { error });
    }
    let monitors: number | null = now + MONITOR_TICK_MS;
    try {
      monitors = await this.monitoring.tick(now);
    } catch (error) {
      this.log("monitor tick failed", { error });
    }
    // Webhook deliveries due again go back to the queue with the drain below (src/webhooks.ts `redrive`).
    try {
      this.webhooks.redrive(Date.now());
    } catch (error) {
      this.log("webhook redrive failed", { error });
    }
    // Incident channels due to be archived: `slack.archive_due` events, out with the drain below (src/slack.ts).
    try {
      this.slack.archiveDue(Date.now());
    } catch (error) {
      this.log("slack archive failed", { error });
    }
    // Maintenance windows that started or ended (RFC 0012 "Scheduled maintenance"): their events go out with the drain
    // below, and the push after it shows them.
    this.advanceMaintenance(Date.now());
    await this.drainOutbox();
    // The status page after the outbox: a page never waits on KV. Never throws; KV calls have no deadline of their
    // own, so past `STATUS_PUSH_BUDGET_MS` the push carries on in the background, the push backs off (the alarm does
    // not come straight back for it) and the alarm goes on (the next escalation's time is set below). The wait ends
    // sooner when an escalation level falls due first, so a slow push never makes a level late.
    const workspace = this.shard.workspace();
    if (workspace !== undefined) {
      let budget = this.statusBudgetMs;
      try {
        const level = this.escalations.nextAt();
        if (level !== null) {
          budget = Math.min(budget, Math.max(STATUS_PUSH_MIN_BUDGET_MS, level - Date.now()));
        }
      } catch (error) {
        budget = Math.min(budget, STATUS_PUSH_MIN_BUDGET_MS);
        this.log("reading the escalation timers failed", { error });
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), budget);
      });
      const outcome = await Promise.race([
        this.status.publish(workspace, Date.now()),
        late,
      ]).finally(() => clearTimeout(timer));
      if (outcome === "late") this.status.late(Date.now());
    }
    const before = this.backlog();
    // The periodic reconcile (RFC 0006 "Who is paged"): a due one becomes a due repair, run just below.
    let periodic: number | null = now + MONITOR_TICK_MS;
    try {
      periodic = this.membership.periodic(Date.now());
    } catch (error) {
      this.log("reading the member reconcile period failed", { error });
    }
    let repair: number | null = now + MONITOR_TICK_MS;
    try {
      // D1 calls have no deadline of their own: a repair that hangs must not hold the alarm (and with it the next
      // drain). Past `REPAIR_BUDGET_MS` it carries on in the background and the alarm comes back for it.
      const due = this.membership.repairDue(this.shard.workspace(), Date.now());
      due.catch((error: unknown) => this.log("member repair failed", { error }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"late">((resolve) => {
        timer = setTimeout(() => resolve("late"), this.repairBudgetMs);
      });
      const outcome = await Promise.race([due, late]).finally(() => clearTimeout(timer));
      repair = outcome === "late" ? Date.now() + MEMBER_REPAIR_RETRY_MS : outcome;
    } catch (error) {
      this.log("member repair failed", { error });
    }
    // Again only when the repair (or a mutation meanwhile) wrote events, or the backlog could not be read.
    const after = this.backlog();
    if (before === null || after === null || after > before) await this.drainOutbox();
    // Read and set in one turn: a mutation committing meanwhile arms the drain after this, never before. The repair
    // time is read again here too: a member change that failed while a drain ran armed one `repair` may predate.
    // One already due is `repairDue`'s to answer for, so a repair that failed to record its outcome never spins.
    let armed: number | null = now + MONITOR_TICK_MS;
    try {
      const at = this.membership.repairAt();
      armed = at !== null && at > now ? at : null;
    } catch (error) {
      this.log("reading the member repair failed", { error });
    }
    let escalationAt: number | null = escalations;
    try {
      // Read again: a page planned while the alarm ran may have started a run. After `fireDue` threw, its timers are
      // still due: they are tried again `ESCALATION_RETRY_MS` later, not in a loop.
      const stored = this.escalations.nextAt();
      escalationAt = escalationsFailed
        ? stored === null
          ? null
          : Math.max(stored, now + ESCALATION_RETRY_MS)
        : earliest(escalations, stored);
    } catch (error) {
      this.log("reading the escalation timers failed", { error });
    }
    let statusAt: number | null = null;
    try {
      statusAt = this.status.nextAt(Date.now());
    } catch (error) {
      this.log("reading the status page push failed", { error });
    }
    // Never before now plus a beat: a redrive that could not run is tried again then, not in a loop.
    let expiryAt: number | null = now + MONITOR_TICK_MS;
    try {
      expiryAt = this.expireSockets(Date.now());
    } catch (error) {
      this.log("closing expired sockets failed", { error });
    }
    const tokenAt = this.closeEndedTokens();
    let webhookAt: number | null = now + MONITOR_TICK_MS;
    try {
      const at = this.webhooks.nextAt();
      webhookAt = at === null ? null : Math.max(at, Date.now() + WEBHOOK_REDRIVE_MIN_MS);
    } catch (error) {
      this.log("reading the webhook retries failed", { error });
    }
    let archiveAt: number | null = now + MONITOR_TICK_MS;
    try {
      const at = this.slack.nextArchiveAt();
      // One that could not be asked for is tried again a tick later, not in a loop.
      archiveAt = at === null ? null : Math.max(at, Date.now() + (at <= now ? MONITOR_TICK_MS : 0));
    } catch (error) {
      this.log("reading the slack archives failed", { error });
    }
    let replayAt: number | null = now + MONITOR_TICK_MS;
    try {
      const at = this.pager.replayAt();
      replayAt = at === null ? null : Math.max(at, Date.now() + (at <= now ? MONITOR_TICK_MS : 0));
    } catch (error) {
      this.log("reading the pages to page again failed", { error });
    }
    let releaseAt: number | null = now + MONITOR_TICK_MS;
    try {
      const at = this.pager.releaseAt(Date.now());
      // One that could not go is tried again a tick later, not in a loop.
      releaseAt = at === null ? null : Math.max(at, Date.now() + (at <= now ? MONITOR_TICK_MS : 0));
    } catch (error) {
      this.log("reading the held pushes failed", { error });
    }
    let maintenanceAt: number | null = null;
    try {
      const at = nextMaintenanceAt(this.shard.store.scan("status_maintenance"));
      // One that could not move on is tried again a tick later, not in a loop.
      maintenanceAt =
        at === null ? null : Math.max(at, Date.now() + (at <= now ? MONITOR_TICK_MS : 0));
    } catch (error) {
      this.log("reading the maintenance windows failed", { error });
    }
    const next = earliest(
      earliest(earliest(monitors, escalationAt), earliest(repair, earliest(armed, maintenanceAt))),
      earliest(
        earliest(this.drainPaused ? null : this.drain.nextWake(Date.now()), statusAt),
        earliest(
          earliest(webhookAt, archiveAt),
          earliest(expiryAt, earliest(tokenAt, earliest(replayAt, earliest(releaseAt, periodic)))),
        ),
      ),
    );
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  /**
   * Closes the sockets whose session expired by `now` (`1012`; they reconnect and the Worker refuses the expired
   * session, or takes the one Better Auth refreshed meanwhile) and answers when the next open one expires, or null.
   */
  private expireSockets(now: number): number | null {
    let next: number | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const state = ws.deserializeAttachment() as SocketState | null;
      if (!state || state.closed || state.expiresAt === undefined) continue;
      if (state.expiresAt <= now) close(ws, CLOSE_SERVICE_RESTART, "session expired");
      else next = earliest(next, state.expiresAt);
    }
    return next;
  }

  /** The outbox's row count, or null when storage failed reading it (logged). */
  private backlog(): number | null {
    try {
      return this.drain.backlog();
    } catch (error) {
      this.log("reading the outbox backlog failed", { error });
      return null;
    }
  }

  /** One outbox drain run, unless paused; a failed send backs off (`Drain.failed`). Never throws. */
  private async drainOutbox(): Promise<void> {
    if (this.drainPaused) return;
    try {
      await this.drain.drain(Date.now());
    } catch (error) {
      this.log("outbox drain failed", { error });
      try {
        this.drain.failed(Date.now(), error);
      } catch (backoff) {
        this.log("backing off the outbox drain failed", { error: backoff });
      }
    }
  }

  /**
   * Called after every mutation that wrote events: brings the alarm forward so the drain runs now, or when its
   * backoff ends after a failed send. Fire and forget; a failure is logged, and the next alarm drains anyway.
   */
  private armDrain(): void {
    if (this.drainPaused) return;
    // Runs after a committed mutation (`onOutbox` must not throw): a storage error reading the backoff only logs;
    // the fallback alarm drains later anyway.
    let at: number;
    try {
      at = Math.max(Date.now(), this.drain.retryAt() ?? 0);
    } catch (error) {
      this.log("arming the outbox drain failed", { error: String(error) });
      return;
    }
    this.wake(at, "outbox drain");
  }

  /** Moves every maintenance window whose start or end passed on (`maintenance.advance`). Never throws. */
  private advanceMaintenance(now: number): void {
    try {
      for (const row of this.shard.store.scan("status_maintenance")) {
        const at =
          row.phase === "scheduled"
            ? row.startsAt
            : row.phase === "in_progress"
              ? row.endsAt
              : null;
        if (at !== null && at <= now) this.serverMutation("maintenance.advance", { id: row.id });
      }
    } catch (error) {
      this.log("moving maintenance windows on failed", { error });
    }
  }

  /** Brings the alarm forward for the next maintenance window to start or end. Never throws. */
  private armMaintenance(): void {
    try {
      const at = nextMaintenanceAt(this.shard.store.scan("status_maintenance"));
      if (at !== null) this.wake(at, "maintenance window");
    } catch (error) {
      this.log("arming the maintenance window failed", { error: String(error) });
    }
  }

  /** Brings the alarm forward for a status page push that is due. Never throws. */
  private armStatus(): void {
    try {
      const at = this.status.nextAt(Date.now());
      if (at !== null) this.wake(at, "status page push");
    } catch (error) {
      this.log("arming the status page push failed", { error: String(error) });
    }
  }

  /** Brings the alarm forward to `at` unless it is already set sooner. Fire and forget; a failure is logged. */
  private wake(at: number, what: string): void {
    const { storage } = this.ctx;
    storage
      .getAlarm()
      .then((current) => (current === null || current > at ? storage.setAlarm(at) : undefined))
      .catch((error: unknown) => this.log(`arming the ${what} failed`, { error }));
  }

  /** Accepts a sync socket the Worker forwarded (`GET /sync/:workspaceId`). */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json(
        { error: "upgrade_required" },
        { status: 426, headers: { Upgrade: "websocket" } },
      );
    }
    // Set by the Worker after it authenticated the upgrade (src/actor.ts); never copied from the client.
    let actor = readActor(request.headers);
    if (!actor) return Response.json({ error: "internal" }, { status: 500 });
    const workspace = request.headers.get(WORKSPACE_HEADER) ?? "";
    if (!WORKSPACE_ID.test(workspace))
      return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
    if (!this.shard.claim(workspace)) {
      this.log("shard serves another workspace", { workspace });
      return Response.json({ error: "internal" }, { status: 500 });
    }
    // An API token (RFC 0014): refused once this shard's list no longer backs it (revoked, expired, another
    // workspace's), however recently the Worker's cache saw it; its role is never above its creator's copy here.
    if (actor.kind === "token") {
      const acting = this.tokenActor(actor);
      if (!acting) return Response.json({ error: "unauthenticated" }, { status: 401 });
      actor = acting;
      // The alarm closes the socket when the token expires, whether or not it sends anything.
      const expiresAt = this.shard.store.get("api_tokens", actor.id)?.expiresAt ?? null;
      if (expiresAt !== null) this.wake(expiresAt, "API token expiry");
    }
    const name = readMemberName(request.headers);
    // A member just removed here whose upgrade the Worker let through before the removal: refused, as the Worker
    // would now, rather than have `member.sync` restore their copy. A member D1 has again (re-added) is not.
    // A tombstone D1 could not be checked against is no leaving (the Worker found them in D1): tried again.
    const standing =
      name === undefined
        ? "member"
        : await this.membership.standing(workspace, actor.id, Date.now());
    if (standing === "gone") return Response.json({ error: "not_a_member" }, { status: 403 });
    if (standing === "unknown") return Response.json({ error: "unavailable" }, { status: 503 });
    // The same for a token whose creator was just removed: it acts for them, so it is refused with them (and tried
    // again when D1 could not say).
    if (actor.kind === "token") {
      const creator = await this.membership.standing(workspace, actor.by ?? actor.id, Date.now());
      if (creator === "gone") return Response.json({ error: "not_a_member" }, { status: 403 });
      if (creator === "unknown") return Response.json({ error: "unavailable" }, { status: 503 });
    }
    // Before the socket exists, so every `device.register` of this session comes after: the phone the member just
    // signed in on again is registered anew (or refreshed, `device.touch`), never dropped by a reconcile after it.
    const resetAt = readResetAt(request.headers);
    if (name !== undefined && resetAt !== undefined && !this.signOutStale(actor.id, resetAt)) {
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
    // A session that ended (or expired) after the Worker authenticated the upgrade with it: refused as the Worker
    // would refuse it now, rather than leave a socket nothing would ever close.
    const sessionId = readSessionId(request.headers);
    const expiresAt = readSessionExpiresAt(request.headers);
    if (
      (sessionId !== undefined && this.sessionEnded(sessionId)) ||
      (expiresAt !== undefined && expiresAt <= Date.now())
    ) {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }
    if (name !== undefined) this.syncMember(actor, name);
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    // Tagged with the session it came with, so ending that session closes it (`endSession`).
    this.ctx.acceptWebSocket(server, sessionId ? [sessionTag(sessionId)] : []);
    const state: SocketState = {
      workspace,
      actor,
      clientId: null,
      subs: [],
      openedAt: Date.now(),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
    server.serializeAttachment(state);
    // Closed at the session's expiry even if it never sends another frame (`expireSockets`).
    if (expiresAt !== undefined) this.wake(expiresAt, "session expiry");
    // The Worker read the member's role before this request arrived, and a member change may have landed in
    // between (or D1 was edited outside Brigade): check D1 again without holding up the socket. A socket D1 no
    // longer backs is closed, and the member list's copy follows D1 (src/members.ts); if that fails, the repair
    // alarm does it. Only a signed-in member's upgrade (the dev actor has no name and no D1 row).
    if (name !== undefined) {
      void this.membership.upgraded(workspace);
      // Sessions whose end never reached this shard (src/session-end.ts): caught up without holding up the socket.
      void this.catchUpSessionEnds(workspace);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A signed-in member's upgrade after their password was reset at `resetAt` (D1's `user.passwordResetAt`, which the
   * Worker read): drops their devices last registered before it (`device.signOut` as `ACCOUNT_ACTOR`), left behind
   * when the reset's own sign-out failed here (RFC 0002 "Auth"). Only the first upgrade after such a failure finds
   * any, so no other one writes or emits anything. False when it failed, after arming the member repair, whose
   * reconcile drops them instead.
   *
   * `resetAt` is the Worker's clock and `updatedAt` the shard's. Both are Cloudflare's, kept within milliseconds of
   * each other, far less than it takes a person to sign in again after a reset, so a device registered after the
   * reset never reads as older than it.
   */
  private signOutStale(userId: string, resetAt: number): boolean {
    const stale = this.shard.store
      .scan("devices")
      .some((device) => device.userId === userId && device.updatedAt < resetAt);
    if (!stale) return true;
    try {
      this.serverMutation("device.signOut", { userId, before: resetAt });
      return true;
    } catch (error) {
      this.log("signing out devices from before a password reset failed", { error });
      this.membership.armRepair(Date.now());
      return false;
    }
  }

  /**
   * Copies the member this socket acts as into the shard's member list (`member.sync`, RFC 0003), so roles can
   * point at them and the dashboard can show their name. The name is fitted first (trimmed, cut, or null when the
   * shard cannot keep it: `fitMemberName`), so an odd name in D1 still lists the member, and the copy is skipped
   * when that fitted value is current. A failure is logged and the socket still opens: the list is a cache of D1,
   * refreshed on the member's next socket.
   */
  private syncMember(actor: Actor, raw: string): void {
    try {
      const name = fitMemberName(raw);
      const current = this.shard.store.get("members", actor.id);
      if (current && current.name === name && current.role === actor.role) return;
      const { result, changes } = this.shard.mutate({
        clientId: "api",
        mutationId: "member",
        actor,
        name: "member.sync",
        args: { id: actor.id, name, role: actor.role },
        now: Date.now(),
        internal: true,
      });
      if (result.ok) this.broadcast(result.version, changes, undefined);
      else this.log("member sync refused", { code: result.error.code });
    } catch (error) {
      this.log("member sync failed", { error });
    }
  }

  /**
   * Closes every socket whose actor `judge` gives a verdict for: removed members' with 1008, others' with 1012 (a
   * signed-out one reconnects and is refused for want of a session).
   */
  private closeSockets(judge: (actor: Actor, openedAt: number) => SocketVerdict | undefined): void {
    for (const ws of this.ctx.getWebSockets()) {
      let verdict: SocketVerdict | undefined;
      try {
        const state = ws.deserializeAttachment() as SocketState | null;
        if (!state || state.closed) continue;
        verdict = judge(state.actor, state.openedAt ?? 0);
      } catch (error) {
        this.log("reading a socket's actor failed", { error });
        verdict = "removed";
      }
      if (verdict === "removed") close(ws, CLOSE_POLICY_VIOLATION, "not a member");
      else if (verdict === "role_changed") close(ws, CLOSE_SERVICE_RESTART, "role changed");
      else if (verdict === "signed_out") close(ws, CLOSE_SERVICE_RESTART, "signed out");
      else if (verdict === "token_ended") close(ws, CLOSE_POLICY_VIOLATION, "token ended");
    }
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    try {
      this.receive(ws, message);
    } catch (error) {
      // A bug or a storage failure: report it, tell the client and close; it reconnects and resumes.
      this.log("sync frame failed", { error });
      this.send(ws, { type: "error", code: "internal", message: "Internal error" });
      close(ws, CLOSE_INTERNAL_ERROR, "internal error");
    }
  }

  override webSocketClose(): void {
    // Nothing to clean up: a socket's state lives in its attachment and goes with it. The runtime answers the
    // close frame itself (web_socket_auto_reply_to_close, compatibility date 2026-04-07 and later).
  }

  override webSocketError(_ws: WebSocket, error: unknown): void {
    this.log("sync socket error", { error });
  }

  private receive(ws: WebSocket, data: string | ArrayBuffer): void {
    // Frames the client sent before the shard closed this socket still arrive here. Handling them would run them
    // out of order (a mutate that depends on one whose storage failed), so they are dropped unread: the client
    // replays everything unconfirmed, in order, on its next socket.
    if (ws.readyState !== WebSocket.OPEN) return;
    const state = ws.deserializeAttachment() as SocketState | null;
    if (state?.closed) return;
    if (state?.expiresAt !== undefined && state.expiresAt <= Date.now()) {
      close(ws, CLOSE_SERVICE_RESTART, "session expired");
      return;
    }
    if (!state) {
      close(ws, CLOSE_INTERNAL_ERROR, "no socket state");
      return;
    }
    // An API token's socket (RFC 0014) is checked on every frame, not only at the upgrade: one that expired, was
    // revoked here, or whose creator's copy here was demoted since closes instead of answering. In memory only; the
    // alarm closes an idle one when it expires (`closeEndedTokens`).
    if (state.actor.kind === "token") {
      const verdict = this.tokenVerdict(state.actor);
      if (verdict === "token_ended") return close(ws, CLOSE_POLICY_VIOLATION, "token ended");
      if (verdict === "role_changed") return close(ws, CLOSE_SERVICE_RESTART, "role changed");
    }
    // Checks size (64 KiB), JSON, shape and ids; never throws. Binary frames are refused as not text.
    const parsed = parseClientMessage(data);
    if (!parsed.ok) return this.malformed(ws, state, data, parsed.reason);
    const message = parsed.message;

    // A ping the auto-response did not catch (it matches only the exact text): answered here, before `hello` too.
    if (message.type === "ping") return this.send(ws, { type: "pong" });
    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL_VERSION) return this.refuse(ws, "Unsupported protocol");
      if (state.clientId !== null) return this.refuse(ws, "hello twice");
      // `token` is reserved and ignored: the Worker authenticates the upgrade.
      state.clientId = message.clientId;
      ws.serializeAttachment(state);
      return;
    }
    // Any frame before `hello`, a `mutate` included, is about the socket, not that frame (RFC 0004 "Shard
    // server"): the client always sends `hello` first, and after the close it replays the mutation behind one.
    if (state.clientId === null) return this.refuse(ws, "hello first");

    switch (message.type) {
      case "subscribe":
        return this.subscribe(
          ws,
          state,
          message.subId,
          message.query,
          message.args,
          message.version === undefined || message.epoch === undefined
            ? undefined
            : { version: message.version, epoch: message.epoch },
        );
      case "unsubscribe":
        state.subs = state.subs.filter((sub) => sub.subId !== message.subId);
        ws.serializeAttachment(state);
        return;
      case "mutate":
        return this.mutate(
          ws,
          state,
          state.clientId,
          message.mutationId,
          message.name,
          message.args,
        );
    }
  }

  /**
   * Answers a `mutate` with its `mutationResult`, then (when ok) the patch for its version: to every socket whose
   * subscriptions it touched, and always to this socket, with `subs: {}` if it touched none of them here, so the
   * client can settle the mutation (RFC 0004 "Ordering").
   *
   * A retry the shard already ran gets the stored result and nothing else: the client re-sends only on a new
   * socket, before its `subscribe`s, and their answers (at the current version, at or after the result's) settle
   * it. A storage failure throws out of here: nothing committed, so the socket closes with `internal` and the
   * client replays the mutation on the next one, instead of failing it for good.
   */
  private mutate(
    ws: WebSocket,
    state: SocketState,
    clientId: string,
    mutationId: string,
    name: string,
    args: unknown,
  ): void {
    const now = Date.now();
    const stored = this.shard.storedResult(state.actor.id, clientId, mutationId, now);
    if (stored) return this.send(ws, stored);
    const { result, changes } = this.shard.mutate({
      clientId,
      mutationId,
      actor: state.actor,
      name,
      args,
      now,
    });
    this.send(ws, result);
    // As over HTTP (`runRegister`): registered or unchanged, the time and the socket's session are recorded.
    if (name === "device.register" && (result.ok || result.error.code === "conflict")) {
      const tag = this.ctx.getTags(ws).find((tag) => tag.startsWith(sessionTag("")));
      this.touchDevice(
        state.actor,
        Reflect.get(Object(args), "id"),
        tag?.slice(sessionTag("").length),
      );
    }
    if (result.ok) {
      this.broadcast(result.version, changes, ws);
      // The routes changed: what they kept quiet is routed again now (RFC 0005 "Alert sources"). Never throws.
      if (changes.some((change) => change.table === "alert_routes")) this.alerts.reroute();
      // A monitor changed: the alarm pushes it to its probes (and keeps watching its heartbeats) right away.
      if (changes.some((change) => change.table === "monitors")) {
        this.ctx.storage.setAlarm(Date.now()).catch((error: unknown) => {
          // The next alarm (or a later change) pushes it instead; log rather than leave an unhandled rejection.
          console.error(
            JSON.stringify({ message: "arming the alarm failed", error: String(error) }),
          );
        });
      }
    }
  }

  private subscribe(
    ws: WebSocket,
    state: SocketState,
    subId: string,
    name: string,
    rawArgs: unknown,
    from: { version: number; epoch: string } | undefined,
  ): void {
    // A re-subscribe replaces the old subscription, whatever the outcome.
    state.subs = state.subs.filter((sub) => sub.subId !== subId);
    const refuse = (code: string, message: string) => {
      ws.serializeAttachment(state);
      this.send(ws, { type: "error", subId, code, message });
    };
    if (state.subs.length >= MAX_SUBSCRIPTIONS) {
      return refuse("limit", `At most ${MAX_SUBSCRIPTIONS} subscriptions per socket`);
    }
    const result = this.shard.query(name, rawArgs, state.actor.role, state.actor.scopes);
    if (!result.ok) return refuse(result.error.code, result.error.message);
    // `runQuery` accepted both, so the lookup and the args are valid.
    const query = findQuery(name)!;
    const args = query.args(rawArgs);
    if (!args.ok) return refuse("invalid_args", `Invalid arguments for ${name}`);

    const version = this.shard.version();
    const { epoch } = this.shard;
    state.subs.push({ subId, query: name, args: args.value });
    if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_ATTACHMENT_BYTES) {
      state.subs.pop();
      return refuse("limit", "Too much subscription state on this socket");
    }
    ws.serializeAttachment(state);

    // Exactly one answer: a patch holding only this subscription (possibly empty), or a snapshot.
    const changes = from && this.shard.resume(query, result.rows, from);
    if (changes) {
      const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
      subs[subId] = changes;
      this.send(ws, { type: "patch", epoch, version, subs });
    } else {
      this.send(ws, { type: "snapshot", subId, epoch, version, rows: result.rows });
    }
  }

  /**
   * Sends one patch for `version` to every socket with a subscription whose result it changed: rows that are in
   * the result now (entered or changed) and ids that were in it and left. Other sockets skip the version, except
   * `origin` (the mutating socket), which always gets it.
   */
  private broadcast(
    version: number,
    changes: readonly RowChange[],
    origin: WebSocket | undefined,
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        this.patchSocket(ws, version, changes, ws === origin);
      } catch (error) {
        // One socket's failure (a corrupt attachment, a closed socket) must not stop the others' patches. This one
        // would miss the version, so it closes and its client resumes.
        this.log("sync patch failed", { error });
        close(ws, CLOSE_INTERNAL_ERROR, "internal error");
      }
    }
  }

  /** One socket's patch for `version`; see `broadcast`. */
  private patchSocket(
    ws: WebSocket,
    version: number,
    changes: readonly RowChange[],
    origin: boolean,
  ): void {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (!state?.clientId) return;
    // No prototype: a subId such as `__proto__` stays an ordinary key.
    const subs = Object.create(null) as { [subId: string]: SubscriptionChanges };
    const failed: string[] = [];
    let touched = false;
    for (const sub of state.subs) {
      const query = findQuery(sub.query);
      let patch;
      try {
        if (!query) throw new Error(`Unknown query ${sub.query.slice(0, 64)}`);
        patch = subscriptionChanges(query, sub.args, changes);
      } catch (error) {
        this.log("query filter failed", { query: sub.query.slice(0, 64), error });
        failed.push(sub.subId);
        continue;
      }
      if (patch) {
        subs[sub.subId] = patch;
        touched = true;
      }
    }
    if (failed.length > 0) {
      // A patch at `version` says the whole socket holds it, which a subscription that missed this change does
      // not: refuse it first (the client lets go of its rows), so the patch claims only what it carries.
      state.subs = state.subs.filter((sub) => !failed.includes(sub.subId));
      ws.serializeAttachment(state);
      for (const subId of failed) {
        this.send(ws, { type: "error", subId, code: "internal", message: "Internal error" });
      }
    }
    if (touched || origin) {
      this.send(ws, { type: "patch", epoch: this.shard.epoch, version, subs });
    }
  }

  /**
   * A frame `parseClientMessage` refused. After `hello`, one whose id can still be read is refused alone with
   * `invalid_args` and the socket stays open (RFC 0004 "Shard server"): a `subscribe` gets its one answer, an
   * `error` with its `subId`; a `mutate` gets a failed `mutationResult`, as invalid args from `runMutation` would,
   * but not stored (it never ran). Anything else is a socket-level protocol error.
   */
  private malformed(ws: WebSocket, state: SocketState, data: unknown, reason: string): void {
    const id = state.clientId === null ? undefined : salvage(data);
    if (!id) return this.refuse(ws, reason);
    if ("subId" in id) {
      // Like any `subscribe`, it replaces a subscription with the same subId, here with nothing.
      state.subs = state.subs.filter((sub) => sub.subId !== id.subId);
      ws.serializeAttachment(state);
      return this.send(ws, { type: "error", code: "invalid_args", message: reason, ...id });
    }
    this.send(ws, {
      type: "mutationResult",
      mutationId: id.mutationId,
      ok: false,
      error: { code: "invalid_args", message: reason },
    });
  }

  /**
   * A socket-level protocol error: an `error` frame, then close. A well-behaved client never sends a malformed
   * frame, and the client closes and backs off on one anyway (RFC 0004 "Protocol").
   */
  private refuse(ws: WebSocket, message: string): void {
    this.send(ws, { type: "error", code: "protocol", message });
    close(ws, CLOSE_PROTOCOL_ERROR, "protocol error");
  }

  private send(ws: WebSocket, frame: ServerMessage): void {
    try {
      ws.send(encode(frame));
    } catch (error) {
      // A lost frame would make the next patch claim a version this socket never fully got: close it, so the
      // client reconnects and resumes from what it holds.
      this.log("sync send failed", { type: frame.type, error });
      close(ws, CLOSE_INTERNAL_ERROR, "send failed");
    }
  }

  /** One structured JSON line per problem; `internal` causes end up here, never on the wire. */
  private log(message: string, fields: Record<string, unknown>): void {
    const { error, ...rest } = fields;
    let workspace: string | undefined;
    try {
      workspace = this.shard.workspace();
    } catch {
      // Logging must not fail because storage did.
    }
    console.error(
      JSON.stringify({
        message,
        shard: "workspace",
        workspace,
        ...rest,
        ...(error === undefined ? {} : describe(error)),
      }),
    );
  }
}

/** What every invitation RPC answers for a shard that serves another workspace, or none yet. */
function notFound(): Promise<{ ok: false; code: "not_found" }> {
  return Promise.resolve({ ok: false, code: "not_found" });
}

function earliest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function describe(error: unknown): { error: string; stack?: string } {
  if (error instanceof Error)
    return { error: `${error.name}: ${error.message}`, stack: error.stack };
  return { error: typeof error === "string" ? error : (JSON.stringify(error) ?? typeof error) };
}

/** The `subId` of a `subscribe` or the `mutationId` of a `mutate` in a frame the parser refused, if readable. */
function salvage(data: unknown): { subId: string } | { mutationId: string } | undefined {
  if (typeof data !== "string" || data.length > MAX_SALVAGE_LENGTH) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { type, subId, mutationId } = value as Record<string, unknown>;
  if (type === "subscribe" && typeof subId === "string" && TOKEN.test(subId)) return { subId };
  if (type === "mutate" && typeof mutationId === "string" && TOKEN.test(mutationId)) {
    return { mutationId };
  }
  return undefined;
}

/**
 * Every close the shard makes goes through here: the attachment is marked closed first, so `receive` drops the
 * frames still queued behind the close (see there), then the socket closes.
 */
function close(ws: WebSocket, code: number, reason: string): void {
  try {
    const state = ws.deserializeAttachment() as SocketState | null;
    if (state && typeof state === "object" && !state.closed) {
      ws.serializeAttachment({ ...state, closed: true });
    }
  } catch {
    // An unreadable attachment or a socket already gone: `readyState` still stops later frames.
  }
  try {
    ws.close(code, reason);
  } catch {
    // Already closed.
  }
}
