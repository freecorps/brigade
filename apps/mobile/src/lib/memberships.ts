// The member's workspaces at an instance and the one the app opens (RFC 0017 "The active workspace leaves the
// session"): the list from `GET /api/workspaces` (each with the member's role there), the pick kept on the phone as
// the workspace last opened (src/lib/sync.ts `KnownWorkspace`, in secure storage, so the app opens it offline). No
// session holds an active workspace on Ember's auth, so the app keeps its own; on D1's it works the same, the session's
// `activeOrganizationId` only a hint for a phone that kept nothing yet. Pure, so it is tested in Node;
// src/lib/instance-clients.ts makes one per instance.
import { isRole, type Role } from "@freecorps/brigade-schema";
import type { KnownWorkspace } from "@/lib/sync";

export type Membership = { id: string; name: string; role: Role };

/** `GET /api/workspaces`'s answer as the app keeps it; undefined when it is not one. A role the app does not know reads as `viewer`. */
export function parseMemberships(body: unknown): Membership[] | undefined {
  const raw: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "workspaces") : undefined;
  if (!Array.isArray(raw)) return undefined;
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id: unknown = Reflect.get(entry, "id");
    const name: unknown = Reflect.get(entry, "name");
    const role: unknown = Reflect.get(entry, "role");
    if (typeof id !== "string" || id.length === 0 || typeof name !== "string") return [];
    return [{ id, name, role: isRole(role) ? role : "viewer" }];
  });
}

/** The member's workspaces at `url` (the instance's `/api/workspaces`) with their session; undefined without an answer. */
export async function listWorkspaces(
  url: string,
  cookie: string,
  fetcher: typeof fetch = fetch,
): Promise<Membership[] | undefined> {
  try {
    const response = await fetcher(url, { headers: { accept: "application/json", cookie } });
    if (!response.ok) return undefined;
    return parseMemberships(await response.json());
  } catch {
    return undefined;
  }
}

/** The workspace kept as last opened, if it is `userId`'s; anything else is nothing. */
export function keptWorkspace(raw: string | null, userId: string): KnownWorkspace | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const known = value as Record<string, unknown>;
    if (known.userId !== userId || typeof known.workspaceId !== "string") return null;
    if (known.workspaceId.length === 0 || typeof known.name !== "string" || !isRole(known.role)) {
      return null;
    }
    return { userId, workspaceId: known.workspaceId, name: known.name, role: known.role };
  } catch {
    return null;
  }
}

export type Memberships = {
  userId: string;
  /** The last list read for them; undefined before any answer. */
  list?: Membership[];
  /** The last read had no answer (the list, if any, is the one before). */
  error: boolean;
  loading: boolean;
  /** The workspace last opened, as kept on the phone: undefined until it is read, null without one. */
  known: KnownWorkspace | null | undefined;
};

/** What the app opens at the instance, from `Memberships` (`openingOf`). */
export type Opening =
  /** Still reading what was kept, or the list with nothing kept. */
  | { kind: "pending" }
  /** The list says they are in no workspace. */
  | { kind: "none" }
  /** Nothing kept and the list could not be read. */
  | { kind: "unavailable" }
  /**
   * `name` and `role` from the list when it has the workspace, else as kept; neither for a session's hint opened
   * before any list (they come with it).
   */
  | { kind: "open"; workspaceId: string; name?: string; role?: Role; listed: boolean };

/**
 * The workspace the app opens: the one kept while the list has it (or while there is no list yet: offline, it is all
 * the phone knows), else the session's `hint` (D1's active organization) when listed, else the oldest membership.
 */
export function openingOf(state: Memberships | null, hint?: string | null): Opening {
  if (!state || state.known === undefined) return { kind: "pending" };
  const { list, known } = state;
  if (list) {
    const entry =
      list.find((one) => one.id === known?.workspaceId) ??
      list.find((one) => one.id === hint) ??
      list[0];
    if (!entry) return { kind: "none" };
    return {
      kind: "open",
      workspaceId: entry.id,
      name: entry.name,
      role: entry.role,
      listed: true,
    };
  }
  if (known) {
    return {
      kind: "open",
      workspaceId: known.workspaceId,
      name: known.name,
      role: known.role,
      listed: false,
    };
  }
  if (hint) return { kind: "open", workspaceId: hint, listed: false };
  return state.error && !state.loading ? { kind: "unavailable" } : { kind: "pending" };
}

/**
 * Whether the open workspace is unavailable: the list could not be read and nothing else gives its name or the
 * member's role. Offline, a kept name and role open it without the list, so that is not a failure.
 */
export function cannotOpen(
  listFailed: boolean,
  name: string | undefined,
  role: Role | undefined,
): boolean {
  return listFailed && (name === undefined || role === undefined);
}

export type MembershipsStore = {
  subscribe: (listener: () => void) => () => void;
  /** The state for `userId`; null while the store is someone else's or nobody's. */
  current: (userId: string) => Memberships | null;
  /** Whose it is now, if anyone's. */
  owner: () => string | null;
  /**
   * Makes it `userId`'s: another member's list and pick are never shown. Reads what was kept and the list the first
   * time, and the list again while none came.
   */
  own: (userId: string) => void;
  /** Reads the list again; the list, or undefined without an answer (or when another load or member came since). */
  load: () => Promise<Membership[] | undefined>;
  /**
   * Opens `workspaceId` from now on, on this phone and at the next launch: one in the list (read again when it does
   * not have it yet, so a workspace just made or joined counts). False when the list has no such workspace or could not be read.
   */
  pick: (workspaceId: string) => Promise<boolean>;
  /** Keeps the workspace open now as last opened, with its name and role as read, so the next launch opens it offline. */
  keep: (known: KnownWorkspace) => void;
  /** Forgets the pick and the list (signing out). */
  forget: () => Promise<void>;
};

export function membershipsStore(deps: {
  list: () => Promise<Membership[] | undefined>;
  read: () => Promise<string | null>;
  write: (raw: string) => Promise<void>;
  remove: () => Promise<void>;
}): MembershipsStore {
  const listeners = new Set<() => void>();
  let state: Memberships | null = null;
  /** Bumped by every load, member change and forget: only the latest load's answer is kept. */
  let generation = 0;
  /** Writes one at a time, in order, so the last pick is the one kept. */
  let writes: Promise<void> = Promise.resolve();

  const set = (next: Memberships | null) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const update = (userId: string, patch: Partial<Memberships>) => {
    if (state?.userId === userId) set({ ...state, ...patch });
  };
  const persist = (step: () => Promise<void>) => {
    writes = writes.then(step).catch(() => {
      // Not kept: this launch has it all the same, and the next opens the oldest membership.
    });
    return writes;
  };

  const load = async (): Promise<Membership[] | undefined> => {
    const userId = state?.userId;
    if (userId === undefined) return undefined;
    const mine = ++generation;
    update(userId, { loading: true });
    const list = await deps.list().catch(() => undefined);
    if (mine !== generation) return undefined;
    update(userId, list ? { list, error: false, loading: false } : { error: true, loading: false });
    return list;
  };

  const keep = (known: KnownWorkspace) => {
    if (state?.userId !== known.userId) return;
    const before = state.known;
    if (
      before?.workspaceId === known.workspaceId &&
      before.name === known.name &&
      before.role === known.role
    ) {
      return;
    }
    update(known.userId, { known });
    void persist(() => deps.write(JSON.stringify(known)));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    current: (userId) => (state?.userId === userId ? state : null),
    owner: () => state?.userId ?? null,
    own(userId) {
      if (state?.userId === userId) {
        if (state.list === undefined && !state.loading) void load();
        return;
      }
      generation++;
      set({ userId, error: false, loading: false, known: undefined });
      void deps
        .read()
        .catch(() => null)
        .then((raw) => {
          // A pick made meanwhile is newer than what was kept.
          if (state?.userId === userId && state.known === undefined) {
            update(userId, { known: keptWorkspace(raw, userId) });
          }
        });
      void load();
    },
    load,
    async pick(workspaceId) {
      const userId = state?.userId;
      if (userId === undefined) return false;
      let entry = state?.list?.find((one) => one.id === workspaceId);
      if (!entry) entry = (await load())?.find((one) => one.id === workspaceId);
      if (!entry || state?.userId !== userId) return false;
      keep({ userId, workspaceId: entry.id, name: entry.name, role: entry.role });
      return true;
    },
    keep,
    async forget() {
      generation++;
      set(null);
      await persist(deps.remove);
    },
  };
}
