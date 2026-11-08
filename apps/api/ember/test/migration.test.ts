import { createEngine } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as alerts from "../alerts.ts";
import * as events from "../events.ts";
import * as integrations from "../integrations.ts";
import * as monitors from "../monitors.ts";
import * as status from "../status.ts";
import * as migration from "../migration.ts";
import * as paging from "../paging.ts";
import * as ticks from "../ticks.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.now();

function shard() {
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: {
      workspace,
      local,
      events,
      paging,
      ticks,
      migration,
      alerts,
      monitors,
      status,
      integrations,
    },
    now: () => T,
  });
  engine.migrate();
  return engine;
}

const row = (id: string, data: Record<string, unknown>) => ({
  id,
  data: JSON.stringify({ id, ...data }),
});

describe("the copy's side on Ember", () => {
  test("rows are written as given, idempotently, read back in id order, and dropped", () => {
    const engine = shard();
    const rows = [row("b", { n: 2 }), row("a", { n: 1 })];
    expect(engine.runMutation("migration:put", { table: "services", rows }).value).toBe(2);
    expect(engine.runMutation("migration:put", { table: "services", rows }).value).toBe(0);
    expect(
      engine.runMutation("migration:put", { table: "services", rows: [row("a", { n: 9 })] }).value,
    ).toBe(1);
    const page = (after: string) =>
      engine.runQuery("migration:page", { table: "services", after, limit: 200 }).value as {
        id: string;
      }[];
    expect(page("").map((r) => r.id)).toEqual(["a", "b"]);
    expect(page("a").map((r) => r.id)).toEqual(["b"]);
    expect(
      engine.runMutation("migration:drop", { table: "services", ids: ["b", "zz"] }).value,
    ).toBe(1);
    expect(page("").map((r) => r.id)).toEqual(["a"]);
    expect(() => engine.runMutation("migration:put", { table: "nope", rows: [] })).toThrow();
  });

  test("a disarmed shard schedules no upkeep, and its ticks do nothing, until armed again", () => {
    const engine = shard();
    expect(engine.runMutation("migration:arm", {}).scheduled.length).toBeGreaterThan(0);
    engine.runMutation("migration:disarm", {});
    expect(engine.runMutation("paging:tick", {}).value).toEqual({
      fired: 0,
      released: 0,
      replayed: 0,
    });
    expect(engine.runMutation("ticks:sweep", {}).scheduled).toEqual([]);
    expect(engine.runMutation("migration:arm", {}).scheduled.length).toBeGreaterThan(0);
  });
});
