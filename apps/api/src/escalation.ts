// The workspace shard's side of escalation (RFC 0006 "Who is paged"): the alarm fires each run's next level when
// it is due (`escalation.advance`, as `sys_escalation`). Runs and their timers live in the shard's storage
// (`escalation_timers`, one row per running run), so a restart or an eviction mid-escalation resumes from them.
// Starting a run is the pager's (src/paging.ts), on the page that asked for it.

import { ESCALATION_ACTOR, ESCALATION_STALL_MS, NOTIFIER_ACTOR } from "@freecorps/brigade-schema";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** Levels fired per alarm run; more due than this come right after, so the drain between them is never starved. */
export const MAX_LEVELS_PER_ALARM = 50;
/**
 * A level that could not fire (a bug, or a row the mutation refuses) is tried again this much later, and logged; its
 * first failure goes on the timeline, and past `ESCALATION_STALL_MS` everyone who can respond is paged instead.
 */
export const ESCALATION_RETRY_MS = 60 * 1000;

export type EscalationsOptions = {
  shard: Shard;
  log: (message: string, fields: Record<string, unknown>) => void;
  /** Sends the patches of a committed system mutation to the shard's sockets. */
  committed: (version: number, changes: readonly RowChange[]) => void;
};

type Outcome = { ok: true } | { ok: false; code: string };

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
    const { shard } = this.options;
    const timers = shard.store
      .scan("escalation_timers")
      .filter((timer) => timer.at <= now)
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
    let fired = 0;
    for (const timer of timers.slice(0, MAX_LEVELS_PER_ALARM)) {
      const run = shard.store.get("incidents", timer.id)?.escalation;
      // The step (pages so far) names the level: a repeated alarm finds the run moved on (`conflict`), so a level
      // fires once.
      const step = Math.max(1, run?.paged ?? 0);
      const args = { incidentId: timer.id, step };
      const result = this.run(
        "escalation",
        `advance:${timer.id}:${step}`,
        "escalation.advance",
        args,
        now,
      );
      if (result.ok) {
        fired++;
        continue;
      }
      // Server-only rows outside a mutation: the timer is an index of the runs, not synced state. Put it right so it
      // never fires early again, or goes once its run stopped.
      const current = shard.store.get("incidents", timer.id)?.escalation;
      if (current?.status !== "running" || current.nextAt === null) {
        shard.store.delete("escalation_timers", timer.id);
        continue;
      }
      if (current.nextAt > now) {
        shard.store.update("escalation_timers", timer.id, { at: current.nextAt });
        continue;
      }
      // Due and still running, yet refused: never drop it (that would end the escalation quietly). The first failure
      // goes on the timeline; past `ESCALATION_STALL_MS` everyone who can respond is paged, by a mutation that does
      // not read the level; until then (or if that fails too) it is tried again.
      this.options.log("escalation level could not fire", {
        incident: timer.id,
        code: result.code,
      });
      this.run(
        "notifier",
        `fail:stall:${timer.id}:${step}`,
        "notification.fail",
        {
          incidentId: timer.id,
          eventId: current.eventId,
          userId: null,
          reason: "escalation_stalled",
        },
        now,
        NOTIFIER_ACTOR,
      );
      if (now - current.nextAt >= ESCALATION_STALL_MS) {
        const fallback = this.run(
          "escalation",
          `fallback:${timer.id}:${step}`,
          "escalation.fallback",
          args,
          now,
        );
        if (fallback.ok) {
          fired++;
          continue;
        }
        this.options.log("escalation fallback could not fire", {
          incident: timer.id,
          code: fallback.code,
        });
      }
      if (shard.store.get("escalation_timers", timer.id)) {
        shard.store.update("escalation_timers", timer.id, { at: now + ESCALATION_RETRY_MS });
      }
    }
    return { fired, next: timers.length > MAX_LEVELS_PER_ALARM ? now : this.nextAt() };
  }

  /**
   * A server-only mutation, de-duplicated by `mutationId` when it went through before. An exception from the
   * mutation's own code is a refusal here (`internal`), so one broken run does not stop the others; a storage failure
   * still throws.
   */
  private run(
    clientId: string,
    mutationId: string,
    name: string,
    args: unknown,
    now: number,
    actor = ESCALATION_ACTOR,
  ): Outcome {
    const { shard, committed } = this.options;
    const stored = shard.storedResult(actor.id, clientId, mutationId, now);
    if (stored?.ok) return { ok: true };
    const { result, changes } = shard.mutate({
      clientId,
      mutationId,
      actor,
      name,
      args,
      now,
      internal: true,
    });
    if (!result.ok) return { ok: false, code: result.error.code };
    committed(result.version, changes);
    return { ok: true };
  }
}
