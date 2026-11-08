// The Worker's side of the lost-tick sweep (#192, ember/ticks.ts `sweep`): from the Cron Trigger, every
// `TICK_SWEEP_EVERY_MINUTES`, each workspace on Ember has its shard schedule again the ticks its scheduler gave up on.
// Never in the heartbeat's way: every failure is logged and the next run tries again.

import { within } from "./deadline.ts";
import { emberMutation } from "./ember-workspace.ts";

/** How often the sweep runs (minutes past the hour divisible by it). */
export const TICK_SWEEP_EVERY_MINUTES = 5;
/** Workspaces swept per run; the rest wait for the next (none of Brigade's deployments has nearly this many). */
export const TICK_SWEEP_WORKSPACES = 1000;
/** Shards asked at once. */
const TICK_SWEEP_PARALLEL = 20;
/** The most one shard is waited for. */
const TICK_SWEEP_CALL_MS = 5 * 1000;

const log = (message: string, fields: Record<string, unknown>) =>
  console.error(JSON.stringify({ message, ...fields }));

/** Asks every workspace on Ember (D1's `workspace_engine`) to schedule its lost ticks again. Never rejects. */
export async function sweepEmberTicks(env: Pick<Env, "DB" | "SHARD">): Promise<void> {
  let workspaces: string[];
  try {
    const { results } = await env.DB.prepare(
      `select "workspaceId" as id from workspace_engine where engine = 'ember' order by "workspaceId" limit ?`,
    )
      .bind(TICK_SWEEP_WORKSPACES)
      .all<{ id: string }>();
    workspaces = results.map((row) => row.id);
  } catch (error) {
    log("reading the workspaces on Ember for the tick sweep failed", { error: String(error) });
    return;
  }
  for (let i = 0; i < workspaces.length; i += TICK_SWEEP_PARALLEL) {
    await Promise.all(
      workspaces.slice(i, i + TICK_SWEEP_PARALLEL).map(async (workspaceId) => {
        try {
          await within(
            emberMutation(env, workspaceId, "ticks:sweep", {}),
            TICK_SWEEP_CALL_MS,
            "tick sweep",
          );
        } catch (error) {
          log("sweeping a shard's lost ticks failed", {
            workspace: workspaceId,
            error: String(error),
          });
        }
      }),
    );
  }
}
