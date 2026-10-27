// The webhook requests that need the server's key (RFC 0005 "Outbound webhooks"): `POST /workspaces/:id/webhooks`
// creates an endpoint, `POST /workspaces/:id/webhooks/:webhookId/rotate` gives it a new secret, and
// `PUT /workspaces/:id/webhooks/:webhookId/headers` sets its custom headers. Each seals what it is given or makes (the
// secret, the header values) under `WEBHOOK_SECRET_KEY`, bound to the workspace and the endpoint, and runs the named
// mutation in the shard as the member or API token (`webhook:manage`, RFC 0014), with the same RBAC as every mutation;
// the answer is the only time the secret is shown, and a header's value is never shown back. Every other change (edit,
// on and off, delete, test, replay) is a mutation over sync. The dashboard sends an `Idempotency-Key` with each, so a
// retried request is the same request (see `webhookRequest`).

import {
  isId,
  webhookHeaderHint,
  webhookHeadersInput,
  webhookHeadersUpdate,
  type Actor,
  type Issue,
} from "@freecorps/brigade-schema";
import { memberRole } from "./actor.ts";
import { callerOf, unauthenticated, type ApiTokenEnv } from "./api-tokens.ts";
import { readPrefix } from "./check.ts";
import type { Auth } from "./auth.ts";
import { WEBHOOK_STATUS } from "./http.ts";
import { fromBase64url, isTokenKey, sealToken, tokenBinding } from "./slack-token.ts";
import { derivedWebhookSecret, headerBinding, newWebhookSecret } from "./webhook-sign.ts";
import type { WebhookHeaderArg, WebhookRunName, WebhookRunResult } from "./webhooks.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

export type WebhookRouteEnv = ApiTokenEnv & { WEBHOOK_SECRET_KEY?: string };

/** What a request asks: a new endpoint, a new secret for one, or its custom headers. */
export type WebhookAction = "create" | "rotate" | "headers";

/** An `Idempotency-Key` the dashboard sends: a UUID fits. */
export const WEBHOOK_IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** Largest request body read: a URL (2048), a description (200), the event list and 5 headers fit under it. */
const MAX_BODY_BYTES = 16 * 1024;

/**
 * `POST /workspaces/:id/webhooks` with `{ id, url, description, events, headers? }` (201 `{ id, secret }`),
 * `POST /workspaces/:id/webhooks/:webhookId/rotate` (200 `{ id, secret }`), or
 * `PUT /workspaces/:id/webhooks/:webhookId/headers` with `{ headers }` (200 `{ id, headers }`: each name and hint, a
 * header sent without `value` keeping the one it has). As the signed-in member or an API token with `webhook:manage`.
 * 503 `not_configured` without `WEBHOOK_SECRET_KEY`. With an `Idempotency-Key` (16 to 64 of `A-Z a-z 0-9 _ -`, 400
 * `invalid_idempotency_key` otherwise) the key is the mutation's id and a secret is derived from it
 * (`derivedWebhookSecret`): a retried request gets the first one's answer, the same secret, and a rotation retried
 * never rotates again (which would drop the previous secret's grace). Without one a request is new each time: a create
 * sent twice answers 409 the second time, and a rotation sent twice rotates twice.
 */
export async function webhookRequest(
  request: Request,
  env: WebhookRouteEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  webhookId: string | undefined,
  action: WebhookAction = webhookId === undefined ? "create" : "rotate",
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const method = action === "headers" ? "PUT" : "POST";
  if (request.method !== method) {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: method } },
    );
  }
  if (!ORGANIZATION_ID.test(workspaceId))
    return Response.json({ error: "invalid_workspace_id" }, { status: 400 });
  if (webhookId !== undefined && !isId("whk", webhookId))
    return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (idempotencyKey !== null && !WEBHOOK_IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return Response.json({ error: "invalid_idempotency_key" }, { status: 400 });
  }
  const resolved = await callerOf(request, env, lazyAuth, workspaceId, "webhook:manage", waitUntil);
  if (!resolved.ok) return resolved.response;
  const { caller } = resolved;
  let actor: Actor | undefined = caller.kind === "token" ? caller.actor : undefined;
  if (!actor) {
    try {
      const role = await memberRole(env.DB, workspaceId, caller.userId);
      if (role !== undefined) actor = { kind: "user", id: caller.userId, role };
    } catch (error) {
      log("member lookup failed", { error: String(error) });
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
  }
  if (actor === undefined) return Response.json({ error: "not_a_member" }, { status: 403 });
  if (!isTokenKey(env.WEBHOOK_SECRET_KEY))
    return Response.json({ error: "not_configured" }, { status: 503 });
  const key = env.WEBHOOK_SECRET_KEY;

  let id: string;
  let fields: Record<string, unknown> = {};
  let headers: { name: string; value?: string | undefined }[] = [];
  if (action === "rotate") {
    id = webhookId!;
  } else {
    const body = await readObject(request);
    if (action === "create" ? !body || !isId("whk", body.id) : !body) {
      return Response.json({ error: "invalid_args" }, { status: 400 });
    }
    id = action === "create" ? (body!.id as string) : webhookId!;
    if (action === "create") {
      fields = { url: body!.url, description: body!.description, events: body!.events };
    }
    if (action === "headers" || body!.headers !== undefined) {
      const checked = (action === "create" ? webhookHeadersInput : webhookHeadersUpdate)(
        body!.headers,
        "headers",
      );
      if (!checked.ok) return invalid(checked.issues);
      headers = checked.value;
    }
  }
  const sealed: WebhookHeaderArg[] = await Promise.all(
    headers.map(async ({ name, value }) =>
      value === undefined
        ? { name, value: null, hint: null }
        : {
            name,
            value: await sealToken(key, value, headerBinding(workspaceId, id, name)),
            hint: webhookHeaderHint(value),
          },
    ),
  );
  let secret: string | undefined;
  if (action !== "headers") {
    secret =
      idempotencyKey === null
        ? newWebhookSecret()
        : await derivedWebhookSecret(
            fromBase64url(key),
            [workspaceId, id, actor.id, action, idempotencyKey].join(":"),
          );
  }
  const name: WebhookRunName =
    action === "create"
      ? "webhook.create"
      : action === "rotate"
        ? "webhook.rotateSecret"
        : "webhook.setHeaders";
  const args: Record<string, unknown> =
    action === "headers"
      ? { id, headers: sealed }
      : {
          id,
          ...fields,
          ...(action === "create" && sealed.length ? { headers: sealed } : {}),
          secret: await sealToken(key, secret!, tokenBinding(workspaceId, id)),
        };
  let result: WebhookRunResult;
  try {
    result = await env.WORKSPACE.getByName(workspaceId).webhookRun(
      workspaceId,
      actor,
      name,
      args,
      // Scoped like the derived secret: the same key for another endpoint or caller is another request, never a
      // replay of this one (whose stored result would not match the secret answered here).
      idempotencyKey === null
        ? `${action}:${crypto.randomUUID()}`
        : `${action}:${id}:${actor.id}:${idempotencyKey}`,
    );
  } catch (error) {
    log("WorkspaceDO.webhookRun failed", { workspace: workspaceId, error: String(error) });
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    if (result.code === "unauthenticated") return unauthenticated();
    const status = WEBHOOK_STATUS[result.code];
    return Response.json(
      status === undefined
        ? { error: "internal" }
        : { error: result.code, ...(result.issues ? { issues: result.issues } : {}) },
      { status: status ?? 500 },
    );
  }
  if (action === "headers") return Response.json({ id, headers: result.headers ?? [] });
  return Response.json({ id, secret }, { status: action === "create" ? 201 : 200 });
}

function invalid(issues: Issue[]): Response {
  return Response.json({ error: "invalid_args", issues }, { status: 400 });
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
