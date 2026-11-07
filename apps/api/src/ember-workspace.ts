// The calls the API Worker makes on a workspace's shard, sent to whichever engine holds it (RFC 0016 "Data
// migration"): its `WorkspaceDO`, or its Ember shard once D1's `workspace_engine` says `ember`. Each function here
// has the signature of the `WorkspaceDO` method it stands for, so a call site changes only in how it gets the stub.
// They move here area by area (RFC 0016 "What runs where"); this file has the session ones.

import type { EmberEnv } from "@freecorps/ember-runtime";
import type { SignOutUserResult } from "../ember/sessions.ts";
import { ember, workspaceEngine, workspaceShard } from "./ember.ts";
import { ENDED_SESSION_MS, type EndedSession, type SignOutResult } from "./workspace.ts";

/** The outcome of an Ember call, as the runtime's Shard answers it. */
type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message?: string } };

type EmberShardRpc = {
  mutation(
    shard: string,
    fn: string,
    args: unknown,
    identity: null,
    internal: boolean,
  ): Promise<Outcome>;
};

/** Runs the internal mutation `fn` on the workspace's Ember shard; throws when Ember refused it. */
export async function emberMutation<T>(
  env: Pick<Env, "SHARD">,
  workspaceId: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const shard = workspaceShard(workspaceId);
  const stub = env.SHARD.getByName(shard) as unknown as EmberShardRpc;
  const out = await stub.mutation(shard, fn, args, null, true);
  if (!out.ok)
    throw new Error(`${fn} failed on Ember: ${out.error.code} ${out.error.message ?? ""}`);
  return out.value as T;
}

/** The session calls of a workspace, on the engine holding it. */
export type WorkspaceSessions = {
  endSession(
    workspaceId: string,
    session: EndedSession,
  ): Promise<{ ok: true } | { ok: false; code: "not_found" }>;
  signOutUser(
    workspaceId: string,
    userId: string,
    options?: { takeOver?: boolean },
  ): Promise<SignOutResult>;
  catchUpSessionEnds(workspaceId: string): Promise<boolean>;
};

type SessionsEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD">;

/** `workspaceId`'s session calls, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceSessions(
  env: SessionsEnv,
  workspaceId: string,
): Promise<WorkspaceSessions> {
  if ((await workspaceEngine(env.DB, workspaceId)) !== "ember") {
    const stub = env.WORKSPACE.getByName(workspaceId);
    return {
      endSession: async (id, session) => stub.endSession(id, session),
      signOutUser: async (id, userId, options) => stub.signOutUser(id, userId, options),
      catchUpSessionEnds: (id) => stub.catchUpSessionEnds(id),
    };
  }
  return emberSessions(env);
}

/**
 * Closes the sockets on the workspace's Ember shard that `match` names, and has the shard refuse, for
 * `ENDED_SESSION_MS`, any token issued before now that it matches: Ember's counterpart of `WorkspaceDO`'s
 * `ended_session`, so a socket admitted with that session just before it ended, and still on its way, is refused too.
 * (A token minted later for the same session cannot exist: the session's row is gone, and the auth hook checks it.)
 */
async function revoke(
  env: SessionsEnv,
  workspaceId: string,
  match: { subject: string } | { claim: string; value: string },
): Promise<void> {
  await ember.revokeSockets(env as unknown as EmberEnv, workspaceShard(workspaceId), match, {
    close: true,
    forMs: ENDED_SESSION_MS,
  });
}

/** The session calls on a workspace's Ember shard (ember/sessions.ts), with its sockets closed through the runtime. */
export function emberSessions(env: SessionsEnv): WorkspaceSessions {
  const endSession: WorkspaceSessions["endSession"] = async (workspaceId, session) => {
    try {
      return await emberMutation(env, workspaceId, "sessions:endSession", {
        workspaceId,
        userId: session.userId,
        ...(session.deviceId === undefined ? {} : { deviceId: session.deviceId }),
        ...(session.endedAt === undefined ? {} : { endedAt: session.endedAt }),
      });
    } finally {
      // Whatever happened to the rows: as `WorkspaceDO.endSession` closes the session's sockets in `finally`.
      await revoke(env, workspaceId, { claim: "sid", value: session.sessionId });
    }
  };
  return {
    endSession,
    async signOutUser(workspaceId, userId, options = {}) {
      try {
        return await emberMutation<SignOutUserResult>(env, workspaceId, "sessions:signOutUser", {
          workspaceId,
          userId,
          ...(options.takeOver === undefined ? {} : { takeOver: options.takeOver }),
        });
      } finally {
        await revoke(env, workspaceId, { subject: userId });
      }
    },
    /** As `WorkspaceDO.catchUpSessionEnds`: acts on what D1's `session_end` lists here, deleting each row it acted on. */
    async catchUpSessionEnds(workspaceId) {
      let rows: { sessionId: string; userId: string; deviceId: string | null; endedAt: number }[];
      try {
        ({ results: rows } = await env.DB.prepare(
          `select "sessionId", "userId", "deviceId", "endedAt" from session_end where "workspaceId" = ?
           order by "endedAt" limit 100`,
        )
          .bind(workspaceId)
          .all());
      } catch (error) {
        console.error(
          JSON.stringify({ message: "reading the sessions to end failed", error: String(error) }),
        );
        return false;
      }
      let done = true;
      for (const row of rows) {
        try {
          await endSession(workspaceId, {
            userId: row.userId,
            sessionId: row.sessionId,
            endedAt: row.endedAt,
            ...(row.deviceId !== null ? { deviceId: row.deviceId } : {}),
          });
          await env.DB.prepare(
            `delete from session_end where "workspaceId" = ? and "sessionId" = ?`,
          )
            .bind(workspaceId, row.sessionId)
            .run();
        } catch (error) {
          // Acted on again next time: every step is a no-op the second time.
          console.error(
            JSON.stringify({ message: "ending a session on Ember failed", error: String(error) }),
          );
          done = false;
        }
      }
      return done;
    },
  };
}
