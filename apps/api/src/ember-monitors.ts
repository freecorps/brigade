// The calls a probe and `POST /heartbeat/:token` make into a workspace's shard (RFC 0007, RFC 0016 "Parity"), sent to
// the engine D1's `workspace_engine` names: `WorkspaceDO.report` / `heartbeat`, or their Ember counterparts
// (ember/monitors.ts). The engine is read as a page's is (`pageEngine`: cached, bounded, falling back to the last
// known): a probe's verdict or a ping lost to a slow D1 would page someone for nothing.

import type { ProbeRegion } from "@freecorps/brigade-schema";
import { pageEngine } from "./ember-paging.ts";
import { emberMutation } from "./ember-workspace.ts";
import type { ProbeReport } from "./probe.ts";

type MonitorsEnv = Pick<Env, "DB" | "WORKSPACE"> & { SHARD?: Env["SHARD"] };

/** `WorkspaceDO`'s monitor calls. */
export type WorkspaceMonitors = {
  report(region: ProbeRegion, reports: ProbeReport[]): Promise<boolean[]>;
  heartbeat(monitorId: string, digest: ArrayBuffer): Promise<boolean>;
};

/** `workspaceId`'s monitor calls, on `WorkspaceDO` or on Ember. */
export async function workspaceMonitors(
  env: MonitorsEnv,
  workspaceId: string,
): Promise<WorkspaceMonitors> {
  if (env.SHARD && (await pageEngine(env.DB, workspaceId)) === "ember") {
    const shard = { SHARD: env.SHARD };
    return {
      report: (region, reports) =>
        emberMutation<boolean[]>(shard, workspaceId, "monitors:report", {
          workspaceId,
          region,
          reports,
        }),
      heartbeat: (monitorId, digest) =>
        emberMutation<boolean>(shard, workspaceId, "monitors:heartbeat", {
          workspaceId,
          monitorId,
          digest: [...new Uint8Array(digest)],
        }),
    };
  }
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    report: async (region, reports) => stub.report(region, reports),
    heartbeat: async (monitorId, digest) => stub.heartbeat(monitorId, digest),
  };
}
