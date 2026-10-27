// What the Worker's routes (src/index.ts) accept and how they answer each refusal from the shard, here so the API
// reference (src/openapi.ts) documents the same patterns and lists the same codes under the same statuses. Imports
// nothing at runtime, so the reference's generator runs in Node.
import type { InvitationCode } from "./invitations.ts";
import type { MemberChangeResult } from "./members.ts";
import type { ReceiptResult } from "./receipts.ts";
import type { RestCode } from "./rest.ts";
import type { AckResult } from "./workspace.ts";

/** A user id as Better Auth makes them here (`usr_<ULID>`), or older plain ids: no encoding, bounded. */
export const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `PATCH`/`DELETE /workspaces/:id/members/:userId`, per shard refusal. */
export const MEMBER_STATUS: Record<Extract<MemberChangeResult, { ok: false }>["code"], number> = {
  forbidden: 403,
  not_found: 404,
  last_owner: 409,
  conflict: 409,
  unavailable: 503,
  not_applied: 503,
};

/** The answer for each invitation refusal (src/invitations.ts `InvitationCode`). */
export const INVITATION_STATUS: Record<InvitationCode, number> = {
  forbidden: 403,
  wrong_email: 403,
  unverified: 403,
  already_member: 409,
  already_invited: 409,
  limit_reached: 409,
  workspace_full: 409,
  workspace_limit: 409,
  conflict: 409,
  rate_limited: 429,
  address_limited: 429,
  inviter_limited: 429,
  send_limit: 409,
  too_soon: 429,
  not_found: 404,
  expired: 410,
  unavailable: 503,
  not_applied: 503,
};

/** The answer for each refusal of an ack; anything else (`internal`, `unknown_mutation`) is a 500. */
export const ACK_STATUS: Partial<Record<Extract<AckResult, { ok: false }>["code"], number>> = {
  conflict: 409,
  invalid_transition: 409,
  not_found: 404,
  forbidden: 403,
  not_a_member: 403,
  invalid_args: 400,
  // An API token the shard no longer backs (RFC 0014).
  unauthenticated: 401,
};

/**
 * The answer for each refusal of the incident and catalog routes (src/rest-routes.ts); anything else (`internal`,
 * `unknown_mutation`) is a 500.
 */
export const REST_STATUS: Partial<Record<RestCode, number>> = {
  invalid_args: 400,
  // An API token the shard no longer backs (RFC 0014).
  unauthenticated: 401,
  forbidden: 403,
  not_a_member: 403,
  not_found: 404,
  conflict: 409,
  invalid_transition: 409,
  limit_reached: 409,
  // The `Idempotency-Key` was first sent with another request (src/rest.ts).
  idempotency_key_reused: 422,
};

/** How each receipt result answers the phone: it only logs the status, and never retries a 4xx. */
export const RECEIPT_STATUS: Record<ReceiptResult, number> = {
  recorded: 200,
  already: 200,
  invalid: 403,
  expired: 410,
  not_found: 404,
  rate_limited: 429,
};
