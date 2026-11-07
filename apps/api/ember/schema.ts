// The Ember schema of a Brigade workspace (RFC 0016 "The workspace shard"): one shard kind, `workspace`, keyed by the
// workspace id, and every table packages/schema defines, as `{ id, data }` documents (`createEmberStore`), plus the
// events the workspace's mutations emit.

import { defineSchema, defineShard, defineTable, v } from "@freecorps/ember-server";
import { EMBER_ROW_INDEX, TABLES, type TableName } from "@freecorps/brigade-schema";

/** Every Brigade table, synced and server-only, in a stable order. */
export const BRIGADE_TABLES = Object.keys(TABLES).sort() as TableName[];

const rows = () => defineTable({ id: v.string(), data: v.string() }).index(EMBER_ROW_INDEX, ["id"]);

export default defineSchema({
  shards: {
    // The key is the workspace id (`ws_<ULID>`): the shard `workspace:ws_…`.
    workspace: defineShard({ key: v.string() }),
  },
  tables: {
    ...(Object.fromEntries(BRIGADE_TABLES.map((name) => [name, rows()])) as Record<
      TableName,
      ReturnType<typeof rows>
    >),
    // A mutation's events, as `BrigadeEvent` envelopes (RFC 0005), written in its transaction. Delivery (webhooks,
    // Slack, email, pages) reads them; a later step schedules it.
    events: defineTable({ id: v.string(), type: v.string(), at: v.number(), event: v.string() })
      .index("by_event_id", ["id"])
      .index("by_at", ["at"]),
  },
});
