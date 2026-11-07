// A phone's registration over HTTP on a workspace's Ember shard (RFC 0006 "Device registration", RFC 0016 "Parity"):
// `WorkspaceDO.registerDevice`'s shard steps, as one Ember mutation. The Worker does the D1 part around it
// (src/ember-devices.ts): the sessions D1 still lists as ended here first, a member tombstone checked against D1, and
// the session of another member's phone looked up before it is freed. A registration over a socket goes through
// `workspace:mutate`, which refreshes the device the same way (`touchDevice`, ember/workspace.ts).

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import {
  ACCOUNT_ACTOR,
  mutations,
  serverMutations,
  type Actor,
  type BrigadeTables,
  type EmberStore,
} from "@freecorps/brigade-schema";
import type { DeviceRegisterResult } from "../src/workspace.ts";
import { emberWorkspace } from "./shard-facade.ts";
import { run, touchDevice, workspaceLimits, type MutateResult } from "./workspace.ts";

/**
 * What `devices:register` answers: `DeviceRegisterResult`, or `gone` (the member's tombstone stands: the Worker checks
 * D1 and calls again with `member`), or `forbidden` with `heldBy`, the session another member last registered this
 * phone with (the Worker checks it in D1 and calls again with `free` when it is over).
 */
export type DeviceRegisterAnswer =
  | DeviceRegisterResult
  | { ok: false; code: "gone" }
  | { ok: false; code: "forbidden"; heldBy?: string };

function runIn(
  ctx: MutationCtx,
  store: EmberStore<BrigadeTables>,
  registry: typeof mutations | typeof serverMutations,
  name: string,
  args: unknown,
  actor: Actor,
): MutateResult {
  return run(ctx, registry, name, args, () => actor, workspaceLimits(), store);
}

/**
 * `device.register` as the member, as `WorkspaceDO.registerDevice` runs it once the Worker caught up the ended
 * sessions: with `resetAt`, the member's devices from before their password reset come off first (`device.signOut`);
 * with `free`, the phone comes off the member who last registered it with that session (over, as D1 said at
 * `free.before`), unless they registered it again since; then `device.register`, and `device.touch` when it went
 * through or changed nothing (`conflict`). `member`: the Worker found them in D1 despite a tombstone (re-added), which
 * is dropped. A shard that serves another workspace, or none yet, answers `not_found`.
 */
export const register = internalMutationGeneric({
  args: {
    workspaceId: v.string(),
    actor: v.any(),
    args: v.any(),
    resetAt: v.optional(v.number()),
    sessionId: v.optional(v.string()),
    member: v.optional(v.boolean()),
    free: v.optional(v.object({ sessionId: v.string(), before: v.number() })),
  },
  handler: (
    ctx,
    input: {
      workspaceId: string;
      actor: Actor;
      args: Record<string, unknown>;
      resetAt?: number;
      sessionId?: string;
      member?: boolean;
      free?: { sessionId: string; before: number };
    },
  ): DeviceRegisterAnswer => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { ok: false, code: "not_found" };
    const { actor, args } = input;
    if (input.member) {
      c.sql.exec("delete from member_gone where user_id = ?", actor.id);
    } else if (shard.gone(actor.id, c.now)) {
      return { ok: false, code: "gone" };
    }
    const store = shard.store;
    const id = typeof args.id === "string" ? args.id : undefined;
    // A phone left registered to this member from before their password reset (`WorkspaceDO.signOutStale`).
    if (
      input.resetAt !== undefined &&
      store
        .scan("devices")
        .some((device) => device.userId === actor.id && device.updatedAt < input.resetAt!)
    ) {
      const out = runIn(
        c,
        store,
        serverMutations,
        "device.signOut",
        { userId: actor.id, before: input.resetAt },
        ACCOUNT_ACTOR,
      );
      shard.check();
      if (!out.ok && out.error.code !== "conflict") return { ok: false, code: "internal" };
    }
    // Another member's phone whose session is over (`WorkspaceDO.freeDevice`).
    if (input.free && id !== undefined) {
      const device = store.get("devices", id);
      if (device && device.userId !== actor.id && device.sessionId === input.free.sessionId) {
        const out = runIn(
          c,
          store,
          serverMutations,
          "device.signOut",
          { userId: device.userId, deviceId: id, before: input.free.before },
          ACCOUNT_ACTOR,
        );
        shard.check();
        if (!out.ok && out.error.code !== "conflict") return { ok: false, code: "unavailable" };
      }
    }
    const out = runIn(c, store, mutations, "device.register", args, actor);
    shard.check();
    if (!out.ok && out.error.code !== "conflict") {
      if (out.error.code === "forbidden" && id !== undefined) {
        const held = store.get("devices", id);
        return held && held.userId !== actor.id && held.sessionId !== undefined
          ? { ok: false, code: "forbidden", heldBy: held.sessionId }
          : { ok: false, code: "forbidden" };
      }
      return { ok: false, code: out.error.code };
    }
    // Not done, a later sweep acting on a sign-out from before now could drop the phone just registered again.
    const touched = touchDevice(c, actor, args.id, input.sessionId, store);
    shard.check();
    if (!touched) return { ok: false, code: "unavailable" };
    return out.ok ? { ok: true } : { ok: false, code: "conflict" };
  },
});
