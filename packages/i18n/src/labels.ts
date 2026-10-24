// Labels for canonical domain values. In its own entry so importing `@freecorps/brigade-i18n`
// does not pull in these messages. Mirrors SEVERITIES and INCIDENT_STATUSES in
// @freecorps/brigade-schema (kept dependency-free; tests/catalog.test.ts fails when they drift).
import {
  incident_status_declined,
  incident_status_fixing,
  incident_status_investigating,
  incident_status_monitoring,
  incident_status_resolved,
  incident_status_triage,
  severity_sev1,
  severity_sev2,
  severity_sev3,
  severity_sev4,
} from "./paraglide/messages.js";

/** Severity names ("Critical"). The code (`sev1` → "SEV1") is canonical and not translated. */
export const severityLabels = {
  sev1: severity_sev1,
  sev2: severity_sev2,
  sev3: severity_sev3,
  sev4: severity_sev4,
} as const;

export const incidentStatusLabels = {
  triage: incident_status_triage,
  investigating: incident_status_investigating,
  fixing: incident_status_fixing,
  monitoring: incident_status_monitoring,
  resolved: incident_status_resolved,
  declined: incident_status_declined,
} as const;
