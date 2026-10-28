// A status page's own domain (RFC 0012 "Custom domains"): the dashboard's routes that add, check and remove it, and
// keeping the public hostname → page lookup (`host:<hostname>` in `STATUS`, read by apps/status-edge) in step with the
// shard's events. The API Worker never serves a custom hostname itself: the edge Worker does, through the
// `StatusPages` entrypoint (src/status-pages.ts).
//
// `GET|PUT|DELETE /workspaces/:id/status-page/domain` and `POST …/domain/check`. Owners and admins (`status:manage`,
// read in D1 first, so an outsider never wakes a shard or reaches Cloudflare). The hostname is claimed in D1
// (`status_custom_host`, unique across the instance) before Cloudflare is asked, as a slug is; the shard then keeps
// what the dashboard shows, through server-only mutations with their events. Off unless the instance has
// `CF_SAAS_TOKEN`, `CF_ZONE_ID`, `CF_SAAS_FALLBACK_ORIGIN` and `DASHBOARD_URL`: then every route answers
// `503 not_configured` and the dashboard hides the section.

import { allows, isStatusHostname, type StatusDomainRow } from "@freecorps/brigade-schema";
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
import type { StatusHost } from "@freecorps/brigade-status-edge/api";
import type { TokenRefused } from "./workspace.ts";

/**
 * The public lookup of a verified hostname, in the `STATUS` namespace: `{ workspaceId, slug }` (`StatusHost`), which
 * the edge Worker hands to `StatusPages.serve`; the snapshot under the slug is served only while it is that
 * workspace's.
 */
export const hostKey = (hostname: string) => `host:${hostname}`;

/**
 * A claim this long-lived with no domain on the page behind it is left over (an add whose Cloudflare call or rollback
 * failed): the workspace may claim it again. Well past an add's longest run (three Cloudflare calls of `CF_CALL_MS`,
 * D1 and the shard), so an add still under way is never taken over.
 */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

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
  apex: 400,
  domain_exists: 409,
  hostname_taken: 409,
  in_progress: 409,
  cloudflare_failed: 502,
  unavailable: 503,
} as const;
type Refusal = keyof typeof REFUSALS;
const refuse = (code: Refusal) => json({ error: code }, REFUSALS[code]);

/**
 * The hostname as Brigade keeps it, or why it is refused: lowercase, an internationalized name as punycode, no
 * trailing dot, nothing but a hostname (no scheme, port, path or address). The instance's own domain is refused, and
 * so is everything under it and every parent of the dashboard's hostname: a page must never answer for the
 * dashboard's origin, nor take a name the instance's zone already routes. Likewise the fallback origin (`target`),
 * its domain and everything under it: the SaaS zone is the instance's. A two-label name (`example.com`) is refused
 * (`apex`): a CNAME cannot sit at a zone's apex without CNAME flattening, so a page takes a subdomain.
 */
export function normalizeHostname(
  raw: unknown,
  instance: string,
  target?: string,
):
  | { ok: true; hostname: string }
  | { ok: false; code: "invalid_hostname" | "own_domain" | "apex" } {
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
  for (const ours of target ? [instance, target] : [instance]) {
    const own = ownDomain(ours);
    const parents = ours.split(".").map((_, index, labels) => labels.slice(index).join("."));
    if (hostname === own || hostname.endsWith(`.${own}`) || parents.includes(hostname)) {
      return { ok: false, code: "own_domain" };
    }
  }
  if (hostname.split(".").length === 2) return { ok: false, code: "apex" };
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
    const read = normalizeHostname(Object(body).hostname, instanceHost(env)!, config.target);
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
    const name = hostname!;
    const claim = await claimHost(env.DB, name, workspaceId, Date.now());
    if (claim === "taken") return refuse("hostname_taken");
    if (claim === "busy") return refuse("in_progress");
    if (claim === "failed") return refuse("unavailable");
    const stamp = claim.stamp;
    const made = await createOrAdopt(client, name, workspaceId);
    if (!made.ok) {
      // Released only when Cloudflare surely has no hostname of ours under the name; else kept and logged, and the
      // workspace's next add after `CLAIM_STALE_MS` finds and adopts it.
      if (made.release) await releaseHost(env.DB, name, workspaceId, stamp);
      return refuse(made.code);
    }
    const added = await change("add", {
      hostname: name,
      cloudflareId: made.value.id,
      ...shown(made.value),
    });
    if (!added.ok) {
      // Nothing kept, so nothing left behind: Cloudflare's hostname goes, then the claim. A delete Cloudflare refuses
      // keeps the claim, so no other workspace takes a name with a hostname of ours still under it.
      const removed = await client.remove(made.value.id);
      if (removed.ok) await releaseHost(env.DB, name, workspaceId, stamp);
      else {
        log("deleting a custom hostname after a refused add failed; the claim is kept", {
          workspaceId,
          hostname: name,
          cloudflareId: made.value.id,
          error: removed.message,
        });
      }
      if (added.code === "unauthenticated") return unauthenticated();
      return refuse(added.code === "conflict" ? "domain_exists" : refusal(added.code));
    }
    return json({ ok: true, hostname: name, ...shown(made.value) });
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
            error: "deleted",
          }
        : undefined;
    if (!seen) {
      log("checking a custom hostname failed", {
        workspaceId,
        error: answer.ok ? "" : answer.message,
      });
      return refuse("cloudflare_failed");
    }
    const checked = await change("check", { hostname: current.hostname, ...shown(seen) });
    if (!checked.ok) {
      return checked.code === "unauthenticated" ? unauthenticated() : refuse(refusal(checked.code));
    }
    return json({ ok: true, hostname: current.hostname, ...shown(seen) });
  }

  // Removing: Cloudflare first, so a domain the dashboard no longer shows never keeps serving. The claim released is
  // only one stamped before this began: a claim made since is another add's.
  const startedAt = Date.now();
  const removed = await client.remove(current.cloudflareId);
  if (!removed.ok) {
    log("deleting a custom hostname failed", { workspaceId, error: removed.message });
    return refuse("cloudflare_failed");
  }
  const gone = await change("remove", { hostname: current.hostname });
  if (!gone.ok && gone.code !== "not_found") {
    return gone.code === "unauthenticated" ? unauthenticated() : refuse(refusal(gone.code));
  }
  await releaseHost(env.DB, current.hostname, workspaceId, startedAt, "up to");
  return json({ ok: true });
}

type Made =
  | { ok: true; value: SaasHostname }
  | { ok: false; code: "hostname_taken" | "cloudflare_failed"; release: boolean };

/**
 * Creates the custom hostname, or adopts the one this zone has under the name already: a create that failed or timed
 * out may have landed anyway, and a duplicate (1406) may be this zone's own (an earlier add whose rollback failed).
 * Only called with the name claimed for the workspace, so a hostname of this zone under it is the workspace's to use.
 * `release`: whether Cloudflare surely has none of ours under the name, so the claim may go.
 */
async function createOrAdopt(
  client: SaasClient,
  hostname: string,
  workspaceId: string,
): Promise<Made> {
  const created = await client.create(hostname);
  if (created.ok) return created;
  const found = await client.find(hostname);
  if (!found.ok) {
    log("looking up a custom hostname after a failed create failed; the claim is kept", {
      workspaceId,
      hostname,
      create: created.message,
      error: found.message,
    });
    return { ok: false, code: "cloudflare_failed", release: false };
  }
  if (found.value) {
    log("adopted a custom hostname Cloudflare already had", {
      workspaceId,
      hostname,
      after: created.code,
    });
    return { ok: true, value: found.value };
  }
  // Another zone or customer has it.
  if (created.code === "taken") return { ok: false, code: "hostname_taken", release: true };
  log("creating a custom hostname failed", { workspaceId, error: created.message });
  return { ok: false, code: "cloudflare_failed", release: true };
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

/**
 * Claims `hostname` for this add in D1, stamped `now` (`created_at`), which only this add releases. Claimed only when
 * the row was written: a free name, or one this workspace's earlier add left behind (`CLAIM_STALE_MS`, taken over
 * only if nobody took it over first). `taken` when another workspace holds it; `busy` when another add of this
 * workspace holds it now, so a losing concurrent add never releases the winner's claim.
 */
async function claimHost(
  db: D1Database,
  hostname: string,
  workspaceId: string,
  now: number,
): Promise<{ stamp: number } | "taken" | "busy" | "failed"> {
  try {
    const inserted = await db
      .prepare(
        `insert into status_custom_host (hostname, workspace_id, created_at) values (?, ?, ?)
         on conflict (hostname) do nothing`,
      )
      .bind(hostname, workspaceId, now)
      .run();
    if (inserted.meta.changes === 1) return { stamp: now };
    const holder = await db
      .prepare("select workspace_id, created_at from status_custom_host where hostname = ?")
      .bind(hostname)
      .first<{ workspace_id: string; created_at: number }>();
    // Released meanwhile: asking again is the caller's to do.
    if (!holder) return "busy";
    if (holder.workspace_id !== workspaceId) return "taken";
    if (holder.created_at > now - CLAIM_STALE_MS) return "busy";
    const taken = await db
      .prepare(
        `update status_custom_host set created_at = ?
         where hostname = ? and workspace_id = ? and created_at = ?`,
      )
      .bind(now, hostname, workspaceId, holder.created_at)
      .run();
    return taken.meta.changes === 1 ? { stamp: now } : "busy";
  } catch (error) {
    log("claiming a custom hostname failed", { error: String(error) });
    return "failed";
  }
}

/**
 * Gives a hostname back to D1: the claim stamped `stamp` exactly (an add's own), or any stamped up to it (a removal,
 * which never releases a claim made after it began). A failure only leaves it held (logged).
 */
async function releaseHost(
  db: D1Database,
  hostname: string,
  workspaceId: string,
  stamp: number,
  match: "exactly" | "up to" = "exactly",
): Promise<void> {
  try {
    await db
      .prepare(
        `delete from status_custom_host where hostname = ? and workspace_id = ? and created_at ${
          match === "exactly" ? "=" : "<="
        } ?`,
      )
      .bind(hostname, workspaceId, stamp)
      .run();
  } catch (error) {
    log("releasing a custom hostname failed", { hostname, error: String(error) });
  }
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
 * `{ workspaceId, slug }`) only while it is active at Cloudflare, held by this workspace in D1 and its page is public; else its key is
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
    if (serve) {
      const host: StatusHost = { workspaceId: event.workspaceId, slug: state.page!.slug };
      await kv.put(hostKey(hostname), JSON.stringify(host));
    } else await kv.delete(hostKey(hostname));
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
