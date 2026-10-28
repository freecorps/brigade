// @vitest-environment happy-dom
// The notice after taking back an account someone else signed up with (RFC 0002 "Auth"): what the API answers, what
// it says per workspace, and dismissing it for good.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { PreferencesProvider } from "../src/components/preferences";
import { TakeoverNotice } from "../src/components/takeover-notice";
import { fetchTakeover, parseTakeover, TAKEOVER_PATH } from "../src/lib/takeover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const inherited = [
  {
    id: "ws_1",
    name: "Squat",
    paused: ["Their host", "Their cron"],
    revoked: 1,
    sources: 2,
    routes: 1,
    failed: false,
  },
  { id: "ws_2", name: "Empty", paused: [], revoked: 0, sources: 0, routes: 0, failed: false },
  {
    id: "ws_4",
    name: "Chatty",
    paused: [],
    revoked: 0,
    sources: 0,
    routes: 0,
    slack: "Squat Slack",
    failed: false,
  },
  { id: "ws_3", name: "Unreachable", paused: [], revoked: 0, sources: 0, routes: 0, failed: true },
];

describe("parseTakeover", () => {
  test("reads the API's notice; nothing for none or a body of another shape", () => {
    expect(parseTakeover({ notice: { at: 1, workspaces: inherited } })).toEqual(inherited);
    expect(parseTakeover({ notice: null })).toBe(undefined);
    expect(parseTakeover({ notice: { workspaces: [] } })).toBe(undefined);
    expect(parseTakeover({ notice: { workspaces: [{ id: "ws_1", paused: "x" }] } })).toBe(
      undefined,
    );
    expect(parseTakeover("nope")).toBe(undefined);
  });

  test("a failed read shows nothing, and the notice comes back next time", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await fetchTakeover(failing)).toBe(undefined);
    const refused = (async () => Response.json({}, { status: 401 })) as unknown as typeof fetch;
    expect(await fetchTakeover(refused)).toBe(undefined);
  });
});

describe("TakeoverNotice", () => {
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
          <TakeoverNotice fetcher={fetcher} />
        </PreferencesProvider>,
      );
    });
    await settle();
    return container;
  }

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 3; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    });

  /** The API: the notice until a DELETE (answered `deleteStatus`), then none. */
  function api(deleteStatus = 204) {
    const calls: string[] = [];
    let dismissed = false;
    const fetcher = (async (url: string, init?: RequestInit) => {
      expect(url).toBe(TAKEOVER_PATH);
      const method = init?.method ?? "GET";
      calls.push(method);
      if (method === "DELETE") {
        dismissed = deleteStatus === 204;
        return new Response(null, { status: deleteStatus });
      }
      return Response.json({ notice: dismissed ? null : { at: 1, workspaces: inherited } });
    }) as unknown as typeof fetch;
    return { fetcher, calls };
  }

  test("nothing without a notice", async () => {
    const shown = await mount((async () =>
      Response.json({ notice: null })) as unknown as typeof fetch);
    expect(shown.textContent).toBe("");
  });

  test("lists each workspace and what was paused, then goes away for good", async () => {
    const { fetcher, calls } = api();
    const shown = await mount(fetcher);
    expect(shown.querySelector("h2")?.textContent).toBe("You took this account back");
    const items = [...shown.querySelectorAll("li")].map((item) => item.textContent);
    expect(items).toEqual([
      "Squat2 monitors paused: Their host, Their cron. 1 heartbeat URL turned off. 2 alert source URLs turned off. 1 alert route turned off",
      "EmptyNothing there needed turning off.",
      "ChattySlack disconnected from Squat Slack",
      "UnreachableBrigade couldn't reach this workspace, so nothing in it was paused. Check its monitors now.",
    ]);
    await act(async () => shown.querySelector("button")!.click());
    await settle();
    expect(calls).toEqual(["GET", "DELETE"]);
    expect(shown.textContent).toBe("");
  });

  test("a dismissal that fails says so and keeps the notice", async () => {
    const { fetcher } = api(503);
    const shown = await mount(fetcher);
    await act(async () => shown.querySelector("button")!.click());
    await settle();
    expect(shown.querySelector("h2")).not.toBeNull();
    expect(shown.querySelector('[role="status"]')?.textContent).toBe(
      "Couldn't hide this notice. Try again.",
    );
  });

  test("reads in pt-BR", async () => {
    const shown = await mount(api().fetcher, "pt-BR");
    expect(shown.querySelector("h2")?.textContent).toBe("Você recuperou esta conta");
    expect(shown.querySelector("li")?.textContent).toContain("2 monitores pausados");
    expect(shown.textContent).toContain("Slack desconectado de Squat Slack");
  });
});
