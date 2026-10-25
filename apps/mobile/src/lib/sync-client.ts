// The app's one Brigade Sync client (RFC 0004), created at module scope.
import { createSyncClient } from "@freecorps/brigade-sync";
import Constants from "expo-constants";
import { getRandomBytes } from "expo-crypto";
import { DEV_ACTOR, syncUrl } from "@/lib/sync";

export const syncClient = createSyncClient({
  url: (shard) => {
    const url = syncUrl(shard, {
      override: process.env.EXPO_PUBLIC_BRIGADE_SYNC_URL,
      hostUri: Constants.expoConfig?.hostUri,
    });
    // Thrown inside the client, which retries with backoff: the list shows sync as unavailable.
    if (!url) throw new Error("No sync URL: set EXPO_PUBLIC_BRIGADE_SYNC_URL");
    return url;
  },
  actor: DEV_ACTOR,
  // Hermes has no crypto.getRandomValues.
  randomBytes: getRandomBytes,
  // No `clientId`: a new one each launch. The shard de-duplicates re-sent mutations by (clientId, mutationId),
  // but pending mutations live in memory and die with the process, so a per-install id would buy nothing yet.
  // Persist both together when offline changes need to survive a restart.
});
