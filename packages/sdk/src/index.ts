// @freecorps/brigade-sdk: verify Brigade's webhooks, call its public HTTP API, and the types of both (MIT).

import type { WebhookPayload, WebhookPayloadType } from "@freecorps/brigade-schema";

export {
  DEFAULT_TOLERANCE_SECONDS,
  verifyWebhook,
  WebhookVerificationError,
  type VerifiedWebhook,
  type VerifyWebhookOptions,
  type WebhookHeaders,
  type WebhookVerification,
  type WebhookVerificationCode,
} from "./webhooks.ts";

export {
  BrigadeApiError,
  BrigadeArgumentError,
  createClient,
  isBrigadeApiError,
  OPERATION_ERRORS,
  type ApiErrorCode,
  type BrigadeClient,
  type ClientOptions,
  type Invitation,
  type InvitationPreview,
  type Ok,
  type Operation,
  type PagingHealth,
  type PagingHealthReason,
  type Workspace,
} from "./client.ts";

// The payloads and the values they draw from, from the schema package the server itself runs.
export {
  ALERT_RESOLVED_REASONS,
  ESCALATION_REASONS,
  INCIDENT_ROLES,
  INCIDENT_STATUSES,
  MONITOR_KINDS,
  MONITOR_STATUSES,
  ROLES,
  SEVERITIES,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_PAYLOAD_TEXT_MAX,
  WEBHOOK_PAYLOAD_VERSION,
  WEBHOOK_PAYLOADS,
  isKnownWebhookPayload,
  webhookPayloadValidator,
  type AlertResolvedReason,
  type EscalationReason,
  type IncidentRole,
  type IncidentStatus,
  type Issue,
  type MonitorKind,
  type MonitorStatus,
  type Open,
  type Role,
  type Severity,
  type UnknownWebhookPayload,
  type WebhookActor,
  type WebhookEventType,
  type WebhookIncident,
  type WebhookMonitor,
  type WebhookPayload,
  type WebhookPayloadType,
} from "@freecorps/brigade-schema";

/** The payload of one `type`: `WebhookPayloadOf<"incident.declared">["data"]["incident"]`. */
export type WebhookPayloadOf<Type extends WebhookPayloadType> = Extract<
  WebhookPayload,
  { type: Type }
>;
