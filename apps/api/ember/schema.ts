// The Ember schema of a Brigade workspace (RFC 0016 "The workspace shard"): one shard kind, `workspace`, keyed by the
// workspace id, and every table packages/schema defines, as `{ id, data }` documents (`createEmberStore`), plus the
// events the workspace's mutations emit.

import { defineSchema, defineShard, defineTable, v } from "@freecorps/ember-server";
import { EMBER_ROW_INDEX, TABLES, type TableName } from "@freecorps/brigade-schema";
import { LEDGER_DDL, LEDGER_TABLES } from "./ledgers.ts";

/** Every Brigade table, synced and server-only, in a stable order. */
export const BRIGADE_TABLES = Object.keys(TABLES).sort() as TableName[];

const rows = () => defineTable({ id: v.string(), data: v.string() }).index(EMBER_ROW_INDEX, ["id"]);

export default defineSchema({
  // The orchestrators' ledgers (page deliveries, holds, replays, stored mutation results, …), as Ember's app-private
  // SQL tables: `ctx.sql` in mutations (ember/shard-facade.ts).
  privateSql: { tables: LEDGER_TABLES, ddl: LEDGER_DDL },
  shards: {
    // The key is the workspace id (`ws_<ULID>`): the shard `workspace:ws_…`.
    workspace: defineShard({ key: v.string() }),
  },
  tables: {
    ...(Object.fromEntries(BRIGADE_TABLES.map((name) => [name, rows()])) as Record<
      TableName,
      ReturnType<typeof rows>
    >),
    // A mutation's events, as `BrigadeEvent` envelopes (RFC 0005), written in its transaction and sent to the events
    // Queue by the drain (ember/events.ts).
    // `seq` orders them as the drain sends them (ember/events.ts); the drain deletes what it sent.
    events: defineTable({
      id: v.string(),
      seq: v.number(),
      type: v.string(),
      at: v.number(),
      event: v.string(),
    })
      .index("by_event_id", ["id"])
      .index("by_seq", ["seq"])
      .index("by_at", ["at"]),
    // How many member changes the shard has applied (`key: "members"`): fences a repair's snapshot of D1 (ember/members.ts).
    member_fence: defineTable({ key: v.string(), n: v.number() }).index("by_key", ["key"]),
    // When the pending drain was scheduled (one row, `key: "drain"`), so one drain runs at a time.
    event_drain: defineTable({ key: v.string(), scheduledAt: v.number() }).index("by_key", ["key"]),
  },
});
