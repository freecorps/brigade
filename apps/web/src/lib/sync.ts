// The dashboard's Brigade Sync client (RFC 0004): one per tab, on the same origin as the page. The web Worker
// forwards `/api/sync/<workspace>` to the API Worker, which hands the socket to the workspace's shard.
import { newId, type Actor } from "@freecorps/brigade-schema";
import { createSyncClient, TOKEN, type SyncClient } from "@freecorps/brigade-sync";

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

export function createBrowserSyncClient(): SyncClient {
  const clientId = tabClientId(sessionStorageOrUndefined(), () =>
    newId("cli", Date.now(), (length) => crypto.getRandomValues(new Uint8Array(length))),
  );
  return createSyncClient({
    url: (shard) => syncUrl(window.location, shard),
    actor: syncActor,
    clientId,
  });
}
