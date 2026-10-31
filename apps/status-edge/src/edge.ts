// The status page edge's answers (RFC 0012 "Custom domains"), for the Worker behind the Cloudflare for SaaS zone's
// `*/*` route and the dedicated hostnames attached to it as Custom Domains, so every custom hostname reaches it and
// nothing else does. It reads the hostname's lookup (`host:<hostname>` in the API's `STATUS` namespace, read only)
// and hands the request to the API's `StatusPages` entrypoint, which renders and caches the page as `/status/<slug>`
// does. A hostname with no lookup is a static 404, counted against the caller like any miss; the API Worker's own
// routes are never reachable here.

import type { Locale } from "@freecorps/brigade-i18n";
import { status_text } from "@freecorps/brigade-i18n/messages";
import { EDGE_HEADER, hostKey, readStatusHost } from "./api.ts";
import type { EdgeEnv } from "./index.ts";

/** How long KV's own cache may keep a hostname's lookup, as for a snapshot. */
export const HOST_CACHE_TTL_S = 30;
/** No page at a hostname: browsers and the edge may keep the 404 this long, as the API's own. */
const MISSING_MAX_AGE_S = 60;
/** Asked for by browsers and crawlers on their own: a 404 that never counts as a miss. */
const UNCOUNTED = new Set(["/favicon.ico", "/robots.txt"]);

/** The Worker's whole answer; `env` is the real bindings or the tests' fakes. */
export async function serveEdge(request: Request, env: EdgeEnv): Promise<Response> {
  const url = new URL(request.url);
  if (UNCOUNTED.has(url.pathname)) return message("not_found", 404, MISSING_MAX_AGE_S);
  const host = url.hostname.toLowerCase();
  let stored: unknown;
  try {
    stored = await env.STATUS.get(hostKey(host), { type: "json", cacheTtl: HOST_CACHE_TTL_S });
  } catch (error) {
    log("reading a custom hostname failed", { host, error: String(error) });
    return message("unavailable", 503);
  }
  const target = readStatusHost(stored);
  if (!target) return miss(request, env);
  try {
    return await env.API.serve(request, target);
  } catch (error) {
    log("the API's StatusPages failed", { host, error: String(error) });
    return message("unavailable", 503);
  }
}

/** A hostname with no page: the 404, or the 429 once the caller made `STATUS_MISS_LIMIT`'s misses this minute. */
async function miss(request: Request, env: EdgeEnv): Promise<Response> {
  const limiter = env.STATUS_MISS_LIMIT as RateLimit | undefined;
  // Cloudflare always names the caller; a request without it (a local run) has nobody to count against.
  const address = request.headers.get("cf-connecting-ip");
  let allowed = true;
  if (limiter && address) {
    try {
      allowed = (await limiter.limit({ key: address })).success;
    } catch (error) {
      log("the status miss limit failed", { error: String(error) });
    }
  }
  if (allowed) return message("not_found", 404, MISSING_MAX_AGE_S);
  const limited = message("rate_limited", 429);
  limited.headers.set("Retry-After", "60");
  return limited;
}

/**
 * One of the status page's message pages, in English like the API's: no page, unavailable, too many requests. Each
 * says it is this Worker's (`EDGE_HEADER`), so the API can tell the edge answers at a hostname.
 */
function message(
  kind: "not_found" | "unavailable" | "rate_limited",
  status: number,
  maxAge?: number,
): Response {
  const locale: Locale = "en";
  const title = escape(status_text({ part: `${kind}_title`, time: "", list: "" }, { locale }));
  const body = escape(status_text({ part: `${kind}_body`, time: "", list: "" }, { locale }));
  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;font:16px/1.5 system-ui,sans-serif}main{max-width:40rem;margin:0 auto;padding:3rem 1.25rem}h1{font-size:1.5rem;margin:0 0 .5rem}</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": maxAge === undefined ? "no-store" : `public, max-age=${maxAge}`,
      [EDGE_HEADER]: "1",
    },
  });
}

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, ...fields }));
}
