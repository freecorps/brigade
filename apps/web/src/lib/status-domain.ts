// A status page's own domain on the dashboard (RFC 0012 "Custom domains"): the API's routes, which ask Cloudflare for
// the hostname. Pure apart from `fetch`; tested in test/status-domain.test.tsx.

const path = (workspaceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/status-page/domain`;

/** Whether the instance can serve custom domains, and the hostname owners point their CNAME at. */
export type DomainConfig = { configured: false } | { configured: true; target: string };

/** Why a change was refused, as the API says it (anything else is `failed`). */
export type DomainError =
  | "not_configured"
  | "invalid_hostname"
  | "own_domain"
  | "forbidden"
  | "rate_limited"
  | "not_found"
  | "domain_exists"
  | "hostname_taken"
  | "cloudflare_failed"
  | "failed";

const KNOWN: DomainError[] = [
  "not_configured",
  "invalid_hostname",
  "own_domain",
  "forbidden",
  "rate_limited",
  "not_found",
  "domain_exists",
  "hostname_taken",
  "cloudflare_failed",
];

/** `GET …/status-page/domain`: null when it cannot be read (the section stays hidden). */
export async function loadDomainConfig(
  workspaceId: string,
  fetcher: typeof fetch = fetch,
): Promise<DomainConfig | null> {
  try {
    const response = await fetcher(path(workspaceId), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const body = (await response.json()) as { configured?: unknown; target?: unknown };
    if (body.configured === true && typeof body.target === "string") {
      return { configured: true, target: body.target };
    }
    return body.configured === false ? { configured: false } : null;
  } catch {
    return null;
  }
}

async function change(
  url: string,
  method: string,
  body: unknown,
  fetcher: typeof fetch,
): Promise<{ ok: true } | { ok: false; error: DomainError }> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "failed" };
  }
  if (response.ok) return { ok: true };
  const answer = (await response.json().catch(() => ({}))) as { error?: unknown };
  return { ok: false, error: KNOWN.find((code) => code === answer.error) ?? "failed" };
}

/** `PUT …/domain` `{ hostname }`. */
export const addDomain = (workspaceId: string, hostname: string, fetcher: typeof fetch = fetch) =>
  change(path(workspaceId), "PUT", { hostname }, fetcher);

/** `POST …/domain/check`: asks Cloudflare again. */
export const checkDomain = (workspaceId: string, fetcher: typeof fetch = fetch) =>
  change(`${path(workspaceId)}/check`, "POST", undefined, fetcher);

/** `DELETE …/domain`. */
export const removeDomain = (workspaceId: string, fetcher: typeof fetch = fetch) =>
  change(path(workspaceId), "DELETE", undefined, fetcher);
