// The registries the shard and the clients look names up in (RFC 0004 "Shared core").

import {
  acknowledgeIncident,
  activeIncidents,
  declareIncident,
  incidentById,
  setIncidentSeverity,
  setIncidentStatus,
} from "./incidents.ts";
import { allMonitors, monitorMutations, reportMonitorCheck } from "./monitors.ts";
import { defineRegistry } from "./mutation.ts";
import { createWorkspace } from "./workspaces.ts";

/** What clients may send over a socket. */
export const mutations = defineRegistry([
  declareIncident,
  setIncidentStatus,
  setIncidentSeverity,
  acknowledgeIncident,
  ...monitorMutations,
]);

export const queries = defineRegistry([activeIncidents, incidentById, allMonitors]);

/**
 * Every mutation the shard runs: what clients may send (`mutations`) plus the server-only ones, which only the
 * shard's own code runs (provisioning, monitor reports), never a socket's `mutate`.
 */
export const serverMutations = defineRegistry([
  declareIncident,
  setIncidentStatus,
  setIncidentSeverity,
  acknowledgeIncident,
  ...monitorMutations,
  createWorkspace,
  reportMonitorCheck,
]);
