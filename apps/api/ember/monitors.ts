// Monitors on a workspace's Ember shard (RFC 0007, RFC 0016 "Parity"): `WorkspaceDO.report` (a probe's verdicts),
// `heartbeat` (a ping) and the alarm's monitor work, with the same `Monitoring` the DO runs, over the shard facade.
// The alarm's part is the `monitors` tick (ember/ticks.ts), an action since it pushes each region's checks to its
// probe: `check` (missed heartbeats, stale monitors, the pushes due), the pushes, then `pushed` for each the probe
// took and `arm` for the next tick. A monitor a member changes arms it at once (`armUpkeep`), as the DO's alarm.

import {
  internalActionGeneric,
  internalMutationGeneric,
  makeFunctionReference,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import type { ProbeRegion } from "@freecorps/brigade-schema";
import type { CheckConfig } from "../src/check.ts";
import {
  isProbeRegion,
  MONITOR_TICK_MS,
  Monitoring,
  PROBE_PUSH_TIMEOUT_MS,
} from "../src/monitors.ts";
import { within } from "../src/deadline.ts";
import { probeName } from "../src/probe-name.ts";
import type { ProbeReport } from "../src/probe.ts";
import { emberWorkspace } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

const CHECK = makeFunctionReference<"mutation">("monitors:check");
const PUSHED = makeFunctionReference<"mutation">("monitors:pushed");
const ARM = makeFunctionReference<"mutation">("monitors:arm");

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** A `Monitoring` over this mutation's shard facade; it never pushes (the `tick` action does). */
function monitoringOf(ctx: MutationCtx) {
  const { shard, storage } = emberWorkspace(ctx);
  const monitoring = new Monitoring({
    storage,
    shard: shard as never,
    probes: undefined as never,
    randomBytes: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
      return bytes;
    },
    log,
    // Ember's subscriptions follow the rows: nothing to broadcast.
    committed: () => {},
  });
  return { shard, monitoring };
}

/**
 * A probe's verdicts for its region (`WorkspaceDO.report`): per report, whether the probe may stop sending it. A
 * shard that serves another workspace, or none, takes them all (nothing here will ever apply them).
 */
export const report = internalMutationGeneric({
  args: { workspaceId: v.string(), region: v.string(), reports: v.any() },
  handler: (
    ctx,
    input: { workspaceId: string; region: string; reports: ProbeReport[] },
  ): boolean[] => {
    const c = ctx as MutationCtx;
    const { shard, monitoring } = monitoringOf(c);
    const { region, reports } = input;
    if (!isProbeRegion(region) || shard.workspace() !== input.workspaceId) {
      return reports.map(() => true);
    }
    const out = reports.map(({ reportId, ...one }) => {
      const result = monitoring.report(`probe:${region}`, reportId, { ...one, source: region });
      return result.ok || ["conflict", "not_found", "invalid_args"].includes(result.error.code);
    });
    shard.check();
    return out;
  },
});

/**
 * A heartbeat ping with the SHA-256 of its token's secret (`WorkspaceDO.heartbeat`): false for an unknown monitor or a
 * wrong token alike. An accepted one keeps the monitor tick armed, since it is what notices the next missed ping.
 */
export const heartbeat = internalMutationGeneric({
  args: { workspaceId: v.string(), monitorId: v.string(), digest: v.array(v.number()) },
  handler: (ctx, input: { workspaceId: string; monitorId: string; digest: number[] }): boolean => {
    const c = ctx as MutationCtx;
    const { shard, monitoring } = monitoringOf(c);
    if (shard.workspace() !== input.workspaceId) return false;
    const accepted = monitoring.accept(input.monitorId, Uint8Array.from(input.digest));
    if (accepted) tickAt(c, c.now + MONITOR_TICK_MS, "monitors");
    shard.check();
    return accepted;
  },
});

type Push = { region: ProbeRegion; checks: CheckConfig[]; config: string };

/** The tick's checks (missed heartbeats, stale monitors), and the pushes due, for the `tick` action. */
export const check = internalMutationGeneric({
  args: {},
  handler: (ctx): { workspaceId: string; pushes: Push[] } | null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard, monitoring } = monitoringOf(c);
    const workspaceId = shard.workspace();
    if (workspaceId === undefined) return null;
    // The key as a parameter: `ctx.sql` refuses a schema table's name (`monitors`) quoted in the statement.
    c.sql.exec("delete from ember_ticks where key = ?", "monitors");
    monitoring.checkDue(c.now);
    const pushes = monitoring.pushesDue(c.now);
    // A fallback a tick from now while the monitors want ticks at all, as the DO sets one before its alarm's work: an
    // action that dies after this commit (before `arm`) never ends the chain. `arm` brings it forward if need be.
    if (pushes.length > 0 || monitoring.nextAt(c.now) !== null) {
      tickAt(c, c.now + MONITOR_TICK_MS, "monitors");
    }
    shard.check();
    return { workspaceId, pushes };
  },
});

/** A push its probe took (`Monitoring.pushed`). */
export const pushed = internalMutationGeneric({
  args: { region: v.string(), config: v.string(), checks: v.number(), at: v.number() },
  handler: (ctx, input: { region: string; config: string; checks: number; at: number }): null => {
    const c = ctx as MutationCtx;
    if (!isProbeRegion(input.region)) return null;
    monitoringOf(c).monitoring.pushed(input.region, input.config, input.checks, input.at);
    return null;
  },
});

/** The next monitor tick, when the monitors want one (`Monitoring.nextAt`). */
export const arm = internalMutationGeneric({
  args: {},
  handler: (ctx): number | null => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard, monitoring } = monitoringOf(c);
    if (shard.workspace() === undefined) return null;
    const at = monitoring.nextAt(c.now);
    if (at !== null) tickAt(c, at, "monitors");
    return at;
  },
});

type ProbeStub = {
  configure(
    workspaceId: string,
    region: ProbeRegion,
    checks: CheckConfig[],
  ): Promise<{ ok: boolean }>;
};
type ActionCtx = {
  env: { PROBE: { getByName(name: string, options: { locationHint: string }): ProbeStub } };
  runMutation(ref: unknown, args: unknown): Promise<unknown>;
};

/**
 * The shard alarm's monitor work, as `Monitoring.tick`: the checks, each region's push (a failed one is tried again on
 * the next tick), then the next tick armed.
 */
export const tick = internalActionGeneric({
  args: {},
  handler: async (ctx): Promise<{ pushed: number }> => {
    const c = ctx as unknown as ActionCtx;
    const due = (await c.runMutation(CHECK, {})) as { workspaceId: string; pushes: Push[] } | null;
    if (!due) return { pushed: 0 };
    let count = 0;
    try {
      await Promise.all(
        due.pushes.map(async ({ region, checks, config }) => {
          const at = Date.now();
          try {
            const stub = c.env.PROBE.getByName(probeName(due.workspaceId, region), {
              locationHint: region,
            });
            const { ok } = await within(
              stub.configure(due.workspaceId, region, checks),
              PROBE_PUSH_TIMEOUT_MS,
              "probe configure",
            );
            if (!ok) throw new Error("probe refused the config");
          } catch (error) {
            log("probe push failed", { region, error: String(error) });
            return;
          }
          await c.runMutation(PUSHED, { region, config, checks: checks.length, at });
          count++;
        }),
      );
    } finally {
      // Whatever the pushes did: the next tick is armed, or nothing would ever run the monitors again.
      await c.runMutation(ARM, {});
    }
    return { pushed: count };
  },
});
