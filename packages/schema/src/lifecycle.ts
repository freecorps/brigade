export const SEVERITIES = ["sev1", "sev2", "sev3", "sev4"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  "triage",
  "investigating",
  "fixing",
  "monitoring",
  "resolved",
  "declined",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// Allowed status transitions. "resolved" can be reopened; "declined" is final.
const TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  triage: ["investigating", "fixing", "monitoring", "resolved", "declined"],
  investigating: ["fixing", "monitoring", "resolved"],
  fixing: ["investigating", "monitoring", "resolved"],
  monitoring: ["investigating", "fixing", "resolved"],
  resolved: ["investigating"],
  declined: [],
};

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isActive(status: IncidentStatus): boolean {
  return status !== "resolved" && status !== "declined";
}

/**
 * Incident roles (RFC 0003 "RoleAssignment"): a fixed set until workspaces define their own (Phase 3). At most one
 * member holds each role on an incident.
 */
export const INCIDENT_ROLES = ["commander", "communications", "operations"] as const;
export type IncidentRole = (typeof INCIDENT_ROLES)[number];
