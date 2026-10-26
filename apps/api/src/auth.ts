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
import {
  dashboardLink,
  renderPasswordResetEmail,
  renderVerificationEmail,
} from "./email-templates.ts";
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
  /**
   * Called once a password reset went through, after Better Auth deleted the user's sessions and the address was
   * marked verified (and `user.passwordResetAt` set): signs the user's devices and sockets out of every workspace
   * (src/index.ts). `takeOver`: the address was not verified before, so this is its owner taking back an account
   * someone else signed up with. Must not throw.
   */
  onPasswordReset?: (userId: string, reset: { takeOver: boolean; at: number }) => Promise<void>;
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
 * an account signed up with someone else's address cannot keep mailing it 3 times every 15 minutes.
 */
export const VERIFICATION_RESEND_LIMIT = { window: 15 * 60, max: 3 };
export const VERIFICATION_DAILY_LIMIT = { window: 24 * 60 * 60, max: 5 };
export const VERIFICATION_IP_LIMIT = { window: 60, max: 3 };
/** How long a password reset link works, in seconds (Better Auth's default, stated). */
export const RESET_TTL_S = 60 * 60;
/**
 * Password reset emails (`/request-password-reset`), counted for any address, account or not, so the answer never
 * tells the two apart, in D1's `rateLimit` table like verification's: 3 an hour per address from one IP, and 10 a day
 * per address from anywhere, on top of 3 per IP a minute (`RESET_IP_LIMIT`). Keyed by address and IP, so someone
 * asking for another person's address from their own network uses up their own hourly count, not the owner's; only
 * the daily cap is shared, and it is loose enough that the owner still gets a link most days (Q21).
 */
export const RESET_ADDRESS_LIMIT = { window: 60 * 60, max: 3 };
export const RESET_DAILY_LIMIT = { window: 24 * 60 * 60, max: 10 };
export const RESET_IP_LIMIT = { window: 60, max: 3 };
/** Attempts at setting the new password per IP a minute (`/reset-password`); its token cannot be guessed anyway. */
export const RESET_SUBMIT_LIMIT = { window: 60, max: 10 };
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
const beforeHook = (bindings: AuthBindings, background?: BackgroundReset) => {
  // Requests whose limits `checkResetRequest` already counted and that it handed to this instance again in the
  // background: let through as they are. Per instance, so per request.
  const admitted = new WeakSet<Request>();
  return createAuthMiddleware(async (ctx) => {
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
      // Refused here rather than left to Better Auth, so no version of it can mail an address other than the
      // session's own.
      const email: unknown = Reflect.get(Object(ctx.body), "email");
      if (typeof email !== "string" || email.toLowerCase() !== session.user.email.toLowerCase()) {
        throw APIError.from("FORBIDDEN", {
          code: "FORBIDDEN",
          message: "Only your own address can be verified",
        });
      }
      // Better Auth refuses this itself; only an email that goes out counts.
      if (session.user.emailVerified) return;
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
    if (ctx.path === "/request-password-reset") {
      return checkResetRequest(bindings, ctx, background, admitted);
    }
    return checkName(ctx);
  });
};

/** What `/request-password-reset` answers, for every address. Better Auth's own words, so both paths say the same. */
export const RESET_REQUESTED = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
};

/**
 * `/request-password-reset` (RFC 0002 "Auth"): the same answer for every address, account or not, except when email
 * is not set up at all (`EMAIL_NOT_CONFIGURED`, the same for everyone) or the address asked too often (counted for
 * any address, so a limit says nothing about whether it has an account). The link is always the dashboard's own
 * page, so whatever `redirectTo` the request names is dropped. Answered here, before Better Auth looks the address
 * up: the lookup, the token and the email run after the response (`waitUntil`), so its timing is the same for an
 * address with an account and one without.
 */
async function checkResetRequest(
  bindings: AuthBindings,
  ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0],
  background: BackgroundReset | undefined,
  admitted: WeakSet<Request>,
) {
  if (ctx.request && admitted.has(ctx.request)) return;
  if (!bindings.email?.sender) {
    throw APIError.from("SERVICE_UNAVAILABLE", {
      code: EMAIL_NOT_CONFIGURED_CODE,
      message: "Email is not set up",
    });
  }
  const body: unknown = ctx.body;
  if (typeof body !== "object" || body === null) return;
  const email: unknown = Reflect.get(body, "email");
  // Anything else is Better Auth's to refuse (400).
  if (typeof email !== "string" || email.length > 254) return;
  const address = email.trim().toLowerCase();
  const ip = ctx.headers?.get("cf-connecting-ip") ?? "";
  const now = Date.now();
  for (const [key, limit] of [
    [`reset:${address}:${ip}`, RESET_ADDRESS_LIMIT],
    [`reset-day:${address}`, RESET_DAILY_LIMIT],
  ] as const) {
    if ((await countRequest(bindings.database, key, limit.window, now)) > limit.max) {
      throw APIError.from("TOO_MANY_REQUESTS", {
        code: "TOO_MANY_REQUESTS",
        message: "Too many password reset emails",
      });
    }
  }
  const { redirectTo: _dropped, ...rest } = body as Record<string, unknown>;
  if (!background || !bindings.waitUntil || !ctx.request) return { context: { body: rest } };
  const request = ctx.request;
  admitted.add(request);
  bindings.waitUntil(
    background(rest, request).catch((error: unknown) =>
      console.error(
        JSON.stringify({ message: "password reset request failed", error: String(error) }),
      ),
    ),
  );
  return RESET_REQUESTED;
}

/** Runs `/request-password-reset` again with `body`, through Better Auth (`createAuth`), after the response. */
type BackgroundReset = (body: Record<string, unknown>, request: Request) => Promise<unknown>;

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

export function authOptions(bindings: AuthBindings, store?: WorkspaceStore, self: Self = noSelf) {
  const random = randomBytes;
  return {
    appName: "Brigade",
    basePath: AUTH_BASE_PATH,
    secret: bindings.secret,
    database: bindings.database,
    // Unverified accounts sign in and use their own workspaces; verification gates email, inviting and joining
    // (RFC 0002 "Auth").
    emailAndPassword: {
      enabled: true,
      // Password reset (RFC 0002 "Auth"): the link is the dashboard's `/reset-password#token=…`, and using it proves
      // control of the address, so it also marks the address verified and ends every session. That is how an
      // address someone else signed up with and never verified comes back to its owner.
      resetPasswordTokenExpiresIn: RESET_TTL_S,
      revokeSessionsOnPasswordReset: true,
      // Run in `backgroundTasks` like the verification email, so the answer takes as long for an address without
      // an account.
      sendResetPassword: async ({ user, token }, request) => {
        const sender = bindings.email?.sender;
        if (!sender) return;
        // In the fragment, which browsers never send: not to the dashboard, a proxy's log or a `Referer`.
        const link = dashboardLink(
          "/reset-password",
          {},
          bindings.email?.dashboardUrl,
          linkFallback(sender, request ? new URL(request.url).origin : undefined),
          { token },
        );
        if (!link) {
          console.error(
            JSON.stringify({ message: "password reset email not sent: DASHBOARD_URL is not set" }),
          );
          return;
        }
        const locale = Reflect.get(user, "locale");
        // Never the name: on an account nobody verified, whoever signed up typed it.
        const result = await sender.send(
          renderPasswordResetEmail(
            { email: user.email },
            link,
            resolveLocale(typeof locale === "string" ? locale : undefined),
          ),
        );
        if (!result.ok) {
          console.error(
            JSON.stringify({
              message: "password reset email refused",
              sender: sender.id,
              code: result.code,
            }),
          );
        }
      },
      // After Better Auth set the password, consumed the token and deleted every session. `user` is as it was
      // before the reset.
      onPasswordReset: async ({ user }) => {
        const at = Date.now();
        await self.resetDone(user.id, at);
        await bindings.onPasswordReset?.(user.id, { takeOver: !user.emailVerified, at });
      },
    },
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
        // When the password was last reset (ms since the epoch), set by `onPasswordReset` only (RFC 0002 "Auth").
        passwordResetAt: { type: "number", required: false, input: false, returned: false },
      },
      // Stated, not left to the defaults: a verification link holds only the address, so it is safe only while an
      // address belongs to one account for good. With no way to delete a user or move them to another address, an
      // old link can never verify a newer account at that address (RFC 0002 "Auth"). Enabling either needs links
      // bound to the account first.
      deleteUser: { enabled: false },
      changeEmail: { enabled: false },
    },
    // The dashboard is same-origin (Better Auth trusts its own base URL); the mobile app is `APP_ORIGIN`.
    trustedOrigins: [APP_ORIGIN],
    hooks: { before: beforeHook(bindings, self.requestReset) },
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
        "/request-password-reset": RESET_IP_LIMIT,
        "/reset-password": RESET_SUBMIT_LIMIT,
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

/**
 * What hooks need of the instance `authOptions` configures (`createAuth`): its adapters, and its own
 * `/request-password-reset`, run after the response.
 */
type Self = {
  /**
   * After a password reset: marks the address verified (the link reached it, as a verification link would) and
   * records `passwordResetAt`, which lets each shard's member reconcile drop devices and sockets from before it should
   * its own sign-out fail; then deletes the user's other reset links, any of which would reset the password again.
   */
  resetDone(userId: string, at: number): Promise<void>;
  requestReset?: BackgroundReset;
};

const noSelf: Self = {
  resetDone: () => Promise.reject(new Error("authOptions has no instance: use createAuth")),
};

type WorkspaceStore = {
  /** Deletes a workspace Better Auth just created, with its memberships. */
  undo(workspaceId: string): Promise<void>;
  /** How many of the user's memberships are older than the one in `workspaceId` (0 for the first). */
  rank(userId: string, workspaceId: string): Promise<number>;
};

export function createAuth(bindings: AuthBindings) {
  // The hook runs inside a request to this instance, so its context (and adapter) exists by then.
  const auth = betterAuth(
    authOptions(
      bindings,
      {
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
      },
      {
        async resetDone(userId: string, at: number): Promise<void> {
          const { internalAdapter, adapter } = await auth.$context;
          await internalAdapter.updateUser(userId, { emailVerified: true, passwordResetAt: at });
          await adapter.deleteMany({
            model: "verification",
            where: [
              { field: "value", value: userId },
              { field: "identifier", operator: "starts_with", value: "reset-password:" },
            ],
          });
        },
        requestReset: (body: Record<string, unknown>, request: Request): Promise<unknown> =>
          auth.api.requestPasswordReset({
            body: body as { email: string },
            headers: request.headers,
            request,
          }),
      },
    ),
  );
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
