// A status page's own domain (RFC 0012 "Custom domains"): the dashboard's routes that add, check and remove it, and
// keeping the public hostname → page lookup (`host:<hostname>` in `STATUS`, read by apps/status-edge) in step with the
// shard's events. The API Worker never serves a custom hostname itself: the edge Worker does, through the
// `StatusPages` entrypoint (src/status-pages.ts).
//
// `GET|PUT|DELETE /workspaces/:id/status-page/domain` and `POST …/domain/check`. Owners and admins (`status:manage`,
// read in D1 first, so an outsider never wakes a shard or reaches Cloudflare). The hostname is claimed in D1
// (`status_custom_host`, unique across the instance) before Cloudflare is asked, as a slug is; the shard then keeps
// what the dashboard shows, through server-only mutations with their events.
//
// Two ways to serve one, each optional, both needing `DASHBOARD_URL`. Cloudflare for SaaS custom hostnames
// (`CF_SAAS_TOKEN`, `CF_ZONE_ID`, `CF_SAAS_FALLBACK_ORIGIN`): any hostname an owner points a CNAME at. Dedicated
// hostnames (`STATUS_HOSTNAMES`): the ones the operator attached to the edge Worker themselves, which Cloudflare is
// never asked about (src/status-domain-edge.ts) and which may sit under the instance's own domain, since the operator
// chose them. With neither, every route but `GET` answers `503 not_configured` and the dashboard hides the section.

import {
  allows,
  isStatusHostname,
  STATUS_DOMAIN_SQUAT_MS,
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
import { edgeAnswers, probedState, type DedicatedEnv } from "./status-domain-edge.ts";
import { hostKey, type StatusHost } from "@freecorps/brigade-status-edge/api";
import type { TokenRefused } from "./workspace.ts";

/**
 * The public lookup of a verified hostname, in the `STATUS` namespace: `{ workspaceId, slug }` (`StatusHost`), which
 * the edge Worker hands to `StatusPages.serve`; the page is served only while that workspace holds the hostname in D1
 * and pushed the snapshot under the slug. The edge's own helper, so the key is written as it is read.
 */
export { hostKey };

/**
 * A claim this long-lived with no domain on the page behind it is left over (an add whose Cloudflare call or rollback
 * failed): the workspace may claim it again. Well past an add's longest run (three Cloudflare calls of `CF_CALL_MS`,
 * D1 and the shard), so an add still under way is never taken over.
 */
export const CLAIM_STALE_MS = 2 * 60 * 1000;

export type DomainEnv = Env & SaasEnv & DedicatedEnv;

/** What a route refuses with, and its HTTP status. */
const REFUSALS = {
  not_configured: 503,
  not_listed: 400,
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
 * (`apex`): a CNAME cannot sit at a zone's apex without CNAME flattening, so a page takes a subdomain. None of that
 * holds for a dedicated hostname (`listed`, already kept clear of the dashboard by `dedicatedHostnames`): the operator
 * attached it to the edge, where no CNAME is needed.
 */
export function normalizeHostname(
  raw: unknown,
  instance: string,
  target?: string,
  listed: readonly string[] = [],
):
  | { ok: true; hostname: string }
  | { ok: false; code: "invalid_hostname" | "own_domain" | "apex" } {
  const hostname = readHostname(raw);
  if (!hostname) return { ok: false, code: "invalid_hostname" };
  if (listed.includes(hostname)) return { ok: true, hostname };
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

/** `raw` as a hostname Brigade keeps (lowercase, punycode, no trailing dot), or undefined when it is not one. */
function readHostname(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const typed = raw.trim().toLowerCase().replace(/\.$/, "");
  if (typed === "" || typed.length > 253 || /[\s/:@?#\\[\]%]/.test(typed)) return undefined;
  let hostname: string;
  try {
    hostname = new URL(`https://${typed}/`).hostname;
  } catch {
    return undefined;
  }
  // The URL parser turns `1.2.3` or `0x7f.1` into an IPv4 address; any address ends in digits and is refused.
  return isStatusHostname(hostname) ? hostname : undefined;
}

/**
 * The instance's dedicated hostnames (`STATUS_HOSTNAMES`, comma- or space-separated), as `readHostname` keeps them,
 * each once. None without `DASHBOARD_URL`. Left out, and logged: anything that is not a hostname, the dashboard's
 * hostname, anything under it and every parent of it (a page must never answer for the dashboard's origin), and the
 * fallback origin's domain and everything under it (the SaaS zone, whose route already takes every hostname on it).
 * Anything else under the instance's own domain stays: the operator chose it.
 */
export function dedicatedHostnames(env: SaasEnv & DedicatedEnv): string[] {
  const instance = instanceHost(env);
  if (!instance || !env.STATUS_HOSTNAMES) return [];
  const target = env.CF_SAAS_FALLBACK_ORIGIN?.trim().toLowerCase();
  const saasZone = target ? ownDomain(target) : undefined;
  const kept = new Set<string>();
  for (const entry of env.STATUS_HOSTNAMES.split(/[\s,]+/)) {
    if (!entry) continue;
    const hostname = readHostname(entry);
    const clear =
      hostname !== undefined &&
      hostname !== instance &&
      !hostname.endsWith(`.${instance}`) &&
      !instance.endsWith(`.${hostname}`) &&
      (!saasZone || (hostname !== saasZone && !hostname.endsWith(`.${saasZone}`)));
    if (clear) kept.add(hostname);
    else log("a STATUS_HOSTNAMES entry is left out", { entry });
  }
  return [...kept];
}

/** Whether the instance serves custom domains at all: through Cloudflare for SaaS, dedicated hostnames, or both. */
export const customDomainsOn = (env: SaasEnv & DedicatedEnv) =>
  saasConfig(env) !== undefined || dedicatedHostnames(env).length > 0;

/**
 * The dedicated hostnames `workspaceId` may still choose: those no other workspace holds in D1, and those another
 * holds but could have taken over (`takeable`, asked of the holder's shard), so the dashboard offers what an add would
 * accept. D1 failing lists them all (logged): an add still claims the hostname first, so a taken one is refused there.
 * A holder's shard that cannot be asked keeps its hostname off the list (logged).
 */
async function freeHostnames(
  env: DomainEnv,
  listed: string[],
  workspaceId: string,
  canDelete: boolean,
  now: number,
): Promise<string[]> {
  if (listed.length === 0) return [];
  let held: { hostname: string; workspace_id: string }[];
  try {
    ({ results: held } = await env.DB.prepare(
      `select hostname, workspace_id from status_custom_host
       where hostname in (select value from json_each(?)) and workspace_id != ?`,
    )
      .bind(JSON.stringify(listed), workspaceId)
      .all<{ hostname: string; workspace_id: string }>());
  } catch (error) {
    log("reading the dedicated hostnames' holders failed", { error: String(error) });
    return listed;
  }
  // Each held hostname, or null when it could be taken over.
  const kept = await Promise.all(
    held.map(async ({ hostname, workspace_id: holder }) => {
      try {
        const { domain } = await env.WORKSPACE.getByName(holder).statusDomainState(holder);
        return takeable(domain, hostname, now, canDelete) ? null : hostname;
      } catch (error) {
        log("WorkspaceDO.statusDomainState failed", { workspaceId: holder, error: String(error) });
        return hostname;
      }
    }),
  );
  const taken = new Set(kept.filter((hostname) => hostname !== null));
  return listed.filter((hostname) => !taken.has(hostname));
}

/**
 * Whether another workspace's domain at `hostname` may be taken over at `now` (RFC 0012 "Custom domains"): pending or
 * failed for `STATUS_DOMAIN_SQUAT_MS`, and, a Cloudflare hostname, only while this instance can delete it there
 * (`canDelete`: Cloudflare for SaaS is set up). Never an active domain, a newer one, or a claim with no domain behind it.
 */
function takeable(
  domain: StatusDomainRow | null,
  hostname: string,
  now: number,
  canDelete: boolean,
): domain is StatusDomainRow {
  return (
    domain !== null &&
    domain.hostname === hostname &&
    domain.state !== "active" &&
    domain.stateAt <= now - STATUS_DOMAIN_SQUAT_MS &&
    (domain.cloudflareId === null || canDelete)
  );
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
  const saas = saasConfig(env);
  const listed = dedicatedHostnames(env);
  if (action === "get") {
    if (!saas && listed.length === 0) return json({ configured: false });
    return json({
      configured: true,
      target: saas?.target ?? null,
      hostnames: await freeHostnames(env, listed, workspaceId, saas !== undefined, Date.now()),
    });
  }
  if (!saas && listed.length === 0) return refuse("not_configured");
  if (!allows(member.actor, "status:manage")) return refuse("forbidden");
  let hostname: string | undefined;
  if (action === "add") {
    const body = await readJson(request);
    const read = normalizeHostname(Object(body).hostname, instanceHost(env)!, saas?.target, listed);
    // Without Cloudflare for SaaS, anything but a listed hostname is `not_listed`, whatever else is wrong with it.
    if (!read.ok && (saas || read.code === "invalid_hostname")) return refuse(read.code);
    if (!read.ok || (!saas && !listed.includes(read.hostname))) return refuse("not_listed");
    hostname = read.hostname;
  }
  if (!(await domainAllowed(env, workspaceId))) return refuse("rate_limited");
  const client = saas ? new SaasClient(saas, send) : undefined;
  const reach = send ?? ((request: Request) => fetch(request));
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
    const claimed = await claimHost(env.DB, name, workspaceId, Date.now());
    const claim =
      typeof claimed === "object" && "holder" in claimed
        ? await takeOver(env, client, name, workspaceId, claimed.holder, Date.now())
        : claimed;
    if (claim === "taken") return refuse("hostname_taken");
    if (claim === "cloudflare_failed") return refuse("cloudflare_failed");
    if (claim === "busy") return refuse("in_progress");
    if (claim === "failed") return refuse("unavailable");
    const stamp = claim.stamp;
    // A dedicated hostname is the edge's already, or once the operator attaches it: Cloudflare is never asked.
    const made: Made = listed.includes(name)
      ? {
          ok: true,
          value: { id: null, records: [], ...probedState(null, await edgeAnswers(name, reach))! },
        }
      : await createOrAdopt(client!, name, workspaceId);
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
      const removed =
        made.value.id === null ? { ok: true as const } : await client!.remove(made.value.id);
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
  // A Cloudflare hostname on an instance that no longer has Cloudflare for SaaS: nothing to ask, nothing to delete.
  if (current.cloudflareId !== null && !client) return refuse("not_configured");
  if (action === "check") {
    let seen: Pick<SaasHostname, "state" | "records" | "error"> | null | undefined;
    if (current.cloudflareId === null) {
      const probed = probedState(current.state, await edgeAnswers(current.hostname, reach));
      // An active one is never set back by one answer (the shard's alarm counts the misses): kept, and answered as is.
      seen = probed && { ...probed, records: [] };
      if (!seen) return json({ ok: true, hostname: current.hostname, ...shown(current) });
    } else {
      const answer = await client!.get(current.cloudflareId);
      seen = answer.ok
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
    }
    // With the domain asked about (its Cloudflare hostname, and when it was added): one removed and added again
    // meanwhile is not overwritten.
    const checked = await change("check", {
      hostname: current.hostname,
      cloudflareId: current.cloudflareId,
      addedAt: current.createdAt,
      ...shown(seen),
    });
    if (!checked.ok) {
      return checked.code === "unauthenticated" ? unauthenticated() : refuse(refusal(checked.code));
    }
    return json({ ok: true, hostname: current.hostname, ...shown(seen) });
  }

  // Removing: Cloudflare first (a dedicated hostname has nothing there), so a domain the dashboard no longer shows
  // never keeps serving. The claim released is only one stamped before this began: a claim made since is another
  // add's.
  const startedAt = Date.now();
  if (current.cloudflareId !== null) {
    const removed = await client!.remove(current.cloudflareId);
    if (!removed.ok) {
      log("deleting a custom hostname failed", { workspaceId, error: removed.message });
      return refuse("cloudflare_failed");
    }
  }
  // With when the domain was added: a domain removed and added again meanwhile is another's to remove (`not_found`).
  const gone = await change("remove", { hostname: current.hostname, addedAt: current.createdAt });
  if (!gone.ok && gone.code !== "not_found") {
    return gone.code === "unauthenticated" ? unauthenticated() : refuse(refusal(gone.code));
  }
  await releaseHost(env.DB, current.hostname, workspaceId, startedAt, "up to");
  return json({ ok: true });
}

/** What an add found: Cloudflare's hostname, or a dedicated one (`id` null). */
type Made =
  | { ok: true; value: Pick<SaasHostname, "state" | "records" | "error"> & { id: string | null } }
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
 * only if nobody took it over first). `holder` when another workspace holds it (`takeOver` decides); `busy` when
 * another add of this workspace holds it now, so a losing concurrent add never releases the winner's claim.
 */
async function claimHost(
  db: D1Database,
  hostname: string,
  workspaceId: string,
  now: number,
): Promise<{ stamp: number } | { holder: Holder } | "busy" | "failed"> {
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
    if (holder.workspace_id !== workspaceId) {
      return { holder: { workspaceId: holder.workspace_id, createdAt: holder.created_at } };
    }
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

type Holder = { workspaceId: string; createdAt: number };

/**
 * Another workspace holds `hostname`: taken over (RFC 0012 "Custom domains") only when its domain there has been
 * pending or failed for `STATUS_DOMAIN_SQUAT_MS`, so nobody keeps a name they never verified. The holder's shard runs
 * `statusDomain.release` with its event first, then Cloudflare's hostname is deleted (a dedicated one has none), then
 * the claim moves to this workspace, stamped `now`. Anything else is `taken`: an active domain, one newer than that,
 * a claim with no domain behind it (the holder's own add finds and adopts it), or a Cloudflare hostname on an instance
 * no longer set up for Cloudflare for SaaS (`client` undefined), which nothing could delete.
 */
async function takeOver(
  env: DomainEnv,
  client: SaasClient | undefined,
  hostname: string,
  workspaceId: string,
  holder: Holder,
  now: number,
): Promise<{ stamp: number } | "taken" | "busy" | "failed" | "cloudflare_failed"> {
  const stub = env.WORKSPACE.getByName(holder.workspaceId);
  let domain: StatusDomainRow | null;
  try {
    domain = (await stub.statusDomainState(holder.workspaceId)).domain;
  } catch (error) {
    log("WorkspaceDO.statusDomainState failed", {
      workspaceId: holder.workspaceId,
      error: String(error),
    });
    return "failed";
  }
  const before = now - STATUS_DOMAIN_SQUAT_MS;
  if (!takeable(domain, hostname, now, client !== undefined)) return "taken";
  // Released first: the shard refuses a domain verified meanwhile (or re-added), so a live hostname is never deleted.
  let released: { ok: true } | { ok: false; code: string };
  try {
    released = await stub.releaseStatusDomain(
      holder.workspaceId,
      hostname,
      domain.cloudflareId,
      before,
    );
  } catch (error) {
    log("WorkspaceDO.releaseStatusDomain failed", {
      workspaceId: holder.workspaceId,
      error: String(error),
    });
    return "failed";
  }
  // Removed by its own workspace meanwhile is as good.
  if (!released.ok && released.code !== "not_found") return "taken";
  const removed =
    domain.cloudflareId === null
      ? { ok: true as const }
      : await client!.remove(domain.cloudflareId);
  if (!removed.ok) {
    // The claim still moves: the new workspace's create then meets Cloudflare's "already exists" and adopts the
    // hostname, which is in our zone and now its claim.
    log("deleting a custom hostname to take it over failed; it will be adopted", {
      workspaceId,
      from: holder.workspaceId,
      error: removed.message,
    });
  }
  try {
    const moved = await env.DB.prepare(
      `update status_custom_host set workspace_id = ?, created_at = ?
       where hostname = ? and workspace_id = ? and created_at = ?`,
    )
      .bind(workspaceId, now, hostname, holder.workspaceId, holder.createdAt)
      .run();
    return moved.meta.changes === 1 ? { stamp: now } : "busy";
  } catch (error) {
    log("taking over a custom hostname's claim failed", { error: String(error) });
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

type HostEnv = { WORKSPACE: Env["WORKSPACE"]; DB?: D1Database; STATUS?: KVNamespace } & SaasEnv &
  DedicatedEnv;

/**
 * The queue consumer's side of the lookup. A domain's own events are `syncStatusHost`'s, retried on a failure. A page's
 * `status_page.configured` never wakes a shard on an instance without custom domains, and is best effort (logged,
 * acked) where it has them: every page change sends one, and the page's snapshot already stops serving a page made
 * private or moved off its slug, whatever the lookup says.
 */
export async function notifyStatusHost(event: BrigadeEvent, env: HostEnv): Promise<undefined> {
  if (event.type !== "status_page.configured") {
    await syncStatusHost(event, env);
    return undefined;
  }
  if (!customDomainsOn(env)) return undefined;
  try {
    await syncStatusHost(event, env);
  } catch (error) {
    log("keeping a custom hostname's lookup in step failed", {
      event: event.id,
      workspaceId: event.workspaceId,
      error: String(error),
    });
  }
  return undefined;
}

/**
 * Keeps the public lookup in step (from the queue consumer): reads the shard's domain and page as they are now, never
 * the event's copy, so events handled late or twice leave the latest state. A hostname is served (`host:<name>` =
 * `{ workspaceId, slug }`) only while it is active at Cloudflare, held by this workspace in D1 and its page is public; else its key is
 * deleted. A hostname another workspace holds by now is left to that workspace's events. Throws on a failure, so the
 * message is retried.
 */
export async function syncStatusHost(event: BrigadeEvent, env: HostEnv): Promise<void> {
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
