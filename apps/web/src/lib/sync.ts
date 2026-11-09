// The dashboard's sync client (RFC 0016 step 5): Ember's, one per tab, on the same origin as the page. The web Worker
// forwards `/api/ember/*` to the API Worker, and `/api/ember-token/<workspace>` mints the token for its shard.
import { newId, type Actor } from "@freecorps/brigade-schema";
import { TOKEN } from "@freecorps/brigade-sync";
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

type Minted = { token: string; expiresAt: number };

/**
 * A fresh Ember token for `workspaceId` (`POST /api/ember-token/:workspace`), or null when signed out or not a member
 * (401, 403): the client then stops asking until its next connect, and the session gate shows why.
 */
export async function emberToken(
  workspaceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const response = await fetchImpl(`/api/ember-token/${encodeURIComponent(workspaceId)}`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error(`Ember token: ${response.status}`);
  const minted = (await response.json().catch(() => null)) as Partial<Minted> | null;
  if (typeof minted?.token !== "string") throw new Error("Ember token: no token in the answer");
  return minted.token;
}

/** The dashboard's client, on the same origin (`/api/ember/ws`). */
export function createBrowserEmberClient(): EmberSyncClient {
  return createEmberSyncClient({
    url: () => `${window.location.origin}/api/ember`,
    token: (workspaceId) => emberToken(workspaceId),
    actor: syncActor,
    clientId: browserClientId(),
  });
}
