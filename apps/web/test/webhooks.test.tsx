// @vitest-environment happy-dom
// The dashboard's Webhooks card (RFC 0005 "Outbound webhooks"): checking a draft, the secret requests, how an
// endpoint and its deliveries read, and what adding, editing and the one-time secret do.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { WebhookRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { WebhooksManageOnly, WebhooksPanel } from "../src/components/webhooks-card";
import { checkDraft, emptyDraft, requestSecret, shownUrl, webhookName } from "../src/lib/webhooks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const row = (more: Partial<WebhookRow> = {}): WebhookRow => ({
  id: "whk_01JB0000000000000000000001",
  url: "https://hooks.example.com/brigade?token=not-a-real-token",
  description: "Ops bot",
  events: ["incident.declared", "incident.acknowledged"],
  enabled: true,
  disabledReason: null,
  disabledAt: null,
  failures: 0,
  failingSince: null,
  lastTestAt: null,
  secretRotatedAt: NOW,
  recent: [],
  createdAt: NOW - 86_400_000,
  createdBy: "usr_ana",
  updatedAt: NOW,
  ...more,
});

function render(props: Partial<Parameters<typeof WebhooksPanel>[0]> = {}) {
  const calls = {
    creates: [] as unknown[],
    updates: [] as unknown[],
    toggles: [] as unknown[],
    deletes: [] as string[],
    tests: [] as string[],
    rotations: [] as string[],
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <WebhooksPanel
        rows={[]}
        loading={false}
        failed={false}
        locale="en"
        now={NOW}
        onCreate={async (draft) => {
          calls.creates.push(draft);
          return {
            ok: true,
            id: "whk_x",
            secret: "whsec_dGVzdC1vbmx5LW5vdC1hLXJlYWwtc2VjcmV0LXh4eHg=",
          };
        }}
        onRotate={async (id) => {
          calls.rotations.push(id);
          return { ok: true, id, secret: "whsec_c2Vjb25kLXRlc3Qtb25seS1ub3QtcmVhbC14eHh4eA==" };
        }}
        onUpdate={async (id, draft) => {
          calls.updates.push({ id, draft });
          return true;
        }}
        onSetEnabled={async (id, enabled) => {
          calls.toggles.push({ id, enabled });
          return true;
        }}
        onDelete={async (id) => {
          calls.deletes.push(id);
          return true;
        }}
        onTest={async (id) => {
          calls.tests.push(id);
          return "sent";
        }}
        onRetry={() => {}}
        {...props}
      />,
    ),
  );
  return { container, calls };
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === text);

function type(input: HTMLInputElement, value: string) {
  act(() => {
    // The prototype's setter, with the input as receiver, as React's value tracker listens for it.
    Reflect.set(HTMLInputElement.prototype, "value", value, input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const flush = () => act(async () => {});

describe("drafts and names", () => {
  test("checks the URL by the same rules as the shard, and wants an event", () => {
    expect(checkDraft({ ...emptyDraft(), url: " https://hooks.example.com/x " })).toMatchObject({
      ok: true,
      value: { url: "https://hooks.example.com/x" },
    });
    for (const url of [
      "",
      "http://hooks.example.com/",
      "https://10.0.0.1/",
      "https://localhost/",
    ]) {
      expect(checkDraft({ ...emptyDraft(), url })).toMatchObject({
        ok: false,
        issues: { url: expect.any(String) },
      });
    }
    expect(
      checkDraft({ url: "https://hooks.example.com/", description: "", events: [] }),
    ).toMatchObject({
      ok: false,
      issues: { events: "Pick at least one event." },
    });
  });

  test("a row never shows the URL's query, where receivers put tokens", () => {
    expect(shownUrl("https://hooks.example.com/brigade?token=abc#x")).toBe(
      "hooks.example.com/brigade",
    );
    expect(shownUrl("https://hooks.example.com/")).toBe("hooks.example.com");
    expect(webhookName({ url: "https://hooks.example.com/x", description: "" })).toBe(
      "hooks.example.com",
    );
  });
});

describe("requestSecret", () => {
  test("creates with the draft, rotates without one", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ id: "whk_x", secret: "whsec_x" }, { status: 201 }),
    );
    const draft = {
      url: "https://hooks.example.com/",
      description: "",
      events: ["alert.fired" as const],
    };
    expect(await requestSecret("ws_x", "whk_x", draft, fetcher as typeof fetch)).toEqual({
      ok: true,
      id: "whk_x",
      secret: "whsec_x",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/ws_x/webhooks",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ id: "whk_x", ...draft }) }),
    );
    await requestSecret("ws_x", "whk_x", null, fetcher as typeof fetch);
    expect(fetcher).toHaveBeenLastCalledWith(
      "/api/workspaces/ws_x/webhooks/whk_x/rotate",
      expect.anything(),
    );
  });

  test("says why it was refused, and which field", async () => {
    const answer = (status: number, body: unknown) => async () => Response.json(body, { status });
    expect(
      await requestSecret(
        "ws_x",
        "whk_x",
        emptyDraft(),
        answer(400, { error: "invalid_args", issues: [{ path: "url" }] }) as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "invalid_args", field: "url" });
    expect(
      await requestSecret(
        "ws_x",
        "whk_x",
        null,
        answer(503, { error: "not_configured" }) as typeof fetch,
      ),
    ).toEqual({
      ok: false,
      error: "not_configured",
    });
    const offline = async () => {
      throw new TypeError("offline");
    };
    expect(await requestSecret("ws_x", "whk_x", null, offline as typeof fetch)).toEqual({
      ok: false,
      error: "network",
    });
  });
});

describe("WebhooksPanel", () => {
  test("empty: says what webhooks do, and Add endpoint opens the form", () => {
    const { container } = render();
    expect(container.textContent).toContain("No endpoints yet.");
    act(() => button(container, "Add endpoint")!.click());
    expect(container.querySelector("form")).not.toBeNull();
    // Every event is picked to start with.
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    expect(boxes.length).toBe(10);
    expect(boxes.every((box) => box.checked)).toBe(true);
  });

  test("adding shows the secret once, with Copy, and closing before copying asks first", async () => {
    const { container, calls } = render();
    act(() => button(container, "Add endpoint")!.click());
    const url = container.querySelector<HTMLInputElement>("input[type=url]")!;
    type(url, "https://hooks.example.com/brigade");
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(calls.creates).toEqual([
      expect.objectContaining({ url: "https://hooks.example.com/brigade", description: "" }),
    ]);
    expect(container.textContent).toContain("Copy the signing secret for hooks.example.com now");
    const secret = container.querySelector<HTMLInputElement>("input[readonly]")!;
    expect(secret.value).toMatch(/^whsec_/);
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Dismiss]")!.click());
    expect(container.textContent).toContain("Close without copying?");
    act(() => button(container, "Close")!.click());
    expect(container.querySelector("input[readonly]")).toBeNull();
  });

  test("a refused URL is said on the field", async () => {
    const { container } = render({
      onCreate: async () => ({ ok: false, error: "invalid_args", field: "url" }),
    });
    act(() => button(container, "Add endpoint")!.click());
    type(
      container.querySelector<HTMLInputElement>("input[type=url]")!,
      "https://hooks.example.com/",
    );
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(container.querySelector("input[type=url]")!.getAttribute("aria-invalid")).toBe("true");
  });

  test("an endpoint reads its state, its events and its last delivery, never its token", () => {
    const { container } = render({
      rows: [
        row({
          recent: [
            {
              eventId: "evt_01JB0000000000000000000001",
              type: "incident.declared",
              attempt: 1,
              at: NOW - 5 * 60_000,
              ok: false,
              status: 503,
              ms: 140,
              error: "status",
              snippet: "upstream unavailable",
            },
          ],
          failures: 1,
          failingSince: NOW - 5 * 60_000,
        }),
      ],
    });
    const text = container.textContent ?? "";
    expect(text).toContain("Ops bot");
    expect(text).toContain("hooks.example.com/brigade");
    expect(text).not.toContain("not-a-real-token");
    expect(text).toContain("2 events");
    expect(text).toContain("Last delivery failed");
    expect(text).toContain("HTTP 503");
    expect(text).toContain("Failing since");
  });

  test("an endpoint Brigade turned off says so, and why", () => {
    const { container } = render({
      rows: [row({ enabled: false, disabledReason: "failing", disabledAt: NOW - 3_600_000 })],
    });
    expect(container.textContent).toContain("Off: failing");
    expect(container.textContent).toContain("Brigade turned this endpoint off");
  });

  test("the editor turns it off, sends a test, rotates (confirmed) and deletes (confirmed)", async () => {
    const { container, calls } = render({ rows: [row()] });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    act(() => button(container, "Turn off")!.click());
    await flush();
    expect(calls.toggles).toEqual([{ id: row().id, enabled: false }]);
    act(() => button(container, "Send test event")!.click());
    await flush();
    expect(calls.tests).toEqual([row().id]);
    expect(container.textContent).toContain("Test event on its way.");
    act(() => button(container, "New secret")!.click());
    expect(calls.rotations).toEqual([]);
    act(() => button(container, "Make new secret")!.click());
    await flush();
    expect(calls.rotations).toEqual([row().id]);
    expect(container.textContent).toContain("New signing secret for hooks.example.com");
    act(() => button(container, "Delete")!.click());
    expect(calls.deletes).toEqual([]);
    act(() => button(container, "Delete endpoint")!.click());
    await flush();
    expect(calls.deletes).toEqual([row().id]);
  });

  test("an unchanged edit sends nothing", async () => {
    const { container, calls } = render({ rows: [row()] });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(calls.updates).toEqual([]);
    expect(container.textContent).toContain("Saved.");
  });

  test("responders and viewers see who manages webhooks, and none of them", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root!.render(<WebhooksManageOnly />));
    expect(container.textContent).toContain("Only owners and admins can see and manage webhooks.");
  });

  test("reads in Portuguese too", () => {
    void setI18nLocale("pt-BR");
    const { container } = render({ rows: [row()] });
    expect(container.textContent).toContain("Ligado");
    expect(container.textContent).toContain("2 eventos");
    expect(container.textContent).toContain("Nenhuma entrega ainda");
  });
});
