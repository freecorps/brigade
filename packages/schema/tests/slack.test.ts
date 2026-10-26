import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  isSlackChannelId,
  mutations,
  newId,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  SLACK_ROW_ID,
  TABLES,
  type BrigadeTables,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 26, 12, 0, 0);
const TOKEN = `v1.${"A".repeat(16)}.${"b".repeat(40)}`;
const connect = {
  teamId: "T0TEST0001",
  teamName: "Acme Slack",
  botUserId: "U0BOT00001",
  token: TOKEN,
  scopes: ["commands", "chat:write"],
  locale: "pt-BR",
};

const ctx = (role: Role = "owner", server = true): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now: T,
  server,
});

const connected = () => {
  const store = createMemoryStore<BrigadeTables>();
  const result = runMutation(serverMutations, "slack.connect", connect, store, ctx());
  expect(result).toMatchObject({ ok: true });
  return store;
};

describe("slack.connect", () => {
  test("is server only, and keeps the token in a table no client syncs", () => {
    expect(Object.keys(mutations)).not.toContain("slack.connect");
    expect(TABLES.slack_tokens.serverOnly).toBe(true);
    expect(TABLES.slack.serverOnly).toBe(false);
    const store = connected();
    expect(store.get("slack", SLACK_ROW_ID)).toEqual({
      id: SLACK_ROW_ID,
      teamId: "T0TEST0001",
      teamName: "Acme Slack",
      channelId: null,
      locale: "pt-BR",
      connectedAt: T,
      connectedBy: "usr_ana",
      updatedAt: T,
    });
    expect(store.get("slack_tokens", SLACK_ROW_ID)?.token).toBe(TOKEN);
  });

  test("never puts the token in its event", () => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(serverMutations, "slack.connect", connect, store, ctx());
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "slack.connected", data: { teamId: "T0TEST0001", replaced: null } }],
    });
  });

  test("needs workspace:manage: responders and viewers cannot connect", () => {
    for (const role of ["responder", "viewer"] as const) {
      const store = createMemoryStore<BrigadeTables>();
      expect(runMutation(serverMutations, "slack.connect", connect, store, ctx(role))).toMatchObject({
        ok: false,
        error: { code: "forbidden" },
      });
    }
  });

  test("refuses a plaintext token", () => {
    const store = createMemoryStore<BrigadeTables>();
    const result = runMutation(
      serverMutations,
      "slack.connect",
      { ...connect, token: "xoxb-not-sealed" },
      store,
      ctx(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_args" } });
  });

  test("a new token for the same team keeps the channel; another team starts over", () => {
    const store = connected();
    runMutation(mutations, "slack.configure", { channelId: "C0CHAN0001", locale: "en" }, store, ctx());
    runMutation(serverMutations, "slack.connect", connect, store, ctx());
    expect(store.get("slack", SLACK_ROW_ID)).toMatchObject({ channelId: "C0CHAN0001", locale: "en" });
    const other = runMutation(
      serverMutations,
      "slack.connect",
      { ...connect, teamId: "T0OTHER001" },
      store,
      ctx(),
    );
    expect(other).toMatchObject({ ok: true, events: [{ data: { replaced: "T0TEST0001" } }] });
    expect(store.get("slack", SLACK_ROW_ID)).toMatchObject({ channelId: null, locale: "pt-BR" });
  });
});

describe("slack.configure and slack.disconnect", () => {
  test("set the channel and language; no change is a conflict", () => {
    const store = connected();
    const args = { channelId: "G0PRIVATE1", locale: "en" };
    expect(runMutation(mutations, "slack.configure", args, store, ctx("admin"))).toMatchObject({
      ok: true,
      events: [{ type: "slack.configured", data: args }],
    });
    expect(runMutation(mutations, "slack.configure", args, store, ctx())).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  test("refuse channel ids that are not channels", () => {
    const store = connected();
    for (const channelId of ["U0USER0001", "c0lower001", "C", "#incidents", "C0CHAN0001 "]) {
      expect(
        runMutation(mutations, "slack.configure", { channelId, locale: "en" }, store, ctx()),
        channelId,
      ).toMatchObject({ ok: false, error: { code: "invalid_args" } });
    }
    expect(isSlackChannelId("C0CHAN0001")).toBe(true);
    expect(isSlackChannelId("D0DIRECT01")).toBe(false);
  });

  test("responders cannot change or disconnect it", () => {
    const store = connected();
    expect(
      runMutation(mutations, "slack.configure", { channelId: null, locale: "en" }, store, ctx("responder")),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
    expect(runMutation(mutations, "slack.disconnect", {}, store, ctx("responder"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  test("disconnecting forgets the token too", () => {
    const store = connected();
    expect(runMutation(mutations, "slack.disconnect", {}, store, ctx("admin"))).toMatchObject({
      ok: true,
      events: [{ type: "slack.disconnected", data: { teamId: "T0TEST0001" } }],
    });
    expect(store.get("slack", SLACK_ROW_ID)).toBeUndefined();
    expect(store.get("slack_tokens", SLACK_ROW_ID)).toBeUndefined();
    expect(runMutation(mutations, "slack.disconnect", {}, store, ctx())).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("every member reads the connection", () => {
    const store = connected();
    const result = runQuery(queries, "slack.connection", {}, store, "viewer");
    expect(result).toMatchObject({ ok: true, rows: [{ teamName: "Acme Slack" }] });
  });
});

describe("notification.failSlack", () => {
  test("is server only and writes a slack_failed entry", () => {
    expect(Object.keys(mutations)).not.toContain("notification.failSlack");
    const store = createMemoryStore<BrigadeTables>();
    const id = newId("inc", T, (n) => new Uint8Array(n).fill(1));
    runMutation(mutations, "incident.declare", { id, title: "Down", severity: "sev2" }, store, ctx());
    const eventId = newId("evt", T, (n) => new Uint8Array(n).fill(2));
    const result = runMutation(
      serverMutations,
      "notification.failSlack",
      { incidentId: id, eventId, reason: "no_channel" },
      store,
      { actor: { kind: "system", id: "sys_notifier", role: "admin" }, now: T, server: true },
    );
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "notification.failed", data: { channel: "slack", reason: "no_channel" } }],
    });
    expect(store.scan("timeline").at(-1)).toMatchObject({ kind: "slack_failed", reason: "no_channel" });
  });
});
