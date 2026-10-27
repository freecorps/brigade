# @freecorps/brigade-sdk

The SDK for [Freecorps Brigade](https://github.com/freecorps/brigade), open-source incident management:

- **`verifyWebhook`** checks a webhook delivery from Brigade ([Standard Webhooks](https://www.standardwebhooks.com))
  and parses its payload into a typed `WebhookPayload`;
- **`createClient`** calls Brigade's public HTTP API
  ([`docs/api/openapi.json`](https://github.com/freecorps/brigade/blob/main/docs/api/openapi.json)) with typed answers
  and errors;
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
    // 400 only when the signature or timestamp does not hold: see "Answer 2xx" below.
    if (
      !result.ok &&
      result.error.code !== "invalid_json" &&
      result.error.code !== "invalid_payload"
    ) {
      return new Response(result.error.code, { status: 400 });
    }
    // Signed by Brigade, but not something this SDK can read (a type added since, a version 2): log it, answer 2xx.
    if (!result.ok || !result.known) return new Response(null, { status: 204 });

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
- **Answer 2xx** to every delivery whose signature holds, even one this SDK cannot read, and 400 only when the
  signature or timestamp does not (`missing_header`, `invalid_timestamp`, `timestamp_too_old`, `timestamp_too_new`,
  `invalid_signature`). Brigade retries anything but 2xx, and turns off an endpoint whose deliveries all failed for 24
  hours: refusing the events a newer Brigade sends would stop every webhook, not just those.
- **Errors.** `result.error` is a `WebhookVerificationError` with a `code`: `missing_header`, `invalid_timestamp`,
  `timestamp_too_old`, `timestamp_too_new` (more than `toleranceSeconds`, default 300, either way), `invalid_secret`
  and `invalid_option` (a mistake in your call: a bad secret, a `toleranceSeconds` that is not a finite number of 0 or
  more, a `now` that is not a finite time), `invalid_signature`, `invalid_json` or `invalid_payload`. The last two mean
  the signature was valid but the body is no version 1 payload (`error.body` holds it).
- **Versions.** Every payload is `version: 1`. Within it, Brigade may add event types, values to any list (a
  severity, a status, a reason…) and fields. So `result.known` is false for a `type` this SDK does not know yet
  (`payload` is then an `UnknownWebhookPayload`: the envelope, and `data` as sent); a value it does not know is kept
  as a string (`payload.data.incident.severity` is `Open<Severity>`: the known ones, or `string`), so give every
  `switch` on one a `default`; fields it does not know are dropped. Removing or renaming anything will be `version: 2`.
- **Repeated headers.** A header sent twice reads as `Headers.get` reads it, values joined with `, `, whether you pass a
  `Headers` or a plain object.
- **Node.** `headers` takes a `Headers` or Node's `req.headers`; `body` a string, `Uint8Array` or `ArrayBuffer` of the
  raw body (with Express, `express.raw({ type: "application/json" })`).

The payloads, by `type`: `incident.declared`, `incident.status_changed`, `incident.severity_changed`,
`incident.acknowledged`, `incident.update_posted`, `incident.role_assigned`, `alert.fired`, `alert.resolved`,
`monitor.status_changed`, `escalation.paged` and `webhook.test` ("Send test event"). Their schemas are the reference's
`webhooks` section; `WebhookPayloadOf<"alert.fired">` is one of them as a type. Every payload's `actor` is
`{ kind, id }`: `kind` is `user` (`usr_…`), `token` (an API token, `tok_…`, acting for the member who made it),
`system` (`sys_…`) or `integration`, and like every list it may grow. An id that names who did something, like
`incident.acknowledged`'s `data.by`, may be a `tok_…` too. `incident.role_assigned` names the role by `roleId` (a
built-in's name, `commander`, `communications` or `operations`, or a workspace role's `rol_…`); `role` is the
built-in's name or `custom`, and `roleName` the workspace's name for it (null for a built-in under its own name).

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
  // An API token (dashboard → API tokens), with the `incident:ack` scope: sent as `Authorization: Bearer`.
  token: process.env.BRIGADE_TOKEN,
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

## Declare and update incidents, and keep the catalog

```ts
import { createClient } from "@freecorps/brigade-sdk";

const brigade = createClient({
  baseUrl: "https://brigade.example.com/api",
  // Scopes: `incident:declare`, `incident:update`, `incident:read`, `catalog:read`, `catalog:manage` as needed.
  token: process.env.BRIGADE_TOKEN,
});

// Pages exactly as declaring in the app does. The same idempotencyKey again answers the same incident.
const { incident } = await brigade.declareIncident(
  workspaceId,
  { title: "Checkout is down", severity: "sev1", serviceIds: [checkoutServiceId] },
  { idempotencyKey: `deploy-check:${runId}` },
);
await brigade.updateIncident(workspaceId, incident.id, {
  title: "Checkout is down in eu-west",
  status: "investigating",
  fields: { [regionFieldId]: "eu-west" },
  roles: { commander: commanderUserId },
});
const { entryId } = await brigade.postIncidentUpdate(workspaceId, incident.id, {
  body: "Rolling back the deploy.",
});
// Its author (the token, or its creator) corrects it; an owner or admin could remove it.
await brigade.editIncidentUpdate(workspaceId, incident.id, entryId!, {
  body: "Rolled back the deploy.",
});

// Every open SEV1, a page at a time.
for (let cursor: string | undefined; ;) {
  const page = await brigade.listIncidents(workspaceId, {
    severity: ["sev1"],
    status: ["triage", "investigating", "fixing", "monitoring"],
    cursor,
  });
  for (const open of page.incidents) console.log(`INC-${open.number} ${open.title}`);
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}

// The catalog: services, incident types, custom fields (options as labels; Brigade gives each its id).
const { service } = await brigade.createService(workspaceId, { name: "Payments", tier: "tier1" });
await brigade.updateService(workspaceId, service.id, { description: "Card and Pix payments." });
await brigade.createCustomField(workspaceId, {
  name: "Customer impact",
  kind: "single_select",
  options: [{ label: "None" }, { label: "Some" }, { label: "All" }],
});
```

Each write runs the named mutation the apps send, with the same rules, timeline entry and event, as the member or
token; every write takes an `idempotencyKey` (a random one by default). `updateIncident` changes the title, type,
services, fields, roles, severity and status in that order, each its own change; the first refusal stops the rest, and the ones before
it stay made. The same key answers the same refusal again (within 7 days): once it is fixed, retry with a new key, and
the changes already made come back as no change. A key sent with another request is refused
(`422 idempotency_key_reused`). A `PATCH` answers the row, so with a token it also needs the read scope
(`incident:read`, `catalog:read`). `listIncidents` reads at most 1000 incidents a request: a narrow filter may answer
a short or empty page with a `nextCursor`, so follow it until it is null.

| Method                                                                                                       | Route                                                    |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `getHealth()`, `getPagingHealth()`                                                                           | `GET /health`, `GET /health/paging`                      |
| `pingHeartbeat(token)`                                                                                       | `POST /heartbeat/:token`                                 |
| `sendAlerts(token, payload)`                                                                                 | `POST /alerts/:token`                                    |
| `createWorkspace({ name })`                                                                                  | `POST /workspaces`                                       |
| `changeMemberRole(ws, userId, { role })`, `removeMember(ws, userId)`                                         | `PATCH`, `DELETE /workspaces/:id/members/:userId`        |
| `listInvitations(ws)`, `invite(ws, { email, role })`, `revokeInvitation(ws, id)`, `resendInvitation(ws, id)` | `/workspaces/:id/invitations…`                           |
| `getInvitation(id)`, `acceptInvitation(id)`, `declineInvitation(id)`                                         | `/invitations/:id…`                                      |
| `acknowledgeIncident(ws, incidentId, { idempotencyKey? })`                                                   | `POST /workspaces/:id/incidents/:incidentId/ack`         |
| `listIncidents(ws, filter?)`, `declareIncident(ws, body)`                                                    | `GET`, `POST /workspaces/:id/incidents`                  |
| `getIncident(ws, id)`, `updateIncident(ws, id, body)`, `postIncidentUpdate(ws, id, { body })`                | `/workspaces/:id/incidents/:incidentId…`                 |
| `editIncidentUpdate(ws, id, entryId, { body })`, `deleteIncidentUpdate(ws, id, entryId)`                     | `/workspaces/:id/incidents/:incidentId/updates/:entryId` |
| `listServices`, `createService`, `getService`, `updateService`, `deleteService`                              | `/workspaces/:id/services…`                              |
| `listIncidentTypes`, `createIncidentType`, `getIncidentType`, `updateIncidentType`                           | `/workspaces/:id/incident-types…`                        |
| `listCustomFields`, `createCustomField`, `getCustomField`, `updateCustomField`                               | `/workspaces/:id/custom-fields…`                         |

Every method resolves with the documented success and rejects with a `BrigadeApiError` (`operation`, `status`,
`code`, `body`) for any other answer, `unexpected` for one outside the reference (a 2xx that is no JSON object, or a
redirect: never followed, so a cookie or token never goes elsewhere). An id that is empty, `.` or `..` is a
`BrigadeArgumentError` (`invalid_argument`), before anything is sent; a network failure is `fetch`'s own error.

- **API tokens.** `token` is a workspace's API token (`brg_…`, RFC 0014), minted by an owner or admin in the
  dashboard with a name, an optional expiry and scopes, and shown once. The operations marked `bearerAuth` in the
  reference take it: members, invitations, incidents and the catalog (each with its scope), and the sync socket. It acts with
  its creator's role as it is now, never beyond its scopes; a wrong, revoked or expired token, or one whose creator
  left, is `401 unauthenticated`, and over its rate limit `429 rate_limited`. A server keeps it in a secret; GitHub
  secret scanning can find leaked ones with the pattern `brg_[A-Za-z0-9_-]{43}`. `cookie` (a Better Auth session
  cookie, from `POST /api/auth/sign-in/email`) still works for every operation, including those no token takes
  (`createWorkspace`, the invitee's).
- **Browsers.** The `cookie` option is for servers: a browser ignores a `Cookie` header a script sets, and sends its
  own cookies instead. On a page of the API's own origin it does so already; from another origin, pass
  `credentials: "include"` (and the API must allow that origin). `fetch` can be injected
  (`createClient({ fetch })`), for tests or a Worker's service binding. Monitors, schedules, escalation policies and
  the rest are read and changed over Brigade Sync (`@freecorps/brigade-sync`), not this API.

## Development

The webhook payload validators live in `packages/schema` (`WEBHOOK_PAYLOADS`), and are bundled into `dist` with what
they use. `tests/` checks the Standard Webhooks specification's own example, deliveries signed by Brigade's API
(`tests/fixtures/server-signed.json`, which `apps/api` keeps current: `vp run --filter @freecorps/brigade-api
sdk-fixture`), the client's methods, paths and error codes against `docs/api/openapi.json`, and that nothing here
imports app code. `vp run build` packs and then runs `scripts/check-dist.mjs`: the built files import nothing, load in
plain Node and verify those deliveries. `src/` is type-checked without Node types.

License: MIT.
