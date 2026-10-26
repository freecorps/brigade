// @vitest-environment happy-dom
// The dashboard's Slack card (RFC 0011): starting an install, reading how it came back, checking a channel id, and
// what owners, admins and everyone else see and can do.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { SlackRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { SlackPanel } from "../src/components/slack-card";
import { checkChannel, slackResult, startSlackInstall } from "../src/lib/slack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

const connection: SlackRow = {
  id: "slack",
  teamId: "T0TEST0001",
  teamName: "Acme Slack",
  channelId: "C0CHAN0001",
  locale: "en",
  connectedAt: 0,
  connectedBy: "usr_ana",
  updatedAt: 0,
};

function render(props: Partial<Parameters<typeof SlackPanel>[0]> = {}) {
  const calls = { add: 0, saves: [] as unknown[], disconnects: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SlackPanel
        connection={null}
        loading={false}
        manage
        result={null}
        onAdd={async () => {
          calls.add++;
        }}
        onSave={async (channelId, locale) => {
          calls.saves.push({ channelId, locale });
          return true;
        }}
        onDisconnect={async () => {
          calls.disconnects++;
          return true;
        }}
        {...props}
      />,
    ),
  );
  return { container, calls };
}

const button = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((one) => one.textContent === text);

describe("startSlackInstall", () => {
  test("posts to the API and goes on to the Slack Worker with the state", async () => {
    const fetcher = vi.fn(async () => Response.json({ state: "ws_x.abc" }));
    expect(await startSlackInstall("ws_x", fetcher as typeof fetch)).toEqual({
      ok: true,
      url: "/slack/install?state=ws_x.abc",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/workspaces/ws_x/slack/install",
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("says why it could not start", async () => {
    const answer = (status: number, error: string) => async () =>
      Response.json({ error }, { status });
    expect(await startSlackInstall("ws_x", answer(503, "not_configured") as typeof fetch)).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(await startSlackInstall("ws_x", answer(500, "weird") as typeof fetch)).toEqual({
      ok: false,
      error: "internal",
    });
    const offline = async () => {
      throw new TypeError("offline");
    };
    expect(await startSlackInstall("ws_x", offline as typeof fetch)).toEqual({
      ok: false,
      error: "network",
    });
  });
});

test("slackResult and checkChannel", () => {
  expect(slackResult("?slack=connected")).toEqual({ ok: true, part: "result_connected" });
  expect(slackResult("?slack=team_taken")).toEqual({ ok: false, part: "result_team_taken" });
  expect(slackResult("?slack=invalid_state")).toEqual({ ok: false, part: "result_failed" });
  expect(slackResult("?other=1")).toBeNull();
  expect(checkChannel("  C0CHAN0001 ")).toEqual({ ok: true, value: "C0CHAN0001" });
  expect(checkChannel("")).toEqual({ ok: true, value: null });
  expect(checkChannel("#incidents")).toEqual({ ok: false });
});

describe("SlackPanel", () => {
  test("not connected: owners and admins get Add to Slack", () => {
    const { container, calls } = render();
    act(() => button(container, "Add to Slack")!.click());
    expect(calls.add).toBe(1);
    expect(container.textContent).toContain("Not connected to a Slack workspace.");
  });

  test("responders and viewers read it and get no buttons", () => {
    const { container } = render({ manage: false, connection });
    expect(container.textContent).toContain("Connected to Acme Slack");
    expect(container.textContent).toContain("Incidents are posted in C0CHAN0001.");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelector("input")).toBeNull();
  });

  test("saves a channel id and the language; refuses what is not a channel id", async () => {
    const { container, calls } = render({ connection: { ...connection, channelId: null } });
    expect(container.textContent).toContain("No channel yet");
    const input = container.querySelector("input")!;
    const type = (value: string) =>
      act(() => {
        Reflect.set(HTMLInputElement.prototype, "value", value, input);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("#incidents");
    await act(async () => button(container, "Save")!.click());
    expect(container.textContent).toContain("A channel ID starts with C or G");
    expect(calls.saves).toHaveLength(0);
    type("G0PRIVATE1");
    await act(async () => button(container, "Save")!.click());
    expect(calls.saves).toEqual([{ channelId: "G0PRIVATE1", locale: "en" }]);
    expect(container.textContent).toContain("Saved.");
  });

  test("disconnecting asks first", async () => {
    const { container, calls } = render({ connection });
    act(() => button(container, "Disconnect")!.click());
    expect(container.textContent).toContain("Disconnect Acme Slack?");
    act(() => button(container, "Keep connected")!.click());
    expect(calls.disconnects).toBe(0);
    act(() => button(container, "Disconnect")!.click());
    await act(async () => button(container, "Disconnect")!.click());
    expect(calls.disconnects).toBe(1);
  });

  test("an install that came back refused says why, in Portuguese too", () => {
    void setI18nLocale("pt-BR");
    const { container } = render({ result: { ok: false, part: "result_team_taken" } });
    expect(container.textContent).toContain("Esse workspace do Slack já está conectado");
    expect(container.textContent).toContain("Adicionar ao Slack");
  });
});
