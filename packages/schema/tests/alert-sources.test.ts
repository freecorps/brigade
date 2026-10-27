import { describe, expect, test } from "vite-plus/test";
import {
  ACCOUNT_ACTOR,
  ALERTS_ACTOR,
  alertSourceToken,
  createMemoryStore,
  runQuery,
  fitLink,
  fitText,
  ALERT_IDLE_TTL_MS,
  ALERT_KEY_MAX,
  EARLY_RESOLVE_TTL_MS,
  FLAP_WINDOW_MS,
  MAX_ALERT_ROUTES,
  MAX_ALERT_SOURCES,
  MAX_OPEN_ALERTS,
  mutations,
  newId,
  normalizeAlerts,
  parseAlertSourceToken,
  pickRoute,
  queries,
  quietAlerts,
  alertIssues,
  runMutation,
  serverMutations,
  startEscalation,
  type AlertHeaders,
  type AlertSourceKind,
  type BrigadeTables,
  type MemoryStore,
  type MutationContext,
  type MutationResult,
  type NormalizedAlert,
  type Role,
} from "../src/index.ts";
import datadogDefault from "./fixtures/alerts/datadog-default.json" with { type: "json" };
import datadogDefaultRecovered from "./fixtures/alerts/datadog-default-recovered.json" with { type: "json" };
import datadogWarn from "./fixtures/alerts/datadog-warn.json" with { type: "json" };
import datadogRecovered from "./fixtures/alerts/datadog-recovered.json" with { type: "json" };
import datadogTriggered from "./fixtures/alerts/datadog-triggered.json" with { type: "json" };
import generic from "./fixtures/alerts/generic.json" with { type: "json" };
import grafanaFiring from "./fixtures/alerts/grafana-firing.json" with { type: "json" };
import grafanaResolved from "./fixtures/alerts/grafana-resolved.json" with { type: "json" };
import sentryEvent from "./fixtures/alerts/sentry-event-alert.json" with { type: "json" };
import sentryCritical from "./fixtures/alerts/sentry-metric-critical.json" with { type: "json" };
import sentryResolved from "./fixtures/alerts/sentry-metric-resolved.json" with { type: "json" };
import sentryWarning from "./fixtures/alerts/sentry-metric-warning.json" with { type: "json" };

const T = Date.UTC(2026, 9, 27, 12, 0, 0);
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const HASH = "a".repeat(64);

const as = (role: Role, now = T): MutationContext => ({
  actor: { kind: "user", id: "usr_ana", role },
  now,
  server: true,
});
const intake = (now = T): MutationContext => ({ actor: ALERTS_ACTOR, now, server: true });
const store = () => createMemoryStore<BrigadeTables>();
const types = (result: MutationResult) =>
  result.ok ? result.events.map((event) => event.type) : result.error.code;

const normalize = (kind: AlertSourceKind, body: unknown, headers: AlertHeaders = {}) =>
  normalizeAlerts(kind, JSON.stringify(body), headers);

function alertsOf(kind: AlertSourceKind, body: unknown, headers: AlertHeaders = {}) {
  const result = normalize(kind, body, headers);
  if (result.kind !== "alerts") throw new Error(`Expected alerts, got ${JSON.stringify(result)}`);
  return result.alerts;
}

function createSource(db: MemoryStore<BrigadeTables>, kind: AlertSourceKind = "grafana") {
  const id = newId("src", T, random);
  const result = runMutation(
    mutations,
    "alertSource.create",
    {
      id,
      name: "Grafana",
      kind,
      tokenHash: HASH,
      auth: null,
      signingSecret: kind === "sentry" ? "client-secret-1" : null,
    },
    db,
    as("admin"),
  );
  expect(result.ok).toBe(true);
  return id;
}

function createRoute(
  db: MemoryStore<BrigadeTables>,
  match: object,
  action: object,
  name = "Route",
) {
  const id = newId("rte", T, random);
  const result = runMutation(
    mutations,
    "alertRoute.create",
    {
      id,
      name,
      match: { sourceIds: [], severities: [], labels: [], ...match },
      action,
    },
    db,
    as("admin"),
  );
  expect(result.ok).toBe(true);
  return id;
}

function ingest(
  db: MemoryStore<BrigadeTables>,
  sourceId: string,
  alerts: NormalizedAlert[],
  now = T + 1000,
  malformed = false,
) {
  return runMutation(
    serverMutations,
    "alert.ingest",
    {
      sourceId,
      malformed,
      alerts: alerts.map((alert) => ({
        alert,
        alertId: newId("alt", now, random),
        incidentId: newId("inc", now, random),
      })),
    },
    db,
    intake(now),
  );
}

const firing = (overrides: Partial<NormalizedAlert> = {}): NormalizedAlert => ({
  dedupKey: "checkout-5xx",
  title: "Checkout returns 5xx",
  severity: "high",
  status: "firing",
  link: "https://status.example.com/checks/checkout",
  labels: { service: "checkout" },
  ...overrides,
});

const incidents = (db: MemoryStore<BrigadeTables>) => db.scan("incidents");
const alertRows = (db: MemoryStore<BrigadeTables>) => db.scan("source_alerts");

describe("normalizing provider payloads", () => {
  test("Grafana: one alert per entry, keyed by fingerprint", () => {
    const alerts = alertsOf("grafana", grafanaFiring);
    expect(alerts).toEqual([
      {
        dedupKey: "c6eadffa33fcdf37",
        title: "This alert was triggered for zone us-1",
        severity: "critical",
        providerSeverity: "critical",
        status: "firing",
        link: "https://grafana.example.com/alerting/1afz29v7z/edit",
        labels: {
          alertname: "High memory usage",
          team: "blue",
          zone: "us-1",
          severity: "critical",
        },
        at: Date.UTC(2026, 9, 27, 12, 0, 0),
      },
      {
        dedupKey: "bc97ff14869b13e3",
        title: "This alert was triggered for zone eu-1",
        severity: "high",
        status: "firing",
        link: "https://grafana.example.com/d/abc?viewPanel=2",
        labels: { alertname: "High CPU usage", team: "blue", zone: "eu-1" },
        at: Date.UTC(2026, 9, 27, 12, 0, 0),
      },
    ]);
    // Resolved: when it ended. Grafana's "no time" (year 1) is no time at all.
    expect(alertsOf("grafana", grafanaResolved)).toMatchObject([
      { dedupKey: "c6eadffa33fcdf37", status: "resolved", at: Date.UTC(2026, 9, 27, 12, 30, 0) },
    ]);
    const [unset] = alertsOf("grafana", {
      ...grafanaFiring,
      alerts: [{ ...grafanaFiring.alerts[0], startsAt: "0001-01-01T00:00:00Z" }],
    });
    expect(unset).not.toHaveProperty("at");
  });

  test("Datadog: keyed by monitor and group, the transition and the priority", () => {
    expect(alertsOf("datadog", datadogTriggered)).toEqual([
      {
        dedupKey: "datadog:1234:host:web-1",
        title: "[Triggered on {host:web-1}] Checkout latency is high",
        severity: "critical",
        providerSeverity: "P1",
        status: "firing",
        link: "https://app.datadoghq.example.com/event/event?id=5678",
        labels: { env: "prod", service: "checkout", team: "payments" },
      },
    ]);
    expect(alertsOf("datadog", datadogRecovered)).toMatchObject([
      { dedupKey: "datadog:1234:host:web-1", status: "resolved" },
    ]);
    // A Warn is a warning whatever the monitor's priority, so its Triggered raises it.
    expect(alertsOf("datadog", datadogWarn)).toMatchObject([
      { dedupKey: "datadog:1234:host:web-1", status: "firing", severity: "warning" },
    ]);
    // Each group of a multi-alert monitor is its own alert, though they share the monitor and the aggregate key.
    expect(
      alertsOf("datadog", {
        ...datadogTriggered,
        scope: "host:web-2",
        title: "[Triggered on {host:web-2}] x",
      }),
    ).toMatchObject([{ dedupKey: "datadog:1234:host:web-2" }]);
    // The scope from the title's bracket when the payload has no `scope`, in either form.
    const { scope: _scope, ...unscoped } = datadogTriggered;
    expect(alertsOf("datadog", unscoped)).toMatchObject([{ dedupKey: "datadog:1234:host:web-1" }]);
    // Datadog's own default payload: the title's bracket says the transition, and keys it with the title, since `id`
    // is new on every notification. Its Recovered resolves the alert its Triggered opened.
    const [fired] = alertsOf("datadog", datadogDefault);
    const [recovered] = alertsOf("datadog", datadogDefaultRecovered);
    expect(fired).toMatchObject({ status: "firing", severity: "high" });
    expect(recovered).toMatchObject({ status: "resolved", dedupKey: fired!.dedupKey });
    expect(fired!.dedupKey).not.toContain("7654321");
    // Fitted after prefixing: a long key stays within ALERT_KEY_MAX, and two that share their start stay apart.
    const long = (end: string) =>
      alertsOf("datadog", {
        ...datadogTriggered,
        alert_id: "",
        aggregate: `${"a".repeat(300)}${end}`,
      })[0]!.dedupKey;
    expect(long("1").length).toBeLessThanOrEqual(ALERT_KEY_MAX);
    expect(long("1")).not.toBe(long("2"));
  });

  test("Sentry: issue alerts by issue id, metric alerts by their id", () => {
    expect(alertsOf("sentry", sentryEvent, { "sentry-hook-resource": "event_alert" })).toEqual([
      {
        dedupKey: "sentry:issue:1117540176",
        title: "ReferenceError: heck is not defined",
        severity: "high",
        providerSeverity: "error",
        status: "firing",
        link: "https://sentry.example.com/organizations/example/issues/1117540176/events/e4874d664c3540c1a32eab185f12c5ab/",
        labels: { browser: "Chrome 75.0.3770", level: "error", handled: "no" },
      },
    ]);
    expect(
      alertsOf("sentry", sentryCritical, { "sentry-hook-resource": "metric_alert" }),
    ).toMatchObject([
      {
        dedupKey: "sentry:metric:7",
        title: "Critical: Too many errors",
        severity: "critical",
        status: "firing",
      },
    ]);
    expect(
      alertsOf("sentry", sentryResolved, { "sentry-hook-resource": "metric_alert" }),
    ).toMatchObject([{ dedupKey: "sentry:metric:7", status: "resolved" }]);
    expect(
      normalize(
        "sentry",
        { action: "created", data: {} },
        { "sentry-hook-resource": "installation" },
      ),
    ).toEqual({
      kind: "ignored",
    });
  });

  test("generic: Brigade's own shape", () => {
    expect(alertsOf("generic", generic)).toEqual([
      {
        dedupKey: "checkout-5xx",
        title: "Checkout returns 5xx",
        severity: "critical",
        providerSeverity: "critical",
        status: "firing",
        link: "https://status.example.com/checks/checkout",
        labels: { service: "checkout", env: "prod" },
      },
    ]);
    expect(alertsOf("generic", { title: "Disk full" })).toMatchObject([
      { dedupKey: "Disk full", severity: "high", status: "firing", link: null },
    ]);
  });

  test("a payload with no readable alert is malformed, never nothing", () => {
    expect(normalizeAlerts("grafana", "not json", {})).toEqual({
      kind: "malformed",
      reason: "not_json",
    });
    expect(normalize("grafana", { alerts: [] })).toMatchObject({ kind: "malformed" });
    expect(normalize("grafana", { alerts: [{ labels: {} }] })).toMatchObject({ kind: "malformed" });
    expect(normalize("generic", [1, 2])).toMatchObject({ kind: "malformed" });
    expect(normalize("generic", { severity: "critical" })).toMatchObject({ kind: "malformed" });
    expect(normalize("sentry", sentryEvent)).toMatchObject({
      kind: "malformed",
      reason: "no_resource",
    });
  });

  test("sender text is fitted: hidden characters go, links must be http(s)", () => {
    const bell = String.fromCharCode(7);
    const rtl = String.fromCharCode(0x202e);
    expect(fitText(`  Disk${bell} full${rtl}  on   web-1 `, 200)).toBe("Disk full on web-1");
    expect(fitText(bell, 200)).toBeUndefined();
    expect(fitText("x".repeat(500), 200)).toHaveLength(200);
    expect(fitLink("javascript:alert(1)")).toBeNull();
    expect(fitLink("https://user:pw@example.com/")).toBeNull();
    expect(fitLink("https://example.com/a")).toBe("https://example.com/a");
    expect(alertsOf("generic", { title: "A", link: "data:text/html,hi" })[0]!.link).toBeNull();
  });
});

describe("alert sources", () => {
  test("owners and admins manage them; everyone reads them, never their secrets", () => {
    const db = store();
    const args = {
      id: newId("src", T, random),
      name: "Grafana",
      kind: "grafana",
      tokenHash: HASH,
      auth: { headerName: "Authorization", headerHash: "b".repeat(64) },
      signingSecret: null,
    };
    expect(types(runMutation(mutations, "alertSource.create", args, db, as("responder")))).toBe(
      "forbidden",
    );
    expect(types(runMutation(mutations, "alertSource.create", args, db, as("admin")))).toEqual([
      "alert_source.created",
    ]);
    expect(db.get("alert_sources", args.id)).toMatchObject({
      headerName: "authorization",
      signed: false,
    });
    expect(db.get("alert_source_secrets", args.id)).toEqual({
      id: args.id,
      tokenHash: HASH,
      headerHash: "b".repeat(64),
      signingSecret: null,
    });
    expect(runQuery(queries, "alertSources.all", {}, db, "viewer")).toMatchObject({
      ok: true,
      rows: [{ id: args.id }],
    });
  });

  test("Sentry needs its client secret; only Sentry and Grafana sign", () => {
    const db = store();
    const base = { name: "S", tokenHash: HASH, auth: null };
    const create = (kind: string, signingSecret: string | null) =>
      runMutation(
        mutations,
        "alertSource.create",
        { ...base, id: newId("src", T, random), kind, signingSecret },
        db,
        as("owner"),
      );
    expect(types(create("sentry", null))).toBe("invalid_args");
    expect(types(create("datadog", "secret-123"))).toBe("invalid_args");
    expect(types(create("grafana", "secret-123"))).toEqual(["alert_source.created"]);
  });

  test("at most MAX_ALERT_SOURCES", () => {
    const db = store();
    for (let i = 0; i < MAX_ALERT_SOURCES; i++) createSource(db);
    const result = runMutation(
      mutations,
      "alertSource.create",
      {
        id: newId("src", T, random),
        name: "One more",
        kind: "generic",
        tokenHash: HASH,
        auth: null,
        signingSecret: null,
      },
      db,
      as("admin"),
    );
    expect(types(result)).toBe("limit_reached");
  });

  test("rotating replaces the hash; deleting resolves its firing alerts and keeps the incidents", () => {
    const db = store();
    const source = createSource(db);
    expect(
      types(
        runMutation(
          mutations,
          "alertSource.rotate",
          { id: source, tokenHash: "c".repeat(64) },
          db,
          as("admin"),
        ),
      ),
    ).toEqual(["alert_source.rotated"]);
    expect(db.get("alert_source_secrets", source)?.tokenHash).toBe("c".repeat(64));
    ingest(db, source, [firing()]);
    expect(
      types(runMutation(mutations, "alertSource.delete", { id: source }, db, as("admin"))),
    ).toEqual(["alert_source.deleted", "alert.resolved"]);
    expect(db.get("alert_source_secrets", source)).toBeUndefined();
    expect(alertRows(db)[0]).toMatchObject({ status: "resolved" });
    expect(incidents(db)[0]).toMatchObject({ status: "triage" });
  });

  test("a takeover revokes every source URL, only as the account actor", () => {
    const db = store();
    const first = createSource(db);
    const second = createSource(db, "generic");
    const revoke = "d".repeat(64);
    expect(
      types(
        runMutation(
          serverMutations,
          "alertSource.takeOver",
          { tokenHash: revoke },
          db,
          as("owner"),
        ),
      ),
    ).toBe("forbidden");
    const account = { actor: ACCOUNT_ACTOR, now: T, server: true };
    expect(
      types(
        runMutation(serverMutations, "alertSource.takeOver", { tokenHash: revoke }, db, account),
      ),
    ).toEqual(["alert_source.revoked", "alert_source.revoked"]);
    expect(db.get("alert_source_secrets", first)?.tokenHash).toBe(revoke);
    expect(db.get("alert_source_secrets", second)?.tokenHash).toBe(revoke);
    expect(
      types(
        runMutation(serverMutations, "alertSource.takeOver", { tokenHash: revoke }, db, account),
      ),
    ).toBe("conflict");
  });

  test("tokens name the workspace and the source", () => {
    const source = newId("src", T, random);
    const secret = "A".repeat(43);
    const token = alertSourceToken("ws_x", source, secret);
    expect(parseAlertSourceToken(token)).toEqual({ workspaceId: "ws_x", sourceId: source, secret });
    expect(parseAlertSourceToken(`ws_x.${source}.short`)).toBeUndefined();
    expect(parseAlertSourceToken(`ws_x.mon_x.${secret}`)).toBeUndefined();
  });
});

describe("ingesting alerts", () => {
  test("a new firing alert opens one incident through the default route, as sys_alerts", () => {
    const db = store();
    const source = createSource(db);
    const result = ingest(db, source, [firing({ severity: "critical" })]);
    expect(types(result)).toEqual(["incident.declared", "alert.fired"]);
    const [incident] = incidents(db);
    expect(incident).toMatchObject({
      title: "Checkout returns 5xx",
      severity: "sev1",
      declaredBy: "sys_alerts",
    });
    expect(alertRows(db)[0]).toMatchObject({
      status: "firing",
      outcome: "opened",
      reason: "default",
      routeId: null,
      incidentId: incident!.id,
    });
  });

  test("a dedup storm pages once: repeats update the alert, with no event", () => {
    const db = store();
    const source = createSource(db);
    expect(types(ingest(db, source, [firing()]))).toEqual(["incident.declared", "alert.fired"]);
    for (let i = 0; i < 50; i++) {
      const result = ingest(
        db,
        source,
        [firing({ title: `Checkout returns 5xx (${i})` })],
        T + 2000 + i,
      );
      expect(types(result)).toEqual([]);
    }
    expect(incidents(db)).toHaveLength(1);
    expect(alertRows(db)).toHaveLength(1);
    expect(alertRows(db)[0]).toMatchObject({ repeats: 50, title: "Checkout returns 5xx (49)" });
  });

  test("the same payload with two alerts of one key opens one incident", () => {
    const db = store();
    const source = createSource(db);
    expect(types(ingest(db, source, [firing(), firing()]))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    expect(incidents(db)).toHaveLength(1);
  });

  test("resolved resolves the alert, and the incident once every alert on it is resolved", () => {
    const db = store();
    const source = createSource(db);
    createRoute(
      db,
      {},
      {
        kind: "group",
        groupBy: "service",
        severity: null,
        typeId: null,
        serviceIds: [],
        policyId: null,
      },
    );
    ingest(db, source, [firing({ dedupKey: "a" }), firing({ dedupKey: "b" })]);
    expect(incidents(db)).toHaveLength(1);
    expect(
      types(ingest(db, source, [firing({ dedupKey: "a", status: "resolved" })], T + 5000)),
    ).toEqual(["alert.resolved"]);
    expect(incidents(db)[0]!.status).toBe("triage");
    expect(
      types(ingest(db, source, [firing({ dedupKey: "b", status: "resolved" })], T + 6000)),
    ).toEqual(["alert.resolved", "incident.status_changed"]);
    expect(incidents(db)[0]!.status).toBe("resolved");
    // A resolve for an alert never seen firing is nothing.
    expect(
      types(ingest(db, source, [firing({ dedupKey: "zzz", status: "resolved" })], T + 7000)),
    ).toEqual([]);
  });

  test("a key whose incident people closed fires afresh", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    const [first] = incidents(db);
    runMutation(
      mutations,
      "incident.setStatus",
      { id: first!.id, status: "resolved" },
      db,
      as("responder"),
    );
    // Closing the incident already let its alert go.
    expect(alertRows(db)[0]!.status).toBe("closed");
    expect(types(ingest(db, source, [firing()], T + 9000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    expect(incidents(db)).toHaveLength(2);
  });

  test("a malformed payload goes straight to the default route, even past a drop-everything route", () => {
    const db = store();
    const source = createSource(db);
    createRoute(db, {}, { kind: "drop" }, "Drop all");
    const malformed = firing({
      dedupKey: "malformed",
      title: "Unreadable alert from Grafana",
      labels: {},
    });
    expect(types(ingest(db, source, [malformed], T + 1000, true))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    expect(alertRows(db)[0]).toMatchObject({ outcome: "opened", reason: "malformed" });
    // A storm of malformed payloads is one alert.
    expect(types(ingest(db, source, [malformed], T + 2000, true))).toEqual([]);
    expect(incidents(db)).toHaveLength(1);
  });

  test("an unmatched alert still opens through the default", () => {
    const db = store();
    const source = createSource(db);
    createRoute(db, { labels: [{ key: "team", value: "search" }] }, { kind: "drop" });
    expect(types(ingest(db, source, [firing()]))).toEqual(["incident.declared", "alert.fired"]);
    expect(alertRows(db)[0]).toMatchObject({ outcome: "opened", reason: "default" });
  });

  test("a dropped alert records which route dropped it, and pages nobody", () => {
    const db = store();
    const source = createSource(db);
    const route = createRoute(db, { severities: ["info"] }, { kind: "drop" }, "Ignore info");
    const result = ingest(db, source, [firing({ severity: "info" })]);
    expect(result).toMatchObject({
      ok: true,
      events: [{ type: "alert.dropped", data: { routeId: route, routeName: "Ignore info" } }],
    });
    expect(incidents(db)).toHaveLength(0);
    expect(alertRows(db)[0]).toMatchObject({
      outcome: "dropped",
      routeId: route,
      routeName: "Ignore info",
    });
    // Once no route drops it, the same key pages.
    runMutation(mutations, "alertRoute.delete", { id: route }, db, as("admin"));
    expect(types(ingest(db, source, [firing({ severity: "info" })], T + 3000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("suppress keeps the alert without an incident", () => {
    const db = store();
    const source = createSource(db);
    createRoute(db, { sourceIds: [source] }, { kind: "suppress" });
    expect(types(ingest(db, source, [firing()]))).toEqual(["alert.fired"]);
    expect(alertRows(db)[0]).toMatchObject({ outcome: "suppressed", incidentId: null });
    expect(incidents(db)).toHaveLength(0);
  });

  test("routes are tried in order; the first match wins and sets severity", () => {
    const db = store();
    const source = createSource(db);
    const second = createRoute(
      db,
      {},
      { kind: "open", severity: "sev3", typeId: null, serviceIds: [], policyId: null },
      "Everything",
    );
    const first = createRoute(
      db,
      { labels: [{ key: "service", value: "checkout" }] },
      { kind: "open", severity: "sev1", typeId: null, serviceIds: [], policyId: null },
      "Checkout",
    );
    expect(
      runMutation(mutations, "alertRoute.move", { id: first, position: 0 }, db, as("admin")).ok,
    ).toBe(true);
    expect(db.get("alert_routes", first)?.position).toBe(0);
    expect(db.get("alert_routes", second)?.position).toBe(1);
    ingest(db, source, [firing()]);
    expect(incidents(db)[0]).toMatchObject({ severity: "sev1" });
    expect(alertRows(db)[0]).toMatchObject({ routeId: first, reason: "matched" });
  });

  test("a route declares its incidents with its type and services, the type's severity by default", () => {
    const db = store();
    const source = createSource(db);
    const typeId = newId("typ", T, random);
    const serviceId = newId("svc", T, random);
    expect(
      runMutation(
        mutations,
        "incidentType.create",
        {
          id: typeId,
          name: "Payments outage",
          description: "",
          defaultSeverity: "sev1",
          escalationPolicyId: null,
          requiredFields: [],
        },
        db,
        as("admin"),
      ).ok,
    ).toBe(true);
    expect(
      runMutation(
        mutations,
        "service.create",
        {
          id: serviceId,
          name: "Checkout",
          description: "",
          tier: "tier1",
          owners: [],
          escalationPolicyId: null,
        },
        db,
        as("admin"),
      ).ok,
    ).toBe(true);
    const missing = runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "R",
        match: { sourceIds: [], severities: [], labels: [] },
        action: {
          kind: "open",
          severity: null,
          typeId: newId("typ", T, random),
          serviceIds: [],
          policyId: null,
        },
      },
      db,
      as("admin"),
    );
    expect(missing).toMatchObject({ ok: false, error: { issues: [{ path: "action.typeId" }] } });
    createRoute(
      db,
      {},
      { kind: "open", severity: null, typeId, serviceIds: [serviceId], policyId: null },
    );
    ingest(db, source, [firing({ severity: "warning" })]);
    expect(incidents(db)[0]).toMatchObject({ severity: "sev1", typeId, serviceIds: [serviceId] });
  });

  test("group attaches alerts of one label value to one open incident", () => {
    const db = store();
    const source = createSource(db);
    createRoute(
      db,
      {},
      {
        kind: "group",
        groupBy: "service",
        severity: null,
        typeId: null,
        serviceIds: [],
        policyId: null,
      },
    );
    ingest(db, source, [firing({ dedupKey: "a" }), firing({ dedupKey: "b" })]);
    ingest(db, source, [firing({ dedupKey: "c", labels: { service: "search" } })], T + 2000);
    expect(incidents(db)).toHaveLength(2);
    expect(
      alertRows(db)
        .map((row) => row.outcome)
        .sort(),
    ).toEqual(["grouped", "opened", "opened"]);
  });

  test("past MAX_OPEN_ALERTS the oldest suppressed alert makes room: a new one is never refused", () => {
    const db = store();
    const source = createSource(db);
    createRoute(db, { severities: ["info"] }, { kind: "suppress" });
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) =>
        firing({ dedupKey: `k${i + j}`, severity: "info" }),
      );
      expect(ingest(db, source, batch, T + 1000 + i).ok).toBe(true);
    }
    expect(types(ingest(db, source, [firing({ dedupKey: "one-more" })], T + 5000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
    // One of the oldest (the first batch) went, and only one.
    const closed = alertRows(db).filter((row) => row.status === "closed");
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({ outcome: "suppressed", lastSeenAt: T + 1000 });
  });

  test("only the alerts' actor ingests, and members cannot send it", () => {
    const db = store();
    const source = createSource(db);
    const args = {
      sourceId: source,
      malformed: false,
      alerts: [
        { alert: firing(), alertId: newId("alt", T, random), incidentId: newId("inc", T, random) },
      ],
    };
    expect(types(runMutation(mutations, "alert.ingest", args, db, as("owner")))).toBe(
      "unknown_mutation",
    );
    expect(types(runMutation(serverMutations, "alert.ingest", args, db, as("owner")))).toBe(
      "forbidden",
    );
  });
});

describe("alerts that must still page", () => {
  const critical = (overrides: Partial<NormalizedAlert> = {}) =>
    firing({ dedupKey: "db-down", title: "Database down", severity: "critical", ...overrides });
  const close = (db: MemoryStore<BrigadeTables>, id: string, status = "resolved") =>
    runMutation(mutations, "incident.setStatus", { id, status }, db, as("responder"));
  const reroute = (db: MemoryStore<BrigadeTables>, now = T + 1000) =>
    runMutation(
      serverMutations,
      "alert.reroute",
      {
        rows: quietAlerts(db).map((row) => ({
          rowId: row.id,
          alertId: newId("alt", now, random),
          incidentId: newId("inc", now, random),
        })),
      },
      db,
      intake(now),
    );

  test("200 closed incidents, then a new critical alert still pages", () => {
    const db = store();
    const source = createSource(db);
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) => firing({ dedupKey: `k${i + j}` }));
      expect(ingest(db, source, batch).ok).toBe(true);
    }
    for (const incident of incidents(db)) expect(close(db, incident.id).ok).toBe(true);
    expect(alertRows(db).every((row) => row.status === "closed")).toBe(true);
    const result = ingest(db, source, [critical()], T + 2000);
    expect(types(result)).toEqual(["incident.declared", "alert.fired"]);
    expect(incidents(db).find((one) => one.title === "Database down")?.severity).toBe("sev1");
  });

  test("with every firing alert holding an open incident, a new one pages as the one capacity alert", () => {
    const db = store();
    const source = createSource(db);
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) => firing({ dedupKey: `k${i + j}` }));
      expect(ingest(db, source, batch).ok).toBe(true);
    }
    expect(types(ingest(db, source, [firing({ dedupKey: "x1" })], T + 2000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    const capacity = alertRows(db).find((row) => row.reason === "capacity");
    expect(capacity).toMatchObject({ outcome: "opened", title: "Alert capacity reached" });
    // Another one past the cap is a repeat of it, except that a critical one raises it.
    expect(types(ingest(db, source, [firing({ dedupKey: "x2" })], T + 3000))).toEqual([]);
    expect(types(ingest(db, source, [critical()], T + 4000))).toEqual([
      "incident.severity_changed",
    ]);
    expect(incidents(db)).toHaveLength(MAX_OPEN_ALERTS + 1);
  });

  test("a suppressed alert not sent for ALERT_IDLE_TTL_MS expires", () => {
    const db = store();
    const source = createSource(db);
    createRoute(db, {}, { kind: "suppress" });
    ingest(db, source, [firing()]);
    expect(
      types(ingest(db, source, [firing({ dedupKey: "other" })], T + 1000 + ALERT_IDLE_TTL_MS)),
    ).toEqual(["alert.resolved", "alert.fired"]);
    expect(alertRows(db).find((row) => row.dedupKey === "checkout-5xx")?.status).toBe("closed");
  });

  test("Datadog: a suppressed Warn that becomes Triggered is routed and pages", () => {
    const db = store();
    const source = createSource(db, "datadog");
    createRoute(db, { severities: ["warning"] }, { kind: "suppress" }, "Quiet warnings");
    expect(types(ingest(db, source, alertsOf("datadog", datadogWarn)))).toEqual(["alert.fired"]);
    expect(types(ingest(db, source, alertsOf("datadog", datadogTriggered), T + 2000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
    expect(incidents(db)[0]?.severity).toBe("sev1");
  });

  test("Datadog: an open Warn's incident is raised when it becomes Triggered", () => {
    const db = store();
    const source = createSource(db, "datadog");
    ingest(db, source, alertsOf("datadog", datadogWarn));
    expect(incidents(db)[0]?.severity).toBe("sev3");
    expect(types(ingest(db, source, alertsOf("datadog", datadogTriggered), T + 2000))).toEqual([
      "incident.severity_changed",
    ]);
    expect(incidents(db)[0]?.severity).toBe("sev1");
    // Never lowered: a Warn again leaves it at SEV1.
    expect(types(ingest(db, source, alertsOf("datadog", datadogWarn), T + 3000))).toEqual([]);
    expect(incidents(db)[0]?.severity).toBe("sev1");
  });

  test("Sentry: a metric alert's warning raised to critical raises its incident", () => {
    const db = store();
    const source = createSource(db, "sentry");
    const headers = { "sentry-hook-resource": "metric_alert" };
    ingest(db, source, alertsOf("sentry", sentryWarning, headers));
    expect(incidents(db)[0]?.severity).toBe("sev3");
    expect(
      types(ingest(db, source, alertsOf("sentry", sentryCritical, headers), T + 2000)),
    ).toEqual(["incident.severity_changed"]);
    expect(incidents(db)[0]?.severity).toBe("sev1");
  });

  test("a critical alert grouped into a warning's incident raises it", () => {
    const db = store();
    const source = createSource(db);
    createRoute(
      db,
      {},
      {
        kind: "group",
        groupBy: "service",
        severity: null,
        typeId: null,
        serviceIds: [],
        policyId: null,
      },
    );
    ingest(db, source, [firing({ dedupKey: "a", severity: "warning" })]);
    expect(
      types(ingest(db, source, [critical({ labels: { service: "checkout" } })], T + 2000)),
    ).toEqual(["alert.fired", "incident.severity_changed"]);
    expect(incidents(db)).toHaveLength(1);
    expect(incidents(db)[0]?.severity).toBe("sev1");
  });

  test("astral text is fitted by UTF-16 length, so it is ingested rather than refused", () => {
    const db = store();
    const source = createSource(db, "generic");
    const fire = "🔥";
    const [alert] = alertsOf("generic", {
      title: fire.repeat(150),
      labels: { [fire.repeat(60)]: "yes" },
    });
    expect(alert!.title.length).toBeLessThanOrEqual(200);
    expect(alert!.title).toBe(fire.repeat(100));
    const [key] = Object.keys(alert!.labels);
    expect(key!.length).toBeLessThanOrEqual(64);
    expect(alertIssues(alert)).toEqual([]);
    expect(types(ingest(db, source, [alert!]))).toEqual(["incident.declared", "alert.fired"]);
  });

  test("deleting the route that suppressed a firing alert routes it again at once", () => {
    const db = store();
    const source = createSource(db);
    const route = createRoute(db, {}, { kind: "suppress" });
    ingest(db, source, [firing()]);
    expect(types(reroute(db))).toBe("conflict");
    runMutation(mutations, "alertRoute.delete", { id: route }, db, as("admin"));
    expect(types(reroute(db, T + 2000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
    expect(incidents(db)).toHaveLength(1);
    // Only the alerts' actor routes.
    expect(
      types(runMutation(serverMutations, "alert.reroute", { rows: [] }, db, as("owner"))),
    ).toBe("forbidden");
  });

  test("changing a suppress route into an open route routes its alerts again", () => {
    const db = store();
    const source = createSource(db);
    const route = createRoute(db, {}, { kind: "suppress" }, "Checkout");
    ingest(db, source, [firing()]);
    runMutation(
      mutations,
      "alertRoute.update",
      {
        id: route,
        name: "Checkout",
        match: { sourceIds: [], severities: [], labels: [] },
        action: { kind: "open", severity: "sev2", typeId: null, serviceIds: [], policyId: null },
      },
      db,
      as("admin"),
    );
    expect(types(reroute(db, T + 2000))).toEqual([
      "alert.resolved",
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("an incident nobody touched resolves with its alerts; one people worked on stays open", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [
      firing({ dedupKey: "a" }),
      firing({ dedupKey: "b", title: "Search is slow" }),
    ]);
    const [quiet, worked] = incidents(db).sort((x, y) => x.title.localeCompare(y.title));
    runMutation(mutations, "incident.ack", { id: worked!.id }, db, as("responder"));
    expect(
      types(ingest(db, source, [firing({ dedupKey: "a", status: "resolved" })], T + 2000)),
    ).toEqual(["alert.resolved", "incident.status_changed"]);
    expect(db.get("incidents", quiet!.id)?.status).toBe("resolved");
    expect(
      types(ingest(db, source, [firing({ dedupKey: "b", status: "resolved" })], T + 3000)),
    ).toEqual(["alert.resolved"]);
    expect(db.get("incidents", worked!.id)?.status).toBe("triage");
    const entries = db.scan("timeline").filter((entry) => entry.incidentId === worked!.id);
    expect(entries.at(-1)).toMatchObject({ kind: "alerts_resolved", actor: ALERTS_ACTOR.id });
  });

  test("a written update or a role also keeps the incident open", () => {
    for (const touch of ["update", "role"] as const) {
      const db = store();
      const source = createSource(db);
      ingest(db, source, [firing()]);
      const [incident] = incidents(db);
      if (touch === "update") {
        runMutation(
          mutations,
          "incident.postUpdate",
          { id: incident!.id, body: "Looking" },
          db,
          as("responder"),
        );
      } else {
        runMutation(
          serverMutations,
          "member.sync",
          { id: "usr_ana", name: "Ana", role: "responder" },
          db,
          { actor: { kind: "user", id: "usr_ana", role: "responder" }, now: T, server: true },
        );
        runMutation(
          mutations,
          "incident.assignRole",
          { id: incident!.id, role: "commander", userId: "usr_ana" },
          db,
          as("responder"),
        );
      }
      ingest(db, source, [firing({ status: "resolved" })], T + 2000);
      expect(db.get("incidents", incident!.id)?.status).toBe("triage");
    }
  });

  test("a flapping alert reopens the incident it resolved, within FLAP_WINDOW_MS only", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    ingest(db, source, [firing({ status: "resolved" })], T + 2000);
    const [incident] = incidents(db);
    expect(incident!.status).toBe("resolved");
    expect(types(ingest(db, source, [firing()], T + 3000))).toEqual([
      "incident.status_changed",
      "alert.fired",
    ]);
    expect(incidents(db)).toHaveLength(1);
    expect(db.get("incidents", incident!.id)?.status).toBe("investigating");
    expect(alertRows(db).find((row) => row.status === "firing")).toMatchObject({
      outcome: "grouped",
      incidentId: incident!.id,
    });
    // Reopened, it is no longer untouched: the next resolve leaves it open for people.
    ingest(db, source, [firing({ status: "resolved" })], T + 4000);
    expect(db.get("incidents", incident!.id)?.status).toBe("investigating");
    // An incident people resolved is never reopened by a flap; nor one resolved long ago.
    close(db, incident!.id);
    expect(types(ingest(db, source, [firing()], T + 5000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    const second = incidents(db).find((one) => one.id !== incident!.id)!;
    ingest(db, source, [firing({ status: "resolved" })], T + 6000);
    expect(db.get("incidents", second.id)?.status).toBe("resolved");
    expect(types(ingest(db, source, [firing()], T + 6000 + FLAP_WINDOW_MS))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("a resolve that comes before its firing keeps the late firing from opening, for EARLY_RESOLVE_TTL_MS", () => {
    const db = store();
    const source = createSource(db);
    expect(EARLY_RESOLVE_TTL_MS).toBe(5 * 60 * 1000);
    expect(types(ingest(db, source, [firing({ status: "resolved" })]))).toEqual([]);
    expect(types(ingest(db, source, [firing()], T + 2000))).toEqual([]);
    expect(incidents(db)).toHaveLength(0);
    // Never silent: the held firing is a row the dashboard lists, already resolved.
    expect(alertRows(db)).toMatchObject([
      {
        dedupKey: "checkout-5xx",
        status: "resolved",
        outcome: "resolved_early",
        incidentId: null,
        resolvedAt: T + 2000,
      },
    ]);
    // Used once: the next firing opens.
    expect(types(ingest(db, source, [firing()], T + 3000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    // And forgotten after EARLY_RESOLVE_TTL_MS.
    ingest(db, source, [firing({ dedupKey: "late", status: "resolved" })], T + 4000);
    expect(
      types(ingest(db, source, [firing({ dedupKey: "late" })], T + 4000 + EARLY_RESOLVE_TTL_MS)),
    ).toEqual(["incident.declared", "alert.fired"]);
  });

  test("a firing that started after the early resolve is a new problem, and pages", () => {
    // Its first firing never reached Brigade (too large, given up on, an outage): the resolve came, then it fired again.
    const db = store();
    const source = createSource(db);
    const resolvedAt = T - 60_000;
    ingest(db, source, [firing({ status: "resolved", at: resolvedAt })]);
    expect(types(ingest(db, source, [firing({ at: resolvedAt + 1000 })], T + 2000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    expect(db.scan("alert_resolve_markers")).toEqual([]);
    // Started no later than the resolve: the late delivery of what the resolve ended, held and recorded.
    ingest(db, source, [firing({ dedupKey: "late", status: "resolved", at: resolvedAt })]);
    expect(
      types(ingest(db, source, [firing({ dedupKey: "late", at: resolvedAt - 5000 })], T + 2000)),
    ).toEqual([]);
    expect(alertRows(db).find((row) => row.dedupKey === "late")).toMatchObject({
      outcome: "resolved_early",
      status: "resolved",
    });
    // A resolve that does not say when is compared by when it came.
    ingest(db, source, [firing({ dedupKey: "unsaid", status: "resolved" })], T + 3000);
    expect(
      types(ingest(db, source, [firing({ dedupKey: "unsaid", at: T + 4000 })], T + 5000)),
    ).toEqual(["incident.declared", "alert.fired"]);
  });

  test("Grafana: a resolve delivered before its firing holds that firing, and a later firing still pages", () => {
    const db = store();
    const source = createSource(db);
    // The resolve (ended 12:30) arrives first, then the firing it ended (started 12:00): held.
    ingest(db, source, alertsOf("grafana", grafanaResolved), T + 31 * 60_000);
    const late = alertsOf("grafana", grafanaFiring).slice(0, 1);
    expect(types(ingest(db, source, late, T + 32 * 60_000))).toEqual([]);
    expect(alertRows(db)).toMatchObject([{ outcome: "resolved_early", status: "resolved" }]);
    // Its first firing never arrived: the resolve came, then the alert fired again at 12:32, a new problem that pages.
    const db2 = store();
    const source2 = createSource(db2);
    ingest(db2, source2, alertsOf("grafana", grafanaResolved), T + 31 * 60_000);
    const again = [{ ...late[0]!, at: Date.UTC(2026, 9, 27, 12, 32, 0) }];
    expect(types(ingest(db2, source2, again, T + 33 * 60_000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("a repeated resolve keeps nothing from paging: fire, resolve, resolve, fire pages", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    ingest(db, source, [firing({ status: "resolved" })], T + 2000);
    // Grafana sends a resolve again: the key already fired, so it is no resolve-before-fire.
    expect(types(ingest(db, source, [firing({ status: "resolved" })], T + 3000))).toEqual([]);
    expect(db.scan("alert_resolve_markers")).toEqual([]);
    // Within FLAP_WINDOW_MS it reopens the incident, which pages.
    expect(types(ingest(db, source, [firing()], T + 4000))).toEqual([
      "incident.status_changed",
      "alert.fired",
    ]);
    // And after it, a new incident.
    ingest(db, source, [firing({ status: "resolved" })], T + 5000);
    ingest(db, source, [firing({ status: "resolved" })], T + 6000);
    expect(types(ingest(db, source, [firing()], T + 6000 + 30 * 60 * 1000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("a sender's resolve after people closed its incident keeps nothing from paging", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    const [incident] = incidents(db);
    expect(close(db, incident!.id).ok).toBe(true);
    expect(types(ingest(db, source, [firing({ status: "resolved" })], T + 2000))).toEqual([]);
    expect(db.scan("alert_resolve_markers")).toEqual([]);
    expect(types(ingest(db, source, [firing()], T + 2000 + 30 * 60 * 1000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
  });

  test("a resolve of an alert folded into the capacity alert keeps nothing from paging", () => {
    const db = store();
    const source = createSource(db);
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) => firing({ dedupKey: `k${i + j}` }));
      ingest(db, source, batch);
    }
    ingest(db, source, [firing({ dedupKey: "folded" })], T + 2000);
    ingest(db, source, [firing({ dedupKey: "folded", status: "resolved" })], T + 3000);
    expect(db.scan("alert_resolve_markers")).toEqual([]);
  });

  test("a flap that comes back more urgent reopens at that severity, with one page", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing({ severity: "warning" })]);
    ingest(db, source, [firing({ status: "resolved" })], T + 2000);
    const [incident] = incidents(db);
    expect(incident).toMatchObject({ status: "resolved", severity: "sev3" });
    const result = ingest(db, source, [firing({ severity: "critical" })], T + 3000);
    expect(types(result)).toEqual([
      "incident.severity_changed",
      "incident.status_changed",
      "alert.fired",
    ]);
    expect(db.get("incidents", incident!.id)).toMatchObject({
      status: "investigating",
      severity: "sev1",
    });
    // The raise is marked as the reopen's, which is the one page (apps/api `asksForPage`).
    expect(result.ok && result.events[0]?.data).toEqual({
      from: "sev3",
      to: "sev1",
      reopening: true,
    });
    // Never lowered: a flap back at a lower severity leaves it as it was.
    const db2 = store();
    const source2 = createSource(db2);
    ingest(db2, source2, [firing({ severity: "critical" })]);
    ingest(db2, source2, [firing({ status: "resolved" })], T + 2000);
    expect(types(ingest(db2, source2, [firing({ severity: "warning" })], T + 3000))).toEqual([
      "incident.status_changed",
      "alert.fired",
    ]);
    expect(incidents(db2)[0]?.severity).toBe("sev1");
  });

  test("a flap goes through the routes as they are now: a route that quiets it leaves the incident resolved", () => {
    for (const kind of ["suppress", "drop"] as const) {
      const db = store();
      const source = createSource(db);
      ingest(db, source, [firing()]);
      ingest(db, source, [firing({ status: "resolved" })], T + 2000);
      const [incident] = incidents(db);
      const route = createRoute(db, {}, { kind }, "Maintenance");
      expect(types(ingest(db, source, [firing()], T + 3000))).toEqual([
        kind === "drop" ? "alert.dropped" : "alert.fired",
      ]);
      expect(db.get("incidents", incident!.id)?.status).toBe("resolved");
      expect(alertRows(db).find((row) => row.status === "firing")).toMatchObject({
        outcome: kind === "drop" ? "dropped" : "suppressed",
        routeId: route,
        routeName: "Maintenance",
        incidentId: null,
      });
    }
  });

  test("a flap reopens through the route that matches now: incident_routes is replaced, or cleared for the default", () => {
    const policy = (db: MemoryStore<BrigadeTables>, name: string) => {
      const id = newId("esc", T, random);
      const result = runMutation(
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
          isDefault: false,
        },
        db,
        as("admin"),
      );
      expect(result.ok).toBe(true);
      return id;
    };
    const open = (policyId: string) => ({
      kind: "open",
      severity: null,
      typeId: null,
      serviceIds: [],
      policyId,
    });
    for (const now of ["other", "default"] as const) {
      const db = store();
      db.insert("members", { id: "usr_ana", name: "Ana", role: "admin", updatedAt: T });
      const source = createSource(db);
      const first = policy(db, "Payments");
      const before = createRoute(db, {}, open(first), "Payments");
      ingest(db, source, [firing()]);
      const [incident] = incidents(db);
      expect(db.scan("incident_routes")).toEqual([
        { id: incident!.id, routeId: before, routeName: "Payments", policyId: first },
      ]);
      ingest(db, source, [firing({ status: "resolved" })], T + 2000);
      runMutation(mutations, "alertRoute.delete", { id: before }, db, as("admin"));
      const second = now === "other" ? policy(db, "Checkout") : null;
      const after = second ? createRoute(db, {}, open(second), "Checkout") : null;
      expect(types(ingest(db, source, [firing()], T + 3000))).toEqual([
        "incident.status_changed",
        "alert.fired",
      ]);
      // One row per incident: the reopen pages through the route that matched it now.
      expect(db.scan("incident_routes")).toEqual(
        after
          ? [{ id: incident!.id, routeId: after, routeName: "Checkout", policyId: second }]
          : [],
      );
    }
  });

  test("a sender cannot merge into or resolve Brigade's own alerts by naming its key", () => {
    const db = store();
    const source = createSource(db);
    const unreadable = firing({ dedupKey: "malformed", title: "Unreadable alert from Grafana" });
    expect(types(ingest(db, source, [unreadable], T + 1000, true))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    // A real alert keyed `malformed` is its own alert, through the routes, and its resolve leaves the system one.
    expect(types(ingest(db, source, [firing({ dedupKey: "malformed" })], T + 2000))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    ingest(db, source, [firing({ dedupKey: "malformed", status: "resolved" })], T + 3000);
    const system = alertRows(db).find((row) => row.reason === "malformed");
    expect(system?.status).toBe("firing");
    // Nor can it resolve the capacity alert.
    const full = store();
    const other = createSource(full);
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) => firing({ dedupKey: `k${i + j}` }));
      ingest(full, other, batch);
    }
    ingest(full, other, [firing({ dedupKey: "x1" })], T + 2000);
    ingest(full, other, [firing({ dedupKey: "capacity", status: "resolved" })], T + 3000);
    expect(alertRows(full).find((row) => row.reason === "capacity")?.status).toBe("firing");
  });

  test("200 grouped alerts make room for a different alert, which pages", () => {
    const db = store();
    const source = createSource(db);
    createRoute(
      db,
      {},
      {
        kind: "group",
        groupBy: "service",
        severity: null,
        typeId: null,
        serviceIds: [],
        policyId: null,
      },
      "By service",
    );
    for (let i = 0; i < MAX_OPEN_ALERTS; i += 50) {
      const batch = Array.from({ length: 50 }, (_, j) =>
        firing({ dedupKey: `pod-${i + j}`, labels: { service: "pods" } }),
      );
      expect(ingest(db, source, batch, T + 1000 + i).ok).toBe(true);
    }
    expect(incidents(db)).toHaveLength(1);
    const result = ingest(
      db,
      source,
      [firing({ dedupKey: "db", title: "Database down", labels: { service: "db" } })],
      T + 2000,
    );
    expect(types(result)).toEqual(["alert.resolved", "incident.declared", "alert.fired"]);
    expect(alertRows(db).some((row) => row.reason === "capacity")).toBe(false);
    expect(incidents(db).find((one) => one.title === "Database down")).toBeTruthy();
    // The incident that opened the group is still held: the row that opened it was not the one let go.
    expect(alertRows(db).find((row) => row.outcome === "opened")?.status).toBe("firing");
  });

  test("Datadog's default payload: Triggered opens, Recovered resolves the incident", () => {
    const db = store();
    const source = createSource(db, "datadog");
    expect(types(ingest(db, source, alertsOf("datadog", datadogDefault)))).toEqual([
      "incident.declared",
      "alert.fired",
    ]);
    expect(
      types(ingest(db, source, alertsOf("datadog", datadogDefaultRecovered), T + 2000)),
    ).toEqual(["alert.resolved", "incident.status_changed"]);
    expect(incidents(db)[0]?.status).toBe("resolved");
    expect(db.scan("alert_resolve_markers")).toEqual([]);
  });

  test("Datadog: a title with no bracket fires and recovers as one alert, never keyed by $ID", () => {
    const db = store();
    const source = createSource(db, "datadog");
    const payload = {
      id: "1001",
      title: "Checkout latency is high",
      transition: "Triggered",
      alert_type: "error",
      tags: "env:prod,service:checkout",
    };
    const [fired] = alertsOf("datadog", payload);
    const [recovered] = alertsOf("datadog", {
      ...payload,
      id: "1002",
      transition: "Recovered",
      alert_type: "success",
      tags: "service:checkout, env:prod",
    });
    expect(fired!.dedupKey).toMatch(/^datadog:hash:[0-9a-f]{16}$/);
    expect(recovered).toMatchObject({ dedupKey: fired!.dedupKey, status: "resolved" });
    // With a scope, keyed like the bracketed title: the scope and the title.
    expect(alertsOf("datadog", { ...payload, scope: "host:web-1" })).toMatchObject([
      { dedupKey: "datadog:title:host:web-1:Checkout latency is high" },
    ]);
    // Other tags, another alert.
    expect(alertsOf("datadog", { ...payload, tags: "env:staging" })[0]!.dedupKey).not.toBe(
      fired!.dedupKey,
    );
    expect(types(ingest(db, source, [fired!]))).toEqual(["incident.declared", "alert.fired"]);
    expect(types(ingest(db, source, [recovered!], T + 2000))).toEqual([
      "alert.resolved",
      "incident.status_changed",
    ]);
    expect(incidents(db)[0]?.status).toBe("resolved");
  });

  test("a takeover disables the routes the taken-back account created, until someone saves them", () => {
    const db = store();
    const source = createSource(db);
    const planted = createRoute(db, {}, { kind: "drop" }, "Drop everything");
    const account = { actor: ACCOUNT_ACTOR, now: T, server: true };
    expect(
      runMutation(
        serverMutations,
        "alertSource.takeOver",
        { tokenHash: "d".repeat(64), userId: "usr_ana" },
        db,
        account,
      ),
    ).toMatchObject({
      ok: true,
      events: [
        { type: "alert_route.updated", data: { id: planted, reason: "takeover" } },
        { type: "alert_source.revoked" },
      ],
    });
    expect(db.get("alert_routes", planted)?.disabled).toBe("takeover");
    expect(types(ingest(db, source, [firing()]))).toEqual(["incident.declared", "alert.fired"]);
    // Saved again, unchanged: someone vouched for it, and it routes.
    expect(
      runMutation(
        mutations,
        "alertRoute.update",
        {
          id: planted,
          name: "Drop everything",
          match: { sourceIds: [], severities: [], labels: [] },
          action: { kind: "drop" },
        },
        db,
        as("admin"),
      ).ok,
    ).toBe(true);
    expect(db.get("alert_routes", planted)?.disabled).toBeNull();
  });
});

describe("alert routes", () => {
  test("at most MAX_ALERT_ROUTES, and a named policy must exist", () => {
    const db = store();
    const bad = runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "R",
        match: { sourceIds: [], severities: [], labels: [] },
        action: {
          kind: "open",
          severity: null,
          typeId: null,
          serviceIds: [],
          policyId: newId("esc", T, random),
        },
      },
      db,
      as("admin"),
    );
    expect(bad).toMatchObject({
      ok: false,
      error: { code: "invalid_args", issues: [{ path: "action.policyId" }] },
    });
    for (let i = 0; i < MAX_ALERT_ROUTES; i++) createRoute(db, {}, { kind: "drop" });
    const over = runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "R",
        match: { sourceIds: [], severities: [], labels: [] },
        action: { kind: "drop" },
      },
      db,
      as("admin"),
    );
    expect(types(over)).toBe("limit_reached");
  });

  test("an empty label value matches any value of that label", () => {
    const alert = firing({ labels: { team: "blue" } });
    const route = {
      id: "rte_x",
      name: "Team",
      position: 0,
      match: { sourceIds: [], severities: [], labels: [{ key: "team", value: "" }] },
      action: { kind: "suppress" as const },
      createdAt: T,
      createdBy: "usr_ana",
      updatedAt: T,
    };
    expect(pickRoute([route], "src_x", alert, false).reason).toBe("matched");
    expect(pickRoute([route], "src_x", firing({ labels: {} }), false).reason).toBe("default");
  });

  test("the route's policy pages the incident; deleting the policy falls back to the default", () => {
    const db = store();
    const source = createSource(db);
    const policy = (name: string, isDefault: boolean) => {
      const id = newId("esc", T, random);
      const result = runMutation(
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
      );
      expect(result.ok).toBe(true);
      return id;
    };
    db.insert("members", { id: "usr_ana", name: "Ana", role: "admin", updatedAt: T });
    const fallback = policy("Default", true);
    const own = policy("Payments", false);
    const route = createRoute(
      db,
      {},
      { kind: "open", severity: null, typeId: null, serviceIds: [], policyId: own },
      "Payments",
    );
    ingest(db, source, [firing()]);
    const [incident] = incidents(db);
    const started = runMutation(
      { [startEscalation.name]: startEscalation },
      "escalation.start",
      { incidentId: incident!.id, eventId: newId("evt", T, random), causedBy: "sys_alerts" },
      db,
      {
        actor: { kind: "system", id: "sys_escalation", role: "admin" },
        now: T + 2000,
        server: true,
      },
    );
    expect(started.ok).toBe(true);
    expect(db.get("incidents", incident!.id)?.escalation).toMatchObject({
      policyId: own,
      route: { id: route, name: "Payments" },
      monitor: null,
    });
    const deleted = runMutation(mutations, "escalation.deletePolicy", { id: own }, db, as("admin"));
    expect(types(deleted)).toEqual(["escalation_policy.deleted", "alert_route.updated"]);
    expect(db.get("alert_routes", route)?.action).toMatchObject({ policyId: null });
    expect(fallback).toBeTruthy();
  });

  test("the route's policy outlives its alert rows: pruned, a raise into SEV1 pages through it", () => {
    const db = store();
    const source = createSource(db);
    db.insert("members", { id: "usr_ana", name: "Ana", role: "admin", updatedAt: T });
    const policy = (name: string, isDefault: boolean) => {
      const id = newId("esc", T, random);
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
      );
      return id;
    };
    policy("Default", true);
    const own = policy("Payments", false);
    const route = createRoute(
      db,
      { labels: [{ key: "team", value: "payments" }] },
      { kind: "open", severity: "sev3", typeId: null, serviceIds: [], policyId: own },
      "Payments",
    );
    ingest(db, source, [firing({ labels: { team: "payments" } })]);
    const [incident] = incidents(db);
    // People work on it (an update, no ack yet), so it stays open once its alert resolves.
    runMutation(
      mutations,
      "incident.postUpdate",
      { id: incident!.id, body: "Looking" },
      db,
      as("responder"),
    );
    ingest(db, source, [firing({ status: "resolved", labels: { team: "payments" } })], T + 1500);
    expect(db.get("incidents", incident!.id)?.status).toBe("triage");
    // MAX_ALERT_ROWS and more rows since, all resolved: the row that opened the incident is pruned.
    for (let i = 0; i < 320; i += 40) {
      const keys = Array.from({ length: 40 }, (_, j) => `other-${i + j}`);
      ingest(
        db,
        source,
        keys.map((dedupKey) => firing({ dedupKey })),
        T + 2000 + i,
      );
      ingest(
        db,
        source,
        keys.map((dedupKey) => firing({ dedupKey, status: "resolved" })),
        T + 3000 + i,
      );
    }
    expect(alertRows(db).some((row) => row.incidentId === incident!.id)).toBe(false);
    expect(
      runMutation(
        mutations,
        "incident.setSeverity",
        { id: incident!.id, severity: "sev1" },
        db,
        as("responder", T + 5000),
      ).ok,
    ).toBe(true);
    const started = runMutation(
      { [startEscalation.name]: startEscalation },
      "escalation.start",
      { incidentId: incident!.id, eventId: newId("evt", T, random), causedBy: "usr_ana" },
      db,
      {
        actor: { kind: "system", id: "sys_escalation", role: "admin" },
        now: T + 6000,
        server: true,
      },
    );
    expect(started.ok).toBe(true);
    expect(db.get("incidents", incident!.id)?.escalation).toMatchObject({
      policyId: own,
      route: { id: route, name: "Payments" },
    });
  });
});
