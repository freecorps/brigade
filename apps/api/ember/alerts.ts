// Alert sources on a workspace's Ember shard (RFC 0005 "Alert sources", RFC 0016 "Parity"): `WorkspaceDO.alert`,
// `alertTooLarge` and the alarm's quiet-alert reroute. The checks that need crypto (the URL secret, the header, the
// provider's signature) and the source's rate limit run in the Worker (src/ember-alerts.ts), over the source and its
// secrets read here (`source`); the shard ingests what the Worker read from the payload (`ingest`), with the same
// `AlertIntake` the DO runs, over the shard facade. Quiet alerts the routes would now page are routed again by
// `reroute`, armed when the routes change (ember/ticks.ts `armUpkeep`) and again while any is left.

import { internalMutationGeneric, v, type MutationCtx } from "@freecorps/ember-server";
import type { AlertSourceRow } from "@freecorps/brigade-schema";
import {
  AlertIntake,
  type AlertIntakeResult,
  type AlertPayload,
  type AlertSourceSecret,
} from "../src/alert-intake.ts";
import { emberWorkspace, type EmberShard } from "./shard-facade.ts";
import { holdTicks, tickAt } from "./ticks.ts";

/**
 * How soon quiet alerts still left are routed again: the DO's alarm tick (`MONITOR_TICK_MS`, src/monitors.ts, which
 * this module cannot import: it loads the probes' Durable Object).
 */
const REROUTE_TICK_MS = 60 * 1000;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** The rows left alone after failing to route again on their own (`AlertIntake`'s `rerouteFailed`), in `ctx.sql`. */
class StoredRetries extends Map<string, number> {
  constructor(private readonly ctx: MutationCtx) {
    super(
      (
        ctx.sql.exec("select row_id, until from alert_reroute_failed") as {
          row_id: string;
          until: number;
        }[]
      ).map((row) => [row.row_id, row.until]),
    );
  }

  override set(id: string, until: number): this {
    // `Map`'s constructor calls `set` for its entries, before `ctx` is assigned: those are already stored.
    this.ctx?.sql.exec(
      `insert into alert_reroute_failed (row_id, until) values (?, ?)
       on conflict (row_id) do update set until = excluded.until`,
      id,
      until,
    );
    return super.set(id, until);
  }

  override delete(id: string): boolean {
    this.ctx.sql.exec("delete from alert_reroute_failed where row_id = ?", id);
    return super.delete(id);
  }
}

/** An `AlertIntake` over this mutation's shard facade. */
function intake(ctx: MutationCtx, shard: EmberShard): AlertIntake {
  return new AlertIntake({
    shard: shard as never,
    randomBytes: (n) => {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = Math.floor(ctx.random() * 256);
      return bytes;
    },
    log,
    // Ember's subscriptions follow the rows: nothing to broadcast.
    committed: () => {},
    // The Worker spent the source's rate before it called `ingest`.
    allow: async () => true,
    rerouteFailed: new StoredRetries(ctx),
  });
}

/** A source and its secrets, for the Worker's checks; null for a shard holding another workspace, or none. */
export const source = internalMutationGeneric({
  args: { workspaceId: v.string(), sourceId: v.string() },
  handler: (
    ctx,
    input: { workspaceId: string; sourceId: string },
  ): { source: AlertSourceRow | null; secret: AlertSourceSecret | null } | null => {
    const { shard } = emberWorkspace(ctx as MutationCtx);
    if (shard.workspace() !== input.workspaceId) return null;
    const row = shard.store.get("alert_sources", input.sourceId);
    const secret = shard.store.get("alert_source_secrets", input.sourceId);
    return {
      source: row ?? null,
      secret: secret
        ? {
            tokenHash: secret.tokenHash,
            headerHash: secret.headerHash,
            signingSecret: secret.signingSecret,
          }
        : null,
    };
  },
});

/** What a verified payload asks for, ingested (`AlertIntake.ingestPayload`). */
export const ingest = internalMutationGeneric({
  args: { workspaceId: v.string(), sourceId: v.string(), payload: v.any() },
  handler: (
    ctx,
    input: { workspaceId: string; sourceId: string; payload: AlertPayload },
  ): AlertIntakeResult => {
    const c = ctx as MutationCtx;
    const { shard } = emberWorkspace(c);
    if (shard.workspace() !== input.workspaceId) return { status: "not_found" };
    const out = intake(c, shard).ingestPayload(input.sourceId, input.payload);
    shard.check();
    return out;
  },
});

/**
 * Routes again the quiet alerts the routes would now page (`AlertIntake.reroute`), then arms itself: a tick from now
 * while any is left, or when the first row left alone after failing may be tried again.
 */
export const reroute = internalMutationGeneric({
  args: {},
  handler: (ctx): { left: boolean } => {
    const c = ctx as MutationCtx;
    holdTicks(c);
    const { shard } = emberWorkspace(c);
    if (shard.workspace() === undefined) return { left: false };
    c.sql.exec("delete from ember_ticks where key = 'reroute'");
    const alerts = intake(c, shard);
    const left = alerts.reroute();
    const at = left ? c.now : alerts.rerouteAt(c.now);
    if (at !== null) tickAt(c, Math.max(at, c.now + REROUTE_TICK_MS), "reroute");
    shard.check();
    return { left };
  },
});
