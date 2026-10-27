// A source's title and severity mapping (RFC 0005 "Alert sources", "Mapping"), and the service's policy in the policy
// order (RFC 0006 "Who is paged"). Paging paths: a template or a map that cannot be read never keeps an alert from
// paging; it falls back to the alert's own title and severity.
import { describe, expect, test } from "vite-plus/test";
import {
  ALERT_TITLE_MAX,
  ALERTS_ACTOR,
  applyMapping,
  createMemoryStore,
  mapSeverity,
  mutations,
  newId,
  normalizeAlerts,
  parseTemplate,
  renderTitle,
  runMutation,
  serverMutations,
  startEscalation,
  type AlertMapping,
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
const store = () => createMemoryStore<BrigadeTables>();
const types = (result: MutationResult) =>
  result.ok ? result.events.map((event) => event.type) : result.error.code;

const firing = (overrides: Partial<NormalizedAlert> = {}): NormalizedAlert => ({
  dedupKey: "checkout-5xx",
  title: "Checkout returns 5xx",
  severity: "high",
  status: "firing",
  link: null,
  labels: { service: "checkout", env: "production" },
  providerSeverity: "P3",
  ...overrides,
});

function createSource(db: MemoryStore<BrigadeTables>) {
  const id = newId("src", T, random);
  const result = runMutation(
    mutations,
    "alertSource.create",
    { id, name: "Datadog", kind: "datadog", tokenHash: HASH, auth: null, signingSecret: null },
    db,
    as("admin"),
  );
  expect(result.ok).toBe(true);
  return id;
}

function ingest(db: MemoryStore<BrigadeTables>, sourceId: string, alerts: NormalizedAlert[]) {
  const now = T + 1000;
  return runMutation(
    serverMutations,
    "alert.ingest",
    {
      sourceId,
      malformed: false,
      alerts: alerts.map((alert) => ({
        alert,
        alertId: newId("alt", now, random),
        incidentId: newId("inc", now, random),
      })),
    },
    db,
    { actor: ALERTS_ACTOR, now, server: true },
  );
}

const setMapping = (
  db: MemoryStore<BrigadeTables>,
  id: string,
  mapping: AlertMapping | null,
  role: Role = "admin",
) => runMutation(mutations, "alertSource.setMapping", { id, mapping }, db, as(role));

const MAPPING: AlertMapping = {
  titleTemplate: "{labels.service}: {title}",
  severity: {
    from: "provider",
    label: null,
    rules: [
      { value: "P1", severity: "critical" },
      { value: "p3", severity: "critical" },
    ],
    fallback: "warning",
  },
};

describe("templates", () => {
  test("placeholders, literal text, and what is refused", () => {
    expect(parseTemplate("[{severity}] {labels.Service}: {title}")).toEqual({
      ok: true,
      parts: [
        { kind: "text", text: "[" },
        { kind: "severity" },
        { kind: "text", text: "] " },
        { kind: "label", key: "service" },
        { kind: "text", text: ": " },
        { kind: "title" },
      ],
    });
    expect(parseTemplate("{body}")).toEqual({ ok: false, problem: "unknown_field" });
    expect(parseTemplate("{labels.}")).toEqual({ ok: false, problem: "unknown_field" });
    expect(parseTemplate("{constructor}")).toEqual({ ok: false, problem: "unknown_field" });
    expect(parseTemplate("{title")).toEqual({ ok: false, problem: "unclosed" });
    expect(parseTemplate("title}")).toEqual({ ok: false, problem: "stray_brace" });
    expect(parseTemplate("{title}".repeat(11))).toEqual({ ok: false, problem: "too_many_fields" });
  });

  test("rendering is bounded and falls back to the alert's own title", () => {
    const alert = firing();
    expect(renderTitle("{labels.service}: {title}", alert, "high")).toBe(
      "checkout: Checkout returns 5xx",
    );
    // A label the alert lacks is empty; the rest still renders.
    expect(renderTitle("{labels.team}/{title}", alert, "high")).toBe("/Checkout returns 5xx");
    // Nothing visible left, or a template that cannot be read (stored before a rule changed): the alert's own.
    expect(renderTitle("{labels.team}", alert, "high")).toBe("Checkout returns 5xx");
    expect(renderTitle("{labels.team} {nope", alert, "high")).toBe("Checkout returns 5xx");
    expect(renderTitle(42 as unknown as string, alert, "high")).toBe("Checkout returns 5xx");
    // Never past the title's length, whatever the labels hold; a pair is never split.
    const long = firing({ labels: { a: "🔥".repeat(100), b: "x".repeat(200) } });
    const title = renderTitle("{labels.a}{labels.b}{title}", long, "high");
    expect(title.length).toBeLessThanOrEqual(ALERT_TITLE_MAX);
    expect(title).toBe("🔥".repeat(100));
    // Control characters a label carried are spaces, as everywhere else in an alert.
    expect(renderTitle("{labels.a}", firing({ labels: { a: "a\u0007b" } }), "high")).toBe("a b");
  });
});

describe("severity maps", () => {
  test("the sender's word or a label, matched ignoring case, else the fallback, else its own", () => {
    const map = MAPPING.severity!;
    expect(mapSeverity(map, firing({ providerSeverity: " P1 " }))).toBe("critical");
    expect(mapSeverity(map, firing({ providerSeverity: "P5" }))).toBe("warning");
    expect(mapSeverity(map, firing({ providerSeverity: undefined }))).toBe("warning");
    expect(mapSeverity({ ...map, fallback: null }, firing({ providerSeverity: "P5" }))).toBe(
      "high",
    );
    const byLabel = {
      from: "label" as const,
      label: "env",
      rules: [{ value: "Production", severity: "critical" as const }],
      fallback: null,
    };
    expect(mapSeverity(byLabel, firing())).toBe("critical");
    expect(mapSeverity(byLabel, firing({ labels: {} }))).toBe("high");
    expect(mapSeverity(null, firing())).toBe("high");
  });

  test("entries that cannot be read are skipped, never thrown on", () => {
    const broken = {
      from: "label",
      label: null,
      rules: [null, { value: 3, severity: "critical" }, { value: "P3", severity: "sev1" }],
      fallback: "loud",
    } as unknown as AlertMapping["severity"];
    expect(mapSeverity(broken, firing())).toBe("high");
    expect(mapSeverity({ ...broken!, from: "provider" }, firing())).toBe("high");
    expect(applyMapping({ titleTemplate: null, severity: broken }, firing())).toEqual(firing());
  });

  test("the sender's word is kept from each provider", () => {
    const one = (kind: "generic" | "grafana" | "datadog", body: unknown) => {
      const result = normalizeAlerts(kind, JSON.stringify(body), {});
      return result.kind === "alerts" ? result.alerts[0]?.providerSeverity : undefined;
    };
    expect(one("generic", { title: "Disk", severity: "SEV-ish" })).toBe("SEV-ish");
    expect(one("generic", { title: "Disk" })).toBeUndefined();
    expect(
      one("grafana", {
        alerts: [{ fingerprint: "f", labels: { alertname: "x", severity: "p2" } }],
      }),
    ).toBe("p2");
    expect(one("datadog", { alert_id: "1", title: "CPU", priority: "P4" })).toBe("P4");
    expect(one("datadog", { alert_id: "1", title: "[P2] [Triggered] CPU" })).toBe("P2");
  });
});

describe("alertSource.setMapping", () => {
  test("owners and admins set it; responders and viewers cannot; the event says what it is now", () => {
    const db = store();
    const id = createSource(db);
    expect(types(setMapping(db, id, MAPPING, "responder"))).toBe("forbidden");
    expect(types(setMapping(db, id, MAPPING, "viewer"))).toBe("forbidden");
    const set = setMapping(db, id, MAPPING);
    expect(set.ok && set.events).toEqual([
      expect.objectContaining({
        type: "alert_source.mapping_changed",
        data: { id, mapping: MAPPING },
      }),
    ]);
    expect(types(setMapping(db, id, MAPPING, "owner"))).toBe("conflict");
    expect(db.get("alert_sources", id)?.mapping).toEqual(MAPPING);
    // A mapping with neither part is no mapping.
    const cleared = setMapping(db, id, { titleTemplate: null, severity: null });
    expect(cleared.ok && cleared.events[0]?.data).toEqual({ id, mapping: null });
    expect(types(setMapping(db, id, null))).toBe("conflict");
  });

  test("a template or a map that cannot be read is refused when saved", () => {
    const db = store();
    const id = createSource(db);
    const refused = (mapping: unknown) => {
      const result = runMutation(
        mutations,
        "alertSource.setMapping",
        { id, mapping },
        db,
        as("admin"),
      );
      return result.ok ? [] : (result.error.issues ?? []).map((issue) => issue.path);
    };
    expect(refused({ titleTemplate: "{body}", severity: null })).toEqual(["mapping.titleTemplate"]);
    expect(refused({ titleTemplate: "x".repeat(201), severity: null })).toEqual([
      "mapping.titleTemplate",
    ]);
    expect(
      refused({
        titleTemplate: null,
        severity: { from: "label", label: null, rules: [], fallback: "info" },
      }),
    ).toEqual(["mapping.severity.label"]);
    expect(
      refused({
        titleTemplate: null,
        severity: {
          from: "provider",
          label: null,
          rules: [
            { value: "P1", severity: "critical" },
            { value: "p1", severity: "info" },
          ],
          fallback: null,
        },
      }),
    ).toEqual(["mapping.severity.rules[1].value"]);
    expect(
      refused({
        titleTemplate: null,
        severity: {
          from: "provider",
          label: null,
          rules: Array.from({ length: 21 }, (_, i) => ({ value: `P${i}`, severity: "info" })),
          fallback: null,
        },
      }),
    ).toEqual(["mapping.severity.rules"]);
  });
});

describe("ingesting with a mapping", () => {
  test("without one, a source keeps today's title and severity", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    const [row] = db.scan("source_alerts");
    expect(row).toMatchObject({ title: "Checkout returns 5xx", severity: "high" });
    expect(db.scan("incidents")[0]).toMatchObject({
      title: "Checkout returns 5xx",
      severity: "sev2",
    });
  });

  test("the mapped title and severity open the incident, and the routes match the mapped severity", () => {
    const db = store();
    const source = createSource(db);
    expect(setMapping(db, source, MAPPING).ok).toBe(true);
    // A route suppressing warnings: the P5 alert the map turns into a warning stays quiet.
    runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "Quiet warnings",
        match: { sourceIds: [], severities: ["warning"], labels: [] },
        action: { kind: "suppress" },
      },
      db,
      as("admin"),
    );
    ingest(db, source, [firing(), firing({ dedupKey: "other", providerSeverity: "P5" })]);
    const rows = db.scan("source_alerts");
    expect(rows.find((row) => row.dedupKey === "checkout-5xx")).toMatchObject({
      title: "checkout: Checkout returns 5xx",
      severity: "critical",
      outcome: "opened",
      received: { title: "Checkout returns 5xx", severity: "high", providerSeverity: "P3" },
    });
    expect(rows.find((row) => row.dedupKey === "other")).toMatchObject({
      severity: "warning",
      outcome: "suppressed",
    });
    expect(db.scan("incidents")).toEqual([
      expect.objectContaining({ title: "checkout: Checkout returns 5xx", severity: "sev1" }),
    ]);
  });

  test("a stored template or map that cannot be read still pages, with the alert's own title and severity", () => {
    const db = store();
    const source = createSource(db);
    // Written by hand, or stored before a rule changed: never through `alertSource.setMapping`.
    db.update("alert_sources", source, {
      mapping: {
        titleTemplate: "{labels.service {title}",
        severity: { from: "label", label: null, rules: [], fallback: "nope" },
      } as unknown as AlertMapping,
    });
    const result = ingest(db, source, [firing()]);
    expect(types(result)).toEqual(["incident.declared", "alert.fired"]);
    expect(db.scan("incidents")[0]).toMatchObject({
      title: "Checkout returns 5xx",
      severity: "sev2",
    });
  });

  test("a template that leaves nothing visible pages with the alert's own title", () => {
    const db = store();
    const source = createSource(db);
    setMapping(db, source, { titleTemplate: "{labels.team}", severity: null });
    expect(types(ingest(db, source, [firing()]))).toEqual(["incident.declared", "alert.fired"]);
    expect(db.scan("incidents")[0]?.title).toBe("Checkout returns 5xx");
  });

  test("a repeat is mapped too, and raises its incident when the map makes it more urgent", () => {
    const db = store();
    const source = createSource(db);
    ingest(db, source, [firing()]);
    setMapping(db, source, MAPPING);
    const again = ingest(db, source, [firing()]);
    expect(types(again)).toEqual(["incident.severity_changed"]);
    expect(db.scan("source_alerts")[0]).toMatchObject({
      title: "checkout: Checkout returns 5xx",
      severity: "critical",
      repeats: 1,
    });
  });

  test("Brigade's own unreadable alert is never mapped", () => {
    const db = store();
    const source = createSource(db);
    setMapping(db, source, {
      titleTemplate: "{labels.service}: {title}",
      severity: { from: "provider", label: null, rules: [], fallback: "info" },
    });
    const now = T + 1000;
    runMutation(
      serverMutations,
      "alert.ingest",
      {
        sourceId: source,
        malformed: true,
        alerts: [
          {
            alert: firing({ dedupKey: "malformed", title: "Unreadable alert from Datadog" }),
            alertId: newId("alt", now, random),
            incidentId: newId("inc", now, random),
          },
        ],
      },
      db,
      { actor: ALERTS_ACTOR, now, server: true },
    );
    const [row] = db.scan("source_alerts");
    expect(row).toMatchObject({ title: "Unreadable alert from Datadog", severity: "high" });
    expect(row?.received ?? null).toBeNull();
  });
});

describe("a service's policy pages", () => {
  function setup() {
    const db = store();
    db.insert("members", { id: "usr_ana", name: "Ana", role: "admin", updatedAt: T });
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
    const service = (name: string, escalationPolicyId: string | null) => {
      const id = newId("svc", T, random);
      const result = runMutation(
        mutations,
        "service.create",
        { id, name, description: "", tier: "tier3", owners: [], escalationPolicyId },
        db,
        as("admin"),
      );
      expect(result.ok, JSON.stringify(result)).toBe(true);
      return id;
    };
    const start = (incidentId: string) => {
      const started = runMutation(
        { [startEscalation.name]: startEscalation },
        "escalation.start",
        { incidentId, eventId: newId("evt", T, random), causedBy: "sys_alerts" },
        db,
        {
          actor: { kind: "system", id: "sys_escalation", role: "admin" },
          now: T + 2000,
          server: true,
        },
      );
      expect(started.ok).toBe(true);
      return db.get("incidents", incidentId)!.escalation!;
    };
    return { db, policy, service, start };
  }

  test("an alert route naming a service with a policy, and no policy of its own, pages through it", () => {
    const { db, policy, service, start } = setup();
    policy("Default", true);
    const payments = policy("Payments on-call", false);
    const none = service("Search", null);
    const checkout = service("Checkout", payments);
    const source = createSource(db);
    runMutation(
      mutations,
      "alertRoute.create",
      {
        id: newId("rte", T, random),
        name: "Checkout",
        match: { sourceIds: [], severities: [], labels: [] },
        action: {
          kind: "open",
          severity: null,
          typeId: null,
          serviceIds: [none, checkout],
          policyId: null,
        },
      },
      db,
      as("admin"),
    );
    ingest(db, source, [firing()]);
    const run = start(db.scan("incidents")[0]!.id);
    expect(run).toMatchObject({
      policyId: payments,
      service: { id: checkout, name: "Checkout" },
      monitor: null,
    });
  });

  test("the route's own policy comes first; a service whose policy was deleted falls through to the default", () => {
    const { db, policy, service, start } = setup();
    const fallback = policy("Default", true);
    const routed = policy("Routed", false);
    const gone = policy("Gone", false);
    const checkout = service("Checkout", gone);
    const source = createSource(db);
    const routeId = newId("rte", T, random);
    runMutation(
      mutations,
      "alertRoute.create",
      {
        id: routeId,
        name: "Checkout",
        match: { sourceIds: [], severities: [], labels: [] },
        action: {
          kind: "open",
          severity: null,
          typeId: null,
          serviceIds: [checkout],
          policyId: routed,
        },
      },
      db,
      as("admin"),
    );
    ingest(db, source, [firing(), firing({ dedupKey: "two" })]);
    const [first, second] = db.scan("incidents");
    expect(start(first!.id)).toMatchObject({ policyId: routed, route: { id: routeId } });
    // The route's policy deleted (it goes back to the default) and the service's too: the default pages.
    runMutation(mutations, "escalation.deletePolicy", { id: routed }, db, as("admin"));
    runMutation(mutations, "escalation.deletePolicy", { id: gone }, db, as("admin"));
    const run = start(second!.id);
    expect(run.policyId).toBe(fallback);
    expect(run.service).toBeUndefined();
  });

  test("an incident declared on a service pages through the service's policy", () => {
    const { db, policy, service, start } = setup();
    policy("Default", true);
    const payments = policy("Payments on-call", false);
    const checkout = service("Checkout", payments);
    const incidentId = newId("inc", T, random);
    const declared = runMutation(
      mutations,
      "incident.declare",
      { id: incidentId, title: "Checkout is slow", severity: "sev2", serviceIds: [checkout] },
      db,
      as("admin"),
    );
    expect(declared.ok, JSON.stringify(declared)).toBe(true);
    expect(start(incidentId)).toMatchObject({
      policyId: payments,
      service: { id: checkout, name: "Checkout" },
    });
  });
});
