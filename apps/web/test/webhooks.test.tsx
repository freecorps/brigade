// @vitest-environment happy-dom
// The dashboard's Webhooks card (RFC 0005 "Outbound webhooks"): checking a draft, the secret requests, how an
// endpoint and its deliveries read, and what adding, editing and the one-time secret do.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { WebhookRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { WebhooksManageOnly, WebhooksPanel } from "../src/components/webhooks-card";
import {
  canReplay,
  checkDraft,
  checkHeaders,
  emptyDraft,
  requestHeaders,
  requestSecret,
  shownUrl,
  webhookName,
} from "../src/lib/webhooks";

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
    headers: [] as unknown[],
    replays: [] as unknown[],
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
        onCreate={async (draft, headers) => {
          calls.creates.push(headers.length ? { ...draft, headers } : draft);
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
        onSetHeaders={async (id, headers) => {
          calls.headers.push({ id, headers });
          return {
            ok: true,
            headers: headers.map(({ name }) => ({ name, hint: null })),
          };
        }}
        onReplay={async (id, eventId) => {
          calls.replays.push({ id, eventId });
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
        emptyDraft(),
        answer(400, { error: "invalid_args", issues: [{ path: "events" }] }) as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "invalid_args", field: "events" });
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

describe("requestSecret retries", () => {
  test("sends an Idempotency-Key, and a lost answer is asked again with the same key", async () => {
    const keys: (string | null)[] = [];
    let calls = 0;
    const flaky = async (_url: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      if (++calls === 1) throw new TypeError("connection reset");
      return Response.json({ id: "whk_x", secret: "whsec_x" });
    };
    expect(await requestSecret("ws_x", "whk_x", null, flaky as typeof fetch)).toEqual({
      ok: true,
      id: "whk_x",
      secret: "whsec_x",
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(keys[1]).toBe(keys[0]);
    // A refusal is the answer: never sent twice.
    const refusals: unknown[] = [];
    const refuse = async () => {
      refusals.push(1);
      return Response.json({ error: "forbidden" }, { status: 403 });
    };
    await requestSecret("ws_x", "whk_x", null, refuse as typeof fetch);
    expect(refusals).toHaveLength(1);
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

  test("a refused event filter is said on the field, and a request that threw never leaves the form busy", async () => {
    let attempt = 0;
    const { container } = render({
      onCreate: async () => {
        if (++attempt === 1) throw new Error("socket closed");
        return { ok: false, error: "invalid_args", field: "events" };
      },
    });
    act(() => button(container, "Add endpoint")!.click());
    type(
      container.querySelector<HTMLInputElement>("input[type=url]")!,
      "https://hooks.example.com/",
    );
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(container.querySelector<HTMLButtonElement>("form button[type=submit]")?.disabled).toBe(
      false,
    );
    expect(container.textContent).toContain("Couldn't save. Try again.");
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(container.textContent).toContain("Pick at least one event");
  });

  test("an editor action that threw gives the buttons back and says it failed", async () => {
    const { container } = render({
      rows: [row()],
      onSetEnabled: async () => {
        throw new Error("socket closed");
      },
    });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    act(() => button(container, "Turn off")!.click());
    await flush();
    expect(button(container, "Turn off")?.disabled).toBe(false);
    expect(container.textContent).toContain("Couldn't change it. Try again.");
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

const attempt = (
  more: Partial<WebhookRow["recent"][number]> = {},
): WebhookRow["recent"][number] => ({
  eventId: "evt_01JB0000000000000000000001",
  type: "incident.declared",
  attempt: 6,
  at: NOW - 5 * 60_000,
  ok: false,
  status: 503,
  ms: 140,
  error: "status",
  snippet: null,
  ...more,
});

describe("custom headers", () => {
  test("checks names and values as the API does: reserved, malformed, twice, empty, line breaks", () => {
    expect(
      checkHeaders([
        { name: "Authorization", value: "Bearer x" },
        { name: "", value: "" },
        { name: "X-Team", value: "", kept: true },
      ]),
    ).toEqual({
      ok: true,
      value: [{ name: "Authorization", value: "Bearer x" }, { name: "X-Team" }],
    });
    const checked = checkHeaders([
      { name: "Host", value: "a" },
      { name: "webhook-id", value: "a" },
      { name: "Bad Name", value: "a" },
      { name: "X-A", value: "" },
      { name: "x-a", value: "line\nbreak" },
    ]);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.issues[0]?.name).toBe("Brigade sets this header itself.");
    expect(checked.issues[1]?.name).toBe("Brigade sets this header itself.");
    expect(checked.issues[2]?.name).toContain("letters, digits and hyphens");
    expect(checked.issues[3]?.value).toBe("Enter a value.");
    expect(checked.issues[4]).toEqual({
      name: "This header is listed twice.",
      value: "Use up to 1024 plain ASCII characters, without line breaks.",
    });
  });

  test("requestHeaders PUTs them with a key and reads names and hints back", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return Response.json({ id: "whk_x", headers: [{ name: "Authorization", hint: "6789" }] });
    }) as unknown as typeof fetch;
    const result = await requestHeaders(
      "ws_x",
      "whk_x",
      [{ name: "Authorization" }],
      fetcher,
      "k".repeat(16),
    );
    expect(result).toEqual({ ok: true, headers: [{ name: "Authorization", hint: "6789" }] });
    expect(sent[0]!.url).toBe("/api/workspaces/ws_x/webhooks/whk_x/headers");
    expect(sent[0]!.init.method).toBe("PUT");
    expect(new Headers(sent[0]!.init.headers).get("Idempotency-Key")).toBe("k".repeat(16));
    expect(JSON.parse(sent[0]!.init.body as string)).toEqual({
      headers: [{ name: "Authorization" }],
    });
    const refused = await requestHeaders("ws_x", "whk_x", [], (async () =>
      Response.json(
        { error: "invalid_args", issues: [{ path: "headers[2].value" }] },
        { status: 400 },
      )) as unknown as typeof fetch);
    expect(refused).toEqual({ ok: false, error: "invalid_args", index: 2 });
  });

  test("adding an endpoint sends its headers; a reserved name is said on its field and sends nothing", async () => {
    const { container, calls } = render();
    act(() => button(container, "Add endpoint")!.click());
    type(
      container.querySelector<HTMLInputElement>("input[type=url]")!,
      "https://hooks.example.com/",
    );
    act(() => button(container, "Add header")!.click());
    const [name, value] = [
      ...container.querySelectorAll<HTMLInputElement>("fieldset input:not([type])"),
    ];
    type(name!, "Content-Type");
    type(value!, "text/plain");
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(calls.creates).toEqual([]);
    expect(container.textContent).toContain("Brigade sets this header itself.");
    type(name!, "Authorization");
    type(value!, "Bearer receiver-token-0123456789");
    act(() => container.querySelector("form")!.requestSubmit());
    await flush();
    expect(calls.creates).toEqual([
      expect.objectContaining({
        headers: [{ name: "Authorization", value: "Bearer receiver-token-0123456789" }],
      }),
    ]);
  });

  test("the editor shows each name, never a value, and an edit keeps what is left empty", async () => {
    const { container, calls } = render({
      rows: [
        row({
          headers: [
            { name: "Authorization", hint: "6789" },
            { name: "X-Team", hint: null },
          ],
        }),
      ],
    });
    expect(container.textContent).toContain("2 custom headers");
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    const text = container.textContent ?? "";
    expect(text).toContain("Authorization");
    expect(text).toContain("ends in 6789");
    expect(text).toContain("value hidden");
    act(() => button(container, "Edit headers")!.click());
    const form = button(container, "Save headers")!.closest("form")!;
    const inputs = [...form.querySelectorAll<HTMLInputElement>("input")];
    // Two rows of name and value; the names are the endpoint's, left as they are.
    expect(inputs.map((input) => input.value)).toEqual(["Authorization", "", "X-Team", ""]);
    expect(inputs[0]!.readOnly).toBe(true);
    type(inputs[3]!, "sre");
    act(() => button(container, "Save headers")!.click());
    await flush();
    expect(calls.headers).toEqual([
      { id: row().id, headers: [{ name: "Authorization" }, { name: "X-Team", value: "sre" }] },
    ]);
    expect(container.textContent).toContain("Headers saved.");
  });
});

describe("replaying a delivery", () => {
  test("one Replay per event in the log, on its newest attempt, while the payload is kept", () => {
    const log = [
      attempt({ attempt: 6 }),
      attempt({ attempt: 5, at: NOW - 60 * 60_000 }),
      attempt({ eventId: "evt_01JB0000000000000000000002", attempt: 1, ok: true, status: 200 }),
      attempt({ eventId: "evt_01JB0000000000000000000003", at: NOW - 20 * 86_400_000 }),
    ];
    expect(log.map((_, index) => canReplay(log, index, NOW))).toEqual([true, false, true, false]);
  });

  test("replays from the log, says it went, and marks a replayed attempt", async () => {
    const { container, calls } = render({
      rows: [
        row({
          recent: [
            attempt({ attempt: 1, ok: true, status: 200, replay: true, at: NOW - 60_000 }),
            attempt(),
          ],
        }),
      ],
    });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    const replays = [...container.querySelectorAll("button")].filter((one) =>
      one.textContent?.includes("Replay"),
    );
    expect(replays).toHaveLength(1);
    expect(container.textContent).toContain("Replay");
    act(() => replays[0]!.click());
    await flush();
    expect(calls.replays).toEqual([{ id: row().id, eventId: attempt().eventId }]);
    expect(container.textContent).toContain("Replay on its way, with the same webhook-id.");
  });

  test("an endpoint that is off says to turn it on first, and a replay too soon says to wait", async () => {
    const off = render({
      rows: [row({ enabled: false, disabledReason: "manual", recent: [attempt()] })],
    });
    act(() => off.container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    expect(off.container.textContent).toContain("Turn this endpoint on to replay a delivery.");
    const disabled = [...off.container.querySelectorAll("button")].find((one) =>
      one.getAttribute("aria-label")?.startsWith("Replay"),
    );
    expect(disabled?.disabled).toBe(true);
    act(() => root?.unmount());
    document.body.innerHTML = "";
    const soon = render({ rows: [row({ recent: [attempt()] })], onReplay: async () => "too_soon" });
    act(() => soon.container.querySelector<HTMLButtonElement>("button[aria-label=Edit]")!.click());
    const replay = [...soon.container.querySelectorAll("button")].find((one) =>
      one.getAttribute("aria-label")?.startsWith("Replay"),
    );
    act(() => replay!.click());
    await flush();
    expect(soon.container.textContent).toContain("A delivery was replayed moments ago");
  });

  test("reads in Portuguese too", () => {
    void setI18nLocale("pt-BR");
    const { container } = render({
      rows: [row({ recent: [attempt()], headers: [{ name: "X-Team", hint: null }] })],
    });
    expect(container.textContent).toContain("1 cabeçalho personalizado");
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label=Editar]")!.click());
    expect(container.textContent).toContain("Reenviar");
    expect(container.textContent).toContain("Cabeçalhos personalizados");
    expect(container.textContent).toContain("valor oculto");
  });
});
