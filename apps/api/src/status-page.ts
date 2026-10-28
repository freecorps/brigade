// The public status page's server side (RFC 0012): claiming a slug in D1 and setting the page up in the shard, and
// pushing the page's sanitized snapshot to KV whenever it changes. The public never reaches the shard: it reads the
// snapshot (src/status-html.ts renders it), so a page read a million times wakes no Durable Object.

import {
  allows,
  newId,
  statusPageArgs,
  statusSnapshot,
  STATUS_PAGE_ID,
  uptimeMoving,
  type Actor,
} from "@freecorps/brigade-schema";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** The KV key a page's snapshot lives under. */
export const statusKey = (slug: string) => `status:${slug}`;

/** KV takes at most one write a second to a key: pushes are spaced at least this far apart. */
export const STATUS_PUSH_SPACING_MS = 1000;
/** A failed push is tried again after 1 s, doubling to 5 minutes, with jitter. */
export const STATUS_RETRY_MIN_MS = 1000;
export const STATUS_RETRY_MAX_MS = 5 * 60 * 1000;
/**
 * A push still out after this long is given up on: the next due push starts beside it. When the abandoned one settles
 * the page is pushed again, so its write, landing late, is never the last.
 */
export const STATUS_PUSH_ABANDON_MS = 3 * 60 * 1000;
/**
 * How long a slug the page gave up stays claimed in D1 after its snapshot was deleted from KV: the delete takes up to
 * a minute to reach every location, then KV's cache (`cacheTtl`) and the edge cache may each keep the old page 30 s
 * more. Released earlier, another workspace's new page could share the address with the old one meanwhile.
 */
export const STATUS_SLUG_GRACE_MS = 5 * 60 * 1000;
/**
 * A public page is rebuilt at least this often even when nothing changed, so its 90-day history and its "Updated"
 * time stay true on a quiet page. It is rebuilt at the first UTC midnight after its last push, which is never later,
 * so the uptime bars' "today" moves on with the date.
 */
export const STATUS_REFRESH_MS = 24 * 60 * 60 * 1000;
/** While a monitor linked to an uptime bar has an alert firing, the page is rebuilt this often, so the outage grows. */
export const STATUS_OUTAGE_REFRESH_MS = 5 * 60 * 1000;

export type StatusConfigureCode =
  | "forbidden"
  | "invalid_args"
  | "slug_taken"
  | "not_found"
  | "unavailable"
  | "not_applied";

export type StatusConfigureResult = { ok: true } | { ok: false; code: StatusConfigureCode };

type Deps = {
  shard: Shard;
  sql: SqlStorage;
  /** The snapshots' namespace; unbound, nothing is published (the dashboard still configures the page). */
  kv: KVNamespace | undefined;
  db: D1Database;
  randomBytes: (length: number) => Uint8Array;
  log: (message: string, fields: Record<string, unknown>) => void;
  committed: (version: number, changes: readonly RowChange[]) => void;
  wake: (at: number) => void;
};

const earliest = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.min(a, b);

/** A push: when it started (its `now`), and whether a later push gave up on it (`STATUS_PUSH_ABANDON_MS`). */
type Push = { startedAt: number; abandoned: boolean };

export class StatusPublisher {
  /**
   * The push under way. KV calls have no deadline, so one can outlast the alarm that started it; another is not
   * started beside it (two could land in KV out of order) until it is abandoned, `STATUS_PUSH_ABANDON_MS` on.
   */
  private pushing: Push | null = null;

  constructor(private readonly deps: Deps) {}

  /**
   * Sets up or changes the page as `actor` (RPC from `PUT /workspaces/:id/status-page`): the slug claimed in D1
   * first when the page is public, so two workspaces never hold one address, then `statusPage.configure` in this shard with its event. A
   * slug that was free and that the shard then refused is released again. A storage failure after the claim leaves
   * the slug with this workspace, which is harmless: the next save with it succeeds.
   *
   * Never waits on KV or on a push. Claims and releases need no lock either: each claim stamps the row with its time
   * (`created_at`, rewritten when this workspace claims a slug it already holds), and a release deletes only a row
   * stamped no later than what it releases, so a release that lands late never undoes a claim made meanwhile.
   */
  async configure(workspaceId: string, actor: Actor, raw: unknown): Promise<StatusConfigureResult> {
    if (!allows(actor, "status:manage")) return { ok: false, code: "forbidden" };
    const parsed = statusPageArgs(raw);
    if (!parsed.ok) return { ok: false, code: "invalid_args" };
    const args = parsed.value;
    const { store } = this.deps.shard;
    const current = store.get("status_page", STATUS_PAGE_ID);
    let claimed: number | null = null;
    // Only a public page claims its slug (decided, Q23): a draft's is kept on the page alone (`claimed: false`), so a
    // `slug_taken` never tells an admin which addresses other drafts use; a taken one is refused when it goes public.
    const held = current?.slug === args.slug && current.claimed !== false;
    if (args.enabled && !held) {
      try {
        const now = Date.now();
        const [before, , owner] = await this.deps.db.batch([
          this.deps.db
            .prepare("select workspace_id from status_slug where slug = ?")
            .bind(args.slug),
          this.deps.db
            .prepare(
              `insert into status_slug (slug, workspace_id, created_at) values (?, ?, ?)
               on conflict (slug) do update set created_at = excluded.created_at
               where status_slug.workspace_id = excluded.workspace_id`,
            )
            .bind(args.slug, workspaceId, now),
          this.deps.db
            .prepare("select workspace_id from status_slug where slug = ?")
            .bind(args.slug),
        ]);
        const holder = (owner?.results[0] as { workspace_id?: string } | undefined)?.workspace_id;
        if (holder !== workspaceId) return { ok: false, code: "slug_taken" };
        if ((before?.results.length ?? 0) === 0) claimed = now;
      } catch (error) {
        this.deps.log("claiming a status page slug failed", { error });
        return { ok: false, code: "unavailable" };
      }
    }
    const now = Date.now();
    let outcome;
    try {
      outcome = this.deps.shard.mutate({
        clientId: "api",
        mutationId: newId("mut", now, this.deps.randomBytes),
        actor,
        name: "statusPage.configure",
        args,
        now,
        internal: true,
      });
    } catch (error) {
      this.deps.log("status page not applied to the shard", { error });
      return { ok: false, code: "not_applied" };
    }
    const { result, changes } = outcome;
    if (!result.ok) {
      if (claimed !== null) await this.release(workspaceId, args.slug, claimed);
      // Nothing changed: what the caller asked for is what the page already says.
      if (result.error.code === "conflict") return { ok: true };
      const code = result.error.code === "forbidden" ? "forbidden" : "invalid_args";
      return { ok: false, code };
    }
    this.deps.committed(result.version, changes);
    this.deps.wake(now);
    return { ok: true };
  }

  /** Gives a slug this workspace claimed at `claimed` back to D1, unless the page uses it or still retires it. */
  private async release(workspaceId: string, slug: string, claimed: number): Promise<void> {
    const { store } = this.deps.shard;
    if (store.get("status_page", STATUS_PAGE_ID)?.slug === slug) return;
    if (store.get("status_retired", slug)) return;
    try {
      await this.deps.db
        .prepare("delete from status_slug where slug = ? and workspace_id = ? and created_at <= ?")
        .bind(slug, workspaceId, claimed)
        .run();
    } catch (error) {
      // Left with this workspace; nobody else can use it until an operator deletes the row. Logged for that.
      this.deps.log("releasing a status page slug failed", { slug, error });
    }
  }

  /**
   * When the alarm should come back to push: null when there is nothing to do, else the earliest moment the backoff
   * and KV's one write a second allow. Something to do: a change not pushed yet, an abandoned push that settled (its
   * write may have landed after a newer one), a public page due its rebuild (`refreshAt`), a retired slug whose
   * snapshot is still in KV or whose grace (`STATUS_SLUG_GRACE_MS`) has run out. Without KV only retired slugs, released at once: nothing was ever published under them.
   */
  nextAt(now: number): number | null {
    const { kv } = this.deps;
    const { shard } = this.deps;
    let due: number | null = null;
    if (kv) {
      if (shard.statusDirty() !== undefined || this.meta("status_repush") !== undefined) due = now;
      due = earliest(due, this.refreshAt());
    }
    for (const retired of shard.store.scan("status_retired")) {
      due = earliest(
        due,
        kv && retired.cleared !== undefined ? retired.cleared + STATUS_SLUG_GRACE_MS : now,
      );
    }
    if (due === null) return null;
    const retryAt = this.meta("status_retry_at") ?? 0;
    const spaced = kv ? (this.meta("status_pushed_at") ?? 0) + STATUS_PUSH_SPACING_MS : 0;
    return Math.max(now, due, retryAt, spaced);
  }

  /**
   * Runs a push if one is due (see `nextAt`). Run from the shard's alarm; never throws. A failure keeps everything
   * pending and backs off (`STATUS_RETRY_MIN_MS` to `STATUS_RETRY_MAX_MS`). A push due while an earlier one is still
   * out does not start and backs off the same way, so an alarm never comes straight back to wait on a KV that hangs;
   * past `STATUS_PUSH_ABANDON_MS` the earlier one is abandoned and the new one starts. Every push, when it settles,
   * brings the alarm forward for whatever is due by then (a change made while it was out goes out at once).
   */
  publish(workspaceId: string, now: number): Promise<void> {
    let at: number | null;
    try {
      at = this.nextAt(now);
    } catch (error) {
      this.deps.log("reading the status page push failed", { error });
      return Promise.resolve();
    }
    if (at === null || at > now) return Promise.resolve();
    if (this.pushing) {
      if (now - this.pushing.startedAt < STATUS_PUSH_ABANDON_MS) {
        this.failed(now, new Error("the previous push has not finished"));
        return Promise.resolve();
      }
      this.deps.log("abandoning a stuck status page push", { startedAt: this.pushing.startedAt });
      this.pushing.abandoned = true;
      this.pushing = null;
    }
    const handle: Push = { startedAt: now, abandoned: false };
    this.pushing = handle;
    return this.push(workspaceId, now, handle).finally(() => this.settled(handle));
  }

  /**
   * A push settled. An abandoned one may have written an older snapshot after a newer push wrote its own, so the page
   * is marked to be pushed again (`status_repush`, the time it settled: only a push started after it clears it).
   * Then the alarm is brought forward for what is due now. Never throws.
   */
  private settled(handle: Push): void {
    if (this.pushing === handle) this.pushing = null;
    try {
      if (handle.abandoned) this.setMeta("status_repush", Date.now());
      const at = this.nextAt(Date.now());
      if (at !== null) this.deps.wake(at);
    } catch (error) {
      this.deps.log("re-arming the status page push failed", { error });
    }
  }

  /**
   * The alarm stopped waiting for the push (`STATUS_PUSH_BUDGET_MS`): backs off as after a failure, so the alarm
   * comes back later rather than at once. The push goes on; when it finishes, its own outcome is recorded.
   */
  late(now: number): void {
    if (this.pushing) this.failed(now, new Error("the push is taking too long"));
  }

  /**
   * Pushes the snapshot when the page changed since the last push or is due its daily rebuild (put when public,
   * deleted when not), then deletes the snapshots of slugs the page gave up, and releases them in D1 once their grace
   * is over, so no other workspace can claim a slug whose old snapshot may still be served. An abandoned push records
   * nothing once it is abandoned: the push that replaced it owns the outcome.
   */
  private async push(workspaceId: string, now: number, handle: Push): Promise<void> {
    const { shard, kv } = this.deps;
    try {
      if (kv) {
        const dirty = shard.statusDirty();
        const repush = this.meta("status_repush") !== undefined;
        const page = shard.store.get("status_page", STATUS_PAGE_ID);
        const refresh = this.refreshAt();
        const stale = refresh !== null && refresh <= now;
        if ((dirty !== undefined || repush || stale) && page) {
          // Built and read in one turn: a change landing during the write marks a newer version, pushed next.
          const snapshot = statusSnapshot(shard.store, now);
          if (snapshot) await kv.put(statusKey(page.slug), JSON.stringify(snapshot));
          // A draft that never went public under its slug published nothing there; another page may use it now.
          else if (page.claimed !== false) await kv.delete(statusKey(page.slug));
          if (handle.abandoned) return;
          this.setMeta("status_pushed_at", now);
        }
        if (dirty !== undefined) shard.statusPushed(dirty);
        // Only a mark set before this push started: an abandoned push settling during this one marks it again.
        this.deps.sql.exec("delete from shard_meta where key = 'status_repush' and value < ?", now);
      }
      for (const retired of shard.store.scan("status_retired")) {
        if (shard.store.get("status_page", STATUS_PAGE_ID)?.slug === retired.id) {
          shard.store.delete("status_retired", retired.id);
          continue;
        }
        let cleared = retired.cleared;
        if (kv && cleared === undefined) {
          await kv.delete(statusKey(retired.id));
          if (handle.abandoned) return;
          cleared = now;
          // Taken back while KV deleted it: still this workspace's, nothing to release. Taken back and given up again:
          // a newer retirement, whose snapshot may have been written since, so the next push deletes it again.
          if (shard.store.get("status_retired", retired.id)?.at !== retired.at) continue;
          shard.store.update("status_retired", retired.id, { cleared });
        }
        if (kv && (cleared ?? now) + STATUS_SLUG_GRACE_MS > now) continue;
        // Only a row stamped before it was given up: one stamped later (or in the same millisecond) is a claim made
        // since.
        await this.deps.db
          .prepare("delete from status_slug where slug = ? and workspace_id = ? and created_at < ?")
          .bind(retired.id, workspaceId, retired.at)
          .run();
        if (handle.abandoned) return;
        // Only this retirement: one taken back and given up again during the D1 call is a newer record, released
        // after its own grace.
        if (shard.store.get("status_retired", retired.id)?.at === retired.at) {
          shard.store.delete("status_retired", retired.id);
        }
      }
      this.clearMeta("status_attempts");
      this.clearMeta("status_retry_at");
    } catch (error) {
      if (handle.abandoned) this.deps.log("an abandoned status page push failed", { error });
      else this.failed(now, error);
    }
  }

  /**
   * When a public page is due a rebuild with nothing changed: the first UTC midnight after its last push (never more
   * than `STATUS_REFRESH_MS` on), or `STATUS_OUTAGE_REFRESH_MS` after it while a linked monitor's alert is firing.
   * Null for a page that is not public.
   */
  private refreshAt(): number | null {
    const { store } = this.deps.shard;
    if (!store.get("status_page", STATUS_PAGE_ID)?.enabled) return null;
    const pushedAt = this.meta("status_pushed_at") ?? 0;
    const midnight = (Math.floor(pushedAt / STATUS_REFRESH_MS) + 1) * STATUS_REFRESH_MS;
    const linked = new Set(
      store.scan("status_components").flatMap((component) => component.monitorIds ?? []),
    );
    if (linked.size > 0 && uptimeMoving(linked, store.scan("alerts"))) {
      return Math.min(midnight, pushedAt + STATUS_OUTAGE_REFRESH_MS);
    }
    return midnight;
  }

  /** Records a failed or stuck push: tried again after `STATUS_RETRY_MIN_MS`, doubling, with jitter. */
  private failed(now: number, error: unknown): void {
    try {
      const attempts = (this.meta("status_attempts") ?? 0) + 1;
      const step = Math.min(STATUS_RETRY_MAX_MS, STATUS_RETRY_MIN_MS * 2 ** (attempts - 1));
      const retryAt = now + step / 2 + Math.random() * (step / 2);
      this.setMeta("status_attempts", attempts);
      this.setMeta("status_retry_at", Math.round(retryAt));
      this.deps.log("publishing the status page failed", { attempts, error });
    } catch (failure) {
      this.deps.log("recording a failed status page push failed", { error: failure });
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
