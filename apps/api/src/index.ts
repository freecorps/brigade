import { TOKEN } from "@freecorps/brigade-sync/protocol";
import {
  can,
  invitationEmail,
  isId,
  isRole,
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
import { receiptWorkspace, type ReceiptResult } from "./receipts.ts";
import { beginSlackInstall } from "./slack-bridge.ts";
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
/** A user id as Better Auth makes them here (`usr_<ULID>`), or older plain ids: no encoding, bounded. */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INVITATIONS_PATH = /^\/workspaces\/([^/]+)\/invitations$/;
const INVITATION_PATH = /^\/workspaces\/([^/]+)\/invitations\/([^/]+?)(\/resend)?$/;
const INVITEE_PATH = /^\/invitations\/([^/]+?)(?:\/(accept|decline))?$/;
const ACK_PATH = /^\/workspaces\/([^/]+)\/incidents\/([^/]+)\/ack$/;
const SLACK_INSTALL_PATH = /^\/workspaces\/([^/]+)\/slack\/install$/;
const SYNC_PATH = /^\/sync\/([^/]+)$/;
const HEARTBEAT_PATH = /^\/heartbeat\/([^/]+)$/;
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
    const heartbeat = HEARTBEAT_PATH.exec(pathname)?.[1];
    if (heartbeat !== undefined) return receiveHeartbeat(request, env, heartbeat);
    if (pathname === "/receipts") return receiveReceipt(request, env);

    if (pathname === "/health/paging") return pagingHealth(request, env, auth);
    if (pathname === "/account/takeover") return takeoverNotice(request, env, auth);

    const workspace = WORKSPACE_PATH.exec(pathname)?.[1];
    if (pathname !== "/health" && workspace === undefined) return json({ error: "not_found" }, 404);
    if (!READ_METHODS.includes(request.method)) {
      return json({ error: "method_not_allowed" }, 405, { Allow: READ_METHODS.join(", ") });
    }

    if (workspace === undefined) return json({ ok: true });
    // Checked before any decoding: the charset has no `%`, so encoded or malformed input is rejected.
    if (!WORKSPACE_ID.test(workspace)) return json({ error: "invalid_workspace_id" }, 400);
    // Dev-only placeholder with no auth: it must sit behind auth (or be removed) before any route
    // or workers_dev is enabled.
    try {
      const info = await env.WORKSPACE.getByName(workspace).info();
      return json({ workspace, ...info });
    } catch (error) {
      return failed("WorkspaceDO.info failed", workspace, error);
    }
  },

  /**
   * `brigade-events` (RFC 0005): the shards' drained outboxes, routed to notifiers (src/notify.ts); and its
   * dead-letter queue, `brigade-events-dlq`, where what the first gave up on is recorded.
   */
  async queue(batch, env): Promise<void> {
    if (batch.queue.startsWith("brigade-events-dlq")) await consumeDeadLetters(batch, env);
    else await consumeEvents(batch, env);
  },

  /**
   * The dead-man switch's clock (RFC 0007 "Watching the watcher"): one heartbeat a minute into the watchdog's outbox
   * (src/watchdog.ts). A failure throws, so the Cron Trigger's past events show it, and the silence it leaves trips
   * the external check.
   */
  async scheduled(_controller, env): Promise<void> {
    await env.WATCHDOG.getByName(WATCHDOG_NAME).beat();
  },
} satisfies ExportedHandler<Env>;

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
            const { paused, revoked = 0 } = result;
            return { id: workspace.id, name: workspace.name, paused, revoked, failed: false };
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
  const status = {
    forbidden: 403,
    not_found: 404,
    last_owner: 409,
    conflict: 409,
    unavailable: 503,
    not_applied: 503,
  }[result.code];
  return json({ error: result.code }, status);
}

/** The answer for each invitation refusal (src/invitations.ts `InvitationCode`). */
const INVITATION_STATUS: Record<InvitationCode, number> = {
  forbidden: 403,
  wrong_email: 403,
  unverified: 403,
  already_member: 409,
  already_invited: 409,
  limit_reached: 409,
  workspace_full: 409,
  workspace_limit: 409,
  conflict: 409,
  rate_limited: 429,
  address_limited: 429,
  inviter_limited: 429,
  send_limit: 409,
  too_soon: 429,
  not_found: 404,
  expired: 410,
  unavailable: 503,
  not_applied: 503,
};

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

/** The answer for each refusal of an ack; anything else (`internal`, `unknown_mutation`) is a 500. */
const ACK_STATUS: Partial<Record<Exclude<AckResult, { ok: true }>["code"], number>> = {
  conflict: 409,
  invalid_transition: 409,
  not_found: 404,
  forbidden: 403,
  not_a_member: 403,
  invalid_args: 400,
};

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

/** Largest `POST /receipts` body read, in bytes: a token and its JSON. */
const MAX_RECEIPT_BODY = 1024;

/** How each receipt result answers the phone: it only logs the status, and never retries a 4xx. */
const RECEIPT_STATUS: Record<ReceiptResult, number> = {
  recorded: 200,
  already: 200,
  invalid: 403,
  expired: 410,
  not_found: 404,
  rate_limited: 429,
};

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

/**
 * The body as text, or undefined once it passes `max` bytes: a declared `Content-Length` over the limit is refused
 * unread, and a stream (no length, or a wrong one) is read only up to the limit.
 */
async function readBounded(request: Request, max: number): Promise<string | undefined> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
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
