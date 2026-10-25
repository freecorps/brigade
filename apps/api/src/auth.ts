// Better Auth on Workers + D1 (RFC 0002, RFC 0003): users, sessions and workspace membership. A workspace is a
// Better Auth organization; its roles and permissions are Brigade's own table from packages/schema, so the API,
// the sync engine and the UI check the same grants.
//
// Kept free of Workers imports: bindings come in as arguments. test/migrations.test.ts checks that migrations/
// creates exactly what these options need, and prints the SQL for anything missing.

import {
  newId,
  roles,
  statement,
  workspaceName,
  type RandomBytes,
} from "@freecorps/brigade-schema";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { organization } from "better-auth/plugins";
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
  /** The D1 database (a `D1Database` binding), or any database Better Auth's Kysely adapter takes. */
  database: BetterAuthOptions["database"];
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
};

/**
 * Requests per window for Better Auth's routes, counted per client IP and path in D1 (the `rateLimit` table), so
 * every isolate sees the same counts. Better Auth's own stricter rules still apply on top: 3 per 10 s for
 * `/sign-in/*`, `/sign-up/*`, `/change-password` and `/change-email`.
 */
export const RATE_LIMIT = { window: 60, max: 100 };

export function authOptions(bindings: AuthBindings, undo?: WorkspaceUndo) {
  const random: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));
  return {
    appName: "Brigade",
    basePath: AUTH_BASE_PATH,
    secret: bindings.secret,
    database: bindings.database,
    emailAndPassword: { enabled: true },
    // Off by default on Workers (Better Auth enables it only when NODE_ENV is "production"). The in-memory store
    // would count per isolate, so the counts live in D1.
    rateLimit: {
      enabled: true,
      storage: "database",
      ...RATE_LIMIT,
      // Every page load reads the session; it needs no limit and should not cost a D1 write.
      customRules: { "/get-session": false },
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
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      ...(bindings.waitUntil ? { backgroundTasks: { handler: bindings.waitUntil } } : {}),
    },
    plugins: [
      organization({
        ac,
        roles: authRoles,
        creatorRole: "owner",
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
            try {
              await bindings.onWorkspaceCreated?.({
                id: workspace.id,
                name: workspace.name,
                ownerId: user.id,
              });
            } catch (error) {
              await undo?.(workspace.id);
              throw error;
            }
          },
        },
      }),
    ],
  } satisfies BetterAuthOptions;
}

/** Deletes a workspace Better Auth just created, with its memberships. */
type WorkspaceUndo = (workspaceId: string) => Promise<void>;

export function createAuth(bindings: AuthBindings) {
  // The hook runs inside a request to this instance, so its context (and adapter) exists by then.
  const auth = betterAuth(
    authOptions(bindings, async (workspaceId) => {
      const { adapter } = await auth.$context;
      await adapter.deleteMany({
        model: "member",
        where: [{ field: "organizationId", value: workspaceId }],
      });
      await adapter.delete({ model: "organization", where: [{ field: "id", value: workspaceId }] });
    }),
  );
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
