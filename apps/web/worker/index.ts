// The dashboard's Worker. Static assets serve the SPA (`not_found_handling: "single-page-application"`);
// `run_worker_first: ["/api", "/api/*"]` sends only API calls here, and they go to the API Worker through the
// `API` service binding with the `/api` prefix stripped, so `/api/health` reaches the API's `/health`.
// Of the dashboard and the API, only this Worker's `dev` environment has a public URL (workers.dev, wrangler.jsonc).
// `/slack/*` goes to the Slack app's Worker (integrations/slack, RFC 0011) through the optional `SLACK` binding,
// unchanged, so Slack's requests and the OAuth redirect share the dashboard's origin; without it, 404.
// `/status` and `/status/*`, the public status page (RFC 0012), go to the API Worker unchanged too: the API renders it from KV,
// with no session, so it is served from the dashboard's origin without the SPA.
// `/api/openapi.json` is the API reference (docs/api/openapi.json, generated from apps/api/src/openapi.ts), answered
// here from the bundle without auth.

import openApi from "../../../docs/api/openapi.json" with { type: "json" };

const API_PREFIX = "/api";
const OPENAPI_PATH = "/api/openapi.json";

/** The part of a service or assets binding this Worker uses; `Fetcher` satisfies it. */
export interface Upstream {
  fetch(request: Request): Promise<Response>;
}

export interface Upstreams {
  API: Upstream;
  ASSETS: Upstream;
  /** The Slack Worker; only environments with a Slack app bind it. */
  SLACK?: Upstream;
}

const SLACK_PREFIX = "/slack/";
const STATUS_PREFIX = "/status/";

/** The public status page's paths: `/status/<slug>`, and `/status` alone (the API's 404 page, not the SPA's). */
export function isStatusPath(pathname: string): boolean {
  return pathname === "/status" || pathname.startsWith(STATUS_PREFIX);
}

/** `/api/x` → `/x`, `/api` → `/`; undefined for paths outside `/api`. */
export function apiPath(pathname: string): string | undefined {
  if (pathname === API_PREFIX) return "/";
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return undefined;
}

export async function handle(request: Request, env: Upstreams): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith(SLACK_PREFIX)) return slack(request, env);
  if (isStatusPath(url.pathname)) return forward(request, env, url.pathname);
  if (url.pathname === OPENAPI_PATH) return reference(request);
  const path = apiPath(url.pathname);
  if (path === undefined) return env.ASSETS.fetch(request);
  url.pathname = path;
  // Same method, headers and (streamed) body; only the URL changes.
  return forward(new Request(url, request), env, path);
}

/** `request` to the API Worker; a gateway's 502 when the binding fails. */
async function forward(forwarded: Request, env: Upstreams, path: string): Promise<Response> {
  try {
    return await env.API.fetch(forwarded);
  } catch (error) {
    // The binding throws when the API Worker is missing or throws itself; answer like a gateway.
    console.error(
      JSON.stringify({ message: "API service binding failed", path, error: String(error) }),
    );
    return Response.json({ error: "api_unreachable" }, { status: 502 });
  }
}

/** The API reference: public, the same for everyone, so any site and any cache may read it. */
function reference(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET, HEAD" } },
    );
  }
  return Response.json(openApi, {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}

/** `/slack/*` as it came (path, method, headers, body: Slack signs the raw body), to the Slack Worker. */
async function slack(request: Request, env: Upstreams): Promise<Response> {
  if (!env.SLACK) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    return await env.SLACK.fetch(request);
  } catch (error) {
    console.error(
      JSON.stringify({ message: "Slack service binding failed", error: String(error) }),
    );
    return Response.json({ error: "slack_unreachable" }, { status: 502 });
  }
}

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Env>;
