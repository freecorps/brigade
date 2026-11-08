import {
  createEngine,
  internalMutationGeneric,
  v,
  type MutationCtx,
} from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as paging from "../paging.ts";
import * as ticks from "../ticks.ts";
import { TICK_LEASE_MS } from "../ticks.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const owner = { kind: "user", id: "usr_ana", role: "owner" } as const;

/** A tick row as the scheduler left it: `at`, with no job behind it (it failed its attempts). */
const leave = internalMutationGeneric({
  args: { key: v.string(), at: v.number() },
  handler: (ctx: unknown, { key, at }: { key: string; at: number }) => {
    (ctx as MutationCtx).sql.exec(
      "insert into ember_ticks (key, at) values (?, ?) on conflict (key) do update set at = excluded.at",
      key,
      at,
    );
    return null;
  },
} as never);

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, paging, ticks, test: { leave } },
    now: () => clock,
  });
  engine.migrate();
  engine.runMutation("workspace:serverMutate", {
    name: "workspace.create",
    args: { id: WS, name: "Freecorps" },
    actor: owner,
  });
  return { engine, tick: (ms: number) => (clock += ms) };
}

describe("the lost-tick sweep", () => {
  test("a tick the scheduler gave up on is scheduled again, once; one still within its lease is left", () => {
    const { engine } = shard();
    // The paging tick failed its attempts long ago; the reminders tick is merely late, within its lease.
    engine.runMutation("test:leave", { key: "paging", at: T - 3 * TICK_LEASE_MS });
    engine.runMutation("test:leave", { key: "reminders", at: T - 1000 });
    engine.runMutation("test:leave", { key: "unknown", at: T - 3 * TICK_LEASE_MS });
    const swept = engine.runMutation("ticks:sweep", {});
    expect(swept.value).toEqual(["paging"]);
    expect(swept.scheduled.map((job) => job.fn)).toEqual(["paging:tick"]);
    // Scheduled again now: the next sweep leaves it to its new job.
    const again = engine.runMutation("ticks:sweep", {});
    expect(again.value).toEqual([]);
    expect(again.scheduled).toEqual([]);
  });

  test("a shard with no ticks has nothing to sweep", () => {
    const { engine } = shard();
    expect(engine.runMutation("ticks:sweep", {}).value).toEqual([]);
  });
});
