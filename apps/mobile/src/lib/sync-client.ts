// Brigade Sync clients (RFC 0004): one per signed-in member and workspace, made by the session (src/components/
// session.tsx) and closed when they sign out or the workspace changes, so no socket or row outlives its session.
// Changes the shard has not confirmed are kept in the member's queue (src/lib/pending.ts) and survive a restart.
import type { Actor } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient, type SyncSocket } from "@freecorps/brigade-sync";
import { getRandomBytes } from "expo-crypto";
import {
  restoreQueue,
  restoredChanges,
  type MemberQueue,
  type RestoredChanges,
} from "@/lib/pending";
import type { Server } from "@/lib/sync";

export type WorkspaceSync = {
  client: SyncClient;
  shard: string;
  /** The member's kept queue; none for a client that only finishes a sign-out. */
  queue?: MemberQueue;
  /** The changes the queue gave back at launch, for the screens that made them; none until `restore`. */
  restored: RestoredChanges;
  /**
   * Puts the queue's changes back, applied as the actor's role is then: call it once the member's role is known
   * (a role still loading reads as viewer, and the changes would drop out of the view). Once; later calls do nothing.
   */
  restore: () => void;
};

export function createWorkspaceSync({
  server,
  workspaceId,
  actor,
  cookie,
  queue,
}: {
  server: Server;
  workspaceId: string;
  actor: () => Actor;
  /** The session's `Cookie` header, read on every connect so a refreshed session is the one sent. */
  cookie: () => string;
  queue?: MemberQueue;
}): WorkspaceSync {
  const client = createSyncClient({
    url: server.sync,
    actor,
    // A native socket carries no browser cookies: the session goes in the upgrade's `Cookie` header, which the
    // API checks like the dashboard's (apps/api/src/actor.ts). React Native's WebSocket takes headers as a third
    // argument.
    transport: (url) => new NativeWebSocket(url, undefined, { headers: { Cookie: cookie() } }),
    // Hermes has no crypto.getRandomValues.
    randomBytes: getRandomBytes,
    // The id the queue's changes were sent with: the shard de-duplicates re-sent mutations by (clientId,
    // mutationId), so one it ran before the app was killed is answered, not run again. Without a queue, a new one.
    clientId: queue?.clientId,
    pendingStorage: queue?.storage,
  });
  let restored = false;
  const sync: WorkspaceSync = {
    client,
    shard: workspaceId,
    queue,
    restored: restoredChanges([]),
    restore: () => {
      if (restored || !queue) return;
      restored = true;
      sync.restored = restoreQueue(client, workspaceId, queue);
    },
  };
  return sync;
}

/** React Native's WebSocket, whose constructor takes headers (the DOM's, which TypeScript knows, does not). */
const NativeWebSocket = WebSocket as unknown as new (
  url: string,
  protocols: undefined,
  options: { headers: Record<string, string> },
) => SyncSocket;

let current: WorkspaceSync | null = null;

/**
 * The signed-in member's sync client, for code outside React (the call screen's "press 1" ack, src/lib/call.ts);
 * null while signed out.
 */
export function currentSync(): WorkspaceSync | null {
  return current;
}

export function setCurrentSync(sync: WorkspaceSync | null): void {
  current = sync;
}
