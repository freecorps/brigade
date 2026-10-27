# Changelog

## 0.2.0 (unreleased)

- `createClient` covers incidents and the catalog: `listIncidents` (filters by status, severity, type and service;
  cursor pages), `getIncident`, `declareIncident`, `updateIncident` (type, services, custom field values, severity,
  status), `postIncidentUpdate`; `listServices`, `getService`, `createService`, `updateService`, `deleteService`;
  `listIncidentTypes`, `getIncidentType`, `createIncidentType`, `updateIncidentType`; `listCustomFields`,
  `getCustomField`, `createCustomField`, `updateCustomField`. Every write takes an `idempotencyKey` (random by
  default). With an API token, each needs its scope (`incident:read`, `incident:declare`, `incident:update`,
  `catalog:read`, `catalog:manage`).
- Types: `Incident`, `Service`, `IncidentType`, `CustomField`, `IncidentFilter`, `IncidentPage`, `WriteOptions`, the
  request bodies (`DeclareRequest`, `IncidentPatch`, `ServiceCreateRequest`, …), `FieldValue`, `FIELD_KINDS` and
  `SERVICE_TIERS`.

## 0.1.0 (unreleased)

First version.

- `verifyWebhook`: verifies a Brigade webhook delivery (Standard Webhooks: `webhook-id`, `webhook-timestamp`,
  `webhook-signature`; several secrets during a rotation; a timestamp tolerance both ways) and parses its payload into
  a typed `WebhookPayload` (version 1), or answers a typed `WebhookVerificationError`. Web Crypto only. Takes what
  a newer Brigade may add within version 1: an event type it does not know (`known: false`), a new value in any list,
  longer text, new fields.
- `createClient`: the public HTTP API in `docs/api/openapi.json` (health, paging health, heartbeat ping, workspaces,
  members, invitations, incident acknowledgement), with an injectable `fetch`, typed `BrigadeApiError` codes, no
  redirects followed, `credentials` for browsers, and `token` for an API token (`Authorization: Bearer`).
- The payload types and their validators, from `@freecorps/brigade-schema` (bundled: no runtime dependencies).
