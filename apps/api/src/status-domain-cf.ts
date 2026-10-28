// Cloudflare for SaaS custom hostnames (RFC 0012 "Custom domains"): the few calls a status page's own domain needs,
// made by the API with the operator's scoped token (`CF_SAAS_TOKEN`, "SSL and Certificates: Edit" on `CF_ZONE_ID`).
// Nothing else in Brigade talks to Cloudflare's REST API; every call has its own deadline.

import type { StatusDomainRecord, StatusDomainState } from "@freecorps/brigade-schema";

const API = "https://api.cloudflare.com/client/v4";
/** One call to Cloudflare's API waits at most this long. */
export const CF_CALL_MS = 5000;

/** What the routes need of the instance's configuration; any of them missing and the feature is off. */
export type SaasConfig = { token: string; zoneId: string; target: string };

export type SaasEnv = {
  CF_SAAS_TOKEN?: string;
  CF_ZONE_ID?: string;
  CF_SAAS_FALLBACK_ORIGIN?: string;
  DASHBOARD_URL?: string;
};

/** The instance's custom hostname settings, or undefined when it has none (or no `DASHBOARD_URL` to tell its own). */
export function saasConfig(env: SaasEnv): SaasConfig | undefined {
  const token = env.CF_SAAS_TOKEN?.trim();
  const zoneId = env.CF_ZONE_ID?.trim();
  const target = env.CF_SAAS_FALLBACK_ORIGIN?.trim().toLowerCase();
  if (!token || !zoneId || !target || !instanceHost(env)) return undefined;
  return { token, zoneId, target };
}

/** The dashboard's hostname, the instance's own. */
export function instanceHost(env: SaasEnv): string | undefined {
  try {
    return env.DASHBOARD_URL ? new URL(env.DASHBOARD_URL).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export type Fetch = (request: Request) => Promise<Response>;

/** What Cloudflare said about a hostname, in the dashboard's words. */
export type SaasHostname = {
  id: string;
  state: StatusDomainState;
  records: StatusDomainRecord[];
  error: string | null;
};

export type SaasResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: "taken" | "not_found" | "failed"; message: string };

type Raw = {
  id?: unknown;
  hostname?: unknown;
  status?: unknown;
  ssl?: { status?: unknown; validation_errors?: unknown };
  ownership_verification?: { type?: unknown; name?: unknown; value?: unknown };
  verification_errors?: unknown;
};

const FAILED = new Set([
  "moved",
  "deleted",
  "blocked",
  "pending_blocked",
  "test_blocked",
  "test_failed",
]);

/** Cloudflare's answer, read: active once the hostname and its certificate are, failed when it gave up, else pending. */
export function readHostname(raw: Raw, target: string): SaasHostname | undefined {
  if (typeof raw.id !== "string" || typeof raw.hostname !== "string") return undefined;
  const status = typeof raw.status === "string" ? raw.status : "";
  const ssl = typeof raw.ssl?.status === "string" ? raw.ssl.status : "";
  const errors = [
    ...(Array.isArray(raw.verification_errors) ? raw.verification_errors : []),
    ...(Array.isArray(raw.ssl?.validation_errors) ? raw.ssl.validation_errors : []),
  ].flatMap((one: unknown) =>
    typeof one === "string"
      ? [one]
      : typeof Object(one).message === "string"
        ? [String(Object(one).message)]
        : [],
  );
  const state: StatusDomainState =
    status === "active" && ssl === "active"
      ? "active"
      : FAILED.has(status) || ssl.endsWith("_timed_out") || ssl === "expired"
        ? "failed"
        : "pending";
  const records: StatusDomainRecord[] = [{ type: "CNAME", name: raw.hostname, value: target }];
  const own = raw.ownership_verification;
  if (own?.type === "txt" && typeof own.name === "string" && typeof own.value === "string") {
    records.push({ type: "TXT", name: own.name, value: own.value });
  }
  return {
    id: raw.id,
    state,
    records,
    error: state === "active" ? null : (errors[0]?.slice(0, 300) ?? null),
  };
}

/** A small client for `/zones/:zone/custom_hostnames`, with `fetch` given (a fake in the tests). */
export class SaasClient {
  constructor(
    private readonly config: SaasConfig,
    private readonly send: Fetch = (request) => fetch(request),
  ) {}

  /** Adds `hostname`, its certificate validated over HTTP once the CNAME points here (`ssl.method: http`). */
  create(hostname: string): Promise<SaasResult<SaasHostname>> {
    return this.call("POST", "", {
      hostname,
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
  }

  get(id: string): Promise<SaasResult<SaasHostname>> {
    return this.call("GET", `/${encodeURIComponent(id)}`);
  }

  /** Deletes it; one Cloudflare no longer has counts as deleted. */
  async remove(id: string): Promise<SaasResult<null>> {
    const result = await this.call("DELETE", `/${encodeURIComponent(id)}`, undefined, true);
    if (result.ok || result.code === "not_found") return { ok: true, value: null };
    return result;
  }

  private async call<T = SaasHostname>(
    method: string,
    path: string,
    body?: unknown,
    bare = false,
  ): Promise<SaasResult<T>> {
    const url = `${API}/zones/${encodeURIComponent(this.config.zoneId)}/custom_hostnames${path}`;
    let response: Response;
    try {
      response = await this.send(
        new Request(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(CF_CALL_MS),
        }),
      );
    } catch (error) {
      return { ok: false, code: "failed", message: String(error) };
    }
    let parsed: { success?: unknown; errors?: unknown; result?: unknown };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      return { ok: false, code: "failed", message: `HTTP ${response.status}` };
    }
    const errors = Array.isArray(parsed.errors)
      ? (parsed.errors as { code?: unknown; message?: unknown }[])
      : [];
    const message =
      errors.map((one) => String(one.message ?? one.code)).join("; ") || `HTTP ${response.status}`;
    if (!response.ok || parsed.success !== true) {
      // 1406: another zone or customer already has the hostname; 1436 and 404: no such custom hostname.
      if (errors.some((one) => one.code === 1406)) return { ok: false, code: "taken", message };
      if (response.status === 404 || errors.some((one) => one.code === 1436)) {
        return { ok: false, code: "not_found", message };
      }
      return { ok: false, code: "failed", message };
    }
    if (bare) return { ok: true, value: null as T };
    const read = readHostname(Object(parsed.result) as Raw, this.config.target);
    if (!read) return { ok: false, code: "failed", message: "unreadable answer" };
    return { ok: true, value: read as T };
  }
}
