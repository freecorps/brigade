// @vitest-environment happy-dom
// IncidentsCard mounted with react-dom against the reference shard server from packages/sync's tests, over its
// fake network with manual delivery and fake timers: nothing reaches the "server" until a test flushes.
import { setLocale as setI18nLocale, type Locale } from "@freecorps/brigade-i18n";
import { newId, type Actor, type IncidentStatus } from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient } from "@freecorps/brigade-sync";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { MUTATION_RETENTION_MS } from "../../../packages/sync/src/protocol.ts";
import {
  FakeNetwork,
  FakeServer,
  FakeTimers,
  type ShardServer,
} from "../../../packages/sync/tests/fake-server.ts";
import { ANNOUNCE_MS, IncidentsCard } from "../src/components/incidents-card";
import { routeTree } from "../src/routeTree.gen";
import { PreferencesProvider, usePreferences } from "../src/components/preferences";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real root's dashboard route needs a signed-in member of a workspace (components/session.tsx): a fixed one
// here, on the test's shard, whose socket goes to the test's sync client.
vi.mock("../src/lib/auth", async (original) => {
  const done = (data: unknown) => () => ({
    data,
    error: null,
    isPending: false,
    refetch: async () => {},
  });
  const actual = await original<typeof import("../src/lib/auth")>();
  return {
    ...actual,
    authClient: {
      useSession: done({
        user: { id: "usr_dev", name: "Dev", email: "dev@example.com" },
        session: { activeOrganizationId: "demo" },
      }),
      useActiveOrganization: done({ id: "demo", name: "Demo" }),
      useListOrganizations: done([{ id: "demo", name: "Demo" }]),
      useActiveMember: done({ role: "responder" }),
    },
  };
});
vi.mock("../src/sync-client", () => ({
  get syncClient() {
    return client;
  },
}));

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
  vi.restoreAllMocks();
  vi.useRealTimers();
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
 * before it opens, as when the shard cannot be reached. `maxPending`: the client's cap on unconfirmed changes.
 * `app`: render the real router and root layout (as main.tsx does) instead of the card alone.
 */
function mount({ clientAhead = 0, offline = false, maxPending = 500, app = false } = {}) {
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
    maxPending,
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
  const router = app
    ? createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) })
    : undefined;
  act(() => {
    root = createRoot(container);
    root.render(
      <PreferencesProvider initialLocale="en">
        <LocaleProbe />
        <SyncProvider client={syncClient} shard={SHARD}>
          {app ? <RouterProvider router={router!} /> : <IncidentsCard />}
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
  return { container, shard, network, timers, router, declare, flush, sentMutations };
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
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
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
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
  expect(input.value).toBe("");
  await view.flush();
  expect(input.value).toBe("Search slow");
});

test("phones: a title the shard refuses opens the form again with focus in the title", async () => {
  setWidth(375);
  const view = mount();
  await view.flush();
  refuseDeclareTitle(view.shard);
  const opener = () => $$("button").find((b) => b.textContent === "Declare incident");
  await click(opener());
  await act(async () => setValue($<HTMLInputElement>("input")!, "Search slow"));
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
  expect(document.activeElement).toBe(opener());
  await view.flush();
  expect(opener()).toBeUndefined();
  const input = $<HTMLInputElement>("input")!;
  expect(input.value).toBe("Search slow");
  expect(document.activeElement).toBe(input);
});

test("an empty title stays local, with an error read out; Declare stays enabled", async () => {
  const view = mount();
  await view.flush();
  const submit = $$("button").find((b) => b.textContent?.startsWith("Declare SEV"))!;
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
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
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

test("each announcement leaves the live region ANNOUNCE_MS after it arrived, however many follow", async () => {
  // too_many_pending: the client's cap is 0, so every declare is refused at once, with a notice.
  const view = mount({ maxPending: 0 });
  await view.flush();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const refuse = async (title: string) => {
    await act(async () => setValue($<HTMLInputElement>("input")!, title));
    await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const lines = () => $$("p", announcer()).map((p) => p.textContent);
  const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  await refuse("First");
  expect(lines()).toEqual([expect.stringContaining("“First”")]);
  await advance(4000);
  await refuse("Second");
  expect(lines()).toHaveLength(2);
  // A newer arrival does not push the oldest's removal back.
  await advance(ANNOUNCE_MS - 4000 - 1);
  expect(lines()).toHaveLength(2);
  await advance(1);
  expect(lines()).toEqual([expect.stringContaining("“Second”")]);
  await advance(3000);
  await refuse("Third");
  await advance(1000);
  expect(lines()).toEqual([expect.stringContaining("“Third”")]);
  await advance(4000);
  expect(lines()).toEqual([]);
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

test("only incidents that arrive after the list first showed settle in", async () => {
  const view = mount();
  view.declare("Already open", "sev2");
  await view.flush();
  expect(row("Already open")!.classList.contains("enter")).toBe(false);
  // Declared elsewhere while the list is on screen.
  view.declare("Arrived later", "sev3");
  await view.flush();
  expect(row("Arrived later")!.classList.contains("enter")).toBe(true);
  expect(row("Already open")!.classList.contains("enter")).toBe(false);
});

test("unavailable: a calm count line, the reason and that it keeps trying; the form stays", async () => {
  const view = mount({ offline: true });
  await view.flush();
  const card = $("#incidents-title")!.closest("section")!;
  expect($('[role="status"]', card)?.textContent).toContain("Sync unavailable");
  expect(card.textContent).toContain("vp run dev");
  expect(card.textContent).toContain("This page keeps trying on its own.");
  // The count line keeps its height, empty: no placeholder glyph.
  const count = $("#incidents-title")!.closest('[data-slot="card-header"]')!.lastElementChild!;
  expect(count.textContent).toBe("");
  expect($$("button").some((b) => b.textContent?.startsWith("Declare SEV"))).toBe(true);
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
  // The acknowledgement's live region is there, empty, before anything is sent: filling it is announced.
  const sent = $$('[role="status"]', card)[1]!;
  expect(sent.textContent).toBe("");
  await act(async () => setValue($<HTMLInputElement>("input")!, "Card reader offline"));
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
  expect($$('[role="status"]', card)[1]).toBe(sent);
  expect(sent.textContent).toMatch(/^Sent “Card reader offline”\./);
  expect(view.sentMutations()).toHaveLength(1);
  await click($$("button").find((b) => b.textContent === "Reload"));
  expect(reload).toHaveBeenCalledOnce();

  // A declare the shard then refuses: "Sent" does not stay next to its failure.
  refuseDeclareTitle(view.shard);
  await act(async () => setValue($<HTMLInputElement>("input")!, "Search slow"));
  await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
  expect(sent.textContent).toMatch(/^Sent “Search slow”\./);
  await view.flush();
  expect(sent.textContent).toBe("");
  expect(card.textContent).toContain("“Search slow”");
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

test("the real root keeps the card's state across a language switch, with a change in flight", async () => {
  // The fetches of the stack card have nowhere to go here; they fail quietly.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  const view = mount({ app: true });
  const id = view.declare("Checkout down", "sev2");
  await act(() => view.router!.load());
  await view.flush();
  expect(titles()).toEqual(["Checkout down"]);
  const input = $<HTMLInputElement>('input[placeholder="What\'s happening?"]')!;
  await act(async () => setValue(input, "Half-typed title"));

  // A change the shard will refuse, still in flight while the language switches.
  view.shard.write(ops, "incident.setStatus", { id, status: "monitoring" });
  await choose("Checkout down", "Status", /^Declined$/);
  await act(async () => switchLocale!("pt-BR"));
  expect($("h1")?.textContent).toBe("Visão geral");
  expect($("#incidents-title")?.textContent).toBe("Incidentes");
  // The same card: the typed text survived, and the refusal lands in it.
  expect($<HTMLInputElement>('input[placeholder="O que está acontecendo?"]')).toBe(input);
  expect(input.value).toBe("Half-typed title");
  await view.flush();
  expect(row("Checkout down")!.textContent).toContain("Não foi possível mover para Descartado.");
});

test("the shell names the page and counts the open incidents on the sidebar's Incidents row", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  const view = mount({ app: true });
  await act(() => view.router!.load());
  await view.flush();
  const nav = $('nav[aria-label="Dashboard"]')!;
  const link = (name: string) =>
    $$("a", nav).find((a) => a.textContent?.startsWith(name)) as HTMLAnchorElement;
  expect($("h1")?.textContent).toBe("Overview");
  expect(link("Overview").getAttribute("aria-current")).toBe("page");
  // None open: no badge, not a "0".
  expect(link("Incidents").textContent).toBe("Incidents");

  const first = view.declare("Checkout down", "sev1");
  view.declare("Login slow", "sev3");
  await view.flush();
  expect(link("Incidents").textContent).toBe("Incidents2");
  // A SEV1 is open: the count turns red; once it resolves, the count is grey again.
  const badge = () => $('[data-slot="sidebar-menu-badge"]', link("Incidents"))!;
  expect(badge().dataset.sev1).toBe("true");
  view.shard.write(ops, "incident.setStatus", { id: first, status: "resolved" });
  await view.flush();
  expect(link("Incidents").textContent).toBe("Incidents1");
  expect(badge().dataset.sev1).toBeUndefined();
});

test("focus moved outside the card stays there when the row it came from is removed", async () => {
  const view = mount();
  const gone = view.declare("Leaving", "sev1");
  view.declare("Staying", "sev2");
  await view.flush();
  const outside = document.createElement("button");
  outside.textContent = "Elsewhere";
  document.body.append(outside);
  const trigger = $$("button", row("Leaving")).find((b) => b.textContent?.startsWith("Status:"))!;
  act(() => trigger.focus());
  await act(async () => {
    outside.focus();
    await Promise.resolve();
  });
  view.shard.write(ops, "incident.setStatus", { id: gone, status: "resolved" });
  await view.flush();
  await frame();
  expect(titles()).toEqual(["Staying"]);
  expect(document.activeElement).toBe(outside);
});

test("declares refused without issues keep their notice under the form and do not give the title back", async () => {
  // too_many_pending: the client's cap is 0, so it refuses before sending.
  const capped = mount({ maxPending: 0 });
  await capped.flush();
  const submit = async (title: string) => {
    await act(async () => setValue($<HTMLInputElement>("input")!, title));
    await click($$("button").find((b) => b.textContent?.startsWith("Declare SEV")));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const formNotice = () => {
    // The slot right after the form's band, before the list: where the user just acted.
    const band = $("form")!.parentElement!;
    const next = band.nextElementSibling;
    return next?.tagName === "UL" ? next.textContent : null;
  };
  await submit("Card reader offline");
  expect(formNotice()).toContain("Couldn't declare it. Wait for the pending changes to be sent");
  expect($<HTMLInputElement>("input")!.value).toBe("");
  act(() => {
    root?.unmount();
    client?.close();
  });
  document.body.innerHTML = "";

  // expired: sent while offline, never confirmed within the retention window.
  const offline = mount({ offline: true });
  await offline.flush();
  await submit("Badge printer jammed");
  expect(titles()).toEqual(["Badge printer jammed"]); // Optimistic, waiting.
  await act(async () => {
    offline.timers.advance(MUTATION_RETENTION_MS + 1);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(formNotice()).toContain(
    "Couldn't declare it. It waited too long to be sent and was dropped.",
  );
  expect($<HTMLInputElement>("input")!.value).toBe("");
  expect(titles()).toEqual([]);

  // closed: the page's client stopped.
  act(() => client!.close());
  await submit("Lift out of order");
  expect(formNotice()).toContain("Couldn't declare it. This page stopped syncing.");
  expect($<HTMLInputElement>("input")!.value).toBe("");
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
