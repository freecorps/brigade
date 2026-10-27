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
import {
  StatusPublishPanel,
  type Correction,
  type PublishArgs,
} from "../src/components/status-publish";
import {
  componentBlocks,
  moveComponent,
  moveGroup,
  saveStatusPage,
  servicesToLink,
} from "../src/lib/status-page";

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
    expect(container.querySelector("h4")?.textContent).toBe("Apps");
    const add = container.querySelectorAll("form")[1]!;
    const [name, group] = [...add.querySelectorAll("input")];
    act(() => type(name!, "  Checkout "));
    act(() => type(group!, "Apps"));
    await act(async () => button(container, "Add component").click());
    expect(created).toEqual([{ name: "Checkout", group: "Apps" }]);
  });

  test("components move up and down by keyboard, within their group, and groups move as a whole", async () => {
    const orders: string[][] = [];
    const { container } = card({
      page,
      components: [
        component("cmp_1", "API"),
        component("cmp_2", "Website", "Apps"),
        component("cmp_3", "Search"),
        component("cmp_4", "iOS", "Apps"),
        component("cmp_5", "Database", "Core"),
      ],
      onReorder: async (ids) => {
        orders.push(ids);
        return true;
      },
    });
    const move = (label: string) =>
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    // At the top of its group nothing goes up; a group of one has no buttons.
    expect(move("Move API up").disabled).toBe(true);
    expect(move("Move the Apps group up").disabled).toBe(true);
    expect(move("Move Database up")).toBeNull();
    await act(async () => move("Move API down").click());
    await act(async () => move("Move iOS up").click());
    await act(async () => move("Move the Apps group down").click());
    expect(orders).toEqual([
      ["cmp_3", "cmp_1", "cmp_2", "cmp_4", "cmp_5"],
      ["cmp_1", "cmp_3", "cmp_4", "cmp_2", "cmp_5"],
      ["cmp_1", "cmp_3", "cmp_5", "cmp_2", "cmp_4"],
    ]);
    expect(container.textContent).toContain("Moved Apps.");
  });

  test("a move is announced once the server takes it, a refused one only as refused", async () => {
    let settle: (ok: boolean) => void = () => {};
    const { container } = card({
      page,
      components: [component("cmp_1", "API"), component("cmp_2", "Website")],
      onReorder: () => new Promise((resolve) => (settle = resolve)),
    });
    const status = container.querySelector(
      'section[aria-labelledby="status-components-title"] [role="status"]',
    )!;
    const down = () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Move API down"]')!;
    await act(async () => down().click());
    // Not yet confirmed: nothing said.
    expect(status.textContent).toBe("");
    await act(async () => settle(false));
    expect(status.textContent).toBe("");
    expect(container.textContent).toContain("Couldn't change the order");
    await act(async () => down().click());
    expect(container.textContent).not.toContain("Couldn't change the order");
    await act(async () => settle(true));
    expect(status.textContent).toBe("Moved API.");
  });

  test("a component is linked to services, and shows them", async () => {
    const linked: unknown[] = [];
    const { container } = card({
      page,
      components: [{ ...component("cmp_1", "API"), serviceIds: ["svc_1", "svc_gone"] }],
      services: [
        { id: "svc_1", name: "Checkout" },
        { id: "svc_2", name: "Search" },
      ],
      onLinkServices: async (id, serviceIds) => {
        linked.push({ id, serviceIds });
        return true;
      },
    });
    // A deleted service is skipped.
    expect(container.textContent).toContain("Services: Checkout");
    expect(container.textContent).not.toContain("svc_gone");
    act(() => button(container, "Edit").click());
    expect(container.textContent).toContain("starts with this component ticked");
    const search = [...container.querySelectorAll("label")].find(
      (label) => label.textContent === "Search",
    )!;
    act(() => search.querySelector("input")!.click());
    await act(async () => button(container.querySelector("li form")!, "Save").click());
    expect(linked).toEqual([{ id: "cmp_1", serviceIds: ["svc_1", "svc_2"] }]);
  });

  test("a component is not edited before the services load, so a rename keeps its links", async () => {
    const linked: unknown[] = [];
    const updated: unknown[] = [];
    const props = {
      page,
      components: [{ ...component("cmp_1", "API"), serviceIds: ["svc_1"] }],
      onUpdate: async (row: unknown) => {
        updated.push(row);
        return true;
      },
      onLinkServices: async (id: string, serviceIds: string[]) => {
        linked.push({ id, serviceIds });
        return true;
      },
    };
    const { container } = card({ ...props, services: undefined });
    expect(button(container, "Edit").disabled).toBe(true);
    act(() => root?.unmount());
    const loaded = card({ ...props, services: [{ id: "svc_1", name: "Checkout" }] });
    act(() => button(loaded.container, "Edit").click());
    const name = loaded.container.querySelector<HTMLInputElement>("li form input")!;
    act(() => type(name, "Public API"));
    await act(async () => button(loaded.container.querySelector("li form")!, "Save").click());
    expect(updated).toHaveLength(1);
    expect(linked).toEqual([]);
  });

  test("services are linked only when the choice differs from what is stored and still exists", () => {
    const known = [{ id: "svc_1" }, { id: "svc_2" }];
    // Not loaded yet: nothing to link or unlink, whatever the form holds.
    expect(servicesToLink(["svc_1"], undefined, [])).toBeNull();
    expect(servicesToLink(["svc_1", "svc_gone"], known, ["svc_1"])).toBeNull();
    expect(servicesToLink(["svc_1"], known, ["svc_1", "svc_2"])).toEqual(["svc_1", "svc_2"]);
    expect(servicesToLink(["svc_1"], known, [])).toEqual([]);
  });

  test("everyone else reads it, with no form", () => {
    const { container } = card({
      page,
      manage: false,
      components: [component("cmp_1", "API"), component("cmp_2", "Web")],
      onReorder: async () => true,
    });
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelector("button[data-move]")).toBeNull();
    expect(container.textContent).toContain("Only owners and admins");
    expect(container.textContent).not.toContain("Edit");
  });
});

describe("StatusPublishPanel", () => {
  function panel(props: Partial<Parameters<typeof StatusPublishPanel>[0]> = {}) {
    const published: PublishArgs[] = [];
    const corrected: Correction[] = [];
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
        onCorrect={async (correction) => {
          corrected.push(correction);
          return true;
        }}
        {...props}
      />,
    );
    return { container, published, corrected };
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

  const onPage: StatusIncidentRow = {
    id: "inc_1",
    title: "Slow API responses",
    status: "identified",
    impact: "degraded",
    componentIds: [],
    updates: [
      { id: "inc_1:2", at: Date.UTC(2026, 9, 27, 12), status: "investigating", body: "Looking." },
      { id: "inc_1:4", at: Date.UTC(2026, 9, 27, 13), status: "identified", body: "Found it." },
    ],
    publishedAt: 0,
    resolvedAt: null,
    updatedAt: 0,
  };

  test("a published update is corrected in place, saying how long caches may show the old one", async () => {
    const { container, corrected } = panel({ published: onPage });
    const items = [...container.querySelectorAll("li")].map((node) => node.textContent);
    // Newest first.
    expect(items[0]).toContain("Found it.");
    expect(items[1]).toContain("Looking.");
    act(() => button(container, "Edit").click());
    const area = container.querySelector<HTMLTextAreaElement>("li textarea")!;
    expect(area.value).toBe("Found it.");
    expect(container.textContent).toContain("about 2 minutes");
    act(() => type(area, "  "));
    await act(async () => button(container, "Save").click());
    expect(container.textContent).toContain("Write what the public should know.");
    act(() => type(area, "Found it: a bad deploy."));
    await act(async () => button(container, "Save").click());
    expect(corrected).toEqual([
      { kind: "edit", updateId: "inc_1:4", body: "Found it: a bad deploy." },
    ]);
    expect(container.textContent).toContain("Corrected.");
  });

  test("an update is removed after a confirmation; the last one only goes with the incident", async () => {
    const { container, corrected } = panel({ published: onPage });
    act(() => button(container, "Remove").click());
    expect(container.textContent).toContain("Remove this update from the status page?");
    await act(async () => button(container, "Remove").click());
    expect(corrected).toEqual([{ kind: "remove", updateId: "inc_1:4" }]);

    act(() => root?.unmount());
    const one = panel({ published: { ...onPage, updates: [onPage.updates[0]!] } });
    expect(button(one.container, "Remove")).toBeUndefined();
    act(() => button(one.container, "Take off the page").click());
    expect(one.container.textContent).toContain("Take this incident and all its updates off");
    await act(async () =>
      [...one.container.querySelectorAll("button")]
        .filter((node) => node.textContent === "Take off the page")
        .at(-1)!
        .click(),
    );
    expect(one.corrected).toEqual([{ kind: "withdraw" }]);
    expect(one.container.textContent).toContain("Taken off the page.");
  });

  test("a correction the shard refuses says so and keeps the form", async () => {
    const { container } = panel({ published: onPage, onCorrect: async () => false });
    act(() => button(container, "Edit").click());
    act(() => type(container.querySelector<HTMLTextAreaElement>("li textarea")!, "Changed."));
    await act(async () => button(container, "Save").click());
    expect(container.textContent).toContain("Couldn't change the status page.");
    expect(container.querySelector("li textarea")).not.toBeNull();
  });

  test("viewers see what is published and cannot correct it", () => {
    const { container } = panel({ published: onPage, allowed: false });
    expect(container.textContent).toContain("Found it.");
    expect(container.querySelector("button")).toBeNull();
  });

  test("a first publish starts with the components of the incident's services ticked, saying so", async () => {
    const { container, published } = panel({
      serviceIds: ["svc_1"],
      components: [
        component("cmp_1", "API"),
        { ...component("cmp_2", "Website", "Apps"), serviceIds: ["svc_1"] },
      ],
    });
    // Nothing is published by itself.
    expect(published).toEqual([]);
    act(() => button(container, "Publish an update").click());
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map((box) => box.checked)).toEqual([false, true]);
    expect(container.textContent).toContain("Ticked from the incident's services");
    act(() => type(input(container, "Public title"), "Website down"));
    act(() => type(container.querySelector("textarea")!, "Looking."));
    await act(async () => button(container, "Publish").click());
    expect(published[0]?.componentIds).toEqual(["cmp_2"]);
  });

  test("a later publish starts from what the page says, not the services", () => {
    const { container } = panel({
      serviceIds: ["svc_1"],
      components: [
        component("cmp_1", "API"),
        { ...component("cmp_2", "Website"), serviceIds: ["svc_1"] },
      ],
      published: {
        id: "inc_1",
        title: "Slow API",
        status: "investigating",
        impact: "degraded",
        componentIds: ["cmp_1"],
        updates: [{ id: "inc_1:1", at: 0, status: "investigating", body: "Looking." }],
        publishedAt: 0,
        resolvedAt: null,
        updatedAt: 0,
      },
    });
    act(() => button(container, "Publish an update").click());
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.map((box) => box.checked)).toEqual([true, false]);
    expect(container.textContent).not.toContain("Ticked from the incident's services");
  });

  test("viewers read it and cannot publish", () => {
    const { container } = panel({ allowed: false });
    expect(container.textContent).toContain("Owners, admins and responders can publish");
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("component order", () => {
  const rows = [
    { id: "a", group: "Apps" },
    { id: "b", group: null },
    { id: "c", group: "Core" },
    { id: "d", group: "Apps" },
  ];

  test("blocks as the page lists them: ungrouped first, then groups by their first component", () => {
    expect(
      componentBlocks(rows).map((block) => [block.group, block.components.map((r) => r.id)]),
    ).toEqual([
      [null, ["b"]],
      ["Apps", ["a", "d"]],
      ["Core", ["c"]],
    ]);
  });

  test("moves stay inside a group, and groups stay after the ungrouped ones", () => {
    expect(moveComponent(rows, "d", -1)).toEqual(["b", "d", "a", "c"]);
    expect(moveComponent(rows, "a", -1)).toBeNull();
    expect(moveComponent(rows, "b", 1)).toBeNull();
    expect(moveComponent(rows, "missing", 1)).toBeNull();
    expect(moveGroup(rows, "Core", -1)).toEqual(["b", "c", "a", "d"]);
    expect(moveGroup(rows, "Apps", -1)).toBeNull();
    expect(moveGroup(rows, "Core", 1)).toBeNull();
  });
});
