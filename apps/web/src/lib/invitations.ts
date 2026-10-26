// Invitations and email verification for the dashboard (RFC 0003 "Invitations", RFC 0002 "Auth"): the API's
// `/workspaces/:id/invitations` and `/invitations/:id` behind the web Worker's `/api`, Better Auth's
// `send-verification-email` and `verify-email`, and the pure checks the forms use. Pure apart from `fetch`; tested in
// test/invitations.test.ts.
import { isRole, type Role } from "@freecorps/brigade-schema";

/** A pending invitation as the API lists it. */
export type PendingInvitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: number;
  createdAt: number;
  invitedBy: { id: string; name: string | null };
};

/** What the invitee's page shows (`GET /invitations/:id`): never the invited address. */
export type InvitationPreview = {
  id: string;
  workspace: { id: string; name: string };
  invitedBy: string | null;
  role: Role | null;
  status: "pending" | "accepted" | "rejected" | "canceled" | "expired" | "unknown";
  expiresAt: number;
  forYou: boolean;
};

/**
 * Why an invitation request failed: the API's `error` codes, `network` when it never answered, `invalid_email` for
 * the API's `invalid_args`, `internal` for anything else.
 */
export type InvitationError =
  | "forbidden"
  | "not_a_member"
  | "unverified"
  | "already_member"
  | "already_invited"
  | "limit_reached"
  | "rate_limited"
  | "too_soon"
  | "not_found"
  | "expired"
  | "wrong_email"
  | "workspace_full"
  | "workspace_limit"
  | "conflict"
  | "unavailable"
  | "not_applied"
  | "unauthenticated"
  | "invalid_email"
  | "network"
  | "internal";

const KNOWN: readonly string[] = [
  "forbidden",
  "not_a_member",
  "unverified",
  "already_member",
  "already_invited",
  "limit_reached",
  "rate_limited",
  "too_soon",
  "not_found",
  "expired",
  "wrong_email",
  "workspace_full",
  "workspace_limit",
  "conflict",
  "unavailable",
  "not_applied",
  "unauthenticated",
];

type Answer<T> = { ok: true; value: T } | { ok: false; error: InvitationError };

async function call<T>(
  path: string,
  init: RequestInit,
  read: (body: unknown) => T | undefined,
  fetcher: typeof fetch,
): Promise<Answer<T>> {
  let response: Response;
  try {
    response = await fetcher(`/api${path}`, {
      ...init,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
  } catch {
    return { ok: false, error: "network" };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const value = read(body);
    return value === undefined ? { ok: false, error: "internal" } : { ok: true, value };
  }
  const code = typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
  if (code === "invalid_args") return { ok: false, error: "invalid_email" };
  return {
    ok: false,
    error:
      typeof code === "string" && KNOWN.includes(code) ? (code as InvitationError) : "internal",
  };
}

const field = (body: unknown, key: string): unknown =>
  typeof body === "object" && body !== null ? Reflect.get(body, key) : undefined;

/** One pending invitation from the API's JSON, or undefined when it is not one. */
export function parseInvitation(raw: unknown): PendingInvitation | undefined {
  const id = field(raw, "id");
  const email = field(raw, "email");
  const role = field(raw, "role");
  const expiresAt = field(raw, "expiresAt");
  const createdAt = field(raw, "createdAt");
  const invitedBy = field(raw, "invitedBy");
  const inviterId = field(invitedBy, "id");
  const inviterName = field(invitedBy, "name");
  if (
    typeof id !== "string" ||
    typeof email !== "string" ||
    !isRole(role) ||
    typeof expiresAt !== "number" ||
    typeof createdAt !== "number" ||
    typeof inviterId !== "string"
  ) {
    return undefined;
  }
  return {
    id,
    email,
    role,
    expiresAt,
    createdAt,
    invitedBy: { id: inviterId, name: typeof inviterName === "string" ? inviterName : null },
  };
}

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/invitations`;

export function listInvitations(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<Answer<PendingInvitation[]>> {
  return call(
    base(workspaceId),
    { method: "GET" },
    (body) => {
      const list = field(body, "invitations");
      return Array.isArray(list) ? list.flatMap((one) => parseInvitation(one) ?? []) : undefined;
    },
    fetcher,
  );
}

export function inviteMember(
  workspaceId: string,
  email: string,
  role: Role,
  fetcher: typeof fetch = fetch,
): Promise<Answer<PendingInvitation>> {
  return call(
    base(workspaceId),
    { method: "POST", body: JSON.stringify({ email, role }) },
    (body) => parseInvitation(field(body, "invitation")),
    fetcher,
  );
}

export function resendInvitation(
  workspaceId: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Answer<{ expiresAt: number }>> {
  return call(
    `${base(workspaceId)}/${encodeURIComponent(id)}/resend`,
    { method: "POST" },
    (body) => {
      const expiresAt = field(body, "expiresAt");
      return typeof expiresAt === "number" ? { expiresAt } : undefined;
    },
    fetcher,
  );
}

export function revokeInvitation(
  workspaceId: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Answer<true>> {
  return call(
    `${base(workspaceId)}/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    () => true as const,
    fetcher,
  );
}

const STATUSES = ["pending", "accepted", "rejected", "canceled", "expired", "unknown"] as const;

export function previewInvitation(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Answer<InvitationPreview>> {
  return call(
    `/invitations/${encodeURIComponent(id)}`,
    { method: "GET" },
    (body) => {
      const raw = field(body, "invitation");
      const workspace = field(raw, "workspace");
      const workspaceId = field(workspace, "id");
      const workspaceName = field(workspace, "name");
      const status = field(raw, "status");
      const expiresAt = field(raw, "expiresAt");
      const invitedBy = field(raw, "invitedBy");
      const role = field(raw, "role");
      if (
        typeof workspaceId !== "string" ||
        typeof workspaceName !== "string" ||
        !(STATUSES as readonly unknown[]).includes(status) ||
        typeof expiresAt !== "number"
      ) {
        return undefined;
      }
      return {
        id,
        workspace: { id: workspaceId, name: workspaceName },
        invitedBy: typeof invitedBy === "string" ? invitedBy : null,
        role: isRole(role) ? role : null,
        status: status as InvitationPreview["status"],
        expiresAt,
        forYou: field(raw, "forYou") === true,
      };
    },
    fetcher,
  );
}

/** Accepts or declines; accepting answers the workspace to open. `not_applied` on accept still joined. */
export async function answerInvitation(
  id: string,
  action: "accept" | "decline",
  fetcher: typeof fetch = fetch,
): Promise<Answer<{ workspaceId: string | null }>> {
  return call(
    `/invitations/${encodeURIComponent(id)}/${action}`,
    { method: "POST" },
    (body) => {
      const workspaceId = field(body, "workspaceId");
      return { workspaceId: typeof workspaceId === "string" ? workspaceId : null };
    },
    fetcher,
  );
}

/** An invitation id as the API makes them, so a page never sends anything else to it. */
export function isInvitationId(value: unknown): value is string {
  return typeof value === "string" && /^inv_[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/** Why asking for another verification email failed. */
export type ResendError = "rate_limited" | "not_configured" | "network" | "failed";

/**
 * Asks Better Auth to email the signed-in user a new verification link. `next`: the invitation page to come back
 * to after verifying (the API keeps only such paths).
 */
export async function resendVerification(
  email: string,
  next?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: ResendError }> {
  let response: Response;
  try {
    response = await fetcher("/api/auth/send-verification-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, ...(next ? { callbackURL: next } : {}) }),
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, error: "rate_limited" };
  const body: unknown = await response.json().catch(() => null);
  if (field(body, "code") === "EMAIL_NOT_CONFIGURED") return { ok: false, error: "not_configured" };
  return { ok: false, error: "failed" };
}

/** What opening a verification link did. */
export type VerifyOutcome = "verified" | "expired" | "invalid" | "network";

/** Verifies the address the token was made for (`GET /api/auth/verify-email`). */
export async function verifyEmail(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  let response: Response;
  try {
    response = await fetcher(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return "network";
  }
  if (response.ok) return "verified";
  if (response.status >= 500) return "network";
  const body: unknown = await response.json().catch(() => null);
  return field(body, "code") === "TOKEN_EXPIRED" ? "expired" : "invalid";
}
