// The dashboard's two webhook requests that need a secret made on the server (RFC 0005 "Outbound webhooks"):
// `POST /workspaces/:id/webhooks` creates an endpoint and `POST /workspaces/:id/webhooks/:webhookId/rotate` gives it
// a new secret. Each makes the secret here, seals it under `WEBHOOK_SECRET_KEY` (bound to the workspace and the
// endpoint) and runs the named mutation in the shard as the member, with the same RBAC as every mutation; the answer
// is the only time the secret is shown. Every other change (edit, on and off, delete, test) is a mutation over sync.
// The dashboard sends an `Idempotency-Key` with each, so a retried request is the same request (see `webhookRequest`).

import { isId, type Role } from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import { readPrefix } from "./check.ts";
import type { Auth } from "./auth.ts";
import { fromBase64url, isTokenKey, sealToken, tokenBinding } from "./slack-token.ts";
import { derivedWebhookSecret, newWebhookSecret } from "./webhook-sign.ts";
import type { WebhookRunResult } from "./webhooks.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

export type WebhookRouteEnv = Pick<Env, "DB" | "WORKSPACE"> & { WEBHOOK_SECRET_KEY?: string };

/** An `Idempotency-Key` the dashboard sends: a UUID fits. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** Largest request body read: a URL (2048), a description (200) and the event list fit well under it. */
const MAX_BODY_BYTES = 8 * 1024;

const STATUS: Partial<Record<Exclude<WebhookRunResult, { ok: true }>["code"], number>> = {
  forbidden: 403,
  not_a_member: 403,
  not_found: 404,
  conflict: 409,
  limit_reached: 409,
  invalid_args: 400,
};

/**
 * `POST /workspaces/:id/webhooks` with `{ id, url, description, events }` (201 `{ id, secret }`), or
 * `POST /workspaces/:id/webhooks/:webhookId/rotate` (200 `{ id, secret }`). 503 `not_configured` without
 * `WEBHOOK_SECRET_KEY`. With an `Idempotency-Key` (16 to 64 of `A-Z a-z 0-9 _ -`, 400 `invalid_idempotency_key`
 * otherwise) the key is the mutation's id and the secret is derived from it (`derivedWebhookSecret`): a retried request
 * gets the first one's answer, the same secret, and a rotation retried never rotates again (which would drop the
 * previous secret's grace). Without one a request is new each time: a create sent twice answers 409 the second time,
 * and a rotation sent twice rotates twice.
 */
export async function webhookRequest(
  request: Request,
  env: WebhookRouteEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  rotate: string | undefined,
): Promise<Response> {
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "POST" } },
    );
  }
  if (!ORGANIZATION_ID.test(workspaceId))
    return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
  if (rotate !== undefined && !isId("whk", rotate))
    return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return Response.json({ error: "forbidden_origin" }, { status: 403 });
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "unauthenticated" }, { status: 401 });
  let role: Role | undefined;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    log("member lookup failed", { error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (role === undefined) return Response.json({ error: "not_a_member" }, { status: 403 });
  if (!isTokenKey(env.WEBHOOK_SECRET_KEY))
    return Response.json({ error: "not_configured" }, { status: 503 });

  let id: string;
  let fields: Record<string, unknown> = {};
  if (rotate === undefined) {
    const body = await readObject(request);
    if (!body || !isId("whk", body.id))
      return Response.json({ error: "invalid_args" }, { status: 400 });
    id = body.id;
    fields = { url: body.url, description: body.description, events: body.events };
  } else {
    id = rotate;
  }
  const action = rotate === undefined ? "create" : "rotate";
  const secret =
    idempotencyKey === null
      ? newWebhookSecret()
      : await derivedWebhookSecret(
          fromBase64url(env.WEBHOOK_SECRET_KEY),
          [workspaceId, id, session.user.id, action, idempotencyKey].join(":"),
        );
  const sealed = await sealToken(env.WEBHOOK_SECRET_KEY, secret, tokenBinding(workspaceId, id));
  let result: WebhookRunResult;
  try {
    result = await env.WORKSPACE.getByName(workspaceId).webhookRun(
      workspaceId,
      { kind: "user", id: session.user.id, role },
      rotate === undefined ? "webhook.create" : "webhook.rotateSecret",
      { id, ...fields, secret: sealed },
      // Scoped like the derived secret: the same key for another endpoint or member is another request, never a
      // replay of this one (whose stored result would not match the secret answered here).
      idempotencyKey === null
        ? `${action}:${crypto.randomUUID()}`
        : `${action}:${id}:${session.user.id}:${idempotencyKey}`,
    );
  } catch (error) {
    log("WorkspaceDO.webhookRun failed", { workspace: workspaceId, error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    const status = STATUS[result.code];
    return Response.json(
      status === undefined
        ? { error: "internal" }
        : { error: result.code, ...(result.issues ? { issues: result.issues } : {}) },
      { status: status ?? 500 },
    );
  }
  return Response.json({ id, secret }, { status: rotate === undefined ? 201 : 200 });
}

async function readObject(request: Request): Promise<Record<string, unknown> | undefined> {
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > MAX_BODY_BYTES) return undefined;
  let text: string;
  try {
    // Bounded whatever Content-Length says: one byte past the limit is enough to refuse it.
    text = await readPrefix(new Response(request.body), MAX_BODY_BYTES + 1);
  } catch {
    return undefined;
  }
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, route: "webhooks", ...fields }));
}
