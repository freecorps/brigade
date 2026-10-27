// @vitest-environment happy-dom
// The Alert sources card (RFC 0005 "Alert sources"): sources and their once-shown URL, the routes editor and the
// recent alerts with what Brigade did with each, with demo data and with the worst case.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type {
  AlertRouteRow,
  AlertSourceRow,
  EscalationPolicyRow,
  IncidentRow,
  SourceAlertRow,
} from "@freecorps/brigade-schema";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { AlertsPanel, type NewSource, type RouteDraft } from "../src/components/alerts-card";
import { headerNameProblem, newAlertSourceUrl, parseLabels } from "../src/lib/alerts";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: string; params: { number: string } }) => (
    <a href={`/incidents/${params.number}`}>{children}</a>
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

const source = (
  id: string,
  name: string,
  overrides: Partial<AlertSourceRow> = {},
): AlertSourceRow => ({
  id,
  name,
  kind: "grafana",
  headerName: null,
  signed: false,
  lastReceivedAt: NOW - 5 * 60_000,
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
  ...overrides,
});

const route = (
  id: string,
  name: string,
  position: number,
  overrides: Partial<AlertRouteRow> = {},
): AlertRouteRow => ({
  id,
  name,
  position,
  match: { sourceIds: [], severities: [], labels: [] },
  action: { kind: "open", severity: null, typeId: null, serviceIds: [], policyId: null },
  createdAt: 0,
  createdBy: "usr_ana",
  updatedAt: 0,
  ...overrides,
});

const alert = (id: string, overrides: Partial<SourceAlertRow> = {}): SourceAlertRow => ({
  id,
  sourceId: "src_grafana",
  dedupKey: id,
  title: "High memory usage on web-1",
  severity: "high",
  status: "firing",
  link: "https://grafana.example.com/alerting/1/edit",
  labels: {},
  outcome: "opened",
  reason: "default",
  routeId: null,
  routeName: null,
  groupKey: null,
  policyId: null,
  incidentId: "inc_1",
  firedAt: NOW - 60_000,
  lastSeenAt: NOW - 60_000,
  resolvedAt: null,
  repeats: 0,
  updatedAt: NOW,
  ...overrides,
});

const incident: IncidentRow = {
  id: "inc_1",
  number: 142,
  title: "High memory usage on web-1",
  severity: "sev2",
  status: "triage",
  declaredAt: NOW,
  declaredBy: "sys_alerts",
  acknowledgedAt: null,
  acknowledgedBy: null,
  updatedAt: NOW,
};

const policy = { id: "esc_payments", name: "Payments on-call" } as EscalationPolicyRow;

function panel(overrides: Partial<Parameters<typeof AlertsPanel>[0]> = {}) {
  return (
    <AlertsPanel
      sources={[source("src_grafana", "Grafana production")]}
      routes={[]}
      recent={[]}
      policies={[policy]}
      types={[]}
      services={[]}
      incidents={[incident]}
      loading={false}
      failed={false}
      manage
      locale="en"
      now={NOW}
      onCreate={async () => "https://brigade.example.com/api/alerts/x"}
      onRotate={async () => null}
      onDelete={async () => true}
      onCreateRoute={async () => true}
      onUpdateRoute={async () => true}
      onMoveRoute={async () => true}
      onDeleteRoute={async () => true}
      onRetry={() => {}}
      {...overrides}
    />
  );
}

const input = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll("label")].find((one) => one.textContent === label)!.control as
    | HTMLInputElement
    | HTMLSelectElement;

function type(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(
      element,
      value,
    );
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === text)!;

describe("AlertsPanel", () => {
  test("lists sources, the default route and what each recent alert did", () => {
    const container = mount(
      panel({
        routes: [
          route("rte_1", "Payments", 0, {
            match: {
              sourceIds: ["src_grafana"],
              severities: ["critical"],
              labels: [{ key: "team", value: "payments" }],
            },
            action: {
              kind: "open",
              severity: "sev1",
              typeId: null,
              serviceIds: [],
              policyId: "esc_payments",
            },
          }),
        ],
        recent: [
          alert("alt_1", {
            routeId: "rte_1",
            routeName: "Payments",
            reason: "matched",
            repeats: 3,
          }),
          alert("alt_2", {
            outcome: "dropped",
            incidentId: null,
            routeName: "Ignore info",
            status: "firing",
          }),
          alert("alt_3", {
            reason: "malformed",
            title: "Unreadable alert from Grafana production",
            incidentId: "inc_gone",
          }),
          alert("alt_4", {
            outcome: "resolved_early",
            status: "resolved",
            reason: "default",
            incidentId: null,
            title: "Checkout latency is high",
          }),
        ],
      }),
    );
    const text = container.textContent!;
    expect(text).toContain("Grafana production");
    expect(text).toContain("Last alert 5 minutes ago");
    expect(text).toContain("Grafana production · Critical · team=payments");
    expect(text).toContain("Open an incident · SEV1 · Payments on-call");
    expect(text).toContain("Everything else");
    expect(text).toContain("Opened INC-142 · Route: Payments");
    expect(text).toContain("Sent 3 more times");
    expect(text).toContain("Dropped · Route: Ignore info");
    expect(text).toContain("Opened an incident · Unreadable payload, so the default route took it");
    // A firing held by its early resolve is listed, never silently gone.
    expect(text).toContain("Its resolve came first, so no incident · Default route");
    expect(container.querySelector('a[href="/incidents/142"]')).not.toBeNull();
  });

  test("the worst case: long names, a deleted source, no policy left, one repeat", () => {
    const long =
      "Grafana Cloud production us-east-1 alerting for the checkout and payments platform";
    const container = mount(
      panel({
        sources: [
          source("src_grafana", long, {
            headerName: "x-brigade-token-for-the-grafana-contact-point",
            signed: true,
            lastReceivedAt: null,
          }),
        ],
        routes: [
          route("rte_1", "R", 0, {
            match: {
              sourceIds: ["src_deleted"],
              severities: [],
              labels: [{ key: "service", value: "" }],
            },
            action: {
              kind: "group",
              groupBy: "service",
              severity: null,
              typeId: null,
              serviceIds: [],
              policyId: "esc_deleted",
            },
          }),
        ],
        recent: [alert("alt_1", { title: long, repeats: 1, sourceId: "src_deleted" })],
        incidents: [],
      }),
    );
    const text = container.textContent!;
    expect(text).toContain(
      "No alert received yet · Signature checked · Checks x-brigade-token-for-the-grafana-contact-point",
    );
    expect(text).toContain("a deleted source · service");
    expect(text).toContain(
      "Group into one open incident (service) · The alert's own · Default policy",
    );
    expect(text).toContain("Sent 1 more time");
    expect(text).toContain("Opened an incident · Default route");
  });

  test("empty: no sources, no routes, no alerts; viewers are told who manages them", () => {
    const container = mount(panel({ sources: [], manage: false }));
    const text = container.textContent!;
    expect(text).toContain("No alert sources yet.");
    expect(text).toContain("Only owners and admins add alert sources and change routes.");
    expect(text).toContain("No alerts received yet.");
    expect(button(container, "Add source")).toBeUndefined();
  });

  test("a recent alert keeps its incident's number once the incident is over; closed and capacity say so", () => {
    const container = mount(
      panel({
        incidents: [],
        recent: [
          alert("alt_over", { status: "closed", incidentId: "inc_old", incidentNumber: 77 }),
          alert("alt_capacity", {
            reason: "capacity",
            incidentId: "inc_gone",
            incidentNumber: null,
          }),
        ],
      }),
    );
    const link = [...container.querySelectorAll("a")].find(
      (a) => a.textContent === "Opened INC-77",
    );
    expect(link?.getAttribute("href")).toBe("/incidents/77");
    const text = container.textContent!;
    expect(text).toContain("Closed");
    expect(text).toContain("Too many alerts firing, so it paged as the capacity alert");
    expect(text).toContain("Opened an incident");
  });

  test("a route a takeover disabled says so, and how to turn it on again", () => {
    const container = mount(
      panel({ routes: [route("rte_planted", "Drop everything", 0, { disabled: "takeover" })] }),
    );
    expect(container.textContent).toContain(
      "Off since the account that created it was taken back. Save it to turn it on again.",
    );
  });

  test("a failed list shows the error and a retry, not an empty card", () => {
    let retried = 0;
    const container = mount(panel({ failed: true, onRetry: () => retried++ }));
    expect(container.textContent).toContain("Couldn't load alert sources.");
    click(button(container, "Try again")!);
    expect(retried).toBe(1);
  });

  test("a new Sentry source needs its client secret, then shows its URL once with the setup", async () => {
    const created: NewSource[] = [];
    const container = mount(
      panel({
        onCreate: async (one) => {
          created.push(one);
          return "https://brigade.example.com/api/alerts/ws_x.src_x.secret";
        },
      }),
    );
    click(button(container, "Add source"));
    type(input(container, "Name"), "Sentry");
    type(input(container, "Sent by"), "sentry");
    await act(async () => {
      button(container, "Create source").closest("form")!.requestSubmit();
    });
    expect(container.textContent).toContain("Sentry signs every webhook: paste its client secret.");
    expect(created).toEqual([]);
    type(input(container, "Client secret"), "example-client-secret");
    await act(async () => {
      button(container, "Create source").closest("form")!.requestSubmit();
    });
    expect(created).toEqual([
      { name: "Sentry", kind: "sentry", header: null, signingSecret: "example-client-secret" },
    ]);
    expect(container.textContent).toContain("Copy this URL now.");
    expect(container.textContent).toContain("In Sentry, open Settings");
    expect((container.querySelector("input[readonly]") as HTMLInputElement).value).toBe(
      "https://brigade.example.com/api/alerts/ws_x.src_x.secret",
    );
  });

  test("a route is saved with its parsed labels and action", async () => {
    const saved: RouteDraft[] = [];
    const container = mount(panel({ onCreateRoute: async (draft) => (saved.push(draft), true) }));
    click(button(container, "Add route"));
    type(input(container, "Route name"), "Ignore info");
    type(input(container, "Labels"), "env=staging, team");
    type(input(container, "Then"), "drop");
    await act(async () => {
      button(container, "Save").closest("form")!.requestSubmit();
    });
    expect(saved).toEqual([
      {
        name: "Ignore info",
        match: {
          sourceIds: [],
          severities: [],
          labels: [
            { key: "env", value: "staging" },
            { key: "team", value: "" },
          ],
        },
        action: { kind: "drop" },
      },
    ]);
  });

  test("pt-BR", () => {
    void setI18nLocale("pt-BR");
    const container = mount(panel({ recent: [alert("alt_1")] }));
    expect(container.textContent).toContain("Fontes de alertas");
    expect(container.textContent).toContain("Abriu INC-142 · Rota padrão");
  });
});

describe("helpers", () => {
  test("labels, header names and the URL", async () => {
    expect(parseLabels("")).toEqual([]);
    expect(parseLabels("a=b, C")).toEqual([
      { key: "a", value: "b" },
      { key: "c", value: "" },
    ]);
    expect(parseLabels("=b")).toBeUndefined();
    expect(parseLabels(Array.from({ length: 11 }, (_, i) => `k${i}=v`).join(","))).toBeUndefined();
    expect(headerNameProblem("Authorization")).toBe(false);
    expect(headerNameProblem("Content-Type")).toBe(true);
    expect(headerNameProblem("X Token")).toBe(true);
    const made = await newAlertSourceUrl(
      "https://brigade.example.com",
      "ws_x",
      "src_x",
      (n) => new Uint8Array(n),
    );
    expect(made.url).toBe(`https://brigade.example.com/api/alerts/ws_x.src_x.${"A".repeat(43)}`);
    expect(made.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
