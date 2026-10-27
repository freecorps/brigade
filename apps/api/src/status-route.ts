// The status page's HTTP routes (RFC 0012): `GET /status/:slug`, the public page, read from KV and never from the
// shard; and `PUT /workspaces/:id/status-page`, which sets the page up as a member (src/status-page.ts).

import {
  STATUS_SNAPSHOT_VERSION,
  STATUS_SLUG,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { memberRole } from "./actor.ts";
import { renderStatusMessage, renderStatusPage } from "./status-html.ts";
import { statusKey, type StatusConfigureCode, type StatusConfigureResult } from "./status-page.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

/** How long a visitor's browser, the edge cache and KV's own cache may keep a page: a status page may lag this much. */
export const STATUS_MAX_AGE_S = 30;
/** No page at an address: kept a little longer, so a flood of made-up addresses costs one KV read each a minute. */
export const STATUS_MISSING_MAX_AGE_S = 60;
/** The largest settings body read. */
const MAX_BODY_LENGTH = 4096;

/** No script, nothing loaded from elsewhere, not framed: the page is text and inline style. */
const STATUS_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * `GET /status/:slug`: the public page, no session. The snapshot comes from KV (`cacheTtl`) behind the edge's own
 * cache (the Cache API, where the Worker runs on a zone; a no-op on workers.dev), so a busy page costs about one KV read
 * per location every 30 s and never wakes the shard. An address with no page, or one that is not public, is a 404.
 */
export async function serveStatusPage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const head = (response: Response) =>
    request.method === "HEAD" ? new Response(null, response) : response;
  if (!STATUS_SLUG.test(slug)) return head(notFound());
  // A key of our own, not the request: the same page whatever host or headers it came with.
  const key = new Request(`https://status.cache.invalid/${slug}`);
  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const hit = await cache?.match(key);
  if (hit) return head(hit);

  if (!env.STATUS) return head(notFound());
  let snapshot: StatusSnapshot | null;
  try {
    snapshot = await env.STATUS.get<StatusSnapshot>(statusKey(slug), {
      type: "json",
      cacheTtl: STATUS_MAX_AGE_S,
    });
  } catch (error) {
    console.error(
      JSON.stringify({ message: "reading a status page failed", slug, error: String(error) }),
    );
    return head(page(renderStatusMessage("unavailable", "en"), 503));
  }
  const response =
    snapshot === null
      ? notFound()
      : snapshot.v === STATUS_SNAPSHOT_VERSION
        ? page(renderStatusPage(snapshot), 200, STATUS_MAX_AGE_S)
        : page(renderStatusMessage("unavailable", "en"), 503);
  // The full page in the cache whatever the method, so a GET after a HEAD gets a body.
  if (cache && response.status !== 503) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  }
  return head(response);
}

const notFound = () => page(renderStatusMessage("not_found", "en"), 404, STATUS_MISSING_MAX_AGE_S);

function page(html: string, status: number, maxAge?: number): Response {
  const headers = new Headers(STATUS_HEADERS);
  headers.set("Cache-Control", maxAge === undefined ? "no-store" : `public, max-age=${maxAge}`);
  return new Response(html, { status, headers });
}

const CONFIGURE_STATUS: Record<StatusConfigureCode | "not_a_member", number> = {
  forbidden: 403,
  not_a_member: 403,
  invalid_args: 400,
  slug_taken: 409,
  not_found: 404,
  unavailable: 503,
  not_applied: 503,
};

/**
 * `PUT /workspaces/:id/status-page` `{ slug, title, locale, enabled }`: sets the page up (owners and admins). The
 * Worker checks the origin, the session and the member's role in D1, so an outsider never wakes a shard; the shard
 * claims the slug in D1 and runs `statusPage.configure` (RFC 0012 "Addresses").
 */
export async function configureStatusPage(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
): Promise<Response> {
  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405, { Allow: "PUT" });
  if (!ORGANIZATION_ID.test(workspaceId)) return json({ error: "invalid_workspace_id" }, 400);
  const origin = request.headers.get("Origin");
  if (origin !== null && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }
  const session = await lazyAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ error: "unauthenticated" }, 401);
  let role;
  try {
    role = await memberRole(env.DB, workspaceId, session.user.id);
  } catch (error) {
    console.error(JSON.stringify({ message: "member lookup failed", error: String(error) }));
    return json({ error: "unavailable" }, 503);
  }
  if (role === undefined) return json({ error: "not_a_member" }, 403);
  const body = await readBody(request);
  if (body === undefined) return json({ error: "invalid_args" }, 400);
  let result: StatusConfigureResult | { ok: false; code: "not_a_member" };
  try {
    result = await env.WORKSPACE.getByName(workspaceId).configureStatusPage(
      workspaceId,
      { kind: "user", id: session.user.id, role },
      body,
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "WorkspaceDO.configureStatusPage failed",
        workspaceId,
        error: String(error),
      }),
    );
    return json({ error: "unavailable" }, 503);
  }
  if (result.ok) return json({ ok: true });
  return json({ error: result.code }, CONFIGURE_STATUS[result.code]);
}

async function readBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_LENGTH) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_LENGTH) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
