// @vitest-environment happy-dom
// The dashboard's Slack card (RFC 0011): starting an install, reading how it came back, checking a channel id, and
// what owners, admins and everyone else see and can do.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { SlackRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { SlackPanel } from "../src/components/slack-card";
import { checkChannel, listSlackChannels, slackResult, startSlackInstall } from "../src/lib/slack";

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
  const calls = { add: 0, saves: [] as unknown[], disconnects: 0, retries: 0, reloads: 0 };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SlackPanel
        connection={null}
        channels={{
          status: "ready",
          channels: [
            { id: "C0CHAN0001", name: "incidents", private: false },
            { id: "G0PRIVATE1", name: "sre-oncall", private: true },
          ],
        }}
        onReloadChannels={() => {
          calls.reloads++;
        }}
        loading={false}
        failed={false}
        manage
        result={null}
        onAdd={async () => {
          calls.add++;
        }}
        onSave={async (settings) => {
          calls.saves.push(settings);
          return true;
        }}
        onDisconnect={async () => {
          calls.disconnects++;
          return true;
        }}
        onRetry={() => {
          calls.retries++;
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

test("listSlackChannels reads the API's list, and anything else as failed", async () => {
  const ok = vi.fn(async () =>
    Response.json({
      channels: [
        { id: "C0CHAN0001", name: "incidents", private: false },
        { id: "nope", name: "bad" },
      ],
    }),
  );
  expect(await listSlackChannels("ws_x", ok as typeof fetch)).toEqual({
    status: "ready",
    channels: [{ id: "C0CHAN0001", name: "incidents", private: false }],
  });
  expect(ok).toHaveBeenCalledWith("/api/workspaces/ws_x/slack/channels", expect.anything());
  const refused = async () => Response.json({ error: "slack_failed" }, { status: 502 });
  expect(await listSlackChannels("ws_x", refused as typeof fetch)).toEqual({ status: "failed" });
  const offline = async () => {
    throw new TypeError("offline");
  };
  expect(await listSlackChannels("ws_x", offline as typeof fetch)).toEqual({ status: "failed" });
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

  test("a connection that could not be read is not shown as disconnected, and can be asked for again", () => {
    const { container, calls } = render({ failed: true });
    expect(container.textContent).toContain("Couldn't load the Slack connection");
    expect(container.textContent).not.toContain("Not connected");
    expect(button(container, "Add to Slack")).toBeUndefined();
    act(() => button(container, "Try again")!.click());
    expect(calls.retries).toBe(1);
    expect(calls.add).toBe(0);
  });

  test("while it loads, neither a state nor Add to Slack", () => {
    const { container } = render({ loading: true });
    expect(container.textContent).not.toContain("Not connected");
    expect(container.textContent).not.toContain("Couldn't load");
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  test("the error reads in Portuguese too", () => {
    void setI18nLocale("pt-BR");
    const { container } = render({ failed: true, manage: false });
    expect(container.textContent).toContain("Não foi possível carregar a conexão com o Slack");
    expect(button(container, "Tentar de novo")).toBeDefined();
  });

  test("responders and viewers read it and get no buttons", () => {
    const { container } = render({ manage: false, connection });
    expect(container.textContent).toContain("Connected to Acme Slack");
    expect(container.textContent).toContain("Incidents are posted in C0CHAN0001.");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelector("input")).toBeNull();
  });

  test("picks a channel from Slack's list and saves it with its name", async () => {
    const { container, calls } = render({ connection: { ...connection, channelId: null } });
    expect(container.textContent).toContain("No channel yet");
    const select = container.querySelector("select")!;
    expect([...select.options].map((one) => one.textContent)).toEqual([
      "No channel",
      "#incidents",
      "#sre-oncall (private)",
    ]);
    act(() => {
      select.value = "G0PRIVATE1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(container, "Save")!.click());
    expect(calls.saves).toEqual([
      {
        channelId: "G0PRIVATE1",
        channelName: "sre-oncall",
        incidentChannels: "off",
        privateChannels: false,
        archiveAfterHours: null,
      },
    ]);
    expect(container.textContent).toContain("Saved.");
  });

  test("channel messages follow the workspace's language, which the card names and does not pick (Q15)", () => {
    const { container } = render({ connection, workspaceLocale: "pt-BR" });
    expect(container.textContent).toContain(
      "Channel messages are written in the workspace's language: Português (Brasil).",
    );
    // One select (the channel) and the incident channels' ones: no language picker among them.
    for (const select of container.querySelectorAll("select")) {
      expect([...select.options].map((one) => one.value)).not.toContain("pt-BR");
    }
  });

  test("a workspace whose row did not load names no language rather than English", () => {
    const { container } = render({ connection, workspaceLocale: undefined });
    expect(container.textContent).not.toContain("workspace's language");
  });

  test("a saved channel Slack no longer lists stays a choice", () => {
    const { container } = render({
      connection: { ...connection, channelId: "C0GONE0001", channelName: "old-incidents" },
    });
    expect(container.textContent).toContain("Incidents are posted in #old-incidents.");
    const select = container.querySelector("select")!;
    expect(select.value).toBe("C0GONE0001");
    expect(select.selectedOptions[0]?.textContent).toBe("#old-incidents (not in the list)");
  });

  test("when Slack's list cannot be read, a channel id is typed and checked instead", async () => {
    const { container, calls } = render({
      connection: { ...connection, channelId: null },
      channels: { status: "failed" },
    });
    expect(container.textContent).toContain("Couldn't load the channels from Slack");
    act(() => button(container, "Reload channels")!.click());
    expect(calls.reloads).toBe(1);
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
    expect(calls.saves).toEqual([
      expect.objectContaining({ channelId: "G0PRIVATE1", channelName: null }),
    ]);
  });

  test("while the channels load the form waits", () => {
    const { container } = render({ connection, channels: { status: "loading" } });
    const select = container.querySelector("select")!;
    expect(select.disabled).toBe(true);
    expect(select.textContent).toBe("Loading channels from Slack…");
    expect(button(container, "Save")!.disabled).toBe(true);
  });

  test("a channel per incident: off until chosen, then private and archiving can be set", async () => {
    const { container, calls } = render({ connection });
    const [, perIncident, archive] = [...container.querySelectorAll("select")];
    const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(archive!.disabled).toBe(true);
    expect(checkbox.disabled).toBe(true);
    const pick = (element: HTMLSelectElement, value: string) =>
      act(() => {
        element.value = value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      });
    pick(perIncident!, "major");
    expect(archive!.disabled).toBe(false);
    pick(archive!, "24");
    act(() => checkbox.click());
    await act(async () => button(container, "Save")!.click());
    expect(calls.saves).toEqual([
      expect.objectContaining({
        incidentChannels: "major",
        privateChannels: true,
        archiveAfterHours: 24,
      }),
    ]);
  });

  test("a connection Slack revoked says so and offers to connect again, without the form", () => {
    const { container, calls } = render({
      connection: { ...connection, revokedAt: 1, revokedReason: "uninstalled" },
    });
    expect(container.textContent).toContain("Brigade was removed from Acme Slack in Slack");
    expect(container.querySelector("select")).toBeNull();
    act(() => button(container, "Connect again")!.click());
    expect(calls.add).toBe(1);
    // It can still be disconnected for good.
    expect(button(container, "Disconnect")).toBeDefined();
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
