// Better Auth in Ember's `Auth` Durable Object (RFC 0017): accounts, sessions and the rest of identity in the object's
// SQLite, Brigade's rules as the same options (`emberAuthOptions`), workspaces left in D1. Off until `AUTH_ENGINE` is
// `ember` (src/index.ts); D1 stays the engine meanwhile.
//
// D1 keeps a copy of `user` (the joins on it: members lists, invitations, notification languages, Slack), written after
// every change the object commits. Ember's profile journal (`_ember_user_journal`, a trigger row in the same transaction
// as the write) is how a lost copy is found: the hook deletes the row once D1 has the copy, and a row older than
// `COPY_GRACE_MS` belongs to a copy that never landed (D1 refused it, or the object died between the two), which the
// object's alarm writes again from the user's current row.

import { defineAuth, USER_JOURNAL_TABLE } from "@freecorps/ember-auth";
import { emberAuth, type AuthClass, type ProfileSyncHook } from "@freecorps/ember-auth/worker";
import {
  emberAuthOptions,
  type Auth as D1Auth,
  type AuthBindings,
  type BackgroundReset,
  type SessionById,
} from "./auth.ts";

/** Which Better Auth holds identity (RFC 0017): D1's, until `AUTH_ENGINE` is `ember`. */
export function authEngine(env: Env | Record<string, unknown>): "d1" | "ember" {
  return Reflect.get(env, "AUTH_ENGINE") === "ember" ? "ember" : "d1";
}

/** The `Auth` object (one per deployment: Ember's `instance` default). */
const authObject = (env: Pick<Env, "AUTH">) => env.AUTH.getByName("auth");

/** An `Auth.api` answer, or the error Better Auth refused it with (logged by the callers that catch it). */
export async function onObject(
  env: Pick<Env, "AUTH">,
  endpoint: string,
  input: Parameters<ReturnType<typeof authObject>["api"]>[1],
) {
  const answer = await authObject(env).api(endpoint, input);
  if (!answer.ok) throw new Error(`Auth.${endpoint}: ${answer.error.status} ${answer.error.code}`);
  return answer.value;
}

/**
 * The session `id`, from whichever engine holds them: whose it is and when it expires, or null when there is no such
 * session (signed out, revoked, reset, or expired and cleaned up). Throws when the engine cannot say.
 */
export async function findSession(
  env: Pick<Env, "DB" | "AUTH">,
  id: string,
): Promise<SessionById | null> {
  if (authEngine(env) === "ember") {
    return (
      ((await onObject(env, "brigadeSession", { body: { id } })) as SessionById | null) ?? null
    );
  }
  const row = await env.DB.prepare(`select "userId", "expiresAt" from "session" where id = ?`)
    .bind(id)
    .first<{ userId: string; expiresAt: string | number }>();
  // However the adapter stored it (ISO text or ms).
  return row ? { userId: row.userId, expiresAt: new Date(row.expiresAt).getTime() } : null;
}

/**
 * What the Worker's routes use of Better Auth, on the object: the request's session (`api.getSession`, the same answer
 * as D1's instance gives). Everything else of the D1 instance (creating a workspace through the organization plugin,
 * its adapters) has no place on the object and refuses, until its route has its own way (RFC 0017, step 2).
 * `Authorization` is not passed on: Ember's `bearer()` would read an API token there as a session token.
 */
export function emberSessionAuth(env: Env): D1Auth {
  const unsupported = (what: string) => () =>
    Promise.reject(new Error(`${what} is not on the Ember auth engine yet`));
  const facade = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const forwarded = [...headers].filter(([name]) => name.toLowerCase() !== "authorization");
        return (await onObject(env, "getSession", { headers: forwarded })) ?? null;
      },
      createOrganization: unsupported("createOrganization"),
    },
    handler: unsupported("the D1 handler"),
    get $context() {
      return Promise.reject(new Error("the D1 adapters are not on the Ember auth engine"));
    },
  };
  return facade as unknown as D1Auth;
}

/** The object's name: one per deployment, as Ember's own default. */
export const EMBER_AUTH_PROJECT = "brigade";

/** How old a journal row is before the alarm writes its copy again: past any hook still running. */
export const COPY_GRACE_MS = 60_000;

/** Rows the alarm copies per turn. */
const COPY_BATCH = 50;

/** The wait before the alarm tries again after D1 refused a copy, doubled per failure in a row up to the last. */
const RETRY_MS = [5_000, 30_000, 120_000, 600_000];

/** What the long-lived options reach of the object once it runs: its instance's API and its `waitUntil`. */
type Live = {
  requestReset?: BackgroundReset;
  waitUntil?: (promise: Promise<unknown>) => void;
};

/** A Better Auth user as the hooks and `userForSync` give it. */
type UserRow = Record<string, unknown>;

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : null;
};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Writes the user's row to D1's `user` as Better Auth on D1 stores it (dates as ISO text, `emailVerified` 0/1). An
 * older copy never replaces a newer one: two updates' hooks may finish out of order.
 */
export async function copyUser(db: D1Database, user: UserRow): Promise<void> {
  const id = text(user.id);
  const email = text(user.email);
  const createdAt = iso(user.createdAt);
  const updatedAt = iso(user.updatedAt);
  if (!id || !email || !createdAt || !updatedAt) throw new Error("not a user row");
  const resetAt = user.passwordResetAt;
  await db
    .prepare(
      `insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", locale, "passwordResetAt")
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       on conflict (id) do update set name = excluded.name, email = excluded.email,
         "emailVerified" = excluded."emailVerified", image = excluded.image, "updatedAt" = excluded."updatedAt",
         locale = excluded.locale, "passwordResetAt" = excluded."passwordResetAt"
       where excluded."updatedAt" >= "user"."updatedAt"`,
    )
    .bind(
      id,
      text(user.name) ?? "",
      email,
      user.emailVerified ? 1 : 0,
      text(user.image),
      createdAt,
      updatedAt,
      text(user.locale),
      typeof resetAt === "number" ? resetAt : null,
    )
    .run();
}

/** Deletes the oldest journal row for this user and event: the one the hook that just ran was for. */
function forget(sql: SqlStorage, userId: string, event: string): void {
  sql.exec(
    `DELETE FROM "${USER_JOURNAL_TABLE}" WHERE seq = (SELECT seq FROM "${USER_JOURNAL_TABLE}"
       WHERE user_id = ? AND event = ? ORDER BY seq LIMIT 1)`,
    userId,
    event,
  );
}

function hasJournal(sql: SqlStorage): boolean {
  return (
    sql
      .exec(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`, USER_JOURNAL_TABLE)
      .toArray().length > 0
  );
}

/** Arms the alarm for the oldest row left in the journal, unless one is set already. */
async function armFor(storage: DurableObjectStorage, delayMs?: number): Promise<void> {
  if (!hasJournal(storage.sql)) return;
  const oldest = storage.sql
    .exec<{ at: number }>(`SELECT at FROM "${USER_JOURNAL_TABLE}" ORDER BY at LIMIT 1`)
    .toArray()[0];
  if (!oldest) return;
  const at = delayMs === undefined ? oldest.at + COPY_GRACE_MS : Date.now() + delayMs;
  const set = await storage.getAlarm();
  if (set === null || set > at) await storage.setAlarm(Math.max(at, Date.now()));
}

/**
 * After the object committed a user change: the D1 copy, then the journal row is dropped. Never throws: the change is
 * made, so a refused copy is left to the alarm (Better Auth would otherwise fail a request whose write went through).
 * Deletes are not copied: Brigade has no way to delete a user (RFC 0002 "Auth"), and dropping D1's row would take the
 * memberships with it.
 */
const copyAfterChange: ProfileSyncHook = async (event, user, { storage, env }) => {
  const id = text(user.id);
  if (!id) return;
  if (event === "delete") {
    console.error(JSON.stringify({ message: "a user was deleted on the Auth object", user: id }));
    forget(storage.sql, id, event);
    return;
  }
  try {
    await copyUser(env.DB as D1Database, user);
    forget(storage.sql, id, event);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "copying a user to D1 failed", user: id, error: String(error) }),
    );
    await armFor(storage, RETRY_MS[0]).catch(() => undefined);
  }
};

/**
 * Whether the object's cookies are `Secure` (and `__Secure-` prefixed). D1's instance decides per request from its
 * protocol; the object's options are set once, so from the instance's public address: the dashboard's (the web Worker
 * forwards with the browser's URL, the app reaches the same host), HTTPS on every deployed environment.
 */
export function secureCookies(env: Record<string, unknown>): boolean {
  const url = env.DASHBOARD_URL;
  return typeof url === "string" && url.startsWith("https://");
}

/**
 * The engine: Ember's auth for the Worker (`fetch`, `api`, `stub`) and its `Auth` class with the D1 copy's alarm.
 * `bindingsOf` gives Brigade's bindings for the options from the Worker's env (src/index.ts, as for D1); the object's own
 * `waitUntil` and API reach them once it runs.
 */
export function emberAuthEngine(
  bindingsOf: (env: Env, extra: Partial<AuthBindings>) => AuthBindings,
) {
  const live: Live = {};
  const engine = emberAuth(
    defineAuth((env) =>
      emberAuthOptions(
        bindingsOf(env as unknown as Env, {
          secureCookies: secureCookies(env),
          // After the response, in the object: its `waitUntil` once it runs.
          waitUntil: (promise) => {
            if (live.waitUntil) live.waitUntil(promise);
            else void promise.catch(() => undefined);
          },
        }),
        {
          requestReset: (body, request) =>
            live.requestReset
              ? live.requestReset(body, request)
              : Promise.reject(new Error("the Auth object is not running")),
        },
      ),
    ),
    { project: EMBER_AUTH_PROJECT, binding: "AUTH", onUserChange: copyAfterChange },
  );

  const Base: AuthClass = engine.Auth;
  class Auth extends Base {
    private failures = 0;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env as unknown as Record<string, unknown>);
      const instance = (
        this as unknown as { auth: { api: Record<string, (input: unknown) => Promise<unknown>> } }
      ).auth;
      live.waitUntil = (promise) => ctx.waitUntil(promise);
      live.requestReset = (body, request) =>
        instance.api.requestPasswordReset!({ body, headers: request.headers, request });
      // A copy lost before this object was evicted (or before a deploy): picked up on its next start.
      void ctx.blockConcurrencyWhile(() => armFor(ctx.storage).catch(() => undefined));
    }

    /** Writes again the D1 copies whose hook never finished, from each user's current row. */
    async alarm(): Promise<void> {
      const { storage } = this.ctx;
      if (!hasJournal(storage.sql)) return;
      const due = storage.sql
        .exec<{ seq: number; user_id: string; event: string }>(
          `SELECT seq, user_id, event FROM "${USER_JOURNAL_TABLE}" WHERE at <= ? ORDER BY seq LIMIT ?`,
          Date.now() - COPY_GRACE_MS,
          COPY_BATCH,
        )
        .toArray();
      for (const row of due) {
        try {
          if (row.event !== "delete") {
            const user = await this.userForSync(row.user_id);
            if (user) await copyUser((this.env as unknown as Env).DB, user);
          }
          storage.sql.exec(`DELETE FROM "${USER_JOURNAL_TABLE}" WHERE seq = ?`, row.seq);
          this.failures = 0;
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "copying a user to D1 failed again",
              user: row.user_id,
              error: String(error),
            }),
          );
          const wait = RETRY_MS[Math.min(this.failures, RETRY_MS.length - 1)]!;
          this.failures++;
          await armFor(storage, wait);
          return;
        }
      }
      await armFor(storage, due.length === COPY_BATCH ? 0 : undefined);
    }
  }

  return { engine, Auth };
}
