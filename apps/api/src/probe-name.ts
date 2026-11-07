// A probe's object name, in a module of its own: the shard's monitoring (src/monitors.ts) names probes without
// loading the probe's Durable Object (`cloudflare:workers`), so it also runs in an Ember mutation's Node tests.

import type { ProbeRegion } from "@freecorps/brigade-schema";

/** The object for a workspace's region: `${workspaceId}:${region}`, created with that `locationHint`. */
export function probeName(workspaceId: string, region: ProbeRegion): string {
  return `${workspaceId}:${region}`;
}
