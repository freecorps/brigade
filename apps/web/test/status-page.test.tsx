// @vitest-environment happy-dom
// The status page on the dashboard (RFC 0012): its card (settings through the API, components through the shard) and
// the incident page's panel that publishes an update to it.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type {
  StatusComponentRow,
  StatusIncidentRow,
  StatusPageRow,
} from "@freecorps/brigade-schema";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { StatusPagePanel } from "../src/components/status-page-card";
import { StatusPublishPanel, type PublishArgs } from "../src/components/status-publish";
import { saveStatusPage } from "../src/lib/status-page";

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

const page: StatusPageRow = {
  id: "status_page",
  slug: "acme",
  title: "Acme",
  locale: "en",
  enabled: true,
  updatedAt: 0,
  updatedBy: "usr_ana",
};

const component = (id: string, name: string, group: string | null = null): StatusComponentRow => ({
  id,
  name,
  group,
  status: "operational",
  createdAt: 0,
  updatedAt: 0,
});

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text))!;

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const input = (container: HTMLElement, label: string) => {
  const node = [...container.querySelectorAll("label")].find((l) => l.textContent === label)!;
  return document.getElementById(node.htmlFor) as HTMLInputElement;
};

function card(props: Partial<Parameters<typeof StatusPagePanel>[0]> = {}) {
  const saves: unknown[] = [];
  const created: unknown[] = [];
  const container = mount(
    <StatusPagePanel
      page={null}
      components={[]}
      loading={false}
      failed={false}
      manage
      origin="https://brigade.example.com"
      onSave={async (settings) => {
        saves.push(settings);
        return { ok: true };
      }}
      onCreate={async (name, group) => {
        created.push({ name, group });
        return true;
      }}
      onUpdate={async () => true}
      onDelete={async () => true}
      onRetry={() => {}}
      {...props}
    />,
  );
  return { container, saves, created };
}

describe("saveStatusPage", () => {
  test("puts the settings and reads the refusals", async () => {
    const seen: Request[] = [];
    const answer = (status: number, body: unknown) =>
      (async (url: string, init?: RequestInit) => {
        seen.push(new Request(new URL(url, "https://brigade.example.com"), init));
        return Response.json(body, { status });
      }) as typeof fetch;
    const settings = { slug: "acme", title: "Acme", locale: "en" as const, enabled: true };
    expect(await saveStatusPage("ws_1", settings, answer(200, { ok: true }))).toEqual({ ok: true });
    expect(seen[0]?.method).toBe("PUT");
    expect(new URL(seen[0]!.url).pathname).toBe("/api/workspaces/ws_1/status-page");
    expect(await seen[0]!.json()).toEqual(settings);
    expect(await saveStatusPage("ws_1", settings, answer(409, { error: "slug_taken" }))).toEqual({
      ok: false,
      error: "slug_taken",
    });
    expect(await saveStatusPage("ws_1", settings, answer(500, {}))).toEqual({
      ok: false,
      error: "unavailable",
    });
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await saveStatusPage("ws_1", settings, offline)).toEqual({
      ok: false,
      error: "network",
    });
  });
});

describe("StatusPagePanel", () => {
  test("an owner sets it up: a bad address is refused before saving, a good one saved lower-cased", async () => {
    const { container, saves } = card();
    expect(container.textContent).toContain("No status page yet.");
    act(() => button(container, "Set up").click());
    act(() => type(input(container, "Name shown on the page"), "Acme"));
    act(() => type(input(container, "Address"), "a b"));
    await act(async () => button(container, "Save").click());
    expect(container.textContent).toContain("Use 3 to 40 lowercase letters");
    expect(saves).toEqual([]);
    act(() => type(input(container, "Address"), " Acme-Status "));
    await act(async () => button(container, "Save").click());
    expect(saves).toEqual([{ slug: "acme-status", title: "Acme", locale: "en", enabled: false }]);
    expect(container.textContent).toContain("Saved.");
  });

  test("a taken address says so", async () => {
    const { container } = card({ page, onSave: async () => ({ ok: false, error: "slug_taken" }) });
    await act(async () => button(container, "Save").click());
    expect(container.textContent).toContain("Another workspace already uses that address.");
  });

  test("a public page links to its address; a draft says it is not public", () => {
    const live = card({ page });
    expect(live.container.textContent).toContain(
      "Public at https://brigade.example.com/status/acme",
    );
    expect(live.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://brigade.example.com/status/acme",
    );
    act(() => root?.unmount());
    const draft = card({ page: { ...page, enabled: false } });
    expect(draft.container.textContent).toContain("Draft: not public yet.");
  });

  test("components are listed with their status and added by name and group", async () => {
    const { container, created } = card({
      page,
      components: [
        component("cmp_1", "API"),
        { ...component("cmp_2", "Website", "Apps"), status: "major_outage" },
      ],
    });
    expect(container.textContent).toContain("API");
    expect(container.textContent).toContain("Major outage");
    expect(container.textContent).toContain("No group");
    const add = container.querySelectorAll("form")[1]!;
    const [name, group] = [...add.querySelectorAll("input")];
    act(() => type(name!, "  Checkout "));
    act(() => type(group!, "Apps"));
    await act(async () => button(container, "Add component").click());
    expect(created).toEqual([{ name: "Checkout", group: "Apps" }]);
  });

  test("everyone else reads it, with no form", () => {
    const { container } = card({ page, manage: false, components: [component("cmp_1", "API")] });
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.textContent).toContain("Only owners and admins");
    expect(container.textContent).not.toContain("Edit");
  });
});

describe("StatusPublishPanel", () => {
  function panel(props: Partial<Parameters<typeof StatusPublishPanel>[0]> = {}) {
    const published: PublishArgs[] = [];
    const container = mount(
      <StatusPublishPanel
        incidentId="inc_1"
        configured
        components={[component("cmp_1", "API"), component("cmp_2", "Website", "Apps")]}
        published={null}
        allowed
        onPublish={async (args) => {
          published.push(args);
          return true;
        }}
        {...props}
      />,
    );
    return { container, published };
  }

  test("without a page, it says where to set one up", () => {
    const { container } = panel({ configured: false });
    expect(container.textContent).toContain("Set up a status page in the dashboard");
    expect(container.querySelector("button")).toBeNull();
  });

  test("publishes what the responder wrote for the public, starting from a blank title", async () => {
    const { container, published } = panel();
    expect(container.textContent).toContain("Nothing about this incident is on the status page.");
    act(() => button(container, "Publish an update").click());
    expect(input(container, "Public title").value).toBe("");
    await act(async () => button(container, "Publish").click());
    expect(container.textContent).toContain("The public needs a title");
    expect(published).toEqual([]);
    act(() => type(input(container, "Public title"), "Slow API responses"));
    const api = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")][0]!;
    act(() => api.click());
    act(() => type(container.querySelector("textarea")!, "We're looking into it."));
    await act(async () => button(container, "Publish").click());
    expect(published).toEqual([
      {
        id: "inc_1",
        title: "Slow API responses",
        status: "investigating",
        impact: "degraded",
        componentIds: ["cmp_1"],
        body: "We're looking into it.",
      },
    ]);
    expect(container.textContent).toContain("Published.");
  });

  test("a later update starts from what the public was told", () => {
    const row: StatusIncidentRow = {
      id: "inc_1",
      title: "Slow API responses",
      status: "monitoring",
      impact: "partial_outage",
      componentIds: ["cmp_2"],
      updates: [],
      publishedAt: 0,
      resolvedAt: null,
      updatedAt: 0,
    };
    const { container } = panel({ published: row });
    expect(container.textContent).toContain("Monitoring");
    act(() => button(container, "Publish an update").click());
    expect(input(container, "Public title").value).toBe("Slow API responses");
  });

  test("viewers read it and cannot publish", () => {
    const { container } = panel({ allowed: false });
    expect(container.textContent).toContain("Owners, admins and responders can publish");
    expect(container.querySelector("button")).toBeNull();
  });
});
