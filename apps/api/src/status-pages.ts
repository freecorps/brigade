// The API's side of a status page at its own domain (RFC 0012 "Custom domains"). `StatusPages` is a named entrypoint
// the status page edge binds to (apps/status-edge wrangler.jsonc): that Worker holds the SaaS zone's route, looks the
// hostname up in KV and hands the visitor's request here with the page it found. Only that page's routes answer, and
// only while the snapshot under its slug is still that workspace's; rendering and caching are `/status/<slug>`'s own.
// The API Worker's `fetch` never serves a custom hostname, so its paging routes behave the same whatever is set here.

import { WorkerEntrypoint } from "cloudflare:workers";
import type { StatusHost, StatusPagesApi } from "@freecorps/brigade-status-edge/api";
import { STATUS_SLUG } from "@freecorps/brigade-schema";
import type { FeedFormat } from "./status-feed.ts";
import {
  missAllowed,
  rateLimitedPage,
  serveStatusFeed,
  serveStatusPage,
  statusNotFound,
} from "./status-route.ts";
import { serveSubscription, type SubscriptionAction } from "./status-subscribers.ts";
import { ORGANIZATION_ID } from "./workspace.ts";

/** What a page's own routes are, under `/status/<slug>`: its feeds and subscribing (as src/index.ts routes them). */
const PAGE_ROUTE =
  /^\/status\/([^/]+)(?:\/(?:feed\.(atom|json)|(subscribe|confirm|manage|unsubscribe)))?$/;

export class StatusPages extends WorkerEntrypoint<Env> implements StatusPagesApi {
  serve(request: Request, host: StatusHost): Promise<Response> {
    return serveCustomHost(request, this.env, this.ctx, host);
  }
}

/**
 * A request to a custom hostname, for the page `host` names: `/` is the page, `/status/<its slug>` and its feeds and
 * subscription routes are themselves, and anything else (another page, the API, sign-in) is the 404 page, counted
 * as a miss. Each serves only `host.workspaceId`'s snapshot, so a slug that changed hands before the lookup caught up
 * shows the 404 page, never the other workspace's.
 */
export async function serveCustomHost(
  request: Request,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">,
  host: StatusHost,
): Promise<Response> {
  const { workspaceId, slug } = host;
  if (!ORGANIZATION_ID.test(workspaceId) || !STATUS_SLUG.test(slug)) return miss(request, env);
  const { pathname } = new URL(request.url);
  if (pathname === "/") return serveStatusPage(request, env, ctx, slug, workspaceId);
  const route = PAGE_ROUTE.exec(pathname);
  if (!route || route[1] !== slug) return miss(request, env);
  if (route[2])
    return serveStatusFeed(request, env, ctx, slug, route[2] as FeedFormat, workspaceId);
  if (route[3]) {
    return serveSubscription(request, env, ctx, slug, route[3] as SubscriptionAction, workspaceId);
  }
  return serveStatusPage(request, env, ctx, slug, workspaceId);
}

async function miss(request: Request, env: Env): Promise<Response> {
  return (await missAllowed(request, env)) ? statusNotFound() : rateLimitedPage();
}
