// Pure helpers for the live incident list: which status moves to offer, what to say about the connection, how to
// check a declare before sending it, and how to word a mutation the shard refused.
import { m } from "@freecorps/brigade-i18n";
import {
  canTransition,
  formatIncidentNumber,
  INCIDENT_STATUSES,
  lookup,
  mutations,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import type {
  ConnectionState,
  MutationOutcome,
  QueryStatus,
  SyncErrorCode,
} from "@freecorps/brigade-sync";

/** The statuses `from` may move to, in lifecycle order (never `from` itself). */
export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  return INCIDENT_STATUSES.filter((to) => canTransition(from, to));
}

/** What the list tells the user about sync. */
export type SyncView = "connecting" | "live" | "reconnecting" | "unavailable" | "refused";

/**
 * Whether the list has failed to connect since it last had data. The browser hides why a WebSocket upgrade
 * failed (a 501 outside dev, a 502 or 503 with the API Worker down, nothing listening): it only sees the socket
 * close, and the client then waits to retry. So "never loaded, and `waiting` after an attempt" is the only error
 * signal. It latches until data arrives, so the retries (`waiting` → `connecting` → `waiting`) do not flicker.
 */
export function nextFailed(failed: boolean, status: QueryStatus, connection: ConnectionState) {
  if (status === "ready") return false;
  return failed || connection === "waiting";
}

/**
 * `refused`: the shard answered the subscription with an error (forbidden, internal…). The client does not ask
 * again on its own (only a new listener does), so the page offers a reload rather than "keeps trying".
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
export function mutationErrorReason(code: SyncErrorCode): string {
  return (REASONS[code] ?? m.sync_error_internal)();
}

/** Why the shard refused the list itself (a query error code, which is a plain string on the wire). */
export function queryErrorReason(code: string | undefined): string {
  return code === "forbidden" ? m.sync_error_read_forbidden() : m.sync_error_internal();
}

/** A refused change, kept as data and worded at render, so it follows a language switch. */
export type Notice = {
  key: string;
  kind: "declare" | "change";
  code: SyncErrorCode;
  incidentId: string;
  number: number | null;
  title: string;
};

export type NoticeTarget = Omit<Notice, "key" | "code">;

/** The notice a mutation's outcome leaves, if it failed. */
export function noticeFor(
  outcome: MutationOutcome,
  target: NoticeTarget,
  key: string,
): Notice | undefined {
  return outcome.ok ? undefined : { ...target, key, code: outcome.error.code };
}

export function noticeText(notice: Notice): string {
  const reason = mutationErrorReason(notice.code);
  if (notice.kind === "declare") return m.incident_declare_failed({ title: notice.title, reason });
  const incident =
    formatIncidentNumber(notice.number) ?? m.incident_quoted_title({ title: notice.title });
  return m.incident_change_failed({ incident, reason });
}

/** In-flight mutations per incident; an incident with none has no key. */
export function adjustBusy(
  busy: ReadonlyMap<string, number>,
  id: string,
  by: number,
): ReadonlyMap<string, number> {
  const next = new Map(busy);
  const count = (busy.get(id) ?? 0) + by;
  if (count > 0) next.set(id, count);
  else next.delete(id);
  return next;
}

const declare = lookup(mutations, "incident.declare")!;

/**
 * Runs the declare's own validator before sending, so a title the shard would refuse (empty once trimmed, only
 * invisible or bidi characters) is caught in the field and the text stays. Returns the args as validated.
 */
export function checkDeclare(
  id: string,
  title: string,
  severity: Severity,
): { ok: true; args: { id: string; title: string; severity: Severity } } | { ok: false } {
  const result = declare.args({ id, title, severity });
  return result.ok
    ? { ok: true, args: result.value as { id: string; title: string; severity: Severity } }
    : { ok: false };
}
