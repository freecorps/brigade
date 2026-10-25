import { DurableObject } from "cloudflare:workers";
import { INTERVAL_MS, RETENTION_MS, type Hint } from "./config.ts";
import { measure } from "./measure.ts";
import { summarize, type ProbeSummary, type SampleRow } from "./summary.ts";

export type ProbeStatus = {
  /** The hint `start` was called with, or null if the probe was never started. */
  hint: string | null;
  running: boolean;
  /** When the next sample is due (ISO), or null when stopped. */
  nextAlarm: string | null;
};

type StoredRow = {
  ts: number;
  scheduled: number | null;
  retry: number;
  instance: string;
  colo: string | null;
  loc: string | null;
  timings: string;
};

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS samples (
    ts INTEGER NOT NULL,
    scheduled INTEGER,
    retry INTEGER NOT NULL,
    instance TEXT NOT NULL,
    colo TEXT,
    loc TEXT,
    timings TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS samples_ts ON samples (ts);
`;

/**
 * Spike S2: a stand-in for RFC 0007's `ProbeDO`. Created with a `locationHint`, it samples on `alarm()` every
 * `INTERVAL_MS`: which colo its outbound calls enter Cloudflare from, and how long a few fixed targets take to
 * answer. Each sample is one SQLite row.
 */
export class ProbeDO extends DurableObject<Env> {
  /** Changes when the runtime constructs the object again (eviction, restart or a move). */
  private readonly instance = crypto.randomUUID().slice(0, 8);
  /** Outbound fetch, replaced in tests. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
  }

  /** Records the hint and takes the first sample now, unless an alarm is already set. */
  async start(hint: Hint): Promise<ProbeStatus> {
    this.ctx.storage.kv.put("hint", hint);
    this.ctx.storage.kv.put("running", true);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
    return this.status();
  }

  async stop(): Promise<ProbeStatus> {
    this.ctx.storage.kv.put("running", false);
    await this.ctx.storage.deleteAlarm();
    return this.status();
  }

  /** Stops the probe and deletes every sample. */
  async reset(): Promise<ProbeStatus> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.ctx.storage.sql.exec(SCHEMA);
    return this.status();
  }

  async status(): Promise<ProbeStatus> {
    const next = await this.ctx.storage.getAlarm();
    return {
      hint: this.ctx.storage.kv.get<string>("hint") ?? null,
      running: this.ctx.storage.kv.get<boolean>("running") ?? false,
      nextAlarm: next === null ? null : new Date(next).toISOString(),
    };
  }

  /** Status plus the summary of samples taken since `since` (ms since epoch; everything when 0). */
  async summary(since = 0): Promise<ProbeStatus & ProbeSummary> {
    return { ...(await this.status()), ...summarize(this.rows(since)) };
  }

  /** Raw samples since `since`, oldest first. */
  samples(since = 0): SampleRow[] {
    return this.rows(since);
  }

  override async alarm(info?: AlarmInvocationInfo): Promise<void> {
    if (!this.ctx.storage.kv.get<boolean>("running")) return;
    const ts = Date.now();
    // Set the next alarm before measuring, so nothing below can end the chain.
    await this.ctx.storage.setAlarm(ts + INTERVAL_MS);
    const sample = await measure(this.fetcher);
    const timings: Record<string, number | null> = { trace: sample.trace.ms };
    for (const [target, timing] of Object.entries(sample.targets)) timings[target] = timing.ms;
    this.ctx.storage.sql.exec(
      "INSERT INTO samples (ts, scheduled, retry, instance, colo, loc, timings) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ts,
      info?.scheduledTime ?? null,
      info?.retryCount ?? 0,
      this.instance,
      sample.colo,
      sample.loc,
      JSON.stringify(timings),
    );
    this.ctx.storage.sql.exec("DELETE FROM samples WHERE ts < ?", ts - RETENTION_MS);
  }

  private rows(since: number): SampleRow[] {
    return this.ctx.storage.sql
      .exec<StoredRow>("SELECT * FROM samples WHERE ts >= ? ORDER BY ts", since)
      .toArray()
      .map((row) => ({ ...row, timings: JSON.parse(row.timings) as SampleRow["timings"] }));
  }
}
