// The workspace shard's side of monitoring (RFC 0007): pushing each region's checks to its `ProbeDO`, turning
// probe reports and heartbeats into `monitor.report` mutations, and the shard alarm that catches what pushes
// nothing: missed heartbeats, probes that stopped reporting, and pushes that failed.

import { monitor_incident_title } from "@freecorps/brigade-i18n/messages";
import {
  MONITOR_ACTOR,
  newId,
  PROBE_REGIONS,
  REPORT_EVERY_MS,
  type CheckSource,
  type MonitorRow,
  type ProbeRegion,
  type RandomBytes,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { HttpCheckConfig } from "./check.ts";
import { probeName, type ProbeDO, type ProbeReport } from "./probe.ts";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** The shard alarm runs at least this often while any monitor exists. */
export const MONITOR_TICK_MS = 60 * 1000;
/** Each region's config is pushed again this often even unchanged, which re-arms a probe whose alarm was lost. */
export const REPUSH_MS = 10 * 60 * 1000;
/** A region that reported nothing for this long is pushed again and logged as stalled. */
export const STALE_MS = 3 * REPORT_EVERY_MS;

const SCHEMA = `
  create table if not exists probe_pushes (
    region text primary key,
    config text not null,
    at integer not null
  ) without rowid;
`;

export type MonitorReport = Omit<ProbeReport, "reportId"> & { source: CheckSource };

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
    const { shard } = this.options;
    const now = Date.now();
    const stored = shard.storedResult(MONITOR_ACTOR.id, clientId, mutationId, now);
    if (stored) return stored;
    const monitor = shard.store.get("monitors", report.id);
    const random = this.options.randomBytes;
    const { result, changes } = shard.mutate({
      clientId,
      mutationId,
      actor: MONITOR_ACTOR,
      name: "monitor.report",
      args: {
        ...report,
        open: {
          alertId: newId("alt", now, random),
          incidentId: newId("inc", now, random),
          // TODO(RFC 0008): the workspace's default locale, once workspaces have one.
          title: monitor_incident_title({ name: monitor?.name ?? report.id }, { locale: "en" }),
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
   * or every `REPORT_EVERY_MS`, so a ping a minute does not make a shard version a minute.
   */
  ping(monitorId: string, digest: ArrayBuffer): boolean {
    const { store } = this.options.shard;
    const secret = store.get("heartbeats", monitorId);
    const monitor = store.get("monitors", monitorId);
    if (!secret || !monitor || digest.byteLength !== 32) return false;
    if (!crypto.subtle.timingSafeEqual(hexBytes(secret.tokenHash), digest)) return false;
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
    return true;
  }

  /**
   * The shard alarm's monitor work. Sets the next alarm first (or deletes it once no monitor or probe needs it),
   * so a failure below never ends the chain.
   */
  async tick(now: number): Promise<void> {
    const { storage, log } = this.options;
    const monitors = this.options.shard.store.scan("monitors");
    const pushed = storage.sql
      .exec<{ n: number }>("select count(*) as n from probe_pushes")
      .one().n;
    const next = this.nextWake(monitors, now);
    if (next !== null || pushed > 0) await storage.setAlarm(next ?? now + MONITOR_TICK_MS);
    else await storage.deleteAlarm();

    try {
      this.missedHeartbeats(monitors, now);
    } catch (error) {
      log("heartbeat deadlines failed", { error });
    }
    await this.pushProbes(monitors, now);
  }

  /** The earliest of a tick from now and the next heartbeat deadline; null without active monitors. */
  private nextWake(monitors: MonitorRow[], now: number): number | null {
    const active = monitors.filter((monitor) => !monitor.paused);
    if (active.length === 0) return null;
    let next = now + MONITOR_TICK_MS;
    for (const monitor of active) {
      if (monitor.kind !== "heartbeat") continue;
      next = Math.min(next, Math.max(now + 1000, this.deadline(monitor)));
    }
    return next;
  }

  /** When a heartbeat monitor is late: its last ping (or its start) plus the interval and the grace. */
  private deadline(monitor: MonitorRow): number {
    const secret = this.options.shard.store.get("heartbeats", monitor.id);
    const base = Math.max(secret?.lastPingAt ?? 0, monitor.since);
    return base + (monitor.intervalSeconds + (monitor.graceSeconds ?? 0)) * 1000;
  }

  /** A missed heartbeat is a failed check from its one source, so one miss makes the monitor down. */
  private missedHeartbeats(monitors: MonitorRow[], now: number): void {
    for (const monitor of monitors) {
      if (monitor.kind !== "heartbeat" || monitor.paused || now < this.deadline(monitor)) continue;
      const last = monitor.checks.find((check) => check.source === "heartbeat");
      if (last && !last.up && now - last.at < REPORT_EVERY_MS) continue;
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
            monitor.kind === "http" && !monitor.paused && monitor.regions.includes(region),
        );
        const checks = active.map(toConfig);
        const config = JSON.stringify(checks);
        const last = pushes.get(region);
        if (!last && checks.length === 0) return;
        const stale = active.some((monitor) => {
          const check = monitor.checks.find((c) => c.source === region);
          return now - (check?.at ?? monitor.since) > STALE_MS;
        });
        if (stale) log("probe stalled", { region });
        if (last && last.config === config && now - last.at < REPUSH_MS && !stale) return;
        try {
          const stub = this.options.probes.getByName(probeName(workspaceId, region), {
            locationHint: region,
          });
          const { ok } = await stub.configure(workspaceId, region, checks);
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

function toConfig(monitor: MonitorRow): HttpCheckConfig {
  return {
    id: monitor.id,
    url: monitor.url!,
    method: monitor.method!,
    expectedStatus: monitor.expectedStatus,
    keyword: monitor.keyword,
    intervalSeconds: monitor.intervalSeconds,
    timeoutSeconds: monitor.timeoutSeconds!,
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
