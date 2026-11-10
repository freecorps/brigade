// The member's workspaces and the one the dashboard shows (RFC 0017 "The active workspace leaves the session"): the
// list from the API (`GET /api/workspaces`, D1's memberships with their roles), the pick kept in this browser. No
// session holds an active workspace on Ember's auth, so the dashboard keeps its own; on D1's it works the same.
// A pick no longer in the list (left, removed, another account signed in here) falls back to the oldest membership.
import { isRole, type Role } from "@freecorps/brigade-schema";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { listedMembers, type ListedMember } from "./members";
import { getStorage } from "./storage";

export type Membership = { id: string; name: string; role: Role };

/** Where the pick is kept in this browser. Only an id: another account signing in here falls back to its own. */
export const WORKSPACE_KEY = "brigade:workspace";

type State = {
  /** Undefined until the first answer. */
  list?: Membership[];
  /** The last load failed (the list, if any, is the one before). */
  error: boolean;
  loading: boolean;
  picked: string | null;
};

const listeners = new Set<() => void>();
let state: State = { error: false, loading: false, picked: readPick() };

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function readPick(storage: Pick<Storage, "getItem"> | undefined = getStorage()): string | null {
  try {
    return storage?.getItem(WORKSPACE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The API's answer as the dashboard keeps it; anything malformed is left out. */
export function parseMemberships(body: unknown): Membership[] {
  const raw: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "workspaces") : undefined;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id: unknown = Reflect.get(entry, "id");
    const name: unknown = Reflect.get(entry, "name");
    const role: unknown = Reflect.get(entry, "role");
    if (typeof id !== "string" || typeof name !== "string") return [];
    // Brigade gives every member one of its roles; anything else reads nothing, like the shard would answer.
    return [{ id, name, role: isRole(role) ? role : "viewer" }];
  });
}

/** The workspace to show: the pick while it is in the list, else the oldest membership; none without any. */
export function activeOf(
  list: Membership[] | undefined,
  picked: string | null,
): Membership | undefined {
  return list?.find((one) => one.id === picked) ?? list?.[0];
}

/** Loads the member's workspaces again; the list, or undefined when the API could not answer. */
export async function loadWorkspaces(
  fetchImpl: typeof fetch = fetch,
): Promise<Membership[] | undefined> {
  // Before any list, a new try is loading again, not the failure before it.
  set(state.list === undefined ? { loading: true, error: false } : { loading: true });
  try {
    const response = await fetchImpl("/api/workspaces", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GET /api/workspaces: ${response.status}`);
    const list = parseMemberships(await response.json());
    set({ list, error: false, loading: false });
    return list;
  } catch {
    set({ error: true, loading: false });
    return undefined;
  }
}

/** Shows workspace `id` from now on, in this tab and the next page load. */
export function pickWorkspace(
  id: string,
  storage: Pick<Storage, "setItem"> | undefined = getStorage(),
): void {
  try {
    storage?.setItem(WORKSPACE_KEY, id);
  } catch {
    // Blocked storage: this tab keeps the pick all the same.
  }
  set({ picked: id });
}

/** The workspace picked in this tab, if any (it may no longer be a membership: `activeOf`). */
export function pickedWorkspace(): string | null {
  return state.picked;
}

/** Forgets the list (signing out): the next account starts from its own. */
export function resetWorkspaces(): void {
  set({ list: undefined, error: false, loading: false });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The member's workspaces and the one shown, loaded once per page and on `refetch`. */
export function useWorkspaces() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    if (state.list === undefined && !state.loading) void loadWorkspaces();
  }, []);
  return {
    list: current.list,
    active: activeOf(current.list, current.picked),
    isPending: current.list === undefined && !current.error,
    error: current.error,
    refetch: () => loadWorkspaces(),
    pick: pickWorkspace,
  };
}

/** What `GET /api/workspaces/:id/members` answered: the members, or `left` when the caller is not one any more. */
export async function loadMembers(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; members: ListedMember[] } | { ok: false; left: boolean }> {
  try {
    const response = await fetchImpl(`/api/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      headers: { Accept: "application/json" },
    });
    if (response.status === 403) return { ok: false, left: true };
    if (!response.ok) return { ok: false, left: false };
    const body: unknown = await response.json();
    const raw =
      typeof body === "object" && body !== null ? Reflect.get(body, "members") : undefined;
    return { ok: true, members: listedMembers(raw) };
  } catch {
    return { ok: false, left: false };
  }
}

/** The workspace's members, loaded when it changes and on `refetch` (false once the caller left it). */
export function useMembers(workspaceId: string) {
  const [members, setMembers] = useState<ListedMember[] | undefined>();
  const [error, setError] = useState(false);
  const refetch = useCallback(async () => {
    const loaded = await loadMembers(workspaceId);
    if (loaded.ok) {
      setMembers(loaded.members);
      setError(false);
      return true;
    }
    setError(true);
    return !loaded.left;
  }, [workspaceId]);
  useEffect(() => {
    setMembers(undefined);
    void refetch();
  }, [refetch]);
  return { members, isPending: members === undefined && !error, error, refetch };
}
