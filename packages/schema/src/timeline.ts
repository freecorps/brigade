// An incident's timeline (RFC 0003 "TimelineEntry"): one append-only row per change, written by the mutation that
// made it, in the same transaction as its event (RFC 0005). The timeline is its own synced table rather than a
// view of the outbox: the outbox is server-only and drained, while clients need the entries live and optimistic.

import type { MutationContext, MutationStore } from "./mutation.ts";
import { defineQuery, prefixRange } from "./query.ts";
import type { IncidentRow, TimelineEntry, TimelineRow } from "./tables.ts";
import { v } from "./validate.ts";

/**
 * Appends `entry` to `incident`'s timeline as `ctx.actor` at `ctx.now`. Entries are numbered from the incident's
 * `timelineSeq`, a field clients hold too, so an optimistic entry and the server's share an id unless another change
 * landed first (the optimistic one is then re-applied under the next number).
 *
 * A client numbers from the highest of `timelineSeq` and the entries it holds: its subscriptions resume one by one,
 * so it can hold another member's entry before the incident row that counts it, and the same number would make
 * the optimistic insert collide (and the entry vanish until the server's answer). On the server the two always
 * agree, so it skips the read.
 */
export function appendTimeline(
  store: MutationStore,
  incident: Pick<IncidentRow, "id" | "timelineSeq">,
  entry: TimelineEntry,
  ctx: MutationContext,
): TimelineRow {
  let last = incident.timelineSeq ?? 0;
  if (!ctx.server) {
    const { from, to } = prefixRange(`${incident.id}:`);
    for (const held of store.range("timeline", from, to)) last = Math.max(last, held.seq);
  }
  const seq = last + 1;
  const row = {
    id: `${incident.id}:${seq}`,
    incidentId: incident.id,
    seq,
    at: ctx.now,
    actor: ctx.actor.id,
    ...entry,
  } as TimelineRow;
  store.insert("timeline", row);
  store.update("incidents", incident.id, { timelineSeq: seq });
  return row;
}

/** Oldest first, in the order the shard ran the changes. */
export const incidentTimeline = defineQuery({
  name: "incident.timeline",
  args: v.object({ id: v.id("inc") }),
  permission: "incident:read",
  table: "timeline",
  // Entry ids are `<incident id>:<seq>`, so one incident's entries are an id range: no scan of every incident's.
  range: (args) => prefixRange(`${args.id}:`),
  filter: (row, args) => row.incidentId === args.id,
  sort: (a, b) => a.seq - b.seq,
});
