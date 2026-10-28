// The registries the shard and the clients look names up in (RFC 0004 "Shared core").

import {
  acknowledgeIncident,
  activeIncidents,
  assignIncidentRole,
  declareIncident,
  deleteIncidentUpdate,
  editIncidentUpdate,
  incidentById,
  incidentByNumber,
  postIncidentUpdate,
  renameIncident,
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
import { allMemberSettings, setCalls } from "./calls.ts";
import {
  expireDevice,
  expireVoipToken,
  registerDevice,
  signOutDevices,
  touchDevice,
  unregisterDevice,
} from "./devices.ts";
import { failEmail, failNotification, pageAgain, releaseNotification } from "./notifications.ts";
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
  escalateNow,
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
  forgetSlackToken,
  markSlackRevoked,
  takeOverSlack,
  slackArchiveDue,
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
  setWebhookHeaders,
  webhookMutations,
} from "./webhooks.ts";
import { followUpMutations, followUpQueries } from "./followups.ts";
import {
  allPostmortemTemplates,
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
  recentAlerts,
  takeOverAlertSources,
} from "./alert-sources.ts";
import { rerouteAlerts } from "./monitor-alerts.ts";
import { allApiTokens, apiTokenServerMutations } from "./api-tokens.ts";
import { invitationMutations } from "./invitations.ts";
import { changeMemberRole, reconcileMembers, removeMember } from "./members.ts";
import {
  allMembers,
  createWorkspace,
  currentWorkspace,
  setAiDrafts,
  setEmailSettings,
  setWorkspaceLocale,
  syncMember,
} from "./workspaces.ts";
import { memberEmailMutations } from "./member-email.ts";
import { remindFollowUps } from "./reminders.ts";

/** What clients may send over a socket. */
export const mutations = defineRegistry([
  declareIncident,
  setIncidentStatus,
  setIncidentSeverity,
  renameIncident,
  acknowledgeIncident,
  postIncidentUpdate,
  editIncidentUpdate,
  deleteIncidentUpdate,
  assignIncidentRole,
  pageAgain,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  ...catalogMutations,
  registerDevice,
  unregisterDevice,
  setCalls,
  ...memberEmailMutations,
  setEmailSettings,
  setAiDrafts,
  setWorkspaceLocale,
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
  allMemberSettings,
  currentWorkspace,
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
  allPostmortemTemplates,
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
  renameIncident,
  acknowledgeIncident,
  postIncidentUpdate,
  editIncidentUpdate,
  deleteIncidentUpdate,
  assignIncidentRole,
  pageAgain,
  ...monitorMutations,
  ...scheduleMutations,
  ...policyMutations,
  ...catalogMutations,
  registerDevice,
  unregisterDevice,
  setCalls,
  ...memberEmailMutations,
  setEmailSettings,
  setAiDrafts,
  setWorkspaceLocale,
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
  remindFollowUps,
  changeMemberRole,
  removeMember,
  reconcileMembers,
  ...invitationMutations,
  reportMonitorCheck,
  evaluateMonitor,
  expireDevice,
  expireVoipToken,
  signOutDevices,
  touchDevice,
  takeOverMonitors,
  failNotification,
  failEmail,
  releaseNotification,
  planDeliveries,
  reportDeliveries,
  confirmDelivery,
  startEscalation,
  advanceEscalation,
  fallbackEscalation,
  repageEscalation,
  unreachedEscalation,
  escalateNow,
  connectSlack,
  failSlack,
  markSlackRevoked,
  takeOverSlack,
  forgetSlackToken,
  slackArchiveDue,
  createWebhook,
  rotateWebhookSecret,
  setWebhookHeaders,
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
