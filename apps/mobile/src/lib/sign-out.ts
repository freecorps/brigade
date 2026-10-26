// Signing out on the phone (RFC 0006 "A handed-over phone"): the phone stops paging the member before their session
// goes, since only that session can say whose device it is. When the shard cannot be reached (offline), the session
// is kept aside instead of revoked and the app finishes with it the next time it is online, before anyone else
// registers the phone. Pure, so it is tested in Node; src/components/session.tsx runs it.

/** A sign-out the app still has to finish, kept in secure storage under `SIGNED_OUT_KEY`. */
export type Leftover = {
  /** The member's `Cookie` header: their session, which the server still knows. */
  cookie: string;
  userId: string;
  /** The workspace whose shard may still page this phone for them; null once it does not. */
  workspaceId: string | null;
};

export const SIGNED_OUT_KEY = "brigade_signed_out";

export function parseLeftover(raw: string | null): Leftover | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { cookie, userId, workspaceId } = value as Record<string, unknown>;
    if (typeof cookie !== "string" || cookie === "" || typeof userId !== "string") return null;
    if (workspaceId !== null && typeof workspaceId !== "string") return null;
    return { cookie, userId, workspaceId };
  } catch {
    return null;
  }
}

export type SignOutDeps = {
  /** The session's `Cookie` header, read before anything forgets it. */
  cookie: () => Promise<string>;
  /** Takes this phone off the workspace's shard as the member; true once it is off (or never was on). */
  unregister: (() => Promise<boolean>) | null;
  /** Revokes the session on the server and forgets it here; true when the server answered. */
  signOut: () => Promise<boolean>;
  /** Forgets the session here only, so the server keeps it for the leftover. */
  forget: () => Promise<void>;
  save: (leftover: Leftover) => Promise<void>;
};

/**
 * Signs the member out here, always. `released`: the phone no longer pages them. `kept`: the shard could not be
 * told, so it may still page them until the app is next online (`finishSignOut`); their session stays valid on the
 * server until then, since a revoked one could never take the phone off.
 */
export async function signOutPhone(
  member: { userId: string; workspaceId: string },
  deps: SignOutDeps,
): Promise<"released" | "kept"> {
  const cookie = await deps.cookie().catch(() => "");
  const released = deps.unregister ? await deps.unregister() : true;
  // Without a cookie there is nothing to finish with later.
  const keep = (workspaceId: string | null) =>
    cookie === ""
      ? Promise.resolve()
      : deps.save({ cookie, userId: member.userId, workspaceId }).catch(() => {});
  if (!released) {
    await keep(member.workspaceId);
    await deps.forget();
    return "kept";
  }
  // Signed out here whatever the server answers; an unanswered sign-out is finished later.
  if (!(await deps.signOut().catch(() => false))) await keep(null);
  return "released";
}

export type FinishDeps = {
  load: () => Promise<Leftover | null>;
  save: (leftover: Leftover) => Promise<void>;
  clear: () => Promise<void>;
  /** Whether the server still knows the session: null when it could not be asked. */
  session: (cookie: string) => Promise<boolean | null>;
  /** `SignOutDeps.unregister` with the leftover's session and workspace. */
  unregister: (leftover: Leftover & { workspaceId: string }) => Promise<boolean>;
  /** Revokes the session on the server; true when it answered. */
  signOut: (cookie: string) => Promise<boolean>;
};

/**
 * Finishes a kept sign-out: takes the phone off the shard with the old session, then revokes it. `none`: nothing
 * was left. `finished`: nothing is left now, so the phone can be registered for whoever is signed in. `pending`:
 * still offline (or the shard did not answer); try again later.
 *
 * A session the server no longer knows (expired, revoked elsewhere) cannot take the phone off, and nothing else
 * can: the leftover is dropped, and the phone stays the other member's on that shard (RFC 0006).
 */
export async function finishSignOut(deps: FinishDeps): Promise<"none" | "finished" | "pending"> {
  const leftover = await deps.load();
  if (!leftover) return "none";
  const alive = await deps.session(leftover.cookie).catch(() => null);
  if (alive === null) return "pending";
  if (alive) {
    const { workspaceId } = leftover;
    if (workspaceId !== null) {
      if (!(await deps.unregister({ ...leftover, workspaceId }).catch(() => false))) {
        return "pending";
      }
      // Off the shard: a later try only revokes the session. If this write fails, unregistering again is harmless.
      await deps.save({ ...leftover, workspaceId: null }).catch(() => {});
    }
    if (!(await deps.signOut(leftover.cookie).catch(() => false))) return "pending";
  }
  await deps.clear();
  return "finished";
}
