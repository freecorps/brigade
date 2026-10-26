// @vitest-environment happy-dom
// The incident page (`/incidents/<n>`) in the real router, against the reference shard server from packages/sync's
// tests, as a responder or a viewer.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import {
  MONITOR_ACTOR,
  newId,
  UPDATE_BODY_MAX,
  type Actor,
  type MemberRow,
  type Role,
} from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient } from "@freecorps/brigade-sync";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { FakeNetwork, FakeServer, FakeTimers } from "../../../packages/sync/tests/fake-server.ts";
import { PreferencesProvider } from "../src/components/preferences";
import { StackStatusProvider } from "../src/components/stack-status";
import { routeTree } from "../src/routeTree.gen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The signed-in member's role, read by the mocked Better Auth client. */
let role: Role = "responder";
vi.mock("../src/lib/auth", async (original) => {
  const done = (data: () => unknown) => () => ({
    data: data(),
    error: null,
    isPending: false,
    refetch: async () => {},
  });
  const actual = await original<typeof import("../src/lib/auth")>();
  return {
    ...actual,
    authClient: {
      useSession: done(() => ({
        user: { id: "usr_dev", name: "Dev", email: "dev@example.com" },
        session: { activeOrganizationId: "demo" },
      })),
      useActiveOrganization: done(() => ({ id: "demo", name: "Demo" })),
      useActiveMember: done(() => ({ role })),
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
const bia: Actor = { kind: "user", id: "usr_bia", role: "responder" };
// A real name pattern, long enough to need two lines in the roles column.
const LONG_NAME = "Aleksandra Wiśniewska-Kowalczyk de Albuquerque e Vasconcellos Bragança";

let root: Root | undefined;
let client: SyncClient | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
    client?.close();
  });
  root = client = undefined;
  role = "responder";
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  localStorage.clear();
  void setI18nLocale("en");
});

const member = (id: string, name: string | null, memberRole: Role = "responder"): MemberRow => ({
  id,
  name,
  role: memberRole,
  updatedAt: T0,
});

async function mount(path: string) {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
  const dev: Actor = { kind: "user", id: "usr_dev", role };
  const timers = new FakeTimers();
  const server = new FakeServer(() => T0 + timers.now);
  const network = new FakeNetwork(server);
  let seed = 0;
  const randomBytes = (length: number) => new Uint8Array(length).fill(++seed % 256);
  client = createSyncClient({
    url: (shard) => `ws://test/api/sync/${shard}`,
    actor: dev,
    transport: network.transport(dev),
    timers,
    now: () => T0 + timers.now,
    random: () => 0.5,
    randomBytes,
  });
  const shard = server.shard(SHARD);
  for (const row of [
    member("usr_dev", "Dev", role),
    member("usr_bia", LONG_NAME),
    member("usr_x", null),
  ]) {
    shard.store.insert("members", row);
  }
  const declare = (title: string, actor: Actor = bia) => {
    const id = newId("inc", T0 - 1000 * ++seed, randomBytes);
    const result = shard.write(actor, "incident.declare", { id, title, severity: "sev2" });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return id;
  };
  const container = document.createElement("div");
  document.body.append(container);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const syncClient = client;
  act(() => {
    root = createRoot(container);
    root.render(
      <PreferencesProvider initialLocale="en">
        <SyncProvider client={syncClient} shard={SHARD}>
          <StackStatusProvider>
            <RouterProvider router={router} />
          </StackStatusProvider>
        </SyncProvider>
      </PreferencesProvider>,
    );
  });
  // Twice: the page subscribes to its timeline and members once the incident row has arrived.
  const flush = async () => {
    for (let round = 0; round < 2; round++) {
      await act(async () => {
        network.flush();
        await Promise.resolve();
        await Promise.resolve();
      });
    }
  };
  const sentMutations = () =>
    network.sockets
      .flatMap((socket) => socket.sent)
      .filter((f) => (f as { type: string }).type === "mutate");
  return { shard, router, declare, flush, sentMutations };
}

/** Mounts `/incidents/1` with one incident Bia declared and loads it. */
async function incidentPage() {
  const view = await mount("/incidents/1");
  const id = view.declare("Checkout down");
  await act(() => view.router.load());
  await view.flush();
  return { ...view, id };
}

const $ = <E extends Element = HTMLElement>(selector: string, scope: ParentNode = document) =>
  scope.querySelector<E & HTMLElement>(selector);
const $$ = (selector: string, scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLElement>(selector),
];
const card = (title: string) =>
  $$("[aria-labelledby]").find(
    (el) => $(`#${el.getAttribute("aria-labelledby")}`)?.textContent === title,
  );

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

function setValue(field: HTMLTextAreaElement, value: string) {
  Reflect.set(HTMLTextAreaElement.prototype, "value", value, field);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a long name in Roles wraps inside its trigger, named by the role once", async () => {
  const view = await incidentPage();
  view.shard.write(bia, "incident.assignRole", {
    id: view.id,
    role: "commander",
    userId: "usr_bia",
  });
  await view.flush();
  const roles = card("Roles")!;
  const trigger = $$("button", roles)[0]!;
  expect(trigger.textContent).toBe(LONG_NAME);
  expect(trigger.className).toContain("whitespace-normal");
  expect($("svg:last-child", trigger)).toBeTruthy();
  // The accessible name is the visible label and the holder, with no hidden copy of the label.
  const [labelId, nameId] = trigger.getAttribute("aria-labelledby")!.split(" ");
  expect($(`[id="${labelId}"]`)?.textContent).toBe("Incident commander");
  expect($(`[id="${nameId}"]`)?.textContent).toBe(LONG_NAME);
  expect($(".sr-only", trigger)).toBeNull();
});

test("the timeline comes before the roles in the page, and roles show first on phones", async () => {
  await incidentPage();
  const timeline = card("Timeline")!;
  const roles = card("Roles")!;
  expect(timeline.compareDocumentPosition(roles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The side column (roles, then the escalation) moves first on phones.
  expect(roles.parentElement!.className).toContain("max-md:order-first");
});

test("a viewer sees badges and names, not controls that do nothing", async () => {
  role = "viewer";
  const view = await incidentPage();
  view.shard.write(bia, "incident.assignRole", {
    id: view.id,
    role: "commander",
    userId: "usr_bia",
  });
  await view.flush();
  expect($("textarea")).toBeNull();
  const header = $("main header") ?? $$("header").at(-1)!;
  for (const scope of [header, card("Roles")!, card("Timeline")!]) {
    expect($$("button", scope)).toEqual([]);
  }
  expect(header.textContent).toContain("Severity: SEV2");
  expect(header.textContent).toContain("Status: Triage");
  expect(card("Roles")!.textContent).toContain(LONG_NAME);
  expect(header.textContent).toContain("Viewers follow the incident");
});

test("no such incident: a heading and a tab title that say so", async () => {
  const view = await mount("/incidents/9");
  await act(() => view.router.load());
  await view.flush();
  expect($("h1")?.textContent).toBe("Incident not found");
  expect(document.title).toContain("Incident not found");
  expect(document.body.textContent).toContain("There is no incident with this number");
});

test("a pasted update over the limit is kept whole, counted, and refused as too long", async () => {
  const view = await incidentPage();
  const field = $<HTMLTextAreaElement>("textarea")!;
  expect(field.hasAttribute("maxlength")).toBe(false);
  await act(async () => setValue(field, "x".repeat(3500)));
  expect(document.body.textContent).not.toContain("/ 4,000");
  await act(async () => setValue(field, "x".repeat(UPDATE_BODY_MAX + 1)));
  expect(field.value).toHaveLength(UPDATE_BODY_MAX + 1);
  expect(document.body.textContent).toContain("4,001 / 4,000");
  expect(document.body.textContent).toContain("4,001 of 4,000 characters");
  await click($$("button").find((button) => button.textContent === "Post update"));
  expect($('[role="alert"]')?.textContent).toBe("Use at most 4,000 characters.");
  expect(field.getAttribute("aria-invalid")).toBe("true");
  expect(field.value).toHaveLength(UPDATE_BODY_MAX + 1);
  expect(view.sentMutations()).toEqual([]);
});

test("updates: links open in a new tab, others' updates are read out, a monitor declares as a monitor", async () => {
  const view = await mount("/incidents/1");
  const id = view.declare("Checkout down", MONITOR_ACTOR);
  await act(() => view.router.load());
  await view.flush();
  expect(card("Timeline")!.textContent).toContain("A monitor declared the incident as SEV2 High");
  const live = $('[aria-live="polite"]')!;
  expect(live.textContent).toBe("");

  view.shard.write(bia, "incident.postUpdate", {
    id,
    body: "Rolled back, see https://status.example.com/incidents/1.",
  });
  await view.flush();
  expect(live.textContent).toBe(
    `${LONG_NAME} posted an update: Rolled back, see https://status.example.com/incidents/1.`,
  );
  const link = $<HTMLAnchorElement>('a[href="https://status.example.com/incidents/1"]')!;
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(link.parentElement?.textContent).toBe(
    "Rolled back, see https://status.example.com/incidents/1.",
  );

  // My own update is not read back to me.
  await act(async () => setValue($<HTMLTextAreaElement>("textarea")!, "Watching the error rate"));
  await click($$("button").find((button) => button.textContent === "Post update"));
  await view.flush();
  expect(card("Timeline")!.textContent).toContain("You posted an update");
  expect(live.textContent).not.toContain("Watching the error rate");
});

test("a burst of others' updates is announced as one count", async () => {
  const view = await mount("/incidents/1");
  const id = view.declare("Checkout down");
  await act(() => view.router.load());
  await view.flush();
  const live = $('[aria-live="polite"]')!;
  for (let i = 1; i <= 5; i++)
    view.shard.write(bia, "incident.postUpdate", { id, body: `Step ${i}` });
  await view.flush();
  expect(live.textContent).toBe("5 new updates from others");
});

test("back to the list puts focus on the incident's title link", async () => {
  const view = await mount("/");
  view.declare("Checkout down");
  await act(() => view.router.load());
  await view.flush();
  const title = $<HTMLAnchorElement>('[data-incident-link="1"]')!;
  expect(title.className).toContain("underline ");
  await click(title);
  await act(() => view.router.load());
  await view.flush();
  expect($("h1")?.textContent).toBe("Checkout down");
  await click($$("a").find((a) => a.textContent === "All incidents"));
  await act(() => view.router.load());
  await view.flush();
  expect(document.activeElement).toBe($('[data-incident-link="1"]'));
});
