# Changelog

## 0.3.0 (unreleased)

- `updateIncident` also renames the incident (`title`, run as `incident.rename`) and hands out incident roles
  (`roles`: a user id by role id, `null` leaves one empty, each run as `incident.assignRole`), first and after the
  custom fields respectively, with the same partial application: the first refusal stops the rest.
- `editIncidentUpdate` and `deleteIncidentUpdate` (`incident:update`): new text for a written update (its author
  only: the member, or an API token that posted it or whose creator did) and removing one (its author, an owner or
  an admin). `409 conflict`: the update was removed.
- `postIncidentUpdate` answers the update's `entryId` (type `UpdatePosted`), what the two above take.
- Payload types: `incident.renamed` (`from`, `to`), a new event in the webhook catalog (version 1).

## 0.2.0 (unreleased)

- `createClient` covers incidents and the catalog: `listIncidents` (filters by status, severity, type and service;
  cursor pages), `getIncident`, `declareIncident`, `updateIncident` (type, services, custom field values, severity,
  status), `postIncidentUpdate`; `listServices`, `getService`, `createService`, `updateService`, `deleteService`;
  `listIncidentTypes`, `getIncidentType`, `createIncidentType`, `updateIncidentType`; `listCustomFields`,
  `getCustomField`, `createCustomField`, `updateCustomField`. Every write takes an `idempotencyKey` (random by
  default). With an API token, each needs its scope (`incident:read`, `incident:declare`, `incident:update`,
  `catalog:read`, `catalog:manage`; a `PATCH` also needs the read scope, as it answers the row). An
  `idempotencyKey` sent again with another request is `422 idempotency_key_reused`.
- Types: `Incident`, `Service`, `IncidentType`, `CustomField`, `IncidentFilter`, `IncidentPage`, `WriteOptions`, the
  request bodies (`DeclareRequest`, `IncidentPatch`, `ServiceCreateRequest`, …), `FieldValue`, `FIELD_KINDS` and
  `SERVICE_TIERS`.
- The dashboard's own routes, now in the reference and taking an API token: `createWebhook` (with up to 5 custom
  `headers`, sent on every delivery and never shown back), `rotateWebhookSecret` and `setWebhookHeaders`
  (`webhook:manage`; an optional `idempotencyKey`), `configureStatusPage` (`status:manage`), `createExport` and
  `downloadExport` (`data:export`), and `requestPostmortemDraft` (`incident:update`). Types: `WebhookCreateRequest`,
  `WebhookHeadersRequest`, `WebhookHeader`, `WebhookSecret`, `WebhookWriteOptions`, `StatusPageRequest`,
  `ExportScope`, `ExportCreated` and `ExportFile`.

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
