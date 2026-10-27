// @vitest-environment happy-dom
// Status page slice 2 on the dashboard (RFC 0012): the maintenance card, linking a component to monitors for its
// uptime bar, and the owners' subscribers section.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { MaintenanceRow, StatusComponentRow, StatusPageRow } from "@freecorps/brigade-schema";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  checkDraft,
  fromLocalInput,
  MaintenancePanel,
  toLocalInput,
  type MaintenanceDraft,
} from "../src/components/maintenance-card";
import { StatusPagePanel } from "../src/components/status-page-card";
import { loadSubscriberCounts, removeSubscriber } from "../src/lib/status-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
// The form checks a window against the real clock when it is saved: pin it to the fixtures' NOW, or the windows they
// plan from NOW have ended by the afternoon.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
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

const button = (container: Element, text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const field = (container: HTMLElement, label: string) => {
  const node = [...container.querySelectorAll("label")].find((l) => l.textContent === label)!;
  return document.getElementById(node.htmlFor) as HTMLInputElement;
};

const NOW = Date.UTC(2026, 9, 27, 12);
const HOUR = 60 * 60 * 1000;

const component = (id: string, name: string): StatusComponentRow => ({
  id,
  name,
  group: null,
  status: "operational",
  createdAt: 0,
  updatedAt: 0,
});

const windowRow = (extra: Partial<MaintenanceRow> = {}): MaintenanceRow => ({
  id: "mnt_1",
  title: "Database upgrade",
  body: "Read-only for a minute.",
  componentIds: ["cmp_api"],
  startsAt: NOW + HOUR,
  endsAt: NOW + 2 * HOUR,
  phase: "scheduled",
  createdAt: NOW,
  createdBy: "usr_ana",
  updatedAt: NOW,
  ...extra,
});

function panel(props: Partial<Parameters<typeof MaintenancePanel>[0]> = {}) {
  const saved: { draft: MaintenanceDraft; id?: string }[] = [];
  const ended: string[] = [];
  const cancelled: string[] = [];
  const container = mount(
    <MaintenancePanel
      ready
      loading={false}
      windows={[]}
      components={[component("cmp_api", "API")]}
      publish
      now={NOW}
      onSave={async (draft, id) => {
        saved.push({ draft, id });
        return true;
      }}
      onEnd={async (id) => {
        ended.push(id);
        return true;
      }}
      onCancel={async (id) => {
        cancelled.push(id);
        return true;
      }}
      {...props}
    />,
  );
  return { container, saved, ended, cancelled };
}

describe("maintenance card", () => {
  test("empty, not set up, and read-only for viewers", () => {
    expect(panel().container.textContent).toContain("No maintenance planned.");
    act(() => root?.unmount());
    expect(panel({ ready: false }).container.textContent).toContain("Set up the status page first");
    act(() => root?.unmount());
    const viewer = panel({ publish: false, windows: [windowRow()] }).container;
    expect(viewer.textContent).toContain("Database upgrade");
    expect(button(viewer, "Schedule maintenance")).toBeUndefined();
    expect(button(viewer, "Edit")).toBeUndefined();
    expect(viewer.textContent).toContain("Owners, admins and responders can schedule maintenance.");
  });

  test("schedules a window with its components, checking the times first", async () => {
    const { container, saved } = panel();
    act(() => button(container, "Schedule maintenance").click());
    act(() => button(container, "Schedule").click());
    expect(container.textContent).toContain("The public needs a title.");
    act(() => type(field(container, "Public title"), "Database upgrade"));
    act(() => type(field(container, "What the public should know"), "Read-only for a minute."));
    act(() => type(field(container, "Ends"), field(container, "Starts").value));
    act(() => button(container, "Schedule").click());
    expect(container.textContent).toContain("The window must end after it starts.");
    act(() =>
      type(
        field(container, "Ends"),
        toLocalInput(fromLocalInput(field(container, "Starts").value) + HOUR),
      ),
    );
    const box = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")][0]!;
    act(() => box.click());
    await act(async () => button(container, "Schedule").click());
    expect(saved).toMatchObject([
      { draft: { title: "Database upgrade", componentIds: ["cmp_api"] }, id: undefined },
    ]);
    expect(saved[0]!.draft.endsAt - saved[0]!.draft.startsAt).toBe(HOUR);
  });

  test("a window under way can end now; calling one off asks first", async () => {
    const { container, ended, cancelled } = panel({
      windows: [windowRow({ phase: "in_progress", startsAt: NOW - HOUR })],
    });
    expect(container.textContent).toContain("In progress");
    expect(container.textContent).toContain("API");
    await act(async () => button(container, "End now").click());
    expect(ended).toEqual(["mnt_1"]);
    act(() => button(container, "Call off").click());
    expect(container.textContent).toContain("Call off Database upgrade?");
    await act(async () => button(container, "Call off").click());
    expect(cancelled).toEqual(["mnt_1"]);
  });

  test("the draft check mirrors the shard's limits", () => {
    const draft = { title: "x", body: "y", componentIds: [], startsAt: NOW, endsAt: NOW + HOUR };
    expect(checkDraft(draft, NOW)).toBeNull();
    expect(checkDraft({ ...draft, endsAt: NOW + 15 * 24 * HOUR }, NOW)).toBe("too_long");
    expect(checkDraft({ ...draft, startsAt: Number.NaN }, NOW)).toBe("times_required");
    expect(checkDraft(draft, NOW + 2 * HOUR)).toBe("ended");
  });

  test("pt-BR", async () => {
    await setI18nLocale("pt-BR");
    const { container } = panel({ windows: [windowRow()] });
    expect(container.textContent).toContain("Manutenção programada");
    expect(container.textContent).toContain("Programada");
  });
});

const page: StatusPageRow = {
  id: "status_page",
  slug: "acme",
  title: "Acme",
  locale: "en",
  enabled: true,
  updatedAt: 0,
  updatedBy: "usr_ana",
};

describe("status page card, slice 2", () => {
  test("links a component to monitors for its uptime bar", async () => {
    const links: unknown[] = [];
    const container = mount(
      <StatusPagePanel
        page={page}
        components={[{ ...component("cmp_api", "API"), monitorIds: ["mon_a"] }]}
        loading={false}
        failed={false}
        manage
        origin="https://brigade.test"
        monitors={[
          { id: "mon_a", name: "API health" },
          { id: "mon_b", name: "Checkout" },
        ]}
        onSave={async () => ({ ok: true })}
        onCreate={async () => true}
        onUpdate={async () => true}
        onDelete={async () => true}
        onLink={async (id, monitorIds) => {
          links.push({ id, monitorIds });
          return true;
        }}
        onRetry={() => {}}
      />,
    );
    expect(container.textContent).toContain("Uptime from API health");
    act(() => button(container, "Edit").click());
    const checkout = [...container.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Checkout"),
    )!;
    act(() => checkout.querySelector("input")!.click());
    expect(checkout.querySelector("input")!.checked).toBe(true);
    // The component's own Save, not the page settings' above it.
    await act(async () => button(container.querySelector("li form")!, "Save").click());
    expect(links).toEqual([{ id: "cmp_api", monitorIds: ["mon_a", "mon_b"] }]);
  });

  test("owners see the subscriber count, export and remove by address", async () => {
    const removed: string[] = [];
    let loads = 0;
    const container = mount(
      <StatusPagePanel
        page={page}
        components={[]}
        loading={false}
        failed={false}
        manage
        origin="https://brigade.test"
        onSave={async () => ({ ok: true })}
        onCreate={async () => true}
        onUpdate={async () => true}
        onDelete={async () => true}
        onRetry={() => {}}
        subscribers={{
          load: async () => {
            loads++;
            return { confirmed: 1204, pending: 3 };
          },
          remove: async (email) => {
            removed.push(email);
            return email === "gone@example.com" ? "not_found" : "removed";
          },
          exportUrl: "/api/workspaces/ws_1/status-page/subscribers/export",
        }}
      />,
    );
    await act(async () => {});
    expect(container.textContent).toContain("1,204 confirmed, 3 waiting to confirm");
    expect(container.querySelector("a[download]")?.getAttribute("href")).toBe(
      "/api/workspaces/ws_1/status-page/subscribers/export",
    );
    act(() => type(field(container, "Remove a subscriber"), "gone@example.com"));
    await act(async () => button(container, "Remove").click());
    expect(container.textContent).toContain("No subscriber has that address.");
    act(() => type(field(container, "Remove a subscriber"), "lia@example.com"));
    await act(async () => button(container, "Remove").click());
    expect(container.textContent).toContain("Removed lia@example.com.");
    expect(removed).toEqual(["gone@example.com", "lia@example.com"]);
    expect(loads).toBe(2);
  });

  test("the subscribers API helpers", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return init?.method === "DELETE"
        ? new Response(null, { status: 404 })
        : Response.json({ confirmed: 2, pending: 0 });
    }) as typeof fetch;
    expect(await loadSubscriberCounts("ws_1", fetcher)).toEqual({ confirmed: 2, pending: 0 });
    expect(await removeSubscriber("ws_1", "a@example.com", fetcher)).toBe("not_found");
    expect(calls[1]).toMatchObject({
      url: "/api/workspaces/ws_1/status-page/subscribers",
      init: { method: "DELETE", body: JSON.stringify({ email: "a@example.com" }) },
    });
  });
});
