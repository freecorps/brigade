import { describe, expect, test } from "vite-plus/test";
import {
  createMemoryStore,
  MAX_OPEN_MAINTENANCE,
  mutations,
  newId,
  nextMaintenanceAt,
  queries,
  runMutation,
  runQuery,
  serverMutations,
  statusSnapshot,
  uptime,
  UPTIME_DAYS,
  type BrigadeTables,
  type MonitorRow,
  type MutationContext,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let seed = 0;
const id = (prefix: string, at = T) =>
  newId(prefix, at, () => new Uint8Array(10).fill(++seed % 250));

const ctx = (role: Role = "owner", now = T): MutationContext => ({
  actor: { kind: "user", id: `usr_${role}`, role },
  now,
  server: true,
});

type Store = ReturnType<typeof createMemoryStore<BrigadeTables>>;
const run = (store: Store, name: string, args: unknown, context = ctx()) =>
  runMutation(serverMutations, name, args, store, context);

function ready() {
  const store = createMemoryStore<BrigadeTables>();
  run(store, "statusPage.configure", { slug: "acme", title: "Acme", locale: "en", enabled: true });
  const api = id("cmp");
  run(store, "statusComponent.create", { id: api, name: "API", group: null });
  return { store, api };
}

const window = (extra: Record<string, unknown> = {}) => ({
  id: id("mnt"),
  title: "Database upgrade",
  body: "We're moving to a larger database.\nExpect a minute of read-only time.",
  componentIds: [],
  startsAt: T + HOUR,
  endsAt: T + 3 * HOUR,
  ...extra,
});

describe("maintenance", () => {
  test("responders schedule it; viewers cannot; advance is server only", () => {
    const { store } = ready();
    expect(run(store, "maintenance.schedule", window(), ctx("responder"))).toMatchObject({
      ok: true,
      events: [{ type: "maintenance.scheduled", data: { phase: "scheduled" } }],
    });
    expect(run(store, "maintenance.schedule", window(), ctx("viewer"))).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect(Object.keys(mutations)).toContain("maintenance.schedule");
    expect(Object.keys(mutations)).not.toContain("maintenance.advance");
    expect(Object.keys(serverMutations)).toContain("maintenance.advance");
  });

  test("checks the page, the components and the times", () => {
    const store = createMemoryStore<BrigadeTables>();
    expect(run(store, "maintenance.schedule", window())).toMatchObject({
      error: { code: "not_found" },
    });
    const { store: page } = ready();
    for (const [extra, path] of [
      [{ endsAt: T + HOUR }, "endsAt"],
      [{ startsAt: T - 2 * HOUR, endsAt: T - HOUR }, "endsAt"],
      [{ endsAt: T + HOUR + 15 * DAY }, "endsAt"],
      [{ startsAt: T + 400 * DAY, endsAt: T + 401 * DAY }, "startsAt"],
      [{ componentIds: [id("cmp")] }, "componentIds[0]"],
    ] as const) {
      expect(run(page, "maintenance.schedule", window(extra))).toMatchObject({
        ok: false,
        error: { code: "invalid_args", issues: [{ path }] },
      });
    }
  });

  test("one that already started is under way at once", () => {
    const { store } = ready();
    expect(run(store, "maintenance.schedule", window({ startsAt: T - HOUR }))).toMatchObject({
      events: [{ data: { phase: "in_progress" } }],
    });
  });

  test("the alarm moves it on: started, then ended; nothing to move is a conflict", () => {
    const { store, api } = ready();
    const args = window({ componentIds: [api] });
    run(store, "maintenance.schedule", args);
    expect(nextMaintenanceAt(store.scan("status_maintenance"))).toBe(T + HOUR);
    expect(run(store, "maintenance.advance", { id: args.id }, ctx("admin", T + 10))).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    expect(
      run(store, "maintenance.advance", { id: args.id }, ctx("admin", T + HOUR)),
    ).toMatchObject({ ok: true, events: [{ type: "maintenance.started" }] });
    // Under way: the component shows maintenance, the snapshot lists it.
    const during = statusSnapshot(store, T + 2 * HOUR)!;
    expect(during.groups[0]!.components[0]!.status).toBe("maintenance");
    expect(during.status).toBe("operational");
    expect(during.maintenance).toMatchObject([{ title: "Database upgrade", components: ["API"] }]);
    expect(nextMaintenanceAt(store.scan("status_maintenance"))).toBe(T + 3 * HOUR);
    expect(
      run(store, "maintenance.advance", { id: args.id }, ctx("admin", T + 3 * HOUR)),
    ).toMatchObject({ ok: true, events: [{ type: "maintenance.ended", data: { early: false } }] });
    expect(nextMaintenanceAt(store.scan("status_maintenance"))).toBeNull();
    // Nothing left under way or upcoming: written as a version 1 again, without the new fields.
    expect(statusSnapshot(store, T + 4 * HOUR)).toMatchObject({ v: 1 });
    expect(statusSnapshot(store, T + 4 * HOUR)?.maintenance).toBeUndefined();
  });

  test("an incident on the component shows over maintenance", () => {
    const { store, api } = ready();
    run(store, "maintenance.schedule", window({ componentIds: [api], startsAt: T - HOUR }));
    run(store, "statusComponent.update", { id: api, name: "API", group: null, status: "degraded" });
    expect(statusSnapshot(store, T)!.groups[0]!.components[0]!.status).toBe("degraded");
  });

  test("a planned outage takes its components down while it runs, and can be turned back into maintenance", () => {
    const { store, api } = ready();
    const args = window({ componentIds: [api], outage: true });
    expect(run(store, "maintenance.schedule", args)).toMatchObject({
      ok: true,
      events: [{ type: "maintenance.scheduled", data: { outage: true } }],
    });
    // Upcoming: the window says what it is; the component is still up.
    const before = statusSnapshot(store, T)!;
    expect(before.upcoming).toMatchObject([{ outage: true }]);
    expect(before.groups[0]!.components[0]!.status).toBe("operational");
    run(store, "maintenance.advance", { id: args.id }, ctx("admin", T + HOUR));
    const during = statusSnapshot(store, T + 2 * HOUR)!;
    expect(during.groups[0]!.components[0]!.status).toBe("major_outage");
    // Planned work, not an incident: the banner's status stays the team's and the incidents'.
    expect(during.status).toBe("operational");
    expect(during.maintenance).toMatchObject([{ outage: true, components: ["API"] }]);
    expect(
      run(store, "maintenance.update", { ...args, outage: false }, ctx("admin", T + 2 * HOUR)),
    ).toMatchObject({ ok: true, events: [{ data: { outage: false } }] });
    const after = statusSnapshot(store, T + 2 * HOUR)!;
    expect(after.groups[0]!.components[0]!.status).toBe("maintenance");
    expect(after.maintenance![0]!.outage).toBeUndefined();
    // A dashboard from before planned outages sends none: the outage is kept, never turned off by leaving it out.
    run(store, "maintenance.update", { ...args, outage: true }, ctx("admin", T + 2 * HOUR));
    const old: Record<string, unknown> = { ...args };
    delete old.outage;
    expect(
      run(store, "maintenance.update", { ...old, title: "Renamed" }, ctx("admin", T + 2 * HOUR)),
    ).toMatchObject({ ok: true, events: [{ data: { outage: true } }] });
  });

  test("upcoming windows are listed soonest first, with nothing internal", () => {
    const { store } = ready();
    run(store, "maintenance.schedule", window({ startsAt: T + 5 * HOUR, endsAt: T + 6 * HOUR }));
    run(store, "maintenance.schedule", window({ title: "Sooner" }));
    const snapshot = statusSnapshot(store, T)!;
    expect(snapshot.upcoming!.map((one) => one.title)).toEqual(["Sooner", "Database upgrade"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/mnt_|usr_/);
  });

  test("update, end early and call off", () => {
    const { store } = ready();
    const args = window({ startsAt: T - HOUR });
    run(store, "maintenance.schedule", args);
    expect(run(store, "maintenance.update", args)).toMatchObject({ error: { code: "conflict" } });
    expect(
      run(store, "maintenance.update", { ...args, title: "Bigger database upgrade" }),
    ).toMatchObject({ ok: true, events: [{ type: "maintenance.updated" }] });
    expect(run(store, "maintenance.end", { id: args.id }, ctx("admin", T + 10))).toMatchObject({
      ok: true,
      events: [{ type: "maintenance.ended", data: { early: true, endsAt: T + 10 } }],
    });
    expect(run(store, "maintenance.cancel", { id: args.id })).toMatchObject({
      error: { code: "not_found" },
    });
    const other = window();
    run(store, "maintenance.schedule", other);
    expect(run(store, "maintenance.cancel", { id: other.id })).toMatchObject({
      ok: true,
      events: [{ type: "maintenance.cancelled", data: { title: "Database upgrade" } }],
    });
    expect(store.get("status_maintenance", other.id)).toBeUndefined();
  });

  test(`at most ${MAX_OPEN_MAINTENANCE} open windows`, () => {
    const { store } = ready();
    for (let index = 0; index < MAX_OPEN_MAINTENANCE; index++) {
      expect(run(store, "maintenance.schedule", window())).toMatchObject({ ok: true });
    }
    expect(run(store, "maintenance.schedule", window())).toMatchObject({
      error: { code: "limit_reached" },
    });
  });

  test("deleting a component takes it out of windows", () => {
    const { store, api } = ready();
    const args = window({ componentIds: [api] });
    run(store, "maintenance.schedule", args);
    run(store, "statusComponent.delete", { id: api });
    expect(store.get("status_maintenance", args.id)?.componentIds).toEqual([]);
  });

  test("everyone reads windows", () => {
    const { store } = ready();
    run(store, "maintenance.schedule", window());
    expect(runQuery(queries, "maintenance.all", {}, store, "viewer")).toMatchObject({
      ok: true,
      rows: [{ title: "Database upgrade" }],
    });
  });
});

describe("subscriber events", () => {
  test("carry the subscriber's id, never an address, and need a public page to request", () => {
    const { store } = ready();
    const subscriberId = id("ssb");
    expect(run(store, "statusSubscriber.request", { subscriberId, send: 1 })).toMatchObject({
      ok: true,
      events: [{ type: "status_subscriber.requested", data: { subscriberId, send: 1 } }],
    });
    expect(
      run(store, "statusSubscriber.remove", { subscriberId, reason: "deleted" }),
    ).toMatchObject({
      ok: true,
    });
    expect(Object.keys(mutations)).not.toContain("statusSubscriber.request");
    run(store, "statusPage.configure", {
      slug: "acme",
      title: "Acme",
      locale: "en",
      enabled: false,
    });
    expect(run(store, "statusSubscriber.request", { subscriberId, send: 2 })).toMatchObject({
      error: { code: "not_found" },
    });
  });
});

describe("uptime", () => {
  const monitor = (createdAt: number, pausedAt: number | null = null) => ({
    id: id("mon", createdAt),
    createdAt,
    paused: pausedAt !== null,
    pausedAt,
  });

  test("90 days, `none` before the monitor existed, then up, degraded and down", () => {
    const watched = monitor(T - 3 * DAY);
    const today = Math.floor(T / DAY) * DAY;
    const bar = uptime(
      [watched.id],
      [watched],
      [
        {
          monitorId: watched.id,
          firedAt: today - 2 * DAY + HOUR,
          resolvedAt: today - 2 * DAY + HOUR + 10 * 60_000,
        },
        { monitorId: watched.id, firedAt: today - DAY, resolvedAt: today - DAY + 2 * HOUR },
        { monitorId: "mon_other", firedAt: today, resolvedAt: null },
      ],
      T,
    );
    expect(bar.days).toHaveLength(UPTIME_DAYS);
    expect(bar.days.at(-1)).toMatchObject({ state: "up", date: "2026-10-27" });
    expect(bar.days.at(-2)).toMatchObject({ state: "down", down: 120 });
    expect(bar.days.at(-3)).toMatchObject({ state: "degraded", down: 10 });
    expect(bar.days.at(-4)).toMatchObject({ state: "up" });
    expect(bar.days.at(-5)).toMatchObject({ state: "none" });
    expect(bar.percent).toBeLessThan(100);
    expect(bar.percent).toBe(96.99);
  });

  test("overlapping alerts count once; a firing alert counts until now; nothing watched is null", () => {
    const watched = monitor(T - DAY);
    const other = monitor(T - DAY);
    const bar = uptime(
      [watched.id, other.id],
      [watched, other],
      [
        { monitorId: watched.id, firedAt: T - HOUR, resolvedAt: null },
        { monitorId: other.id, firedAt: T - HOUR, resolvedAt: T - 30 * 60_000 },
      ],
      T,
    );
    expect(bar.days.at(-1)).toMatchObject({ state: "down", down: 60 });
    expect(uptime(["mon_gone"], [], [], T)).toMatchObject({ percent: null });
  });

  test("a paused monitor has no data from its pause on, and its downtime then is not counted", () => {
    const today = Math.floor(T / DAY) * DAY;
    const paused = monitor(T - 3 * DAY, today - DAY);
    const bar = uptime(
      [paused.id],
      [paused],
      [{ monitorId: paused.id, firedAt: today - DAY - HOUR, resolvedAt: null }],
      T,
    );
    // Paused at yesterday's start: yesterday and today have no data, and the alert counts only until the pause.
    expect(bar.days.at(-1)).toMatchObject({ state: "none" });
    expect(bar.days.at(-2)).toMatchObject({ state: "none" });
    expect(bar.days.at(-3)).toMatchObject({ state: "down", down: 60 });
    // Another linked monitor still running keeps the days watched.
    const running = { ...monitor(T - 3 * DAY), id: id("mon", T - 3 * DAY + 1) };
    const both = uptime([paused.id, running.id], [paused, running], [], T);
    expect(both.days.at(-1)).toMatchObject({ state: "up" });
  });

  test("linking needs status:manage and real monitors; the snapshot carries the bar", () => {
    const { store, api } = ready();
    const mon = id("mon", T - DAY);
    store.insert("monitors", { id: mon, createdAt: T - DAY } as MonitorRow);
    expect(
      run(store, "statusComponent.linkMonitors", { id: api, monitorIds: [mon] }, ctx("responder")),
    ).toMatchObject({ error: { code: "forbidden" } });
    expect(
      run(store, "statusComponent.linkMonitors", { id: api, monitorIds: [id("mon")] }),
    ).toMatchObject({ error: { code: "invalid_args" } });
    expect(
      run(store, "statusComponent.linkMonitors", { id: api, monitorIds: [mon] }),
    ).toMatchObject({ ok: true, events: [{ type: "status_component.monitors_linked" }] });
    // A bar is new in version 2, so the snapshot is one.
    expect(statusSnapshot(store, T)).toMatchObject({ v: 2, maintenance: [], upcoming: [] });
    const component = statusSnapshot(store, T)!.groups[0]!.components[0]!;
    expect(component.uptime?.days).toHaveLength(UPTIME_DAYS);
    expect(JSON.stringify(component)).not.toContain("mon_");
  });
});
