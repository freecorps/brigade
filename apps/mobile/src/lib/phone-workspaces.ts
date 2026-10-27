// The workspaces this phone pages the signed-in member for (RFC 0006 "Device registration"): each one they opened on
// it, kept across launches, so registering again (a new push or VoIP token, Critical Alerts, notifications turned back
// on) reaches every one of them, not only the one open (src/lib/device.ts `registerEverywhere`). With each, its name,
// and the member's on-call stretches there as last seen, so the widget and the on-call screen can say "On call in
// <workspace>" for a workspace that is not open. One member's at a time: another member's list is never read, and
// signing out forgets it. Pure, so it is tested in Node; src/lib/phone.ts keeps it in secure storage.

/** The member's on-call stretches in a workspace as last seen there (src/lib/widget.ts), and until when they hold. */
export type SeenShifts = { shifts: [number, number | null][]; staleAt: number };

export type PhoneWorkspace = { id: string; name?: string; oncall?: SeenShifts };

export type PhoneWorkspaces = { userId: string; workspaces: PhoneWorkspace[] };

/** Where it is kept (secure storage). */
export const PHONE_WORKSPACES_KEY = "brigade.workspaces";

/** Workspaces kept: a member belongs to at most 10 (apps/api `WORKSPACE_LIMIT`). */
export const MAX_PHONE_WORKSPACES = 10;
/** Stretches kept per workspace: a day of handoffs, and the list stays small enough for secure storage. */
export const MAX_SEEN_SHIFTS = 8;

/** `userId`'s list from what was stored; empty for anything else (another member's, nothing, garbage). */
export function readPhoneWorkspaces(raw: string | null, userId: string): PhoneWorkspaces {
  const empty = { userId, workspaces: [] };
  if (raw === null) return empty;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof value !== "object" || value === null) return empty;
  const stored = value as { userId?: unknown; workspaces?: unknown };
  if (stored.userId !== userId || !Array.isArray(stored.workspaces)) return empty;
  const workspaces: PhoneWorkspace[] = [];
  for (const item of stored.workspaces as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name, oncall } = item as Record<string, unknown>;
    if (typeof id !== "string" || id.length === 0 || workspaces.some((w) => w.id === id)) continue;
    workspaces.push({
      id,
      ...(typeof name === "string" ? { name } : {}),
      ...(seenShifts(oncall) ? { oncall: oncall as SeenShifts } : {}),
    });
  }
  return { userId, workspaces: workspaces.slice(0, MAX_PHONE_WORKSPACES) };
}

function seenShifts(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { shifts, staleAt } = value as Record<string, unknown>;
  return (
    typeof staleAt === "number" &&
    Array.isArray(shifts) &&
    shifts.every(
      (shift) =>
        Array.isArray(shift) &&
        shift.length === 2 &&
        typeof shift[0] === "number" &&
        (shift[1] === null || typeof shift[1] === "number"),
    )
  );
}

/** With `id` in it (opened on the phone), its name updated when known. The most recent first. */
export function withWorkspace(list: PhoneWorkspaces, id: string, name?: string): PhoneWorkspaces {
  const current = list.workspaces.find((workspace) => workspace.id === id);
  const updated: PhoneWorkspace = { ...current, id, ...(name !== undefined ? { name } : {}) };
  return {
    userId: list.userId,
    workspaces: [updated, ...list.workspaces.filter((workspace) => workspace.id !== id)].slice(
      0,
      MAX_PHONE_WORKSPACES,
    ),
  };
}

/** Without `ids`: workspaces the member left or was removed from (the API answers `not_a_member`). */
export function withoutWorkspaces(list: PhoneWorkspaces, ids: readonly string[]): PhoneWorkspaces {
  return {
    userId: list.userId,
    workspaces: list.workspaces.filter((workspace) => !ids.includes(workspace.id)),
  };
}

/** With the member's stretches in `id` as seen now (only the first `MAX_SEEN_SHIFTS`). */
export function withShifts(list: PhoneWorkspaces, id: string, seen: SeenShifts): PhoneWorkspaces {
  return {
    userId: list.userId,
    workspaces: list.workspaces.map((workspace) =>
      workspace.id === id
        ? {
            ...workspace,
            oncall: { shifts: seen.shifts.slice(0, MAX_SEEN_SHIFTS), staleAt: seen.staleAt },
          }
        : workspace,
    ),
  };
}

/**
 * The list kept in `storage`, its changes made one at a time (each reads what the one before wrote), and what it
 * holds now for those reading it in render. Never throws: a list that cannot be read or written is empty, and the
 * phone registers in the open workspace at least.
 */
export function phoneWorkspacesStore(storage: {
  read: () => Promise<string | null>;
  write: (raw: string | null) => Promise<void>;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  let latest: PhoneWorkspaces | null = null;
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.catch(() => {});
    return next;
  };
  const read = async (userId: string) =>
    readPhoneWorkspaces(await storage.read().catch(() => null), userId);
  return {
    read: (userId: string) =>
      run(async () => {
        const list = await read(userId);
        latest = list;
        return list;
      }),
    update: (userId: string, change: (list: PhoneWorkspaces) => PhoneWorkspaces) =>
      run(async () => {
        const list = change(await read(userId));
        await storage.write(JSON.stringify(list)).catch(() => {});
        latest = list;
        for (const listener of listeners) listener();
        return list;
      }),
    /** Signing out: nobody's list. */
    clear: () =>
      run(async () => {
        await storage.write(null).catch(() => {});
        latest = null;
        for (const listener of listeners) listener();
      }),
    /** The list as last read or written, if it is `userId`'s. */
    current: (userId: string): PhoneWorkspaces | null =>
      latest?.userId === userId ? latest : null,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type PhoneWorkspacesStore = ReturnType<typeof phoneWorkspacesStore>;
