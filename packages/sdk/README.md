# @freecorps/brigade-sdk

The SDK for [Freecorps Brigade](https://github.com/freecorps/brigade), open-source incident management:

- **`verifyWebhook`** checks a webhook delivery from Brigade ([Standard Webhooks](https://www.standardwebhooks.com))
  and parses its payload into a typed `WebhookPayload`;
- **`createClient`** calls Brigade's public HTTP API ([`docs/api/openapi.json`](../../docs/api/openapi.json)) with
  typed answers and errors;
- the payload types and their validators.

Web Crypto and `fetch` only, no dependencies: it runs in Cloudflare Workers, Node 20+, Deno, Bun and browsers. ESM.

```sh
npm install @freecorps/brigade-sdk
```

## Verify a webhook in a Worker

Brigade shows an endpoint's signing secret (`whsec_…`) once, when you create the endpoint or rotate its secret. Keep
it as a secret (`wrangler secret put BRIGADE_WEBHOOK_SECRET`).

```ts
import { verifyWebhook } from "@freecorps/brigade-sdk";

export default {
  async fetch(request: Request, env: { BRIGADE_WEBHOOK_SECRET: string }) {
    const result = await verifyWebhook({
      secret: env.BRIGADE_WEBHOOK_SECRET,
      headers: request.headers,
      // The body exactly as sent: never JSON.stringify(await request.json()).
      body: await request.text(),
    });
    if (!result.ok) return new Response(result.error.code, { status: 400 });

    const { payload } = result;
    switch (payload.type) {
      case "incident.declared":
        console.log(`INC-${payload.data.incident.number} ${payload.data.incident.title}`);
        break;
      case "alert.fired":
        console.log(`${payload.data.monitor.name} is down`);
        break;
    }
    // Answer 2xx within 5 seconds; anything else is retried. Retries carry the same id: de-duplicate by it.
    return new Response(null, { status: 204 });
  },
};
```

- **Rotation.** While you switch to a new secret, Brigade signs with both for 24 hours: pass both,
  `secret: [newSecret, oldSecret]`.
- **Errors.** `result.error` is a `WebhookVerificationError` with a `code`: `missing_header`, `invalid_timestamp`,
  `timestamp_too_old`, `timestamp_too_new` (more than `toleranceSeconds`, default 300, either way), `invalid_secret`,
  `invalid_signature`, `invalid_json` or `invalid_payload`. The last one means the signature was valid but the payload
  is not one this version knows (`error.body` holds it): update the SDK.
- **Versions.** Every payload is `version: 1`. Brigade may add fields to it; the SDK drops the ones it does not know.
  A change that is not purely additive will be `version: 2`.
- **Node.** `headers` takes a `Headers` or Node's `req.headers`; `body` a string, `Uint8Array` or `ArrayBuffer` of the
  raw body (with Express, `express.raw({ type: "application/json" })`).

The payloads, by `type`: `incident.declared`, `incident.status_changed`, `incident.severity_changed`,
`incident.acknowledged`, `incident.update_posted`, `incident.role_assigned`, `alert.fired`, `alert.resolved`,
`monitor.status_changed`, `escalation.paged` and `webhook.test` ("Send test event"). Their schemas are the reference's
`webhooks` section; `WebhookPayloadOf<"alert.fired">` is one of them as a type.

## Ping a heartbeat

A heartbeat monitor's URL ends with its token; pinging it needs no session.

```ts
import { createClient } from "@freecorps/brigade-sdk";

const brigade = createClient({ baseUrl: "https://brigade.example.com/api" });
await brigade.pingHeartbeat(process.env.BRIGADE_HEARTBEAT_TOKEN!);
```

## Acknowledge an incident

```ts
import { createClient, isBrigadeApiError } from "@freecorps/brigade-sdk";

const brigade = createClient({
  baseUrl: "https://brigade.example.com/api",
  // A Better Auth session cookie (`POST /api/auth/sign-in/email` sets it). API tokens are not there yet: when they
  // are, they go in `headers`.
  cookie: process.env.BRIGADE_SESSION_COOKIE,
});

try {
  // Pass the same idempotencyKey again to retry after a lost answer: the ack runs once.
  await brigade.acknowledgeIncident(workspaceId, incidentId, {
    idempotencyKey: `ack:${incidentId}`,
  });
} catch (error) {
  if (!isBrigadeApiError(error, "acknowledgeIncident")) throw error;
  // error.code is one of the codes the reference lists for this operation, or "unexpected".
  if (error.code !== "conflict") throw error; // conflict: already acknowledged
}
```

| Method                                                                                                       | Route                                             |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `getHealth()`, `getPagingHealth()`                                                                           | `GET /health`, `GET /health/paging`               |
| `pingHeartbeat(token)`                                                                                       | `POST /heartbeat/:token`                          |
| `createWorkspace({ name })`                                                                                  | `POST /workspaces`                                |
| `changeMemberRole(ws, userId, { role })`, `removeMember(ws, userId)`                                         | `PATCH`, `DELETE /workspaces/:id/members/:userId` |
| `listInvitations(ws)`, `invite(ws, { email, role })`, `revokeInvitation(ws, id)`, `resendInvitation(ws, id)` | `/workspaces/:id/invitations…`                    |
| `getInvitation(id)`, `acceptInvitation(id)`, `declineInvitation(id)`                                         | `/invitations/:id…`                               |
| `acknowledgeIncident(ws, incidentId, { idempotencyKey? })`                                                   | `POST /workspaces/:id/incidents/:incidentId/ack`  |

Every method resolves with the documented success and rejects with a `BrigadeApiError` (`operation`, `status`,
`code`, `body`) for any other answer; a network failure is `fetch`'s own error. `fetch` can be injected
(`createClient({ fetch })`), for tests or a Worker's service binding. Incidents, monitors and the rest are read and
changed over Brigade Sync (`@freecorps/brigade-sync`), not this API.

## Development

The webhook payload validators live in `packages/schema` (`WEBHOOK_PAYLOADS`), and are bundled into `dist` with what
they use. `tests/` checks the Standard Webhooks specification's own example, deliveries signed by Brigade's API
(`tests/fixtures/server-signed.json`, which `apps/api` keeps current: `vp run --filter @freecorps/brigade-api
sdk-fixture`), the client's methods, paths and error codes against `docs/api/openapi.json`, and that nothing here
imports app code. `vp run build` packs and then runs `scripts/check-dist.mjs`: the built files import nothing, load in
plain Node and verify those deliveries. `src/` is type-checked without Node types.

License: MIT.
