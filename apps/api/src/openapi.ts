// The OpenAPI 3.1 reference of the API's public HTTP routes (RFC 0002 "Public HTTP API"), and of the outbound webhooks'
// payloads (`webhooks`, RFC 0005 "Outbound webhooks"). Request bodies and payloads are made from the validators the
// routes and receivers run (`@freecorps/brigade-schema`, `toJsonSchema`), refusal codes from the status maps the routes
// answer with (src/http.ts); the routes, their auth and their answers are listed by hand below.
// `vp run --filter @freecorps/brigade-api openapi` writes it to docs/api/openapi.json; test/openapi.test.ts fails when
// that file is stale, and calls each operation to check it answers as documented.
//
// Imports nothing that needs the Workers runtime, so the generator runs in Node.

import {
  idPattern,
  INVITATION_EMAIL_MAX,
  ROLES,
  toJsonSchema,
  v,
  WEBHOOK_PAYLOADS,
  workspaceName,
  type JsonSchema,
  type WebhookPayloadType,
} from "@freecorps/brigade-schema";
import { ACK_STATUS, INVITATION_STATUS, MEMBER_STATUS, USER_ID } from "./http.ts";

/** The workspace id the D1-backed routes take (`ORGANIZATION_ID` in src/workspace.ts; the test checks they agree). */
export const WORKSPACE_ID_PATTERN = "^ws_[0-9A-HJKMNP-TV-Z]{26}$";
/** The idempotency key an ack takes (`TOKEN` in packages/sync's protocol; the test checks they agree). */
export const IDEMPOTENCY_KEY_PATTERN = "^[\\w:-]{1,64}$";

type Method = "get" | "post" | "patch" | "delete";

type Parameter = {
  name: string;
  in: "path" | "header";
  description: string;
  schema: JsonSchema;
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
  tag: "Health" | "Monitors" | "Workspaces" | "Members" | "Invitations" | "Incidents" | "Sync";
  summary: string;
  description?: string;
  /** `session`: the Better Auth session cookie; `optional`: answers more with one; `none`: no auth. */
  auth: "session" | "optional" | "none";
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

const role = toJsonSchema(v.picklist(ROLES));
const OK_200 = { 200: { description: "Done.", body: ref("Ok") } };

const MEMBER_REFUSALS = refusals(
  SIGNED_IN,
  { 400: ["invalid_workspace_id"], 403: ["not_a_member"], 404: ["not_found"] },
  codesBy(MEMBER_STATUS),
  SHARD_FAILED,
);
const INVITATION_REFUSALS = codesBy(INVITATION_STATUS);

/** Every public operation, in the order the reference lists them. */
export const OPERATIONS: readonly Operation[] = [
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
    path: "/sync/{workspaceId}",
    operationId: "openSync",
    tag: "Sync",
    summary: "Open a Brigade Sync WebSocket",
    description:
      "Incidents, monitors, schedules and the rest are read and changed over Brigade Sync (RFC 0004), not REST: " +
      "this upgrade opens it, as the signed-in member. The frames are not modeled here; see " +
      "`@freecorps/brigade-sync/protocol`.",
    auth: "session",
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

const SCHEMAS: Record<string, JsonSchema> = {
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

const DESCRIPTION = `Brigade's public HTTP API: what an integration may call. Everything else (incidents, monitors,
schedules, escalation policies, devices) is read and changed over Brigade Sync, the WebSocket \`openSync\` opens
(RFC 0004). Routes not listed here are internal and may change without notice.

**Auth.** A Better Auth session: sign in with \`POST /api/auth/sign-in/email\` (\`{ "email", "password" }\`) and send
the cookie it sets. Writes that carry a cookie refuse another site's \`Origin\` (\`403 forbidden_origin\`); a request
without \`Origin\` is not refused for it. API tokens do not exist yet (see RFC 0002 "Public HTTP API").

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
      version: "0.1.0",
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
      },
      schemas: SCHEMAS,
    },
  };
}

function toOperation(operation: Operation): Record<string, unknown> {
  const security = { session: [] };
  return {
    operationId: operation.operationId,
    tags: [operation.tag],
    summary: operation.summary,
    ...(operation.description ? { description: operation.description } : {}),
    security:
      operation.auth === "session"
        ? [security]
        : operation.auth === "optional"
          ? [{}, security]
          : [],
    ...(operation.parameters
      ? {
          parameters: operation.parameters.map((parameter) => ({ ...parameter, required: true })),
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
