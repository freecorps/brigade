// A client admitted to a workspace's Ember shard (RFC 0016 "Clients"): the Worker's part of `WorkspaceDO.fetch`'s
// upgrade checks, around `clients:admit` (ember/clients.ts). Run when the Worker issues an Ember token (each one, the
// refreshes too: every step is a no-op when nothing changed) and when the Brigade Sync adapter opens a socket.

import type { Actor } from "@freecorps/brigade-schema";
import type { AdmitResult } from "../ember/clients.ts";
import { emberMutation, emberSessions } from "./ember-workspace.ts";
import { readRole } from "./members.ts";

type ClientsEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD">;

/** Who is admitted, as the Worker resolved them (`resolveActor`). */
export type Admission = {
  actor: Actor;
  /** A signed-in member's name as D1 holds it; none for an API token (or the dev actor). */
  name?: string;
  /** When their password was last reset. */
  resetAt?: number;
};

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/**
 * Admits `who` to `workspaceId`'s Ember shard: the actor as the shard backs it (an API token's role lowered to its
 * creator's copy), or why not: `not_a_member` (removed, and D1 confirms it), `unauthenticated` (a token the shard no
 * longer backs), `unavailable` (D1 or the shard could not say: tried again). The sessions D1 still lists as ended
 * here are caught up beside it, as the DO does after an upgrade, never holding the caller up.
 */
export async function admitToEmber(
  env: ClientsEnv,
  workspaceId: string,
  who: Admission,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<
  | { ok: true; actor: Actor; tokenExpiresAt: number | null }
  | { ok: false; code: "not_found" | "not_a_member" | "unauthenticated" | "unavailable" }
> {
  const call = (memberGen?: number) =>
    emberMutation<AdmitResult>(env, workspaceId, "clients:admit", {
      workspaceId,
      actor: who.actor,
      ...(who.name !== undefined ? { name: who.name } : {}),
      ...(who.resetAt !== undefined ? { resetAt: who.resetAt } : {}),
      ...(memberGen !== undefined ? { memberGen } : {}),
    });
  let result = await call();
  if (!result.ok && result.code === "gone") {
    // Removed within the tombstone: gone only if D1 says so too (they may have been added again since).
    let role: string | undefined;
    try {
      role = await readRole(env.DB, workspaceId, who.actor.by ?? who.actor.id);
    } catch (error) {
      log("checking a member tombstone against D1 failed", { error: String(error) });
      return { ok: false, code: "unavailable" };
    }
    if (role === undefined) return { ok: false, code: "not_a_member" };
    result = await call(result.gen);
    // Removed again since that read: no proof either way now.
    if (!result.ok && result.code === "gone") return { ok: false, code: "unavailable" };
  }
  if (result.ok && who.name !== undefined) {
    const catching = emberSessions(env)
      .catchUpSessionEnds(workspaceId)
      .catch((error: unknown) =>
        log("catching up ended sessions failed", { error: String(error) }),
      );
    if (waitUntil) waitUntil(catching);
    else void catching;
  }
  return result as Exclude<AdmitResult, { code: "gone" }>;
}
