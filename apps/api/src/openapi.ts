// The OpenAPI 3.1 reference of the API's public HTTP routes (RFC 0002 "Public HTTP API"), and of the outbound webhooks'
// payloads (`webhooks`, RFC 0005 "Outbound webhooks"). Request bodies and payloads are made from the validators the
// routes and receivers run (`@freecorps/brigade-schema`, `toJsonSchema`), refusal codes from the status maps the routes
// answer with (src/http.ts); the routes, their auth and their answers are listed by hand below.
// `vp run --filter @freecorps/brigade-api openapi` writes it to docs/api/openapi.json; test/openapi.test.ts fails when
// that file is stale, and calls each operation to check it answers as documented.
//
// Imports nothing that needs the Workers runtime, so the generator runs in Node.

import {
  customFieldCreateRequest,
  customFieldPatchRequest,
  declareRequest,
  FIELD_KINDS,
  idPattern,
  INCIDENT_PAGE_DEFAULT,
  INCIDENT_SCAN_CAP,
  INCIDENT_PAGE_MAX,
  INCIDENT_STATUSES,
  incidentPatchFields,
  incidentTypeCreateRequest,
  incidentTypePatchRequest,
  INVITATION_EMAIL_MAX,
  MAX_CUSTOM_FIELDS_PER_WORKSPACE,
  MAX_INCIDENT_ROLES,
  ROLE_ID_MAX,
  ROLES,
  SERVICE_TIERS,
  serviceCreateRequest,
  servicePatchRequest,
  SEVERITIES,
  toJsonSchema,
  updateRequest,
  v,
  WEBHOOK_PAYLOADS,
  MAX_EXPORT_RANGE_DAYS,
  MONITOR_URL_MAX,
  STATUS_LOCALES,
  STATUS_PAGE_TITLE_MAX,
  STATUS_SLUG,
  WEBHOOK_DESCRIPTION_MAX,
  WEBHOOK_EVENT_TYPES,
  webhookHeadersInput,
  webhookHeadersUpdate,
  workspaceName,
  type JsonSchema,
  type Permission,
  type WebhookPayloadType,
} from "@freecorps/brigade-schema";
import {
  ACK_STATUS,
  DRAFT_STATUS,
  EXPORT_STATUS,
  INVITATION_STATUS,
  MEMBER_STATUS,
  REST_STATUS,
  STATUS_PAGE_STATUS,
  USER_ID,
  WEBHOOK_STATUS,
} from "./http.ts";

/** The workspace id the D1-backed routes take (`ORGANIZATION_ID` in src/workspace.ts; the test checks they agree). */
export const WORKSPACE_ID_PATTERN = "^ws_[0-9A-HJKMNP-TV-Z]{26}$";
/** The idempotency key an ack takes (`TOKEN` in packages/sync's protocol; the test checks they agree). */
export const IDEMPOTENCY_KEY_PATTERN = "^[\\w:-]{1,64}$";
/** The idempotency key the webhook routes take (`WEBHOOK_IDEMPOTENCY_KEY` in src/webhook-routes.ts; the test checks). */
export const WEBHOOK_IDEMPOTENCY_KEY_PATTERN = "^[A-Za-z0-9_-]{16,64}$";

type Method = "get" | "post" | "put" | "patch" | "delete";

type Parameter = {
  name: string;
  in: "path" | "header" | "query";
  description: string;
  schema: JsonSchema;
  /** Default true; a query parameter is optional. */
  required?: boolean;
  /** A list in one query parameter, comma-separated (`style: form`, `explode: false`). */
  explode?: false;
};

type Answer = {
  description: string;
  /** The body on success; refusals are `{ "error": <code> }` with `errors` as its codes. */
  body?: JsonSchema;
  errors?: readonly string[];
};

export type Operation = {
  method: Method;
  /** OpenAPI's form, `{name}` for a path parameter; through the dashboard's Worker, under `/api`. */
  path: string;
  operationId: string;
  tag:
    | "Health"
    | "Monitors"
    | "Alerts"
    | "Workspaces"
    | "Members"
    | "Invitations"
    | "Incidents"
    | "Catalog"
    | "Webhooks"
    | "Status page"
    | "Exports"
    | "Postmortems"
    | "Sync";
  summary: string;
  description?: string;
  /** `session`: the Better Auth session cookie; `optional`: answers more with one; `none`: no auth. */
  auth: "session" | "optional" | "none";
  /**
   * Also takes an API token (`Authorization: Bearer`, RFC 0014) with this scope (or every one of these); `"frames"`
   * when each frame is checked against the token's scopes instead (the sync socket).
   */
  bearer?: Permission | readonly [Permission, ...Permission[]] | "frames";
  parameters?: readonly Parameter[];
  body?: JsonSchema;
  responses: Readonly<Record<number, Answer>>;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** `{ status: [codes] }` from a route's status map. */
function codesBy(map: Partial<Record<string, number>>): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const [code, status] of Object.entries(map)) {
    if (status !== undefined) (out[status] ??= []).push(code);
  }
  return out;
}

/** Joins refusal lists per status, each code once, in order. */
function refusals(...lists: Record<number, readonly string[]>[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const list of lists) {
    for (const [status, codes] of Object.entries(list)) {
      out[Number(status)] = [...new Set([...(out[Number(status)] ?? []), ...codes])];
    }
  }
  return out;
}

const REFUSED: Record<number, string> = {
  400: "The request is malformed.",
  401: "No session.",
  403: "Refused: another site's `Origin`, not a member, or not allowed.",
  404: "Not found.",
  409: "Conflicts with the current state.",
  410: "Expired.",
  413: "The body is too large.",
  426: "Not a WebSocket upgrade.",
  429: "Too many requests.",
  500: "Failed. Not retried by itself.",
  503: "Unavailable for now: retry.",
};

/** Answers with a success, plus one per status of `errors` (described by `REFUSED`). */
function answers(
  success: Record<number, Answer>,
  errors: Record<number, readonly string[]>,
): Record<number, Answer> {
  const out: Record<number, Answer> = { ...success };
  for (const [status, codes] of Object.entries(errors)) {
    out[Number(status)] = { description: REFUSED[Number(status)]!, errors: codes };
  }
  return out;
}

/** What a shard call's failure answers (`failed` in src/index.ts). */
const SHARD_FAILED = { 500: ["internal"], 503: ["unavailable"] };
/** A cookie-authenticated route: the session, and the same site when an `Origin` is sent. */
const SIGNED_IN = { 401: ["unauthenticated"], 403: ["forbidden_origin"] };
/** What an API token adds (RFC 0014): a scope or role that does not allow it, and the token's rate limit. */
const BEARER = { 403: ["forbidden"], 429: ["rate_limited"] };
/** `REFUSED`'s wording on the operations that also take an API token (and only on those). */
const BEARER_REFUSED: Record<number, string> = {
  401: "No session, or an API token that is wrong, revoked, expired or no longer backed by its creator.",
  403: "Refused: another site's `Origin`, not a member, or not allowed (with an API token: its scopes or its creator's role).",
  429: "Too many requests (with an API token: its limit, `Retry-After` seconds).",
};

const workspaceId: Parameter = {
  name: "workspaceId",
  in: "path",
  description: "The workspace (`ws_<ULID>`).",
  schema: { type: "string", pattern: WORKSPACE_ID_PATTERN },
};
const invitationId: Parameter = {
  name: "invitationId",
  in: "path",
  description: "The invitation (`inv_<ULID>`), as in the link its email carries.",
  schema: { type: "string", pattern: idPattern("inv") },
};
const userId: Parameter = {
  name: "userId",
  in: "path",
  description: "The member's user id (`usr_<ULID>`); your own to leave.",
  schema: { type: "string", pattern: USER_ID.source },
};

const incidentId: Parameter = {
  name: "incidentId",
  in: "path",
  description: "The incident (`inc_<ULID>`).",
  schema: { type: "string", pattern: idPattern("inc") },
};
const entryId: Parameter = {
  name: "entryId",
  in: "path",
  description:
    "The update's timeline entry, `<incident id>:<seq>` (as `postIncidentUpdate` answers it and webhook payloads " +
    "carry it); the colon may be percent-encoded.",
  schema: {
    type: "string",
    pattern: `^${idPattern("inc").slice(1, -1)}(:|%3[Aa])[1-9][0-9]{0,8}$`,
  },
};
const catalogId = (name: string, prefix: string, what: string): Parameter => ({
  name,
  in: "path",
  description: `The ${what} (\`${prefix}_<ULID>\`).`,
  schema: { type: "string", pattern: idPattern(prefix) },
});
const serviceId = catalogId("serviceId", "svc", "service");
const typeId = catalogId("typeId", "typ", "incident type");
const fieldId = catalogId("fieldId", "fld", "custom field");
const webhookId = catalogId("webhookId", "whk", "webhook endpoint");
const exportId = catalogId("exportId", "exp", "export");
/** The key the webhook routes take (src/webhook-routes.ts `WEBHOOK_IDEMPOTENCY_KEY`): optional. */
const webhookIdempotencyKey: Parameter = {
  name: "Idempotency-Key",
  in: "header",
  description:
    "Your id for this request (16 to 64 letters, digits, `_` or `-`; a UUID fits), so a retry after a lost answer is " +
    "the same request: it answers what the first one did, the same secret included. Without one, each request is new.",
  schema: { type: "string", pattern: WEBHOOK_IDEMPOTENCY_KEY_PATTERN },
  required: false,
};
/** What a route that checks the member (or token) itself answers before the shard (src/member-route.ts). */
const MEMBER_CHECK = refusals(SIGNED_IN, {
  400: ["invalid_workspace_id"],
  403: ["not_a_member"],
  503: ["unavailable"],
});
const WEBHOOK_REFUSALS = refusals(
  MEMBER_CHECK,
  {
    400: ["invalid_args", "invalid_idempotency_key"],
    404: ["not_found"],
    503: ["not_configured"],
  },
  codesBy(WEBHOOK_STATUS),
  SHARD_FAILED,
);
/** The key every write of the incident and catalog routes takes (src/rest-routes.ts). */
const idempotencyKey: Parameter = {
  name: "Idempotency-Key",
  in: "header",
  description:
    "Your id for this request (1 to 64 letters, digits, `_`, `:` or `-`), so a retry after a lost answer runs it " +
    "once: the same key with the same request again, within 7 days, answers what the first request did (a create, " +
    "the same entry; a refusal, the same refusal) and changes nothing more. The key is tied to that request (its " +
    "route, target and body): sent with another one it is `422 idempotency_key_reused` and runs nothing. A key is " +
    "the caller's own: another member or token reusing it makes a new request.",
  schema: { type: "string", pattern: IDEMPOTENCY_KEY_PATTERN },
};

const role = toJsonSchema(v.picklist(ROLES));
const OK_200 = { 200: { description: "Done.", body: ref("Ok") } };

const MEMBER_REFUSALS = refusals(
  SIGNED_IN,
  {
    400: ["invalid_workspace_id"],
    403: ["not_a_member"],
    404: ["not_found"],
    429: ["rate_limited"],
  },
  codesBy(MEMBER_STATUS),
  SHARD_FAILED,
);
const INVITATION_REFUSALS = codesBy(INVITATION_STATUS);

/** What the incident and catalog reads answer besides success (src/rest-routes.ts). */
const REST_READ = refusals(
  SIGNED_IN,
  {
    400: ["invalid_workspace_id"],
    403: ["not_a_member", "forbidden"],
    404: ["not_found"],
    503: ["unavailable"],
  },
  SHARD_FAILED,
);

/** What their writes answer besides success: `REST_READ`'s, a bad body or key, and `extra` of `REST_STATUS`. */
function restWrite(...extra: (keyof typeof REST_STATUS)[]): Record<number, string[]> {
  return refusals(
    REST_READ,
    { 400: ["invalid_args"], 401: ["unauthenticated"], 422: ["idempotency_key_reused"] },
    codesBy(Object.fromEntries(extra.map((code) => [code, REST_STATUS[code]]))),
  );
}

/** `{ <key>: <schema> }`, as a single entry answers. */
const wrapped = (key: string, schema: string): JsonSchema => ({
  type: "object",
  properties: { [key]: ref(schema) },
  required: [key],
});

/** `{ <key>: [<schema>] }`, as a list answers. */
const list = (key: string, schema: string): JsonSchema => ({
  type: "object",
  properties: { [key]: { type: "array", items: ref(schema) } },
  required: [key],
});

/** Every public operation, in the order the reference lists them, before what API tokens add to their answers. */
const LISTED: readonly Operation[] = [
  {
    method: "get",
    path: "/health",
    operationId: "getHealth",
    tag: "Health",
    summary: "Whether the API answers",
    description: "`HEAD` answers the same without a body.",
    auth: "none",
    responses: { 200: { description: "The API is up.", body: ref("Ok") } },
  },
  {
    method: "get",
    path: "/health/paging",
    operationId: "getPagingHealth",
    tag: "Health",
    summary: "Whether the paging pipeline proved itself lately",
    description:
      "Without a session, or for a user in no workspace, only `status`. A member of any workspace also gets the " +
      "reasons and times, since a responder needs to know they may not be paged.",
    auth: "optional",
    responses: answers(
      { 200: { description: "The pipeline's state.", body: ref("PagingHealth") } },
      { 503: ["unavailable"] },
    ),
  },
  {
    method: "post",
    path: "/heartbeat/{token}",
    operationId: "pingHeartbeat",
    tag: "Monitors",
    summary: "Ping a heartbeat monitor",
    description:
      "The token is the monitor's heartbeat URL's last segment (shown once, when the monitor is made or its URL " +
      "rotated): it names the workspace and the monitor and carries the secret. The body is never read. Every " +
      "refusal is the same `404`, so a wrong secret looks like a missing monitor.",
    auth: "none",
    parameters: [
      {
        name: "token",
        in: "path",
        description: "`<workspaceId>.<monitorId>.<secret>`, from the monitor's heartbeat URL.",
        schema: { type: "string" },
      },
    ],
    responses: answers(
      { 202: { description: "The ping was recorded.", body: ref("Ok") } },
      refusals({ 404: ["not_found"] }, SHARD_FAILED),
    ),
  },
  {
    method: "post",
    path: "/alerts/{token}",
    operationId: "sendAlerts",
    tag: "Alerts",
    summary: "Send alerts to an alert source",
    description:
      'What Grafana, Datadog, Sentry or any webhook posts (RFC 0005 "Alert sources"). The token is the source URL\'s ' +
      "last segment (shown once, when the source is made or its URL rotated). The body is the provider's own " +
      "payload, at most 256 KiB; a Sentry source also needs `Sentry-Hook-Signature`, a Grafana source with an HMAC " +
      "secret `X-Grafana-Alerting-Signature`, and a source with a header that header. A payload Brigade cannot read " +
      "is still accepted (`malformed`), and pages. So is one past 256 KiB, unread (`tooLarge`): it pages one " +
      "unreadable alert once the URL and the source's header check out (a signature needs the body, so the secret " +
      "URL authenticates it). Every refusal of the URL, header or signature is the same `404`; `503` carries " +
      "`Retry-After` (over a rate limit too: Datadog retries a 5xx, not a 429; and for a token refused within the " +
      "last minute once the workspace's refusals are over their limit).",
    auth: "none",
    parameters: [
      {
        name: "token",
        in: "path",
        description: "`<workspaceId>.<sourceId>.<secret>`, from the alert source's URL.",
        schema: { type: "string" },
      },
    ],
    body: { description: "The provider's webhook payload, as JSON." },
    responses: answers(
      {
        202: {
          description:
            "Accepted: how many alerts it held, whether it was unreadable, and whether it was too large to read.",
          body: {
            type: "object",
            properties: {
              ok: { const: true },
              alerts: { type: "integer", minimum: 0 },
              malformed: { type: "boolean" },
              tooLarge: { const: true },
            },
            required: ["ok", "alerts"],
          },
        },
      },
      refusals({ 404: ["not_found"] }, SHARD_FAILED),
    ),
  },
  {
    method: "post",
    path: "/workspaces",
    operationId: "createWorkspace",
    tag: "Workspaces",
    summary: "Create a workspace",
    description:
      "The signed-in user becomes its owner, and it becomes the session's active workspace. Bodies over 4 KiB are " +
      "refused. A `400` for a bad name lists the problems in `issues`.",
    auth: "session",
    body: {
      type: "object",
      properties: { name: toJsonSchema(workspaceName) },
      required: ["name"],
    },
    responses: answers(
      { 201: { description: "The new workspace.", body: ref("Workspace") } },
      refusals(SIGNED_IN, {
        400: ["invalid_args"],
        403: ["workspace_limit"],
        500: ["internal"],
      }),
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/members/{userId}",
    operationId: "changeMemberRole",
    tag: "Members",
    summary: "Change a member's role",
    description:
      'Owners and admins, by the rules of RFC 0003 "Members". `409 conflict`: the members changed meanwhile, ' +
      "reload and retry. `503 not_applied`: the change is made and the workspace is catching up; sending it again " +
      "finishes it sooner.",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId, userId],
    body: { type: "object", properties: { role }, required: ["role"] },
    responses: answers(OK_200, refusals(MEMBER_REFUSALS, { 400: ["invalid_args"] })),
  },
  {
    method: "delete",
    path: "/workspaces/{workspaceId}/members/{userId}",
    operationId: "removeMember",
    tag: "Members",
    summary: "Remove a member, or leave",
    description:
      "Removes the member and their devices; with your own user id, leaves the workspace. `409 last_owner`: a " +
      "workspace keeps at least one owner.",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId, userId],
    responses: answers(OK_200, MEMBER_REFUSALS),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/invitations",
    operationId: "listInvitations",
    tag: "Invitations",
    summary: "List pending invitations",
    description:
      "Owners and admins. Newest first, those that ran out included (resending brings one back).",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId],
    responses: answers(
      {
        200: {
          description: "The pending invitations.",
          body: {
            type: "object",
            properties: { invitations: { type: "array", items: ref("Invitation") } },
            required: ["invitations"],
          },
        },
      },
      refusals(SIGNED_IN, {
        400: ["invalid_workspace_id"],
        403: ["not_a_member", "forbidden"],
        503: ["unavailable"],
      }),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/invitations",
    operationId: "invite",
    tag: "Invitations",
    summary: "Invite someone by email",
    description:
      "Owners and admins, with a verified address; an admin cannot invite an owner. Brigade emails the invitation. " +
      "Limited per workspace, inviter and address (`429`, or `409 send_limit` past the workspace's daily cap).",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId],
    body: {
      type: "object",
      properties: {
        email: { type: "string", format: "email", maxLength: INVITATION_EMAIL_MAX },
        role,
      },
      required: ["email", "role"],
    },
    responses: answers(
      {
        201: {
          description: "The invitation, sent.",
          body: {
            type: "object",
            properties: { ok: { const: true }, invitation: ref("Invitation") },
            required: ["ok", "invitation"],
          },
        },
      },
      refusals(
        SIGNED_IN,
        { 400: ["invalid_workspace_id", "invalid_args"], 403: ["not_a_member", "forbidden"] },
        INVITATION_REFUSALS,
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "delete",
    path: "/workspaces/{workspaceId}/invitations/{invitationId}",
    operationId: "revokeInvitation",
    tag: "Invitations",
    summary: "Revoke a pending invitation",
    description: "Owners and admins; an admin cannot touch an invitation to be an owner.",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId, invitationId],
    responses: answers(
      OK_200,
      refusals(
        SIGNED_IN,
        { 400: ["invalid_workspace_id"], 403: ["not_a_member"], 404: ["not_found"] },
        INVITATION_REFUSALS,
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/invitations/{invitationId}/resend",
    operationId: "resendInvitation",
    tag: "Invitations",
    summary: "Send an invitation again, with a new expiry",
    description:
      "At most once every five minutes per invitation, within the workspace's daily cap.",
    auth: "session",
    bearer: "members:manage",
    parameters: [workspaceId, invitationId],
    responses: answers(
      OK_200,
      refusals(
        SIGNED_IN,
        { 400: ["invalid_workspace_id"], 403: ["not_a_member", "unverified"], 404: ["not_found"] },
        INVITATION_REFUSALS,
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "get",
    path: "/invitations/{invitationId}",
    operationId: "getInvitation",
    tag: "Invitations",
    summary: "Show an invitation to its invitee",
    description:
      "The workspace, and whether it can still be accepted. Who invited and the role only when the invitation is " +
      "for the signed-in address (`forYou`); never the address itself.",
    auth: "session",
    parameters: [invitationId],
    responses: answers(
      {
        200: {
          description: "The invitation.",
          body: {
            type: "object",
            properties: { invitation: ref("InvitationPreview") },
            required: ["invitation"],
          },
        },
      },
      refusals(SIGNED_IN, { 404: ["not_found"], 503: ["unavailable"] }),
    ),
  },
  {
    method: "post",
    path: "/invitations/{invitationId}/accept",
    operationId: "acceptInvitation",
    tag: "Invitations",
    summary: "Accept an invitation",
    description:
      "Signed in with the invited address, verified. `503 not_applied` also carries `workspaceId`: you are a " +
      "member, and the workspace is catching up.",
    auth: "session",
    parameters: [invitationId],
    responses: answers(
      {
        200: {
          description: "You joined the workspace.",
          body: {
            type: "object",
            properties: {
              ok: { const: true },
              role,
              workspaceId: { type: "string", pattern: WORKSPACE_ID_PATTERN },
            },
            required: ["ok", "role", "workspaceId"],
          },
        },
      },
      refusals(
        SIGNED_IN,
        { 403: ["unverified"], 404: ["not_found"] },
        INVITATION_REFUSALS,
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "post",
    path: "/invitations/{invitationId}/decline",
    operationId: "declineInvitation",
    tag: "Invitations",
    summary: "Decline an invitation",
    description: "Signed in with the invited address, verified.",
    auth: "session",
    parameters: [invitationId],
    responses: answers(
      OK_200,
      refusals(
        SIGNED_IN,
        { 403: ["unverified"], 404: ["not_found"] },
        INVITATION_REFUSALS,
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}/ack",
    operationId: "acknowledgeIncident",
    tag: "Incidents",
    summary: "Acknowledge an incident",
    description:
      "As the signed-in member (responders and up), with the same rules and event as acknowledging in the app. The " +
      "same `Idempotency-Key` again answers what the first request did. `409 conflict`: already acknowledged; " +
      "`409 invalid_transition`: no longer active.",
    auth: "session",
    bearer: "incident:ack",
    parameters: [
      workspaceId,
      {
        name: "incidentId",
        in: "path",
        description: "The incident (`inc_<ULID>`).",
        schema: { type: "string", pattern: idPattern("inc") },
      },
      {
        name: "Idempotency-Key",
        in: "header",
        description: "Your id for this ack, so a retry after a lost answer runs it once.",
        schema: { type: "string", pattern: IDEMPOTENCY_KEY_PATTERN },
      },
    ],
    responses: answers(
      OK_200,
      refusals(
        SIGNED_IN,
        {
          400: ["invalid_workspace_id", "invalid_args"],
          403: ["not_a_member"],
          404: ["not_found"],
        },
        codesBy(ACK_STATUS),
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/incidents",
    operationId: "listIncidents",
    tag: "Incidents",
    summary: "List incidents",
    description:
      `Newest first (by id: when the declaring client made it), ${INCIDENT_PAGE_DEFAULT} a page by default. Every ` +
      "member may read them. Filters combine; `status` and `severity` take a comma-separated list. `nextCursor` is " +
      `the next page's \`cursor\`, null on the last. A request reads at most ${INCIDENT_SCAN_CAP} incidents: past ` +
      "that it answers the page so far, maybe short or empty, with a `nextCursor` where it stopped, so follow " +
      "`nextCursor` until it is null rather than stopping at a short page.",
    auth: "session",
    bearer: "incident:read",
    parameters: [
      workspaceId,
      {
        name: "status",
        in: "query",
        required: false,
        explode: false,
        description: "Only incidents in one of these statuses.",
        schema: { type: "array", items: { type: "string", enum: [...INCIDENT_STATUSES] } },
      },
      {
        name: "severity",
        in: "query",
        required: false,
        explode: false,
        description: "Only incidents of one of these severities.",
        schema: { type: "array", items: { type: "string", enum: [...SEVERITIES] } },
      },
      { ...typeId, in: "query", required: false, description: "Only incidents of this type." },
      {
        ...serviceId,
        in: "query",
        required: false,
        description: "Only incidents naming this service.",
      },
      {
        name: "cursor",
        in: "query",
        required: false,
        description: "The `nextCursor` of the page before: this page starts below it.",
        schema: { type: "string", pattern: idPattern("inc") },
      },
      {
        name: "limit",
        in: "query",
        required: false,
        description: `At most this many (default ${INCIDENT_PAGE_DEFAULT}).`,
        schema: { type: "integer", minimum: 1, maximum: INCIDENT_PAGE_MAX },
      },
    ],
    responses: answers(
      {
        200: {
          description: "One page of incidents.",
          body: {
            type: "object",
            properties: {
              incidents: { type: "array", items: ref("Incident") },
              nextCursor: { type: ["string", "null"] },
            },
            required: ["incidents", "nextCursor"],
          },
        },
      },
      refusals(REST_READ, { 400: ["invalid_args"] }),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/incidents",
    operationId: "declareIncident",
    tag: "Incidents",
    summary: "Declare an incident",
    description:
      "Runs `incident.declare` as the member (responders and up), as declaring in the app does: numbered, on the " +
      "timeline, `incident.declared` through the outbox, and paged by the escalation policy exactly as a declare " +
      "from the dashboard is. The severity defaults to the type's, else `sev3`; a type or service that does not " +
      "exist is left out, as in the app.",
    auth: "session",
    bearer: "incident:declare",
    parameters: [workspaceId, idempotencyKey],
    body: toJsonSchema(declareRequest),
    responses: answers(
      { 201: { description: "The incident.", body: wrapped("incident", "Incident") } },
      restWrite(),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}",
    operationId: "getIncident",
    tag: "Incidents",
    summary: "Get an incident",
    auth: "session",
    bearer: "incident:read",
    parameters: [workspaceId, incidentId],
    responses: answers(
      { 200: { description: "The incident.", body: wrapped("incident", "Incident") } },
      REST_READ,
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}",
    operationId: "updateIncident",
    tag: "Incidents",
    summary: "Change an incident's title, type, services, fields, roles, severity or status",
    description:
      "Each change is its own named mutation, as in the app, in this order: `incident.rename`, `incident.setType`, " +
      "`incident.setServices`, `incident.setField` per field, `incident.assignRole` per role, " +
      "`incident.setSeverity`, `incident.setStatus` (each with its timeline entry and event). One that asks for " +
      "what already is changes nothing. The first refusal " +
      "stops the rest and is the answer; the changes before it stay made. The same request with the same key answers " +
      "the same refusal again (results are kept, refusals too); once what refused it is fixed, send it with a new " +
      "key: the changes already made come back as changing nothing, and the rest run. Responders and up. " +
      "`409 invalid_transition`: the status cannot follow the current one. `400 invalid_args` with an issue at " +
      "`roles.<role id>`: a role the workspace does not offer, or someone who is not a member or is a viewer. The " +
      "answer is the incident, so an API token needs `incident:read` too.",
    auth: "session",
    bearer: ["incident:update", "incident:read"],
    parameters: [workspaceId, incidentId, idempotencyKey],
    body: {
      ...toJsonSchema(incidentPatchFields),
      properties: {
        ...(toJsonSchema(incidentPatchFields).properties as Record<string, JsonSchema>),
        fields: {
          type: "object",
          description:
            `Custom field values by field id (\`fld_<ULID>\`, at most ${MAX_CUSTOM_FIELDS_PER_WORKSPACE}): text or ` +
            "a link, a number, an option id (one choice) or a list of them (several); `null` clears one (not a " +
            "field the incident's type requires).",
          additionalProperties: { anyOf: [ref("FieldValue"), { type: "null" }] },
        },
        roles: {
          type: "object",
          description:
            `Who holds each incident role, by role id (\`commander\`, \`communications\`, \`operations\` or a ` +
            `workspace role's \`rol_<ULID>\`, at most ${MAX_INCIDENT_ROLES}): a member's user id, or \`null\` to ` +
            "leave the role empty.",
          propertyNames: { maxLength: ROLE_ID_MAX },
          additionalProperties: {
            anyOf: [{ type: "string", minLength: 1, maxLength: 64 }, { type: "null" }],
          },
        },
      },
    },
    responses: answers(
      { 200: { description: "The incident, changed.", body: wrapped("incident", "Incident") } },
      restWrite("invalid_transition"),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}/updates",
    operationId: "postIncidentUpdate",
    tag: "Incidents",
    summary: "Post a written update to an incident",
    description:
      "Runs `incident.postUpdate`: an update on the incident's timeline (what responders know), in any status. " +
      "Responders and up. The answer names its timeline entry (`entryId`), to edit or remove it.",
    auth: "session",
    bearer: "incident:update",
    parameters: [workspaceId, incidentId, idempotencyKey],
    body: toJsonSchema(updateRequest),
    responses: answers(
      {
        201: {
          description: "Posted.",
          body: {
            type: "object",
            properties: {
              ok: { const: true },
              entryId: {
                type: ["string", "null"],
                description:
                  "The update's timeline entry (`<incident id>:<seq>`). Null only on a retry after the update was edited or removed meanwhile.",
              },
            },
            required: ["ok", "entryId"],
          },
        },
      },
      restWrite(),
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}/updates/{entryId}",
    operationId: "editIncidentUpdate",
    tag: "Incidents",
    summary: "Edit a written update",
    description:
      "Runs `incident.editUpdate`: the update's text changes in place (it keeps its place, time and author, and " +
      'reads "edited"), in any status. Only its author: the member who posted it, or an API token that posted it ' +
      "or whose creator did; anyone else is `403 forbidden`, owners and admins included. Text it already has " +
      "changes nothing. `409 conflict`: the update was removed. `404 not_found`: no such update on this incident. " +
      "What was published on the status page is never changed by it.",
    auth: "session",
    bearer: "incident:update",
    parameters: [workspaceId, incidentId, entryId, idempotencyKey],
    body: toJsonSchema(updateRequest),
    responses: answers({ 200: { description: "Edited.", body: ref("Ok") } }, restWrite("conflict")),
  },
  {
    method: "delete",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}/updates/{entryId}",
    operationId: "deleteIncidentUpdate",
    tag: "Incidents",
    summary: "Remove a written update",
    description:
      'Runs `incident.deleteUpdate`: the update\'s text is gone and its entry stays as "removed by …". Its author ' +
      "(as for an edit), or an owner or admin (anyone's); anyone else is `403 forbidden`. `409 conflict`: removed " +
      "already. `404 not_found`: no such update on this incident.",
    auth: "session",
    bearer: "incident:update",
    parameters: [workspaceId, incidentId, entryId, idempotencyKey],
    responses: answers(
      { 200: { description: "Removed.", body: ref("Ok") } },
      restWrite("conflict"),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/services",
    operationId: "listServices",
    tag: "Catalog",
    summary: "List the service catalog",
    description: "Every service (at most 100), the most critical tier first, then by name.",
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId],
    responses: answers(
      { 200: { description: "The services.", body: list("services", "Service") } },
      REST_READ,
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/services",
    operationId: "createService",
    tag: "Catalog",
    summary: "Add a service",
    description:
      "Runs `service.create`. Owners and admins. Owners are schedules or members who can respond; " +
      "`409 limit_reached` past 100 services.",
    auth: "session",
    bearer: "catalog:manage",
    parameters: [workspaceId, idempotencyKey],
    body: toJsonSchema(serviceCreateRequest),
    responses: answers(
      { 201: { description: "The service.", body: wrapped("service", "Service") } },
      restWrite("limit_reached"),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/services/{serviceId}",
    operationId: "getService",
    tag: "Catalog",
    summary: "Get a service",
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId, serviceId],
    responses: answers(
      { 200: { description: "The service.", body: wrapped("service", "Service") } },
      REST_READ,
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/services/{serviceId}",
    operationId: "updateService",
    tag: "Catalog",
    summary: "Change a service",
    description:
      "Runs `service.update` with what is sent over what the service has. Owners and admins. Nothing to change " +
      "answers the service as it is. The answer is the service, so an API token needs `catalog:read` too.",
    auth: "session",
    bearer: ["catalog:manage", "catalog:read"],
    parameters: [workspaceId, serviceId, idempotencyKey],
    body: toJsonSchema(servicePatchRequest),
    responses: answers(
      { 200: { description: "The service.", body: wrapped("service", "Service") } },
      restWrite(),
    ),
  },
  {
    method: "delete",
    path: "/workspaces/{workspaceId}/services/{serviceId}",
    operationId: "deleteService",
    tag: "Catalog",
    summary: "Remove a service from the catalog",
    description:
      "Runs `service.delete`. Owners and admins. Incidents that named it keep its id, which reads leave out; its id " +
      "is never used again.",
    auth: "session",
    bearer: "catalog:manage",
    parameters: [workspaceId, serviceId, idempotencyKey],
    responses: answers(OK_200, restWrite()),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/incident-types",
    operationId: "listIncidentTypes",
    tag: "Catalog",
    summary: "List incident types",
    description: "Every incident type (at most 20), by name.",
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId],
    responses: answers(
      { 200: { description: "The incident types.", body: list("incidentTypes", "IncidentType") } },
      REST_READ,
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/incident-types",
    operationId: "createIncidentType",
    tag: "Catalog",
    summary: "Add an incident type",
    description:
      "Runs `incidentType.create`. Owners and admins. `409 limit_reached` past 20 types.",
    auth: "session",
    bearer: "catalog:manage",
    parameters: [workspaceId, idempotencyKey],
    body: toJsonSchema(incidentTypeCreateRequest),
    responses: answers(
      {
        201: { description: "The incident type.", body: wrapped("incidentType", "IncidentType") },
      },
      restWrite("limit_reached"),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/incident-types/{typeId}",
    operationId: "getIncidentType",
    tag: "Catalog",
    summary: "Get an incident type",
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId, typeId],
    responses: answers(
      {
        200: { description: "The incident type.", body: wrapped("incidentType", "IncidentType") },
      },
      REST_READ,
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/incident-types/{typeId}",
    operationId: "updateIncidentType",
    tag: "Catalog",
    summary: "Change an incident type",
    description:
      "Runs `incidentType.update` with what is sent over what the type has. Owners and admins. New `roles` without " +
      "`requiredRoles` keep required those still listed. Incidents of the type keep their severity. The answer is " +
      "the type, so an API token needs `catalog:read` too.",
    auth: "session",
    bearer: ["catalog:manage", "catalog:read"],
    parameters: [workspaceId, typeId, idempotencyKey],
    body: toJsonSchema(incidentTypePatchRequest),
    responses: answers(
      {
        200: { description: "The incident type.", body: wrapped("incidentType", "IncidentType") },
      },
      restWrite(),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/custom-fields",
    operationId: "listCustomFields",
    tag: "Catalog",
    summary: "List custom fields",
    description: `Every custom field (at most ${MAX_CUSTOM_FIELDS_PER_WORKSPACE}), in the order they were made.`,
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId],
    responses: answers(
      { 200: { description: "The custom fields.", body: list("customFields", "CustomField") } },
      REST_READ,
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/custom-fields",
    operationId: "createCustomField",
    tag: "Catalog",
    summary: "Add a custom field",
    description:
      "Runs `customField.create`. Owners and admins. Select fields need options; give each a label, and an id only " +
      `to keep one (new ones get theirs). \`409 limit_reached\` past ${MAX_CUSTOM_FIELDS_PER_WORKSPACE} fields.`,
    auth: "session",
    bearer: "catalog:manage",
    parameters: [workspaceId, idempotencyKey],
    body: toJsonSchema(customFieldCreateRequest),
    responses: answers(
      { 201: { description: "The custom field.", body: wrapped("customField", "CustomField") } },
      restWrite("limit_reached"),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/custom-fields/{fieldId}",
    operationId: "getCustomField",
    tag: "Catalog",
    summary: "Get a custom field",
    auth: "session",
    bearer: "catalog:read",
    parameters: [workspaceId, fieldId],
    responses: answers(
      { 200: { description: "The custom field.", body: wrapped("customField", "CustomField") } },
      REST_READ,
    ),
  },
  {
    method: "patch",
    path: "/workspaces/{workspaceId}/custom-fields/{fieldId}",
    operationId: "updateCustomField",
    tag: "Catalog",
    summary: "Change a custom field",
    description:
      "Runs `customField.update`: its name, description and options (the list sent replaces the old one: keep an " +
      "option by its id). Its kind never changes. Owners and admins. The answer is the field, so an API token needs " +
      "`catalog:read` too.",
    auth: "session",
    bearer: ["catalog:manage", "catalog:read"],
    parameters: [workspaceId, fieldId, idempotencyKey],
    body: toJsonSchema(customFieldPatchRequest),
    responses: answers(
      { 200: { description: "The custom field.", body: wrapped("customField", "CustomField") } },
      restWrite(),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/webhooks",
    operationId: "createWebhook",
    tag: "Webhooks",
    summary: "Add an outbound webhook endpoint",
    description:
      'Owners and admins. Runs `webhook.create` (RFC 0005 "Outbound webhooks"): the endpoint takes the listed ' +
      "events from now on, signed per Standard Webhooks with a secret the server makes and answers here once, never " +
      "again. `headers` (at most 5) are sent on every delivery; their values are sealed at rest and never shown back " +
      "(the dashboard shows each name and the last 4 characters of a long value). Names Brigade sets itself, " +
      "hop-by-hop ones and the `webhook-*` signature headers are refused; `Authorization` is allowed. " +
      "`503 not_configured`: the server has no `WEBHOOK_SECRET_KEY`. With an `Idempotency-Key`, a retry answers the " +
      "same secret.",
    auth: "session",
    bearer: "webhook:manage",
    parameters: [workspaceId, webhookIdempotencyKey],
    body: {
      type: "object",
      properties: {
        id: { type: "string", pattern: idPattern("whk"), description: "Made by the caller." },
        url: {
          type: "string",
          format: "uri",
          maxLength: MONITOR_URL_MAX,
          description: "https only, on a public host; redirects are never followed.",
        },
        description: toJsonSchema(v.string({ max: WEBHOOK_DESCRIPTION_MAX })),
        events: toJsonSchema(
          v.array(v.picklist(WEBHOOK_EVENT_TYPES), {
            min: 1,
            max: WEBHOOK_EVENT_TYPES.length,
            unique: true,
          }),
        ),
        headers: toJsonSchema(webhookHeadersInput),
      },
      required: ["id", "url", "description", "events"],
      additionalProperties: false,
    },
    responses: answers(
      {
        201: { description: "Added; its signing secret, shown once.", body: ref("WebhookSecret") },
      },
      WEBHOOK_REFUSALS,
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/webhooks/{webhookId}/rotate",
    operationId: "rotateWebhookSecret",
    tag: "Webhooks",
    summary: "Give a webhook endpoint a new signing secret",
    description:
      "Owners and admins. Runs `webhook.rotateSecret`: deliveries are signed with the new secret and, for 24 hours, " +
      "the previous one too. The new secret is answered here once. With an `Idempotency-Key`, a retry answers the " +
      "same secret and never rotates again.",
    auth: "session",
    bearer: "webhook:manage",
    parameters: [workspaceId, webhookId, webhookIdempotencyKey],
    responses: answers(
      { 200: { description: "The new signing secret, shown once.", body: ref("WebhookSecret") } },
      WEBHOOK_REFUSALS,
    ),
  },
  {
    method: "put",
    path: "/workspaces/{workspaceId}/webhooks/{webhookId}/headers",
    operationId: "setWebhookHeaders",
    tag: "Webhooks",
    summary: "Set a webhook endpoint's custom headers",
    description:
      "Owners and admins. Runs `webhook.setHeaders` with the whole list (an empty one removes them): a header sent " +
      "without `value` keeps the value it has (by name, whatever its case), so the others can change without the " +
      "caller knowing it. Values are sealed and never answered; the event (`webhook.headers_changed`) names them only.",
    auth: "session",
    bearer: "webhook:manage",
    parameters: [workspaceId, webhookId, webhookIdempotencyKey],
    body: {
      type: "object",
      properties: { headers: toJsonSchema(webhookHeadersUpdate) },
      required: ["headers"],
      additionalProperties: false,
    },
    responses: answers(
      {
        200: {
          description: "The endpoint's headers now: names and hints, never values.",
          body: {
            type: "object",
            properties: {
              id: { type: "string", pattern: idPattern("whk") },
              headers: { type: "array", items: ref("WebhookHeader") },
            },
            required: ["id", "headers"],
          },
        },
      },
      WEBHOOK_REFUSALS,
    ),
  },
  {
    method: "put",
    path: "/workspaces/{workspaceId}/status-page",
    operationId: "configureStatusPage",
    tag: "Status page",
    summary: "Set up or change the public status page",
    description:
      "Owners and admins. Claims `slug` (`/status/<slug>`) for the workspace and runs `statusPage.configure` (RFC " +
      "0012): its title, language and whether it is published. `409 slug_taken`: another workspace has it.",
    auth: "session",
    bearer: "status:manage",
    parameters: [workspaceId],
    body: {
      type: "object",
      properties: {
        slug: { type: "string", pattern: STATUS_SLUG.source },
        title: toJsonSchema(v.string({ min: 1, max: STATUS_PAGE_TITLE_MAX })),
        locale: toJsonSchema(v.picklist(STATUS_LOCALES)),
        enabled: { type: "boolean" },
      },
      required: ["slug", "title", "locale", "enabled"],
      additionalProperties: false,
    },
    responses: answers(
      OK_200,
      refusals(
        MEMBER_CHECK,
        { 400: ["invalid_args"], 401: ["unauthenticated"] },
        codesBy(STATUS_PAGE_STATUS),
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/exports",
    operationId: "createExport",
    tag: "Exports",
    summary: "Export incidents as a JSON file",
    description:
      "Owners and admins (`data:export`). Writes one incident, or every incident declared in a range of days (at " +
      `most ${MAX_EXPORT_RANGE_DAYS}), with their timelines, follow-ups and postmortems, to a file kept 24 hours, ` +
      "listed in the workspace and recorded as `workspace.exported` (RFC 0013). A few an hour per workspace " +
      "(`429 rate_limited`); `413`: too many incidents or too large. `503 exports_unavailable`: the server has no " +
      "bucket.",
    auth: "session",
    bearer: "data:export",
    parameters: [workspaceId],
    body: {
      type: "object",
      properties: {
        scope: {
          oneOf: [
            {
              type: "object",
              properties: {
                kind: { const: "incident" },
                incidentId: { type: "string", pattern: idPattern("inc") },
              },
              required: ["kind", "incidentId"],
              additionalProperties: false,
            },
            {
              type: "object",
              description: "Incidents declared from `from` to `to`, both days included (UTC).",
              properties: {
                kind: { const: "range" },
                from: { type: "string", format: "date" },
                to: { type: "string", format: "date" },
              },
              required: ["kind", "from", "to"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: ["scope"],
    },
    responses: answers(
      {
        201: {
          description: "Written; download it with `downloadExport` before `expiresAt`.",
          body: {
            type: "object",
            properties: {
              id: { type: "string", pattern: idPattern("exp") },
              expiresAt: { type: "integer", description: "Epoch milliseconds." },
              incidents: { type: "integer", minimum: 0 },
              bytes: { type: "integer", minimum: 0 },
            },
            required: ["id", "expiresAt", "incidents", "bytes"],
          },
        },
      },
      refusals(
        MEMBER_CHECK,
        { 400: ["invalid_args"], 401: ["unauthenticated"], 503: ["exports_unavailable"] },
        codesBy(EXPORT_STATUS),
        SHARD_FAILED,
      ),
    ),
  },
  {
    method: "get",
    path: "/workspaces/{workspaceId}/exports/{exportId}",
    operationId: "downloadExport",
    tag: "Exports",
    summary: "Download an export",
    description:
      "Owners and admins (`data:export`): the file, as an attachment (`application/json`, the `brigade.export` " +
      "format). `410 expired`: past its 24 hours, and deleted now.",
    auth: "session",
    bearer: "data:export",
    parameters: [workspaceId, exportId],
    responses: answers(
      { 200: { description: "The export file (`Content-Disposition: attachment`)." } },
      refusals(MEMBER_CHECK, {
        404: ["not_found"],
        410: ["expired"],
        503: ["exports_unavailable", "unavailable"],
      }),
    ),
  },
  {
    method: "post",
    path: "/workspaces/{workspaceId}/incidents/{incidentId}/postmortem/draft",
    operationId: "requestPostmortemDraft",
    tag: "Postmortems",
    summary: "Ask Workers AI to draft an incident's postmortem",
    description:
      "Responders and up (`incident:update`). Runs `postmortem.requestDraft` (RFC 0013): the draft is written by the " +
      "model in the background and arrives over Brigade Sync, in the status page's language when there is one, else " +
      "`locale`. `409 conflict`: a draft is being written, or the postmortem has text a member wrote; `429 " +
      "limit_reached`: too many drafts lately. `503 ai_unavailable`: the server has no Workers AI.",
    auth: "session",
    bearer: "incident:update",
    parameters: [workspaceId, incidentId],
    body: {
      type: "object",
      properties: { locale: toJsonSchema(v.picklist(STATUS_LOCALES)) },
    },
    responses: answers(
      {
        202: {
          description: "Asked; the draft follows over sync.",
          body: {
            type: "object",
            properties: { requestId: { type: "string", pattern: idPattern("drf") } },
            required: ["requestId"],
          },
        },
      },
      refusals(
        MEMBER_CHECK,
        { 401: ["unauthenticated"], 404: ["not_found"], 503: ["ai_unavailable", "unavailable"] },
        codesBy(DRAFT_STATUS),
      ),
    ),
  },
  {
    method: "get",
    path: "/sync/{workspaceId}",
    operationId: "openSync",
    tag: "Sync",
    summary: "Open a Brigade Sync WebSocket",
    description:
      "Monitors, schedules and the rest are read and changed over Brigade Sync (RFC 0004), not REST, and so are " +
      "incidents and the catalog live: this upgrade opens it, as the signed-in member. The frames are not modeled " +
      "here; see " +
      "`@freecorps/brigade-sync/protocol`.",
    auth: "session",
    bearer: "frames",
    parameters: [workspaceId],
    responses: answers(
      { 101: { description: "Switched to the WebSocket protocol." } },
      refusals(
        SIGNED_IN,
        { 400: ["invalid_workspace_id"], 403: ["not_a_member"], 426: ["upgrade_required"] },
        SHARD_FAILED,
      ),
    ),
  },
];

/** Every public operation, in the order the reference lists them. */
export const OPERATIONS: readonly Operation[] = LISTED.map((operation) =>
  operation.bearer === undefined
    ? operation
    : {
        ...operation,
        responses: bearerWording(
          withRefusals(
            operation.responses,
            // A socket's frames are refused on the socket, not by the upgrade.
            operation.bearer === "frames" ? { 429: BEARER[429] } : BEARER,
          ),
        ),
      },
);

/** `responses` with `REFUSED`'s wording swapped for `BEARER_REFUSED`'s, for an operation that takes a token. */
function bearerWording(responses: Record<number, Answer>): Record<number, Answer> {
  const out: Record<number, Answer> = { ...responses };
  for (const [key, description] of Object.entries(BEARER_REFUSED)) {
    const status = Number(key);
    const known = out[status];
    if (known?.description === REFUSED[status]) out[status] = { ...known, description };
  }
  return out;
}

/** `responses` with `errors` added: to the status's codes, or as a new refusal. */
function withRefusals(
  responses: Readonly<Record<number, Answer>>,
  errors: Record<number, readonly string[]>,
): Record<number, Answer> {
  const out: Record<number, Answer> = { ...responses };
  for (const [key, codes] of Object.entries(errors)) {
    const status = Number(key);
    const known = out[status];
    out[status] = known?.errors
      ? { ...known, errors: [...new Set([...known.errors, ...codes])] }
      : { description: REFUSED[status]!, errors: codes };
  }
  return out;
}

const SCHEMAS: Record<string, JsonSchema> = {
  WebhookSecret: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("whk") },
      secret: {
        type: "string",
        pattern: "^whsec_[A-Za-z0-9+/]{43}=$",
        description: "Standard Webhooks' format; shown this once.",
      },
    },
    required: ["id", "secret"],
  },
  WebhookHeader: {
    type: "object",
    description: "A custom header as Brigade shows it: never its value.",
    properties: {
      name: { type: "string" },
      hint: {
        type: ["string", "null"],
        description: "The value's last 4 characters, for a value of at least 16; else null.",
      },
    },
    required: ["name", "hint"],
  },
  Ok: {
    type: "object",
    properties: { ok: { const: true } },
    required: ["ok"],
  },
  Error: {
    type: "object",
    description: "Every refusal: a stable, machine-readable code.",
    properties: { error: { type: "string" } },
    required: ["error"],
  },
  Role: role,
  Workspace: {
    type: "object",
    properties: {
      id: { type: "string", pattern: WORKSPACE_ID_PATTERN },
      name: toJsonSchema(workspaceName),
    },
    required: ["id", "name"],
  },
  Invitation: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("inv") },
      email: { type: "string", format: "email" },
      role: ref("Role"),
      expiresAt: { type: "integer", description: "Epoch milliseconds." },
      createdAt: { type: "integer", description: "Epoch milliseconds." },
      invitedBy: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: ["string", "null"] } },
        required: ["id", "name"],
      },
    },
    required: ["id", "email", "role", "expiresAt", "createdAt", "invitedBy"],
  },
  InvitationPreview: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("inv") },
      workspace: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" } },
        required: ["id", "name"],
      },
      invitedBy: {
        type: ["string", "null"],
        description: "The inviter's name; null unless `forYou`.",
      },
      role: { anyOf: [ref("Role"), { type: "null" }], description: "Null unless `forYou`." },
      status: {
        type: "string",
        enum: ["pending", "accepted", "rejected", "canceled", "expired", "unknown"],
      },
      expiresAt: { type: "integer", description: "Epoch milliseconds." },
      forYou: { type: "boolean", description: "Whether it is for the signed-in address." },
    },
    required: ["id", "workspace", "invitedBy", "role", "status", "expiresAt", "forYou"],
  },
  FieldValue: {
    description:
      "A custom field's value: text or a link, a number, an option id (one choice) or option ids (several).",
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "array", items: { type: "string", pattern: idPattern("opt") } },
    ],
  },
  Incident: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("inc") },
      number: { type: ["integer", "null"], description: "`INC-<number>`'s number." },
      title: { type: "string" },
      severity: { type: "string", enum: [...SEVERITIES] },
      status: { type: "string", enum: [...INCIDENT_STATUSES] },
      declaredAt: { type: "integer", description: "Epoch milliseconds." },
      declaredBy: {
        type: "string",
        description: "A user id, an API token's `tok_` id, or a system actor's.",
      },
      acknowledgedAt: { type: ["integer", "null"], description: "Epoch milliseconds." },
      acknowledgedBy: { type: ["string", "null"] },
      typeId: {
        type: ["string", "null"],
        description: "Its incident type; null for none, or one deleted since.",
      },
      serviceIds: {
        type: "array",
        description: "The services it affects, in the order picked; deleted ones left out.",
        items: { type: "string", pattern: idPattern("svc") },
      },
      fields: {
        type: "object",
        description:
          "Custom field values by field id; fields deleted since, and options taken out, are left out.",
        additionalProperties: ref("FieldValue"),
      },
      roles: {
        type: "object",
        description: "Who holds each incident role (user ids), by role id.",
        additionalProperties: { type: "string" },
      },
      updatedAt: { type: "integer", description: "Epoch milliseconds." },
    },
    required: [
      "id",
      "number",
      "title",
      "severity",
      "status",
      "declaredAt",
      "declaredBy",
      "acknowledgedAt",
      "acknowledgedBy",
      "typeId",
      "serviceIds",
      "fields",
      "roles",
      "updatedAt",
    ],
  },
  Service: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("svc") },
      name: { type: "string" },
      description: { type: "string" },
      tier: { type: "string", enum: [...SERVICE_TIERS], description: "`tier1` the most critical." },
      owners: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["schedule", "member"] },
            id: { type: "string", description: "A schedule id or a member's user id." },
          },
          required: ["kind", "id"],
        },
      },
      escalationPolicyId: { type: ["string", "null"] },
      createdAt: { type: "integer", description: "Epoch milliseconds." },
      createdBy: { type: "string" },
      updatedAt: { type: "integer", description: "Epoch milliseconds." },
    },
    required: [
      "id",
      "name",
      "description",
      "tier",
      "owners",
      "escalationPolicyId",
      "createdAt",
      "createdBy",
      "updatedAt",
    ],
  },
  IncidentType: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("typ") },
      name: { type: "string" },
      description: { type: "string" },
      defaultSeverity: {
        anyOf: [{ type: "string", enum: [...SEVERITIES] }, { type: "null" }],
        description: "What a declare of this type takes when it names none.",
      },
      escalationPolicyId: {
        type: ["string", "null"],
        description: "The policy its pages use instead of the default one.",
      },
      requiredFields: {
        type: "array",
        items: { type: "string", pattern: idPattern("fld") },
      },
      roles: {
        type: "array",
        description: "The incident roles its incidents fill (role ids); empty: every role.",
        items: { type: "string" },
      },
      requiredRoles: { type: "array", items: { type: "string" } },
      createdAt: { type: "integer", description: "Epoch milliseconds." },
      createdBy: { type: "string" },
      updatedAt: { type: "integer", description: "Epoch milliseconds." },
    },
    required: [
      "id",
      "name",
      "description",
      "defaultSeverity",
      "escalationPolicyId",
      "requiredFields",
      "roles",
      "requiredRoles",
      "createdAt",
      "createdBy",
      "updatedAt",
    ],
  },
  CustomField: {
    type: "object",
    properties: {
      id: { type: "string", pattern: idPattern("fld") },
      name: { type: "string" },
      description: { type: "string" },
      kind: { type: "string", enum: [...FIELD_KINDS] },
      options: {
        type: "array",
        description: "Select fields only, in the order shown.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", pattern: idPattern("opt") },
            label: { type: "string" },
          },
          required: ["id", "label"],
        },
      },
      createdAt: { type: "integer", description: "Epoch milliseconds." },
      createdBy: { type: "string" },
      updatedAt: { type: "integer", description: "Epoch milliseconds." },
    },
    required: [
      "id",
      "name",
      "description",
      "kind",
      "options",
      "createdAt",
      "createdBy",
      "updatedAt",
    ],
  },
  PagingHealth: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["ok", "degraded", "unknown"],
        description: "`unknown` until the first beat is proved (a new deployment).",
      },
      reasons: {
        type: "array",
        description: "Members only.",
        items: {
          type: "string",
          enum: [
            "no_beat",
            "pipeline_stalled",
            "pipeline_slow",
            "relay_unauthorized",
            "relay_unreachable",
            "relay_not_configured",
          ],
        },
      },
      lastBeatAt: { type: ["string", "null"], format: "date-time", description: "Members only." },
      lastProvedAt: { type: ["string", "null"], format: "date-time", description: "Members only." },
      lastOkAt: { type: ["string", "null"], format: "date-time", description: "Members only." },
    },
    required: ["status"],
    additionalProperties: false,
  },
};

/** What each payload `type` reports, for the reference's `webhooks`. */
const WEBHOOK_SUMMARIES: Record<WebhookPayloadType, string> = {
  "incident.declared": "An incident was declared",
  "incident.status_changed": "An incident's status changed",
  "incident.severity_changed": "An incident's severity changed",
  "incident.acknowledged": "An incident was acknowledged",
  "incident.update_posted": "An update was posted to an incident",
  "incident.renamed": "An incident was renamed",
  "incident.update_edited": "Its author edited an update",
  "incident.update_deleted": "An update was removed",
  "incident.role_assigned": "An incident role was assigned or cleared",
  "alert.fired": "A monitor's alert fired",
  "alert.resolved": "A monitor's alert resolved",
  "monitor.status_changed": "A monitor's status changed",
  "escalation.paged": "An escalation level paged people",
  "webhook.test": 'Sent by "Send test event", to that endpoint only',
};

const WEBHOOK_HEADERS: readonly Parameter[] = [
  {
    name: "webhook-id",
    in: "header",
    description:
      "The event's id (`evt_<ULID>`), the payload's `id`: the same on every retry, so de-duplicate by it.",
    schema: { type: "string", pattern: idPattern("evt") },
  },
  {
    name: "webhook-timestamp",
    in: "header",
    description: "When this attempt was signed, Unix seconds. Refuse one more than 5 minutes off.",
    schema: { type: "string", pattern: "^[0-9]+$" },
  },
  {
    name: "webhook-signature",
    in: "header",
    description:
      "`v1,<base64 HMAC-SHA256>` of `<webhook-id>.<webhook-timestamp>.<body>` under each secret in use (two while " +
      "one is rotated), space separated. The key is the secret's bytes after `whsec_`, base64-decoded.",
    schema: { type: "string" },
  },
];

/** The reference's `webhooks`: one per payload `type`, the body from its validator. */
function webhooks(): Record<string, unknown> {
  return Object.fromEntries(
    (Object.keys(WEBHOOK_PAYLOADS) as WebhookPayloadType[]).map((type) => [
      type,
      {
        post: {
          // `incident.declared` → `incidentDeclaredWebhook`.
          operationId: `${type.replace(/[._](\w)/g, (_, letter: string) => letter.toUpperCase())}Webhook`,
          tags: ["Webhooks"],
          summary: WEBHOOK_SUMMARIES[type],
          parameters: WEBHOOK_HEADERS.map((parameter) => ({ ...parameter, required: true })),
          requestBody: {
            required: true,
            content: { "application/json": { schema: toJsonSchema(WEBHOOK_PAYLOADS[type]) } },
          },
          responses: {
            "2XX": { description: "Received. Anything else, or no answer in 5 s, is retried." },
          },
        },
      },
    ]),
  );
}

const DESCRIPTION = `Brigade's public HTTP API: what an integration may call. Incidents and the catalog (services,
incident types, custom fields) are read and changed here too, each write through the same named mutation the apps
send, with the same rules, timeline entries and events. Everything else (monitors, schedules, escalation policies,
devices) is read and changed over Brigade Sync, the WebSocket \`openSync\` opens (RFC 0004). Routes not listed here
are internal and may change without notice.

**Auth.** A Better Auth session: sign in with \`POST /api/auth/sign-in/email\` (\`{ "email", "password" }\`) and send
the cookie it sets. Writes that carry a cookie refuse another site's \`Origin\` (\`403 forbidden_origin\`); a request
without \`Origin\` is not refused for it. Operations marked with \`bearerAuth\` also take an API token (RFC 0014): an
owner or admin mints one in the dashboard for one workspace, with scopes, and sends it as \`Authorization: Bearer
brg_…\`. A token acts with its creator's role as it is now and only within its scopes (\`403 forbidden\` otherwise);
every refused token (wrong, revoked, expired, its creator gone) is the same \`401 unauthenticated\`; a token's requests
are limited (\`429 rate_limited\`, \`Retry-After\`). A bearer request skips the \`Origin\` check and ignores any cookie.

**Errors.** Every refusal is JSON, \`{ "error": "<code>" }\`, with the codes each operation lists. Any other method on
a listed path answers \`405\` with \`Allow\`; an unknown path \`404 not_found\`.

**Webhooks.** What Brigade sends to the endpoints a workspace registers: a signed \`POST\` per event, as the Standard
Webhooks specification has it (\`@freecorps/brigade-sdk\`'s \`verifyWebhook\`, or any of its libraries, verifies
it). Each payload is \`version: 1\`; fields may be added to it, so ignore the ones you do not know. A change that
is not purely additive is a new version. See RFC 0005 "Outbound webhooks".`;

/** The OpenAPI 3.1 document, as docs/api/openapi.json holds it. */
export function openApiDocument(): JsonSchema {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of OPERATIONS) {
    (paths[operation.path] ??= {})[operation.method] = toOperation(operation);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Brigade API",
      version: "0.3.0",
      description: DESCRIPTION,
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [
      {
        url: "https://brigade.example.com/api",
        description: "A Brigade deployment: the dashboard's origin, under /api.",
      },
    ],
    tags: [...new Set([...OPERATIONS.map((operation) => operation.tag), "Webhooks"])].map(
      (name) => ({
        name,
      }),
    ),
    paths,
    webhooks: webhooks(),
    components: {
      securitySchemes: {
        session: {
          type: "apiKey",
          in: "cookie",
          name: "__Secure-better-auth.session_token",
          description:
            "Better Auth's session cookie (without the `__Secure-` prefix over plain HTTP, as in local development).",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "brg_ and 43 base64url characters",
          description:
            "An API token for one workspace (RFC 0014), shown once when an owner or admin mints it. Each operation " +
            "names the scope it needs.",
        },
      },
      schemas: SCHEMAS,
    },
  };
}

function toOperation(operation: Operation): Record<string, unknown> {
  const security = { session: [] };
  const description = [
    operation.description,
    operation.bearer === "frames"
      ? "With an API token, each query and mutation needs its permission among the token's scopes."
      : typeof operation.bearer === "string"
        ? `With an API token: the \`${operation.bearer}\` scope.`
        : operation.bearer
          ? `With an API token: the ${operation.bearer.map((scope) => `\`${scope}\``).join(" and ")} scopes.`
          : undefined,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    operationId: operation.operationId,
    tags: [operation.tag],
    summary: operation.summary,
    ...(description ? { description } : {}),
    security:
      operation.auth === "session"
        ? operation.bearer
          ? [security, { bearerAuth: [] }]
          : [security]
        : operation.auth === "optional"
          ? [{}, security]
          : [],
    ...(operation.parameters
      ? {
          parameters: operation.parameters.map(({ required = true, explode, ...parameter }) => ({
            ...parameter,
            required,
            ...(explode === false ? { style: "form", explode } : {}),
          })),
        }
      : {}),
    ...(operation.body
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: operation.body } },
          },
        }
      : {}),
    responses: Object.fromEntries(
      Object.entries(operation.responses).map(([status, answer]) => [
        status,
        {
          description: answer.description,
          ...(answer.body || answer.errors
            ? { content: { "application/json": { schema: responseSchema(answer) } } }
            : {}),
        },
      ]),
    ),
  };
}

/** The schema of an answer's body: its own, or the error object with its codes. */
export function responseSchema(answer: Answer): JsonSchema | undefined {
  if (answer.body) return answer.body;
  if (!answer.errors) return undefined;
  return {
    type: "object",
    properties: { error: { type: "string", enum: [...answer.errors] } },
    required: ["error"],
  };
}

/** docs/api/openapi.json's exact text. */
export function openApiJson(): string {
  return `${JSON.stringify(openApiDocument(), null, 2)}\n`;
}
