// @vitest-environment happy-dom
// The paging self-check notice (apps/api src/watchdog.ts): hidden while all is well, the reasons when degraded, and
// "couldn't check" when the API cannot say.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { PagingHealthNotice } from "../src/components/paging-health";
import { PreferencesProvider } from "../src/components/preferences";
import {
  fetchPagingHealth,
  PAGING_HEALTH_PATH,
  PAGING_REFRESH_MS,
  pagingView,
  parsePagingHealth,
  UNREACHABLE,
} from "../src/lib/paging-health";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const answer = (body: unknown, status = 200) =>
  (async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("parsePagingHealth", () => {
  test("reads the API's answer; drops reasons it does not know", () => {
    expect(
      parsePagingHealth({
        status: "degraded",
        reasons: ["relay_unreachable", "a_future_reason"],
        lastOkAt: "2026-10-25T12:00:00.000Z",
        lastBeatAt: "2026-10-25T12:01:00.000Z",
        external: { configured: true },
      }),
    ).toEqual({
      status: "degraded",
      reasons: ["relay_unreachable"],
      lastOkAt: new Date("2026-10-25T12:00:00.000Z"),
      relay: null,
    });
    expect(parsePagingHealth({ status: "ok", reasons: [], lastOkAt: "not a date" })).toEqual({
      status: "ok",
      reasons: [],
      lastOkAt: null,
      relay: null,
    });
  });

  test("without a session the API says only the status: still an answer, with no reasons", () => {
    expect(parsePagingHealth({ status: "degraded" })).toEqual({
      status: "degraded",
      reasons: [],
      lastOkAt: null,
      relay: null,
    });
  });

  test("anything else is not an answer", () => {
    for (const body of [
      null,
      "ok",
      { status: "fine", reasons: [] },
      { status: "ok", reasons: 1 },
    ]) {
      expect(parsePagingHealth(body), JSON.stringify(body)).toBeUndefined();
    }
  });
});

describe("fetchPagingHealth", () => {
  test("asks the API through the web Worker, with the session's cookie", async () => {
    let asked = "";
    let init: RequestInit | undefined;
    const fetcher = (async (input: string, options?: RequestInit) => {
      asked = input;
      init = options;
      return Response.json({ status: "ok", reasons: [], lastOkAt: null, relay: null });
    }) as typeof fetch;
    expect(await fetchPagingHealth(fetcher)).toMatchObject({ status: "ok" });
    expect(asked).toBe(PAGING_HEALTH_PATH);
    expect(init?.credentials).toBe("same-origin");
  });

  test("an error answer, a bad body or no network is unreachable", async () => {
    expect(await fetchPagingHealth(answer({ error: "unavailable" }, 503))).toEqual(UNREACHABLE);
    expect(await fetchPagingHealth(answer({ nope: true }))).toEqual(UNREACHABLE);
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(await fetchPagingHealth(offline)).toEqual(UNREACHABLE);
    const html = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    expect(await fetchPagingHealth(html)).toEqual(UNREACHABLE);
  });

  test("with the watchdog down, a member's 503 still says which relay", async () => {
    const relay = { kind: "own", host: "relay.acme.example", app: "https://apps.example.com/x" };
    expect(await fetchPagingHealth(answer({ error: "unavailable", relay }, 503))).toEqual({
      status: "unreachable",
      relay,
    });
  });
});

test("pagingView: quiet while loading and when all is well", () => {
  expect(pagingView(undefined)).toEqual({ kind: "hidden" });
  expect(pagingView({ status: "ok", reasons: [], lastOkAt: null, relay: null })).toEqual({
    kind: "hidden",
  });
  expect(pagingView({ status: "unknown", reasons: [], lastOkAt: null, relay: null })).toEqual({
    kind: "unknown",
  });
  expect(pagingView(UNREACHABLE)).toEqual({ kind: "unreachable" });
});

describe("PagingHealthNotice", () => {
  let root: Root | undefined;
  let container: HTMLElement;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
  });

  async function mount(fetcher: typeof fetch, locale: "en" | "pt-BR" = "en") {
    void setI18nLocale(locale);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        <PreferencesProvider initialLocale={locale}>
          <PagingHealthNotice fetcher={fetcher} />
        </PreferencesProvider>,
      );
    });
    // Let the check's promise settle and render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return container;
  }

  test("renders nothing when pages get through", async () => {
    const shown = await mount(answer({ status: "ok", reasons: [], lastOkAt: null, relay: null }));
    expect(shown.textContent).toBe("");
  });

  test("degraded: an alert with every reason and when the last self-check got through", async () => {
    const shown = await mount(
      answer({
        status: "degraded",
        reasons: ["pipeline_stalled", "relay_not_configured"],
        lastOkAt: "2026-10-25T12:00:00.000Z",
      }),
    );
    const alert = shown.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Pages may not reach phones");
    expect(alert?.textContent).toContain(
      "The self-check's heartbeat stopped getting through the event queue",
    );
    expect(alert?.textContent).toContain("No push relay is set up");
    expect(alert?.textContent).toContain("Last self-check that got through:");
  });

  test("a relay that refuses the send token says so, in pt-BR too", async () => {
    const body = { status: "degraded", reasons: ["relay_unauthorized"], lastOkAt: null };
    expect((await mount(answer(body))).textContent).toContain(
      "The push relay refused Brigade's send token",
    );
    act(() => root?.unmount());
    container.remove();
    expect((await mount(answer(body), "pt-BR")).textContent).toContain(
      "O relay de push recusou o token de envio do Brigade",
    );
  });

  test("checks only while the tab is visible, and again when it comes back", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let visibility: DocumentVisibilityState = "visible";
    const state = vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return Response.json({ status: "ok", reasons: [] });
    }) as unknown as typeof fetch;
    try {
      /** Runs `step` and lets any check it started settle and render. */
      const settle = (step: () => void) =>
        act(async () => {
          step();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      const visible = (next: DocumentVisibilityState) =>
        settle(() => {
          visibility = next;
          document.dispatchEvent(new Event("visibilitychange"));
        });
      await mount(fetcher);
      expect(calls).toBe(1);
      await visible("hidden");
      await settle(() => vi.advanceTimersByTime(PAGING_REFRESH_MS * 3));
      expect(calls).toBe(1);
      await visible("visible");
      expect(calls).toBe(2);
      await settle(() => vi.advanceTimersByTime(PAGING_REFRESH_MS));
      expect(calls).toBe(3);
    } finally {
      state.mockRestore();
      vi.useRealTimers();
    }
  });

  test("the API cannot say: an alert too, in pt-BR as well", async () => {
    const shown = await mount(answer({ error: "unavailable" }, 503), "pt-BR");
    expect(shown.querySelector('[role="alert"]')?.textContent).toBe(
      "Não foi possível verificar se os acionamentos estão saindo",
    );
  });

  test("never run: a neutral note, not an alert", async () => {
    const shown = await mount(
      answer({ status: "unknown", reasons: [], lastOkAt: null, relay: null }),
    );
    expect(shown.querySelector('[role="alert"]')).toBeNull();
    expect(shown.textContent).toContain("hasn't run yet");
  });
});
