// What this Worker needs of the API (RFC 0012 "Custom domains"): the `StatusPages` entrypoint (apps/api
// src/status-pages.ts) implements it, and the `host:<hostname>` value in `STATUS` (apps/api src/status-domain.ts) is
// a `StatusHost`. Types and a reader only, so the API can import them without this Worker's code.

import { STATUS_SLUG } from "@freecorps/brigade-schema";

/** The KV key a custom hostname's lookup lives under, in the API's `STATUS` namespace. */
export const hostKey = (hostname: string) => `host:${hostname}`;

/**
 * On every answer this Worker makes itself: how the API tells, reaching `/robots.txt` at a dedicated hostname
 * (apps/api src/status-domain-edge.ts), that this Worker answers there, whatever page it would serve.
 */
export const EDGE_HEADER = "X-Brigade-Status-Edge";

/** Which page a custom hostname serves: the slug, and the workspace whose page it must still be. */
export type StatusHost = { workspaceId: string; slug: string };

/** A workspace id (apps/api src/workspace.ts `ORGANIZATION_ID`). */
const WORKSPACE_ID = /^ws_[0-9A-HJKMNP-TV-Z]{26}$/;

/** The lookup as stored, or undefined when it is missing or not one this Worker can read (both a miss). */
export function readStatusHost(value: unknown): StatusHost | undefined {
  const workspaceId: unknown = Reflect.get(Object(value), "workspaceId");
  const slug: unknown = Reflect.get(Object(value), "slug");
  if (typeof workspaceId !== "string" || !WORKSPACE_ID.test(workspaceId)) return undefined;
  if (typeof slug !== "string" || !STATUS_SLUG.test(slug)) return undefined;
  return { workspaceId, slug };
}

export interface StatusPagesApi {
  /**
   * Answers `request`, as the visitor sent it (its URL on the custom hostname, its headers, so the subscribe form's
   * Origin check holds), for the page `host` names only: `/` is the page, `/status/<slug>` and its feeds and
   * subscription routes are kept, anything else is the 404 page. Renders and caches as `/status/<slug>` does.
   */
  serve(request: Request, host: StatusHost): Promise<Response>;
}
