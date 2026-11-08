import { createEngine } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { EXPORTS_PER_HOUR, newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as exportsModule from "../exports.ts";
import * as postmortems from "../postmortems.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const owner = { kind: "user", id: ANA, role: "owner" } as const;
const viewer = { kind: "user", id: ANA, role: "viewer" } as const;

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, exports: exportsModule, postmortems },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor: owner }).value;
  const mutate = (name: string, args: unknown) =>
    engine.runMutation(
      "workspace:mutate",
      { name, args },
      { identity: { subject: ANA, claims: { role: "owner", ws: WS } } },
    ).value;
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args).value;
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  expect(server("member.sync", { id: ANA, name: "Ana", role: "owner" })).toEqual({ ok: true });
  return { mutate, call, tick: (ms: number) => (clock += ms) };
}

const exportId = (n: number) => newId("exp", T, (k) => new Uint8Array(k).fill(n));

describe("exports on Ember", () => {
  test("the opening and the entries come from the shard, and the hourly limit counts each start", () => {
    const s = shard();
    const incident = newId("inc", T, (n) => new Uint8Array(n).fill(4));
    expect(s.mutate("incident.declare", { id: incident, title: "Checkout is down" })).toEqual({
      ok: true,
    });
    const scope = { kind: "incident", incidentId: incident };
    const started = s.call("exports:start", {
      workspaceId: WS,
      actor: owner,
      scope,
      id: exportId(1),
    }) as { ok: true; opening: string; incidentIds: string[] };
    expect(started).toMatchObject({ ok: true, incidentIds: [incident] });
    const entries = s.call("exports:entries", {
      workspaceId: WS,
      incidentIds: started.incidentIds,
    }) as string[];
    expect(JSON.parse(entries[0]!)).toMatchObject({ incident: { id: incident } });
    for (let n = 2; n <= EXPORTS_PER_HOUR; n++) {
      s.call("exports:start", { workspaceId: WS, actor: owner, scope, id: exportId(n) });
    }
    expect(
      s.call("exports:start", { workspaceId: WS, actor: owner, scope, id: exportId(99) }),
    ).toEqual({ ok: false, code: "rate_limited" });
  });

  test("a viewer, another workspace, or an incident that is not there are refused", () => {
    const s = shard();
    const scope = { kind: "incident", incidentId: "inc_missing" };
    expect(
      s.call("exports:start", { workspaceId: WS, actor: viewer, scope, id: exportId(1) }),
    ).toEqual({ ok: false, code: "forbidden" });
    expect(
      s.call("exports:start", { workspaceId: "ws_other", actor: owner, scope, id: exportId(1) }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      s.call("exports:start", { workspaceId: WS, actor: owner, scope, id: exportId(1) }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(s.call("exports:entries", { workspaceId: "ws_other", incidentIds: [] })).toBe(null);
  });
});

describe("postmortems on Ember", () => {
  test("revisions need the incident and incident:read; a draft needs the incident", () => {
    const s = shard();
    expect(
      s.call("postmortems:revisions", {
        workspaceId: WS,
        actor: owner,
        incidentId: "inc_missing",
      }),
    ).toEqual({ ok: false, code: "not_found" });
    const incident = newId("inc", T, (n) => new Uint8Array(n).fill(5));
    s.mutate("incident.declare", { id: incident, title: "Search slow" });
    expect(
      s.call("postmortems:revisions", { workspaceId: WS, actor: owner, incidentId: incident }),
    ).toEqual({ ok: true, revisions: [] });
    expect(
      s.call("postmortems:requestDraft", {
        workspaceId: WS,
        actor: owner,
        incidentId: "inc_missing",
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      s.call("postmortems:requestDraft", {
        workspaceId: "ws_other",
        actor: owner,
        incidentId: incident,
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});
