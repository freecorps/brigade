// The paging self-check (apps/api src/watchdog.ts, RFC 0007 "Watching the watcher"): whether a heartbeat made it
// through the outbox, the queue, the consumer and the relay lately. Pure functions here; the notice lives in
// src/components/paging-health.tsx.

export const PAGING_HEALTH_PATH = "/api/health/paging";
/** The watchdog beats once a minute, so checking more often than that shows nothing new. */
export const PAGING_REFRESH_MS = 60_000;

export const DEGRADED_REASONS = [
  "no_beat",
  "pipeline_stalled",
  "pipeline_slow",
  "relay_unauthorized",
  "relay_unreachable",
  "relay_not_configured",
  "relay_bad_signature",
  "relay_instance_unregistered",
  "relay_instance_revoked",
  "relay_rate_limited",
  "relay_handles_unavailable",
  "apns_failing",
  "fcm_failing",
  "d1_failing",
] as const;
export type DegradedReason = (typeof DEGRADED_REASONS)[number];

/**
 * Which relay pages go through (RFC 0015 section 8): none, Freecorps' relay (the store app) or the company's own (its
 * own app build), with the relay's host when the instance has its address and an own build's link when set.
 */
export type RelaySetup =
  | { kind: "none" }
  | { kind: "freecorps" | "own"; host: string | null; app: string | null };

export type PagingHealth = {
  status: "ok" | "degraded" | "unknown";
  reasons: DegradedReason[];
  /** The last time a heartbeat got all the way through, relay token included. */
  lastOkAt: Date | null;
  /** Which relay pages go through; null when the API did not say (no session, an older API). */
  relay: RelaySetup | null;
};

/**
 * What the dashboard shows: nothing while it loads or when all is well, the reasons when degraded, a neutral note
 * before the first check, and `unreachable` when the API could not say (the watchdog itself down counts as degraded:
 * the API answers 503).
 */
export type PagingView =
  | { kind: "hidden" }
  | { kind: "unknown" }
  | { kind: "degraded"; reasons: DegradedReason[]; lastOkAt: Date | null }
  | { kind: "unreachable" };

/**
 * The API's answer. Without a session (one that just expired, say) it is `{ status }` alone, which still shows the
 * notice, without the reasons.
 */
export function parsePagingHealth(body: unknown): PagingHealth | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { status, reasons = [], lastOkAt, relay } = body as Record<string, unknown>;
  if (status !== "ok" && status !== "degraded" && status !== "unknown") return undefined;
  if (!Array.isArray(reasons)) return undefined;
  const ok = typeof lastOkAt === "string" ? new Date(lastOkAt) : null;
  return {
    status,
    // Reasons a newer API adds are left out rather than shown blank.
    reasons: reasons.filter((reason): reason is DegradedReason =>
      (DEGRADED_REASONS as readonly unknown[]).includes(reason),
    ),
    lastOkAt: ok && !Number.isNaN(ok.getTime()) ? ok : null,
    relay: parseRelay(relay),
  };
}

/** `relay` as the API gives it; anything not that shape is "not said" rather than shown wrong. */
export function parseRelay(body: unknown): RelaySetup | null {
  if (typeof body !== "object" || body === null) return null;
  const { kind, host, app } = body as Record<string, unknown>;
  if (kind === "none") return { kind };
  if (kind !== "freecorps" && kind !== "own") return null;
  return {
    kind,
    host: typeof host === "string" && host.trim() !== "" ? host : null,
    // A link is shown and followed: https only, so a `javascript:` URL can never reach an href.
    app: kind === "own" && typeof app === "string" && isHttps(app) ? app : null,
  };
}

function isHttps(raw: string): boolean {
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

export function pagingView(health: PagingHealth | "unreachable" | undefined): PagingView {
  if (health === undefined) return { kind: "hidden" };
  if (health === "unreachable") return { kind: "unreachable" };
  if (health.status === "ok") return { kind: "hidden" };
  if (health.status === "unknown") return { kind: "unknown" };
  return { kind: "degraded", reasons: health.reasons, lastOkAt: health.lastOkAt };
}

/** One check; never throws. A network failure, an error answer or a body that is not the shape is `unreachable`. */
export async function fetchPagingHealth(
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<PagingHealth | "unreachable"> {
  try {
    const response = await fetcher(PAGING_HEALTH_PATH, {
      signal,
      // The reasons and times need the session (apps/api `pagingHealthFor`).
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return "unreachable";
    return parsePagingHealth(await response.json()) ?? "unreachable";
  } catch {
    return "unreachable";
  }
}
