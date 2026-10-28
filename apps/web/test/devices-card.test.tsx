// @vitest-environment happy-dom
// The dashboard's "Your phones" card (RFC 0006 "Device registration"): a member's own phones from the synced,
// token-free summaries, each removable after a confirmation, in English and Portuguese.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import { MAX_DEVICES_PER_MEMBER, type DeviceSummaryRow } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { DevicesPanel, ownDevices } from "../src/components/devices-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const device = (n: number, overrides: Partial<DeviceSummaryRow> = {}): DeviceSummaryRow => ({
  id: `dev_01JB0000000000000000000${n.toString(36).toUpperCase().padStart(3, "0")}`,
  userId: "usr_ana",
  platform: "ios",
  environment: "production",
  voip: true,
  registeredAt: NOW - 48 * HOUR,
  lastSeenAt: NOW - n * HOUR,
  ...overrides,
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function render(
  props: Partial<Parameters<typeof DevicesPanel>[0]> = {},
  removes: boolean | "throws" = true,
) {
  const removed: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <DevicesPanel
        rows={[device(1)]}
        loading={false}
        failed={false}
        locale="en"
        now={NOW}
        onRemove={async (id) => {
          removed.push(id);
          if (removes === "throws") throw new Error("socket closed");
          return removes;
        }}
        {...props}
      />,
    ),
  );
  return { container, removed };
}

const buttons = (container: HTMLElement) => Array.from(container.querySelectorAll("button"));
const button = (container: HTMLElement, label: string) =>
  buttons(container).find((one) => one.textContent === label)!;

test("lists only the member's own phones, the one heard from most recently first", () => {
  const rows = [
    device(5),
    device(1, { userId: "usr_bia" }),
    device(2, { platform: "android" }),
    device(9),
  ];
  expect(ownDevices(rows, "usr_ana").map((row) => row.lastSeenAt)).toEqual([
    NOW - 2 * HOUR,
    NOW - 5 * HOUR,
    NOW - 9 * HOUR,
  ]);
});

test("phones heard from at the same time are listed so the last is the one a new phone replaces first", () => {
  // `device.register` replaces the least recently alive first, then the lower id: the reverse of this list.
  const rows = [device(1), device(3), device(2)].map((row) => ({ ...row, lastSeenAt: NOW }));
  expect(ownDevices(rows, "usr_ana").map((row) => row.id)).toEqual([
    device(3).id,
    device(2).id,
    device(1).id,
  ]);
});

test("shows each phone's platform, build, registration, last word and calls", () => {
  const { container } = render({
    rows: [device(1), device(2, { platform: "android", voip: false })],
  });
  const items = Array.from(container.querySelectorAll("li")).map((item) => item.textContent);
  expect(items[0]).toContain("iPhone");
  expect(items[0]).toContain("App Store or TestFlight build");
  expect(items[0]).toContain("Registered 2 days ago");
  expect(items[0]).toContain("Last heard from 1 hour ago");
  expect(items[0]).toContain("Rings as a call");
  expect(items[1]).toContain("Android phone");
  // FCM has no environment: an Android phone is never called a store build.
  expect(items[1]).not.toContain("build");
  expect(items[1]).toContain("Notifications only");
  // "Last heard from" is any registration, one that changed nothing included (`device.touch`), or a receipt.
  expect(container.querySelector("li p[title]")?.getAttribute("title")).toBe(
    "The last time the app registered this phone, even with nothing new to send, or the phone confirmed it showed a page",
  );
});

test("removes a phone only after a confirmation that says a signed-in app comes back", async () => {
  const { container, removed } = render();
  await act(async () => button(container, "Remove").click());
  expect(removed).toEqual([]);
  expect(container.textContent).toContain("registers again as soon as the app is open");
  await act(async () => button(container, "Keep").click());
  expect(removed).toEqual([]);
  await act(async () => button(container, "Remove").click());
  await act(async () => button(container, "Remove phone").click());
  expect(removed).toEqual([device(1).id]);
});

test("a refused removal says so", async () => {
  const { container } = render({}, false);
  await act(async () => button(container, "Remove").click());
  await act(async () => button(container, "Remove phone").click());
  expect(container.textContent).toContain("Couldn't remove this phone");
});

test("a removal that throws says it failed and leaves the confirmation usable", async () => {
  const { container, removed } = render({}, "throws");
  await act(async () => button(container, "Remove").click());
  await act(async () => button(container, "Remove phone").click());
  expect(container.textContent).toContain("Couldn't remove this phone");
  const go = button(container, "Remove phone");
  expect(go.disabled).toBe(false);
  expect(button(container, "Keep").disabled).toBe(false);
  await act(async () => go.click());
  expect(removed).toHaveLength(2);
});

test("says when no phone pages the member, and when the list can't load", () => {
  expect(render({ rows: [] }).container.textContent).toContain("No phone pages you here yet");
  act(() => root?.unmount());
  expect(render({ failed: true }).container.textContent).toContain("Couldn't load your phones");
});

test("the most a member may have, all listed, in Portuguese", async () => {
  await setI18nLocale("pt-BR");
  const rows = Array.from({ length: MAX_DEVICES_PER_MEMBER }, (_, n) => device(n + 1));
  const { container } = render({ rows, locale: "pt-BR" });
  expect(container.querySelectorAll("li")).toHaveLength(MAX_DEVICES_PER_MEMBER);
  expect(container.textContent).toContain("Seus celulares");
  expect(container.textContent).toContain(`até ${MAX_DEVICES_PER_MEMBER}`);
  expect(buttons(container).filter((one) => one.textContent === "Remover")).toHaveLength(
    MAX_DEVICES_PER_MEMBER,
  );
  await act(async () =>
    buttons(container)
      .find((one) => one.textContent === "Remover")!
      .click(),
  );
  // Never "neste Celular Android" mid-sentence.
  expect(container.textContent).toContain("Parar de acionar você neste celular?");
  expect(container.textContent).toContain("assim que o app estiver aberto");
});
