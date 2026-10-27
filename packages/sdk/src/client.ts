// A typed client for Brigade's public HTTP API (RFC 0002 "Public HTTP API", docs/api/openapi.json): the routes an
// integration may rely on, nothing else. Incidents, monitors and the rest are read and changed over Brigade Sync
// (`@freecorps/brigade-sync`), not here. Request bodies are typed from the validators the API runs
// (`@freecorps/brigade-schema`); refusal codes are listed per operation below, and tests/client.test.ts holds them,
// the methods and the paths to the reference.

import type { Infer, Role, workspaceName } from "@freecorps/brigade-schema";

// ---- Answers -----------------------------------------------------------------------------------------------------

export type Ok = { ok: true };

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

// ---- Refusals ----------------------------------------------------------------------------------------------------

const SIGNED_IN = ["unauthenticated", "forbidden_origin"] as const;
const SHARD_FAILED = ["internal", "unavailable"] as const;
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
  ],
  invite: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "invalid_args",
    "not_a_member",
    ...INVITATION,
    "internal",
  ],
  revokeInvitation: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "not_a_member",
    ...INVITATION,
    "internal",
  ],
  resendInvitation: [
    ...SIGNED_IN,
    "invalid_workspace_id",
    "not_a_member",
    ...INVITATION,
    "internal",
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
   * Whether a browser sends its own cookies: `fetch`'s `credentials`, default `same-origin`. `include` for a page on
   * another origin than the API (which must then allow that origin). Ignored outside browsers.
   */
  credentials?: RequestCredentials;
  /**
   * Headers for every request, made per request: where an API token will go once the API has them (RFC 0002
   * "Public HTTP API"), and anything a proxy in front of Brigade needs.
   */
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
  };
}
