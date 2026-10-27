// The public status page's server side (RFC 0012): claiming a slug in D1 and setting the page up in the shard, and
// pushing the page's sanitized snapshot to KV whenever it changes. The public never reaches the shard: it reads the
// snapshot (src/status-html.ts renders it), so a page read a million times wakes no Durable Object.

import {
  can,
  newId,
  statusPageArgs,
  statusSnapshot,
  STATUS_PAGE_ID,
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

export class StatusPublisher {
  /** Serializes `configure` and `publish`, so a slug D1 is releasing is never claimed again halfway. */
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: Deps) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /**
   * Sets up or changes the page as `actor` (RPC from `PUT /workspaces/:id/status-page`): the slug claimed in D1
   * first, so two workspaces never hold one address, then `statusPage.configure` in this shard with its event. A
   * slug that was free and that the shard then refused is released again. A storage failure after the claim leaves
   * the slug with this workspace, which is harmless: the next save with it succeeds.
   */
  configure(workspaceId: string, actor: Actor, raw: unknown): Promise<StatusConfigureResult> {
    if (!can(actor.role, "status:manage")) {
      return Promise.resolve({ ok: false, code: "forbidden" });
    }
    const parsed = statusPageArgs(raw);
    if (!parsed.ok) return Promise.resolve({ ok: false, code: "invalid_args" });
    const args = parsed.value;
    return this.exclusive(async () => {
      const { store } = this.deps.shard;
      const current = store.get("status_page", STATUS_PAGE_ID);
      let fresh = false;
      if (current?.slug !== args.slug) {
        try {
          const now = Date.now();
          const [claim, owner] = await this.deps.db.batch([
            this.deps.db
              .prepare(
                `insert into status_slug (slug, workspace_id, created_at) values (?, ?, ?)
                 on conflict (slug) do nothing`,
              )
              .bind(args.slug, workspaceId, now),
            this.deps.db
              .prepare("select workspace_id from status_slug where slug = ?")
              .bind(args.slug),
          ]);
          fresh = (claim?.meta.changes ?? 0) > 0;
          const holder = (owner?.results[0] as { workspace_id?: string } | undefined)?.workspace_id;
          if (holder !== workspaceId) return { ok: false, code: "slug_taken" };
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
        if (fresh) await this.release(workspaceId, args.slug);
        // Nothing changed: what the caller asked for is what the page already says.
        if (result.error.code === "conflict") return { ok: true };
        const code = result.error.code === "forbidden" ? "forbidden" : "invalid_args";
        return { ok: false, code };
      }
      this.deps.committed(result.version, changes);
      this.deps.wake(now);
      return { ok: true };
    });
  }

  /** Gives a slug this workspace claimed back to D1, unless the page uses it or still has to clean up after it. */
  private async release(workspaceId: string, slug: string): Promise<void> {
    const { store } = this.deps.shard;
    if (store.get("status_page", STATUS_PAGE_ID)?.slug === slug) return;
    if (store.get("status_retired", slug)) return;
    try {
      await this.deps.db
        .prepare("delete from status_slug where slug = ? and workspace_id = ?")
        .bind(slug, workspaceId)
        .run();
    } catch (error) {
      // Left with this workspace; nobody else can use it until an operator deletes the row. Logged for that.
      this.deps.log("releasing a status page slug failed", { slug, error });
    }
  }

  /**
   * When the alarm should come back to push: null when there is nothing to push (or nowhere to push it), else the
   * earliest moment the backoff and KV's one write a second allow.
   */
  nextAt(now: number): number | null {
    if (!this.deps.kv) return null;
    const pending =
      this.deps.shard.statusDirty() !== undefined ||
      this.deps.shard.store.scan("status_retired").length > 0;
    if (!pending) return null;
    const retryAt = this.meta("status_retry_at") ?? 0;
    const spaced = (this.meta("status_pushed_at") ?? 0) + STATUS_PUSH_SPACING_MS;
    return Math.max(now, retryAt, spaced);
  }

  /**
   * Pushes the snapshot when the page changed since the last push (put when public, deleted when not), then deletes
   * the snapshots of slugs the page gave up and only then releases them in D1, so no other workspace can claim a
   * slug whose old snapshot may still be served. Run from the shard's alarm; never throws. A failure keeps
   * everything pending and backs off (`STATUS_RETRY_MIN_MS` to `STATUS_RETRY_MAX_MS`).
   */
  publish(workspaceId: string, now: number): Promise<void> {
    const kv = this.deps.kv;
    if (!kv) return Promise.resolve();
    return this.exclusive(async () => {
      const at = this.nextAt(now);
      if (at === null || at > now) return;
      const { shard } = this.deps;
      try {
        const dirty = shard.statusDirty();
        const page = shard.store.get("status_page", STATUS_PAGE_ID);
        if (dirty !== undefined && page) {
          // Built and read in one turn: a change landing during the write marks a newer version, pushed next.
          const snapshot = statusSnapshot(shard.store, now);
          if (snapshot) await kv.put(statusKey(page.slug), JSON.stringify(snapshot));
          else await kv.delete(statusKey(page.slug));
          this.setMeta("status_pushed_at", now);
        }
        if (dirty !== undefined) shard.statusPushed(dirty);
        for (const retired of shard.store.scan("status_retired")) {
          if (shard.store.get("status_page", STATUS_PAGE_ID)?.slug === retired.id) {
            shard.store.delete("status_retired", retired.id);
            continue;
          }
          await kv.delete(statusKey(retired.id));
          await this.deps.db
            .prepare("delete from status_slug where slug = ? and workspace_id = ?")
            .bind(retired.id, workspaceId)
            .run();
          shard.store.delete("status_retired", retired.id);
        }
        this.clearMeta("status_attempts");
        this.clearMeta("status_retry_at");
      } catch (error) {
        const attempts = (this.meta("status_attempts") ?? 0) + 1;
        const step = Math.min(STATUS_RETRY_MAX_MS, STATUS_RETRY_MIN_MS * 2 ** (attempts - 1));
        const retryAt = now + step / 2 + Math.random() * (step / 2);
        this.setMeta("status_attempts", attempts);
        this.setMeta("status_retry_at", Math.round(retryAt));
        this.deps.log("publishing the status page failed", { attempts, error });
      }
    });
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
