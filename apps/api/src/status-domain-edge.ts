// A dedicated hostname (RFC 0012 "Custom domains"): one the instance's operator attached to the status page edge
// (`brigade-status-edge`) as a Workers Custom Domain and listed in `STATUS_HOSTNAMES`, so Cloudflare for SaaS is never
// asked about it. Brigade checks it by reaching `/robots.txt` there: the edge answers that itself, reading nothing,
// with its `EDGE_HEADER`. A misconfiguration, not an adversary, is what this catches: a hostname listed but never
// attached shows pending on the dashboard instead of an active domain that serves nothing, and one detached later goes
// back to pending once the edge has stopped answering there for a while.

import type { StatusDomainError, StatusDomainState } from "@freecorps/brigade-schema";
import { EDGE_HEADER } from "@freecorps/brigade-status-edge/api";
import { CF_CALL_MS, type Fetch } from "./status-domain-cf.ts";

/** The operator's dedicated hostnames, comma-separated; read by `dedicatedHostnames` (src/status-domain.ts). */
export type DedicatedEnv = { STATUS_HOSTNAMES?: string; DASHBOARD_URL?: string };

/**
 * An active dedicated domain goes back to pending only once the edge has not answered this many checks in a row, the
 * alarm's backoff between them (1 minute, doubling to an hour): about two hours. One answer that is not the edge's (a
 * WAF rule's 403, a rate limit's 429, an Access redirect, Cloudflare's own error page, a timeout) never takes a page
 * down; a Custom Domain detached for good still shows on the dashboard within hours.
 */
export const EDGE_MISSES_MAX = 8;

/**
 * Whether the edge answers at the hostname: `https://<hostname>/robots.txt`, redirects not followed, within
 * `CF_CALL_MS`, carries `EDGE_HEADER`. Anything else (another site, an error page, no answer) is false. Never throws.
 */
export async function edgeAnswers(hostname: string, send: Fetch): Promise<boolean> {
  let response: Response;
  try {
    response = await send(
      new Request(`https://${hostname}/robots.txt`, {
        redirect: "manual",
        signal: AbortSignal.timeout(CF_CALL_MS),
      }),
    );
  } catch {
    return false;
  }
  // Only the header counts; the body is never read, nor its cancelling waited for.
  void response.body?.cancel().catch(() => {});
  return response.headers.get(EDGE_HEADER) === "1";
}

/**
 * The domain's state after reaching the edge, or null to leave it as it is: active once the edge answers; a new or
 * pending one stays pending (`not_attached`) until then; an active one is never set back by one answer alone (the
 * alarm counts the misses, `EDGE_MISSES_MAX`). A dedicated hostname is never `failed`: nobody gives up on it.
 */
export function probedState(
  current: StatusDomainState | null,
  attached: boolean,
): { state: StatusDomainState; error: StatusDomainError | null } | null {
  if (attached) return { state: "active", error: null };
  if (current === "active") return null;
  return { state: "pending", error: "not_attached" };
}
