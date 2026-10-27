import { TOKEN } from "@freecorps/brigade-sync/protocol";
import {
  can,
  invitationEmail,
  isId,
  isRole,
  parseAlertSourceToken,
  parseHeartbeatToken,
  workspaceName,
  type MemberChange,
  type Role,
} from "@freecorps/brigade-schema";
import {
  ACTOR_HEADER,
  MEMBER_NAME_HEADER,
  memberRole,
  RESET_AT_HEADER,
  resolveActor,
} from "./actor.ts";
import {
  AUTH_BASE_PATH,
  createAuth,
  WORKSPACE_LIMIT_CODE,
  type Auth,
  type AuthBindings,
} from "./auth.ts";
import {
  invitationWorkspace,
  listInvitations,
  previewInvitation,
  type InvitationCode,
} from "./invitations.ts";
import type { MemberChangeResult } from "./members.ts";
import { emailSender } from "./email.ts";
import { consumeDeadLetters, consumeEvents, type NotifyEnv } from "./notify.ts";
import { receiptWorkspace } from "./receipts.ts";
import { beginSlackInstall } from "./slack-bridge.ts";
import { configureStatusPage, serveStatusPage } from "./status-route.ts";
import { createExport, downloadExport, features, sweepExports } from "./exports.ts";
import { requestDraftRoute } from "./postmortem.ts";

import { readBounded, readBoundedBytes } from "./body.ts";
import { webhookRequest } from "./webhook-routes.ts";
import { MAX_ALERT_BODY } from "./alert-intake.ts";
import { ACK_STATUS, INVITATION_STATUS, MEMBER_STATUS, RECEIPT_STATUS, USER_ID } from "./http.ts";
import { WATCHDOG_NAME, type PagingHealth } from "./watchdog.ts";
import {
  IDEMPOTENCY_KEY_HEADER,
  ORGANIZATION_ID,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  type AckResult,
} from "./workspace.ts";

export { ProbeDO } from "./probe.ts";
export { SlackBridge } from "./slack-bridge.ts";
export { WatchdogDO } from "./watchdog.ts";
export { WorkspaceDO } from "./workspace.ts";

const WORKSPACE_PATH = /^\/workspaces\/([^/]+)$/;
const MEMBER_PATH = /^\/workspaces\/([^/]+)\/members\/([^/]+)$/;
const INVITATIONS_PATH = /^\/workspaces\/([^/]+)\/invitations$/;
const INVITATION_PATH = /^\/workspaces\/([^/]+)\/invitations\/([^/]+?)(\/resend)?$/;
const INVITEE_PATH = /^\/invitations\/([^/]+?)(?:\/(accept|decline))?$/;
const ACK_PATH = /^\/workspaces\/([^/]+)\/incidents\/([^/]+)\/ack$/;
const SLACK_INSTALL_PATH = /^\/workspaces\/([^/]+)\/slack\/install$/;
const WEBHOOKS_PATH = /^\/workspaces\/([^/]+)\/webhooks(?:\/([^/]+)\/rotate)?$/;
const SYNC_PATH = /^\/sync\/([^/]+)$/;
const HEARTBEAT_PATH = /^\/heartbeat\/([^/]+)$/;
const ALERTS_PATH = /^\/alerts\/([^/]+)$/;
const STATUS_PAGE_PATH = /^\/workspaces\/([^/]+)\/status-page$/;
const DRAFT_PATH = /^\/workspaces\/([^/]+)\/incidents\/([^/]+)\/postmortem\/draft$/;
const EXPORTS_PATH = /^\/workspaces\/([^/]+)\/exports$/;
const EXPORT_PATH = /^\/workspaces\/([^/]+)\/exports\/([^/]+)$/;
/** Minute of the hour the cron sweeps expired exports (src/exports.ts). */
const EXPORT_SWEEP_MINUTE = 17;
/** `/status/<slug>`; `/status` and `/status/` alone are the page's 404 (no slug). */
const PUBLIC_STATUS_PATH = /^\/status(?:\/([^/]*))?$/;
const READ_METHODS = ["GET", "HEAD"];
/** Largest `POST /workspaces` body read, in bytes. */
const MAX_BODY_LENGTH = 4096;

/**
 * The organization plugin's routes the dashboard calls. Every other `/auth/organization/*` route (update, delete,
 * member roles, removing or adding members, invitations, teams, leaving) is refused: Better Auth would change D1
 * without the shard's copy of the members or a `workspace.*` / `member.*` / `invitation.*` event in its outbox
 * (RFC 0005). Creating goes through `POST /workspaces`; member roles, removing and leaving through
 * `/workspaces/:id/members/:userId`; invitations through `/workspaces/:id/invitations` and `/invitations/:id`.
 */
const ORGANIZATION_ROUTES = new Set([
  "/organization/get-full-organization",
  "/organization/get-active-member",
  "/organization/set-active",
  "/organization/list",
]);

/**
 * Better Auth's full organization joins in every invitation, addresses included, for any member who asks. The
 * dashboard reads the members from it; invitations are only for those who manage them, through
 * `GET /workspaces/:id/invitations`, so they are taken out here for everyone.
 */
export async function withoutInvitations(response: Response): Promise<Response> {
  if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
    return response;
  }
  const body: unknown = await response.json();
  if (typeof body === "object" && body !== null) Reflect.deleteProperty(body, "invitations");
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

/**
 * Other Better Auth routes refused. `/expo-authorization-proxy` (the `expo()` plugin's) redirects to any HTTPS URL it
 * is given, for social sign-in through the system browser; until that sign-in exists it would only be an open
 * redirect on Brigade's host. `/reset-password/:token` (`REFUSED_PREFIXES`) redirects a reset token to a
 * `callbackURL`, `brigade://` included, where any app claiming the scheme would get it; the reset email links to the
 * dashboard's page instead, which posts the token to `/reset-password`.
 */
const REFUSED_ROUTES = new Set(["/expo-authorization-proxy"]);
const REFUSED_PREFIXES = ["/reset-password/"];

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    // One Better Auth instance per request (its cookies depend on the request's protocol), made only once the
    // request needs it, so other routes skip its initialisation. test/auth.test.ts checks that a later request
    // never waits on an earlier one's instance.
    const auth = () => workerAuth(env, ctx, request);
    if (pathname === AUTH_BASE_PATH || pathname.startsWith(`${AUTH_BASE_PATH}/`)) {
      const route = pathname.slice(AUTH_BASE_PATH.length);
      if (
        (route.startsWith("/organization/") && !ORGANIZATION_ROUTES.has(route)) ||
        REFUSED_ROUTES.has(route) ||
        REFUSED_PREFIXES.some((prefix) => route.startsWith(prefix))
      ) {
        return json({ error: "not_found" }, 404);
      }
      const response = await auth().handler(request);
      return route === "/organization/get-full-organization"
        ? withoutInvitations(response)
        : response;
    }
    const sync = SYNC_PATH.exec(pathname)?.[1];
    if (sync !== undefined) return openSync(request, env, auth, sync);
    if (pathname === "/workspaces") return createWorkspace(request, auth);
    const member = MEMBER_PATH.exec(pathname);
    if (member) return changeMember(request, env, auth, member[1]!, member[2]!);
    const invitations = INVITATIONS_PATH.exec(pathname);
    if (invitations) return workspaceInvitations(request, env, auth, invitations[1]!);
    const invitation = INVITATION_PATH.exec(pathname);
    if (invitation) {
      return changeInvitation(request, env, auth, invitation[1]!, invitation[2]!, !!invitation[3]);
    }
    const invitee = INVITEE_PATH.exec(pathname);
    if (invitee) return answerInvitation(request, env, auth, invitee[1]!, invitee[2]);
    const ack = ACK_PATH.exec(pathname);
    if (ack) return acknowledgeIncident(request, env, auth, ack[1]!, ack[2]!);
    const slackInstall = SLACK_INSTALL_PATH.exec(pathname)?.[1];
    if (slackInstall !== undefined) return beginSlackInstall(request, env, auth, slackInstall);
    // Postmortem drafts and exports (RFC 0013).
    const draft = DRAFT_PATH.exec(pathname);
    if (draft) return requestDraftRoute(request, env, ctx, auth, draft[1]!, draft[2]!);
    const exports = EXPORTS_PATH.exec(pathname)?.[1];
    if (exports !== undefined) return createExport(request, env, auth, exports);
    const download = EXPORT_PATH.exec(pathname);
    if (download) return downloadExport(request, env, ctx, auth, download[1]!, download[2]!);
    if (pathname === "/features") return features(request, env, auth);
    const statusPage = STATUS_PAGE_PATH.exec(pathname)?.[1];
    if (statusPage !== undefined) return configureStatusPage(request, env, auth, statusPage);
    // The public status page (RFC 0012): no session, read from KV, never from the shard.
    const publicStatus = PUBLIC_STATUS_PATH.exec(pathname);
    if (publicStatus) return serveStatusPage(request, env, ctx, publicStatus[1] ?? "");
    const webhooks = WEBHOOKS_PATH.exec(pathname);
    if (webhooks) return webhookRequest(request, env, auth, webhooks[1]!, webhooks[2]);
    const heartbeat = HEARTBEAT_PATH.exec(pathname)?.[1];
    if (heartbeat !== undefined) return receiveHeartbeat(request, env, heartbeat);
    if (pathname === "/receipts") return receiveReceipt(request, env);
    const alerts = ALERTS_PATH.exec(pathname)?.[1];
    if (alerts !== undefined) return receiveAlerts(request, env, alerts);

    if (pathname === "/health/paging") return pagingHealth(request, env, auth);
    if (pathname === "/account/takeover") return takeoverNotice(request, env, auth);

    const workspace = WORKSPACE_PATH.exec(pathname)?.[1];
    if (workspace !== undefined) return workspaceInfo(request, env, auth, workspace);
    if (pathname !== "/health") return json({ error: "not_found" }, 404);
    if (!READ_METHODS.includes(request.method)) {
      return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
    }
    return json({ ok: true });
  },

  /**
   * `brigade-events` (RFC 0005): the shards' drained outboxes, routed to notifiers (src/notify.ts); and its
   * dead-letter queue, `brigade-events-dlq`, where what the first gave up on is recorded.
   */
  async queue(batch, env, ctx): Promise<void> {
    if (batch.queue.startsWith("brigade-events-dlq")) await consumeDeadLetters(batch, env);
    else await consumeEvents(batch, env, undefined, undefined, (promise) => ctx.waitUntil(promise));
  },

  /**
   * The dead-man switch's clock (RFC 0007 "Watching the watcher"): one heartbeat a minute into the watchdog's outbox
   * (src/watchdog.ts). A failure throws, so the Cron Trigger's past events show it, and the silence it leaves trips
   * the external check.
   */
  async scheduled(controller, env, ctx?: Pick<ExecutionContext, "waitUntil">): Promise<void> {
    // Expired exports (RFC 0013), once an hour beside the heartbeat, never in its way: a failure is only logged.
    const bucket = env.EXPORTS;
    if (bucket && new Date(controller.scheduledTime).getUTCMinutes() === EXPORT_SWEEP_MINUTE) {
      const sweep = sweepExports(bucket, Date.now()).catch((error: unknown) =>
        console.error(JSON.stringify({ message: "export sweep failed", error: String(error) })),
      );
      ctx?.waitUntil(sweep);
    }
    await env.WATCHDOG.getByName(WATCHDOG_NAME).beat();
  },
} satisfies ExportedHandler<Env>;

/**
 * `GET /workspaces/:id`: the shard's SQLite table count and size, for the dashboard's stack check (apps/web
 * src/lib/stack.ts). Members only: 401 without a session, 403 `not_a_member` for anyone else, checked in D1 first so
 * an outsider or a made-up id never wakes (or creates) a shard. Read-only, so no origin check.
 */
export async function workspaceInfo(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
): Promise<Response> {
  if (!READ_METHODS.includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
  }
  // Checked before any decoding: the charset has no `%`, so encoded or malformed input is rejected.
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  try {
    const session = await lazyAuth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    if ((await memberRole(env.DB, workspaceId, session.user.id)) === undefined) {
      return json({ error: "not_a_member" }, 403);
    }
  } catch (error) {
    console.error(
      JSON.stringify({ message: "session or member lookup failed", error: String(error) }),
    );
    return json({ error: "unavailable" }, 503);
  }
  try {
    const info = await env.WORKSPACE.getByName(workspaceId).info();
    return json({ workspace: workspaceId, ...info }, 200, { "Cache-Control": "private, no-store" });
  } catch (error) {
    return failed("WorkspaceDO.info failed", workspaceId, error);
  }
}

/**
 * `GET /health/paging`: whether the paging pipeline proved itself lately (src/watchdog.ts), for the dashboard. Never a
 * URL or an id, and trimmed by who asks (`pagingHealthFor`). Answers 503 when the watchdog itself cannot be reached,
 * which is also degraded.
 */
export async function pagingHealth(
  request: Request,
  env: Env,
  auth: () => Auth,
): Promise<Response> {
  if (!READ_METHODS.includes(request.method)) {
    return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
  }
  let health: PagingHealth;
  try {
    health = await env.WATCHDOG.getByName(WATCHDOG_NAME).health();
  } catch (error) {
    console.error(JSON.stringify({ message: "WatchdogDO.health failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  // D1 or the session failing degrades the answer to `{ status }`, the same as no session, rather than a 500.
  let roles: Role[] = [];
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (session) roles = await memberRoles(env.DB, session.user.id);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "paging health: session lookup failed", error: String(error) }),
    );
  }
  return json(pagingHealthFor(health, roles), 200, {
    // Varies by the session's cookie, so no shared cache may keep it.
    "Cache-Control": "private, no-store",
  });
}

/**
 * What `GET /health/paging` shows, by the asker's roles across workspaces. The pipeline is one per instance, so no
 * single workspace owns it:
 * - no session, or no workspace: `{ status }` only, like `/health`; why and since when would tell an outsider when
 *   pages stop going out;
 * - any member: the reasons and times too, since a responder needs to know they may not be paged.
 * `external` (whether the dead-man check is set up and answering) is never sent: it is the instance operator's
 * business, and with open sign-up any user can own a workspace, so no workspace role can stand in for that operator
 * (Q19). Operators read it in the logs.
 */
export function pagingHealthFor(
  health: PagingHealth,
  roles: readonly Role[],
): Pick<PagingHealth, "status"> & Partial<PagingHealth> {
  if (roles.length === 0) return { status: health.status };
  const { external: _external, ...rest } = health;
  return rest;
}

/** The user's Brigade roles in every workspace they belong to (empty when none). */
async function memberRoles(db: D1Database, userId: string): Promise<Role[]> {
  const { results } = await db
    .prepare(`select role from member where "userId" = ?`)
    .bind(userId)
    .all<{ role: string }>();
  // Better Auth stores several roles comma-separated; Brigade gives each member one, as `memberRole` reads it.
  return results.map((row) => row.role).filter(isRole);
}

/**
 * Better Auth on this Worker's D1 for one request; a new workspace gets its shard provisioned right away.
 * `onWorkspaceCreated` replaces the provisioning (the tests make it fail).
 */
export function workerAuth(
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  request: Request,
  onWorkspaceCreated?: AuthBindings["onWorkspaceCreated"],
): Auth {
  return createAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    waitUntil: (promise) => ctx.waitUntil(promise),
    // The web Worker forwards with the browser's URL, so this is the protocol the browser used.
    secureCookies: new URL(request.url).protocol === "https:",
    onWorkspaceCreated: onWorkspaceCreated ?? provisionWith(env),
    onPasswordReset: signOutWith(env),
    // Made only when a verification email goes out, so other requests never read the email settings.
    get email() {
      return { sender: emailSender(env), dashboardUrl: (env as NotifyEnv).DASHBOARD_URL };
    },
  });
}

/** Tries per workspace at signing a reset account out (`signOutWith`), and the wait before each retry. */
const SIGN_OUT_ATTEMPTS = 3;
const SIGN_OUT_RETRY_MS = 250;

/** An inherited workspace in the takeover notice: what Brigade paused there, or that it could not. */
export type InheritedWorkspace = {
  id: string;
  name: string;
  /** Names of the monitors paused. */
  paused: string[];
  /** Heartbeat URLs that stopped working. */
  revoked: number;
  /** Alert source URLs that stopped working, and alert routes the account created that were disabled. */
  sources?: number;
  routes?: number;
  /** The shard could not be reached: nothing there was paused, and the owner should look. */
  failed: boolean;
};

/**
 * After a password reset (RFC 0002 "Auth"): signs the user out of every workspace they belong to in D1, each shard
 * dropping their devices and closing their sockets (`signOutUser`), tried `SIGN_OUT_ATTEMPTS` times. Never throws:
 * the password is already changed and every session gone. A shard that still fails is logged; its member reconcile
 * (the repair alarm the failure armed, or the next sync upgrade) drops the devices and sockets from before
 * `user.passwordResetAt` instead.
 *
 * On a takeover (`takeOver`: the address was not verified until now), the shard of each workspace where the account is
 * the only member also pauses its monitors and revokes its heartbeat URLs, and the owner is told once
 * (`takeover_notice`, read by `GET /account/takeover`).
 */
export function signOutWith(
  env: Env,
  retryMs = SIGN_OUT_RETRY_MS,
): NonNullable<AuthBindings["onPasswordReset"]> {
  return async (userId, { takeOver, at }) => {
    let workspaces: { id: string; name: string; members: number }[];
    try {
      const { results } = await env.DB.prepare(
        `select m."organizationId" as id, o.name as name,
           (select count(*) from member n where n."organizationId" = m."organizationId") as members
         from member m join organization o on o.id = m."organizationId"
         where m."userId" = ?`,
      )
        .bind(userId)
        .all<{ id: string; name: string; members: number }>();
      workspaces = results.filter((row) => WORKSPACE_ID.test(row.id));
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "reading a reset account's workspaces failed",
          error: String(error),
        }),
      );
      return;
    }
    const inherited = await Promise.all(
      workspaces.map(async (workspace): Promise<InheritedWorkspace | undefined> => {
        const sole = takeOver && workspace.members === 1;
        let failure: unknown;
        for (let attempt = 1; attempt <= SIGN_OUT_ATTEMPTS; attempt++) {
          if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, retryMs * attempt));
          try {
            const result = await env.WORKSPACE.getByName(workspace.id).signOutUser(
              workspace.id,
              userId,
              { takeOver: sole },
            );
            if (!result.ok) {
              // A shard never provisioned has nothing of theirs: no retry changes that.
              failure = result.code;
              break;
            }
            failure = undefined;
            // The shard found another member after all, and took nothing over.
            if (!sole || result.paused === undefined) return undefined;
            const { paused, revoked = 0, sources = 0, routes = 0 } = result;
            return {
              id: workspace.id,
              name: workspace.name,
              paused,
              revoked,
              sources,
              routes,
              failed: false,
            };
          } catch (error) {
            failure = error;
          }
        }
        console.error(
          JSON.stringify({
            message: "signing a reset account out of a workspace failed",
            workspace: workspace.id,
            error: String(failure),
          }),
        );
        return sole
          ? { id: workspace.id, name: workspace.name, paused: [], revoked: 0, failed: true }
          : undefined;
      }),
    );
    const notice = inherited.filter((workspace) => workspace !== undefined);
    if (notice.length === 0) return;
    try {
      await recordNotice(env.DB, userId, notice, at);
    } catch (error) {
      console.error(
        JSON.stringify({ message: "recording the takeover notice failed", error: String(error) }),
      );
    }
  };
}

/** Tries at recording a takeover notice while another reset of the same account records its own. */
const NOTICE_ATTEMPTS = 3;

/**
 * Records the takeover notice, merged into one already there: two resets of the account at once both take it over,
 * and the second finds the monitors already paused, so its list alone would hide what the first paused. Per
 * workspace, the paused names are joined, the larger revoked count kept, and it failed only if both failed. Written
 * only over the row it read, so a reset never overwrites one that wrote in between.
 */
async function recordNotice(
  db: D1Database,
  userId: string,
  notice: InheritedWorkspace[],
  at: number,
): Promise<void> {
  for (let attempt = 1; attempt <= NOTICE_ATTEMPTS; attempt++) {
    const row = await db
      .prepare(`select workspaces from takeover_notice where "userId" = ?`)
      .bind(userId)
      .first<{ workspaces: string }>();
    if (row === null) {
      const inserted = await db
        .prepare(
          `insert into takeover_notice ("userId", workspaces, "createdAt") values (?, ?, ?)
           on conflict ("userId") do nothing`,
        )
        .bind(userId, JSON.stringify(notice), at)
        .run();
      if (inserted.meta.changes === 1) return;
      continue;
    }
    const merged = mergeNotice(JSON.parse(row.workspaces) as InheritedWorkspace[], notice);
    const updated = await db
      .prepare(`update takeover_notice set workspaces = ? where "userId" = ? and workspaces = ?`)
      .bind(JSON.stringify(merged), userId, row.workspaces)
      .run();
    if (updated.meta.changes === 1) return;
  }
  throw new Error("the takeover notice kept changing");
}

function mergeNotice(
  recorded: InheritedWorkspace[],
  notice: InheritedWorkspace[],
): InheritedWorkspace[] {
  const merged = recorded.map((workspace) => ({ ...workspace }));
  for (const workspace of notice) {
    const same = merged.find((one) => one.id === workspace.id);
    if (!same) {
      merged.push(workspace);
      continue;
    }
    same.paused = [...new Set([...same.paused, ...workspace.paused])];
    same.revoked = Math.max(same.revoked, workspace.revoked);
    same.sources = Math.max(same.sources ?? 0, workspace.sources ?? 0);
    same.routes = Math.max(same.routes ?? 0, workspace.routes ?? 0);
    same.failed = same.failed && workspace.failed;
  }
  return merged;
}

/**
 * `GET /account/takeover`: the signed-in user's takeover notice (`signOutWith`), `{ notice: null }` without one;
 * `DELETE` dismisses it. Only ever the session's own.
 */
export async function takeoverNotice(
  request: Request,
  env: Env,
  auth: () => Auth,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "DELETE") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET, DELETE" });
  }
  const origin = request.headers.get("Origin");
  if (request.method === "DELETE" && origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const session = await auth().api.getSession({ headers: request.headers });
    if (!session) return json({ error: "unauthenticated" }, 401);
    if (request.method === "DELETE") {
      await env.DB.prepare(`delete from takeover_notice where "userId" = ?`)
        .bind(session.user.id)
        .run();
      return new Response(null, { status: 204, headers });
    }
    const row = await env.DB.prepare(
      `select workspaces, "createdAt" as at from takeover_notice where "userId" = ?`,
    )
      .bind(session.user.id)
      .first<{ workspaces: string; at: number }>();
    const notice = row
      ? { at: row.at, workspaces: JSON.parse(row.workspaces) as InheritedWorkspace[] }
      : null;
    return json({ notice }, 200, headers);
  } catch (error) {
    console.error(JSON.stringify({ message: "takeover notice failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
}

function provisionWith(env: Env): NonNullable<AuthBindings["onWorkspaceCreated"]> {
  return async ({ id, name, ownerId }) => {
    const result = await env.WORKSPACE.getByName(id).provision(
      { id, name },
      { kind: "user", id: ownerId, role: "owner" },
    );
    if (!result.ok) throw new Error(`Provisioning workspace ${id} failed: ${result.code}`);
  };
}

/**
 * `POST /workspaces` `{ name }`: creates a workspace for the signed-in user, who becomes its owner, and makes
 * it the session's active workspace. Better Auth writes the organization and the membership to D1; its
 * `afterCreateOrganization` hook provisions the shard (`workspace.created` in its outbox); if that fails, the
 * workspace is deleted again and this answers 500.
 */
export async function createWorkspace(request: Request, lazyAuth: () => Auth): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  const origin = request.headers.get("Origin");
  // A cookie-authenticated write: refuse other sites (Better Auth does the same on its own routes).
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const auth = lazyAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  const text = await readBounded(request, MAX_BODY_LENGTH);
  if (text === undefined) return json({ error: "invalid_args" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_args" }, 400);
  }
  const name = workspaceName(
    typeof body === "object" && body !== null ? Reflect.get(body, "name") : undefined,
    "name",
  );
  if (!name.ok) return json({ error: "invalid_args", issues: name.issues }, 400);

  try {
    const workspace = await auth.api.createOrganization({
      // The slug is only a unique handle for now; the id names the shard.
      body: { name: name.value, slug: `ws-${crypto.randomUUID()}` },
      headers: request.headers,
    });
    if (!workspace) return json({ error: "internal" }, 500);
    return json({ id: workspace.id, name: workspace.name }, 201);
  } catch (error) {
    if (Reflect.get(Object(Reflect.get(Object(error), "body")), "code") === WORKSPACE_LIMIT_CODE) {
      return json({ error: "workspace_limit" }, 403);
    }
    console.error(JSON.stringify({ message: "Creating a workspace failed", error: String(error) }));
    return json({ error: "internal" }, 500);
  }
}

/**
 * `PATCH /workspaces/:id/members/:userId` `{ role }` changes a member's role; `DELETE` removes them, or, for one's
 * own id, leaves the workspace (RFC 0003 "Members"). The Worker checks the origin, the session and that the caller
 * is a member; the workspace's shard checks the rules against D1, writes D1, then its own copy and the outbox, and
 * closes the member's sockets (src/members.ts). `not_applied` (503): D1 has the change and the shard not yet; the
 * shard's alarm reconciles it within seconds, and the same request again finishes it sooner.
 */
export async function changeMember(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  userId: string,
): Promise<Response> {
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "PATCH, DELETE" });
  }
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  if (!USER_ID.test(userId)) return json({ error: "not_found" }, 404);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  let change: MemberChange = { kind: "remove" };
  if (request.method === "PATCH") {
    const text = await readBounded(request, MAX_BODY_LENGTH);
    let body: unknown;
    try {
      body = text === undefined ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    const role = typeof body === "object" && body !== null ? Reflect.get(body, "role") : undefined;
    if (!isRole(role)) return json({ error: "invalid_args" }, 400);
    change = { kind: "role", role };
  }

  // Checked here first, so a made-up workspace or an outsider never wakes (or creates) a shard. One exception: a
  // leave D1 already has but the shard missed (`not_applied`) may be sent again by the leaver, so they stop being
  // paged without waiting for the shard's repair; the shard finishes it only if it still has their copy or devices.
  // Every other answer to a non-member is the same 403, whether or not the workspace exists (open question Q16).
  // The leave retry does take longer for a workspace that exists (it asks the shard); that is safe only because a
  // workspace id is a ULID nobody can guess, which `ORGANIZATION_ID` holds this route to.
  let member: boolean;
  try {
    member = (await memberRole(env.DB, workspaceId, session.user.id)) !== undefined;
    if (!member) {
      const retryingLeave =
        request.method === "DELETE" &&
        userId === session.user.id &&
        (await workspaceExists(env.DB, workspaceId));
      if (!retryingLeave) return json({ error: "not_a_member" }, 403);
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  let result: MemberChangeResult;
  try {
    const shard = env.WORKSPACE.getByName(workspaceId);
    result = member
      ? await shard.changeMember(workspaceId, session.user.id, userId, change)
      : await shard.finishLeave(workspaceId, session.user.id);
  } catch (error) {
    return failed("WorkspaceDO.changeMember failed", workspaceId, error);
  }
  if (result.ok) return json({ ok: true });
  if (!member && (result.code === "not_found" || result.code === "forbidden")) {
    return json({ error: "not_a_member" }, 403);
  }
  return json({ error: result.code }, MEMBER_STATUS[result.code]);
}

function invitationAnswer(
  result: { ok: true } | { ok: false; code: InvitationCode },
  status = 200,
): Response {
  if (!result.ok) return json({ error: result.code }, INVITATION_STATUS[result.code]);
  return json(result, status);
}

/** A cookie-authenticated request from another site: refused, as Better Auth does on its own routes. */
function crossSite(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && origin !== new URL(request.url).origin;
}

/** The request's JSON body (at most `MAX_BODY_LENGTH` bytes) as an object, or undefined. */
async function readObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await readBounded(request, MAX_BODY_LENGTH);
  if (text === undefined) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `GET /workspaces/:id/invitations` lists the pending invitations (owners and admins: they are the ones who manage
 * them); `POST` `{ email, role }` invites someone (RFC 0003 "Invitations"). The Worker checks the origin, the
 * session, that the caller is a member and, to invite, that their own address is verified (an invitation is an email
 * from Brigade to an address they typed); the shard checks the rules and limits against D1, writes D1, then its
 * outbox (`member.invited`, which the email notifier sends). Answers 201 with the invitation.
 */
export async function workspaceInvitations(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET, POST" });
  }
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (role === undefined) return json({ error: "not_a_member" }, 403);
  if (!can(role, "members:manage")) return json({ error: "forbidden" }, 403);

  if (request.method === "GET") {
    try {
      return json({ invitations: await listInvitations(env.DB, workspaceId) }, 200, {
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(
        JSON.stringify({ message: "listing invitations failed", error: String(error) }),
      );
      return json({ error: "unavailable" }, 503);
    }
  }

  if (!session.user.emailVerified) return json({ error: "unverified" }, 403);
  const body = await readObject(request);
  const email = invitationEmail(body?.email);
  const invited = body?.role;
  if (!email || !isRole(invited)) return json({ error: "invalid_args" }, 400);
  try {
    const result = await env.WORKSPACE.getByName(workspaceId).invite(
      workspaceId,
      session.user.id,
      email,
      invited,
      new URL(request.url).origin,
    );
    return invitationAnswer(result, 201);
  } catch (error) {
    return failed("WorkspaceDO.invite failed", workspaceId, error);
  }
}

/**
 * `DELETE /workspaces/:id/invitations/:invitationId` revokes a pending invitation; `POST …/resend` sends it again
 * with a new expiry (at most once every five minutes, within the workspace's daily cap). Owners and admins; an admin
 * never touches an invitation to be an owner. The same checks as inviting, then the shard (`invitation.revoked`, or
 * `member.invited` again).
 */
export async function changeInvitation(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  invitationId: string,
  resend: boolean,
): Promise<Response> {
  const method = resend ? "POST" : "DELETE";
  if (request.method !== method)
    return json({ error: "method_not_allowed" }, 405, { Allow: method });
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  if (!isId("inv", invitationId)) return json({ error: "not_found" }, 404);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);
  try {
    if ((await memberRole(env.DB, workspaceId, session.user.id)) === undefined) {
      return json({ error: "not_a_member" }, 403);
    }
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (resend && !session.user.emailVerified) return json({ error: "unverified" }, 403);
  try {
    const shard = env.WORKSPACE.getByName(workspaceId);
    return invitationAnswer(
      resend
        ? await shard.resendInvitation(
            workspaceId,
            session.user.id,
            invitationId,
            new URL(request.url).origin,
          )
        : await shard.revokeInvitation(workspaceId, session.user.id, invitationId),
    );
  } catch (error) {
    return failed("WorkspaceDO invitation change failed", workspaceId, error);
  }
}

/**
 * The invitee's side: `GET /invitations/:id` (what the dashboard's accept page shows: the workspace, who invited,
 * the role, whether it can still be accepted and whether it is for the signed-in address, never the address itself),
 * `POST /invitations/:id/accept` and `POST /invitations/:id/decline`. Signed in, with the invited address, verified;
 * the shard checks it all again against D1 (src/invitations.ts). Accepting answers the workspace id and role, so the
 * dashboard can open it. An invitation id is a ULID nobody can guess: the link in the email is the only way to it.
 */
export async function answerInvitation(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  invitationId: string,
  action: string | undefined,
): Promise<Response> {
  const method = action === undefined ? "GET" : "POST";
  if (request.method !== method)
    return json({ error: "method_not_allowed" }, 405, { Allow: method });
  if (!isId("inv", invitationId)) return json({ error: "not_found" }, 404);
  if (crossSite(request)) return json({ error: "forbidden_origin" }, 403);
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);
  let workspaceId: string | undefined;
  try {
    if (action === undefined) {
      const preview = await previewInvitation(env.DB, invitationId, session.user.email, Date.now());
      if (!preview) return json({ error: "not_found" }, 404);
      return json({ invitation: preview }, 200, { "Cache-Control": "private, no-store" });
    }
    workspaceId = await invitationWorkspace(env.DB, invitationId);
  } catch (error) {
    console.error(JSON.stringify({ message: "invitation lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (workspaceId === undefined) return json({ error: "not_found" }, 404);
  if (!session.user.emailVerified) return json({ error: "unverified" }, 403);
  const invitee = { id: session.user.id, email: session.user.email };
  try {
    const shard = env.WORKSPACE.getByName(workspaceId);
    if (action === "accept") {
      const result = await shard.acceptInvitation(workspaceId, invitationId, invitee);
      // `not_applied`: D1 has the member; the dashboard can open the workspace while the shard catches up.
      if (!result.ok && result.code === "not_applied") {
        return json({ error: "not_applied", workspaceId }, 503);
      }
      if (!result.ok) return invitationAnswer(result);
      const accepted = { ...result, workspaceId };
      return invitationAnswer(accepted);
    }
    return invitationAnswer(await shard.declineInvitation(workspaceId, invitationId, invitee));
  } catch (error) {
    return failed("WorkspaceDO invitation answer failed", workspaceId, error);
  }
}

/**
 * `POST /workspaces/:id/incidents/:incidentId/ack` with an `Idempotency-Key`: acknowledges the incident as the
 * signed-in member, for the app's notification action (RFC 0004 "Clients": plain HTTPS, since iOS suspends sockets
 * in the background). Authenticated like the sync upgrade (the session's cookie, then the member's role in D1) and
 * refused from another site like every cookie-authenticated write; the shard runs `incident.ack` as that member,
 * with its RBAC and its event through the outbox (`WorkspaceDO.acknowledge`). The same key again answers what the
 * first request did, so a retry after a lost answer is not reported as someone else's ack. Answers:
 * 200 acknowledged; 409 `conflict` already acknowledged (by anyone); 409 `invalid_transition` the incident is no
 * longer active; 404 no such incident; 403 `forbidden` (a viewer) or `not_a_member`; 401 without a session.
 */
export async function acknowledgeIncident(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  incidentId: string,
): Promise<Response> {
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  // The charset has no `%`, so nothing here is decoded.
  if (!isId("inc", incidentId)) return json({ error: "not_found" }, 404);
  const key = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (key === null || !TOKEN.test(key)) return json({ error: "invalid_args" }, 400);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);

  // Checked here first, so a made-up workspace or an outsider never wakes (or creates) a shard.
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (role === undefined) return json({ error: "not_a_member" }, 403);

  let result: AckResult;
  try {
    result = await env.WORKSPACE.getByName(workspaceId).acknowledge(
      workspaceId,
      { kind: "user", id: session.user.id, role },
      incidentId,
      key,
    );
  } catch (error) {
    return failed("WorkspaceDO.acknowledge failed", workspaceId, error);
  }
  if (result.ok) return json({ ok: true });
  const status = ACK_STATUS[result.code];
  return json({ error: status === undefined ? "internal" : result.code }, status ?? 500);
}

/**
 * `GET /sync/:workspaceId` with `Upgrade: websocket`: hands the socket to the workspace's shard (RFC 0004
 * "Socket topology"). The Worker authenticates the upgrade (`resolveActor`: 401 without a session, 403 for a
 * non-member or another site's page) and forwards a request it builds itself, carrying only the upgrade, the
 * workspace id and the verified actor (with the member's name and when their password was last reset), so no client
 * header reaches the shard.
 */
async function openSync(
  request: Request,
  env: Env,
  auth: () => Auth,
  workspace: string,
): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!WORKSPACE_ID.test(workspace)) return json({ error: "invalid_workspace_id" }, 400);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "upgrade_required" }, 426, { Upgrade: "websocket" });
  }
  const resolved = await resolveActor(request, env, auth, workspace);
  if (!resolved.ok) return resolved.response;
  // The shard is named by the workspace id alone; entity shards will be `${workspaceId}:${entityId}`.
  const headers = new Headers({
    Upgrade: "websocket",
    [WORKSPACE_HEADER]: workspace,
    [ACTOR_HEADER]: JSON.stringify(resolved.actor),
  });
  if (resolved.name !== undefined) {
    headers.set(MEMBER_NAME_HEADER, encodeURIComponent(resolved.name));
  }
  if (resolved.resetAt !== undefined) headers.set(RESET_AT_HEADER, String(resolved.resetAt));
  try {
    return await env.WORKSPACE.getByName(workspace).fetch(request.url, { headers });
  } catch (error) {
    return failed("WorkspaceDO sync upgrade failed", workspace, error);
  }
}

/**
 * `POST /heartbeat/:token`: a heartbeat monitor's ping (RFC 0007). The token names the workspace and the monitor
 * and carries the secret; the shard compares the secret's SHA-256 with the stored one in constant time. The
 * workspace is looked up in D1 first (`workspaceExists`), so a token for a made-up workspace never wakes, let alone
 * creates, a shard (open question Q16); if D1 itself fails, the ping goes to the shard anyway. Every refusal is the same 404, so a caller cannot tell a wrong secret from a
 * missing monitor or workspace. The body is never read.
 */
export async function receiveHeartbeat(
  request: Request,
  env: Env,
  token: string,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const parsed = parseHeartbeatToken(token);
  if (!parsed || !WORKSPACE_ID.test(parsed.workspaceId)) return json({ error: "not_found" }, 404);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed.secret));
  try {
    if (!(await workspaceExists(env.DB, parsed.workspaceId))) {
      return json({ error: "not_found" }, 404);
    }
  } catch (error) {
    // Fail open: a D1 outage must not drop a real ping and page someone for a missed beat. The shard still
    // checks the secret, so the worst a made-up workspace costs meanwhile is one empty shard.
    console.error(
      JSON.stringify({
        message: "workspace lookup failed; asking the shard",
        workspace: parsed.workspaceId,
        error: String(error),
      }),
    );
  }
  try {
    const accepted = await env.WORKSPACE.getByName(parsed.workspaceId).heartbeat(
      parsed.monitorId,
      digest,
    );
    return accepted ? json({ ok: true }, 202) : json({ error: "not_found" }, 404);
  } catch (error) {
    return failed("WorkspaceDO.heartbeat failed", parsed.workspaceId, error);
  }
}

/** Headers handed to the shard besides the ones it always gets (`ALERT_KEPT_HEADERS`): enough for any provider's. */
const MAX_ALERT_HEADERS = 64;
const MAX_ALERT_HEADER_VALUE = 4096;

/**
 * Headers handed to the shard whatever `MAX_ALERT_HEADERS` leaves out: the ones that authenticate a payload or say
 * what it is. A source's own header (`auth`) is among the first `MAX_ALERT_HEADERS` others (RFC 0005).
 */
function keptHeader(name: string): boolean {
  return (
    name === "authorization" ||
    name === "x-grafana-alerting-signature" ||
    name.startsWith("sentry-hook-")
  );
}

/** The headers the shard reads a payload with: lower-cased, cookies never, values bounded. */
function alertHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  let others = 0;
  for (const [name, value] of request.headers) {
    if (name === "cookie") continue;
    if (!keptHeader(name) && others++ >= MAX_ALERT_HEADERS) continue;
    headers[name] = value.slice(0, MAX_ALERT_HEADER_VALUE);
  }
  return headers;
}

/**
 * Tokens the shard refused lately, per isolate, by their SHA-256 (hex), until they expire: once a workspace's
 * `ALERT_REFUSED_LIMIT` runs out, the same wrong token is answered here without waking the shard. Only refused tokens
 * go in, so the real source's never does.
 */
const refusedTokens = new Map<string, number>();
const REFUSED_TOKEN_MS = 60 * 1000;
const REFUSED_TOKENS_MAX = 10_000;

/**
 * Tokens the shard accepted lately, per isolate, by their SHA-256 (hex), least recently used first, until they
 * expire: a source that is sending skips `ALERT_WORKSPACE_LIMIT`, so a flood of made-up secrets for its workspace
 * (which spends that bucket) never holds a real alert back. It still spends its source's `ALERT_LIMIT` in the shard,
 * which checks its secrets again. Only the shard puts a token in (it matched), so a guessed one never is; a token it
 * refuses is taken out.
 */
const acceptedTokens = new Map<string, number>();
const ACCEPTED_TOKEN_MS = 60 * 60 * 1000;
const ACCEPTED_TOKENS_MAX = 10_000;

/** Whether `tokenKey` was accepted lately, moving it to the most recently used end. */
function acceptedLately(tokenKey: string): boolean {
  const until = acceptedTokens.get(tokenKey);
  if (until === undefined) return false;
  acceptedTokens.delete(tokenKey);
  if (until <= Date.now()) return false;
  acceptedTokens.set(tokenKey, until);
  return true;
}

function accepted(tokenKey: string): void {
  acceptedTokens.delete(tokenKey);
  if (acceptedTokens.size >= ACCEPTED_TOKENS_MAX) {
    acceptedTokens.delete(acceptedTokens.keys().next().value!);
  }
  acceptedTokens.set(tokenKey, Date.now() + ACCEPTED_TOKEN_MS);
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * `POST /alerts/:token`: an alert source's payload (RFC 0005 "Alert sources"). Like a heartbeat, the token names the
 * workspace and the source and carries the secret, of which the shard keeps only the SHA-256; the workspace is
 * looked up in D1 first, so a made-up one wakes no shard (a D1 failure asks the shard anyway, as for a heartbeat).
 * At most `MAX_ALERT_BODY` bytes are read. The shard checks the secret, the source's header and the provider's
 * signature (over the bytes as sent): every refusal, here or there, is the same 404. A payload Brigade cannot read is
 * still accepted, and pages (src/alert-intake.ts).
 *
 * Rate limits (Workers Rate Limiting, approximate and per location, each failing open): the workspace's
 * `ALERT_WORKSPACE_LIMIT` before its shard wakes, spent only by tokens this isolate has not seen accepted lately
 * (`acceptedTokens`), so a flood of made-up secrets spends it and wakes the shard at most that often, while a source
 * already sending flows past it; the source's `ALERT_LIMIT` in the shard, once the secrets matched; and
 * `ALERT_REFUSED_LIMIT`, which counts the workspace's refused requests apart, so wrong secrets never spend the
 * source's budget, and once it runs out a token refused lately is refused here. Over a limit is `503` with
 * `Retry-After`, never `429`: Datadog retries a 5xx, not a 429, and a dropped alert is worse than a late one.
 */
export async function receiveAlerts(request: Request, env: Env, token: string): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const parsed = parseAlertSourceToken(token);
  if (!parsed || !WORKSPACE_ID.test(parsed.workspaceId)) return json({ error: "not_found" }, 404);
  try {
    if (!(await workspaceExists(env.DB, parsed.workspaceId))) {
      return json({ error: "not_found" }, 404);
    }
  } catch (error) {
    // Fail open: a D1 outage must not drop a real alert. The shard still checks the secret.
    console.error(
      JSON.stringify({
        message: "workspace lookup failed; asking the shard",
        workspace: parsed.workspaceId,
        error: String(error),
      }),
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parsed.secret));
  const tokenKey = `${parsed.workspaceId}:${parsed.sourceId}:${toHex(digest)}`;
  const refusedUntil = refusedTokens.get(tokenKey);
  if (refusedUntil !== undefined && refusedUntil > Date.now())
    return json({ error: "not_found" }, 404);
  if (
    !acceptedLately(tokenKey) &&
    !(await limited(env.ALERT_WORKSPACE_LIMIT, parsed.workspaceId, "alert workspace rate limit"))
  ) {
    return json({ error: "unavailable" }, 503, { "Retry-After": "60" });
  }
  const body = await readBoundedBytes(request, MAX_ALERT_BODY);
  if (body === undefined) return json({ error: "too_large" }, 413);
  try {
    const result = await env.WORKSPACE.getByName(parsed.workspaceId).alert(
      parsed.sourceId,
      digest,
      body,
      alertHeaders(request),
    );
    // Accepted, ignored and busy all mean the secrets matched.
    if (result.status === "not_found") acceptedTokens.delete(tokenKey);
    else accepted(tokenKey);
    switch (result.status) {
      case "accepted":
        return json({ ok: true, alerts: result.alerts, malformed: result.malformed }, 202);
      case "ignored":
        return json({ ok: true, alerts: 0 }, 202);
      case "busy":
        return json({ error: "unavailable" }, 503, { "Retry-After": "60" });
      default:
        await refused(env, parsed.workspaceId, tokenKey);
        return json({ error: "not_found" }, 404);
    }
  } catch (error) {
    return failed("WorkspaceDO.alert failed", parsed.workspaceId, error);
  }
}

/** Spends one of `key`'s requests on `limiter`; true when there was one left, or the limiter failed (fail open). */
async function limited(limiter: RateLimit, key: string, what: string): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (error) {
    console.error(JSON.stringify({ message: `${what} failed`, key, error: String(error) }));
    return true;
  }
}

/**
 * Counts a refused request against the workspace's `ALERT_REFUSED_LIMIT`; past it, the token is remembered as refused
 * for `REFUSED_TOKEN_MS`, so sending it again wakes no shard.
 */
async function refused(env: Env, workspace: string, tokenKey: string): Promise<void> {
  if (await limited(env.ALERT_REFUSED_LIMIT, workspace, "alert refused rate limit")) return;
  // Oldest first: a Map iterates in insertion order.
  if (refusedTokens.size >= REFUSED_TOKENS_MAX) {
    refusedTokens.delete(refusedTokens.keys().next().value!);
  }
  refusedTokens.delete(tokenKey);
  refusedTokens.set(tokenKey, Date.now() + REFUSED_TOKEN_MS);
}

/** Largest `POST /receipts` body read, in bytes: a token and its JSON. */
const MAX_RECEIPT_BODY = 1024;

/**
 * `POST /receipts` with `{ "token": "…" }`: the phone's Notification Service Extension says it opened a page (RFC
 * 0006 "Delivery receipts"). No session: the token, sealed inside that page for that device alone, is the proof,
 * and only the shard that minted it can check it. The Worker reads at most `MAX_RECEIPT_BODY` bytes and only the
 * workspace the token names, checks that workspace exists (a made-up one costs a D1 read, no Durable Object; a D1
 * outage asks the shard anyway, as for a heartbeat), holds each workspace and address to `RECEIPT_LIMIT` before it
 * wakes the shard, and hands the token over. Answers say only whether it was recorded, never whose page it was.
 */
export async function receiveReceipt(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  }
  const text = await readBounded(request, MAX_RECEIPT_BODY);
  if (text === undefined) return json({ error: "too_large" }, 413);
  let token: unknown;
  try {
    token = Reflect.get(Object(JSON.parse(text)), "token");
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  const workspace = receiptWorkspace(token);
  if (workspace === undefined) return json({ error: "invalid" }, RECEIPT_STATUS.invalid);
  try {
    if (!(await workspaceExists(env.DB, workspace))) {
      return json({ error: "invalid" }, RECEIPT_STATUS.invalid);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "workspace lookup failed; asking the shard",
        workspace,
        error: String(error),
      }),
    );
  }
  if (!(await receiptAllowed(env, workspace, request))) {
    return json({ error: "rate_limited" }, RECEIPT_STATUS.rate_limited);
  }
  try {
    const result = await env.WORKSPACE.getByName(workspace).receipt(token as string);
    const status = RECEIPT_STATUS[result];
    return status === 200 ? json({ ok: true }) : json({ error: result }, status);
  } catch (error) {
    return failed("WorkspaceDO.receipt failed", workspace, error);
  }
}

/**
 * Whether a receipt for `workspace` may wake its shard: the `RECEIPT_LIMIT` binding (Workers Rate Limiting,
 * wrangler.jsonc), keyed on the workspace and the caller's address. Genuine tokens and junk ones look alike until the
 * shard checks the MAC, so this is what keeps a flood of well-formed junk for a real workspace from waking its shard
 * without limit. Approximate and per Cloudflare location (accepted, RFC 0006 "Delivery receipts"); a limiter that
 * fails lets the receipt through, since the shard has its own per-device rate.
 */
async function receiptAllowed(env: Env, workspace: string, request: Request): Promise<boolean> {
  const address = request.headers.get("cf-connecting-ip");
  try {
    const { success } = await env.RECEIPT_LIMIT.limit({
      key: address ? `${workspace}:${address}` : workspace,
    });
    return success;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "receipt rate limit failed", workspace, error: String(error) }),
    );
    return true;
  }
}

/** Workspaces seen in D1, per isolate, until the time they expire: a ping a minute is not a D1 read a minute. */
const knownWorkspaces = new Map<string, number>();
const KNOWN_WORKSPACE_MS = 10 * 60 * 1000;
const KNOWN_WORKSPACES_MAX = 10_000;

/**
 * Whether a Better Auth organization (a workspace) has this id. Only a hit is cached: a made-up id costs one
 * indexed D1 read, and no Durable Object.
 */
export async function workspaceExists(
  db: D1Database,
  id: string,
  now = Date.now(),
): Promise<boolean> {
  const expires = knownWorkspaces.get(id);
  if (expires !== undefined && expires > now) return true;
  const row = await db
    .prepare('select 1 as found from "organization" where "id" = ?')
    .bind(id)
    .first();
  if (!row) {
    knownWorkspaces.delete(id);
    return false;
  }
  // Oldest first: a Map iterates in insertion order.
  if (knownWorkspaces.size >= KNOWN_WORKSPACES_MAX) {
    knownWorkspaces.delete(knownWorkspaces.keys().next().value!);
  }
  knownWorkspaces.delete(id);
  knownWorkspaces.set(id, now + KNOWN_WORKSPACE_MS);
  return true;
}

function failed(message: string, workspace: string, error: unknown): Response {
  const retryable = flag(error, "retryable");
  const overloaded = flag(error, "overloaded");
  console.error(
    JSON.stringify({ message, workspace, retryable, overloaded, error: String(error) }),
  );
  return retryable || overloaded
    ? json({ error: "unavailable" }, 503)
    : json({ error: "internal" }, 500);
}

/** Durable Object errors carry boolean `retryable` / `overloaded` properties. */
function flag(error: unknown, name: "retryable" | "overloaded"): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    name in error &&
    Reflect.get(error, name) === true
  );
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
