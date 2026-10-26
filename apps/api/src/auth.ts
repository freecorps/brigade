// Better Auth on Workers + D1 (RFC 0002, RFC 0003): users, sessions and workspace membership. A workspace is a
// Better Auth organization; its roles and permissions are Brigade's own table from packages/schema, so the API,
// the sync engine and the UI check the same grants.
//
// Kept free of Workers imports: bindings come in as arguments. test/migrations.test.ts checks that migrations/
// creates exactly what these options need, and prints the SQL for anything missing.

import {
  memberName,
  newId,
  roles,
  SESSION_LIFETIME_S,
  statement,
  workspaceName,
  type RandomBytes,
} from "@freecorps/brigade-schema";
import { isLocale, resolveLocale } from "@freecorps/brigade-i18n";
import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { dashboardLink, renderVerificationEmail } from "./email-templates.ts";
import { linkFallback, type EmailSender } from "./email.ts";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

/** Where the API Worker serves Better Auth; the dashboard reaches it as `/api/auth` (apps/web/worker). */
export const AUTH_BASE_PATH = "/auth";

/** Brigade's permissions next to Better Auth's own (organization, member, invitation, team, ac). */
export const ac = createAccessControl({ ...defaultStatements, ...statement });

/**
 * Owners and admins also manage the workspace through Better Auth (members, invitations), with the plugin's own
 * grants for those two roles; responders and viewers get Brigade's grants only.
 */
export const authRoles = {
  owner: ac.newRole({ ...ownerAc.statements, ...grants(roles.owner) }),
  admin: ac.newRole({ ...adminAc.statements, ...grants(roles.admin) }),
  responder: ac.newRole(grants(roles.responder)),
  viewer: ac.newRole(grants(roles.viewer)),
};

/** A mutable copy of a role's grants, as `newRole` takes them. */
function grants<G extends { readonly [resource: string]: readonly string[] }>(
  role: G,
): { -readonly [R in keyof G]: G[R][number][] } {
  return Object.fromEntries(
    Object.entries(role).map(([resource, actions]) => [resource, [...actions]]),
  ) as { -readonly [R in keyof G]: G[R][number][] };
}

/** RFC 0003 prefixed ULIDs for Better Auth's rows: `usr_…`, `ws_…` (a workspace is an organization), … */
const ID_PREFIXES: Record<string, string> = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  organization: "ws",
  member: "mem",
  invitation: "inv",
  team: "team",
  teamMember: "tmm",
  organizationRole: "role",
  rateLimit: "rl",
};

export function authId(model: string, now: number, random: RandomBytes): string {
  const prefix =
    ID_PREFIXES[model] ??
    (model
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 8) ||
      "id");
  return newId(prefix.length < 2 ? `${prefix}x` : prefix, now, random);
}

export type AuthBindings = {
  /** The D1 database (the `DB` binding): Better Auth's tables, and the counters and clean-ups Brigade runs there. */
  database: D1Database;
  secret: string;
  /** Runs promises after the response (`ctx.waitUntil`). */
  waitUntil?: (promise: Promise<unknown>) => void;
  /**
   * Whether the request came over HTTPS: cookies then get the `Secure` attribute and the `__Secure-` prefix.
   * Better Auth would otherwise decide from `NODE_ENV === "production"`, which Workers never set.
   */
  secureCookies?: boolean;
  /**
   * Called once Better Auth has created a workspace (provisions its shard). If it throws, the workspace is
   * deleted again (see createAuth) and the request fails, so no workspace exists without its shard.
   */
  onWorkspaceCreated?: (workspace: { id: string; name: string; ownerId: string }) => Promise<void>;
  /**
   * The email sender (`emailSender(env)`), for verification emails; none when email is not set up, and then none is
   * sent (and asking again answers `EMAIL_NOT_CONFIGURED`). `dashboardUrl`: the dashboard's origin for the link;
   * without it only the dev log sender uses the origin the request came through (`linkFallback`), and a real one
   * sends nothing.
   */
  email?: { sender: EmailSender | undefined; dashboardUrl?: string };
};

/**
 * Requests per window for Better Auth's routes, counted per client IP and path in D1 (the `rateLimit` table), so
 * every isolate sees the same counts. Better Auth's own stricter rules still apply on top: 3 per 10 s for
 * `/sign-in/*`, `/sign-up/*`, `/change-password` and `/change-email`.
 */
export const RATE_LIMIT = { window: 60, max: 100 };
/**
 * Reads the dashboard makes on every load: never limited (and no D1 write each), so a team behind one office or
 * carrier NAT opening the dashboard during an incident cannot hit 429.
 */
export const UNLIMITED_READS = [
  "/get-session",
  "/organization/get-full-organization",
  "/organization/get-active-member",
  "/organization/list",
] as const;
/**
 * The mobile app's origin (its `brigade://` scheme, apps/mobile/app.config.ts). The app has no web origin: its Better
 * Auth client (`@better-auth/expo`) sends this as `expo-origin`, which the `expo()` plugin copies to `Origin` when a
 * request has none, so Better Auth's origin check on sign-in and sign-out passes for the app and still refuses any
 * other site. A browser page cannot send it: browsers set `Origin` themselves, and the plugin never replaces one.
 */
export const APP_ORIGIN = "brigade://";
/** How long an email verification link works, in seconds. */
export const VERIFICATION_TTL_S = 24 * 60 * 60;
/**
 * Verification emails one signed-in user may ask for again (`/send-verification-email`) per window, on top of the
 * per-IP rule (`VERIFICATION_IP_LIMIT`): counted per user in D1's `rateLimit` table, so asking from many addresses
 * floods nobody's inbox. The one sent at sign-up does not count. `VERIFICATION_DAILY_LIMIT` bounds a day of them, so
 * an account squatting someone else's address cannot keep mailing it 3 times every 15 minutes.
 */
export const VERIFICATION_RESEND_LIMIT = { window: 15 * 60, max: 3 };
export const VERIFICATION_DAILY_LIMIT = { window: 24 * 60 * 60, max: 5 };
/**
 * How old an unverified account must be before a new sign-up with its address replaces it (`releaseSquatted`): long
 * past its verification link (`VERIFICATION_TTL_S`), so its owner had every chance to confirm it.
 */
export const UNVERIFIED_RELEASE_S = 24 * 60 * 60;
export const VERIFICATION_IP_LIMIT = { window: 60, max: 3 };
/** The answer when a verification email is asked for and email is not set up. */
export const EMAIL_NOT_CONFIGURED_CODE = "EMAIL_NOT_CONFIGURED";
/** Workspaces one user may belong to; bounds `POST /workspaces` (each one also provisions a shard). */
export const WORKSPACE_LIMIT = 10;
/** Better Auth's routes that set a user's name. */
export const NAME_PATHS = ["/sign-up/email", "/update-user"] as const;
/** The error code when a name breaks `memberName`. */
export const INVALID_NAME_CODE = "INVALID_NAME";
/** The error code when a locale is not one Brigade has (`locales` in packages/i18n). */
export const INVALID_LOCALE_CODE = "INVALID_LOCALE";

/**
 * Checks a name before Better Auth stores it, with the rule the shard's member list keeps names by (`memberName`:
 * no bidi or other invisible characters, joiners only between letters, at most `MEMBER_NAME_MAX`), and stores it
 * trimmed. Better Auth itself takes any string. Likewise the user's `locale` (the language emails are written in,
 * RFC 0008): one of Brigade's locales exactly, or null on `/update-user` to unset it; a sign-up without one takes
 * the closest to the request's first `Accept-Language`, if any.
 */
const beforeHook = (bindings: AuthBindings) =>
  createAuthMiddleware(async (ctx) => {
    if (ctx.path === "/send-verification-email") {
      // Only for oneself: Better Auth would otherwise email any unverified address it is given, signed in or not.
      const session = await getSessionFromCtx(ctx);
      if (!session)
        throw APIError.from("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Sign in" });
      if (!bindings.email?.sender) {
        throw APIError.from("SERVICE_UNAVAILABLE", {
          code: EMAIL_NOT_CONFIGURED_CODE,
          message: "Email is not set up",
        });
      }
      // Better Auth refuses these itself; only an email that goes out counts.
      const email: unknown = Reflect.get(Object(ctx.body), "email");
      if (
        session.user.emailVerified ||
        typeof email !== "string" ||
        email.toLowerCase() !== session.user.email.toLowerCase()
      ) {
        return;
      }
      const now = Date.now();
      for (const [key, limit] of [
        [`verify:${session.user.id}`, VERIFICATION_RESEND_LIMIT],
        [`verify-day:${session.user.id}`, VERIFICATION_DAILY_LIMIT],
      ] as const) {
        if ((await countRequest(bindings.database, key, limit.window, now)) > limit.max) {
          throw APIError.from("TOO_MANY_REQUESTS", {
            code: "TOO_MANY_REQUESTS",
            message: "Too many verification emails",
          });
        }
      }
      return;
    }
    if (ctx.path === "/sign-up/email") await releaseSquatted(ctx, bindings.database);
    return checkName(ctx);
  });

/**
 * Counts one more request under `key` in D1's `rateLimit` table and answers the count in the current window
 * (`window` seconds from its first request). One statement, so requests at once each get their own count.
 */
async function countRequest(
  db: D1Database,
  key: string,
  window: number,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      `insert into "rateLimit" (id, key, count, "lastRequest") values (?1, ?2, 1, ?3)
       on conflict (key) do update set
         count = case when ?3 - "lastRequest" > ?4 then 1 else count + 1 end,
         "lastRequest" = case when ?3 - "lastRequest" > ?4 then ?3 else "lastRequest" end
       returning count`,
    )
    // The window starts at the first request in it, so `lastRequest` moves only when a new one starts.
    .bind(authId("rateLimit", now, randomBytes), key, now, window * 1000)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

const randomBytes: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/**
 * A sign-up with the address of an account nobody verified, older than `UNVERIFIED_RELEASE_S`, replaces that account
 * (RFC 0002 "Auth"): otherwise anyone could hold someone else's address forever by signing up with it first. The old
 * user goes with its sessions, accounts and memberships; a workspace they were alone in is left without members (its
 * D1 row and shard stay, unreachable, as deleting a workspace is not designed yet). An account in a workspace with
 * anyone else is kept, and the sign-up is refused as for any taken address: removing it would take a member from
 * people who may count on them. Never throws for the sign-up's sake: a failure leaves the old account in place.
 */
async function releaseSquatted(
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  db: D1Database,
): Promise<void> {
  const email: unknown = Reflect.get(Object(ctx.body), "email");
  if (typeof email !== "string") return;
  try {
    const user = await db
      .prepare(`select id, "emailVerified", "createdAt" from "user" where email = ?`)
      .bind(email.trim().toLowerCase())
      .first<{ id: string; emailVerified: number; createdAt: string }>();
    if (!user || user.emailVerified === 1) return;
    if (Date.now() - Date.parse(user.createdAt) < UNVERIFIED_RELEASE_S * 1000) return;
    const shared = await db
      .prepare(
        `select count(*) as n from member m
         where m."userId" = ?1
           and exists (select 1 from member o where o."organizationId" = m."organizationId" and o."userId" != ?1)`,
      )
      .bind(user.id)
      .first<{ n: number }>();
    if ((shared?.n ?? 1) > 0) return;
    // Still unverified in the same batch: a link opened meanwhile keeps the account.
    const unverified = `(select "emailVerified" from "user" where id = ?1) = 0`;
    await db.batch([
      db.prepare(`delete from session where "userId" = ?1 and ${unverified}`).bind(user.id),
      db.prepare(`delete from account where "userId" = ?1 and ${unverified}`).bind(user.id),
      db.prepare(`delete from member where "userId" = ?1 and ${unverified}`).bind(user.id),
      db.prepare(`delete from "user" where id = ?1 and "emailVerified" = 0`).bind(user.id),
    ]);
    console.log(JSON.stringify({ message: "unverified account replaced by a new sign-up" }));
  } catch (error) {
    console.error(
      JSON.stringify({ message: "releasing an unverified account failed", error: String(error) }),
    );
  }
}

const checkName = async (ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) => {
  if (!(NAME_PATHS as readonly string[]).includes(ctx.path)) return;
  const body: unknown = ctx.body;
  if (typeof body !== "object" || body === null) return;
  const checked: Record<string, unknown> = {};
  if ("name" in body) {
    const name = memberName(body.name, "name");
    if (!name.ok) {
      throw APIError.from("BAD_REQUEST", { code: INVALID_NAME_CODE, message: "Invalid name" });
    }
    checked.name = name.value;
  }
  if ("locale" in body && body.locale !== undefined) {
    // null on `/update-user` unsets it (back to English); a sign-up without one leaves it out.
    const unset = body.locale === null && ctx.path === "/update-user";
    if (!unset && !isLocale(body.locale)) {
      throw APIError.from("BAD_REQUEST", { code: INVALID_LOCALE_CODE, message: "Invalid locale" });
    }
  } else if (ctx.path === "/sign-up/email") {
    const wanted = ctx.headers?.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim();
    if (wanted) checked.locale = resolveLocale(wanted);
  }
  if (Object.keys(checked).length === 0) return;
  return { context: { body: { ...body, ...checked } } };
};

/**
 * Where the verification page sends the user after: a dashboard path of Brigade's own (the invitation they were
 * answering), never another site. Undefined for anything else.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^\/invitations\/inv_[0-9A-HJKMNP-TV-Z]{26}$/.test(value) ? value : undefined;
}

export function authOptions(bindings: AuthBindings, store?: WorkspaceStore) {
  const random = randomBytes;
  return {
    appName: "Brigade",
    basePath: AUTH_BASE_PATH,
    secret: bindings.secret,
    database: bindings.database,
    // Unverified accounts sign in and use their own workspaces; verification gates email, inviting and joining
    // (RFC 0002 "Auth").
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: VERIFICATION_TTL_S,
      // Never awaited by the request (Better Auth runs it in `backgroundTasks`), and never throws.
      sendVerificationEmail: async ({ user, token, url }, request) => {
        const sender = bindings.email?.sender;
        if (!sender) return;
        const next = safeNext(new URL(url).searchParams.get("callbackURL"));
        const link = dashboardLink(
          "/verify-email",
          { token, ...(next ? { next } : {}) },
          bindings.email?.dashboardUrl,
          linkFallback(sender, request ? new URL(request.url).origin : undefined),
        );
        if (!link) {
          console.error(
            JSON.stringify({ message: "verification email not sent: DASHBOARD_URL is not set" }),
          );
          return;
        }
        const locale = Reflect.get(user, "locale");
        // Never the name: whoever signs up types it, and this goes to an address nobody proved yet.
        const result = await sender.send(
          renderVerificationEmail(
            { email: user.email },
            link,
            resolveLocale(typeof locale === "string" ? locale : undefined),
          ),
        );
        if (!result.ok) {
          console.error(
            JSON.stringify({
              message: "verification email refused",
              sender: sender.id,
              code: result.code,
            }),
          );
        }
      },
    },
    // The language Brigade writes to the user in (emails, RFC 0008); null: English. Checked by `checkName`.
    user: {
      additionalFields: {
        locale: { type: "string", required: false, input: true },
      },
    },
    // The dashboard is same-origin (Better Auth trusts its own base URL); the mobile app is `APP_ORIGIN`.
    trustedOrigins: [APP_ORIGIN],
    hooks: { before: beforeHook(bindings) },
    // Stated, not left to the default: the mobile app keeps a session from an offline sign-out this long at most.
    session: { expiresIn: SESSION_LIFETIME_S },
    // Off by default on Workers (Better Auth enables it only when NODE_ENV is "production"). The in-memory store
    // would count per isolate, so the counts live in D1.
    rateLimit: {
      enabled: true,
      storage: "database",
      ...RATE_LIMIT,
      customRules: {
        ...Object.fromEntries(UNLIMITED_READS.map((path) => [path, false as const])),
        "/send-verification-email": VERIFICATION_IP_LIMIT,
      },
    },
    databaseHooks: {
      session: {
        create: {
          // A new session starts in the user's first workspace, so signing in lands on it.
          before: async (session, ctx) => {
            const [member] =
              (await ctx?.context.adapter.findMany<{ organizationId: string }>({
                model: "member",
                where: [{ field: "userId", value: session.userId }],
                sortBy: { field: "createdAt", direction: "asc" },
                limit: 1,
              })) ?? [];
            return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
          },
        },
      },
    },
    // Nothing leaves the deployment.
    telemetry: { enabled: false },
    advanced: {
      database: {
        generateId: ({ model }) => authId(model, Date.now(), random),
        // A new instance per request would read D1's table metadata on every request; test/migrations.test.ts
        // checks the schema once instead.
        validateSchema: false,
      },
      useSecureCookies: bindings.secureCookies ?? false,
      // Set by Cloudflare on every request (a client cannot forge it) and passed on by the web Worker's service
      // binding; Better Auth's default, `x-forwarded-for`, is whatever the client sends.
      // Without it (a future caller that builds a fresh Request) every client would share one bucket per path:
      // keep the header on any new path into this Worker.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(bindings.waitUntil ? { backgroundTasks: { handler: bindings.waitUntil } } : {}),
    },
    plugins: [
      // The mobile app (RFC 0002): its session lives in the phone's secure storage and travels as a `Cookie` header
      // it sets itself, on these routes and on the sync upgrade (src/actor.ts).
      expo(),
      organization({
        ac,
        roles: authRoles,
        creatorRole: "owner",
        organizationLimit: WORKSPACE_LIMIT,
        // A workspace outlives its D1 row (its shard, its incidents); deleting one is not designed yet.
        disableOrganizationDeletion: true,
        organizationHooks: {
          // The same check as `POST /workspaces`, for any path that reaches Better Auth's create.
          beforeCreateOrganization: async ({ organization: workspace }) => {
            const name = workspaceName(workspace.name, "name");
            if (!name.ok) {
              throw APIError.from("BAD_REQUEST", {
                code: "INVALID_WORKSPACE_NAME",
                message: "Invalid workspace name",
              });
            }
            return { data: { ...workspace, name: name.value } };
          },
          // Runs before Better Auth makes the workspace active in the session, so undoing it here leaves nothing.
          afterCreateOrganization: async ({ organization: workspace, user }) => {
            // Better Auth counts before it inserts, with no transaction, so parallel creates can all pass
            // `organizationLimit`. Count again now: keep the user's first WORKSPACE_LIMIT, undo any later one.
            if (store && (await store.rank(user.id, workspace.id)) >= WORKSPACE_LIMIT) {
              await store.undo(workspace.id);
              throw APIError.from("FORBIDDEN", {
                code: WORKSPACE_LIMIT_CODE,
                message: "You have reached the maximum number of workspaces",
              });
            }
            try {
              await bindings.onWorkspaceCreated?.({
                id: workspace.id,
                name: workspace.name,
                ownerId: user.id,
              });
            } catch (error) {
              await store?.undo(workspace.id);
              throw error;
            }
          },
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Better Auth's error code when a user already belongs to `WORKSPACE_LIMIT` workspaces. */
export const WORKSPACE_LIMIT_CODE = "YOU_HAVE_REACHED_THE_MAXIMUM_NUMBER_OF_ORGANIZATIONS";

type WorkspaceStore = {
  /** Deletes a workspace Better Auth just created, with its memberships. */
  undo(workspaceId: string): Promise<void>;
  /** How many of the user's memberships are older than the one in `workspaceId` (0 for the first). */
  rank(userId: string, workspaceId: string): Promise<number>;
};

export function createAuth(bindings: AuthBindings) {
  // The hook runs inside a request to this instance, so its context (and adapter) exists by then.
  const auth = betterAuth(
    authOptions(bindings, {
      async undo(workspaceId: string): Promise<void> {
        const { adapter } = await auth.$context;
        await adapter.deleteMany({
          model: "member",
          where: [{ field: "organizationId", value: workspaceId }],
        });
        await adapter.delete({
          model: "organization",
          where: [{ field: "id", value: workspaceId }],
        });
      },
      async rank(userId: string, workspaceId: string): Promise<number> {
        const { adapter } = await auth.$context;
        const memberships: { organizationId: string }[] = await adapter.findMany({
          model: "member",
          where: [{ field: "userId", value: userId }],
          // Oldest first.
          sortBy: { field: "createdAt", direction: "asc" },
        });
        const index = memberships.findIndex((member) => member.organizationId === workspaceId);
        return index === -1 ? memberships.length : index;
      },
    }),
  );
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
