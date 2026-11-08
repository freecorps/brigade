// The Ember side of the copy (RFC 0016 "Data migration"; src/ember-migration.ts drives it): a `WorkspaceDO`'s rows
// written to its workspace's shard as they are, idempotent by row id, read back a page at a time to be compared, rows
// the DO does not have deleted, and the shard's upkeep ticks armed once the copy is in (rows written here are no
// mutation that arms them). Nothing here runs a Brigade mutation or writes an event: it is the same data, moved.

import {
  internalMutationGeneric,
  internalQueryGeneric,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import { EMBER_ROW_INDEX, type EmberRowDoc } from "@freecorps/brigade-schema";
import { BRIGADE_TABLES } from "./schema.ts";
import { JOBS, tickAt, type TickKey } from "./ticks.ts";

/** Rows per call, either way: well below Ember's per-transaction read limit and any RPC size. */
export const COPY_PAGE = 200;

const TABLES = new Set<string>(BRIGADE_TABLES);

type Db = {
  query(table: string): {
    withIndex(
      index: string,
      range: (q: {
        eq(field: "id", value: string): unknown;
        gt(field: "id", value: string): unknown;
        gte(field: "id", value: string): unknown;
      }) => unknown,
    ): { first(): EmberRowDoc | null; take(n: number): EmberRowDoc[] };
  };
  insert(table: string, value: { id: string; data: string }): string;
  patch(id: string, value: { data: string }): void;
  delete(id: string): void;
};

const table = (name: string) => {
  if (!TABLES.has(name)) throw new Error(`Unknown table ${name}`);
  return name;
};

const find = (db: Db, name: string, id: string) =>
  db
    .query(name)
    .withIndex(EMBER_ROW_INDEX, (q) => q.eq("id", id))
    .first();

/** Writes `rows` of `table` as the DO holds them; answers how many changed. */
export const put = internalMutationGeneric({
  args: { table: v.string(), rows: v.array(v.object({ id: v.string(), data: v.string() })) },
  handler: (ctx, input: { table: string; rows: { id: string; data: string }[] }): number => {
    const db = (ctx as MutationCtx).db as unknown as Db;
    const name = table(input.table);
    let changed = 0;
    for (const row of input.rows) {
      const doc = find(db, name, row.id);
      if (doc && doc.data === row.data) continue;
      if (doc) db.patch(doc._id, { data: row.data });
      else db.insert(name, { id: row.id, data: row.data });
      changed++;
    }
    return changed;
  },
});

/** Deletes the rows of `table` with these ids (ones the DO does not have). */
export const drop = internalMutationGeneric({
  args: { table: v.string(), ids: v.array(v.string()) },
  handler: (ctx, input: { table: string; ids: string[] }): number => {
    const db = (ctx as MutationCtx).db as unknown as Db;
    const name = table(input.table);
    let dropped = 0;
    for (const id of input.ids) {
      const doc = find(db, name, id);
      if (!doc) continue;
      db.delete(doc._id);
      dropped++;
    }
    return dropped;
  },
});

/** The rows of `table` with an id after `after` (from the first with `""`), in id order, at most `limit`. */
export const page = internalQueryGeneric({
  args: { table: v.string(), after: v.string(), limit: v.number() },
  handler: (ctx, input: { table: string; after: string; limit: number }) => {
    const db = ctx.db as unknown as Db;
    return db
      .query(table(input.table))
      .withIndex(EMBER_ROW_INDEX, (q) =>
        input.after === "" ? q.gte("id", "") : q.gt("id", input.after),
      )
      .take(Math.min(Math.max(1, input.limit), COPY_PAGE))
      .map((doc) => ({ id: doc.id, data: doc.data }));
  },
});

/** Once the copy is in: every upkeep tick at once, each finding what is due and setting its next. */
export const arm = internalMutationGeneric({
  args: {},
  handler: (ctx): string[] => {
    const c = ctx as MutationCtx;
    // Live again (after a turn back): its upkeep runs.
    c.sql.exec("delete from shard_meta where key = 'retired'");
    const keys = Object.keys(JOBS) as TickKey[];
    for (const key of keys) tickAt(c, c.now, key);
    return keys;
  },
});

/**
 * The workspace was turned back to its `WorkspaceDO` (RFC 0016 step 4): this shard's upkeep stops (no escalation
 * fires, no page is sent, nothing is pushed from here), so the two engines never both act. Every tick already
 * scheduled finds the shard retired and does nothing, and none is scheduled again until `arm`.
 */
export const disarm = internalMutationGeneric({
  args: {},
  handler: (ctx): null => {
    const c = ctx as MutationCtx;
    c.sql.exec(
      "insert into shard_meta (key, value) values ('retired', ?) on conflict (key) do update set value = excluded.value",
      c.now,
    );
    c.sql.exec("delete from ember_ticks");
    return null;
  },
});
