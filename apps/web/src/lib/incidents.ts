// Pure helpers for the live incident list: which status moves to offer, what to say about the connection, and
// how to word a mutation the shard refused.
import { m } from "@freecorps/brigade-i18n";
import { canTransition, INCIDENT_STATUSES, type IncidentStatus } from "@freecorps/brigade-schema";
import type { ConnectionState, QueryStatus, SyncErrorCode } from "@freecorps/brigade-sync";

/** The statuses `from` may move to, in lifecycle order. */
export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  return INCIDENT_STATUSES.filter((to) => canTransition(from, to));
}

/** What the list tells the user about sync. */
export type SyncView = "connecting" | "live" | "reconnecting" | "unavailable";

/**
 * Whether the list has failed to connect since it last had data. The browser hides why a WebSocket upgrade
 * failed (a 501 outside dev, a 502 with the API Worker down, nothing listening): it only sees the socket close,
 * and the client then waits to retry. So "never loaded, and `waiting` after an attempt" is the only error signal.
 * It latches until data arrives, so the retries (`waiting` → `connecting` → `waiting`) do not flicker the state.
 */
export function nextFailed(failed: boolean, status: QueryStatus, connection: ConnectionState) {
  if (status === "ready") return false;
  return failed || connection === "waiting";
}

export function syncView(
  status: QueryStatus,
  connection: ConnectionState,
  failed: boolean,
): SyncView {
  if (status === "error") return "unavailable";
  if (status === "loading") return failed ? "unavailable" : "connecting";
  return connection === "open" ? "live" : "reconnecting";
}

const REASONS: Record<SyncErrorCode, () => string> = {
  forbidden: m.sync_error_forbidden,
  not_found: m.sync_error_not_found,
  conflict: m.sync_error_conflict,
  invalid_transition: m.sync_error_invalid_transition,
  invalid_args: m.sync_error_invalid_args,
  expired: m.sync_error_expired,
  too_many_pending: m.sync_error_too_many_pending,
  closed: m.sync_error_closed,
  internal: m.sync_error_internal,
  // A mutation this dashboard knows but the deployed API does not: a version skew, worded as a server problem.
  unknown_mutation: m.sync_error_internal,
};

/** A translated reason for a refused mutation; never the server's English message. */
export function mutationErrorReason(code: string): string {
  return (REASONS[code as SyncErrorCode] ?? m.sync_error_internal)();
}
