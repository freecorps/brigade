// A status page's own domain (RFC 0012 "Custom domains"): the dashboard's routes that add, check and remove it, the
// public hostname → page lookup that serves it, and keeping that lookup in step with the shard's events.
//
// `GET|PUT|DELETE /workspaces/:id/status-page/domain` and `POST …/domain/check`. Owners and admins (`status:manage`,
// read in D1 first, so an outsider never wakes a shard or reaches Cloudflare). The hostname is claimed in D1
// (`status_custom_host`, unique across the instance) before Cloudflare is asked, as a slug is; the shard then keeps
// what the dashboard shows, through server-only mutations with their events. Off unless the instance has
// `CF_SAAS_TOKEN`, `CF_ZONE_ID`, `CF_SAAS_FALLBACK_ORIGIN` and `DASHBOARD_URL`: then every route answers
// `503 not_configured` and the dashboard hides the section.

import {
  allows,
  isStatusHostname,
  STATUS_SLUG,
  type StatusDomainRow,
} from "@freecorps/brigade-schema";
import type { Auth } from "./auth.ts";
import { unauthenticated } from "./api-tokens.ts";
import { checkMember, json, readJson } from "./member-route.ts";
import type { BrigadeEvent } from "./outbox.ts";
import {
  instanceHost,
  saasConfig,
  SaasClient,
  type Fetch,
  type SaasEnv,
  type SaasHostname,
} from "./status-domain-cf.ts";
import { missAllowed, rateLimitedPage, statusNotFound } from "./status-route.ts";
import type { TokenRefused } from "./workspace.ts";

/** The public lookup of a verified hostname: its page's slug, in the `STATUS` namespace. */
export const hostKey = (hostname: string) => `host:${hostname}`;
/** How long KV's own cache may keep a hostname's lookup, as for a snapshot. */
const HOST_CACHE_TTL_S = 30;

export type DomainEnv = Env & SaasEnv;

/** What a route refuses with, and its HTTP status. */
const REFUSALS = {
  not_configured: 503,
  invalid_hostname: 400,
  own_domain: 400,
  forbidden: 403,
  not_a_member: 403,
  rate_limited: 429,
  not_found: 404,
  domain_exists: 409,
  hostname_taken: 409,
  cloudflare_failed: 502,
  unavailable: 503,
} as const;
type Refusal = keyof typeof REFUSALS;
const refuse = (code: Refusal) => json({ error: code }, REFUSALS[code]);

/**
 * The hostname as Brigade keeps it, or why it is refused: lowercase, an internationalized name as punycode, no
 * trailing dot, nothing but a hostname (no scheme, port, path or address). The instance's own domain is refused, and
 * so is everything under it and every parent of the dashboard's hostname: a page must never answer for the
 * dashboard's origin, nor take a name the instance's zone already routes.
 */
export function normalizeHostname(
  raw: unknown,
  instance: string,
): { ok: true; hostname: string } | { ok: false; code: "invalid_hostname" | "own_domain" } {
  if (typeof raw !== "string") return { ok: false, code: "invalid_hostname" };
  const typed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (typed === "" || typed.length > 253 || /[\s/:@?#\\[\]%]/.test(typed)) {
    return { ok: false, code: "invalid_hostname" };
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${typed}/`).hostname;
  } catch {
    return { ok: false, code: "invalid_hostname" };
  }
  // The URL parser turns `1.2.3` or `0x7f.1` into an IPv4 address; any address ends in digits and is refused.
  if (!isStatusHostname(hostname)) return { ok: false, code: "invalid_hostname" };
  const own = ownDomain(instance);
  const parents = instance.split(".").map((_, index, labels) => labels.slice(index).join("."));
  if (hostname === own || hostname.endsWith(`.${own}`) || parents.includes(hostname)) {
    return { ok: false, code: "own_domain" };
  }
  return { ok: true, hostname };
}

/**
 * The instance's own domain, from the dashboard's hostname: the hostname itself when it has two labels
 * (`example.com`), else the hostname without its first label (`brigade.example.com` → `example.com`,
 * `brigade.example.com.br` → `example.com.br`). No public suffix list: dropping one label is the cautious guess.
 */
export function ownDomain(instance: string): string {
  const labels = instance.split(".");
  return labels.length <= 2 ? instance : labels.slice(1).join(".");
}

type Action = "get" | "add" | "check" | "remove";

/** `/workspaces/:id/status-page/domain[/check]`. `send` is Cloudflare's API (a fake in the tests). */
export async function statusDomainRoute(
  request: Request,
  env: DomainEnv,
  lazyAuth: () => Auth,
  workspaceId: string,
  check: boolean,
  send?: Fetch,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response> {
  const methods = check ? ["POST"] : ["GET", "PUT", "DELETE"];
  const action: Action = check
    ? "check"
    : request.method === "PUT"
      ? "add"
      : request.method === "DELETE"
        ? "remove"
        : "get";
  const member = await checkMember(
    request,
    env,
    lazyAuth,
    workspaceId,
    methods,
    action === "get" ? "status:read" : "status:manage",
    waitUntil,
  );
  if (!member.ok) return member.response;
  const config = saasConfig(env);
  if (action === "get") {
    return json(config ? { configured: true, target: config.target } : { configured: false });
  }
  if (!config) return refuse("not_configured");
  if (!allows(member.actor, "status:manage")) return refuse("forbidden");
  let hostname: string | undefined;
  if (action === "add") {
    const body = await readJson(request);
    const read = normalizeHostname(Object(body).hostname, instanceHost(env)!);
    if (!read.ok) return refuse(read.code);
    hostname = read.hostname;
  }
  if (!(await domainAllowed(env, workspaceId))) return refuse("rate_limited");
  const client = new SaasClient(config, send);
  const stub = env.WORKSPACE.getByName(workspaceId);
  const change = async (
    name: "add" | "check" | "remove",
    args: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; code: string } | TokenRefused> => {
    try {
      return await stub.changeStatusDomain(workspaceId, member.actor, name, args);
    } catch (error) {
      log("WorkspaceDO.changeStatusDomain failed", { workspaceId, name, error: String(error) });
      return { ok: false, code: "unavailable" };
    }
  };
  let state: Awaited<ReturnType<typeof stub.statusDomainState>>;
  try {
    state = await stub.statusDomainState(workspaceId);
  } catch (error) {
    log("WorkspaceDO.statusDomainState failed", { workspaceId, error: String(error) });
    return refuse("unavailable");
  }
  if (!state.page) return refuse("not_found");
  const current = state.domain;

  if (action === "add") {
    if (current) return refuse("domain_exists");
    const claim = await claimHost(env.DB, hostname!, workspaceId);
    if (claim === "taken") return refuse("hostname_taken");
    if (claim === "failed") return refuse("unavailable");
    const created = await client.create(hostname!);
    if (!created.ok) {
      await releaseHost(env.DB, hostname!, workspaceId);
      if (created.code === "taken") return refuse("hostname_taken");
      log("creating a custom hostname failed", { workspaceId, message: created.message });
      return refuse("cloudflare_failed");
    }
    const added = await change("add", {
      hostname: hostname!,
      cloudflareId: created.value.id,
      ...shown(created.value),
    });
    if (!added.ok) {
      // Nothing kept, so nothing left behind: Cloudflare's hostname and the claim go again.
      await client.remove(created.value.id);
      await releaseHost(env.DB, hostname!, workspaceId);
      if (added.code === "unauthenticated") return unauthenticated();
      return refuse(added.code === "conflict" ? "domain_exists" : refusal(added.code));
    }
    return json({ ok: true, hostname: hostname!, ...shown(created.value) });
  }

  if (!current) return refuse("not_found");
  if (action === "check") {
    const answer = await client.get(current.cloudflareId);
    const seen: Pick<SaasHostname, "state" | "records" | "error"> | undefined = answer.ok
      ? answer.value
      : answer.code === "not_found"
        ? {
            state: "failed",
            records: current.records,
            error: "Cloudflare no longer has this hostname",
          }
        : undefined;
    if (!seen) {
      log("checking a custom hostname failed", {
        workspaceId,
        message: answer.ok ? "" : answer.message,
      });
      return refuse("cloudflare_failed");
    }
    const checked = await change("check", { hostname: current.hostname, ...shown(seen) });
    if (!checked.ok) {
      return checked.code === "unauthenticated" ? unauthenticated() : refuse(refusal(checked.code));
    }
    return json({ ok: true, hostname: current.hostname, ...shown(seen) });
  }

  // Removing: Cloudflare first, so a domain the dashboard no longer shows never keeps serving.
  const removed = await client.remove(current.cloudflareId);
  if (!removed.ok) {
    log("deleting a custom hostname failed", { workspaceId, message: removed.message });
    return refuse("cloudflare_failed");
  }
  const gone = await change("remove", { hostname: current.hostname });
  if (!gone.ok && gone.code !== "not_found") {
    return gone.code === "unauthenticated" ? unauthenticated() : refuse(refusal(gone.code));
  }
  await releaseHost(env.DB, current.hostname, workspaceId);
  return json({ ok: true });
}

const shown = (value: Pick<SaasHostname, "state" | "records" | "error">) => ({
  state: value.state,
  records: value.records,
  error: value.error,
});

function refusal(code: string): Refusal {
  return code in REFUSALS ? (code as Refusal) : "unavailable";
}

/** Workers Rate Limiting per workspace (`STATUS_DOMAIN_LIMIT`): each change calls Cloudflare's API. */
async function domainAllowed(env: DomainEnv, workspaceId: string): Promise<boolean> {
  const limiter = env.STATUS_DOMAIN_LIMIT as RateLimit | undefined;
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key: workspaceId })).success;
  } catch (error) {
    log("the status domain limit failed", { error: String(error) });
    return true;
  }
}

/** Claims `hostname` for the workspace in D1; `taken` when another holds it. */
async function claimHost(
  db: D1Database,
  hostname: string,
  workspaceId: string,
): Promise<"claimed" | "taken" | "failed"> {
  try {
    const [, holder] = await db.batch([
      db
        .prepare(
          `insert into status_custom_host (hostname, workspace_id, created_at) values (?, ?, ?)
           on conflict (hostname) do nothing`,
        )
        .bind(hostname, workspaceId, Date.now()),
      db.prepare("select workspace_id from status_custom_host where hostname = ?").bind(hostname),
    ]);
    const owner = (holder?.results[0] as { workspace_id?: string } | undefined)?.workspace_id;
    return owner === workspaceId ? "claimed" : "taken";
  } catch (error) {
    log("claiming a custom hostname failed", { error: String(error) });
    return "failed";
  }
}

/** Gives a hostname this workspace holds back to D1; a failure only leaves it held (logged). */
async function releaseHost(db: D1Database, hostname: string, workspaceId: string): Promise<void> {
  try {
    await db
      .prepare("delete from status_custom_host where hostname = ? and workspace_id = ?")
      .bind(hostname, workspaceId)
      .run();
  } catch (error) {
    log("releasing a custom hostname failed", { hostname, error: String(error) });
  }
}

/**
 * A request to a custom hostname, turned into the page's own route: `/` is `/status/<slug>`, and `/status/<slug>/…`
 * (feeds, subscribing, confirming, managing) is kept; nothing else of the API answers there. Undefined for the
 * dashboard's own hostname, or when custom domains are off, so every other route works exactly as before. A hostname
 * with no verified page is the 404 page (a miss, counted like any other).
 */
export async function customHostRequest(
  request: Request,
  env: DomainEnv,
): Promise<Request | Response | undefined> {
  if (!saasConfig(env)) return undefined;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === instanceHost(env)) return undefined;
  const notFound = async () =>
    (await missAllowed(request, env)) ? statusNotFound() : rateLimitedPage();
  if (!env.STATUS || !isStatusHostname(host)) return notFound();
  let slug: string | null;
  try {
    slug = await env.STATUS.get(hostKey(host), { cacheTtl: HOST_CACHE_TTL_S });
  } catch (error) {
    log("reading a custom hostname failed", { host, error: String(error) });
    return new Response("Service unavailable", { status: 503 });
  }
  if (!slug || !STATUS_SLUG.test(slug)) return notFound();
  const own = `/status/${slug}`;
  if (url.pathname === "/") url.pathname = own;
  else if (url.pathname !== own && !url.pathname.startsWith(`${own}/`)) return notFound();
  return new Request(url, request);
}

/** Events that move a hostname's lookup: a domain added, checked or removed, and the page's slug or visibility. */
const HOST_EVENTS = new Set([
  "status_domain.added",
  "status_domain.checked",
  "status_domain.removed",
  "status_page.configured",
]);

export const asksForStatusHost = (event: BrigadeEvent) => HOST_EVENTS.has(event.type);

/**
 * Keeps the public lookup in step (from the queue consumer): reads the shard's domain and page as they are now, never
 * the event's copy, so events handled late or twice leave the latest state. A hostname is served (`host:<name>` =
 * the slug) only while it is active at Cloudflare, held by this workspace in D1 and its page is public; else its key is
 * deleted. A hostname another workspace holds by now is left to that workspace's events. Throws on a failure, so the
 * message is retried.
 */
export async function syncStatusHost(
  event: BrigadeEvent,
  env: { WORKSPACE: Env["WORKSPACE"]; DB?: D1Database; STATUS?: KVNamespace },
): Promise<void> {
  const { DB: db, STATUS: kv } = env;
  if (!kv || !db) return;
  const state = await env.WORKSPACE.getByName(event.workspaceId).statusDomainState(
    event.workspaceId,
  );
  const named = Reflect.get(Object(event.data), "hostname");
  const hostnames = new Set<string>();
  if (typeof named === "string" && isStatusHostname(named)) hostnames.add(named);
  if (state.domain) hostnames.add(state.domain.hostname);
  for (const hostname of hostnames) {
    const holder = await db
      .prepare("select workspace_id from status_custom_host where hostname = ?")
      .bind(hostname)
      .first<{ workspace_id: string }>();
    if (holder && holder.workspace_id !== event.workspaceId) continue;
    const serve =
      holder !== null &&
      state.domain?.hostname === hostname &&
      state.domain.state === "active" &&
      state.page?.public === true;
    if (serve) await kv.put(hostKey(hostname), state.page!.slug);
    else await kv.delete(hostKey(hostname));
  }
}

/** The domain row and the page as the lookup needs them (`WorkspaceDO.statusDomainState`). */
export type StatusDomainView = {
  domain: StatusDomainRow | null;
  page: { slug: string; public: boolean } | null;
};

function log(message: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ message, ...fields }));
}
