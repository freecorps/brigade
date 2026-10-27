// A typed client for Brigade's public HTTP API (RFC 0002 "Public HTTP API", docs/api/openapi.json): the routes an
// integration may rely on, nothing else. Incidents and the catalog (services, incident types, custom fields) are read
// and changed here; monitors, schedules and the rest over Brigade Sync (`@freecorps/brigade-sync`). Request bodies are
// typed from the validators the API runs (`@freecorps/brigade-schema`); refusal codes are listed per operation below,
// and tests/client.test.ts holds them, the methods and the paths to the reference.

import type {
  CustomFieldCreateRequest,
  CustomFieldPatchRequest,
  DeclareRequest,
  IncidentPatch,
  IncidentStatus,
  IncidentTypeCreateRequest,
  IncidentTypePatchRequest,
  Infer,
  PublicCustomField,
  PublicIncident,
  PublicIncidentType,
  PublicService,
  Role,
  ServiceCreateRequest,
  ServicePatchRequest,
  Severity,
  StatusLocale,
  WebhookEventType,
  WebhookHeader,
  workspaceName,
} from "@freecorps/brigade-schema";

// ---- Answers -----------------------------------------------------------------------------------------------------

export type Ok = { ok: true };

/** A written update posted: its timeline entry (`<incident id>:<seq>`), to edit or remove it. */
export type UpdatePosted = { ok: true; entryId: string | null };

/** What an alert source took from a payload: how many alerts it held, and whether Brigade could not read it. */
export type AlertsAccepted = { ok: true; alerts: number; malformed?: boolean; tooLarge?: true };

export type Workspace = { id: string; name: Infer<typeof workspaceName> };

export type PagingHealthReason =
  | "no_beat"
  | "pipeline_stalled"
  | "pipeline_slow"
  | "relay_unauthorized"
  | "relay_unreachable"
  | "relay_not_configured";

/** `reasons` and the times only for a member of some workspace; `unknown` until a new deployment proves a beat. */
export type PagingHealth = {
  status: "ok" | "degraded" | "unknown";
  reasons?: PagingHealthReason[];
  /** ISO 8601. */
  lastBeatAt?: string | null;
  lastProvedAt?: string | null;
  lastOkAt?: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  role: Role;
  /** Epoch milliseconds. */
  expiresAt: number;
  createdAt: number;
  invitedBy: { id: string; name: string | null };
};

/** An invitation as its invitee sees it: who invited and the role only when it is for the signed-in address. */
export type InvitationPreview = {
  id: string;
  workspace: { id: string; name: string };
  invitedBy: string | null;
  role: Role | null;
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired" | "unknown";
  expiresAt: number;
  forYou: boolean;
};

/** An incident; times are epoch milliseconds. */
export type Incident = PublicIncident;
export type Service = PublicService;
export type IncidentType = PublicIncidentType;
export type CustomField = PublicCustomField;

/** Which incidents `listIncidents` answers; filters combine. */
export type IncidentFilter = {
  status?: readonly IncidentStatus[];
  severity?: readonly Severity[];
  typeId?: string;
  serviceId?: string;
  /** The `nextCursor` of the page before. */
  cursor?: string;
  /** 1 to 100; 50 by default. */
  limit?: number;
};

export type IncidentPage = { incidents: Incident[]; nextCursor: string | null };

/** A webhook endpoint's signing secret (`whsec_…`), answered once, when it is made. */
export type WebhookSecret = { id: string; secret: string };

/** A new endpoint: `id` (`whk_<ULID>`) is yours to make; at most 5 `headers`, sent on every delivery. */
export type WebhookCreateRequest = {
  id: string;
  url: string;
  description: string;
  events: WebhookEventType[];
  headers?: { name: string; value: string }[];
};

/** Every custom header of an endpoint; one without `value` keeps the value it has. */
export type WebhookHeadersRequest = { headers: { name: string; value?: string }[] };

export type { WebhookHeader };

export type StatusPageRequest = {
  /** `/status/<slug>`: 3 to 40 lowercase letters, digits and hyphens. */
  slug: string;
  title: string;
  locale: StatusLocale;
  enabled: boolean;
};

/** What `createExport` writes: one incident, or those declared from `from` to `to` (`YYYY-MM-DD`, UTC). */
export type ExportScope =
  | { kind: "incident"; incidentId: string }
  | { kind: "range"; from: string; to: string };

/** An export written; download it before `expiresAt` (epoch milliseconds). */
export type ExportCreated = { id: string; expiresAt: number; incidents: number; bytes: number };

/** An export file (`format: "brigade.export"`, RFC 0013): its incidents with their timelines and follow-ups. */
export type ExportFile = { format: string; incidents: unknown[]; [key: string]: unknown };

/** Options of the webhook writes. */
export type WebhookWriteOptions = {
  /**
   * 16 to 64 letters, digits, `_` or `-` (a UUID fits); a random one by default. Send the same again to retry after
   * a lost answer: the same request, the same secret answered, and a rotation never runs twice.
   */
  idempotencyKey?: string;
};

/** What every write of the incident and catalog routes takes. */
export type WriteOptions = {
  /**
   * 1 to 64 letters, digits, `_`, `:` or `-`; a random one by default. Send the same again with the same request to
   * retry after a lost answer (within 7 days): the request runs once, a create answers the same entry and a refusal
   * the same refusal. With another request it is refused (`idempotency_key_reused`): use a new key for each request.
   */
  idempotencyKey?: string;
};

// ---- Refusals ----------------------------------------------------------------------------------------------------

const SIGNED_IN = ["unauthenticated", "forbidden_origin"] as const;
const SHARD_FAILED = ["internal", "unavailable"] as const;
/** What an API token adds where the reference marks `bearerAuth` (RFC 0014): its scopes, and its rate limit. */
const BEARER = ["forbidden", "rate_limited"] as const;
const MEMBER = [
  ...SIGNED_IN,
  "invalid_workspace_id",
  "not_a_member",
  "not_found",
  "forbidden",
  "last_owner",
  "conflict",
  "not_applied",
  "rate_limited",
  ...SHARD_FAILED,
  ...BEARER,
] as const;
const INVITATION = [
  "forbidden",
  "wrong_email",
  "unverified",
  "already_member",
  "already_invited",
  "limit_reached",
  "workspace_full",
  "workspace_limit",
  "conflict",
  "rate_limited",
  "address_limited",
  "inviter_limited",
  "send_limit",
  "too_soon",
  "not_found",
  "expired",
  "unavailable",
  "not_applied",
] as const;

/** The incident and catalog reads. */
const REST_READ = [
  ...SIGNED_IN,
  "invalid_workspace_id",
  "not_a_member",
  "forbidden",
  "not_found",
  ...SHARD_FAILED,
  ...BEARER,
] as const;
/**
 * And their writes: a body or key the route refuses (`body.issues` says what), and an `idempotencyKey` already sent
 * with another request (422).
 */
const REST_WRITE = [...REST_READ, "invalid_args", "idempotency_key_reused"] as const;

/** The dashboard's routes that check the member (or token) themselves before the shard. */
const MEMBER_CHECK = [
  ...SIGNED_IN,
  "invalid_workspace_id",
  "not_a_member",
  "unavailable",
  ...BEARER,
] as const;
const WEBHOOK_WRITE = [
  ...MEMBER_CHECK,
  "invalid_args",
  "invalid_idempotency_key",
  "not_found",
  "not_configured",
  "forbidden",
  "conflict",
  "limit_reached",
  "internal",
] as const;

/** The `error` codes each operation answers with, as the reference lists them. */
export const OPERATION_ERRORS = {
  getHealth: [],
  getPagingHealth: ["unavailable"],
  pingHeartbeat: ["not_found", ...SHARD_FAILED],
  sendAlerts: ["not_found", ...SHARD_FAILED],
  createWorkspace: [...SIGNED_IN, "invalid_args", "workspace_limit", "internal"],
  changeMemberRole: [...MEMBER, "invalid_args"],
  removeMember: MEMBER,
  listInvitations: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "not_a_member",
    "forbidden",
    "unavailable",
    ...BEARER,
  ],
  invite: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "invalid_args",
    "not_a_member",
    ...INVITATION,
    "internal",
    ...BEARER,
  ],
  revokeInvitation: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "not_a_member",
    ...INVITATION,
    "internal",
    ...BEARER,
  ],
  resendInvitation: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "not_a_member",
    ...INVITATION,
    "internal",
    ...BEARER,
  ],
  getInvitation: [...SIGNED_IN, "not_found", "unavailable"],
  acceptInvitation: [...SIGNED_IN, ...INVITATION, "internal"],
  declineInvitation: [...SIGNED_IN, ...INVITATION, "internal"],
  acknowledgeIncident: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "invalid_args",
    "not_a_member",
    "not_found",
    "conflict",
    "invalid_transition",
    "forbidden",
    ...SHARD_FAILED,
    ...BEARER,
  ],
  listIncidents: [...REST_READ, "invalid_args"],
  declareIncident: REST_WRITE,
  getIncident: REST_READ,
  updateIncident: [...REST_WRITE, "invalid_transition"],
  postIncidentUpdate: REST_WRITE,
  editIncidentUpdate: [...REST_WRITE, "conflict"],
  deleteIncidentUpdate: [...REST_WRITE, "conflict"],
  listServices: REST_READ,
  createService: [...REST_WRITE, "limit_reached"],
  getService: REST_READ,
  updateService: REST_WRITE,
  deleteService: REST_WRITE,
  listIncidentTypes: REST_READ,
  createIncidentType: [...REST_WRITE, "limit_reached"],
  getIncidentType: REST_READ,
  updateIncidentType: REST_WRITE,
  listCustomFields: REST_READ,
  createCustomField: [...REST_WRITE, "limit_reached"],
  getCustomField: REST_READ,
  updateCustomField: REST_WRITE,
  createWebhook: WEBHOOK_WRITE,
  rotateWebhookSecret: WEBHOOK_WRITE,
  setWebhookHeaders: WEBHOOK_WRITE,
  configureStatusPage: [
    ...MEMBER_CHECK,
    "invalid_args",
    "forbidden",
    "slug_taken",
    "not_found",
    "not_applied",
    "internal",
  ],
  createExport: [
    ...MEMBER_CHECK,
    "invalid_args",
    "forbidden",
    "not_found",
    "limit_reached",
    "too_large",
    "exports_unavailable",
    "internal",
  ],
  downloadExport: [...MEMBER_CHECK, "not_found", "expired", "exports_unavailable"],
  requestPostmortemDraft: [
    ...MEMBER_CHECK,
    "invalid_args",
    "forbidden",
    "not_found",
    "conflict",
    "limit_reached",
    "ai_unavailable",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Operation = keyof typeof OPERATION_ERRORS;

/**
 * An `error` code `operation` documents, or `unexpected`: an answer outside the reference (a proxy's error page, a
 * `405`, a redirect, a 2xx that is no JSON, a code added to the API since).
 */
export type ApiErrorCode<Op extends Operation = Operation> =
  | (typeof OPERATION_ERRORS)[Op][number]
  | "unexpected";

/** A refusal from the API: the HTTP status and its `error` code. Network failures are `fetch`'s own errors. */
export class BrigadeApiError<Op extends Operation = Operation> extends Error {
  override readonly name = "BrigadeApiError";
  readonly operation: Op;
  readonly status: number;
  readonly code: ApiErrorCode<Op>;
  /** The answer's JSON, when it had some: `issues` for an `invalid_args`, `workspaceId` for a `not_applied`. */
  readonly body: unknown;

  constructor(operation: Op, status: number, code: ApiErrorCode<Op>, body: unknown) {
    super(`${operation} answered ${status} ${code}`);
    this.operation = operation;
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Whether `error` is the API refusing `operation` (any operation without one): narrows `code` to its codes. */
export function isBrigadeApiError<Op extends Operation = Operation>(
  error: unknown,
  operation?: Op,
): error is BrigadeApiError<Op> {
  return (
    error instanceof BrigadeApiError && (operation === undefined || error.operation === operation)
  );
}

// ---- Client ------------------------------------------------------------------------------------------------------

type Awaitable<T> = T | Promise<T>;

export type ClientOptions = {
  /** Where the API answers: the dashboard's origin under `/api`, e.g. `https://brigade.example.com/api`. */
  baseUrl: string;
  /** Default `globalThis.fetch`. */
  fetch?: (request: Request) => Promise<Response>;
  /**
   * A Better Auth session cookie (`name=value`), sent as `Cookie`. For servers only: a browser never sends a `Cookie`
   * header a script set, and sends its own instead (see `credentials`).
   */
  cookie?: string;
  /**
   * An API token (`brg_…`, RFC 0014), sent as `Authorization: Bearer`: minted by a workspace's owner or admin in the
   * dashboard, for that workspace, with scopes. The operations the reference marks `bearerAuth` take it; with it, the
   * API ignores any cookie. Keep it out of browsers and logs.
   */
  token?: string;
  /**
   * Whether a browser sends its own cookies: `fetch`'s `credentials`, default `same-origin`. `include` for a page on
   * another origin than the API (which must then allow that origin). Ignored outside browsers.
   */
  credentials?: RequestCredentials;
  /** Headers for every request, made per request: anything a proxy in front of Brigade needs. */
  headers?: () => Awaitable<Record<string, string>>;
};

export type BrigadeClient = ReturnType<typeof createClient>;

/** The rejection, before any request, for an argument that cannot be sent (an id that is empty, `.` or `..`). */
export class BrigadeArgumentError extends TypeError {
  override readonly name = "BrigadeArgumentError";
  readonly code = "invalid_argument";
}

/**
 * One path segment. Empty, `.` and `..` are refused: a URL parser would drop or climb them (`..` in place of an
 * incident id would send the ack to another route), and encoding leaves them as they are.
 */
function segment(value: string): string {
  if (typeof value !== "string" || value === "" || value === "." || value === "..") {
    throw new BrigadeArgumentError(`Expected an id, got ${JSON.stringify(value)}`);
  }
  return encodeURIComponent(value);
}

/**
 * A client for one Brigade deployment. Every method resolves with the documented success and rejects with a
 * `BrigadeApiError` for any other answer (redirects are not followed: they are `unexpected`), or a
 * `BrigadeArgumentError`, before sending anything, for an id it cannot send.
 */
export function createClient(options: ClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const send = options.fetch ?? ((request: Request) => globalThis.fetch(request));

  async function call<T, Op extends Operation>(
    operation: Op,
    method: string,
    // A function when it holds ids: `segment` may refuse one, and that is a rejection like any other.
    path: string | (() => string),
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const url = `${base}${typeof path === "function" ? path() : path}`;
    const headers = new Headers(await options.headers?.());
    headers.set("Accept", "application/json");
    if (options.cookie !== undefined) headers.set("Cookie", options.cookie);
    if (options.token !== undefined) headers.set("Authorization", `Bearer ${options.token}`);
    for (const [name, value] of Object.entries(init.headers ?? {})) headers.set(name, value);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await send(
      new Request(url, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        // A redirect would carry the cookie and the token headers elsewhere: an answer of its own, never followed.
        redirect: "manual",
        ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
      }),
    );
    const text = await response.text();
    let body: unknown;
    let json = true;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
      json = false;
    }
    // Every success the API documents is a JSON object: anything else is not the API answering (a captive portal, a
    // proxy's page).
    if (response.ok && json && typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as T;
    }
    if (response.ok) {
      throw new BrigadeApiError(operation, response.status, "unexpected" as ApiErrorCode<Op>, body);
    }
    const code =
      typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    const known = (OPERATION_ERRORS[operation] as readonly unknown[]).includes(code);
    throw new BrigadeApiError(
      operation,
      response.status,
      (known ? code : "unexpected") as ApiErrorCode<Op>,
      body,
    );
  }

  /** The `Idempotency-Key` header of a write. */
  const keyed = (options: WriteOptions) => ({
    "Idempotency-Key": options.idempotencyKey ?? crypto.randomUUID(),
  });
  const ws = (workspaceId: string) => `/workspaces/${segment(workspaceId)}`;
  /** The optional `Idempotency-Key` of a webhook write. */
  const webhookKeyed = (options: WebhookWriteOptions) => ({
    "Idempotency-Key": options.idempotencyKey ?? crypto.randomUUID(),
  });

  return {
    /** `GET /health`: whether the API answers. */
    getHealth: () => call<Ok, "getHealth">("getHealth", "GET", "/health"),

    /** `GET /health/paging`: whether pages are going out; members also get the reasons and times. */
    getPagingHealth: () =>
      call<PagingHealth, "getPagingHealth">("getPagingHealth", "GET", "/health/paging"),

    /**
     * `POST /heartbeat/:token`: pings a heartbeat monitor. `token` is the heartbeat URL's last segment
     * (`<workspaceId>.<monitorId>.<secret>`); no session needed. A wrong token is `not_found`, like a missing monitor.
     */
    pingHeartbeat: (token: string) =>
      call<Ok, "pingHeartbeat">("pingHeartbeat", "POST", () => `/heartbeat/${segment(token)}`),

    /**
     * `POST /alerts/:token`: sends `payload` to an alert source, as JSON; for a generic source,
     * `{ "title", "dedup_key", "severity", "status", "link", "labels" }` or `{ "alerts": [...] }`. `token` is the
     * source URL's last segment; no session needed. A wrong token is `not_found`; `unavailable` (over a rate limit
     * too) is worth retrying.
     */
    sendAlerts: (token: string, payload: unknown) =>
      call<AlertsAccepted, "sendAlerts">("sendAlerts", "POST", () => `/alerts/${segment(token)}`, {
        body: payload,
      }),

    /** `POST /workspaces`: the signed-in user becomes its owner. */
    createWorkspace: (body: { name: Infer<typeof workspaceName> }) =>
      call<Workspace, "createWorkspace">("createWorkspace", "POST", "/workspaces", { body }),

    /** `PATCH /workspaces/:id/members/:userId`. */
    changeMemberRole: (workspaceId: string, userId: string, body: { role: Role }) =>
      call<Ok, "changeMemberRole">(
        "changeMemberRole",
        "PATCH",
        () => `/workspaces/${segment(workspaceId)}/members/${segment(userId)}`,
        { body },
      ),

    /** `DELETE /workspaces/:id/members/:userId`: removes a member, or with your own id, leaves. */
    removeMember: (workspaceId: string, userId: string) =>
      call<Ok, "removeMember">(
        "removeMember",
        "DELETE",
        () => `/workspaces/${segment(workspaceId)}/members/${segment(userId)}`,
      ),

    /** `GET /workspaces/:id/invitations`: pending invitations, newest first. */
    listInvitations: (workspaceId: string) =>
      call<{ invitations: Invitation[] }, "listInvitations">(
        "listInvitations",
        "GET",
        () => `/workspaces/${segment(workspaceId)}/invitations`,
      ),

    /** `POST /workspaces/:id/invitations`: Brigade emails the invitation. */
    invite: (workspaceId: string, body: { email: string; role: Role }) =>
      call<{ ok: true; invitation: Invitation }, "invite">(
        "invite",
        "POST",
        () => `/workspaces/${segment(workspaceId)}/invitations`,
        { body },
      ),

    /** `DELETE /workspaces/:id/invitations/:invitationId`. */
    revokeInvitation: (workspaceId: string, invitationId: string) =>
      call<Ok, "revokeInvitation">(
        "revokeInvitation",
        "DELETE",
        () => `/workspaces/${segment(workspaceId)}/invitations/${segment(invitationId)}`,
      ),

    /** `POST /workspaces/:id/invitations/:invitationId/resend`: again, with a new expiry. */
    resendInvitation: (workspaceId: string, invitationId: string) =>
      call<Ok, "resendInvitation">(
        "resendInvitation",
        "POST",
        () => `/workspaces/${segment(workspaceId)}/invitations/${segment(invitationId)}/resend`,
      ),

    /** `GET /invitations/:id`: the invitation as its invitee sees it. */
    getInvitation: (invitationId: string) =>
      call<{ invitation: InvitationPreview }, "getInvitation">(
        "getInvitation",
        "GET",
        () => `/invitations/${segment(invitationId)}`,
      ),

    /** `POST /invitations/:id/accept`. */
    acceptInvitation: (invitationId: string) =>
      call<{ ok: true; role: Role; workspaceId: string }, "acceptInvitation">(
        "acceptInvitation",
        "POST",
        () => `/invitations/${segment(invitationId)}/accept`,
      ),

    /** `POST /invitations/:id/decline`. */
    declineInvitation: (invitationId: string) =>
      call<Ok, "declineInvitation">(
        "declineInvitation",
        "POST",
        () => `/invitations/${segment(invitationId)}/decline`,
      ),

    /**
     * `POST /workspaces/:id/incidents/:incidentId/ack`, as the signed-in member. `idempotencyKey` (1 to 64 letters,
     * digits, `_`, `:` or `-`; a random one by default): send the same again to retry after a lost answer, and the ack
     * runs once.
     */
    acknowledgeIncident: (
      workspaceId: string,
      incidentId: string,
      options: { idempotencyKey?: string } = {},
    ) =>
      call<Ok, "acknowledgeIncident">(
        "acknowledgeIncident",
        "POST",
        () => `/workspaces/${segment(workspaceId)}/incidents/${segment(incidentId)}/ack`,
        { headers: { "Idempotency-Key": options.idempotencyKey ?? crypto.randomUUID() } },
      ),

    /**
     * `GET /workspaces/:id/incidents`: one page, newest first. Pass `nextCursor` back as `cursor` for the next one;
     * it is null on the last. A request reads at most 1000 incidents, so a narrow filter may answer a short or empty
     * page with a `nextCursor`: follow it until it is null.
     */
    listIncidents: (workspaceId: string, filter: IncidentFilter = {}) =>
      call<IncidentPage, "listIncidents">("listIncidents", "GET", () => {
        const query = new URLSearchParams();
        if (filter.status?.length) query.set("status", filter.status.join(","));
        if (filter.severity?.length) query.set("severity", filter.severity.join(","));
        if (filter.typeId !== undefined) query.set("typeId", filter.typeId);
        if (filter.serviceId !== undefined) query.set("serviceId", filter.serviceId);
        if (filter.cursor !== undefined) query.set("cursor", filter.cursor);
        if (filter.limit !== undefined) query.set("limit", String(filter.limit));
        const search = query.toString();
        return `${ws(workspaceId)}/incidents${search ? `?${search}` : ""}`;
      }),

    /**
     * `POST /workspaces/:id/incidents`: declares an incident, paged by the escalation policy as a declare in the app
     * is. The severity defaults to the type's, else `sev3`.
     */
    declareIncident: (workspaceId: string, body: DeclareRequest, options: WriteOptions = {}) =>
      call<{ incident: Incident }, "declareIncident">(
        "declareIncident",
        "POST",
        () => `${ws(workspaceId)}/incidents`,
        { body, headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/incidents/:incidentId`. */
    getIncident: (workspaceId: string, incidentId: string) =>
      call<{ incident: Incident }, "getIncident">(
        "getIncident",
        "GET",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}`,
      ),

    /**
     * `PATCH /workspaces/:id/incidents/:incidentId`: title, type, services, custom fields (`null` clears one), roles
     * (a user id by role id, `null` leaves one empty), severity, status, each changed in that order; the first refusal
     * stops the rest (those before it stay made). The same key
     * answers the same refusal again: once fixed, retry with a new key (the changes made come back as no change).
     * With an API token, needs `incident:read` as well as `incident:update`, since it answers the incident.
     */
    updateIncident: (
      workspaceId: string,
      incidentId: string,
      body: IncidentPatch,
      options: WriteOptions = {},
    ) =>
      call<{ incident: Incident }, "updateIncident">(
        "updateIncident",
        "PATCH",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}`,
        { body, headers: keyed(options) },
      ),

    /**
     * `POST /workspaces/:id/incidents/:incidentId/updates`: a written update on the incident's timeline. `entryId`
     * names it, to edit or remove it.
     */
    postIncidentUpdate: (
      workspaceId: string,
      incidentId: string,
      body: { body: string },
      options: WriteOptions = {},
    ) =>
      call<UpdatePosted, "postIncidentUpdate">(
        "postIncidentUpdate",
        "POST",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}/updates`,
        { body, headers: keyed(options) },
      ),

    /**
     * `PATCH /workspaces/:id/incidents/:incidentId/updates/:entryId`: new text for a written update, by its author
     * only (an API token that posted it, or whose creator did); text it already has changes nothing.
     */
    editIncidentUpdate: (
      workspaceId: string,
      incidentId: string,
      entryId: string,
      body: { body: string },
      options: WriteOptions = {},
    ) =>
      call<Ok, "editIncidentUpdate">(
        "editIncidentUpdate",
        "PATCH",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}/updates/${segment(entryId)}`,
        { body, headers: keyed(options) },
      ),

    /**
     * `DELETE /workspaces/:id/incidents/:incidentId/updates/:entryId`: removes a written update (its author, or an
     * owner or admin); its entry stays as "removed by …".
     */
    deleteIncidentUpdate: (
      workspaceId: string,
      incidentId: string,
      entryId: string,
      options: WriteOptions = {},
    ) =>
      call<Ok, "deleteIncidentUpdate">(
        "deleteIncidentUpdate",
        "DELETE",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}/updates/${segment(entryId)}`,
        { headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/services`: the most critical tier first, then by name. */
    listServices: (workspaceId: string) =>
      call<{ services: Service[] }, "listServices">(
        "listServices",
        "GET",
        () => `${ws(workspaceId)}/services`,
      ),

    /** `POST /workspaces/:id/services`. */
    createService: (workspaceId: string, body: ServiceCreateRequest, options: WriteOptions = {}) =>
      call<{ service: Service }, "createService">(
        "createService",
        "POST",
        () => `${ws(workspaceId)}/services`,
        { body, headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/services/:serviceId`. */
    getService: (workspaceId: string, serviceId: string) =>
      call<{ service: Service }, "getService">(
        "getService",
        "GET",
        () => `${ws(workspaceId)}/services/${segment(serviceId)}`,
      ),

    /** `PATCH /workspaces/:id/services/:serviceId`: what is sent changes; the rest stays. */
    updateService: (
      workspaceId: string,
      serviceId: string,
      body: ServicePatchRequest,
      options: WriteOptions = {},
    ) =>
      call<{ service: Service }, "updateService">(
        "updateService",
        "PATCH",
        () => `${ws(workspaceId)}/services/${segment(serviceId)}`,
        { body, headers: keyed(options) },
      ),

    /** `DELETE /workspaces/:id/services/:serviceId`: removes it from the catalog. */
    deleteService: (workspaceId: string, serviceId: string, options: WriteOptions = {}) =>
      call<Ok, "deleteService">(
        "deleteService",
        "DELETE",
        () => `${ws(workspaceId)}/services/${segment(serviceId)}`,
        { headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/incident-types`: by name. */
    listIncidentTypes: (workspaceId: string) =>
      call<{ incidentTypes: IncidentType[] }, "listIncidentTypes">(
        "listIncidentTypes",
        "GET",
        () => `${ws(workspaceId)}/incident-types`,
      ),

    /** `POST /workspaces/:id/incident-types`. */
    createIncidentType: (
      workspaceId: string,
      body: IncidentTypeCreateRequest,
      options: WriteOptions = {},
    ) =>
      call<{ incidentType: IncidentType }, "createIncidentType">(
        "createIncidentType",
        "POST",
        () => `${ws(workspaceId)}/incident-types`,
        { body, headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/incident-types/:typeId`. */
    getIncidentType: (workspaceId: string, typeId: string) =>
      call<{ incidentType: IncidentType }, "getIncidentType">(
        "getIncidentType",
        "GET",
        () => `${ws(workspaceId)}/incident-types/${segment(typeId)}`,
      ),

    /** `PATCH /workspaces/:id/incident-types/:typeId`: what is sent changes; the rest stays. */
    updateIncidentType: (
      workspaceId: string,
      typeId: string,
      body: IncidentTypePatchRequest,
      options: WriteOptions = {},
    ) =>
      call<{ incidentType: IncidentType }, "updateIncidentType">(
        "updateIncidentType",
        "PATCH",
        () => `${ws(workspaceId)}/incident-types/${segment(typeId)}`,
        { body, headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/custom-fields`: in the order they were made. */
    listCustomFields: (workspaceId: string) =>
      call<{ customFields: CustomField[] }, "listCustomFields">(
        "listCustomFields",
        "GET",
        () => `${ws(workspaceId)}/custom-fields`,
      ),

    /** `POST /workspaces/:id/custom-fields`: options as labels; Brigade gives each its id. */
    createCustomField: (
      workspaceId: string,
      body: CustomFieldCreateRequest,
      options: WriteOptions = {},
    ) =>
      call<{ customField: CustomField }, "createCustomField">(
        "createCustomField",
        "POST",
        () => `${ws(workspaceId)}/custom-fields`,
        { body, headers: keyed(options) },
      ),

    /** `GET /workspaces/:id/custom-fields/:fieldId`. */
    getCustomField: (workspaceId: string, fieldId: string) =>
      call<{ customField: CustomField }, "getCustomField">(
        "getCustomField",
        "GET",
        () => `${ws(workspaceId)}/custom-fields/${segment(fieldId)}`,
      ),

    /**
     * `PATCH /workspaces/:id/custom-fields/:fieldId`: its name, description or options (the list sent replaces the
     * old one: keep an option by sending its id). Its kind never changes.
     */
    updateCustomField: (
      workspaceId: string,
      fieldId: string,
      body: CustomFieldPatchRequest,
      options: WriteOptions = {},
    ) =>
      call<{ customField: CustomField }, "updateCustomField">(
        "updateCustomField",
        "PATCH",
        () => `${ws(workspaceId)}/custom-fields/${segment(fieldId)}`,
        { body, headers: keyed(options) },
      ),

    /**
     * `POST /workspaces/:id/webhooks`: an outbound webhook endpoint, and its signing secret, answered this once.
     * Header values are sealed and never shown back.
     */
    createWebhook: (
      workspaceId: string,
      body: WebhookCreateRequest,
      options: WebhookWriteOptions = {},
    ) =>
      call<WebhookSecret, "createWebhook">(
        "createWebhook",
        "POST",
        () => `${ws(workspaceId)}/webhooks`,
        { body, headers: webhookKeyed(options) },
      ),

    /** `POST /workspaces/:id/webhooks/:webhookId/rotate`: a new secret; the old one signs too for 24 hours. */
    rotateWebhookSecret: (
      workspaceId: string,
      webhookId: string,
      options: WebhookWriteOptions = {},
    ) =>
      call<WebhookSecret, "rotateWebhookSecret">(
        "rotateWebhookSecret",
        "POST",
        () => `${ws(workspaceId)}/webhooks/${segment(webhookId)}/rotate`,
        { headers: webhookKeyed(options) },
      ),

    /** `PUT /workspaces/:id/webhooks/:webhookId/headers`: every custom header; answers names and hints only. */
    setWebhookHeaders: (
      workspaceId: string,
      webhookId: string,
      body: WebhookHeadersRequest,
      options: WebhookWriteOptions = {},
    ) =>
      call<{ id: string; headers: WebhookHeader[] }, "setWebhookHeaders">(
        "setWebhookHeaders",
        "PUT",
        () => `${ws(workspaceId)}/webhooks/${segment(webhookId)}/headers`,
        { body, headers: webhookKeyed(options) },
      ),

    /** `PUT /workspaces/:id/status-page`: sets up or changes the public status page. */
    configureStatusPage: (workspaceId: string, body: StatusPageRequest) =>
      call<Ok, "configureStatusPage">(
        "configureStatusPage",
        "PUT",
        () => `${ws(workspaceId)}/status-page`,
        { body },
      ),

    /** `POST /workspaces/:id/exports`: writes the file, kept 24 hours. */
    createExport: (workspaceId: string, body: { scope: ExportScope }) =>
      call<ExportCreated, "createExport">(
        "createExport",
        "POST",
        () => `${ws(workspaceId)}/exports`,
        {
          body,
        },
      ),

    /** `GET /workspaces/:id/exports/:exportId`: the file, parsed. */
    downloadExport: (workspaceId: string, exportId: string) =>
      call<ExportFile, "downloadExport">(
        "downloadExport",
        "GET",
        () => `${ws(workspaceId)}/exports/${segment(exportId)}`,
      ),

    /** `POST /workspaces/:id/incidents/:incidentId/postmortem/draft`: the draft follows over Brigade Sync. */
    requestPostmortemDraft: (
      workspaceId: string,
      incidentId: string,
      body: { locale?: StatusLocale } = {},
    ) =>
      call<{ requestId: string }, "requestPostmortemDraft">(
        "requestPostmortemDraft",
        "POST",
        () => `${ws(workspaceId)}/incidents/${segment(incidentId)}/postmortem/draft`,
        { body },
      ),
  };
}
