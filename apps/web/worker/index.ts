// The dashboard's Worker. Static assets serve the SPA (`not_found_handling: "single-page-application"`);
// `run_worker_first: ["/api", "/api/*"]` sends only API calls here, and they go to the API Worker through the
// `API` service binding with the `/api` prefix stripped, so `/api/health` reaches the API's `/health`.
// Of the dashboard and the API, only this Worker's `dev` environment has a public URL (workers.dev, wrangler.jsonc).
// `/slack/*` goes to the Slack app's Worker (integrations/slack, RFC 0011) through the optional `SLACK` binding,
// unchanged, so Slack's requests and the OAuth redirect share the dashboard's origin; without it, 404.
// `/status` and `/status/*`, the public status page (RFC 0012), go to the API Worker unchanged too: the API renders it from KV,
// with no session, so it is served from the dashboard's origin without the SPA.
// `/api/openapi.json` is the API reference (docs/api/openapi.json, generated from apps/api/src/openapi.ts), answered
// here from the bundle without auth. A WebSocket upgrade anywhere else is a 404, never handed to the assets (`noSocket`).
// An API call's body is read in full before it is forwarded when it declares a length within `BUFFERED_BODY_MAX`
// (`apiRequest`), so the API answering before reading it (a 404 to a scanner's POST) leaves no upload half-sent.

import openApi from "../../../docs/api/openapi.json" with { type: "json" };

const API_PREFIX = "/api";
const OPENAPI_PATH = "/api/openapi.json";
/**
 * An API call whose body declares a `Content-Length` up to this is read in full before it is forwarded: above every
 * limit the API reads (`MAX_ALERT_BODY`, 256 KiB, is the largest), so no call the API takes is cut. Anything else
 * (no length, a larger one) is streamed as it comes, so a huge alert still reaches the API, which records it as too
 * large and pages anyway. Not exported: workerd takes every export of a Worker's main module for a handler, and a
 * number there stops the runtime from starting.
 */
const BUFFERED_BODY_MAX = 1024 * 1024;

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
  if (path === undefined) {
    return request.headers.has("Upgrade") ? noSocket() : env.ASSETS.fetch(request);
  }
  url.pathname = path;
  const forwarded = await apiRequest(url, request);
  return forwarded ? forward(forwarded, env, path) : unreadableBody();
}

/**
 * `request` for the API at `url`: same method, headers and body; only the URL changes. A body that declares a length
 * within `BUFFERED_BODY_MAX` is read first and sent as the same bytes (a signature over them still holds), so the
 * API can answer before reading it without the runtime failing to send the rest ("Can't read from request stream
 * after response has been sent"). Any other body is streamed, as before. Undefined when the client's upload broke
 * off while it was read.
 */
async function apiRequest(url: URL, request: Request): Promise<Request | undefined> {
  const length = request.headers.get("Content-Length");
  const declared = length === null ? Number.NaN : Number(length);
  if (!request.body || !Number.isSafeInteger(declared) || declared > BUFFERED_BODY_MAX) {
    return new Request(url, request);
  }
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return undefined;
  }
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    redirect: request.redirect,
  });
}

/** The client's upload broke off before its body was read: nothing to forward. */
function unreadableBody(): Response {
  return Response.json({ error: "bad_request" }, { status: 400 });
}

/**
 * An upgrade (a WebSocket) outside `/api`: assets serve no sockets, so it never reaches `ASSETS`. In `vp dev` the
 * Cloudflare Vite plugin sends every upgrade to this Worker whatever `run_worker_first` says, and its `ASSETS` is a
 * Node handler that Miniflare cannot answer an upgrade with: it fails an assertion in `#handleLoopbackUpgrade` and
 * the dev server exits (same path as https://github.com/cloudflare/workers-sdk/issues/13054). Deployed, such an
 * upgrade goes to the assets without this Worker.
 */
function noSocket(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
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
const REFERENCE_BODY = JSON.stringify(openApi);

function reference(request: Request): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: { Allow: "GET, HEAD", "Access-Control-Allow-Origin": "*" } },
    );
  }
  // Serialized once per isolate; HEAD sends the headers alone.
  return new Response(request.method === "HEAD" ? null : REFERENCE_BODY, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
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
