// Pure functions over stored samples; no Workers APIs, so the Node report script can import the types.

/** One stored sample, as `ProbeDO` reads it back from SQLite. */
export type SampleRow = {
  /** When the alarm handler started (ms since epoch). */
  ts: number;
  /** When the alarm was set to fire, or null if the runtime passed no alarm info. */
  scheduled: number | null;
  /** The alarm's retry count (0 on a normal run). */
  retry: number;
  /** Random per object instance (per constructor run): a new value means the object restarted. */
  instance: string;
  colo: string | null;
  loc: string | null;
  /** Milliseconds to response headers per target (`trace` included), null when the request failed. */
  timings: Record<string, number | null>;
};

export type Stats = { n: number; min: number; p50: number; p95: number; max: number };

export type ColoCount = { colo: string; samples: number; first: string; last: string };

/** A run of consecutive samples from one colo. */
export type Segment = { colo: string; from: string; to: string; samples: number };

export type ProbeSummary = {
  samples: number;
  first: string | null;
  last: string | null;
  /** Colos seen, most samples first. */
  colos: ColoCount[];
  /** Samples whose trace named no colo. */
  noColo: number;
  /** Egress country (`loc` in the trace) to sample count. */
  countries: Record<string, number>;
  /** Times the colo changed between consecutive samples. */
  moves: number;
  /** The last `MAX_SEGMENTS` runs of one colo, oldest first. */
  segments: Segment[];
  /** Distinct object instances: 1 means the object never restarted in the window. */
  instances: number;
  /** Seconds between consecutive samples. */
  gapSeconds: Stats | null;
  /** How late each alarm ran after the time it was set for, in ms. */
  lateMs: Stats | null;
  /** Samples that were alarm retries. */
  retries: number;
  /** Per target: latency of the requests that answered, and how many failed. */
  latencyMs: Record<string, { stats: Stats | null; failures: number }>;
};

export const MAX_SEGMENTS = 20;

export function summarize(rows: readonly SampleRow[]): ProbeSummary {
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const colos = new Map<string, { samples: number; first: number; last: number }>();
  const countries: Record<string, number> = {};
  const segments: { colo: string; from: number; to: number; samples: number }[] = [];
  const latencies = new Map<string, { values: number[]; failures: number }>();
  const gaps: number[] = [];
  const late: number[] = [];
  let noColo = 0;
  let retries = 0;

  sorted.forEach((row, index) => {
    const previous = sorted[index - 1];
    if (previous) gaps.push((row.ts - previous.ts) / 1000);
    if (row.scheduled !== null) late.push(row.ts - row.scheduled);
    if (row.retry > 0) retries++;
    if (row.loc) countries[row.loc] = (countries[row.loc] ?? 0) + 1;

    if (row.colo === null) noColo++;
    else {
      const seen = colos.get(row.colo);
      if (seen) {
        seen.samples++;
        seen.last = row.ts;
      } else colos.set(row.colo, { samples: 1, first: row.ts, last: row.ts });
      // Samples without a colo neither end nor start a run.
      const run = segments.at(-1);
      if (run?.colo === row.colo) {
        run.samples++;
        run.to = row.ts;
      } else segments.push({ colo: row.colo, from: row.ts, to: row.ts, samples: 1 });
    }

    for (const [target, ms] of Object.entries(row.timings)) {
      let entry = latencies.get(target);
      if (!entry) latencies.set(target, (entry = { values: [], failures: 0 }));
      if (ms === null) entry.failures++;
      else entry.values.push(ms);
    }
  });

  const first = sorted[0];
  const last = sorted.at(-1);
  return {
    samples: sorted.length,
    first: first ? iso(first.ts) : null,
    last: last ? iso(last.ts) : null,
    colos: [...colos]
      .map(([colo, seen]) => ({
        colo,
        samples: seen.samples,
        first: iso(seen.first),
        last: iso(seen.last),
      }))
      .sort((a, b) => b.samples - a.samples || a.colo.localeCompare(b.colo)),
    noColo,
    countries,
    moves: Math.max(0, segments.length - 1),
    segments: segments.slice(-MAX_SEGMENTS).map((run) => ({
      colo: run.colo,
      from: iso(run.from),
      to: iso(run.to),
      samples: run.samples,
    })),
    instances: new Set(sorted.map((row) => row.instance)).size,
    gapSeconds: stats(gaps),
    lateMs: stats(late),
    retries,
    latencyMs: Object.fromEntries(
      [...latencies].map(([target, entry]) => [
        target,
        { stats: stats(entry.values), failures: entry.failures },
      ]),
    ),
  };
}

/** Nearest-rank percentiles; null for no values. */
export function stats(values: readonly number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)]!;
  return {
    n: sorted.length,
    min: sorted[0]!,
    p50: rank(50),
    p95: rank(95),
    max: sorted.at(-1)!,
  };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
