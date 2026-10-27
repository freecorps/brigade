// Monitor alerts through the alert routes (RFC 0007 "Monitor alerts through the routes"). A paging path: every way a
// route could keep a down monitor from paging has a test here, and so does every fallback to today's behaviour.

import { describe, expect, test } from "vite-plus/test";
import {
  ALERTS_ACTOR,
  createMemoryStore,
  evaluateQuery,
  incidentPolicy,
  incidentTimeline,
  MONITOR_ACTOR,
  monitorAlertsToReroute,
  mutations,
  newId,
  pickRoute,
  quietMonitorAlerts,
  MAX_ROUTE_MONITORS,
  MAX_ROUTE_SOURCES,
  ROUTE_ALL_MONITORS,
  ROUTE_ALL_SOURCES,
  runMutation,
  serverMutations,
  type BrigadeTables,
  type MemoryStore,
  type MutationContext,
  type MutationResult,
  type NormalizedAlert,
  type Role,
} from "../src/index.ts";

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const HASH = "a".repeat(64);

const as = (role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now,
  server: true,
});
const monitors = (now: number): MutationContext => ({ actor: MONITOR_ACTOR, now, server: true });
const alerts = (now: number): MutationContext => ({ actor: ALERTS_ACTOR, now, server: true });
const store = () => createMemoryStore<BrigadeTables>();
const types = (result: MutationResult) =>
  result.ok ? result.events.map((event) => event.type) : result.error.code;
const ok = (result: MutationResult) => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result;
};

type Db = MemoryStore<BrigadeTables>;

function createMonitor(db: Db, name = "Checkout", severity?: string, policyId?: string) {
  const id = newId("mon", T, random);
  ok(
    runMutation(
      mutations,
      "monitor.createHttp",
      {
        id,
        name,
        url: "https://example.com/health",
        method: "GET",
        expectedStatus: null,
        keyword: null,
        intervalSeconds: 60,
        timeoutSeconds: 10,
        regions: ["weur"],
        ...(severity && { severity }),
        ...(policyId && { policyId }),
      },
      db,
      as("admin"),
    ),
  );
  return id;
}

/** One region's verdict; with one region it is the monitor's. */
function report(db: Db, id: string, up: boolean, at: number) {
  return runMutation(
    serverMutations,
    "monitor.report",
    {
      id,
      source: "weur",
      at,
      up,
      latencyMs: 42,
      colo: "CDG",
      httpStatus: up ? 200 : 503,
      error: up ? null : "status",
      open: {
        alertId: newId("alt", at, random),
        incidentId: newId("inc", at, random),
        title: `${db.get("monitors", id)?.name ?? id} is down`,
      },
    },
    db,
    monitors(at),
  );
}

/** Up, then down: the report that turns it down. */
function down(db: Db, id: string, at = T + 2000) {
  ok(report(db, id, true, at - 1000));
  return report(db, id, false, at);
}

const OPEN = { kind: "open", severity: null, typeId: null, serviceIds: [], policyId: null };

function createRoute(db: Db, match: object, action: object, name = "Route") {
  const id = newId("rte", T, random);
  ok(
    runMutation(
      mutations,
      "alertRoute.create",
      { id, name, match: { sourceIds: [], severities: [], labels: [], ...match }, action },
      db,
      as("admin"),
    ),
  );
  return id;
}

function createPolicy(db: Db, name: string, isDefault = false) {
  if (!db.get("members", "usr_ana")) {
    db.insert("members", { id: "usr_ana", name: "Ana", role: "admin", updatedAt: T });
  }
  const id = newId("esc", T, random);
  ok(
    runMutation(
      mutations,
      "escalation.createPolicy",
      {
        id,
        name,
        levels: [
          {
            id: newId("lvl", T, random),
            targets: [{ kind: "member", id: "usr_ana" }],
            timeoutMinutes: 5,
          },
        ],
        repeat: 0,
        isDefault,
      },
      db,
      as("admin"),
    ),
  );
  return id;
}

function createType(db: Db, defaultSeverity = "sev3") {
  const id = newId("typ", T, random);
  ok(
    runMutation(
      mutations,
      "incidentType.create",
      {
        id,
        name: "Checkout outage",
        description: "",
        defaultSeverity,
        escalationPolicyId: null,
        requiredFields: [],
      },
      db,
      as("admin"),
    ),
  );
  return id;
}

function createService(db: Db, escalationPolicyId: string | null = null) {
  const id = newId("svc", T, random);
  ok(
    runMutation(
      mutations,
      "service.create",
      { id, name: "Checkout", description: "", tier: "tier1", owners: [], escalationPolicyId },
      db,
      as("admin"),
    ),
  );
  return id;
}

function createSource(db: Db) {
  const id = newId("src", T, random);
  ok(
    runMutation(
      mutations,
      "alertSource.create",
      { id, name: "Grafana", kind: "grafana", tokenHash: HASH, auth: null, signingSecret: null },
      db,
      as("admin"),
    ),
  );
  return id;
}

function ingest(db: Db, sourceId: string, alert: NormalizedAlert, now: number) {
  return runMutation(
    serverMutations,
    "alert.ingest",
    {
      sourceId,
      malformed: false,
      alerts: [
        { alert, alertId: newId("alt", now, random), incidentId: newId("inc", now, random) },
      ],
    },
    db,
    alerts(now),
  );
}

/** What the shard runs after the routes change (apps/api `AlertIntake.reroute`). */
function reroute(db: Db, now: number) {
  return runMutation(
    serverMutations,
    "alert.reroute",
    {
      rows: quietMonitorAlerts(db).map((row) => ({
        rowId: row.id,
        alertId: newId("alt", now, random),
        incidentId: newId("inc", now, random),
        title: `${db.get("monitors", row.monitorId)?.name} is down`,
      })),
    },
    db,
    alerts(now),
  );
}

describe("matching monitors", () => {
  test("a route takes monitors only when it names one or every monitor; sources only when it names no monitor alone", () => {
    const route = (sourceIds: string[]) => ({
      id: "rte_x",
      name: "R",
      position: 0,
      match: { sourceIds, severities: [], labels: [] },
      action: { kind: "drop" as const },
      createdAt: T,
      createdBy: "usr_ana",
      updatedAt: T,
    });
    const monitor = newId("mon", T, random);
    const other = newId("mon", T, random);
    const source = newId("src", T, random);
    const alert: NormalizedAlert = {
      dedupKey: `monitor:${monitor}`,
      title: "Checkout is down",
      severity: "high",
      status: "firing",
      link: null,
      labels: { monitor: "Checkout", kind: "http" },
    };
    // Routes saved before this change name no monitor: they never catch one.
    expect(pickRoute([route([])], monitor, alert, false).reason).toBe("default");
    expect(pickRoute([route([source])], monitor, alert, false).reason).toBe("default");
    expect(pickRoute([route([ROUTE_ALL_MONITORS])], monitor, alert, false).reason).toBe("matched");
    expect(pickRoute([route([monitor])], monitor, alert, false).reason).toBe("matched");
    expect(pickRoute([route([other])], monitor, alert, false).reason).toBe("default");
    // A route naming only monitors never catches an alert source's alert.
    expect(pickRoute([route([ROUTE_ALL_MONITORS])], source, alert, false).reason).toBe("default");
    expect(pickRoute([route([ROUTE_ALL_MONITORS, source])], source, alert, false).reason).toBe(
      "matched",
    );
  });

  test("every source said explicitly keeps a route's sources when it names monitors; routes saved before keep their meaning", () => {
    const route = (sourceIds: string[]) => ({
      id: "rte_x",
      name: "R",
      position: 0,
      match: { sourceIds, severities: [], labels: [] },
      action: { kind: "drop" as const },
      createdAt: T,
      createdBy: "usr_ana",
      updatedAt: T,
    });
    const monitor = newId("mon", T, random);
    const source = newId("src", T, random);
    const other = newId("src", T, random);
    const alert: NormalizedAlert = {
      dedupKey: "k",
      title: "Checkout is down",
      severity: "high",
      status: "firing",
      link: null,
      labels: { monitor: "Checkout", kind: "http" },
    };
    const matched = (sourceIds: string[], from: string) =>
      pickRoute([route(sourceIds)], from, alert, false).reason === "matched";
    // Saved before monitors were routed: empty is every source and no monitor; named sources are those only.
    expect([matched([], source), matched([], monitor)]).toEqual([true, false]);
    expect([matched([source], source), matched([source], other)]).toEqual([true, false]);
    // Every source beside monitors: every source and those monitors.
    expect(
      [source, other, monitor].map((from) => matched([ROUTE_ALL_SOURCES, monitor], from)),
    ).toEqual([true, true, true]);
    expect(matched([ROUTE_ALL_SOURCES], monitor)).toBe(false);
    // Monitors only: no source.
    expect([matched([monitor], source), matched([monitor], monitor)]).toEqual([false, true]);
  });

  test("a route names up to 20 sources and, apart, up to 100 monitors", () => {
    const db = store();
    const create = (sourceIds: string[]) =>
      runMutation(
        mutations,
        "alertRoute.create",
        {
          id: newId("rte", T, random),
          name: "R",
          match: { sourceIds, severities: [], labels: [] },
          action: { kind: "suppress" },
        },
        db,
        as("admin"),
      );
    const sources = Array.from({ length: MAX_ROUTE_SOURCES }, () => newId("src", T, random));
    const many = Array.from({ length: MAX_ROUTE_MONITORS }, () => newId("mon", T, random));
    expect(create([...sources, ...many])).toMatchObject({ ok: true });
    expect(create([ROUTE_ALL_SOURCES, ...many])).toMatchObject({ ok: true });
    expect(create([...sources, newId("src", T, random)])).toMatchObject({
      ok: false,
      error: { issues: [{ message: "At most 20 alert sources" }] },
    });
    expect(create([...many, newId("mon", T, random)])).toMatchObject({
      ok: false,
      error: { issues: [{ message: "At most 100 monitors" }] },
    });
  });

  test("routes save monitors and every monitor, and refuse anything else", () => {
    const db = store();
    const monitor = createMonitor(db);
    createRoute(db, { sourceIds: [ROUTE_ALL_MONITORS, monitor] }, { kind: "suppress" });
    const bad = runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "R",
        match: { sourceIds: ["everything"], severities: [], labels: [] },
        action: { kind: "drop" },
      },
      db,
      as("admin"),
    );
    expect(bad).toMatchObject({ ok: false, error: { issues: [{ path: "match.sourceIds[0]" }] } });
  });

  test("a monitor matches with its severity and its `monitor` and `kind` labels", () => {
    const db = store();
    const critical = createMonitor(db, "Payments", "sev1");
    const warning = createMonitor(db, "Docs", "sev3");
    createRoute(
      db,
      { sourceIds: [ROUTE_ALL_MONITORS], severities: ["warning"] },
      { kind: "suppress" },
      "Quiet warnings",
    );
    createRoute(
      db,
      { sourceIds: [ROUTE_ALL_MONITORS], labels: [{ key: "monitor", value: "Payments" }] },
      { ...OPEN, severity: "sev2" },
      "Payments",
    );
    expect(types(down(db, warning))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.fired",
    ]);
    expect(db.get("monitors", warning)).toMatchObject({
      incidentId: null,
      alertRoute: { name: "Quiet warnings", outcome: "suppressed" },
    });
    down(db, critical, T + 4000);
    expect(db.scan("incidents")).toMatchObject([{ title: "Payments is down", severity: "sev2" }]);
  });
});

describe("no route, or routes saved before: exactly as before", () => {
  test("a monitor down with no routes opens its incident as it always has", () => {
    const db = store();
    const policy = createPolicy(db, "Checkout on-call");
    const id = createMonitor(db, "Checkout", "sev3", policy);
    const result = ok(down(db, id));
    expect(types(result)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "incident.declared",
      "alert.fired",
    ]);
    const monitor = db.get("monitors", id)!;
    // The event and the rows carry nothing new.
    expect(result.events.at(-1)?.data).toEqual({
      id: monitor.alertId,
      fingerprint: `monitor:${id}`,
      monitorId: id,
      incidentId: monitor.incidentId,
    });
    expect(db.get("alerts", monitor.alertId!)).toEqual({
      id: monitor.alertId,
      fingerprint: `monitor:${id}`,
      monitorId: id,
      status: "firing",
      firedAt: T + 2000,
      resolvedAt: null,
      incidentId: monitor.incidentId,
    });
    expect(monitor).not.toHaveProperty("alertRoute");
    expect(db.get("incidents", monitor.incidentId!)).toMatchObject({
      severity: "sev3",
      declaredBy: "sys_monitors",
    });
    expect(db.get("incidents", monitor.incidentId!)).not.toHaveProperty("typeId");
    expect(db.scan("incident_routes")).toEqual([]);
    expect(incidentPolicy(db, monitor.incidentId!)).toMatchObject({
      policy: { id: policy },
      monitor: { id },
    });
  });

  test("a catch-all drop route saved for alert sources never silences a monitor", () => {
    const db = store();
    createRoute(db, {}, { kind: "drop" }, "Drop everything");
    const id = createMonitor(db);
    expect(types(down(db, id))).toContain("incident.declared");
    expect(db.get("monitors", id)).toMatchObject({ incidentId: expect.any(String) });
    expect(db.get("alerts", db.get("monitors", id)!.alertId!)).not.toHaveProperty("outcome");
  });
});

describe("route actions", () => {
  test("open declares with the route's severity, type and services, and the route's policy pages first", () => {
    const db = store();
    createPolicy(db, "Default", true);
    const own = createPolicy(db, "Monitor's own");
    const routed = createPolicy(db, "Payments on-call");
    const typeId = createType(db);
    const serviceId = createService(db);
    const id = createMonitor(db, "Checkout", "sev3", own);
    const route = createRoute(
      db,
      { sourceIds: [id] },
      { kind: "open", severity: "sev1", typeId, serviceIds: [serviceId], policyId: routed },
      "Checkout",
    );
    const result = ok(down(db, id));
    const monitor = db.get("monitors", id)!;
    expect(db.get("incidents", monitor.incidentId!)).toMatchObject({
      severity: "sev1",
      typeId,
      serviceIds: [serviceId],
      declaredBy: "sys_monitors",
    });
    expect(result.events.at(-1)?.data).toMatchObject({
      outcome: "opened",
      routeId: route,
      reason: "matched",
    });
    expect(monitor.alertRoute).toEqual({ id: route, name: "Checkout", outcome: "opened" });
    expect(incidentPolicy(db, monitor.incidentId!)).toMatchObject({
      policy: { id: routed },
      route: { id: route },
    });
  });

  test("without a severity the route takes the type's, else the monitor's", () => {
    const db = store();
    const typeId = createType(db, "sev4");
    const typed = createMonitor(db, "Typed", "sev1");
    const plain = createMonitor(db, "Plain", "sev1");
    createRoute(db, { sourceIds: [typed] }, { ...OPEN, typeId });
    createRoute(db, { sourceIds: [plain] }, OPEN);
    down(db, typed);
    down(db, plain, T + 4000);
    expect(db.get("incidents", db.get("monitors", typed)!.incidentId!)?.severity).toBe("sev4");
    expect(db.get("incidents", db.get("monitors", plain)!.incidentId!)?.severity).toBe("sev1");
  });

  test("a service named by a route pages a monitor's incident through the service's policy", () => {
    const db = store();
    createPolicy(db, "Default", true);
    const owning = createPolicy(db, "Checkout team");
    const own = createPolicy(db, "Monitor's own");
    const serviceId = createService(db, owning);
    const id = createMonitor(db, "Checkout", undefined, own);
    createRoute(db, { sourceIds: [ROUTE_ALL_MONITORS] }, { ...OPEN, serviceIds: [serviceId] });
    down(db, id);
    expect(incidentPolicy(db, db.get("monitors", id)!.incidentId!)).toMatchObject({
      policy: { id: owning },
      service: { id: serviceId },
    });
  });

  test("suppress records the alert with no incident; recovery resolves it", () => {
    const db = store();
    const id = createMonitor(db);
    const route = createRoute(
      db,
      { sourceIds: [ROUTE_ALL_MONITORS] },
      { kind: "suppress" },
      "Quiet",
    );
    const result = ok(down(db, id));
    expect(types(result)).toEqual(["monitor.checked", "monitor.status_changed", "alert.fired"]);
    expect(result.events.at(-1)?.data).toMatchObject({
      incidentId: null,
      outcome: "suppressed",
      routeId: route,
    });
    const monitor = db.get("monitors", id)!;
    expect(monitor).toMatchObject({
      status: "down",
      incidentId: null,
      alertId: expect.any(String),
    });
    expect(db.get("alerts", monitor.alertId!)).toMatchObject({
      status: "firing",
      outcome: "suppressed",
      routeName: "Quiet",
      incidentId: null,
    });
    expect(db.scan("incidents")).toEqual([]);
    // Still down: deduplicated, nothing more.
    expect(types(report(db, id, false, T + 3000))).toEqual([]);
    expect(types(report(db, id, true, T + 4000))).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.resolved",
    ]);
    expect(db.get("monitors", id)).toMatchObject({ alertId: null, alertRoute: null });
    expect(db.get("alerts", monitor.alertId!)).toMatchObject({ status: "resolved" });
  });

  test("drop records which route dropped it, and pages nobody", () => {
    const db = store();
    const id = createMonitor(db);
    const route = createRoute(db, { sourceIds: [id] }, { kind: "drop" }, "Flaky");
    const result = ok(down(db, id));
    expect(types(result)).toEqual(["monitor.checked", "monitor.status_changed", "alert.dropped"]);
    expect(result.events.at(-1)?.data).toEqual({
      id: db.get("monitors", id)!.alertId,
      fingerprint: `monitor:${id}`,
      monitorId: id,
      routeId: route,
      routeName: "Flaky",
    });
    expect(db.scan("incidents")).toEqual([]);
  });

  test("group puts a monitor and an alert source's alert of one label value in one incident", () => {
    const db = store();
    const source = createSource(db);
    const id = createMonitor(db, "Checkout", "sev1");
    createRoute(
      db,
      { sourceIds: [source, ROUTE_ALL_MONITORS] },
      { ...OPEN, kind: "group", groupBy: "monitor" },
      "By monitor",
    );
    ok(
      ingest(
        db,
        source,
        {
          dedupKey: "checkout-latency",
          title: "Checkout is slow",
          severity: "warning",
          status: "firing",
          link: null,
          labels: { monitor: "Checkout" },
        },
        T + 1000,
      ),
    );
    const [incident] = db.scan("incidents");
    expect(incident).toMatchObject({ severity: "sev3" });
    const result = ok(down(db, id, T + 3000));
    // Joined, and raised to the monitor's SEV1, which pages again.
    expect(types(result)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.fired",
      "incident.severity_changed",
    ]);
    expect(db.scan("incidents")).toHaveLength(1);
    expect(db.get("monitors", id)).toMatchObject({
      incidentId: incident!.id,
      alertRoute: { outcome: "grouped" },
    });
    expect(db.get("incidents", incident!.id)?.severity).toBe("sev1");
    // Grouping pages nobody by itself: the incident's timeline says the monitor joined it.
    expect(
      evaluateQuery(incidentTimeline, { id: incident!.id }, db).filter(
        (entry) => entry.kind === "alert_grouped",
      ),
    ).toEqual([
      expect.objectContaining({ monitorId: id, name: "Checkout", actor: "sys_monitors" }),
    ]);

    // The Grafana alert resolving does not close an incident the monitor still holds.
    ok(
      ingest(
        db,
        source,
        {
          dedupKey: "checkout-latency",
          title: "Checkout is slow",
          severity: "warning",
          status: "resolved",
          link: null,
          labels: { monitor: "Checkout" },
        },
        T + 4000,
      ),
    );
    expect(db.get("incidents", incident!.id)?.status).toBe("triage");

    // The monitor recovering last settles the incident as the Grafana alert's resolve would have: nobody worked on
    // it, so it resolves, as the alerts' actor (an incident the monitor opened would stay for people).
    const recovered = ok(report(db, id, true, T + 5000));
    expect(types(recovered)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "alert.resolved",
      "incident.status_changed",
    ]);
    expect(recovered.events[2]?.data).toMatchObject({
      reason: "recovered",
      resolvedIncident: incident!.id,
    });
    expect(db.get("incidents", incident!.id)?.status).toBe("resolved");
    expect(evaluateQuery(incidentTimeline, { id: incident!.id }, db).slice(-2)).toMatchObject([
      { kind: "alert_resolved", monitorId: id, reason: "recovered" },
      { kind: "status_changed", to: "resolved", actor: "sys_alerts" },
    ]);
  });

  test("group with no open incident for its key opens one; a closed one is not joined", () => {
    const db = store();
    const first = createMonitor(db, "A");
    const second = createMonitor(db, "B");
    createRoute(
      db,
      { sourceIds: [ROUTE_ALL_MONITORS] },
      { ...OPEN, kind: "group", groupBy: "kind" },
      "By kind",
    );
    down(db, first);
    const incident = db.get("monitors", first)!.incidentId!;
    expect(db.get("monitors", first)?.alertRoute?.outcome).toBe("opened");
    // People close it; the next monitor of that kind opens a new incident rather than joining a closed one.
    ok(
      runMutation(
        mutations,
        "incident.setStatus",
        { id: incident, status: "resolved" },
        db,
        as("admin"),
      ),
    );
    down(db, second, T + 4000);
    expect(db.get("monitors", second)?.incidentId).not.toBe(incident);
    expect(db.get("incidents", db.get("monitors", second)!.incidentId!)?.status).toBe("triage");
  });
});

describe("fallbacks: a route that cannot be carried out still pages", () => {
  test("a deleted policy: the monitor's own policy pages, then the default", () => {
    const db = store();
    createPolicy(db, "Default", true);
    const own = createPolicy(db, "Monitor's own");
    const routed = createPolicy(db, "Gone");
    const id = createMonitor(db, "Checkout", undefined, own);
    createRoute(db, { sourceIds: [id] }, { ...OPEN, policyId: routed });
    ok(runMutation(mutations, "escalation.deletePolicy", { id: routed }, db, as("admin")));
    down(db, id);
    expect(incidentPolicy(db, db.get("monitors", id)!.incidentId!)).toMatchObject({
      policy: { id: own },
      monitor: { id },
    });
  });

  test("a deleted type or service is left out; the incident is still declared", () => {
    const db = store();
    const typeId = createType(db, "sev1");
    const serviceId = createService(db);
    const id = createMonitor(db, "Checkout", "sev3");
    createRoute(db, { sourceIds: [id] }, { ...OPEN, typeId, serviceIds: [serviceId] });
    ok(runMutation(mutations, "incidentType.delete", { id: typeId }, db, as("admin")));
    ok(runMutation(mutations, "service.delete", { id: serviceId }, db, as("admin")));
    expect(types(down(db, id))).toContain("incident.declared");
    const incident = db.get("incidents", db.get("monitors", id)!.incidentId!)!;
    // The type's severity went with it: the monitor's.
    expect(incident).toMatchObject({ severity: "sev3" });
    expect(incident).not.toHaveProperty("typeId");
    expect(incident).not.toHaveProperty("serviceIds");
  });

  test("a route whose declare is refused pages through the default, as monitors always have", () => {
    const db = store();
    const id = createMonitor(db, "Checkout", "sev3");
    // A route stored with something `incident.declare` refuses (written by hand, or by an older rule).
    db.insert("alert_routes", {
      id: newId("rte", T, random),
      name: "Broken",
      position: 0,
      match: { sourceIds: [ROUTE_ALL_MONITORS], severities: [], labels: [] },
      action: { ...OPEN, kind: "open", serviceIds: ["not-a-service"] },
      createdAt: T,
      createdBy: "usr_ana",
      updatedAt: T,
    });
    const result = ok(down(db, id));
    expect(types(result)).toEqual([
      "monitor.checked",
      "monitor.status_changed",
      "incident.declared",
      "alert.fired",
    ]);
    const monitor = db.get("monitors", id)!;
    expect(db.get("incidents", monitor.incidentId!)).toMatchObject({ severity: "sev3" });
    expect(db.get("alerts", monitor.alertId!)).not.toHaveProperty("outcome");
    expect(db.scan("incident_routes")).toEqual([]);
  });
});

describe("re-routing quiet monitor alerts", () => {
  test("deleting the suppress route that kept a down monitor quiet pages it now", () => {
    const db = store();
    const id = createMonitor(db);
    const route = createRoute(db, { sourceIds: [ROUTE_ALL_MONITORS] }, { kind: "suppress" });
    down(db, id);
    const quiet = db.get("monitors", id)!.alertId!;
    expect(monitorAlertsToReroute(db)).toEqual([]);
    ok(runMutation(mutations, "alertRoute.delete", { id: route }, db, as("admin")));
    expect(monitorAlertsToReroute(db).map((row) => row.id)).toEqual([quiet]);
    const result = ok(reroute(db, T + 5000));
    expect(types(result)).toEqual(["alert.resolved", "incident.declared", "alert.fired"]);
    expect(result.events[0]?.data).toEqual({
      quiet: true,
      id: quiet,
      monitorId: id,
      reason: "rerouted",
    });
    const monitor = db.get("monitors", id)!;
    expect(monitor.alertId).not.toBe(quiet);
    expect(monitor).toMatchObject({ status: "down", incidentId: expect.any(String) });
    expect(monitor.alertRoute).toBeNull();
    expect(db.get("incidents", monitor.incidentId!)).toMatchObject({
      title: "Checkout is down",
      declaredBy: "sys_monitors",
    });
    expect(db.get("alerts", quiet)).toMatchObject({ status: "resolved", resolvedAt: T + 5000 });
    // Done: nothing more to route, and a second run changes nothing.
    expect(monitorAlertsToReroute(db)).toEqual([]);
    expect(types(reroute(db, T + 6000))).toBe("conflict");
  });

  test("changing a drop route into one that opens pages the dropped monitor through it", () => {
    const db = store();
    const id = createMonitor(db);
    const route = createRoute(db, { sourceIds: [id] }, { kind: "drop" }, "Flaky");
    down(db, id);
    ok(
      runMutation(
        mutations,
        "alertRoute.update",
        {
          id: route,
          name: "Flaky",
          match: { sourceIds: [id], severities: [], labels: [] },
          action: { ...OPEN, severity: "sev1" },
        },
        db,
        as("admin"),
      ),
    );
    expect(types(reroute(db, T + 5000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
    const monitor = db.get("monitors", id)!;
    expect(db.get("incidents", monitor.incidentId!)?.severity).toBe("sev1");
    expect(monitor.alertRoute).toMatchObject({ id: route, outcome: "opened" });
  });

  test("a quiet monitor that recovered, or was paused, is not routed again", () => {
    const db = store();
    const recovered = createMonitor(db, "A");
    const paused = createMonitor(db, "B");
    const route = createRoute(db, { sourceIds: [ROUTE_ALL_MONITORS] }, { kind: "suppress" });
    down(db, recovered);
    down(db, paused, T + 4000);
    ok(report(db, recovered, true, T + 5000));
    ok(runMutation(mutations, "monitor.setPaused", { id: paused, paused: true }, db, as("admin")));
    ok(runMutation(mutations, "alertRoute.delete", { id: route }, db, as("admin")));
    expect(monitorAlertsToReroute(db)).toEqual([]);
    expect(db.scan("incidents")).toEqual([]);
  });

  test("a route still as quiet leaves it alone; only the alerts' actor routes again", () => {
    const db = store();
    const id = createMonitor(db);
    createRoute(db, { sourceIds: [ROUTE_ALL_MONITORS] }, { kind: "suppress" });
    down(db, id);
    // Another quiet route added above it: still quiet.
    const drop = createRoute(db, { sourceIds: [id] }, { kind: "drop" });
    ok(runMutation(mutations, "alertRoute.move", { id: drop, position: 0 }, db, as("admin")));
    expect(types(reroute(db, T + 5000))).toBe("conflict");
    expect(
      types(
        runMutation(serverMutations, "alert.reroute", { rows: [] }, db, {
          ...alerts(T),
          actor: MONITOR_ACTOR,
        }),
      ),
    ).toBe("forbidden");
  });
});

describe("grouping a monitor onto an incident", () => {
  const grafanaAlert = (status: "firing" | "resolved"): NormalizedAlert => ({
    dedupKey: "checkout-latency",
    title: "Checkout is slow",
    severity: "warning",
    status,
    link: null,
    labels: { monitor: "Checkout" },
  });

  /** A Grafana alert opens the group's incident; returns it, the source and a monitor that groups onto it. */
  function grouped(db: Db, policyId?: string) {
    const source = createSource(db);
    const id = createMonitor(db, "Checkout", undefined, policyId);
    createRoute(
      db,
      { sourceIds: [source, ROUTE_ALL_MONITORS] },
      { ...OPEN, kind: "group", groupBy: "monitor" },
      "By monitor",
    );
    ok(ingest(db, source, grafanaAlert("firing"), T + 1000));
    const [incident] = db.scan("incidents");
    return { source, id, incident: incident!.id };
  }

  test("an alert source's alert grouped onto an incident is said on its timeline", () => {
    const db = store();
    const { source, incident } = grouped(db);
    ok(
      ingest(
        db,
        source,
        { ...grafanaAlert("firing"), dedupKey: "checkout-errors", title: "Checkout errors" },
        T + 2000,
      ),
    );
    expect(
      evaluateQuery(incidentTimeline, { id: incident }, db).filter(
        (entry) => entry.kind === "alert_grouped",
      ),
    ).toEqual([
      expect.objectContaining({ sourceId: source, name: "Checkout errors", actor: "sys_alerts" }),
    ]);
  });

  test.each(["acknowledged", "monitoring"] as const)(
    "a monitor that goes down while the group's incident is %s opens its own incident, which pages",
    (taken) => {
      const db = store();
      const { id, incident } = grouped(db);
      if (taken === "acknowledged") {
        ok(runMutation(mutations, "incident.ack", { id: incident }, db, as("responder", T + 1500)));
      } else {
        ok(
          runMutation(
            mutations,
            "incident.setStatus",
            { id: incident, status: "monitoring" },
            db,
            as("responder", T + 1500),
          ),
        );
      }
      const result = ok(down(db, id, T + 3000));
      // Not silent: a new incident, whose declaration pages (apps/api `asksForPage`).
      expect(types(result)).toEqual([
        "monitor.checked",
        "monitor.status_changed",
        "incident.declared",
        "alert.fired",
      ]);
      const monitor = db.get("monitors", id)!;
      expect(monitor.incidentId).not.toBe(incident);
      expect(monitor.alertRoute).toMatchObject({ outcome: "opened" });
      // The group keeps its incident: the new one holds no group key.
      expect(db.get("alerts", monitor.alertId!)).toMatchObject({ groupKey: null });
      expect(
        evaluateQuery(incidentTimeline, { id: incident }, db).some(
          (entry) => entry.kind === "alert_grouped",
        ),
      ).toBe(false);
    },
  );

  test("a grouped monitor's policy never pages the incident an alert source opened", () => {
    const db = store();
    const policy = createPolicy(db, "Checkout on-call");
    const fallback = createPolicy(db, "Default", true);
    const { id, incident } = grouped(db, policy);
    ok(down(db, id, T + 3000));
    expect(db.get("monitors", id)?.incidentId).toBe(incident);
    expect(incidentPolicy(db, incident)).toMatchObject({ policy: { id: fallback }, monitor: null });
  });
});

describe("closing an incident a down monitor is on", () => {
  const close = (db: Db, incident: string, at: number) =>
    ok(
      runMutation(
        mutations,
        "incident.setStatus",
        { id: incident, status: "resolved" },
        db,
        as("responder", at),
      ),
    );

  test("the monitor it opened lets go of its alert and alerts again at its next report", () => {
    const db = store();
    const id = createMonitor(db);
    ok(down(db, id));
    const first = db.get("monitors", id)!;
    const result = close(db, first.incidentId!, T + 3000);
    expect(types(result)).toEqual(["incident.status_changed", "alert.resolved"]);
    expect(result.events[1]?.data).toEqual({
      id: first.alertId,
      monitorId: id,
      reason: "incident_closed",
    });
    expect(db.get("monitors", id)).toMatchObject({
      status: "down",
      alertId: null,
      incidentId: null,
    });
    expect(db.get("alerts", first.alertId!)).toMatchObject({ status: "resolved" });
    // Still down: its next report alerts again (no status change), and the new incident pages.
    expect(types(report(db, id, false, T + 4000))).toEqual(["incident.declared", "alert.fired"]);
    const again = db.get("monitors", id)!;
    expect(again.incidentId).not.toBe(first.incidentId);
    expect(again.alertId).not.toBe(first.alertId);
    // And once it fires again, the next report changes nothing.
    expect(types(report(db, id, false, T + 5000))).toEqual([]);
  });

  test("a monitor grouped onto it lets go too, and alerts again through its route", () => {
    const db = store();
    const source = createSource(db);
    const id = createMonitor(db, "Checkout");
    createRoute(
      db,
      { sourceIds: [source, ROUTE_ALL_MONITORS] },
      { ...OPEN, kind: "group", groupBy: "monitor" },
      "By monitor",
    );
    ok(
      ingest(
        db,
        source,
        {
          dedupKey: "checkout-latency",
          title: "Checkout is slow",
          severity: "warning",
          status: "firing",
          link: null,
          labels: { monitor: "Checkout" },
        },
        T + 1000,
      ),
    );
    ok(down(db, id, T + 2000));
    const incident = db.get("monitors", id)!.incidentId!;
    expect(db.get("monitors", id)?.alertRoute?.outcome).toBe("grouped");
    expect(types(close(db, incident, T + 3000))).toEqual([
      "incident.status_changed",
      "alert.resolved",
      "alert.resolved",
    ]);
    expect(db.get("monitors", id)).toMatchObject({
      alertId: null,
      incidentId: null,
      alertRoute: null,
    });
    expect(types(report(db, id, false, T + 4000))).toEqual(["incident.declared", "alert.fired"]);
    expect(db.get("monitors", id)).toMatchObject({ alertRoute: { outcome: "opened" } });
    expect(db.get("monitors", id)?.incidentId).not.toBe(incident);
  });
});
