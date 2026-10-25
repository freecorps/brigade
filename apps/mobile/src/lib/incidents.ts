// Pure helpers for the live incident list: which moves to offer, how old an incident reads, and how to word a
// change the shard refused. The wording reuses the dashboard's messages (apps/web/src/lib/incidents.ts).
import { formatRelativeTime, m, type Locale } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import {
  canTransition,
  formatIncidentNumber,
  INCIDENT_STATUSES,
  type IncidentRow,
  type IncidentStatus,
  type Severity,
} from "@freecorps/brigade-schema";
import type { MutationOutcome, SyncErrorCode } from "@freecorps/brigade-sync";

/** The statuses `from` may move to, in lifecycle order (never `from` itself). */
export function nextStatuses(from: IncidentStatus): IncidentStatus[] {
  return INCIDENT_STATUSES.filter((to) => canTransition(from, to));
}

/**
 * The row a pick still applies to, looked up again when the pick happens: a sheet stays open while the list moves.
 * Undefined when the incident left the list, already has that value, or can no longer move there.
 */
export function pickTarget(
  rows: readonly IncidentRow[],
  id: string,
  change: { kind: "status"; to: IncidentStatus } | { kind: "severity"; to: Severity },
): IncidentRow | undefined {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return undefined;
  if (change.kind === "severity") return row.severity === change.to ? undefined : row;
  return canTransition(row.status, change.to) ? row : undefined;
}

/** "SEV2 High", as the badges show it. */
export function severityName(severity: Severity): string {
  return m.severity_named({ code: severity.toUpperCase(), name: severityLabels[severity]() });
}

/** "just now" under a minute, then the shared relative format; never a future time (the shard's clock may lead). */
export function formatAge(at: number, now: number, locale: Locale): string {
  if (now - Math.min(at, now) < 60_000) return m.time_just_now({}, { locale });
  return formatRelativeTime(at, locale, now);
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
  // A mutation the app knows but the deployed API does not: a version skew, worded as a server problem.
  unknown_mutation: m.sync_error_internal,
};

/** Why the shard refused a change, in the current language. */
export function reasonText(code: SyncErrorCode): string {
  return REASONS[code]();
}

/** Which incident a status or severity change was for, as the row showed it then. */
type Subject = { incidentId: string; number: number | null; title: string };

export type Target =
  | { kind: "declare"; incidentId: string; title: string }
  | (Subject & { kind: "status"; to: IncidentStatus })
  | (Subject & { kind: "severity"; to: Severity });

/** A change the shard refused, kept as data and worded at render so it follows a language switch. */
export type Refusal = Target & { key: string; code: SyncErrorCode; clockSkew: boolean };

/** The refusal an outcome leaves, if it failed. A declare's `invalid_args` on `id` is the device clock. */
export function refusalFor(
  outcome: MutationOutcome,
  target: Target,
  key: string,
): Refusal | undefined {
  if (outcome.ok) return undefined;
  const { code, issues } = outcome.error;
  const clockSkew =
    target.kind === "declare" &&
    code === "invalid_args" &&
    issues?.some((issue) => issue.path === "id") === true;
  return { ...target, key, code, clockSkew };
}

/**
 * The title to give back to the form after a refusal: a declare refused for its title (not the device clock),
 * and only while the field is still empty, so nothing typed since is lost.
 */
export function titleToRestore(refusal: Refusal, field: string): string | undefined {
  const forTitle =
    refusal.kind === "declare" && refusal.code === "invalid_args" && !refusal.clockSkew;
  return forTitle && field === "" ? refusal.title : undefined;
}

/**
 * One sentence. In the incident's row (`row`) it names only the change; below the list (`list`, where the
 * incident is not listed) it names the incident too.
 */
export function refusalText(refusal: Refusal, place: "row" | "list"): string {
  const reason = refusal.clockSkew
    ? m.sync_error_clock_skew()
    : (REASONS[refusal.code] ?? m.sync_error_internal)();
  if (refusal.kind === "declare")
    return m.incident_declare_failed({ title: refusal.title, reason });
  const number = formatIncidentNumber(refusal.number);
  const incident = number
    ? m.incident_label({ number, title: refusal.title })
    : m.incident_quoted_title({ title: refusal.title });
  if (refusal.kind === "status") {
    const status = incidentStatusLabels[refusal.to]();
    return place === "row"
      ? m.incident_move_failed_here({ status, reason })
      : m.incident_move_failed({ incident, status, reason });
  }
  const severity = severityName(refusal.to);
  return place === "row"
    ? m.incident_severity_failed_here({ severity, reason })
    : m.incident_severity_failed({ incident, severity, reason });
}
