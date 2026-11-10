// `POST /devices/register`'s call into a workspace's shard (RFC 0006 "Device registration", RFC 0016 "Parity"), sent
// to the engine D1's `workspace_engine` names: `WorkspaceDO.registerDevice`, or on Ember the same steps with D1's part
// done here, in the Worker (a mutation cannot read D1), around `devices:register` (ember/devices.ts).

import type { Actor } from "@freecorps/brigade-schema";
import type { DeviceRegisterAnswer } from "../ember/devices.ts";
import { workspaceEngine } from "./ember.ts";
import { emberMutation, emberSessions } from "./ember-workspace.ts";
import { findSession } from "./auth-ember.ts";
import { readRole } from "./members.ts";
import type { DeviceRegisterResult } from "./workspace.ts";

type DevicesEnv = Pick<Env, "DB" | "WORKSPACE" | "AUTH"> & { SHARD?: Env["SHARD"] };

/** `WorkspaceDO.registerDevice`'s signature. */
export type RegisterDevice = (
  workspaceId: string,
  actor: Actor,
  args: Record<string, unknown>,
  resetAt?: number,
  sessionId?: string,
) => Promise<DeviceRegisterResult>;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** `workspaceId`'s `registerDevice`, on `WorkspaceDO` or on Ember as D1 says. */
export async function workspaceRegisterDevice(
  env: DevicesEnv,
  workspaceId: string,
): Promise<RegisterDevice> {
  if (env.SHARD && (await workspaceEngine(env.DB, workspaceId)) === "ember") {
    return emberRegisterDevice({ ...env, SHARD: env.SHARD });
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return async (...args) => stub.registerDevice(...args);
}

/**
 * `registerDevice` on a workspace's Ember shard: the sessions D1 still lists as ended here first (so the phone a member
 * signed out of is free for whoever signs in on it next), then `devices:register`. A member tombstone is checked
 * against D1 (`not_a_member` only when D1 confirms it, `unavailable` when D1 cannot say), and another member's phone
 * is freed and tried once more when the session they registered it with is gone or expired.
 */
export function emberRegisterDevice(env: DevicesEnv & { SHARD: Env["SHARD"] }): RegisterDevice {
  const sessions = emberSessions({ ...env, SHARD: env.SHARD });
  return async (workspaceId, actor, args, resetAt, sessionId) => {
    if (!(await sessions.catchUpSessionEnds(workspaceId)))
      return { ok: false, code: "unavailable" };
    const call = (extra: { memberGen?: number; free?: { sessionId: string; before: number } }) =>
      emberMutation<DeviceRegisterAnswer>(env, workspaceId, "devices:register", {
        workspaceId,
        actor,
        args,
        ...(resetAt !== undefined ? { resetAt } : {}),
        ...(sessionId !== undefined ? { sessionId } : {}),
        ...extra,
      });
    let memberGen: number | undefined;
    let result = await call({});
    if (!result.ok && result.code === "gone") {
      // Removed within the tombstone: gone only if D1 says so too (they may have been added again since).
      let role: string | undefined;
      // The shard's member fence before this read: a member change it runs after it makes the read no proof.
      const gen = "gen" in result ? result.gen : undefined;
      try {
        role = await readRole(env.DB, workspaceId, actor.id);
      } catch (error) {
        log("checking a member tombstone against D1 failed", { error: String(error) });
        return { ok: false, code: "unavailable" };
      }
      if (role === undefined) return { ok: false, code: "not_a_member" };
      memberGen = gen;
      result = await call(memberGen !== undefined ? { memberGen } : {});
    }
    if (!result.ok && result.code === "forbidden" && typeof args.id === "string") {
      // Another member's phone. Free when that member signed out on it (caught up again: the sign-out may have
      // landed since), or the session they last registered it with no longer exists or expired.
      if (!(await sessions.catchUpSessionEnds(workspaceId)))
        return { ok: false, code: "unavailable" };
      const heldBy = "heldBy" in result ? result.heldBy : undefined;
      let free: { sessionId: string; before: number } | undefined;
      if (heldBy !== undefined) {
        const before = Date.now();
        let session: { expiresAt: number } | null;
        try {
          session = await findSession(env, heldBy);
        } catch (error) {
          log("checking a device's session failed", { error: String(error) });
          return { ok: false, code: "unavailable" };
        }
        // A value that cannot be read (NaN) keeps the device its member's.
        const expiresAt = session === null ? 0 : session.expiresAt;
        if (expiresAt <= before) free = { sessionId: heldBy, before };
      }
      result = await call({
        ...(memberGen !== undefined ? { memberGen } : {}),
        ...(free ? { free } : {}),
      });
    }
    if (!result.ok && result.code === "gone") return { ok: false, code: "unavailable" };
    if (!result.ok && result.code === "forbidden") return { ok: false, code: "forbidden" };
    return result;
  };
}
