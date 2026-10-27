import { DurableObject } from "cloudflare:workers";
import {
  CONSECUTIVE_CHECKS,
  isCheckError,
  MIN_INTERVAL_SECONDS,
  newId,
  REPORT_EVERY_MS,
  type ProbeRegion,
} from "@freecorps/brigade-schema";
import {
  defaultConnector,
  observedColo,
  runCheck,
  type CheckConfig,
  type CheckResult,
  type Connector,
} from "./check.ts";

/** One region's verdict on one monitor, sent to the workspace shard (`WorkspaceDO.report`). */
export type ProbeReport = {
  /**
   * De-duplicates a retried report (the shard's mutation id): one id per check result, so sending the same result
   * again is answered from the shard's stored result instead of running twice.
   */
  reportId: string;
  id: string;
  /** When the region last checked: the latest check, even when only an unchanged verdict is re-sent. */
  at: number;
  up: boolean;
  latencyMs: number | null;
  colo: string | null;
  httpStatus: number | null;
  error: string | null;
};

/** The object for a workspace's region: `${workspaceId}:${region}`, created with that `locationHint`. */
export function probeName(workspaceId: string, region: ProbeRegion): string {
  return `${workspaceId}:${region}`;
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

/**
 * Checks run at once per alarm, at most, HTTP and TCP together: a Worker has at most six connections waiting for
 * their response headers or to open, and queues the rest, which would eat into the queued checks' timeouts. So with
 * every target hanging a region completes about `PARALLEL_CHECKS / timeout` checks a second (RFC 0007 "What one
 * region sustains under hanging targets").
 */
const PARALLEL_CHECKS = 6;
/**
 * Checks run per alarm, at most: the most overdue first, and the rest on the next alarm a second later. A body
 * pattern costs at most `PATTERN_STEPS_PER_CHAR` steps per character of the 64 KiB read (about 100 ms of CPU for the
 * costliest), so a run stays inside an alarm's 30 s of CPU however many monitors share the region, and its wall time
 * (six at once, each within its timeout) stays within a few minutes.
 */
export const MAX_CHECKS_PER_RUN = 50;
/** If an alarm run fails before it sets the real next alarm, the one set first fires after this. */
const RETRY_MS = MIN_INTERVAL_SECONDS * 1000;

const SCHEMA = `
  create table if not exists probe_meta (key text primary key, value text not null) without rowid;
  create table if not exists probe_checks (
    id text primary key,
    config text not null,
    next_at integer not null,
    last_ok integer,
    streak integer not null default 0,
    verdict integer,
    reported_verdict integer,
    reported_at integer,
    result text,
    report_id text
  ) without rowid;
`;

type CheckRow = {
  id: string;
  config: string;
  next_at: number;
  last_ok: number | null;
  streak: number;
  verdict: number | null;
  reported_verdict: number | null;
  reported_at: number | null;
  result: string | null;
  report_id: string | null;
};

type Stored = CheckResult & { at: number; colo: string | null };

/**
 * One workspace's checks from one region (RFC 0007 "Placement"): the shard pushes the HTTP and TCP monitors that use the
 * region (`configure`), and `alarm()` runs each on its interval. A region's verdict flips after
 * `CONSECUTIVE_CHECKS` alike results (or the monitor's own number); the probe reports it to the shard when it changes and otherwise every
 * `REPORT_EVERY_MS`, with the colo the check really ran from. Every alarm sets the next one before doing anything
 * else, so a failing run never ends the chain (spike S2); the shard also re-pushes the config every few minutes,
 * which re-arms a probe whose alarm was lost.
 */
export class ProbeDO extends DurableObject<Env> {
  /** Outbound fetch; the tests replace it. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);
  /** Outbound TCP; the tests replace it. */
  connector: Connector = defaultConnector;
  /** Runs one check; the tests replace it to return results no real target gives (a check error). */
  check: (config: CheckConfig) => Promise<CheckResult> = (config) =>
    runCheck(this.fetcher, this.connector, config);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
  }

  /**
   * Replaces this region's checks with `checks` (from the workspace shard). A new or changed check starts over
   * and runs at once; an empty list stops the alarm. A check whose only change is its streak length keeps its
   * results, streak and verdict: the next result is judged by the new length. Refuses a workspace or region other
   * than the first one.
   */
  async configure(
    workspaceId: string,
    region: ProbeRegion,
    checks: CheckConfig[],
  ): Promise<{ ok: boolean }> {
    if (!this.claim("workspace", workspaceId) || !this.claim("region", region)) {
      this.log("probe serves another workspace or region", { workspaceId, region });
      return { ok: false };
    }
    const { sql } = this.ctx.storage;
    const now = Date.now();
    const wanted = new Map(checks.map((check) => [check.id, JSON.stringify(check)]));
    for (const row of this.rows()) {
      const config = wanted.get(row.id);
      if (config === row.config) continue;
      if (config !== undefined && sameCheck(config, row.config)) {
        sql.exec("update probe_checks set config = ? where id = ?", config, row.id);
      } else sql.exec("delete from probe_checks where id = ?", row.id);
    }
    for (const [id, config] of wanted) {
      sql.exec(
        "insert into probe_checks (id, config, next_at) values (?, ?, ?) on conflict (id) do nothing",
        id,
        config,
        now,
      );
    }
    await this.schedule(now);
    return { ok: true };
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    // First, so nothing below can end the chain.
    await this.ctx.storage.setAlarm(now + RETRY_MS);
    try {
      await this.run(now);
    } catch (error) {
      // Logged instead of thrown: the alarm set above runs again, without the runtime's retry backoff.
      this.log("probe run failed", { error });
    }
  }

  /** The checks and their state; for the tests and debugging. */
  rows(): CheckRow[] {
    return this.ctx.storage.sql.exec<CheckRow>("select * from probe_checks order by id").toArray();
  }

  private async run(now: number): Promise<void> {
    const region = this.meta("region") as ProbeRegion | undefined;
    const workspaceId = this.meta("workspace");
    const due = this.rows()
      .filter((row) => row.next_at <= now)
      .sort((a, b) => a.next_at - b.next_at)
      .slice(0, MAX_CHECKS_PER_RUN);
    if (due.length > 0 && region && workspaceId) {
      const colo = await observedColo(this.fetcher);
      const results = await mapLimited(due, PARALLEL_CHECKS, (row) =>
        this.check(JSON.parse(row.config) as CheckConfig),
      );
      due.forEach((row, index) => this.record(row, { ...results[index]!, at: now, colo }, now));
      await this.report(workspaceId, region, now);
    }
    await this.schedule(now);
  }

  /**
   * Stores one result and the region's verdict after it. A check error (`CHECK_ERRORS`) says nothing about the
   * target: it leaves the streak and the verdict as they were, so it neither pages nor resolves, and is reported with
   * the verdict it left. Starting or ending one is reported at once, not after `REPORT_EVERY_MS`.
   */
  private record(row: CheckRow, result: Stored, now: number): void {
    const config = JSON.parse(row.config) as CheckConfig;
    let { last_ok: ok, streak, verdict } = row;
    if (!isCheckError(result.error)) {
      ok = result.ok ? 1 : 0;
      streak = row.last_ok === ok ? row.streak + 1 : 1;
      // The monitor's own streak length, or CONSECUTIVE_CHECKS. A new check is up on its first success, but down
      // only after that many failures; after that a verdict flips only after that many alike results (RFC 0007
      // "Quorum and flapping").
      const needed = config.consecutiveChecks ?? CONSECUTIVE_CHECKS;
      const flips = row.verdict === null ? ok === 1 || streak >= needed : streak >= needed;
      if (flips) verdict = ok;
    }
    const before = row.result === null ? null : (JSON.parse(row.result) as Stored).error;
    const resend = isCheckError(before) !== isCheckError(result.error);
    // Only if `configure` did not replace the check while it ran.
    this.ctx.storage.sql.exec(
      `update probe_checks set next_at = ?, last_ok = ?, streak = ?, verdict = ?, result = ?, report_id = ?,
         reported_at = case when ? then null else reported_at end
       where id = ? and config = ?`,
      now + config.intervalSeconds * 1000,
      ok,
      streak,
      verdict,
      JSON.stringify(result),
      newId("rep", now, random),
      resend ? 1 : 0,
      row.id,
      row.config,
    );
  }

  /**
   * Sends the verdicts the shard has not seen (a change, or none sent for `REPORT_EVERY_MS`) in one RPC. A report
   * the shard did not accept, or an RPC that failed, is sent again after the next check.
   */
  private async report(workspaceId: string, region: ProbeRegion, now: number): Promise<void> {
    const pending = this.rows().filter(
      (row) =>
        row.verdict !== null &&
        row.result !== null &&
        (row.verdict !== row.reported_verdict ||
          row.reported_at === null ||
          now - row.reported_at >= REPORT_EVERY_MS),
    );
    if (pending.length === 0) return;
    const reports: ProbeReport[] = pending.map((row) => {
      const result = JSON.parse(row.result!) as Stored;
      return {
        reportId: row.report_id ?? newId("rep", now, random),
        id: row.id,
        at: result.at,
        up: row.verdict === 1,
        latencyMs: result.latencyMs,
        colo: result.colo,
        httpStatus: result.httpStatus,
        error: result.error,
      };
    });
    let accepted: boolean[];
    try {
      accepted = await this.env.WORKSPACE.getByName(workspaceId).report(region, reports);
    } catch (error) {
      this.log("probe report failed", { workspaceId, error });
      return;
    }
    pending.forEach((row, index) => {
      if (!accepted[index]) return;
      this.ctx.storage.sql.exec(
        "update probe_checks set reported_verdict = ?, reported_at = ? where id = ? and config = ?",
        row.verdict,
        now,
        row.id,
        row.config,
      );
    });
  }

  /** The next alarm at the earliest due check, or none without checks. */
  private async schedule(now: number): Promise<void> {
    const { next } = this.ctx.storage.sql
      .exec<{ next: number | null }>("select min(next_at) as next from probe_checks")
      .one();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(next, now + 1000));
  }

  private meta(key: string): string | undefined {
    const [row] = this.ctx.storage.sql
      .exec<{ value: string }>("select value from probe_meta where key = ?", key)
      .toArray();
    return row?.value;
  }

  /** Records `value` the first time; afterwards, whether it matches. */
  private claim(key: string, value: string): boolean {
    const current = this.meta(key);
    if (current === undefined) {
      this.ctx.storage.sql.exec("insert into probe_meta (key, value) values (?, ?)", key, value);
      return true;
    }
    return current === value;
  }

  private log(message: string, fields: Record<string, unknown>): void {
    const { error, ...rest } = fields;
    console.error(
      JSON.stringify({
        message,
        shard: "probe",
        workspace: this.meta("workspace"),
        region: this.meta("region"),
        ...rest,
        ...(error === undefined ? {} : { error: describe(error) }),
      }),
    );
  }
}

/** Whether two configs run the same check, told apart only by their streak length (`consecutiveChecks`). */
function sameCheck(a: string, b: string): boolean {
  const { consecutiveChecks: _a, ...left } = JSON.parse(a) as CheckConfig;
  const { consecutiveChecks: _b, ...right } = JSON.parse(b) as CheckConfig;
  return JSON.stringify(left) === JSON.stringify(right);
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : (JSON.stringify(error) ?? typeof error);
}
