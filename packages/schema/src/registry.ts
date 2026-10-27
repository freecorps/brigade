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
import {
  expireDevice,
  registerDevice,
  signOutDevices,
  touchDevice,
  unregisterDevice,
} from "./devices.ts";
import { failEmail, failNotification, pageAgain } from "./notifications.ts";
import {
  allMonitors,
  evaluateMonitor,
  monitorCapQuery,
  monitorMutations,
  reportMonitorCheck,
  takeOverMonitors,
} from "./monitors.ts";
import { defineRegistry } from "./mutation.ts";
import { allOverrides, allSchedules, scheduleMutations } from "./schedules.ts";
import { allPolicies, policyMutations } from "./policies.ts";
import { catalogMutations, catalogQueries } from "./catalog.ts";
import {
  advanceEscalation,
  fallbackEscalation,
  repageEscalation,
  startEscalation,
  unreachedEscalation,
} from "./escalation.ts";
import {
  configureSlack,
  connectSlack,
  disconnectSlack,
  failSlack,
  slackConnection,
} from "./slack.ts";
import {
  configureStatusPage,
  statusComponents,
  statusIncidentById,
  statusMutations,
  statusPageConfig,
} from "./status.ts";
import { incidentTimeline } from "./timeline.ts";
import { allMaintenance, maintenanceMutations, maintenanceServerMutations } from "./maintenance.ts";
import {
  allWebhooks,
  createWebhook,
  recordWebhookAttempt,
  redeliverWebhooks,
  rotateWebhookSecret,
  webhookMutations,
} from "./webhooks.ts";
import { followUpMutations, followUpQueries } from "./followups.ts";
import {
  incidentPostmortem,
  postmortemMutations,
  postmortemServerMutations,
} from "./postmortems.ts";
import { recentExports, recordExport, reserveExport } from "./exports.ts";
import {
  alertSourceMutations,
  allAlertRoutes,
  allAlertSources,
  ingestAlerts,
  rerouteAlerts,
  recentAlerts,
  takeOverAlertSources,
} from "./alert-sources.ts";
import { allApiTokens, apiTokenServerMutations } from "./api-tokens.ts";
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
  pageAgain,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  ...catalogMutations,
  registerDevice,
  unregisterDevice,
  setEmailSettings,
  configureSlack,
  disconnectSlack,
  ...statusMutations,
  ...maintenanceMutations,
  ...webhookMutations,
  ...followUpMutations,
  ...postmortemMutations,
  ...alertSourceMutations,
]);

export const queries = defineRegistry([
  activeIncidents,
  incidentById,
  incidentByNumber,
  incidentTimeline,
  allMembers,
  allMonitors,
  monitorCapQuery,
  allSchedules,
  allOverrides,
  allPolicies,
  incidentDeliveries,
  allDevices,
  slackConnection,
  statusPageConfig,
  statusComponents,
  statusIncidentById,
  allMaintenance,
  allWebhooks,
  ...catalogQueries,
  ...followUpQueries,
  incidentPostmortem,
  recentExports,
  allAlertSources,
  allAlertRoutes,
  recentAlerts,
  allApiTokens,
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
  pageAgain,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  ...catalogMutations,
  registerDevice,
  unregisterDevice,
  setEmailSettings,
  configureSlack,
  disconnectSlack,
  ...statusMutations,
  ...maintenanceMutations,
  ...webhookMutations,
  ...followUpMutations,
  ...postmortemMutations,
  ...alertSourceMutations,
  configureStatusPage,
  ...maintenanceServerMutations,
  createWorkspace,
  syncMember,
  changeMemberRole,
  removeMember,
  reconcileMembers,
  ...invitationMutations,
  reportMonitorCheck,
  evaluateMonitor,
  expireDevice,
  signOutDevices,
  touchDevice,
  takeOverMonitors,
  failNotification,
  failEmail,
  planDeliveries,
  reportDeliveries,
  confirmDelivery,
  startEscalation,
  advanceEscalation,
  fallbackEscalation,
  repageEscalation,
  unreachedEscalation,
  connectSlack,
  failSlack,
  createWebhook,
  rotateWebhookSecret,
  recordWebhookAttempt,
  redeliverWebhooks,
  ...postmortemServerMutations,
  recordExport,
  reserveExport,
  ingestAlerts,
  rerouteAlerts,
  takeOverAlertSources,
  ...apiTokenServerMutations,
]);
