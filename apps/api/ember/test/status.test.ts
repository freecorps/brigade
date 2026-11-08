import { createEngine, queryGeneric, v, type QueryCtx } from "@freecorps/ember-server";
import { createNodeSqliteDriver } from "@freecorps/ember-server/testing";
import { newId } from "@freecorps/brigade-schema";
import { describe, expect, test } from "vite-plus/test";
import schema from "../schema.ts";
import * as events from "../events.ts";
import * as monitors from "../monitors.ts";
import * as status from "../status.ts";
import { DOMAIN_CHECK_LEASE_MS } from "../status.ts";
import { STATUS_PUSH_ABANDON_MS } from "../../src/status-page.ts";
import { local } from "./stubs.ts";
import * as workspace from "../workspace.ts";

// The real clock: the publisher and the page's mutation ids go by `Date.now()`, as on the DO.
const T = Date.now();
const WS = newId("ws", T, (n) => new Uint8Array(n).fill(3));
const ANA = "usr_ana";
const owner = { kind: "user", id: ANA, role: "owner" } as const;

const rows = queryGeneric({
  args: { table: v.string() },
  handler: (ctx: QueryCtx, { table }: { table: string }) =>
    (ctx.db as never as { query(t: string): { collect(): { data: string }[] } })
      .query(table)
      .collect()
      .map((row) => JSON.parse(row.data) as Record<string, unknown>),
} as never);

function shard() {
  let clock = T;
  const engine = createEngine({
    schema,
    driver: createNodeSqliteDriver(),
    functions: { workspace, local, events, monitors, status, test: { rows } },
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
    );
  const call = (fn: string, args: unknown) => engine.runMutation(fn, args);
  const table = (name: string) =>
    engine.runQuery("test:rows", { table: name }).value as Record<string, unknown>[];
  expect(server("workspace.create", { id: WS, name: "Freecorps" })).toEqual({ ok: true });
  expect(server("member.sync", { id: ANA, name: "Ana", role: "owner" })).toEqual({ ok: true });
  return { mutate, call, table, tick: (ms: number) => (clock += ms) };
}

const page = { slug: "acme", title: "Acme", locale: "en", enabled: true };

type Plan = {
  workspaceId: string;
  started: number;
  plan: { dirty?: number; page?: { key: string; put?: string }; retired: unknown[] };
};

describe("the status page on Ember", () => {
  test("the shard's checks come first, then the page as it is", () => {
    const s = shard();
    expect(s.call("status:current", { workspaceId: "ws_other", actor: owner }).value).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(s.call("status:current", { workspaceId: WS, actor: owner }).value).toEqual({
      ok: true,
      acting: owner,
      page: null,
    });
  });

  test("a page set up arms the push, which puts its snapshot in KV and records it", () => {
    const s = shard();
    const set = s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    expect(set.value).toEqual({ ok: true });
    expect(set.scheduled.map((job) => job.fn)).toContain("status:push");
    const planned = s.call("status:plan", { kv: true });
    // A fallback, so an action that dies before `record` never ends the chain.
    expect(planned.scheduled.map((job) => job.fn)).toContain("status:push");
    const due = planned.value as Plan;
    expect(due.workspaceId).toBe(WS);
    expect(due.plan.dirty).toBeGreaterThan(0);
    expect(due.plan.page?.key).toBe("status:acme");
    expect(JSON.parse(due.plan.page!.put!)).toMatchObject({ workspaceId: WS });
    const recorded = s.call("status:record", {
      kv: true,
      plan: due.plan,
      done: { page: true, cleared: [], released: [] },
      started: due.started,
    });
    expect(recorded.value).toBe(null);
    // Pushed: nothing is due until its daily rebuild.
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
  });

  test("a push that failed keeps the change pending, backed off", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const due = s.call("status:plan", { kv: true }).value as Plan;
    s.call("status:record", {
      kv: true,
      plan: due.plan,
      done: { page: false, cleared: [], released: [], error: "KV is down" },
      started: due.started,
    });
    // Within the backoff: not due yet.
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
    s.tick(10 * 60 * 1000);
    expect((s.call("status:plan", { kv: true }).value as Plan).plan.dirty).toBe(due.plan.dirty);
  });

  test("a push never starts beside one still out; an abandoned one's record marks the page to go again", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const first = s.call("status:plan", { kv: true }).value as Plan;
    // Another change while it is out: no second push beside it.
    s.call("status:configure", {
      workspaceId: WS,
      actor: owner,
      args: { ...page, title: "Acme Inc" },
      now: T,
    });
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
    // Past the abandon time: a newer push takes over.
    s.tick(STATUS_PUSH_ABANDON_MS + 1);
    const second = s.call("status:plan", { kv: true }).value as Plan;
    expect(second.started).toBeGreaterThan(first.started);
    s.call("status:record", {
      kv: true,
      plan: second.plan,
      done: { page: true, cleared: [], released: [] },
      started: second.started,
    });
    expect(s.call("status:plan", { kv: true }).value).toBe(null);
    // The abandoned one settles late: its write may have landed after the newer one, so the page goes again.
    s.call("status:record", {
      kv: true,
      plan: first.plan,
      done: { page: true, cleared: [], released: [] },
      started: first.started,
    });
    s.tick(2000);
    expect(s.call("status:plan", { kv: true }).value).not.toBe(null);
  });

  test("two saves in one clock tick keep their order: the slug given up is retired after the first save", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const first = s.table("status_page")[0]!.updatedAt as number;
    s.call("status:configure", {
      workspaceId: WS,
      actor: owner,
      args: { ...page, slug: "acme-two" },
      now: T,
    });
    const [retired] = s.table("status_retired");
    expect(retired).toMatchObject({ id: "acme" });
    expect(retired!.at).toBeGreaterThan(first);
  });

  test("a save checks the member again: one removed since the Worker's check is refused", () => {
    const s = shard();
    const bia = { kind: "user", id: "usr_bia", role: "admin" } as const;
    const server = (name: string, args: unknown, actor: unknown) =>
      s.call("workspace:serverMutate", { name, args, actor }).value;
    expect(server("member.sync", { id: "usr_bia", name: "Bia", role: "admin" }, bia)).toEqual({
      ok: true,
    });
    expect(
      server("member.remove", { id: "usr_bia", role: "admin", reason: "removed" }, owner),
    ).toEqual({ ok: true });
    expect(
      s.call("status:configure", { workspaceId: WS, actor: bia, args: page, now: T }).value,
    ).toMatchObject({ ok: false, code: "not_a_member", releasable: true });
  });

  test("a refused page answers its code, and says whether a slug just claimed may go back", () => {
    const s = shard();
    const refused = s.call("status:configure", {
      workspaceId: WS,
      actor: { kind: "user", id: ANA, role: "viewer" },
      args: page,
      now: T,
    }).value;
    expect(refused).toMatchObject({ ok: false, code: "forbidden", releasable: true });
  });

  test("a maintenance window scheduled arms its start, and the tick moves it on", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const id = newId("mnt", T, (n) => new Uint8Array(n).fill(7));
    const scheduled = s.mutate("maintenance.schedule", {
      id,
      title: "Database upgrade",
      body: "Read-only for a minute.",
      componentIds: [],
      startsAt: T + 60_000,
      endsAt: T + 120_000,
    });
    expect(scheduled.value).toEqual({ ok: true });
    expect(scheduled.scheduled.map((job) => job.fn)).toContain("status:maintenance");
    expect(s.call("status:maintenance", {}).value).toEqual({ advanced: 0 });
    s.tick(61_000);
    expect(s.call("status:maintenance", {}).value).toEqual({ advanced: 1 });
    expect(s.table("status_maintenance")).toMatchObject([{ id, phase: "in_progress" }]);
  });
});

describe("status page subscriptions and emails on Ember", () => {
  test("a subscription's request goes through, a removal is recorded once, and an email event is planned", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const subscriberId = newId("ssb", T, (n) => new Uint8Array(n).fill(8));
    const change = (c: unknown) =>
      s.call("status:subscription", { workspaceId: WS, change: c }).value;
    expect(change({ action: "request", subscriberId, send: 1 })).toEqual({ ok: true });
    expect(change({ action: "remove", subscriberId, reason: "unsubscribed" })).toEqual({
      ok: true,
    });
    // Again (a retry after D1 failed): done already, nothing written twice.
    expect(change({ action: "remove", subscriberId, reason: "unsubscribed" })).toEqual({
      ok: true,
    });
    expect(
      s.call("status:subscription", {
        workspaceId: "ws_other",
        change: { action: "request", subscriberId, send: 1 },
      }).value,
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      s.call("status:planEmail", {
        event: { id: "evt_x", type: "incident.declared", workspaceId: WS, data: {} },
      }).value,
    ).toMatchObject({ send: false });
  });

  test("the follow names come from the page's components", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const component = newId("cmp", T, (n) => new Uint8Array(n).fill(9));
    expect(
      s.mutate("statusComponent.create", { id: component, name: "API", group: "Core" }).value,
    ).toEqual({ ok: true });
    const names = s.call("status:followNames", { workspaceId: WS }).value as Record<string, string>;
    expect(Object.values(names).sort((a, b) => a.localeCompare(b))).toEqual(["API", "group: Core"]);
    expect(s.call("status:followNames", { workspaceId: "ws_other" }).value).toEqual({});
  });
});

describe("the status page's domain on Ember", () => {
  test("a dedicated domain added is checked by the tick: the edge answering makes it active", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    expect(s.call("status:domainState", { workspaceId: WS }).value).toMatchObject({
      domain: null,
      page: { slug: "acme", public: true },
    });
    const added = s.call("status:changeDomain", {
      workspaceId: WS,
      actor: owner,
      name: "add",
      args: {
        hostname: "status.example.com",
        cloudflareId: null,
        state: "pending",
        records: [],
        error: "not_attached",
      },
    });
    expect(added.value).toEqual({ ok: true });
    expect(added.scheduled.map((job) => job.fn)).toContain("status:domainCheck");
    // Not due yet (just checked when added); a minute on it is.
    expect(s.call("status:domainDue", { config: false }).value).toBe(null);
    s.tick(2 * 60 * 1000);
    const due = s.call("status:domainDue", { config: false }).value as {
      row: { hostname: string };
      started: number;
    };
    expect(due.row.hostname).toBe("status.example.com");
    s.call("status:domainSettle", {
      config: false,
      row: due.row,
      probed: { kind: "edge", answers: true },
      started: due.started,
    });
    expect(
      (s.call("status:domainState", { workspaceId: WS }).value as { domain: { state: string } })
        .domain.state,
    ).toBe("active");
  });

  test("a domain check never starts beside one still out, and a check that outlived its lease records nothing", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    s.call("status:changeDomain", {
      workspaceId: WS,
      actor: owner,
      name: "add",
      args: {
        hostname: "status.example.com",
        cloudflareId: null,
        state: "pending",
        records: [],
        error: "not_attached",
      },
    });
    s.tick(2 * 60 * 1000);
    const first = s.call("status:domainDue", { config: false }).value as {
      row: unknown;
      started: number;
    };
    expect(first).not.toBe(null);
    expect(s.call("status:domainDue", { config: false }).value).toBe(null);
    // A check by hand meanwhile: the one out in the background no longer holds the lease.
    expect(
      s.call("status:changeDomain", {
        workspaceId: WS,
        actor: owner,
        name: "check",
        args: {
          hostname: "status.example.com",
          cloudflareId: null,
          addedAt: (
            s.call("status:domainState", { workspaceId: WS }).value as {
              domain: { createdAt: number };
            }
          ).domain.createdAt,
          state: "pending",
          records: [],
          error: "not_attached",
        },
      }).value,
    ).toEqual({ ok: true });
    s.tick(DOMAIN_CHECK_LEASE_MS + 1);
    const second = s.call("status:domainDue", { config: false }).value as { started: number };
    expect(second.started).toBeGreaterThan(first.started);
    // The first settles late: dropped.
    s.call("status:domainSettle", {
      config: false,
      row: first.row,
      probed: { kind: "edge", answers: true },
      started: first.started,
    });
    expect(
      (s.call("status:domainState", { workspaceId: WS }).value as { domain: { state: string } })
        .domain.state,
    ).toBe("pending");
  });

  test("a domain activated by hand stays active when the background check out before it settles", () => {
    const s = shard();
    s.call("status:configure", { workspaceId: WS, actor: owner, args: page, now: T });
    const domain = {
      hostname: "status.example.com",
      cloudflareId: "cf_status_1",
      records: [],
    };
    s.call("status:changeDomain", {
      workspaceId: WS,
      actor: owner,
      name: "add",
      args: { ...domain, state: "pending", error: "not_attached" },
    });
    s.tick(2 * 60 * 1000);
    const background = s.call("status:domainDue", { config: true }).value as {
      row: unknown;
      started: number;
    };
    const addedAt = (
      s.call("status:domainState", { workspaceId: WS }).value as { domain: { createdAt: number } }
    ).domain.createdAt;
    expect(
      s.call("status:changeDomain", {
        workspaceId: WS,
        actor: owner,
        name: "check",
        args: { ...domain, addedAt, state: "active", error: null },
      }).value,
    ).toEqual({ ok: true });
    // The background check settles within its lease with what Cloudflare said before: still pending. Dropped.
    s.call("status:domainSettle", {
      config: true,
      row: background.row,
      probed: {
        kind: "cloudflare",
        answer: {
          ok: true,
          value: { id: "cf_status_1", state: "pending", records: [], error: "not_attached" },
        },
      },
      started: background.started,
    });
    expect(
      (s.call("status:domainState", { workspaceId: WS }).value as { domain: { state: string } })
        .domain.state,
    ).toBe("active");
  });

  test("another workspace's shard, and an unknown change, are refused", () => {
    const s = shard();
    expect(
      s.call("status:changeDomain", {
        workspaceId: "ws_other",
        actor: owner,
        name: "add",
        args: {},
      }).value,
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      s.call("status:changeDomain", { workspaceId: WS, actor: owner, name: "drop", args: {} })
        .value,
    ).toEqual({ ok: false, code: "invalid_args" });
    expect(s.call("status:domainState", { workspaceId: "ws_other" }).value).toEqual({
      domain: null,
      page: null,
    });
  });
});
