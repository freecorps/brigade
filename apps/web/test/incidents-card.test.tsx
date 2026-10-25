// @vitest-environment happy-dom
// IncidentsCard mounted with react-dom against the reference shard server from packages/sync's tests, over its
// fake network with manual delivery and fake timers: nothing reaches the "server" until a test flushes.
import { setLocale as setI18nLocale, type Locale } from "@freecorps/brigade-i18n";
import { newId, type Actor, type IncidentStatus } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient } from "@freecorps/brigade-sync";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  FakeNetwork,
  FakeServer,
  FakeTimers,
  type ShardServer,
} from "../../../packages/sync/tests/fake-server.ts";
import { IncidentsCard } from "../src/components/incidents-card";
import { PreferencesProvider, usePreferences } from "../src/components/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const SHARD = "demo";
const dev: Actor = { kind: "user", id: "usr_dev", role: "responder" };
const ops: Actor = { kind: "system", id: "sys_alerts", role: "admin" };

let root: Root | undefined;
let client: SyncClient | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
    client?.close();
  });
  root = client = undefined;
  switchLocale = undefined;
  document.body.innerHTML = "";
  setWidth(1024);
  localStorage.clear();
  void setI18nLocale("en");
});

function setWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport(v: object): void } }).happyDOM.setViewport({
    width,
    height: 800,
  });
}

/** The provider's `setLocale`, captured from inside the tree. */
let switchLocale: ((locale: Locale) => void) | undefined;
function LocaleProbe() {
  switchLocale = usePreferences().setLocale;
  return null;
}

/**
 * `clientAhead`: how far the client's clock runs ahead of the server's, in ms. `offline`: every socket closes
 * before it opens, as when the shard cannot be reached.
 */
function mount({ clientAhead = 0, offline = false } = {}) {
  const timers = new FakeTimers();
  const server = new FakeServer(() => T0 + timers.now);
  const network = new FakeNetwork(server);
  network.online = !offline;
  let seed = 0;
  const randomBytes = (length: number) => new Uint8Array(length).fill(++seed % 256);
  client = createSyncClient({
    url: (shard) => `ws://test/api/sync/${shard}`,
    actor: dev,
    transport: network.transport(dev),
    timers,
    now: () => T0 + timers.now + clientAhead,
    random: () => 0.5,
    randomBytes,
  });
  const shard = server.shard(SHARD);
  const declare = (title: string, severity: "sev1" | "sev2" | "sev3", status?: IncidentStatus) => {
    const id = newId("inc", T0 + timers.now - 1000 * ++seed, randomBytes);
    shard.write(ops, "incident.declare", { id, title, severity });
    if (status) shard.write(ops, "incident.setStatus", { id, status });
    return id;
  };
  const container = document.createElement("div");
  document.body.append(container);
  const syncClient = client;
  act(() => {
    root = createRoot(container);
    root.render(
      <PreferencesProvider initialLocale="en">
        <LocaleProbe />
        <SyncProvider client={syncClient} shard={SHARD}>
          <IncidentsCard />
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
  const sentMutations = () =>
    network.sockets
      .flatMap((socket) => socket.sent)
      .filter((f) => (f as { type: string }).type === "mutate");
  return { container, shard, network, declare, flush, sentMutations };
}

const $ = <E extends Element = HTMLElement>(selector: string, scope: ParentNode = document) =>
  scope.querySelector<E & HTMLElement>(selector);
const $$ = (selector: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(selector),
];
const row = (title: string) =>
  $$("li[data-incident]").find((li) => li.querySelector("h3")?.textContent === title);
const titles = () => $$("li[data-incident] h3").map((h) => h.textContent);
const frame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

async function click(element: Element | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => {
    const target = element as HTMLElement;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
    }
    target.click();
    await Promise.resolve();
  });
}

/** Opens a row's menu ("Status" or "Severity") and picks the item named `name`. */
async function choose(title: string, menu: "Status" | "Severity", name: RegExp) {
  const trigger = $$("button", row(title)).find((b) => b.textContent?.startsWith(`${menu}:`));
  await click(trigger);
  const item = $$('[role="menuitemradio"]').find((el) => name.test(el.textContent ?? ""));
  await click(item);
}

const announcer = () => $("[data-announcer]")!;
const dismissButtons = () => $$("[data-dismiss]");

test("choosing the current status or severity sends nothing", async () => {
  const view = mount();
  view.declare("Checkout down", "sev2", "investigating");
  await view.flush();
  expect(titles()).toEqual(["Checkout down"]);
  await choose("Checkout down", "Status", /^Investigating$/);
  await choose("Checkout down", "Severity", /SEV2/);
  await view.flush();
  expect(view.sentMutations()).toEqual([]);
  // A real change does go out.
  await choose("Checkout down", "Severity", /SEV1/);
  expect(view.sentMutations()).toHaveLength(1);
});

test("a row that leaves the list hands focus to the next row's status menu", async () => {
  const view = mount();
  view.declare("Older", "sev2");
  view.declare("Newest", "sev1");
  await view.flush();
  expect(titles()).toEqual(["Newest", "Older"]);
  await choose("Newest", "Status", /^Resolved$/);
  await view.flush();
  await frame();
  expect(titles()).toEqual(["Older"]);
  expect(document.activeElement?.getAttribute("data-status-trigger")).toBe(
    row("Older")!.dataset.incident,
  );
  // The last one leaving: focus goes to the heading.
  await choose("Older", "Status", /^Resolved$/);
  await view.flush();
  await frame();
  expect(document.activeElement?.id).toBe("incidents-title");
});

test("refused changes: in the row when listed, in the card otherwise; read once each; focus after dismiss", async () => {
  // The client's clock runs 11 minutes ahead: the shard refuses its declares for the id's time.
  const view = mount({ clientAhead: 11 * 60_000 });
  const id = view.declare("Checkout down", "sev2");
  await view.flush();
  // Every line the live region gains: each one is read once.
  const added: string[] = [];
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) added.push(node.textContent ?? "");
    }
  }).observe(announcer(), { childList: true });

  // Someone moves it to Monitoring before our Declined (allowed from Triage, not from there) arrives.
  view.shard.write(ops, "incident.setStatus", { id, status: "monitoring" });
  await choose("Checkout down", "Status", /^Declined$/);
  await view.flush();
  const inRow = $$("[data-dismiss]", row("Checkout down"));
  expect(inRow).toHaveLength(1);
  expect(row("Checkout down")!.textContent).toContain("Couldn't move it to Declined.");
  // Read out in the card's wording, which names the incident.
  expect(added).toEqual([
    expect.stringMatching(/^Couldn't move INC-1 “Checkout down” to Declined\./),
  ]);

  // A declare refused for the clock: no row to put it in, so it goes in the card, naming the title.
  await act(async () => {
    const input = $<HTMLInputElement>('input[placeholder="What\'s happening?"]')!;
    setValue(input, "Search slow");
  });
  await click($$("button").find((b) => b.textContent === "Declare"));
  await view.flush();
  expect(titles()).toEqual(["Checkout down"]);
  const cardLevel = dismissButtons().filter((b) => !b.closest("li[data-incident]"));
  expect(cardLevel).toHaveLength(1);
  // The card names the incident on its own line, then the change.
  const text = cardLevel[0]!.closest("li")!.textContent;
  expect(text).toContain("“Search slow”");
  expect(text).toContain("Couldn't declare it. Your device clock is ahead of the server.");
  // The title was fine: it is not given back.
  expect($<HTMLInputElement>("input")!.value).toBe("");

  // Each new notice was read once, and the dismiss buttons say what they dismiss.
  expect(added).toHaveLength(2);
  expect(added[1]).toMatch(/^Couldn't declare “Search slow”\. Your device clock/);
  for (const button of dismissButtons()) {
    expect($(`#${CSS.escape(button.getAttribute("aria-describedby")!)}`)?.textContent).toBeTruthy();
  }

  // Dismissing the row's notice: focus moves to the next one (the card's, below the list).
  inRow[0]!.focus();
  await click(inRow[0]);
  await frame();
  expect(document.activeElement).toBe(cardLevel[0]);
  // The last one (a declare, no row): the heading. Never the title field.
  await click(cardLevel[0]);
  await frame();
  expect(document.activeElement?.id).toBe("incidents-title");
  expect(dismissButtons()).toHaveLength(0);
  // Dismissing announced nothing new.
  expect(added).toHaveLength(2);
});

test("a title the shard refuses is given back if the field is still empty", async () => {
  const view = mount();
  await view.flush();
  refuseDeclareTitle(view.shard);
  const input = $<HTMLInputElement>("input")!;
  await act(async () => setValue(input, "Search slow"));
  await click($$("button").find((b) => b.textContent === "Declare"));
  expect(input.value).toBe("");
  await view.flush();
  expect(input.value).toBe("Search slow");
});

test("an empty title stays local, with an error read out; Declare stays enabled", async () => {
  const view = mount();
  await view.flush();
  const submit = $$("button").find((b) => b.textContent === "Declare")!;
  expect(submit.hasAttribute("disabled")).toBe(false);
  await click(submit);
  expect($('[role="alert"]')?.textContent).toContain("Enter a title.");
  expect($("input")!.getAttribute("aria-invalid")).toBe("true");
  expect(view.sentMutations()).toEqual([]);
});

test("phones: the form opens from one button, and folds back after a declare or Cancel", async () => {
  setWidth(375);
  const view = mount();
  await view.flush();
  const opener = () => $$("button").find((b) => b.textContent === "Declare incident");
  await click(opener());
  expect(opener()).toBeUndefined();
  expect(document.activeElement?.tagName).toBe("INPUT");
  await click($$("button").find((b) => b.textContent === "Cancel"));
  expect(document.activeElement).toBe(opener());

  await click(opener());
  await act(async () => setValue($<HTMLInputElement>("input")!, "Card reader offline"));
  await click($$("button").find((b) => b.textContent === "Declare"));
  expect(document.activeElement).toBe(opener());
  await view.flush();
  expect(titles()).toEqual(["Card reader offline"]);
});

test("refusals landing in the same tick are all read out", async () => {
  const view = mount();
  const first = view.declare("Checkout down", "sev2");
  const second = view.declare("Search slow", "sev3");
  await view.flush();
  // Both move on at the shard before our two Declined (allowed only from Triage) arrive, in one delivery.
  view.shard.write(ops, "incident.setStatus", { id: first, status: "monitoring" });
  view.shard.write(ops, "incident.setStatus", { id: second, status: "monitoring" });
  await choose("Checkout down", "Status", /^Declined$/);
  await choose("Search slow", "Status", /^Declined$/);
  await view.flush();
  const lines = $$("p", announcer()).map((p) => p.textContent);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Couldn't move INC-1 “Checkout down” to Declined\./);
  expect(lines[1]).toMatch(/^Couldn't move INC-2 “Search slow” to Declined\./);
});

test("a row removed elsewhere while one of its controls has focus hands focus to its neighbour", async () => {
  const view = mount();
  const gone = view.declare("Leaving", "sev1");
  view.declare("Staying", "sev2");
  await view.flush();
  const severity = $$("button", row("Leaving")).find((b) =>
    b.textContent?.startsWith("Severity:"),
  )!;
  act(() => severity.focus());
  view.shard.write(ops, "incident.setStatus", { id: gone, status: "resolved" });
  await view.flush();
  await frame();
  expect(document.activeElement?.getAttribute("data-status-trigger")).toBe(
    row("Staying")!.dataset.incident,
  );
});

test("the list puts SEV1 first, whatever its age", async () => {
  const view = mount();
  view.declare("Newer, SEV3", "sev3");
  view.declare("Older, SEV1", "sev1");
  await view.flush();
  expect(titles()).toEqual(["Older, SEV1", "Newer, SEV3"]);
  expect($("#incidents-title")!.closest("section")!.textContent).toContain("1 is SEV1");
});

test("unavailable: a calm count line, the reason and that it keeps trying; the form stays", async () => {
  const view = mount({ offline: true });
  await view.flush();
  const card = $("#incidents-title")!.closest("section")!;
  expect($('[role="status"]', card)?.textContent).toContain("Sync unavailable");
  expect(card.textContent).toContain("vp run dev");
  expect(card.textContent).toContain("This page keeps trying on its own.");
  expect(card.textContent).toContain("—");
  expect($$("button").some((b) => b.textContent === "Declare")).toBe(true);
});

test("refused: the reason and a Reload that reloads; a declare is acknowledged", async () => {
  const reload = vi.fn();
  vi.spyOn(window.location, "reload").mockImplementation(reload);
  const view = mount();
  await view.flush();
  view.network.sockets[0]!.deliver(
    JSON.stringify({ type: "error", subId: "s0", code: "forbidden", message: "No" }),
  );
  await view.flush();
  const card = $("#incidents-title")!.closest("section")!;
  expect($('[role="status"]', card)?.textContent).toBe("Not loaded");
  expect(card.textContent).toContain("You don't have access to these incidents.");
  await act(async () => setValue($<HTMLInputElement>("input")!, "Card reader offline"));
  await click($$("button").find((b) => b.textContent === "Declare"));
  expect(card.textContent).toContain("Sent “Card reader offline”.");
  expect(view.sentMutations()).toHaveLength(1);
  await click($$("button").find((b) => b.textContent === "Reload"));
  expect(reload).toHaveBeenCalledOnce();
  vi.restoreAllMocks();
});

test("reconnecting: the rows stay put and the hint comes after them", async () => {
  const view = mount();
  view.declare("Checkout down", "sev2");
  await view.flush();
  act(() => view.network.disconnect());
  await view.flush();
  const card = $("#incidents-title")!.closest("section")!;
  expect($('[role="status"]', card)?.textContent).toBe("Reconnecting…");
  const list = $("ul[aria-labelledby]", card)!;
  const hint = $$("p", card).find((p) => p.textContent?.startsWith("Showing the last list"))!;
  // The hint follows the list in the document, so it can never push the rows down.
  expect(list.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a language switch rewords an existing notice and the connection state", async () => {
  const view = mount();
  const id = view.declare("Checkout down", "sev2");
  await view.flush();
  view.shard.write(ops, "incident.setStatus", { id, status: "monitoring" });
  await choose("Checkout down", "Status", /^Declined$/);
  await view.flush();
  expect(row("Checkout down")!.textContent).toContain("Couldn't move it to Declined.");
  await act(async () => switchLocale!("pt-BR"));
  expect(row("Checkout down")!.textContent).toContain("Não foi possível mover para Descartado.");
  expect($('[role="status"]')?.textContent).toBe("Ao vivo");
});

/** Types into a controlled input the way React listens for it. */
function setValue(input: HTMLInputElement, value: string) {
  // The prototype's setter, with the input as receiver: React's own value tracker would hide an own-property set.
  Reflect.set(HTMLInputElement.prototype, "value", value, input);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Makes the shard refuse every declare for its title (as a newer server rule might). */
function refuseDeclareTitle(shard: ShardServer) {
  const run = shard.run.bind(shard);
  shard.run = ((actor, name, args) =>
    name === "incident.declare"
      ? {
          ok: false,
          error: {
            code: "invalid_args",
            message: "Invalid title",
            issues: [{ path: "title", message: "Not allowed" }],
          },
        }
      : run(actor, name, args)) as typeof shard.run;
}
