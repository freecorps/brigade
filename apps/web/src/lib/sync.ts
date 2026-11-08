// The dashboard's Brigade Sync client (RFC 0004): one per tab, on the same origin as the page. The web Worker
// forwards `/api/sync/<workspace>` to the API Worker, which hands the socket to the workspace's shard.
import { newId, type Actor } from "@freecorps/brigade-schema";
import { createSyncClient, TOKEN, type SyncClient } from "@freecorps/brigade-sync";
import { createEmberSyncClient, type EmberSyncClient } from "@freecorps/brigade-sync/ember";

export const CLIENT_ID_STORAGE_KEY = "brigade-sync-client";

let currentActor: Actor | undefined;

/**
 * Sets who optimistic mutations run as: the signed-in member and their role in the workspace (components/session).
 * The shard takes the actor from the authenticated socket; the same role here means a change the shard would
 * refuse is not shown first.
 */
export function setSyncActor(actor: Actor): void {
  currentActor = actor;
}

function syncActor(): Actor {
  // The dashboard renders nothing that mutates before the session gate sets it; a throw here fails the mutation
  // with `internal` instead of running it as someone else.
  if (!currentActor) throw new Error("No signed-in member yet");
  return currentActor;
}

/** `ws://host/api/sync/demo` from an `http:` page, `wss://` from an `https:` one. */
export function syncUrl(location: Pick<Location, "protocol" | "host">, shard: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/sync/${encodeURIComponent(shard)}`;
}

/**
 * A client id that survives reloads of this tab (sessionStorage is per tab). Groundwork: the shard de-duplicates
 * mutations by (clientId, mutationId), but the web client keeps pending mutations in memory only, so nothing is
 * re-sent after a reload yet. Once they are persisted, a stable id lets the shard recognise them. A new tab, or
 * blocked storage, gets a new id.
 */
export function tabClientId(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  create: () => string,
): string {
  try {
    const stored = storage?.getItem(CLIENT_ID_STORAGE_KEY);
    if (stored && TOKEN.test(stored)) return stored;
  } catch {
    // Storage unavailable: a fresh id for this page load.
  }
  const id = create();
  try {
    storage?.setItem(CLIENT_ID_STORAGE_KEY, id);
  } catch {
    // Not kept: the next reload gets another id, which only loses de-duplication across that reload.
  }
  return id;
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function browserClientId(): string {
  return tabClientId(sessionStorageOrUndefined(), () =>
    newId("cli", Date.now(), (length) => crypto.getRandomValues(new Uint8Array(length))),
  );
}

export function createBrowserSyncClient(): SyncClient {
  const clientId = browserClientId();
  return createSyncClient({
    url: (shard) => syncUrl(window.location, shard),
    actor: syncActor,
    clientId,
  });
}

/** Which engine serves a workspace (RFC 0016): `ember` once it switched, `brigade` (Brigade Sync) before. */
export type WorkspaceEngine = "ember" | "brigade";

type Minted = { token: string; expiresAt: number };

/** Tokens a probe already minted, handed to the Ember client's first connect instead of minting another. */
const primed = new Map<string, Minted>();

/**
 * Asks the API for an Ember token for `workspaceId` (`POST /api/ember-token/:workspace`). A workspace still on
 * `WorkspaceDO` answers 409, and an instance from before Ember 404: both are `brigade`, as are a missing session or
 * membership (401, 403), whose errors the Brigade Sync path shows as before. When the API cannot say (offline, a
 * 5xx), `brigade` too: a workspace on Ember is served Brigade Sync by its adapter, so the dashboard still works.
 */
export async function probeWorkspaceEngine(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WorkspaceEngine> {
  try {
    const response = await fetchImpl(`/api/ember-token/${encodeURIComponent(workspaceId)}`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) return "brigade";
    const minted = (await response.json()) as Partial<Minted> | null;
    if (typeof minted?.token !== "string" || typeof minted.expiresAt !== "number") return "brigade";
    primed.set(workspaceId, minted as Minted);
    return "ember";
  } catch {
    return "brigade";
  }
}

/** A fresh Ember token, or null when signed out. A workspace turned back to `WorkspaceDO` reloads the page. */
async function emberToken(workspaceId: string): Promise<string | null> {
  const ready = primed.get(workspaceId);
  primed.delete(workspaceId);
  // Kept a margin from its expiry, as Ember's client refreshes 30 s ahead.
  if (ready && ready.expiresAt - Date.now() > 60_000) return ready.token;
  const response = await fetch(`/api/ember-token/${encodeURIComponent(workspaceId)}`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (response.status === 401) return null;
  if (response.status === 409) {
    // Turned back (RFC 0016 `back`): the page starts over on Brigade Sync.
    window.location.reload();
    return null;
  }
  if (!response.ok) throw new Error(`Ember token: ${response.status}`);
  return ((await response.json()) as Minted).token;
}

/** The dashboard's client for workspaces on Ember, on the same origin (`/api/ember/ws`). */
export function createBrowserEmberClient(): EmberSyncClient {
  return createEmberSyncClient({
    url: `${window.location.origin}/api/ember`,
    token: emberToken,
    actor: syncActor,
    clientId: browserClientId(),
  });
}
