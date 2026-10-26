// The workspace shard's side of escalation (RFC 0006 "Who is paged"): the alarm fires each run's next level when
// it is due (`escalation.advance`, as `sys_escalation`). Runs and their timers live in the shard's storage
// (`escalation_timers`, one row per running run), so a restart or an eviction mid-escalation resumes from them.
// Starting a run is the pager's (src/paging.ts), on the page that asked for it.

import { ESCALATION_ACTOR } from "@freecorps/brigade-schema";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** Levels fired per alarm run; more due than this come right after, so the drain between them is never starved. */
export const MAX_LEVELS_PER_ALARM = 50;
/** A level that could not fire (a bug, or a row the mutation refuses) is tried again this much later, and logged. */
export const ESCALATION_RETRY_MS = 60 * 1000;

export type EscalationsOptions = {
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  /** Sends the patches of a committed system mutation to the shard's sockets. */
  committed: (version: number, changes: readonly RowChange[]) => void;
};

export class Escalations {
  constructor(private readonly options: EscalationsOptions) {}

  /** When the earliest running run's next level is due; null with none running. */
  nextAt(): number | null {
    let next: number | null = null;
    for (const timer of this.options.shard.store.scan("escalation_timers")) {
      if (next === null || timer.at < next) next = timer.at;
    }
    return next;
  }

  /**
   * Fires every level due by `now`, oldest first, at most `MAX_LEVELS_PER_ALARM`. Synchronous: each level is one
   * mutation in the shard's own storage, nothing waits on D1 or the network. Returns how many fired and when the
   * alarm should come back for the rest (now, if more were due). A storage failure throws; the caller logs it, and
   * its fallback alarm comes back.
   */
  fireDue(now: number): { fired: number; next: number | null } {
    const { shard, log, committed } = this.options;
    const timers = shard.store
      .scan("escalation_timers")
      .filter((timer) => timer.at <= now)
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    let fired = 0;
    for (const timer of timers.slice(0, MAX_LEVELS_PER_ALARM)) {
      const run = shard.store.get("incidents", timer.id)?.escalation;
      // The step (pages so far) names the level: a repeated alarm finds the run moved on (`conflict`), so a level
      // fires once.
      const step = Math.max(1, run?.pages.length ?? 0);
      const { result, changes } = shard.mutate({
        clientId: "escalation",
        mutationId: `advance:${timer.id}:${step}`,
        actor: ESCALATION_ACTOR,
        name: "escalation.advance",
        args: { incidentId: timer.id, step },
        now,
        internal: true,
      });
      if (result.ok) {
        committed(result.version, changes);
        fired++;
        continue;
      }
      // Server-only rows outside a mutation: the timer is an index of the runs, not synced state. Put it right so it
      // never fires early again, or goes once its run stopped.
      const current = shard.store.get("incidents", timer.id)?.escalation;
      if (current?.status !== "running" || current.nextAt === null) {
        shard.store.delete("escalation_timers", timer.id);
      } else if (current.nextAt > now) {
        shard.store.update("escalation_timers", timer.id, { at: current.nextAt });
      } else {
        // Due and still running, yet refused: never drop it (that would end the escalation quietly); try again.
        log("escalation level could not fire", { incident: timer.id, code: result.error.code });
        shard.store.update("escalation_timers", timer.id, { at: now + ESCALATION_RETRY_MS });
      }
    }
    return { fired, next: timers.length > MAX_LEVELS_PER_ALARM ? now : this.nextAt() };
  }
}
