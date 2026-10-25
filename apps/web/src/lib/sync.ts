// The dashboard's Brigade Sync client (RFC 0004): one per tab, on the same origin as the page. The web Worker
// forwards `/api/sync/<workspace>` to the API Worker, which hands the socket to the workspace's shard.
import { newId, type Actor } from "@freecorps/brigade-schema";
import { createSyncClient, TOKEN, type SyncClient } from "@freecorps/brigade-sync";

export const CLIENT_ID_STORAGE_KEY = "brigade-sync-client";

/**
 * The actor optimistic mutations run as. It matches the shard's dev-only actor (apps/api, `SYNC_DEV_ACTOR`): the
 * server takes the actor from the socket, and another role here would show changes the shard then refuses.
 */
export const DEV_ACTOR: Actor = { kind: "user", id: "usr_dev", role: "responder" };

/** `ws://host/api/sync/demo` from an `http:` page, `wss://` from an `https:` one. */
export function syncUrl(location: Pick<Location, "protocol" | "host">, shard: string): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/api/sync/${encodeURIComponent(shard)}`;
}

/**
 * A client id that survives reloads of this tab (sessionStorage is per tab), so the shard recognises a mutation
 * re-sent after a reload instead of running it twice. A new tab, or blocked storage, gets a new id.
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
    actor: DEV_ACTOR,
    clientId,
  });
}
