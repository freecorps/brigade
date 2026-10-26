// The registries the shard and the clients look names up in (RFC 0004 "Shared core").

import {
  acknowledgeIncident,
  activeIncidents,
  assignIncidentRole,
  declareIncident,
  incidentById,
  incidentByNumber,
  postIncidentUpdate,
  setIncidentSeverity,
  setIncidentStatus,
} from "./incidents.ts";
import {
  allDevices,
  confirmDelivery,
  incidentDeliveries,
  planDeliveries,
  reportDeliveries,
} from "./deliveries.ts";
import { expireDevice, registerDevice, unregisterDevice } from "./devices.ts";
import { failEmail, failNotification } from "./notifications.ts";
import { allMonitors, evaluateMonitor, monitorMutations, reportMonitorCheck } from "./monitors.ts";
import { defineRegistry } from "./mutation.ts";
import { allOverrides, allSchedules, scheduleMutations } from "./schedules.ts";
import { allPolicies, policyMutations } from "./policies.ts";
import {
  advanceEscalation,
  fallbackEscalation,
  repageEscalation,
  startEscalation,
} from "./escalation.ts";
import { incidentTimeline } from "./timeline.ts";
import { invitationMutations } from "./invitations.ts";
import { changeMemberRole, reconcileMembers, removeMember } from "./members.ts";
import { allMembers, createWorkspace, setEmailSettings, syncMember } from "./workspaces.ts";

/** What clients may send over a socket. */
export const mutations = defineRegistry([
  declareIncident,
  setIncidentStatus,
  setIncidentSeverity,
  acknowledgeIncident,
  postIncidentUpdate,
  assignIncidentRole,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  registerDevice,
  unregisterDevice,
  setEmailSettings,
]);

export const queries = defineRegistry([
  activeIncidents,
  incidentById,
  incidentByNumber,
  incidentTimeline,
  allMembers,
  allMonitors,
  allSchedules,
  allOverrides,
  allPolicies,
  incidentDeliveries,
  allDevices,
]);

/**
 * Every mutation the shard runs: what clients may send (`mutations`) plus the server-only ones, which only the
 * shard's own code runs (provisioning, monitor reports, member changes), never a socket's `mutate`.
 */
export const serverMutations = defineRegistry([
  declareIncident,
  setIncidentStatus,
  setIncidentSeverity,
  acknowledgeIncident,
  postIncidentUpdate,
  assignIncidentRole,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  registerDevice,
  unregisterDevice,
  setEmailSettings,
  createWorkspace,
  syncMember,
  changeMemberRole,
  removeMember,
  reconcileMembers,
  ...invitationMutations,
  reportMonitorCheck,
  evaluateMonitor,
  expireDevice,
  failNotification,
  failEmail,
  planDeliveries,
  reportDeliveries,
  confirmDelivery,
  startEscalation,
  advanceEscalation,
  fallbackEscalation,
  repageEscalation,
]);
