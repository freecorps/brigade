// Re-checking a status page's own domain from the shard's alarm (RFC 0012 "Custom domains"), so a domain moves on
// without anyone pressing "Check again": a pending one is asked about again with backoff until it is active or failed,
// an active one once a day, so a change at Cloudflare (moved, blocked, deleted) reaches the dashboard and, through the
// `status_domain.checked` event, the public lookup. Each check is `statusDomain.check` as `ACCOUNT_ACTOR` with its
// event through the outbox, within the workspace's `STATUS_DOMAIN_LIMIT` like the dashboard's own changes.

import { STATUS_DOMAIN_ID, type StatusDomainRow } from "@freecorps/brigade-schema";
import { SaasClient, type Fetch, type SaasConfig, type SaasHostname } from "./status-domain-cf.ts";
import type { Shard } from "./shard.ts";

/** A pending domain is asked about again after as long as it has been pending, at least this long… */
export const DOMAIN_RECHECK_MIN_MS = 60 * 1000;
/** …and at most this long. */
export const DOMAIN_RECHECK_MAX_MS = 60 * 60 * 1000;
/**
 * A domain pending this long since it became pending (`stateAt`: added, or an active one Cloudflare stopped serving)
 * is no longer asked about on its own: "Check again" still is.
 */
export const DOMAIN_PENDING_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** An active domain is asked about again this often. */
export const DOMAIN_ACTIVE_RECHECK_MS = 24 * 60 * 60 * 1000;

/** When the domain is due its next check on its own, or null when it is not (failed, or pending too long). */
export function domainCheckDue(row: StatusDomainRow, now: number): number | null {
  if (row.state === "failed") return null;
  if (row.state === "active") return row.checkedAt + DOMAIN_ACTIVE_RECHECK_MS;
  // From when it became pending, not when it was added: an old active domain that turns pending for a moment (a
  // certificate renewal) is still asked about until it comes back.
  const since = row.stateAt ?? row.createdAt;
  if (now - since > DOMAIN_PENDING_MAX_MS) return null;
  const pending = row.checkedAt - since;
  return row.checkedAt + Math.min(DOMAIN_RECHECK_MAX_MS, Math.max(DOMAIN_RECHECK_MIN_MS, pending));
}

type Deps = {
  shard: Shard;
  sql: SqlStorage;
  /** The instance's Cloudflare for SaaS settings; undefined, nothing is checked. */
  config: () => SaasConfig | undefined;
  limiter: () => RateLimit | undefined;
  /** Cloudflare's API (a fake in the tests). */
  send?: Fetch;
  /** Runs `statusDomain.check` as `ACCOUNT_ACTOR`, with its event; throws on a refusal. */
  check: (args: Record<string, unknown>) => void;
  log: (message: string, fields: Record<string, unknown>) => void;
};

export class DomainChecker {
  /** A check under way: the alarm never starts a second beside it. */
  private running = false;

  constructor(private readonly deps: Deps) {}

  /** When the alarm should come back for the domain: its next check, after any backoff; null when none is due. */
  nextAt(now: number): number | null {
    if (!this.deps.config()) return null;
    const row = this.deps.shard.store.get("status_domain", STATUS_DOMAIN_ID);
    if (!row) return null;
    const due = domainCheckDue(row, now);
    if (due === null) return null;
    return Math.max(due, this.meta("domain_retry_at") ?? 0);
  }

  /**
   * Asks Cloudflare about the domain if it is due (`nextAt`), and records what it said. A failure (the limit, Cloudflare,
   * the shard) backs off from `DOMAIN_RECHECK_MIN_MS`, doubling to `DOMAIN_RECHECK_MAX_MS`. Never throws.
   */
  async run(workspaceId: string, now: number): Promise<void> {
    if (this.running) return;
    let at: number | null;
    try {
      at = this.nextAt(now);
    } catch (error) {
      this.deps.log("reading the status domain check failed", { error });
      return;
    }
    const config = this.deps.config();
    const row = this.deps.shard.store.get("status_domain", STATUS_DOMAIN_ID);
    if (at === null || at > now || !config || !row) return;
    this.running = true;
    try {
      if (!(await this.allowed(workspaceId))) {
        this.failed(now, "rate limited");
        return;
      }
      const answer = await new SaasClient(config, this.deps.send).get(row.cloudflareId);
      const seen: Pick<SaasHostname, "state" | "records" | "error"> | undefined = answer.ok
        ? answer.value
        : answer.code === "not_found"
          ? { state: "failed", records: row.records, error: "deleted" }
          : undefined;
      if (!seen) {
        this.failed(now, answer.ok ? "" : answer.message);
        return;
      }
      // Removed, or removed and added again, while Cloudflare answered: what it said is about another hostname.
      if (
        this.deps.shard.store.get("status_domain", STATUS_DOMAIN_ID)?.cloudflareId !==
        row.cloudflareId
      ) {
        return;
      }
      this.deps.check({
        hostname: row.hostname,
        cloudflareId: row.cloudflareId,
        state: seen.state,
        records: seen.records,
        error: seen.error,
      });
      this.reset();
    } catch (error) {
      this.failed(now, String(error));
    } finally {
      this.running = false;
    }
  }

  /** Forgets the backoff: a domain added or removed starts afresh, never behind the last one's failures. */
  reset(): void {
    this.clearMeta("domain_attempts");
    this.clearMeta("domain_retry_at");
  }

  private async allowed(workspaceId: string): Promise<boolean> {
    const limiter = this.deps.limiter();
    if (!limiter) return true;
    try {
      return (await limiter.limit({ key: workspaceId })).success;
    } catch (error) {
      this.deps.log("the status domain limit failed", { error });
      return true;
    }
  }

  private failed(now: number, why: string): void {
    try {
      const attempts = (this.meta("domain_attempts") ?? 0) + 1;
      const step = Math.min(DOMAIN_RECHECK_MAX_MS, DOMAIN_RECHECK_MIN_MS * 2 ** (attempts - 1));
      this.setMeta("domain_attempts", attempts);
      this.setMeta("domain_retry_at", now + step);
      this.deps.log("checking the status domain failed", { attempts, why });
    } catch (error) {
      this.deps.log("recording a failed status domain check failed", { error });
    }
  }

  private meta(key: string): number | undefined {
    const [row] = this.deps.sql
      .exec<{ value: number }>("select value from shard_meta where key = ?", key)
      .toArray();
    return row?.value;
  }

  private setMeta(key: string, value: number): void {
    this.deps.sql.exec(
      "insert into shard_meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      key,
      value,
    );
  }

  private clearMeta(key: string): void {
    this.deps.sql.exec("delete from shard_meta where key = ?", key);
  }
}
