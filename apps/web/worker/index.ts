// The dashboard's Worker. Static assets serve the SPA (`not_found_handling: "single-page-application"`);
// `run_worker_first: ["/api/*"]` sends only API calls here, and they go to the API Worker through the
// `API` service binding with the `/api` prefix stripped, so `/api/health` reaches the API's `/health`.
// Dev-only for now: there is no auth, and neither Worker has a public URL (wrangler.jsonc).

const API_PREFIX = "/api";

/** The part of a service or assets binding this Worker uses; `Fetcher` satisfies it. */
export interface Upstream {
  fetch(request: Request): Promise<Response>;
}

export interface Upstreams {
  API: Upstream;
  ASSETS: Upstream;
}

/** `/api/x` → `/x`, `/api` → `/`; undefined for paths outside `/api`. */
export function apiPath(pathname: string): string | undefined {
  if (pathname === API_PREFIX) return "/";
  if (pathname.startsWith(`${API_PREFIX}/`)) return pathname.slice(API_PREFIX.length);
  return undefined;
}

export async function handle(request: Request, env: Upstreams): Promise<Response> {
  const url = new URL(request.url);
  const path = apiPath(url.pathname);
  if (path === undefined) return env.ASSETS.fetch(request);

  url.pathname = path;
  // Same method, headers and (streamed) body; only the URL changes.
  const forwarded = new Request(url, request);
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

export default {
  fetch: (request, env) => handle(request, env),
} satisfies ExportedHandler<Env>;
