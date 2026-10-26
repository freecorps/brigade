// Signing out on the phone (RFC 0006 "A handed-over phone"): the phone stops paging the member before their session
// goes, since only that session can say whose device it is. When the shard cannot be reached (offline), the session
// is kept aside instead of revoked and the app finishes with it the next time it is online, before anyone else
// registers the phone. Pure, so it is tested in Node; src/components/session.tsx runs it.

/** A sign-out the app still has to finish, one of the list kept in secure storage under `SIGNED_OUT_KEY`. */
export type Leftover = {
  /** The member's `Cookie` header: their session, which the server still knows. It identifies the record. */
  cookie: string;
  userId: string;
  /** The workspace whose shard may still page this phone for them; null once it does not. */
  workspaceId: string | null;
  /** The Better Auth base URL the session belongs to: a development build's server moves with the Metro host. */
  origin: string;
  /**
   * When the session expires on the server (ms), as far as the phone knows: a full lifetime from when it was kept,
   * then what `/get-session` reports, pushed to a full lifetime again whenever its socket is opened (the upgrade may
   * renew it). Past it the server has forgotten the session, so the record is dropped.
   */
  expiresAt: number;
  /**
   * When it was kept (ms). A full lifetime later the record is dropped however often its session was renewed (a
   * removed member's tries renew it but never finish), after one last best-effort revoke.
   */
  keptAt: number;
};

export const SIGNED_OUT_KEY = "brigade_signed_out";

/**
 * At most this many kept sign-outs. Past it, the oldest already off its shard (only the revoke left) is dropped; one
 * still on its shard never is, so keeping another then fails (`signOutPhone` says `stuck`).
 */
export const MAX_KEPT = 10;

function parseOne(value: unknown): Leftover | null {
  if (typeof value !== "object" || value === null) return null;
  const { cookie, userId, workspaceId, origin, expiresAt, keptAt } = value as Record<
    string,
    unknown
  >;
  if (typeof cookie !== "string" || cookie === "" || typeof userId !== "string") return null;
  if (workspaceId !== null && typeof workspaceId !== "string") return null;
  if (typeof origin !== "string" || typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
    return null;
  }
  if (typeof keptAt !== "number" || !Number.isFinite(keptAt)) return null;
  return { cookie, userId, workspaceId, origin, expiresAt, keptAt };
}

/** The kept sign-outs in `raw`; anything that is not one is ignored. */
export function parseLeftovers(raw: string | null): Leftover[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.map(parseOne).filter((leftover) => leftover !== null);
  } catch {
    return [];
  }
}

/** Where the list lives (expo-secure-store in the app): one string under `SIGNED_OUT_KEY`. */
export type LeftoverStorage = {
  read: () => Promise<string | null>;
  write: (raw: string | null) => Promise<void>;
};

/**
 * The kept sign-outs, one per session. Every change reads, changes and writes the list in turn, so a sign-out kept
 * while an earlier one is being finished is never lost; and changes name the session they are about, so finishing
 * one never touches another's record.
 */
export type Leftovers = {
  list: () => Promise<Leftover[]>;
  /** Keeps a sign-out, replacing one kept with the same session; rejects when the list is full (`MAX_KEPT`). */
  add: (leftover: Leftover) => Promise<void>;
  /** Marks the session's record as off its shard; nothing when it is not kept (any more). */
  released: (cookie: string) => Promise<void>;
  /** Moves the session's expiry to `expiresAt` if that is later; nothing when it is not kept (any more). */
  renewed: (cookie: string, expiresAt: number) => Promise<void>;
  /** Forgets the session's record only. */
  remove: (cookie: string) => Promise<void>;
};

export function leftovers(storage: LeftoverStorage): Leftovers {
  let queue: Promise<unknown> = Promise.resolve();
  const change = (edit: (list: Leftover[]) => Leftover[]) => {
    const next = queue.then(async () => {
      const list = parseLeftovers(await storage.read());
      const edited = edit(list);
      await storage.write(edited.length > 0 ? JSON.stringify(edited) : null);
    });
    queue = next.catch(() => {});
    return next;
  };
  return {
    list: () => {
      const next = queue.then(async () => parseLeftovers(await storage.read()));
      queue = next.catch(() => {});
      return next;
    },
    add: (leftover) =>
      change((list) => {
        const next = [...list.filter(({ cookie }) => cookie !== leftover.cookie), leftover];
        while (next.length > MAX_KEPT) {
          const done = next.findIndex(({ workspaceId }) => workspaceId === null);
          if (done === -1) throw new Error("Too many sign-outs kept");
          next.splice(done, 1);
        }
        return next;
      }),
    released: (cookie) =>
      change((list) =>
        list.map((leftover) =>
          leftover.cookie === cookie ? { ...leftover, workspaceId: null } : leftover,
        ),
      ),
    renewed: (cookie, expiresAt) =>
      change((list) =>
        list.map((leftover) =>
          leftover.cookie === cookie && expiresAt > leftover.expiresAt
            ? { ...leftover, expiresAt }
            : leftover,
        ),
      ),
    remove: (cookie) => change((list) => list.filter((leftover) => leftover.cookie !== cookie)),
  };
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
  add: Leftovers["add"];
  /** The Better Auth base URL the session belongs to. */
  origin: string;
  now: () => number;
  /** How long a session lasts on the server (Better Auth's `expiresIn`, ms). */
  lifetime: number;
};

/**
 * Signs the member out here, always. `released`: the phone no longer pages them. `kept`: the shard could not be
 * told, so it may still page them until the app is next online (`finishSignOut`); their session stays valid on the
 * server until then, since a revoked one could never take the phone off. `stuck`: the shard could not be told and
 * the session could not be kept either (it could not be read or stored, or `MAX_KEPT` sign-outs still on their
 * shards are kept already), so nothing on the phone can take it off
 * the shard: it pages them until its token expires or someone they trust removes the device.
 */
export async function signOutPhone(
  member: { userId: string; workspaceId: string },
  deps: SignOutDeps,
): Promise<"released" | "kept" | "stuck"> {
  const cookie = await deps.cookie().catch(() => "");
  const released = deps.unregister ? await deps.unregister() : true;
  // Without a cookie there is nothing to finish with later.
  const keep = async (workspaceId: string | null) => {
    if (cookie === "") return false;
    const leftover = { cookie, userId: member.userId, workspaceId, origin: deps.origin };
    const keptAt = deps.now();
    return deps.add({ ...leftover, expiresAt: keptAt + deps.lifetime, keptAt }).then(
      () => true,
      () => false,
    );
  };
  if (!released) {
    const kept = await keep(member.workspaceId);
    await deps.forget();
    return kept ? "kept" : "stuck";
  }
  // Signed out here whatever the server answers; an unanswered sign-out is finished later.
  if (!(await deps.signOut().catch(() => false))) await keep(null);
  return "released";
}

export type FinishDeps = {
  leftovers: Pick<Leftovers, "list" | "released" | "renewed" | "remove">;
  /** The Better Auth base URL this build talks to now: only its sessions can be finished. */
  origin: string;
  now: () => number;
  /** How long a session lasts on the server (Better Auth's `expiresIn`, ms). */
  lifetime: number;
  /**
   * Whether the server still knows the session, without extending it, and when it expires there: false when it does
   * not, null when it could not be asked.
   */
  session: (cookie: string) => Promise<{ expiresAt: number } | false | null>;
  /** `SignOutDeps.unregister` with the leftover's session and workspace. */
  unregister: (leftover: Leftover & { workspaceId: string }) => Promise<boolean>;
  /** Revokes the session on the server; true when it answered. */
  signOut: (cookie: string) => Promise<boolean>;
};

export type FinishResult = "none" | "finished" | "pending";

/**
 * Finishes every kept sign-out: takes the phone off the shard with the old session, then revokes it. `none`:
 * nothing was left. `finished`: nothing is left now, so the phone can be registered for whoever is signed in.
 * `pending`: one is still waiting (offline, or the shard did not answer); try again later.
 *
 * A session the server no longer knows (expired, revoked elsewhere) cannot take the phone off, and nothing else
 * can: the leftover is dropped, and the phone stays the other member's on that shard (RFC 0006). One kept against
 * another server (a development build whose Metro host moved) waits for the app to talk to that server again, until
 * its session would have expired anyway; it is not this server's to finish, so it never makes the result `pending`.
 * Whatever renewed it, a record is dropped a lifetime after it was kept (`keptAt`), revoking its session first when
 * it is this server's (best effort): a removed member's record would otherwise keep itself and the session alive.
 */
export async function finishSignOut(deps: FinishDeps): Promise<FinishResult> {
  const kept = await deps.leftovers.list();
  if (kept.length === 0) return "none";
  let result: FinishResult = "none";
  for (const leftover of kept) {
    if (deps.now() >= leftover.expiresAt) {
      await deps.leftovers.remove(leftover.cookie);
      continue;
    }
    const mine = leftover.origin === deps.origin;
    if (deps.now() >= leftover.keptAt + deps.lifetime) {
      if (mine) await deps.signOut(leftover.cookie).catch(() => false);
      await deps.leftovers.remove(leftover.cookie);
      continue;
    }
    if (!mine) continue;
    if (!(await finishOne(leftover, deps))) result = "pending";
    else if (result === "none") result = "finished";
  }
  return result;
}

/** True once nothing is left of `leftover`. */
async function finishOne(leftover: Leftover, deps: FinishDeps): Promise<boolean> {
  const alive = await deps.session(leftover.cookie).catch(() => null);
  if (alive === null) return false;
  if (alive) {
    const { workspaceId } = leftover;
    // Better Auth renews a session used more than a day after its last renewal, and the socket below is such a use:
    // keep it as long as the server may.
    const opens = workspaceId !== null ? deps.now() + deps.lifetime : 0;
    await deps.leftovers.renewed(leftover.cookie, Math.max(alive.expiresAt, opens)).catch(() => {});
    if (workspaceId !== null) {
      if (!(await deps.unregister({ ...leftover, workspaceId }).catch(() => false))) return false;
      // Off the shard: a later try only revokes the session. If this write fails, unregistering again is harmless.
      await deps.leftovers.released(leftover.cookie).catch(() => {});
    }
    if (!(await deps.signOut(leftover.cookie).catch(() => false))) return false;
  }
  await deps.leftovers.remove(leftover.cookie);
  return true;
}
