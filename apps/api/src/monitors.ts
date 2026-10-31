// The workspace shard's side of monitoring (RFC 0007): pushing each region's checks to its `ProbeDO`, turning
// probe reports and heartbeats into `monitor.report` mutations, and the shard alarm that catches what pushes
// nothing: missed heartbeats, probes that stopped reporting (`monitor.evaluate`), and pushes that failed.

import { monitor_incident_title } from "@freecorps/brigade-i18n/messages";
import {
  CONSECUTIVE_CHECKS,
  consecutiveChecks,
  expectedStatuses,
  MAX_MONITORS_PER_WORKSPACE,
  MONITOR_ACTOR,
  MONITOR_CAP_MAX,
  monitorStatus,
  newId,
  PROBE_REGIONS,
  REPORT_EVERY_MS,
  type CheckSource,
  type MonitorRow,
  type ProbeRegion,
  type RandomBytes,
  workspaceLocale,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { CheckConfig } from "./check.ts";
import { within } from "./deadline.ts";
import { probeName, type ProbeDO, type ProbeReport } from "./probe.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** The shard alarm runs at least this often while any monitor exists. */
export const MONITOR_TICK_MS = 60 * 1000;
/** Each region's config is pushed again this often even unchanged, which re-arms a probe whose alarm was lost. */
export const REPUSH_MS = 10 * 60 * 1000;
/** A region that reported nothing for this long is pushed again and logged as stalled. */
export const STALE_MS = 3 * REPORT_EVERY_MS;
/**
 * How long a probe gets to take its checks. The push runs in the shard's alarm, before the drain and the escalations
 * after it, and pushes to a stalled region on every tick: a probe whose region is in trouble must not hold them up.
 * Past this it is a failed push, tried again on the next tick.
 */
export const PROBE_PUSH_TIMEOUT_MS = 5000;

const SCHEMA = `
  create table if not exists probe_pushes (
    region text primary key,
    config text not null,
    at integer not null
  ) without rowid;
`;

export type MonitorReport = Omit<ProbeReport, "reportId"> & { source: CheckSource };

/** The optional env var an operator caps every workspace's monitors with (RFC 0007 "Limits"). */
export type MonitorEnv = { MAX_MONITORS?: string };

/**
 * The most monitors any workspace on this instance may have: `MAX_MONITORS` when it is a whole number from 1 to
 * `MONITOR_CAP_MAX`, else `MAX_MONITORS_PER_WORKSPACE` (a value it cannot read is logged and ignored). An owner may
 * set a lower one for their workspace (`monitor.setCap`).
 */
export function instanceMonitorCap(env: MonitorEnv): number {
  const raw = env.MAX_MONITORS?.trim();
  if (!raw) return MAX_MONITORS_PER_WORKSPACE;
  const cap = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(cap) && cap >= 1 && cap <= MONITOR_CAP_MAX) return cap;
  console.error(
    JSON.stringify({
      message: `MAX_MONITORS is not a whole number from 1 to ${MONITOR_CAP_MAX}; ignored`,
    }),
  );
  return MAX_MONITORS_PER_WORKSPACE;
}

export type MonitoringOptions = {
  storage: DurableObjectStorage;
  shard: Shard;
  probes: DurableObjectNamespace<ProbeDO>;
  randomBytes: RandomBytes;
  log: (message: string, fields: Record<string, unknown>) => void;
  /** Sends the patches of a committed system mutation to the shard's sockets. */
  committed: (version: number, changes: readonly RowChange[]) => void;
};

export class Monitoring {
  constructor(private readonly options: MonitoringOptions) {
    options.storage.sql.exec(SCHEMA);
  }

  /**
   * Runs `monitor.report` as the monitors' system actor. `mutationId` de-duplicates a retried probe report.
   * Throws on a storage failure, so the caller (a probe) retries.
   */
  report(clientId: string, mutationId: string, report: MonitorReport): MutationResultMessage {
    return this.run(clientId, mutationId, "monitor.report", report);
  }

  /**
   * Runs a server-only monitor mutation as the monitors' system actor, with the ids and the title of the incident
   * it may open (mutations make neither). De-duplicated by `mutationId`.
   */
  private run(
    clientId: string,
    mutationId: string,
    name: "monitor.report" | "monitor.evaluate",
    args: { id: string },
  ): MutationResultMessage {
    const { shard } = this.options;
    const now = Date.now();
    const stored = shard.storedResult(MONITOR_ACTOR.id, clientId, mutationId, now);
    if (stored) return stored;
    const monitor = shard.store.get("monitors", args.id);
    const random = this.options.randomBytes;
    const { result, changes } = shard.mutate({
      clientId,
      mutationId,
      actor: MONITOR_ACTOR,
      name,
      args: {
        ...args,
        open: {
          alertId: newId("alt", now, random),
          incidentId: newId("inc", now, random),
          // Shared text: in the workspace's locale (RFC 0008, Q15).
          title: monitor_incident_title(
            { name: monitor?.name ?? args.id },
            { locale: workspaceLocale(shard.store.scan("workspace")[0]) },
          ),
        },
      },
      now,
      internal: true,
    });
    if (result.ok) this.options.committed(result.version, changes);
    return result;
  }

  /**
   * A heartbeat ping with the SHA-256 of its token: false unless the monitor exists with that hash (compared in
   * constant time). The exact time is kept server-side; the monitor row is updated only when the source turns up
   * or every `REPORT_EVERY_MS`, so a ping a minute does not make a shard version a minute. An accepted ping also
   * re-arms the shard alarm if it was lost, since that alarm is what notices the next missed ping.
   */
  async ping(monitorId: string, digest: ArrayBuffer): Promise<boolean> {
    const { store } = this.options.shard;
    const secret = store.get("heartbeats", monitorId);
    const monitor = store.get("monitors", monitorId);
    if (!secret || !monitor || digest.byteLength !== 32) return false;
    const stored = hexBytes(secret.tokenHash);
    // timingSafeEqual throws on a length mismatch; a malformed stored hash is a refusal, not a 500.
    if (stored.byteLength !== digest.byteLength) return false;
    if (!crypto.subtle.timingSafeEqual(stored, digest)) return false;
    if (monitor.paused) return true;
    const now = Date.now();
    store.update("heartbeats", monitorId, { lastPingAt: now });
    const last = monitor.checks.find((check) => check.source === "heartbeat");
    if (!last || !last.up || now - last.at >= REPORT_EVERY_MS) {
      this.report("heartbeat", newId("png", now, this.options.randomBytes), {
        id: monitorId,
        source: "heartbeat",
        at: now,
        up: true,
        latencyMs: null,
        colo: null,
        httpStatus: null,
        error: null,
      });
    }
    const { storage } = this.options;
    if ((await storage.getAlarm()) === null) await storage.setAlarm(now + MONITOR_TICK_MS);
    return true;
  }

  /**
   * The shard alarm's monitor work. Returns when it wants the alarm next: the next tick or heartbeat deadline, a
   * tick from now while a region still waits for its final push, or null once no monitor or probe needs it. The
   * caller (`WorkspaceDO.alarm`) sets a fallback alarm before calling, so a failure here never ends the chain.
   */
  async tick(now: number): Promise<number | null> {
    const { storage, log } = this.options;
    const monitors = this.options.shard.store.scan("monitors");
    try {
      this.missedHeartbeats(monitors, now);
    } catch (error) {
      log("heartbeat deadlines failed", { error });
    }
    try {
      this.staleMonitors(monitors, now);
    } catch (error) {
      log("stale monitors failed", { error });
    }
    try {
      await this.pushProbes(monitors, now);
    } catch (error) {
      log("probe pushes failed", { error });
    }
    const latest = this.options.shard.store.scan("monitors");
    const pushed = storage.sql
      .exec<{ n: number }>("select count(*) as n from probe_pushes")
      .one().n;
    return this.nextWake(latest, now) ?? (pushed === 0 ? null : now + MONITOR_TICK_MS);
  }

  /** The earliest of a tick from now and the next heartbeat deadline; null without active monitors. */
  private nextWake(monitors: MonitorRow[], now: number): number | null {
    const active = monitors.filter((monitor) => !monitor.paused);
    if (active.length === 0) return null;
    let next = now + MONITOR_TICK_MS;
    for (const monitor of active) {
      if (monitor.kind !== "heartbeat") continue;
      next = Math.min(next, Math.max(now + 1000, this.nextMiss(monitor)));
    }
    return next;
  }

  /** When a heartbeat monitor is late: its last ping (or its restart) plus the interval and the grace. */
  private deadline(monitor: MonitorRow): number {
    const secret = this.options.shard.store.get("heartbeats", monitor.id);
    const base = Math.max(secret?.lastPingAt ?? 0, monitor.restartedAt);
    return base + (monitor.intervalSeconds + (monitor.graceSeconds ?? 0)) * 1000;
  }

  /** When `missedHeartbeats` next reports this monitor: its deadline, or a refresh of a miss already reported. */
  private nextMiss(monitor: MonitorRow): number {
    const deadline = this.deadline(monitor);
    const last = monitor.checks.find((check) => check.source === "heartbeat");
    return last && !last.up && last.at >= deadline ? last.at + REPORT_EVERY_MS : deadline;
  }

  /** A missed heartbeat is a failed check from its one source, so one miss makes the monitor down. */
  private missedHeartbeats(monitors: MonitorRow[], now: number): void {
    for (const monitor of monitors) {
      if (monitor.kind !== "heartbeat" || monitor.paused || now < this.nextMiss(monitor)) continue;
      this.report("heartbeat", newId("mis", now, this.options.randomBytes), {
        id: monitor.id,
        source: "heartbeat",
        at: now,
        up: false,
        latencyMs: null,
        colo: null,
        httpStatus: null,
        error: "missed",
      });
    }
  }

  /**
   * HTTP and TCP monitors whose results went stale since the last report (`monitorStatus`): every probe stopped
   * reporting, or too many did. Each gets `monitor.evaluate`, which turns it `unknown` (no data) and emits
   * `monitor.status_changed`; a firing alert stays (RFC 0007 "Quorum and flapping").
   */
  private staleMonitors(monitors: MonitorRow[], now: number): void {
    for (const monitor of monitors) {
      if (monitor.kind === "heartbeat" || monitor.paused) continue;
      if (monitorStatus(monitor, monitor.checks, now) === monitor.status) continue;
      this.run("monitor", newId("evl", now, this.options.randomBytes), "monitor.evaluate", {
        id: monitor.id,
      });
    }
  }

  /**
   * Pushes each region's checks to its probe when they changed, every `REPUSH_MS` anyway, and at once when an
   * active monitor's region has not reported for `STALE_MS`. A region no monitor uses any more gets an empty list
   * (which stops its alarm) and is forgotten once that push succeeds. A failed push is retried on the next tick.
   */
  private async pushProbes(monitors: MonitorRow[], now: number): Promise<void> {
    const { storage, shard, log } = this.options;
    const workspaceId = shard.workspace();
    if (workspaceId === undefined) return;
    const pushes = new Map(
      storage.sql
        .exec<{ region: string; config: string; at: number }>("select * from probe_pushes")
        .toArray()
        .map((row) => [row.region, row]),
    );
    await Promise.all(
      PROBE_REGIONS.map(async (region) => {
        const active = monitors.filter(
          (monitor) =>
            monitor.kind !== "heartbeat" && !monitor.paused && monitor.regions.includes(region),
        );
        const checks = active.map(toConfig);
        const config = JSON.stringify(checks);
        const last = pushes.get(region);
        if (!last && checks.length === 0) return;
        // Quiet for longer than a refresh allows: `STALE_MS`, or a whole check interval plus a refresh for a
        // monitor checked less often than that (an hourly check is not a stalled probe 15 minutes in).
        const stale = active.some((monitor) => {
          const check = monitor.checks.find((c) => c.source === region);
          const window = Math.max(STALE_MS, monitor.intervalSeconds * 1000 + REPORT_EVERY_MS);
          return now - (check?.at ?? monitor.restartedAt) > window;
        });
        if (stale) log("probe stalled", { region });
        if (last && last.config === config && now - last.at < REPUSH_MS && !stale) return;
        try {
          const stub = this.options.probes.getByName(probeName(workspaceId, region), {
            locationHint: region,
          });
          const { ok } = await within(
            stub.configure(workspaceId, region, checks),
            PROBE_PUSH_TIMEOUT_MS,
            "probe configure",
          );
          if (!ok) throw new Error("probe refused the config");
        } catch (error) {
          log("probe push failed", { region, error });
          return;
        }
        if (checks.length === 0)
          storage.sql.exec("delete from probe_pushes where region = ?", region);
        else {
          storage.sql.exec(
            `insert into probe_pushes (region, config, at) values (?, ?, ?)
             on conflict (region) do update set config = excluded.config, at = excluded.at`,
            region,
            config,
            now,
          );
        }
      }),
    );
  }
}

/**
 * What a probe runs for `monitor`. A setting at its default is left out, so a monitor that uses none of them pushes
 * the same config as before they existed, and a deploy does not start every probe's streaks over (`configure`
 * restarts a check whose config changed).
 */
export function toConfig(monitor: MonitorRow): CheckConfig {
  const streak =
    consecutiveChecks(monitor) === CONSECUTIVE_CHECKS
      ? {}
      : { consecutiveChecks: consecutiveChecks(monitor) };
  if (monitor.kind === "tcp") {
    return {
      kind: "tcp",
      id: monitor.id,
      host: monitor.host!,
      port: monitor.port!,
      intervalSeconds: monitor.intervalSeconds,
      timeoutSeconds: monitor.timeoutSeconds!,
      ...streak,
    };
  }
  const ranges = expectedStatuses(monitor);
  // One status is sent as before ranges existed; only a list or a range needs the new field.
  const single = ranges !== null && ranges.length === 1 && ranges[0]!.min === ranges[0]!.max;
  const headers = monitor.headers ?? [];
  // No `kind`: the config an HTTP check had before TCP checks, so a deploy does not restart every probe's streaks.
  return {
    id: monitor.id,
    url: monitor.url!,
    method: monitor.method!,
    expectedStatus: single ? ranges[0]!.min : null,
    ...(ranges !== null && !single && { expectedStatuses: ranges }),
    keyword: monitor.keyword,
    ...(monitor.keyword !== null && monitor.keywordMode === "regex" && { keywordMode: "regex" }),
    ...(headers.length > 0 && { headers }),
    intervalSeconds: monitor.intervalSeconds,
    timeoutSeconds: monitor.timeoutSeconds!,
    ...streak,
  };
}

function hexBytes(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer;
}

/** The region a probe report names, if it is one. */
export function isProbeRegion(value: unknown): value is ProbeRegion {
  return (PROBE_REGIONS as readonly unknown[]).includes(value);
}
