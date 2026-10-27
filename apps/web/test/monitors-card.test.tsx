// @vitest-environment happy-dom
// MonitorsCard mounted with react-dom against the reference shard server from packages/sync's tests: the keyboard
// flow of the create and edit forms, the confirmed pause and delete, the heartbeat URL panel, how a down, no-data
// or paused monitor reads, and what a viewer is offered (nothing to change).
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
    host: null,
    port: null,
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

/**
 * `rows` go straight into the shard's store; `created` through `monitor.createHttp`, as a member would. `shown` is
 * the role the page offers actions for, `member`'s own unless a test needs the shard to refuse what the page offers.
 */
async function mount(
  rows: MonitorRow[] = [],
  created: MonitorRow[] = [],
  member: Actor = owner,
  shown: Actor["role"] = member.role,
) {
  const timers = new FakeTimers();
  const server = new FakeServer(() => T0 + timers.now);
  const network = new FakeNetwork(server);
  client = createSyncClient({
    url: (shard) => `ws://test/api/sync/${shard}`,
    actor: member,
    transport: network.transport(member),
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
          <MemberProvider workspaceId={SHARD} userId={member.id} role={shown}>
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
  expect(item().textContent).toContain("Pause this monitor? Its checks stop until you resume it.");
  // Nothing is firing: the prompt says nothing about an alert.
  expect(item().textContent).not.toContain("firing alert");
  // The confirm button has focus; Escape cancels.
  expect(document.activeElement?.textContent).toBe("Pause");
  expect(document.activeElement).not.toBe(pause);
  await key(document.activeElement!, "Escape");
  await frame();
  expect(item().textContent).not.toContain("Pause this monitor?");
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

test("a check Brigade could not judge reads as a check error, not as down, with one notice above the list", async () => {
  const unjudged = monitor({
    name: "Status page",
    status: "up",
    regions: ["weur"],
    checks: [
      {
        source: "weur",
        at: T0 - 1000,
        up: true,
        latencyMs: 80,
        colo: "CDG",
        httpStatus: 200,
        error: "pattern_slow",
      },
    ],
  });
  await mount([unjudged]);
  const item = document.querySelector(`[data-monitor="${unjudged.id}"]`)!;
  expect(item.textContent).toContain("Check error: pattern too slow");
  expect(item.textContent).not.toContain("Down");
  const notices = [...document.querySelectorAll('[role="status"]')].filter((notice) =>
    notice.textContent?.includes("couldn't judge"),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]!.textContent).toContain("Status page");
  expect(notices[0]!.textContent).toContain("nobody is paged");
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

test("a down monitor a route keeps quiet says which route, and that nobody is paged", async () => {
  const suppressed = monitor({
    name: "Docs",
    status: "down",
    alertId: newId("alt", T0, randomBytes),
    alertRoute: { id: "rte_quiet", name: "Quiet docs", outcome: "suppressed" },
  });
  const dropped = monitor({
    name: "Staging",
    status: "down",
    alertId: newId("alt", T0, randomBytes),
    alertRoute: { id: "rte_drop", name: "Drop staging", outcome: "dropped" },
  });
  await mount([suppressed, dropped]);
  const [first, second] = $$("[data-monitor]");
  expect(first!.textContent).toContain("Kept quiet by route Quiet docs: no incident");
  expect(first!.querySelector("a")).toBeNull();
  expect(second!.textContent).toContain("Dropped by route Drop staging: nobody is paged");
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

test("a numbered incident links to its page, by number", async () => {
  const incidentId = newId("inc", T0 - 1000, randomBytes);
  const down = monitor({
    name: "Checkout API",
    status: "down",
    incidentId,
    alertId: newId("alt", T0, randomBytes),
  });
  const view = await mount([down]);
  expect(
    view.shard.write(owner, "incident.declare", {
      id: incidentId,
      title: "Checkout API is down",
      severity: "sev2",
    }).ok,
  ).toBe(true);
  await view.flush();
  await view.flush();
  const link = document.querySelector(`[data-monitor="${down.id}"] a`)!;
  expect(link.getAttribute("href")).toBe("/incidents/1");
  expect(link.textContent).toBe("Open INC-1");
});

/** A form's accessible name: its own label, or the heading it is labelled by. */
const formName = (form: Element) =>
  form.getAttribute("aria-label") ??
  document.getElementById(form.getAttribute("aria-labelledby") ?? "")?.textContent;

/** The input labelled `text` in the open form. */
const field = (text: string) =>
  $$("form input").find(
    (input) => document.querySelector(`label[for="${input.id}"]`)?.textContent === text,
  ) as HTMLInputElement;

test("editing opens the monitor's values in place, says when saving starts it over, and saves", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes), name: "Checkout" });
  const view = await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item()));
  const form = item().querySelector("form")!;
  // Its name is the visible heading.
  expect(formName(form)).toBe("Edit Checkout");
  expect(form.querySelector("h3")?.textContent).toBe("Edit Checkout");
  // The kind is said, not offered, and focus is on the name.
  expect(form.querySelector('input[type="radio"]')).toBeNull();
  expect(form.textContent).toContain("HTTP check");
  expect(document.activeElement).toBe(field("Name"));
  expect(field("URL").value).toBe("https://example.com/health");

  act(() => setValue(field("Name"), "Checkout API"));
  expect(form.textContent).not.toContain("starts its checks over");
  act(() => setValue(field("URL"), "https://example.com/ready"));
  expect(form.textContent).toContain("Saving starts its checks over");
  // Announced as it appears, and read with Save.
  const note = $$("p", form).find((p) => p.textContent?.startsWith("Saving starts"))!;
  expect(note.parentElement?.getAttribute("aria-live")).toBe("polite");
  expect(button("Save changes", form)?.getAttribute("aria-describedby")).toBe(note.id);
  expect(note.textContent).not.toContain("firing alert");

  await click(button("Save changes", form));
  await view.flush();
  expect(view.shard.store.get("monitors", row.id)).toMatchObject({
    name: "Checkout API",
    url: "https://example.com/ready",
    status: "pending",
  });
  expect(item().querySelector("form")).toBeNull();
  await frame();
  expect(document.activeElement).toBe(button("Edit", item()));
});

test("an edit that changes nothing just closes, and a refused value stays in its field", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  const view = await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  const before = view.shard.store.get("monitors", row.id)!.updatedAt;

  await click(button("Edit", item()));
  act(() => setValue(field("Every (seconds)"), "5"));
  await click(button("Save changes", item()));
  await frame();
  expect(item().textContent).toContain("Use whole seconds, from 30 to 86,400 (24 hours).");
  expect(document.activeElement).toBe(field("Every (seconds)"));

  act(() => setValue(field("Every (seconds)"), "60"));
  await click(button("Save changes", item()));
  await view.flush();
  expect(item().querySelector("form")).toBeNull();
  // Nothing was sent: the shard would have refused it as a conflict.
  expect(view.shard.store.get("monitors", row.id)!.updatedAt).toBe(before);
  expect(document.body.textContent).not.toContain("Couldn't change");
});

test("deleting asks first, says what happens to its alert and incident, and Escape keeps the editor", async () => {
  const incidentId = newId("inc", T0, randomBytes);
  const alertId = newId("alt", T0, randomBytes);
  const row = monitor({ name: "Checkout", status: "down", incidentId, alertId });
  const view = await mount([row]);
  view.shard.store.insert("alerts", {
    id: alertId,
    fingerprint: `monitor:${row.id}`,
    monitorId: row.id,
    status: "firing",
    firedAt: T0 - 1000,
    resolvedAt: null,
    incidentId,
  });
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item()));
  await click(button("Delete monitor", item()));
  expect(item().textContent).toContain(
    "Delete Checkout? Its checks stop and its results are gone for good.",
  );
  expect(item().textContent).toContain(
    "Its firing alert resolves. The incident it opened is left for people to close.",
  );
  const ask = button("Delete monitor", item())!;
  const prompt = document.getElementById(ask.getAttribute("aria-controls") ?? "");
  expect(prompt?.getAttribute("role")).toBe("group");
  // Keep monitor has focus; Escape closes the prompt, not the form.
  expect(document.activeElement?.textContent).toBe("Keep monitor");
  await key(document.activeElement!, "Escape");
  expect(item().textContent).not.toContain("gone for good");
  expect(item().querySelector("form")).not.toBeNull();
  // At once, not a frame later: focus never falls to the page in between.
  expect(document.activeElement).toBe(button("Delete monitor", item()));
  expect(ask.getAttribute("aria-controls")).toBeNull();

  await click(button("Delete monitor", item()));
  await click(button("Delete", item()));
  await view.flush();
  expect(document.querySelector(`[data-monitor="${row.id}"]`)).toBeNull();
  expect(view.shard.store.get("monitors", row.id)).toBeUndefined();
  expect(view.shard.store.get("alerts", alertId)).toMatchObject({ status: "resolved" });
  await frame();
  expect(document.activeElement).toBe(button("Add monitor"));
});

test("deleting a quiet heartbeat says its URL stops working and its past incidents stay", async () => {
  const row = monitor({
    name: "Nightly backup",
    kind: "heartbeat",
    url: null,
    method: null,
    timeoutSeconds: null,
    regions: [],
    graceSeconds: 300,
  });
  await mount([row]);
  const item = document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item));
  expect(field("Grace (seconds)").value).toBe("300");
  await click(button("Delete monitor", item));
  expect(item.textContent).toContain("Incidents it opened before stay as they are.");
  expect(item.textContent).toContain("Its heartbeat URL stops working.");
  expect(item.textContent).not.toContain("firing alert");
});

test("a heartbeat's New URL asks first, then shows the new URL once with Copy, and the old hash is gone", async () => {
  const writes = clipboard(async () => {});
  const { url: first, shard, flush } = await createHeartbeat();
  const created = shard.store.scan("monitors")[0]!;
  const oldHash = shard.store.get("heartbeats", created.id)!.tokenHash;
  await click(button("Copied") ?? button("Copy URL"));
  await click($$('button[aria-label="Dismiss"]')[0]);
  const item = () => document.querySelector(`[data-monitor="${created.id}"]`)!;
  await click(button("Edit", item()));

  // Only heartbeats offer it; it asks first, with Keep current URL focused.
  await click(button("New URL", item()));
  const ask = button("New URL", item())!;
  expect(ask.getAttribute("aria-expanded")).toBe("true");
  const prompt = document.getElementById(ask.getAttribute("aria-controls") ?? "")!;
  expect(prompt.getAttribute("role")).toBe("group");
  expect(prompt.textContent).toContain("Make a new URL for Nightly backup?");
  expect(prompt.textContent).toContain(
    "The current URL stops working at once; update whatever pings it.",
  );
  expect(prompt.textContent).toContain("starts over from Waiting");
  expect(prompt.textContent).not.toContain("won't be saved");
  expect(document.activeElement).toBe(button("Keep current URL", item()));
  // Escape closes the prompt, not the form, and sends nothing.
  await key(document.activeElement!, "Escape");
  expect(document.getElementById(prompt.id)).toBeNull();
  expect(item().querySelector("form")).not.toBeNull();
  expect(document.activeElement).toBe(button("New URL", item()));
  expect(shard.store.get("heartbeats", created.id)!.tokenHash).toBe(oldHash);

  // Unsaved edits are said to be dropped.
  act(() => setValue(field("Name"), "Nightly backup (db)"));
  await click(button("New URL", item()));
  expect(item().textContent).toContain("Your other changes in this form won't be saved.");
  await click(button("Make new URL", item()));
  const readonly = () => document.querySelector<HTMLInputElement>("input[readonly]");
  for (let tries = 0; !readonly() && tries < 50; tries++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  await flush();
  const url = readonly()!;
  expect(item().querySelector("form")).toBeNull();
  expect(url.value).toMatch(/\/api\/heartbeat\//);
  expect(url.value).not.toBe(first.value);
  expect(document.body.textContent).toContain("New URL for Nightly backup, shown only once");
  expect(document.activeElement).toBe(button("Copy URL"));

  // The shard holds the new hash only, and the synced row neither.
  const newHash = shard.store.get("heartbeats", created.id)!.tokenHash;
  expect(newHash).not.toBe(oldHash);
  expect(JSON.stringify(shard.store.get("monitors", created.id))).not.toContain(newHash);
  expect(shard.store.get("monitors", created.id)).toMatchObject({
    name: "Nightly backup",
    status: "pending",
  });

  await click(button("Copy URL"));
  await act(async () => {
    await Promise.resolve();
  });
  expect(writes.at(-1)).toBe(url.value);
  // Shown once: closed, it is gone, and focus goes back to the row.
  await click($$('button[aria-label="Dismiss"]')[0]);
  expect(readonly()).toBeNull();
  await frame();
  expect(document.activeElement).toBe(button("Edit", item()));
});

/** A heartbeat row, and New URL run on it through its Edit form until the new URL's panel has focus. */
const quietBeat = () =>
  monitor({
    name: "Nightly backup",
    kind: "heartbeat",
    url: null,
    method: null,
    timeoutSeconds: null,
    regions: [],
    graceSeconds: 300,
  });
const shownUrl = () => document.querySelector<HTMLInputElement>("input[readonly]");
async function rotate(item: () => Element | null) {
  await click(button("Edit", item()!));
  await click(button("New URL", item()!));
  await click(button("Make new URL", item()!));
  for (let tries = 0; !shownUrl() && tries < 50; tries++) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  expect(document.activeElement).toBe(button("Copy URL"));
}

test("a New URL the shard refuses takes the panel back, and focus goes to the row's Edit", async () => {
  clipboard(async () => {});
  // The page offers it to a stale admin role; the shard sees a responder.
  const responder: Actor = { kind: "user", id: "usr_resp", role: "responder" };
  const row = quietBeat();
  const { flush } = await mount([row], [], responder, "admin");
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`);
  await rotate(item);
  await flush();
  expect(shownUrl()).toBeNull();
  expect(document.body.textContent).toContain("Couldn't change Nightly backup");
  expect(document.activeElement).toBe(button("Edit", item()!));
});

test("a New URL for a monitor deleted meanwhile takes the panel back, and focus goes to Add monitor", async () => {
  clipboard(async () => {});
  const row = quietBeat();
  const { shard, flush } = await mount([row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`);
  await rotate(item);
  expect(shard.write(owner, "monitor.delete", { id: row.id }).ok).toBe(true);
  await flush();
  expect(shownUrl()).toBeNull();
  expect(item()).toBeNull();
  expect(document.activeElement).toBe(button("Add monitor"));
});

test("New URL is only for heartbeats", async () => {
  const row = monitor({ name: "Checkout" });
  await mount([row]);
  const item = document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item));
  expect(button("New URL", item)).toBeUndefined();
});

test("a viewer reads monitors but is offered nothing to change", async () => {
  const viewer: Actor = { kind: "user", id: "usr_viewer", role: "viewer" };
  const row = monitor({ name: "Checkout", paused: true, pausedBy: "usr_dev", pausedAt: T0 });
  await mount([row], [], viewer);
  const item = document.querySelector(`[data-monitor="${row.id}"]`)!;
  expect(item.textContent).toContain("Checkout");
  expect(item.textContent).toContain("Paused by a teammate");
  expect($$("button", item)).toEqual([]);
  expect(button("Add monitor")).toBeUndefined();
});

test("opening one form closes the other", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Add monitor"));
  await click(button("Edit", item()));
  expect($$("form").map(formName)).toEqual(["Edit Checkout"]);
  expect(button("Add monitor")).toBeTruthy();
  await click(button("Add monitor"));
  expect($$("form").map(formName)).toEqual(["Add monitor"]);
});

test("opening another form while one has changes asks first; Keep editing stays, Discard opens the other", async () => {
  const first = monitor({ id: newId("mon", T0 - 2, randomBytes), name: "Alpha" });
  const second = monitor({ id: newId("mon", T0 - 1, randomBytes), name: "Bravo" });
  await mount([], [first, second]);
  const item = (row: MonitorRow) => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item(first)));
  act(() => setValue(field("Name"), "Alpha API"));

  await click(button("Edit", item(second)));
  expect($$("form").map(formName)).toEqual(["Edit Alpha"]);
  expect(item(first).textContent).toContain("Discard your changes to Alpha?");
  expect(document.activeElement).toBe(button("Keep editing", item(first)));
  // Escape is Keep editing, and leaves the form open with the draft.
  await key(document.activeElement!, "Escape");
  expect(item(first).textContent).not.toContain("Discard your changes");
  expect(field("Name").value).toBe("Alpha API");
  expect(document.activeElement).toBe(field("Name"));

  await click(button("Add monitor"));
  expect(item(first).textContent).toContain("Discard your changes to Alpha?");
  // Asking again while the prompt is up brings focus back to it, and Escape still answers it.
  await click(button("Edit", item(second)));
  expect(document.activeElement).toBe(button("Keep editing", item(first)));
  await key(document.activeElement!, "Escape");
  expect(item(first).textContent).not.toContain("Discard your changes");
  await click(button("Add monitor"));
  await click(button("Keep editing", item(first)));
  expect($$("form").map(formName)).toEqual(["Edit Alpha"]);
  expect(document.activeElement).toBe(field("Name"));

  await click(button("Edit", item(second)));
  await click(button("Discard changes", item(first)));
  expect($$("form").map(formName)).toEqual(["Edit Bravo"]);
  expect(document.activeElement).toBe(field("Name"));
  // The new form has no changes yet: Add monitor opens at once.
  await click(button("Add monitor"));
  expect($$("form").map(formName)).toEqual(["Add monitor"]);

  // A new monitor's draft asks too.
  act(() => setValue(field("Name"), "Search"));
  await click(button("Edit", item(first)));
  expect(document.body.textContent).toContain("Discard this new monitor?");
  await click(button("Discard"));
  expect($$("form").map(formName)).toEqual(["Edit Alpha"]);
  expect(field("Name").value).toBe("Alpha");
});

test("a pause prompt left open does not come back after Edit and Cancel", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Pause", item()));
  expect(item().textContent).toContain("Pause this monitor?");
  await click(button("Edit", item()));
  await click(button("Cancel", item()));
  await frame();
  expect(item().querySelector("form")).toBeNull();
  expect(item().textContent).not.toContain("Pause this monitor?");
  expect(button("Pause", item())?.getAttribute("aria-expanded")).toBe("false");
});

test("pausing an alerting monitor says its alert resolves; restarting one says the alert stays", async () => {
  const row = monitor({
    id: newId("mon", T0, randomBytes),
    status: "down",
    alertId: newId("alt", T0, randomBytes),
    incidentId: newId("inc", T0, randomBytes),
  });
  await mount([row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Pause", item()));
  expect(item().textContent).toContain(
    "Pause this monitor? Its checks stop until you resume it, and its firing alert resolves.",
  );
  await key(document.activeElement!, "Escape");

  await click(button("Edit", item()));
  act(() => setValue(field("URL"), "https://example.com/ready"));
  expect(item().textContent).toContain("Its firing alert stays until its checks pass again.");
});

test("Escape after closing the delete prompt closes the editor", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Edit", item()));
  await click(button("Delete monitor", item()));
  // Synchronously, before any frame: focus is back on Delete in the same update, never on the page.
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  expect(document.activeElement).toBe(button("Delete monitor", item()));
  // Inside the form, so the next Escape is the form's.
  await key(document.activeElement!, "Escape");
  expect(item().querySelector("form")).toBeNull();
});

test("when the monitor being edited is deleted elsewhere, focus goes to Add monitor", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  const view = await mount([], [row]);
  await click(button("Edit", document.querySelector(`[data-monitor="${row.id}"]`)!));
  expect(document.activeElement).toBe(field("Name"));
  expect(view.shard.write(owner, "monitor.delete", { id: row.id }).ok).toBe(true);
  await view.flush();
  await frame();
  expect(document.querySelector("form")).toBeNull();
  expect(document.activeElement).toBe(button("Add monitor"));
});

test("a pause prompt open when someone else pauses the monitor does not come back on resume", async () => {
  const row = monitor({ id: newId("mon", T0, randomBytes) });
  const view = await mount([], [row]);
  const item = () => document.querySelector(`[data-monitor="${row.id}"]`)!;
  await click(button("Pause", item()));
  expect(item().textContent).toContain("Pause this monitor?");
  for (const paused of [true, false]) {
    expect(view.shard.write(owner, "monitor.setPaused", { id: row.id, paused }).ok).toBe(true);
    await view.flush();
  }
  expect(item().textContent).not.toContain("Pause this monitor?");
});

test("a full workspace says so in the form, keeps the draft and sends nothing", async () => {
  const rows = Array.from({ length: 100 }, (_, i) => monitor({ name: `Service ${i}` }));
  const view = await mount(rows);
  await click(button("Add monitor"));
  act(() => setValue(field("Name"), "One more"));
  act(() => setValue(field("URL"), "https://example.com/"));
  await click(button("Create monitor"));
  await view.flush();
  const form = document.querySelector("form")!;
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    "This workspace has 100 monitors, the most it can have. Delete one to add another.",
  );
  expect(field("Name").value).toBe("One more");
  expect(view.shard.store.scan("monitors")).toHaveLength(100);
});

test("the type selector uses short names; pasting host:port fills both TCP fields", async () => {
  await mount();
  await click(button("Add monitor"));
  const labels = $$('[role="radiogroup"] label').map((label) => label.textContent);
  expect(labels).toEqual(["HTTP", "TCP", "Heartbeat"]);
  await click($$('input[type="radio"]').find((r) => (r as HTMLInputElement).value === "tcp"));
  const host = field("Host");
  await act(async () => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: { getData: () => "postgres://db.example.com:6432/app" },
    });
    host.dispatchEvent(event);
    await Promise.resolve();
  });
  expect(field("Host").value).toBe("db.example.com");
  expect(field("Port").value).toBe("6432");
});

test("a TCP port: host and port fields, a refused host says what to fix, and the row reads host:port", async () => {
  const view = await mount();
  await click(button("Add monitor"));
  const kind = $$('input[type="radio"]').find(
    (radio) => (radio as HTMLInputElement).value === "tcp",
  );
  await click(kind);
  const form = document.querySelector("form")!;
  // Host and port instead of the URL; the regions and the timeout stay.
  expect(field("URL")).toBeUndefined();
  expect(field("Host")).toBeDefined();
  expect(field("Port")).toBeDefined();
  expect(form.textContent).toContain("How long the connection may take to open.");
  expect($$('input[type="checkbox"]', form)).toHaveLength(6);

  act(() => setValue(field("Name"), "Database"));
  act(() => setValue(field("Host"), "10.0.0.5"));
  act(() => setValue(field("Port"), "25"));
  await click(button("Create monitor"));
  await frame();
  expect(form.textContent).toContain(
    "Use a public host name or IP address, without http:// or a port.",
  );
  expect(document.activeElement).toBe(field("Host"));
  act(() => setValue(field("Host"), "db.example.com"));
  await click(button("Create monitor"));
  await frame();
  expect(form.textContent).toContain("Cloudflare blocks port 25. Use another port.");
  expect(document.activeElement).toBe(field("Port"));
  // The error runs under both fields, and the port says which one it is about.
  const portError = $$("p", form).find((p) => p.textContent?.includes("port 25"))!;
  expect(field("Port").getAttribute("aria-describedby")?.split(" ")).toContain(portError.id);
  expect(field("Host").getAttribute("aria-describedby")?.split(" ")).not.toContain(portError.id);
  act(() => setValue(field("Port"), "70000"));
  await click(button("Create monitor"));
  await frame();
  expect(form.textContent).toContain("Use a port from 1 to 65535.");

  act(() => setValue(field("Port"), "5432"));
  await click(button("Create monitor"));
  await view.flush();
  const [created] = view.shard.store.scan("monitors");
  expect(created).toMatchObject({
    kind: "tcp",
    name: "Database",
    host: "db.example.com",
    port: 5432,
    url: null,
    regions: ["enam", "weur"],
  });
  const item = document.querySelector(`[data-monitor="${created!.id}"]`)!;
  expect(item.textContent).toContain("db.example.com:5432");

  // Editing keeps the kind and opens with its host and port.
  await click(button("Edit", item));
  expect(item.querySelector("form")?.textContent).toContain("TCP port");
  expect(field("Host").value).toBe("db.example.com");
  act(() => setValue(field("Port"), "5433"));
  expect(item.textContent).toContain("Saving starts its checks over");
  await click(button("Save changes", item));
  await view.flush();
  expect(view.shard.store.get("monitors", created!.id)).toMatchObject({ port: 5433 });
});
