// The status page's HTTP routes (RFC 0012): `GET /status/:slug`, the public page, and its feeds, read from KV and never
// from the shard; and `PUT /workspaces/:id/status-page`, which sets the page up as a member (src/status-page.ts).

import {
  COMPONENT_STATUSES,
  PUBLIC_STATUSES,
  STATUS_LOCALES,
  STATUS_SLUG,
  UPTIME_STATES,
  type StatusSnapshot,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { unauthenticated } from "./api-tokens.ts";
import { readBounded } from "./body.ts";
import { emailSender } from "./email.ts";
import { dashboardLink } from "./email-templates.ts";
import { feedUrls, renderAtomFeed, renderJsonFeed, type FeedFormat } from "./status-feed.ts";
import { LOCAL_TIMES_SCRIPT_HASH, renderStatusMessage, renderStatusPage } from "./status-html.ts";
import { statusKey, type StatusConfigureResult } from "./status-page.ts";
import { STATUS_PAGE_STATUS } from "./http.ts";
import { checkMember } from "./member-route.ts";
import type { TokenRefused } from "./workspace.ts";

/** How long a visitor's browser, the edge cache and KV's own cache may keep a page: a status page may lag this much. */
export const STATUS_MAX_AGE_S = 30;
/** No page at an address: kept a little longer, so a flood of made-up addresses costs one KV read each a minute. */
export const STATUS_MISSING_MAX_AGE_S = 60;
/** The largest settings body read. */
const MAX_BODY_LENGTH = 4096;

/**
 * Nothing loaded from elsewhere, not framed: the page is text and inline style, and its one script (local times,
 * RFC 0012 "Local times") runs only because its hash is listed; no other script would. Its only form (subscribing by
 * email) posts to its own origin.
 */
const STATUS_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": `default-src 'none'; script-src '${LOCAL_TIMES_SCRIPT_HASH}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
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
export function serveStatusPage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
): Promise<Response> {
  // A key of our own, not the request: the same page whatever host or headers it came with.
  return serveFromSnapshot(
    request,
    env,
    ctx,
    slug,
    `https://status.cache.invalid/${slug}`,
    (stored) => {
      // The subscribe form only where email can be sent: a page whose emails never go out promises nothing.
      const subscribe = emailSender(env) !== undefined;
      return page(renderStatusPage(stored, { slug, subscribe }), 200, STATUS_MAX_AGE_S);
    },
  );
}

const FEED_TYPES: Record<FeedFormat, string> = {
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

/**
 * `GET /status/:slug/feed.atom` and `/feed.json` (RFC 0012 "Feeds"): the page's incidents and maintenance for feed
 * readers, from the same snapshot, KV read and caches as the page; no session, never the shard. Entries carry absolute
 * addresses, from `DASHBOARD_URL` (the page's origin), else the request's, which is then part of the cache key.
 */
export function serveStatusFeed(
  request: Request,
  env: Env & { DASHBOARD_URL?: string },
  ctx: ExecutionContext,
  slug: string,
  format: FeedFormat,
): Promise<Response> {
  const origin = new URL(
    dashboardLink("/", {}, env.DASHBOARD_URL, new URL(request.url).origin) ?? request.url,
  ).origin;
  const key = `https://status.cache.invalid/${slug}/feed.${format}?origin=${encodeURIComponent(origin)}`;
  return serveFromSnapshot(request, env, ctx, slug, key, (stored) => {
    const urls = feedUrls(origin, slug);
    const body = format === "atom" ? renderAtomFeed(stored, urls) : renderJsonFeed(stored, urls);
    const headers = statusPageHeaders(STATUS_MAX_AGE_S);
    headers.set("Content-Type", FEED_TYPES[format]);
    // Public by design, as the page: any site or reader may fetch it.
    headers.set("Access-Control-Allow-Origin", "*");
    return new Response(body, { status: 200, headers });
  });
}

/**
 * What the page and its feeds share: `GET` and `HEAD` only, the edge cache under `cacheKey`, then the snapshot from KV,
 * checked (`isSnapshot`) before `render` sees it. No page is a 404, an unreadable snapshot or a throwing render the
 * 503 page (never cached).
 */
async function serveFromSnapshot(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  slug: string,
  cacheKey: string,
  render: (snapshot: StatusSnapshot) => Response,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const answer = (response: Response) =>
    request.method === "HEAD" ? new Response(null, response) : response;
  // Only an address with no page counts against the caller (decided, Q23): a real page's hits never do.
  const head = async (response: Response) =>
    answer(
      response.status === 404 && !(await missAllowed(request, env)) ? rateLimitedPage() : response,
    );
  if (!STATUS_SLUG.test(slug)) return head(notFound());
  const key = new Request(cacheKey);
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
      response = render(stored);
    } catch (error) {
      console.error(
        JSON.stringify({ message: "rendering a status page failed", slug, error: String(error) }),
      );
      response = unavailable();
    }
  }
  // The full response in the cache whatever the method, so a GET after a HEAD gets a body.
  if (cache && response.status !== 503) {
    ctx.waitUntil(cache.put(key, response.clone()).catch(() => undefined));
  }
  return head(response);
}

const notFound = () => page(renderStatusMessage("not_found", "en"), 404, STATUS_MISSING_MAX_AGE_S);
/** The 404 page, for a custom hostname with no page (src/status-domain.ts). */
export const statusNotFound = notFound;

/** Past the misses a caller may make: never cached, so the next minute's answer is the real one. */
export function rateLimitedPage(): Response {
  const response = page(renderStatusMessage("rate_limited", "en"), 429);
  response.headers.set("Retry-After", "60");
  return response;
}

/**
 * Whether the caller may get one more "no page here" (`STATUS_MISS_LIMIT`, per address a minute, RFC 0012 "Caching and
 * abuse"): a flood of made-up addresses from one place is bounded, while every page that exists is served to anyone.
 * Without the binding or a caller address, or if the limiter fails, the miss is answered as before.
 */
export async function missAllowed(request: Request, env: Env): Promise<boolean> {
  const limiter = env.STATUS_MISS_LIMIT as RateLimit | undefined;
  // Cloudflare always names the caller; a request without it (a local run) has nobody to count against.
  const address = request.headers.get("cf-connecting-ip");
  if (!limiter || !address) return true;
  try {
    return (await limiter.limit({ key: address })).success;
  } catch (error) {
    console.error(
      JSON.stringify({ message: "the status miss limit failed", error: String(error) }),
    );
    return true;
  }
}
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
const isOptionalTime = (value: unknown) => value === undefined || isTime(value);

const isIncident = (value: unknown) =>
  isRecord(value) &&
  isString(value.title) &&
  isOneOf(PUBLIC_STATUSES, value.status) &&
  isOneOf(COMPONENT_STATUSES, value.impact) &&
  isArrayOf(value.components, isString) &&
  isTime(value.publishedAt) &&
  (value.resolvedAt === null || isTime(value.resolvedAt)) &&
  isOptionalTime(value.updatedAt) &&
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
  isTime(value.endsAt) &&
  isOptionalTime(value.publishedAt) &&
  isOptionalTime(value.updatedAt);

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

/**
 * `PUT /workspaces/:id/status-page` `{ slug, title, locale, enabled }`: sets the page up (owners and admins, or an API
 * token with `status:manage`). The Worker checks the origin, the session and the member's role in D1 (or the token,
 * RFC 0014), so an outsider never wakes a shard; the shard claims the slug in D1 and runs `statusPage.configure` (RFC 0012 "Addresses").
 */
export async function configureStatusPage(
  request: Request,
  env: Env,
  lazyAuth: () => Auth,
  workspaceId: string,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const member = await checkMember(
    request,
    env,
    lazyAuth,
    workspaceId,
    ["PUT"],
    "status:manage",
    waitUntil,
  );
  if (!member.ok) return member.response;
  const body = await readBody(request);
  if (body === undefined) return json({ error: "invalid_args" }, 400);
  let result: StatusConfigureResult | { ok: false; code: "not_a_member" } | TokenRefused;
  try {
    result = await env.WORKSPACE.getByName(workspaceId).configureStatusPage(
      workspaceId,
      member.actor,
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
  if (result.code === "unauthenticated") return unauthenticated();
  return json({ error: result.code }, STATUS_PAGE_STATUS[result.code]);
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
