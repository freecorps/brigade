// The workspace's sync client for a workspace on Ember (RFC 0016 step 5): Ember's client under the same hooks as
// Brigade Sync's (`@freecorps/brigade-sync/ember`), its tokens from `POST /api/ember-token/:workspace` (src/lib/
// engine.ts), its unconfirmed changes in the member's queue (src/lib/ember-queue.ts). Only the open workspace uses it:
// the one-shot clients that register or unregister a phone elsewhere stay on Brigade Sync, which the adapter serves for
// a workspace on Ember (src/lib/phone.ts).
import type { Actor } from "@freecorps/brigade-schema";
import { createEmberSyncClient } from "@freecorps/brigade-sync/ember";
import { createExpoConnectivity } from "@freecorps/ember-react-native";
import { getRandomBytes } from "expo-crypto";
import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { AppState } from "react-native";
import { emberQueue } from "@/lib/ember-queue";
import { emberTokens, type Minted } from "@/lib/engine";
import { restoredChanges, type MemberQueue } from "@/lib/pending";
import type { Server } from "@/lib/sync";
import type { WorkspaceSync } from "@/lib/sync-client";

export function createEmberWorkspaceSync({
  server,
  workspaceId,
  actor,
  cookie,
  queue,
  primed,
  onTurnedBack,
}: {
  server: Server;
  workspaceId: string;
  actor: () => Actor;
  cookie: () => string;
  queue?: MemberQueue;
  primed?: Minted;
  onTurnedBack: () => void;
}): WorkspaceSync {
  const kept = queue ? emberQueue(queue, workspaceId) : undefined;
  const client = createEmberSyncClient({
    url: server.ember,
    token: emberTokens({
      url: server.emberToken(workspaceId),
      cookie,
      fetch: (url, init) => fetch(url, init),
      ...(primed ? { primed } : {}),
      onTurnedBack,
    }),
    actor,
    // The token goes in Ember's `hello`, so React Native's own WebSocket needs no headers.
    connectivity: connectivity(),
    randomBytes: getRandomBytes,
    ...(kept
      ? {
          clientId: queue!.clientId,
          storage: () => kept.storage,
          onRestoredOutcome: (_workspace, record, outcome) => kept.settle(record, outcome),
        }
      : {}),
    onWarning: (message, detail) => console.warn(message, detail),
  });
  let restored = false;
  const sync: WorkspaceSync = {
    client,
    shard: workspaceId,
    engine: "ember",
    queue,
    restored: restoredChanges([]),
    restore: () => {
      if (restored) return;
      restored = true;
      if (kept) sync.restored = kept.restore();
    },
  };
  // Without a kept queue nothing waits for the role: the client's own memory has nothing to give back.
  return sync;
}

/**
 * The network and the app's state for Ember's client: offline closes its sockets and stops reconnecting, back online
 * or in the foreground it reconnects or checks the socket. The sockets stay open in the background, as Brigade Sync's
 * do: a call's "press 1" ack is sent while the app is not in front (src/lib/call.ts).
 */
function connectivity() {
  const reachable = (state: NetworkState) => ({
    isConnected: state.isConnected ?? null,
    isInternetReachable: state.isInternetReachable ?? null,
  });
  return createExpoConnectivity({
    appState: AppState,
    netInfo: {
      addEventListener: (listener) => {
        const subscription = addNetworkStateListener((state) => listener(reachable(state)));
        return () => subscription.remove();
      },
      fetch: () => getNetworkStateAsync().then(reachable),
    },
    backgroundGraceMs: Infinity,
  });
}
