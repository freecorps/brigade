/**
 * Prints the S2 summary as tables.
 *
 *   vpx scripts/report.ts https://brigade-probe-dev.<subdomain>.workers.dev [--hours 48] [--json]
 *
 * The URL can also come from PROBE_URL. Reads `/summary` with the admin token from PROBE_ADMIN_TOKEN.
 */
import { parseArgs } from "node:util";
import type { ProbeSummary, Stats } from "../src/summary.ts";

type Probe = { hint: string; error?: string } & Partial<
  ProbeSummary & { running: boolean; nextAlarm: string | null }
>;
type Report = {
  generatedAt: string;
  since: string | null;
  intervalSeconds: number;
  targets: Record<string, string>;
  probes: Probe[];
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { hours: { type: "string" }, json: { type: "boolean" } },
});
const base = positionals[0] ?? process.env.PROBE_URL;
if (!base) {
  console.error(
    "usage: vpx scripts/report.ts <worker url> [--hours N] [--json]  (or set PROBE_URL)",
  );
  process.exit(2);
}

const token = process.env.PROBE_ADMIN_TOKEN;
if (!token) {
  console.error("set PROBE_ADMIN_TOKEN (the Worker's admin token)");
  process.exit(2);
}

const url = new URL("/summary", base);
// The token must not cross the network in clear; plain HTTP only to a local `wrangler dev`.
if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  console.error("refusing to send PROBE_ADMIN_TOKEN over plain HTTP; use an https:// URL");
  process.exit(2);
}
if (values.hours) url.searchParams.set("hours", values.hours);
const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
if (!response.ok) {
  console.error(`GET ${url.pathname}: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const report = (await response.json()) as Report;
if (values.json) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const targets = ["trace", ...Object.keys(report.targets)];
console.log(
  `Generated ${report.generatedAt}, window ${report.since ? `since ${report.since}` : "all samples"}, ` +
    `one sample every ${report.intervalSeconds}s per hint.\n`,
);

console.log("Placement");
table(
  ["hint", "on", "samples", "first", "last", "colos (samples)", "moves", "instances", "egress"],
  report.probes.map((probe) =>
    probe.error
      ? [probe.hint, "?", probe.error]
      : [
          probe.hint,
          probe.running ? "yes" : "no",
          String(probe.samples ?? 0),
          short(probe.first),
          short(probe.last),
          (probe.colos ?? []).map((c) => `${c.colo} (${c.samples})`).join(", ") +
            (probe.noColo ? `, none (${probe.noColo})` : ""),
          String(probe.moves ?? 0),
          String(probe.instances ?? 0),
          Object.entries(probe.countries ?? {})
            .map(([country, count]) => `${country} (${count})`)
            .join(", "),
        ],
  ),
);

console.log(
  "\nAlarms: seconds between samples (p50 / p95 / max), ms late (p50 / p95 / max), retries",
);
table(
  ["hint", "gap s", "late ms", "retries"],
  report.probes
    .filter((probe) => !probe.error)
    .map((probe) => [
      probe.hint,
      triple(probe.gapSeconds),
      triple(probe.lateMs),
      String(probe.retries ?? 0),
    ]),
);

console.log("\nLatency to response headers, ms (p50 / p95 / max), failed requests in brackets");
table(
  ["hint", ...targets],
  report.probes
    .filter((probe) => !probe.error)
    .map((probe) => [
      probe.hint,
      ...targets.map((target) => {
        const entry = probe.latencyMs?.[target];
        if (!entry) return "-";
        return triple(entry.stats) + (entry.failures ? ` [${entry.failures}]` : "");
      }),
    ]),
);

const moved = report.probes.filter((probe) => (probe.moves ?? 0) > 0);
for (const probe of moved) {
  console.log(`\n${probe.hint}: colo runs (last ${probe.segments?.length ?? 0})`);
  table(
    ["colo", "from", "to", "samples"],
    (probe.segments ?? []).map((run) => [
      run.colo,
      short(run.from),
      short(run.to),
      String(run.samples),
    ]),
  );
}

function triple(stats: Stats | null | undefined): string {
  return stats ? `${round(stats.p50)} / ${round(stats.p95)} / ${round(stats.max)}` : "-";
}

function round(value: number): string {
  return String(Math.round(value));
}

/** `2026-10-25T12:34:56.789Z` to `10-25 12:34`. */
function short(iso: string | null | undefined): string {
  return iso ? `${iso.slice(5, 10)} ${iso.slice(11, 16)}` : "-";
}

function table(header: string[], rows: string[][]): void {
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  console.log(line(header));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(row));
}
