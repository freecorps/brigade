// @vitest-environment happy-dom
// MonitorsCard mounted with react-dom against the reference shard server from packages/sync's tests: the keyboard
// flow of the create form, the confirmed pause, the heartbeat URL panel, and how a down, no-data or paused
// monitor reads.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import { newId, type Actor, type MonitorRow } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient } from "@freecorps/brigade-sync";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { FakeNetwork, FakeServer, FakeTimers } from "../../../packages/sync/tests/fake-server.ts";
import { MonitorsCard } from "../src/components/monitors-card";
import { PreferencesProvider } from "../src/components/preferences";
import { MemberProvider } from "../src/components/session";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The card's relative times read the real clock, so the shard's clock starts there too.
const T0 = Date.now();
const SHARD = "demo";
const owner: Actor = { kind: "user", id: "usr_dev", role: "owner" };

let root: Root | undefined;
let client: SyncClient | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
    client?.close();
  });
  root = client = undefined;
  Reflect.deleteProperty(navigator, "clipboard");
  document.body.innerHTML = "";
  localStorage.clear();
  void setI18nLocale("en");
});

let seed = 0;
const randomBytes = (length: number) => new Uint8Array(length).fill(++seed % 256);

/** A monitor row as the shard would hold it; `status` and the rest overridable. */
function monitor(overrides: Partial<MonitorRow>): MonitorRow {
  return {
    id: newId("mon", T0 - 1000 * ++seed, randomBytes),
    name: "Checkout",
    kind: "http",
    url: "https://example.com/health",
    method: "GET",
    expectedStatus: null,
    keyword: null,
    timeoutSeconds: 10,
    regions: ["wnam", "enam", "weur"],
    intervalSeconds: 60,
    graceSeconds: null,
    paused: false,
    pausedBy: null,
    pausedAt: null,
    status: "pending",
    since: T0 - 60_000,
    restartedAt: T0 - 60_000,
    checks: [],
    alertId: null,
    incidentId: null,
    createdAt: T0 - 60_000,
    createdBy: "usr_dev",
    updatedAt: T0 - 60_000,
    ...overrides,
  };
}

/** `rows` go straight into the shard's store; `created` through `monitor.createHttp`, as a member would. */
async function mount(rows: MonitorRow[] = [], created: MonitorRow[] = []) {
  const timers = new FakeTimers();
  const server = new FakeServer(() => T0 + timers.now);
  const network = new FakeNetwork(server);
  client = createSyncClient({
    url: (shard) => `ws://test/api/sync/${shard}`,
    actor: owner,
    transport: network.transport(owner),
    timers,
    now: () => T0 + timers.now,
    random: () => 0.5,
    randomBytes,
  });
  const shard = server.shard(SHARD);
  for (const row of rows) shard.store.insert("monitors", row);
  for (const row of created) {
    const {
      id,
      name,
      url,
      method,
      expectedStatus,
      keyword,
      intervalSeconds,
      timeoutSeconds,
      regions,
    } = row;
    const args = {
      id,
      name,
      url,
      method,
      expectedStatus,
      keyword,
      intervalSeconds,
      timeoutSeconds,
    };
    expect(shard.write(owner, "monitor.createHttp", { ...args, regions }).ok).toBe(true);
  }
  const container = document.createElement("div");
  document.body.append(container);
  const syncClient = client;
  act(() => {
    root = createRoot(container);
    root.render(
      <PreferencesProvider initialLocale="en">
        <SyncProvider client={syncClient} shard={SHARD}>
          <MemberProvider workspaceId={SHARD} userId={owner.id} role="owner">
            <MonitorsCard />
          </MemberProvider>
        </SyncProvider>
      </PreferencesProvider>,
    );
  });
  const flush = async () => {
    await act(async () => {
      network.flush();
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await flush();
  return { container, shard, flush };
}

const $$ = (selector: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(selector),
];
const button = (name: string | RegExp, scope: ParentNode = document) =>
  $$("button", scope).find((b) =>
    typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? ""),
  );
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

async function key(element: Element, name: string) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
}

test("the form takes focus on its name, Escape closes it and focus goes back to Add monitor", async () => {
  await mount();
  await click(button("Add monitor"));
  const name = document.activeElement as HTMLInputElement;
  expect(name.tagName).toBe("INPUT");
  expect(document.querySelector(`label[for="${name.id}"]`)?.textContent).toBe("Name");
  // While adding, the empty note is not shown under the form.
  expect(document.body.textContent).not.toContain("Nothing is watched yet");
  await key(name, "Escape");
  expect(document.querySelector("form")).toBeNull();
  expect(document.activeElement).toBe(button("Add monitor"));
});

test("a refused field says what to fix; the regions error is tied to every checkbox", async () => {
  await mount();
  await click(button("Add monitor"));
  for (const box of $$('input[type="checkbox"]').filter((b) => (b as HTMLInputElement).checked)) {
    await click(box);
  }
  await click(button("Create monitor"));
  await frame();
  expect(document.body.textContent).toContain("Give the monitor a name.");
  expect(document.body.textContent).toContain("Pick at least one region.");
  const errorId = $$("p").find((p) => p.textContent === "Pick at least one region.")?.id;
  expect(errorId).toBeTruthy();
  for (const box of $$('input[type="checkbox"]')) {
    expect(box.getAttribute("aria-describedby")).toBe(errorId);
  }
  expect(document.activeElement?.getAttribute("aria-invalid")).toBe("true");
});

test("pausing asks first; cancel keeps it running and returns focus", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  const view = await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  const pause = button("Pause", item())!;
  await click(pause);
  expect(item().textContent).toContain("Pause checks? A firing alert resolves.");
  // The confirm button has focus; Escape cancels.
  expect(document.activeElement?.textContent).toBe("Pause");
  expect(document.activeElement).not.toBe(pause);
  await key(document.activeElement!, "Escape");
  await frame();
  expect(item().textContent).not.toContain("Pause checks?");
  expect(document.activeElement).toBe(button("Pause", item()));

  await click(button("Pause", item()));
  await click(document.activeElement);
  await view.flush();
  expect(view.shard.store.get("monitors", row.id)).toMatchObject({
    paused: true,
    pausedBy: "usr_dev",
  });
  expect(item().textContent).toContain("Paused by you");
  expect(button("Resume", item())).toBeTruthy();
});

test("a down monitor links its incident and says why each region failed; no data is never up", async () => {
  const incidentId = newId("inc", T0, randomBytes);
  const down = monitor({
    name: "Checkout",
    status: "down",
    incidentId,
    alertId: newId("alt", T0, randomBytes),
    checks: [
      {
        source: "wnam",
        at: T0 - 1000,
        up: false,
        latencyMs: 90,
        colo: "SJC",
        httpStatus: 503,
        error: "status",
      },
      {
        source: "enam",
        at: T0 - 1000,
        up: false,
        latencyMs: null,
        colo: "IAD",
        httpStatus: null,
        error: "timeout",
      },
    ],
  });
  const silent = monitor({
    name: "Search",
    status: "unknown",
    regions: ["weur"],
    checks: [
      {
        source: "weur",
        at: T0 - 60 * 60_000,
        up: true,
        latencyMs: 80,
        colo: "CDG",
        httpStatus: 200,
        error: null,
      },
    ],
  });
  await mount([down, silent]);
  const item = (id: string) => document.querySelector(`[data-monitor="${id}"]`)!;
  const link = item(down.id).querySelector("a")!;
  expect(link.getAttribute("href")).toBe(`#incident-${incidentId}`);
  expect(link.textContent).toBe("Open incident");
  expect(item(down.id).textContent).toContain("Got 503, expected 2xx or 3xx");
  expect(item(down.id).textContent).toContain("Timed out");
  expect(item(down.id).textContent).not.toContain("HTTP");
  // weur never reported since the restart.
  expect(item(down.id).textContent).toContain("Western EuropeWaiting");

  expect(item(silent.id).textContent).toContain("No data");
  expect(item(silent.id).textContent).not.toMatch(/\bUp\b/);
});

test("a monitor that went silent while down still links its incident, sorts first and counts as down", async () => {
  const incidentId = newId("inc", T0, randomBytes);
  const fine = monitor({ name: "Account", status: "up" });
  const silent = monitor({
    name: "Zebra checkout",
    status: "unknown",
    regions: ["weur"],
    incidentId,
    alertId: newId("alt", T0, randomBytes),
  });
  await mount([fine, silent]);
  const items = $$("[data-monitor]");
  expect(items.map((item) => item.dataset.monitor)).toEqual([silent.id, fine.id]);
  const [first] = items;
  expect(first!.textContent).toContain("No data");
  expect(first!.querySelector("a")?.getAttribute("href")).toBe(`#incident-${incidentId}`);
  expect(first!.className).toContain("before:bg-sev1");
  expect(items[1]!.querySelector("a")).toBeNull();
  expect(items[1]!.className).not.toContain("before:bg-sev1");
  expect(document.body.textContent).toContain("1 down");
});

/**
 * Browsers drop focus to the body when the node holding it is removed, which a move by `insertBefore` is;
 * happy-dom keeps it. This puts the browser's behaviour back on one list.
 */
function dropFocusOnMove(list: HTMLElement) {
  const blurMoved = (node: Node) => {
    const active = document.activeElement;
    if (node.isConnected && active instanceof HTMLElement && node.contains(active)) active.blur();
  };
  const insertBefore = list.insertBefore.bind(list);
  const appendChild = list.appendChild.bind(list);
  list.insertBefore = function <T extends Node>(node: T, child: Node | null) {
    blurMoved(node);
    return insertBefore(node, child) as T;
  };
  list.appendChild = function <T extends Node>(node: T) {
    blurMoved(node);
    return appendChild(node) as T;
  };
  return () => {
    delete (list as Partial<Pick<HTMLElement, "insertBefore" | "appendChild">>).insertBefore;
    delete (list as Partial<Pick<HTMLElement, "insertBefore" | "appendChild">>).appendChild;
  };
}

// React's commit restores focus on its own, and `useStableFocus` is the fallback; this pins the result either way.
test("a row that re-sorts keeps the focus of a button inside it", async () => {
  const first = monitor({ id: newId("mon", T0 - 2, randomBytes), name: "Alpha" });
  const moving = monitor({ id: newId("mon", T0 - 1, randomBytes), name: "Bravo" });
  const view = await mount([], [first, moving]);
  const ids = () => $$("[data-monitor]").map((item) => item.dataset.monitor);
  expect(ids()).toEqual([first.id, moving.id]);
  // React keeps the renamed row in place and re-inserts the one it passes: that row's button loses focus.
  const pause = button("Pause", document.querySelector(`[data-monitor="${first.id}"]`)!)!;
  act(() => pause.focus());
  expect(document.activeElement).toBe(pause);

  // Renamed elsewhere: the row moves to the top, and React re-inserts it.
  const { id, url, method, expectedStatus, keyword, intervalSeconds, timeoutSeconds, regions } =
    moving;
  expect(
    view.shard.write(owner, "monitor.updateHttp", {
      id,
      name: "Aardvark",
      url,
      method,
      expectedStatus,
      keyword,
      intervalSeconds,
      timeoutSeconds,
      regions,
    }).ok,
  ).toBe(true);
  const restore = dropFocusOnMove(document.querySelector<HTMLElement>("ul[aria-labelledby]")!);
  try {
    await view.flush();
  } finally {
    restore();
  }
  expect(ids()).toEqual([moving.id, first.id]);
  expect(document.activeElement).toBe(pause);
});

/** Types into a controlled input the way React listens for it. */
function setValue(input: HTMLInputElement, value: string) {
  // The prototype's setter, with the input as receiver: React's own value tracker would hide an own-property set.
  Reflect.set(HTMLInputElement.prototype, "value", value, input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A clipboard that resolves or refuses `writeText`, in place of the page's. */
function clipboard(write: (text: string) => Promise<void>) {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => (writes.push(text), write(text)) },
  });
  return writes;
}

/** Creates a heartbeat monitor through the form; its panel shows the URL once. */
async function createHeartbeat() {
  const view = await mount();
  await click(button("Add monitor"));
  const kind = $$('input[type="radio"]').find(
    (radio) => (radio as HTMLInputElement).value === "heartbeat",
  );
  await click(kind);
  const name = $$("input").find(
    (input) => document.querySelector(`label[for="${input.id}"]`)?.textContent === "Name",
  ) as HTMLInputElement;
  act(() => setValue(name, "Nightly backup"));
  await click(button("Create monitor"));
  // The secret is hashed with Web Crypto before the panel shows.
  const readonly = () => document.querySelector<HTMLInputElement>("input[readonly]");
  for (let tries = 0; !readonly() && tries < 50; tries++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  await view.flush();
  const url = readonly()!;
  expect(url?.value).toMatch(/\/heartbeat\//);
  return { ...view, url };
}

test("the heartbeat URL panel focuses Copy, and closing before copying asks", async () => {
  const writes = clipboard(async () => {});
  const { url } = await createHeartbeat();
  expect(document.activeElement).toBe(button("Copy URL"));
  // Not one big live region: only the confirmation is announced.
  expect(url.closest('[role="status"]')).toBeNull();

  const dismiss = () => $$('button[aria-label="Dismiss"]')[0];
  await click(dismiss());
  expect(document.body.textContent).toContain(
    "Close without copying? The URL can't be shown again.",
  );
  expect(document.activeElement).toBe(button("Keep it open"));
  await click(button("Keep it open"));
  expect(document.body.textContent).not.toContain("Close without copying?");

  await click(button("Copy URL"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(writes).toEqual([url.value]);
  expect(button("Copied")).toBeTruthy();
  expect($$('[role="status"]').map((status) => status.textContent)).toContain("Copied");
  // Copied: closing asks nothing.
  await click(dismiss());
  expect(document.body.textContent).not.toContain("Close without copying?");
  expect(document.querySelector("input[readonly]")).toBeNull();
});

test("when the clipboard refuses, the URL is focused and selected, with the shortcut to copy it", async () => {
  clipboard(() => Promise.reject(new DOMException("Denied", "NotAllowedError")));
  const { url } = await createHeartbeat();
  expect(document.body.textContent).not.toContain("to copy it");
  await click(button("Copy URL"));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(document.activeElement).toBe(url);
  expect([url.selectionStart, url.selectionEnd]).toEqual([0, url.value.length]);
  const hint = document.getElementById(url.getAttribute("aria-describedby") ?? "");
  expect(hint?.textContent).toMatch(/^Press (Ctrl\+C|⌘C) to copy it\.$/);
  expect(button("Copy URL")).toBeTruthy();
});
