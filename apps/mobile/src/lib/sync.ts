// Where the app's Brigade Sync client connects, and as whom it runs optimistic mutations. Pure, so it is tested
// in Node; src/lib/sync-client.ts builds the client from it with the native pieces.
import type { Actor } from "@freecorps/brigade-schema";

/** The workspace the app shows until there are accounts: the local stack's demo shard, as on the dashboard. */
export const SHARD = "demo";

/** The dashboard's dev server (`vp run dev`), which forwards `/api/sync/<workspace>` to the shard. */
export const DEV_SERVER_PORT = 5173;

/**
 * The actor optimistic mutations run as. It mirrors the shard's dev-only actor (apps/api/src/dev-actor.ts, tied
 * by a test): the server takes the actor from the socket, and another role here would show changes it refuses.
 */
export const DEV_ACTOR: Actor = { kind: "user", id: "usr_dev", role: "responder" };

/**
 * The machine running the dev servers, from Expo's `hostUri` (`<host>:8081`, the Metro server the app loaded
 * its bundle from). Start Metro with `--localhost` for the iOS Simulator and an Android emulator with
 * `adb reverse`; in LAN mode the dashboard's server must listen on the LAN too.
 */
export function devHost(hostUri: string | null | undefined): string | undefined {
  if (!hostUri) return undefined;
  const authority = hostUri.replace(/^[a-z]+:\/\//i, "").split("/")[0] ?? "";
  // `[::1]:8081` keeps its brackets; `host:8081` drops the port.
  const host = authority.startsWith("[")
    ? authority.slice(0, authority.indexOf("]") + 1)
    : authority.split(":")[0];
  return host || undefined;
}

/**
 * The shard's socket URL. `override` (EXPO_PUBLIC_BRIGADE_SYNC_URL) is a base such as `wss://brigade.example.com/api/sync`;
 * without it, development builds use the dev server on the Metro host. Undefined when neither is known (a release
 * build with no override): the list then shows sync as unavailable.
 */
export function syncUrl(
  shard: string,
  { override, hostUri }: { override?: string; hostUri?: string | null },
): string | undefined {
  const base = override?.trim().replace(/\/+$/, "");
  if (base) return `${base}/${encodeURIComponent(shard)}`;
  const host = devHost(hostUri);
  if (!host) return undefined;
  return `ws://${host}:${DEV_SERVER_PORT}/api/sync/${encodeURIComponent(shard)}`;
}
