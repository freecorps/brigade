// What a live list tells the user about sync, from its query status and the shard's socket state. Shared by the
// web dashboard and the mobile app so both read the connection the same way.
import type { ConnectionState, QueryStatus } from "./client.ts";

/** What a list tells the user about sync. */
export type SyncView = "connecting" | "live" | "reconnecting" | "unavailable" | "refused";

/**
 * Whether the list has failed to connect since it last had data. A browser or React Native hides why a WebSocket
 * upgrade failed (a 501 outside dev, a 502 or 503 with the API down, nothing listening): it only sees the socket
 * close, and the client then waits to retry. So "never loaded, and `waiting` after an attempt" is the only error
 * signal. It latches until data arrives, so the retries (`waiting` → `connecting` → `waiting`) do not flicker.
 */
export function nextFailed(failed: boolean, status: QueryStatus, connection: ConnectionState) {
  if (status === "ready") return false;
  return failed || connection === "waiting";
}

/**
 * `refused`: the shard answered the subscription with an error (forbidden, internal…). The client does not ask
 * again on its own (only a new listener does), so the UI offers a reload rather than "keeps trying".
 */
export function syncView(
  status: QueryStatus,
  connection: ConnectionState,
  failed: boolean,
): SyncView {
  if (status === "error") return "refused";
  if (status === "loading") return failed ? "unavailable" : "connecting";
  return connection === "open" ? "live" : "reconnecting";
}
