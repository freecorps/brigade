# Changelog

## 0.1.0 (unreleased)

First version.

- `verifyWebhook`: verifies a Brigade webhook delivery (Standard Webhooks: `webhook-id`, `webhook-timestamp`,
  `webhook-signature`; several secrets during a rotation; a timestamp tolerance both ways) and parses its payload into
  a typed `WebhookPayload` (version 1), or answers a typed `WebhookVerificationError`. Web Crypto only.
- `createClient`: the public HTTP API in `docs/api/openapi.json` (health, paging health, heartbeat ping, workspaces,
  members, invitations, incident acknowledgement), with an injectable `fetch` and typed `BrigadeApiError` codes.
- The payload types and their validators, from `@freecorps/brigade-schema` (bundled: no runtime dependencies).
