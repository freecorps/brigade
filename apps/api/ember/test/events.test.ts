import { createEngine } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId, type Actor } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import * as events from "../events.ts";
import schema from "../schema.ts";
import * as workspace from "../workspace.ts";

const T = Date.UTC(2026, 10, 7, 12, 0, 0);
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const owner: Actor = { kind: "user", id: "usr_ana", role: "owner" };

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, events },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor: owner });
  const declare = (fill: number) =>
    engine.runMutation(
      "workspace:mutate",
      {
        name: "incident.declare",
        args: {
          id: newId("inc", T, (n) => new Uint8Array(n).fill(fill)),
          title: `Incident ${fill}`,
        },
      },
      { identity: { subject: "usr_ana", claims: { role: "owner", ws: WS } } },
    );
  return { engine, server, declare, tick: (ms: number) => (clock += ms) };
}

const drains = (out: { scheduled: { fn: string }[] }) =>
  out.scheduled.filter((job) => job.fn === "events:drain").length;

describe("event delivery on Ember", () => {
  test("a mutation with events schedules one drain; more events wait for it", () => {
    const s = shard();
    expect(drains(s.server("workspace.create", { id: WS, name: "Freecorps" }))).toBe(1);
    expect(drains(s.server("member.sync", { id: "usr_ana", name: "Ana", role: "owner" }))).toBe(0);
    expect(drains(s.declare(1))).toBe(0);
    // A drain pending past its lease is replaced by the next event's.
    s.tick(events.DRAIN_LEASE_MS + 1);
    expect(drains(s.declare(2))).toBe(1);
  });

  test("pending hands them out in seq order; sent deletes them and clears the mark", () => {
    const s = shard();
    s.server("workspace.create", { id: WS, name: "Freecorps" });
    s.server("member.sync", { id: "usr_ana", name: "Ana", role: "owner" });
    s.declare(1);
    const batch = s.engine.runQuery("events:pending", {}).value as {
      lastSeq: number;
      bodies: { type: string; workspaceId: string }[];
    };
    expect(batch.bodies.map((body) => body.type)).toEqual([
      "workspace.created",
      "incident.declared",
    ]);
    expect(batch.bodies.every((body) => body.workspaceId === WS)).toBe(true);
    expect(batch.lastSeq).toBe(2);
    // Only up to what was sent: an event written since stays.
    s.declare(2);
    const after = s.engine.runMutation("events:sent", { lastSeq: batch.lastSeq, more: false });
    expect(after.value).toBe(true);
    expect(drains(after)).toBe(1);
    const rest = s.engine.runQuery("events:pending", {}).value as {
      lastSeq: number;
      bodies: unknown[];
    };
    expect(rest).toMatchObject({ lastSeq: 3 });
    expect(rest.bodies).toHaveLength(1);
    const done = s.engine.runMutation("events:sent", { lastSeq: rest.lastSeq, more: false });
    expect(done.value).toBe(false);
    expect(s.engine.runQuery("events:pending", {}).value).toBeNull();
    // The mark is gone: the next event schedules a drain at once.
    expect(drains(s.declare(3))).toBe(1);
  });
});
