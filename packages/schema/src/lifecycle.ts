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
