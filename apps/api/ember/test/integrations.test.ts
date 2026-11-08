import { createEngine } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as integrations from "../integrations.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const owner = { kind: "user", id: ANA, role: "owner" } as const;

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, integrations },
    now: () => clock,
  });
  engine.migrate();
  const server = (name: string, args: unknown) =>
    engine.runMutation("workspace:serverMutate", { name, args, actor: owner }).value;
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args);
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  expect(server("member.sync", { id: ANA, name: "Ana", role: "owner" })).toEqual({ ok: true });
  return { call, tick: (ms: number) => (clock += ms) };
}

describe("Slack and webhooks on Ember", () => {
  test("an install state is kept under its hash and taken once, only on its own workspace", () => {
    const s = shard();
    const hash = "a".repeat(64);
    expect(
      s.call("integrations:slackKeepState", { workspaceId: WS, userId: ANA, hash }).value,
    ).toBe(true);
    expect(s.call("integrations:slackTakeState", { workspaceId: WS, hash }).value).toBe(ANA);
    expect(s.call("integrations:slackTakeState", { workspaceId: WS, hash }).value).toBe(null);
    expect(
      s.call("integrations:slackKeepState", { workspaceId: "ws_other", userId: ANA, hash }).value,
    ).toBe(false);
  });

  test("a state past its time is no one's", () => {
    const s = shard();
    const hash = "b".repeat(64);
    s.call("integrations:slackKeepState", { workspaceId: WS, userId: ANA, hash });
    s.tick(24 * 60 * 60 * 1000);
    expect(s.call("integrations:slackTakeState", { workspaceId: WS, hash }).value).toBe(null);
  });

  test("nothing connected: no team, nothing planned, nothing to archive or redrive", () => {
    const s = shard();
    expect(s.call("integrations:slackTeam", {}).value).toBe(null);
    expect(
      s.call("integrations:slackPlan", {
        event: { id: "evt_x", type: "incident.declared", workspaceId: "ws_other", data: {} },
      }).value,
    ).toEqual({ send: false, reason: "not_found" });
    expect(s.call("integrations:slackArchive", {}).value).toEqual({ archived: 0 });
    expect(s.call("integrations:webhookRedrive", {}).value).toEqual({ redriven: 0 });
    expect(
      s.call("integrations:webhookPlan", {
        event: { id: "evt_x", type: "incident.declared", workspaceId: "ws_other", data: {} },
      }).value,
    ).toEqual({ event: null, body: null, sends: [] });
  });

  test("a webhook change is refused for another workspace or an unknown name", () => {
    const s = shard();
    const run = (workspaceId: string, name: string) =>
      s.call("integrations:webhookRun", { workspaceId, actor: owner, name, args: {}, key: "k" })
        .value;
    expect(run("ws_other", "webhook.create")).toEqual({ ok: false, code: "not_found" });
    expect(run(WS, "webhook.drop")).toEqual({ ok: false, code: "invalid_args" });
    expect(run(WS, "webhook.create")).toMatchObject({ ok: false, code: "invalid_args" });
  });
});
