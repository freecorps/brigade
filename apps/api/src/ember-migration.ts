// The copy and the switch (RFC 0016 "Data migration", steps 2 to 4), driven from the Worker by the operator routes
// (`/admin/ember/*`, src/index.ts):
//
// - **copy**: every table of the workspace's `WorkspaceDO` (`exportPage`, in id order) is written to its Ember shard
//   (`migration:put`, idempotent by row id), then both sides are walked again in id order: a row the shard holds and
//   the DO does not is deleted (`migration:drop`), one that differs is written again, and each table's count and
//   SHA-256 (chained over `id \t data \n` a page of rows at a time, in id order) is compared. It can run again, and overwrites the last one.
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
  /** Each table's row count, for the tables that have rows. */
  rows: Record<string, number>;
  /**
   * The tables past `READ_CAP_GUARD` rows: near Ember's per-transaction read cap (16,384 rows, #204), which some shard
   * paths that scan a whole table (export, postmortem drafts, the status snapshot, reminders) would reach. A switch
   * refuses a workspace with any unless forced.
   */
  large: string[];
};

/** Half of Ember's per-transaction read cap (16,384 rows): a table past it is reported, and holds a switch back. */
export const READ_CAP_GUARD = 8192;

const encoder = new TextEncoder();

/** SHA-256 of rows as fed in order (`id \t data \n`), incrementally over chunks. */
class Digest {
  /** The chain so far: SHA-256 of the last state and the next `COPY_PAGE` rows, so memory stays one chunk. */
  private state: Uint8Array = new Uint8Array(32);
  private chunk: Uint8Array[] = [];
  rows = 0;
  async add(row: Row): Promise<void> {
    this.chunk.push(encoder.encode(`${row.id}\t${row.data}\n`));
    this.rows++;
    if (this.chunk.length >= COPY_PAGE) await this.fold();
  }
  private async fold(): Promise<void> {
    const parts = [this.state, ...this.chunk];
    const all = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.length;
    }
    this.state = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
    this.chunk = [];
  }
  async hex(): Promise<string> {
    if (this.chunk.length > 0) await this.fold();
    return [...this.state].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
export async function copyWorkspace(
  env: MigrationEnv,
  workspaceId: string,
  options: { standalone?: boolean; guard?: number } = {},
): Promise<CopyReport> {
  const raw = sides(env, workspaceId);
  // A copy run on its own (not the switch's) stops the moment the workspace is switched, so it never writes over a
  // live shard: before each write, D1 is asked again.
  const fence = async () => {
    if (options.standalone && (await switched(env, workspaceId))) throw new AlreadySwitched();
  };
  const side = {
    ...raw,
    put: async (table: string, rows: Row[]) => (await fence(), raw.put(table, rows)),
    drop: async (table: string, ids: string[]) => (await fence(), raw.drop(table, ids)),
  };
  let written = 0;
  let dropped = 0;
  const mismatched: TableCheck[] = [];
  const rows: Record<string, number> = {};
  const large: string[] = [];
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
    for await (const row of walk((after) => side.doPage(table, after))) await mine.add(row);
    const yours = new Digest();
    for await (const row of walk((after) => side.emberPage(table, after))) await yours.add(row);
    const check: TableCheck = {
      table,
      rows: mine.rows,
      hash: await mine.hex(),
      ember: { rows: yours.rows, hash: await yours.hex() },
    };
    if (check.rows !== check.ember.rows || check.hash !== check.ember.hash) mismatched.push(check);
    if (check.rows > 0) rows[table] = check.rows;
    if (check.rows > (options.guard ?? READ_CAP_GUARD)) large.push(table);
  }
  return { written, dropped, mismatched, tables: BRIGADE_TABLES.length, rows, large };
}

export type SwitchResult =
  | { ok: true; copy: CopyReport; ticks: string[] }
  /** D1 said `ember` already: the switch only finished the DO's forwarding, and copied nothing over live data. */
  | { ok: true; finished: true }
  | { ok: false; code: "not_found" | "busy" | "mismatch" | "too_large"; copy?: CopyReport };

/**
 * Switches `workspaceId` to Ember: freezes its `WorkspaceDO`, copies it once more, arms the shard's ticks, writes
 * `ember` to D1, then has the DO forward. A copy that fails or does not check out leaves D1 at `brigade` and the DO
 * holding the workspace again.
 */
export async function switchWorkspace(
  env: MigrationEnv,
  workspaceId: string,
  options: { force?: boolean; guard?: number } = {},
): Promise<SwitchResult> {
  const side = sides(env, workspaceId);
  // Switched already (a switch whose forwarding failed, run again): the shard is live, so nothing is copied over it.
  if ((await workspaceEngine(env.DB, workspaceId)) === "ember") {
    // Its upkeep too: a switch that wrote D1 and then failed to arm left the shard with none (and arming again is
    // harmless: each tick finds what is due).
    await side.arm();
    if (!(await side.stub.forwardToEmber())) {
      const moved = await side.stub.moveToEmber(workspaceId);
      if (!moved.ok) return { ok: false, code: moved.code };
      await side.stub.forwardToEmber();
    }
    return { ok: true, finished: true };
  }
  const moved = await side.stub.moveToEmber(workspaceId);
  // `busy`: another switch is copying it (or one stopped mid-way: turning it back ends it).
  if (!moved.ok) return { ok: false, code: moved.code };
  // Frozen and forwarding nothing, so no write lands on Ember while the last copy runs (it would delete it).
  let copy: CopyReport;
  try {
    copy = await copyWorkspace(env, workspaceId, { guard: options.guard });
  } catch (error) {
    await side.stub.moveBack();
    throw error;
  }
  if (copy.mismatched.length > 0) {
    // Not switched: the DO holds the workspace again, as if nothing happened.
    await side.stub.moveBack();
    return { ok: false, code: "mismatch", copy };
  }
  if (copy.large.length > 0 && !options.force) {
    // Near the read cap (#204): not switched unless the operator says so, having looked at those tables' paths.
    await side.stub.moveBack();
    return { ok: false, code: "too_large", copy };
  }
  let ticks: string[];
  try {
    // D1 first, then the ticks: the shard's upkeep never runs (an escalation never fires there) before it owns the
    // workspace, so a switch that fails here leaves nothing that acted on Ember.
    await setWorkspaceEngine(env.DB, workspaceId, "ember", Date.now());
    ticks = await side.arm();
  } catch (error) {
    // Not switched, or not known to be: D1 back at `brigade` (the write may have landed), the shard's upkeep off
    // (it may have been armed), then the DO.
    // Each step on its own, so one that fails never skips the next: whatever happens, the DO holds the workspace
    // again rather than stay frozen. A step that failed is logged; the original error is the one reported.
    await undo(workspaceId, [
      [
        "resetting the engine to brigade",
        () => setWorkspaceEngine(env.DB, workspaceId, "brigade", Date.now()),
      ],
      ["disarming the shard", () => side.disarm()],
      ["turning the DO back", () => side.stub.moveBack()],
    ]);
    throw error;
  }
  // Only now: what still reaches the DO (an engine cached as `brigade`) goes to the shard. Should this fail, D1 says
  // `ember` already, so only a stale route reaches the DO and is refused (tried again); the switch runs again to
  // finish (moving a moved DO again is allowed, and the copy is idempotent).
  await side.stub.forwardToEmber();
  return { ok: true, copy, ticks };
}

/** Runs each of `steps` whatever the others did; a failure is logged. */
async function undo(workspaceId: string, steps: [string, () => Promise<unknown>][]): Promise<void> {
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (error) {
      console.error(
        JSON.stringify({
          message: `${what} after a failed switch failed`,
          workspace: workspaceId,
          error: String(error),
        }),
      );
    }
  }
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

/** A standalone copy found the workspace switched meanwhile, and stopped. */
export class AlreadySwitched extends Error {
  constructor() {
    super("the workspace was switched to Ember during the copy");
  }
}

/** Whether `workspaceId` is on Ember already: a copy then would overwrite live data, so it is refused. */
export async function switched(env: MigrationEnv, workspaceId: string): Promise<boolean> {
  return (await workspaceEngine(env.DB, workspaceId)) === "ember";
}
