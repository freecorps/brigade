// The status page's HTTP routes (RFC 0012): `GET /status/:slug`, the public page, read from KV and never from the
// shard; and `PUT /workspaces/:id/status-page`, which sets the page up as a member (src/status-page.ts).

import {
  COMPONENT_STATUSES,
  PUBLIC_STATUSES,
  STATUS_LOCALES,
  STATUS_SLUG,
  UPTIME_STATES,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { memberRole } from "./actor.ts";
import { readBounded } from "./body.ts";
import { emailSender } from "./email.ts";
import { renderStatusMessage, renderStatusPage } from "./status-html.ts";
import { statusKey, type StatusConfigureCode, type StatusConfigureResult } from "./status-page.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

/** How long a visitor's browser, the edge cache and KV's own cache may keep a page: a status page may lag this much. */
export const STATUS_MAX_AGE_S = 30;
/** No page at an address: kept a little longer, so a flood of made-up addresses costs one KV read each a minute. */
export const STATUS_MISSING_MAX_AGE_S = 60;
/** The largest settings body read. */
const MAX_BODY_LENGTH = 4096;

/**
 * No script, nothing loaded from elsewhere, not framed: the page is text and inline style. Its only form (subscribing
 * by email) posts to its own origin.
 */
const STATUS_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** The page's headers with `Cache-Control` set: `no-store`, or a `max-age` in seconds. */
export function statusPageHeaders(cache: "no-store" | number): Headers {
  const headers = new Headers(STATUS_HEADERS);
  headers.set("Cache-Control", cache === "no-store" ? "no-store" : `public, max-age=${cache}`);
  return headers;
}

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
  let stored: unknown;
  try {
    stored = await env.STATUS.get(statusKey(slug), { type: "json", cacheTtl: STATUS_MAX_AGE_S });
  } catch (error) {
    console.error(
      JSON.stringify({ message: "reading a status page failed", slug, error: String(error) }),
    );
    return head(unavailable());
  }
  let response: Response;
  if (stored === null) response = notFound();
  else if (!isSnapshot(stored)) {
    // A newer shape than this Worker knows, or a damaged value: never rendered half-way.
    console.error(JSON.stringify({ message: "a status page snapshot is unreadable", slug }));
    response = unavailable();
  } else {
    try {
      // The subscribe form only where email can be sent: a page whose emails never go out promises nothing.
      const subscribe = emailSender(env) !== undefined;
      response = page(renderStatusPage(stored, { slug, subscribe }), 200, STATUS_MAX_AGE_S);
    } catch (error) {
      console.error(
        JSON.stringify({ message: "rendering a status page failed", slug, error: String(error) }),
      );
      response = unavailable();
    }
  }
  // The full page in the cache whatever the method, so a GET after a HEAD gets a body.
  if (cache && response.status !== 503) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  }
  return head(response);
}

const notFound = () => page(renderStatusMessage("not_found", "en"), 404, STATUS_MISSING_MAX_AGE_S);
const unavailable = () => page(renderStatusMessage("unavailable", "en"), 503);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());
const isOneOf = (values: readonly string[], value: unknown) =>
  typeof value === "string" && values.includes(value);
const isArrayOf = (value: unknown, item: (value: unknown) => boolean) =>
  Array.isArray(value) && value.every(item);
const isString = (value: unknown) => typeof value === "string";

const isIncident = (value: unknown) =>
  isRecord(value) &&
  isString(value.title) &&
  isOneOf(PUBLIC_STATUSES, value.status) &&
  isOneOf(COMPONENT_STATUSES, value.impact) &&
  isArrayOf(value.components, isString) &&
  isTime(value.publishedAt) &&
  (value.resolvedAt === null || isTime(value.resolvedAt)) &&
  isArrayOf(
    value.updates,
    (update) =>
      isRecord(update) &&
      isTime(update.at) &&
      isOneOf(PUBLIC_STATUSES, update.status) &&
      isString(update.body),
  );

const isWindow = (value: unknown) =>
  isRecord(value) &&
  isString(value.title) &&
  isString(value.body) &&
  isArrayOf(value.components, isString) &&
  isTime(value.startsAt) &&
  isTime(value.endsAt);

const isUptime = (value: unknown) =>
  value === undefined ||
  (isRecord(value) &&
    (value.percent === null ||
      (typeof value.percent === "number" && value.percent >= 0 && value.percent <= 100)) &&
    isArrayOf(
      value.days,
      (day) =>
        isRecord(day) &&
        typeof day.date === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(day.date) &&
        isOneOf(UPTIME_STATES, day.state) &&
        typeof day.down === "number" &&
        Number.isSafeInteger(day.down) &&
        day.down >= 0,
    ));

/** Component statuses a page shows: the scale, and `maintenance` from version 2. */
const SHOWN_STATUSES: readonly string[] = [...COMPONENT_STATUSES, "maintenance"];

/**
 * Whether a value read from KV is a snapshot this Worker can render: a version it knows (1, or 2 with uptime bars and
 * maintenance), every status and the language one it has words for, every time a date. KV holds what the shard
 * wrote, but a Worker older or newer than the shard, or a damaged value, must answer the 503 page, never a page with
 * blanks or a thrown error.
 */
export function isSnapshot(value: unknown): value is StatusSnapshot {
  const v2 = isRecord(value) && value.v === 2;
  return (
    isRecord(value) &&
    (value.v === 1 || v2) &&
    isString(value.title) &&
    isOneOf(STATUS_LOCALES, value.locale) &&
    isTime(value.generatedAt) &&
    isOneOf(COMPONENT_STATUSES, value.status) &&
    isArrayOf(
      value.groups,
      (group) =>
        isRecord(group) &&
        (group.name === null || isString(group.name)) &&
        isArrayOf(
          group.components,
          (component) =>
            isRecord(component) &&
            isString(component.name) &&
            isOneOf(v2 ? SHOWN_STATUSES : COMPONENT_STATUSES, component.status) &&
            (v2 ? isUptime(component.uptime) : component.uptime === undefined),
        ),
    ) &&
    isArrayOf(value.active, isIncident) &&
    isArrayOf(value.history, isIncident) &&
    (v2
      ? isArrayOf(value.maintenance, isWindow) && isArrayOf(value.upcoming, isWindow)
      : value.maintenance === undefined && value.upcoming === undefined)
  );
}

function page(html: string, status: number, maxAge?: number): Response {
  return new Response(html, { status, headers: statusPageHeaders(maxAge ?? "no-store") });
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
  const text = await readBounded(request, MAX_BODY_LENGTH);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers });
}
