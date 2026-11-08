// The copy and the switch (RFC 0016 "Data migration", steps 2 to 4), driven from the Worker by the operator routes
// (`/admin/ember/*`, src/index.ts):
//
// - **copy**: every table of the workspace's `WorkspaceDO` (`exportPage`, in id order) is written to its Ember shard
//   (`migration:put`, idempotent by row id), then both sides are walked again in id order: a row the shard holds and
//   the DO does not is deleted (`migration:drop`), one that differs is written again, and each table's count and
//   SHA-256 (of `id \t data \n`, in id order) is compared. It can run again, and overwrites the last one.
// - **switch**: the DO is frozen first (`moveToEmber`: it refuses every call, which is tried again), copied once more
//   from those frozen rows, its upkeep ticks armed on the shard (`migration:arm`), then D1's `workspace_engine` says
//   `ember`, and only then the DO forwards what still reaches it (`forwardToEmber`). No write is lost, and none made
//   on Ember races the last copy. A copy that fails or does not check out turns the DO back (`moveBack`).
// - **back**: D1 says `brigade` again and the DO holds the workspace as it was (`moveBack`); what was written on Ember
//   since is lost (accepted, RFC 0016).

import { BRIGADE_TABLES } from "../ember/schema.ts";
import { COPY_PAGE } from "../ember/migration.ts";
import { setWorkspaceEngine, workspaceEngine, workspaceShard } from "./ember.ts";

type MigrationEnv = Pick<Env, "DB" | "WORKSPACE" | "SHARD">;
type Row = { id: string; data: string };
type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message?: string } };
type ShardRpc = {
  query(
    shard: string,
    fn: string,
    args: unknown,
    identity: null,
    internal: boolean,
  ): Promise<Outcome>;
  mutation(
    shard: string,
    fn: string,
    args: unknown,
    identity: null,
    internal: boolean,
  ): Promise<Outcome>;
};

/** A table as each side holds it once the copy is in. */
export type TableCheck = {
  table: string;
  rows: number;
  hash: string;
  ember: { rows: number; hash: string };
};

export type CopyReport = {
  /** Rows written to the shard (new or changed), and rows deleted from it. */
  written: number;
  dropped: number;
  /** The tables whose count or hash differ after the copy (none when it succeeded). */
  mismatched: TableCheck[];
  tables: number;
};

const encoder = new TextEncoder();

/** SHA-256 of rows as fed in order (`id \t data \n`), incrementally over chunks. */
class Digest {
  private parts: Uint8Array[] = [];
  rows = 0;
  add(row: Row) {
    this.parts.push(encoder.encode(`${row.id}\t${row.data}\n`));
    this.rows++;
  }
  async hex(): Promise<string> {
    const size = this.parts.reduce((n, part) => n + part.length, 0);
    const all = new Uint8Array(size);
    let at = 0;
    for (const part of this.parts) {
      all.set(part, at);
      at += part.length;
    }
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
    return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

/** The calls a copy makes on both sides of one workspace. */
function sides(env: MigrationEnv, workspaceId: string) {
  const name = workspaceShard(workspaceId);
  const shard = env.SHARD.getByName(name) as unknown as ShardRpc;
  const call = async <T>(kind: "query" | "mutation", fn: string, args: unknown): Promise<T> => {
    const out = await shard[kind](name, fn, args, null, true);
    if (!out.ok)
      throw new Error(`${fn} failed on Ember: ${out.error.code} ${out.error.message ?? ""}`);
    return out.value as T;
  };
  const stub = env.WORKSPACE.getByName(workspaceId);
  return {
    doPage: (table: string, after: string) => stub.exportPage(table, after, COPY_PAGE),
    emberPage: (table: string, after: string) =>
      call<Row[]>("query", "migration:page", { table, after, limit: COPY_PAGE }),
    put: (table: string, rows: Row[]) => call<number>("mutation", "migration:put", { table, rows }),
    drop: (table: string, ids: string[]) =>
      call<number>("mutation", "migration:drop", { table, ids }),
    arm: () => call<string[]>("mutation", "migration:arm", {}),
    disarm: () => call<null>("mutation", "migration:disarm", {}),
    stub,
  };
}

/** Walks `page` in id order, a page at a time. */
async function* walk(page: (after: string) => Promise<Row[]>): AsyncGenerator<Row> {
  let after = "";
  for (;;) {
    const rows = await page(after);
    for (const row of rows) yield row;
    if (rows.length < COPY_PAGE) return;
    after = rows[rows.length - 1]!.id;
  }
}

/** Copies `workspaceId`'s `WorkspaceDO` to its Ember shard and checks it, table by table. */
export async function copyWorkspace(env: MigrationEnv, workspaceId: string): Promise<CopyReport> {
  const side = sides(env, workspaceId);
  let written = 0;
  let dropped = 0;
  const mismatched: TableCheck[] = [];
  for (const table of BRIGADE_TABLES) {
    // 1. Every row the DO holds, written as it is.
    for (let after = ""; ;) {
      const rows = await side.doPage(table, after);
      if (rows.length > 0) written += await side.put(table, rows);
      if (rows.length < COPY_PAGE) break;
      after = rows[rows.length - 1]!.id;
    }
    // 2. Both sides in id order: the shard's extra rows go, one that differs is written again (a write since 1).
    const extra: string[] = [];
    const again: Row[] = [];
    const theirs = walk((after) => side.emberPage(table, after));
    let held = await theirs.next();
    for await (const row of walk((after) => side.doPage(table, after))) {
      while (!held.done && held.value.id < row.id) {
        extra.push(held.value.id);
        held = await theirs.next();
      }
      if (!held.done && held.value.id === row.id) {
        if (held.value.data !== row.data) again.push(row);
        held = await theirs.next();
      } else {
        again.push(row);
      }
    }
    for (; !held.done; held = await theirs.next()) extra.push(held.value.id);
    for (let i = 0; i < extra.length; i += COPY_PAGE) {
      dropped += await side.drop(table, extra.slice(i, i + COPY_PAGE));
    }
    for (let i = 0; i < again.length; i += COPY_PAGE) {
      written += await side.put(table, again.slice(i, i + COPY_PAGE));
    }
    // 3. Count and hash, each side on its own.
    const mine = new Digest();
    for await (const row of walk((after) => side.doPage(table, after))) mine.add(row);
    const yours = new Digest();
    for await (const row of walk((after) => side.emberPage(table, after))) yours.add(row);
    const check: TableCheck = {
      table,
      rows: mine.rows,
      hash: await mine.hex(),
      ember: { rows: yours.rows, hash: await yours.hex() },
    };
    if (check.rows !== check.ember.rows || check.hash !== check.ember.hash) mismatched.push(check);
  }
  return { written, dropped, mismatched, tables: BRIGADE_TABLES.length };
}

export type SwitchResult =
  | { ok: true; copy: CopyReport; ticks: string[] }
  /** D1 said `ember` already: the switch only finished the DO's forwarding, and copied nothing over live data. */
  | { ok: true; finished: true }
  | { ok: false; code: "not_found" | "mismatch"; copy?: CopyReport };

/**
 * Switches `workspaceId` to Ember: freezes its `WorkspaceDO`, copies it once more, arms the shard's ticks, writes
 * `ember` to D1, then has the DO forward. A copy that fails or does not check out leaves D1 at `brigade` and the DO
 * holding the workspace again.
 */
export async function switchWorkspace(
  env: MigrationEnv,
  workspaceId: string,
): Promise<SwitchResult> {
  const side = sides(env, workspaceId);
  // Switched already (a switch whose forwarding failed, run again): the shard is live, so nothing is copied over it.
  if ((await workspaceEngine(env.DB, workspaceId)) === "ember") {
    if (!(await side.stub.forwardToEmber())) {
      const moved = await side.stub.moveToEmber(workspaceId);
      if (!moved.ok) return { ok: false, code: "not_found" };
      await side.stub.forwardToEmber();
    }
    return { ok: true, finished: true };
  }
  const moved = await side.stub.moveToEmber(workspaceId);
  if (!moved.ok) return { ok: false, code: "not_found" };
  // Frozen and forwarding nothing, so no write lands on Ember while the last copy runs (it would delete it).
  let copy: CopyReport;
  try {
    copy = await copyWorkspace(env, workspaceId);
  } catch (error) {
    await side.stub.moveBack();
    throw error;
  }
  if (copy.mismatched.length > 0) {
    // Not switched: the DO holds the workspace again, as if nothing happened.
    await side.stub.moveBack();
    return { ok: false, code: "mismatch", copy };
  }
  let ticks: string[];
  try {
    ticks = await side.arm();
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
  } catch (error) {
    // Not switched, or not known to be: D1 back at `brigade` (the write may have landed), the shard's upkeep off
    // (it may have been armed), then the DO.
    try {
      await setWorkspaceEngine(env.DB, workspaceId, "brigade", Date.now());
      await side.disarm();
    } finally {
      // Whatever failed above, the DO holds the workspace again rather than stay frozen.
      await side.stub.moveBack();
    }
    throw error;
  }
  // Only now: what still reaches the DO (an engine cached as `brigade`) goes to the shard. Should this fail, D1 says
  // `ember` already, so only a stale route reaches the DO and is refused (tried again); the switch runs again to
  // finish (moving a moved DO again is allowed, and the copy is idempotent).
  await side.stub.forwardToEmber();
  return { ok: true, copy, ticks };
}

/** Turns `workspaceId` back to its `WorkspaceDO` (step 4): D1 first, so nothing new reaches the shard, then the DO. */
export async function backWorkspace(env: MigrationEnv, workspaceId: string): Promise<void> {
  await setWorkspaceEngine(env.DB, workspaceId, "brigade", Date.now());
  // The shard stops acting (no escalation, page or push from it) before the DO starts again; should that fail, the
  // DO starts all the same (D1 says `brigade` already, so nothing new reaches the shard) and the error is reported,
  // so the operator turns it back again to disarm the shard.
  try {
    await sides(env, workspaceId).disarm();
  } finally {
    await env.WORKSPACE.getByName(workspaceId).moveBack();
  }
}

/** Whether `workspaceId` is on Ember already: a copy then would overwrite live data, so it is refused. */
export async function switched(env: MigrationEnv, workspaceId: string): Promise<boolean> {
  return (await workspaceEngine(env.DB, workspaceId)) === "ember";
}
