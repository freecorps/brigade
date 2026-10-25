// Pure helpers for the live incident list: which status moves to offer, what to say about the connection, how to
// check a declare before sending it, and how to word a mutation the shard refused.
import { m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
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

/** Why a change was refused: the client's and server's codes, plus a declare refused for the device's clock. */
export type NoticeReason = SyncErrorCode | "clock_skew";

const REASONS: Record<NoticeReason, () => string> = {
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
  clock_skew: m.sync_error_clock_skew,
};

/** A translated reason for a refused mutation; never the server's English message. */
export function mutationErrorReason(code: NoticeReason): string {
  return (REASONS[code] ?? m.sync_error_internal)();
}

/** Why the shard refused the list itself (a query error code, which is a plain string on the wire). */
export function queryErrorReason(code: string | undefined): string {
  return code === "forbidden" ? m.sync_error_read_forbidden() : m.sync_error_internal();
}

/** A refused change, kept as data and worded at render, so it follows a language switch. */
export type Notice = {
  key: string;
  kind: "declare" | "status" | "severity";
  reason: NoticeReason;
  incidentId: string;
  number: number | null;
  title: string;
  /** The status or severity it tried to set. */
  to?: IncidentStatus | Severity;
};

export type NoticeTarget = Omit<Notice, "key" | "reason">;

/**
 * The notice a mutation's outcome leaves, if it failed. An `invalid_args` naming the `id` means the id's time
 * (the device clock) is more than 10 minutes ahead of the shard's: the title itself was fine.
 */
export function noticeFor(
  outcome: MutationOutcome,
  target: NoticeTarget,
  key: string,
): Notice | undefined {
  if (outcome.ok) return undefined;
  const { code, issues } = outcome.error;
  const skew = code === "invalid_args" && issues?.some((issue) => issue.path === "id") === true;
  return { ...target, key, reason: skew ? "clock_skew" : code };
}

/**
 * Where a notice is drawn: in its incident's row, which already says which incident it is, or in the card (a
 * declare, or a row no longer listed), where the text names the incident and the change.
 */
export type NoticePlace = "row" | "card";

/**
 * The notice's text. `mark` wraps the incident's number and title, so the card can keep the number on one line
 * and truncate a long title; without it the text is plain (for the live region).
 */
export function noticeText(
  notice: Notice,
  place: NoticePlace,
  mark: (part: "number" | "title", text: string) => string = (_, text) => text,
): string {
  const reason = mutationErrorReason(notice.reason);
  // The declare message quotes the title itself.
  if (notice.kind === "declare") {
    return m.incident_declare_failed({ title: mark("title", notice.title), reason });
  }
  const title = m.incident_quoted_title({ title: mark("title", notice.title) });
  const number = formatIncidentNumber(notice.number);
  const incident = number ? `${mark("number", number)} ${title}` : title;
  if (notice.kind === "status") {
    const status = incidentStatusLabels[notice.to as IncidentStatus]();
    return place === "row"
      ? m.incident_move_failed_here({ status, reason })
      : m.incident_move_failed({ incident, status, reason });
  }
  const severity = String(notice.to).toUpperCase();
  return place === "row"
    ? m.incident_severity_failed_here({ severity, reason })
    : m.incident_severity_failed({ incident, severity, reason });
}

/**
 * In-flight mutations by key: the incident id, plus `id/status` or `id/severity` for the field being changed. A
 * key with none left is removed.
 */
export function adjustBusy(
  busy: ReadonlyMap<string, number>,
  keys: readonly string[],
  by: number,
): ReadonlyMap<string, number> {
  const next = new Map(busy);
  for (const key of keys) {
    const count = (next.get(key) ?? 0) + by;
    if (count > 0) next.set(key, count);
    else next.delete(key);
  }
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

/** Whether the shard refused a declare for its title (give the text back), not for the clock. */
export function titleRefused(notice: Notice | undefined): boolean {
  return notice?.kind === "declare" && notice.reason === "invalid_args";
}
