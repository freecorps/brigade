// @vitest-environment happy-dom
// The incident page (`/incidents/<n>`) in the real router, against the reference shard server from packages/sync's
// tests, as a responder or a viewer.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import {
  deliveryId,
  MONITOR_ACTOR,
  newId,
  UPDATE_BODY_MAX,
  type Actor,
  type DeliveryRow,
  type MemberRow,
  type Role,
} from "@freecorps/brigade-schema";
import { createSyncClient, type SyncClient } from "@freecorps/brigade-sync";
import { SyncProvider } from "@freecorps/brigade-sync/react";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { FakeNetwork, FakeServer, FakeTimers } from "../../../packages/sync/tests/fake-server.ts";
import { PreferencesProvider } from "../src/components/preferences";
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
      useListOrganizations: done(() => [{ id: "demo", name: "Demo" }]),
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

async function mount(path: string, locale: "en" | "pt-BR" = "en") {
  void setI18nLocale(locale);
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
      <PreferencesProvider initialLocale={locale}>
        <SyncProvider client={syncClient} shard={SHARD}>
          <RouterProvider router={router} />
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
    // `[id=…]`, not `#…`: a trigger is labelled by two ids, which is no `#` selector.
    (el) => $(`[id="${el.getAttribute("aria-labelledby")}"]`)?.textContent === title,
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

test("a type's roles: the commander, then its own, a required one flagged until held, responsibilities folded", async () => {
  const view = await incidentPage();
  const owner: Actor = { kind: "user", id: "usr_dev", role: "owner" };
  const scribe = "rol_01JB0000000000000000000001";
  const type = "typ_01JB0000000000000000000001";
  for (const [name, args] of [
    [
      "incidentRole.update",
      { id: "commander", name: "Incident lead", description: "", checklist: [] },
    ],
    [
      "incidentRole.create",
      {
        id: scribe,
        name: "Scribe",
        description: "Keeps the record.",
        checklist: ["Note every decision"],
      },
    ],
    [
      "incidentType.create",
      {
        id: type,
        name: "Outage",
        description: "",
        defaultSeverity: null,
        escalationPolicyId: null,
        requiredFields: [],
        roles: [scribe],
        requiredRoles: [scribe],
      },
    ],
    ["incident.setType", { id: view.id, typeId: type }],
  ] as const) {
    expect(view.shard.write(owner, name, args), name).toMatchObject({ ok: true });
  }
  await view.flush();
  const roles = card("Roles")!;
  const items = $$("li", roles).filter((li) => li.parentElement?.closest("li") === null);
  expect(items.map((li) => li.firstElementChild?.textContent)).toEqual([
    "Incident lead",
    "ScribeRequired",
  ]);
  expect($("details summary", items[1])?.textContent).toBe("Responsibilities");
  expect($("details", items[1])?.textContent).toContain("Note every decision");
  view.shard.write(bia, "incident.assignRole", { id: view.id, role: scribe, userId: "usr_bia" });
  await view.flush();
  expect(items[1]?.isConnected && items[1].firstElementChild?.textContent).toBe("Scribe");
  expect(card("Timeline")!.textContent).toContain(`${LONG_NAME} took the Scribe role`);
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

test("Acknowledge stops paging from the web: at once, then says who acknowledged", async () => {
  const view = await incidentPage();
  const header = $$("header").at(-1)!;
  const ack = $$("button", header).find((button) => button.textContent === "Acknowledge");
  expect(header.textContent).toContain("Stops paging");
  await click(ack);
  // Optimistic: the line shows before the shard confirms.
  expect(header.textContent).toContain("Acknowledged by You");
  expect($$("button", header).some((button) => button.textContent === "Acknowledge")).toBe(false);
  await view.flush();
  expect(view.sentMutations()).toEqual([expect.objectContaining({ name: "incident.ack" })]);
  expect(view.shard.store.get("incidents", view.id)).toMatchObject({ acknowledgedBy: "usr_dev" });
  expect(header.textContent).toContain("Acknowledged by You");
});

test("someone acknowledging first: the refusal says so and names them", async () => {
  const view = await incidentPage();
  const header = $$("header").at(-1)!;
  // Bia acknowledges on the shard while this ack is on its way.
  view.shard.write(bia, "incident.ack", { id: view.id });
  await click($$("button", header).find((button) => button.textContent === "Acknowledge"));
  await view.flush();
  expect($('[role="alert"]', header)?.textContent).toBe("Someone else acknowledged it first.");
  expect(header.textContent).toContain(`Acknowledged by ${LONG_NAME}`);
});

test("a run under way: what fires next and whom, the latest page first, misses and the earlier levels folded", async () => {
  const view = await mount("/incidents/1");
  const id = view.declare("Checkout down");
  const now = T0;
  view.shard.store.insert("members", member("usr_eva", "Eva Lima"));
  view.shard.store.update("incidents", id, {
    escalation: {
      policyId: "esc_01JB0000000000000000000001",
      policyName: "Checkout",
      levels: [
        { id: "lvl_1", targets: [{ kind: "member", id: "usr_bia" }], timeoutMinutes: 5 },
        { id: "lvl_2", targets: [{ kind: "member", id: "usr_dev" }], timeoutMinutes: 5 },
        { id: "lvl_3", targets: [{ kind: "member", id: "usr_eva" }], timeoutMinutes: 5 },
      ],
      repeat: 0,
      eventId: "evt_01JB0000000000000000000001",
      causedBy: "sys_monitors",
      status: "running",
      startedAt: now - 6 * 60_000,
      endedAt: null,
      nextAt: now + 60_000,
      paged: 2,
      pages: [
        {
          level: 1,
          round: 0,
          at: now - 6 * 60_000,
          userIds: ["usr_bia"],
          missed: [],
          missedCount: 0,
          reason: "started",
        },
        {
          level: 2,
          round: 0,
          at: now - 60_000,
          userIds: ["usr_dev"],
          missed: [{ userId: "usr_x", reason: "no_devices", scheduleId: null, schedule: null }],
          missedCount: 3,
          reason: "timeout",
        },
      ],
    },
  });
  await act(() => view.router.load());
  await view.flush();
  const escalation = card("Escalation")!;
  const text = escalation.textContent!;
  expect(text).toContain("Escalating");
  expect(text).toContain("Level 3 at");
  expect(text).toContain("Who it would page now");
  expect(text).toContain("Eva Lima");
  // The latest page sits right under Next; its misses are on its row, with how many more.
  expect(text).toContain("Couldn't page: Unnamed member (no phone registered) and 2 more");
  expect(text.indexOf("Level 2")).toBeLessThan(text.indexOf("Earlier levels (1)"));
  const earlier = $<HTMLDetailsElement>("details", escalation)!;
  expect(earlier.open).toBe(false);
  expect($("summary", earlier)!.textContent).toBe("Earlier levels (1)");
  expect(earlier.textContent).toContain(LONG_NAME);
  // While it escalates, phones show it before the roles.
  expect(escalation.parentElement!.className).toContain("max-md:order-first");
});

describe("who was paged, and why not", () => {
  const DEV = "dev_01JBAAAAAAAAAAAAAAAAAAAAAA";
  /** One delivery row for Bia's phone on the incident's declaration. */
  const deliver = (
    view: Awaited<ReturnType<typeof incidentPage>>,
    fields: Partial<DeliveryRow>,
  ) => {
    const eventId = "evt_01JBAAAAAAAAAAAAAAAAAAAAAA";
    view.shard.store.insert("member_devices", {
      id: DEV,
      userId: "usr_bia",
      platform: "ios",
      environment: "production",
      voip: false,
      registeredAt: T0 - 86_400_000,
      lastSeenAt: T0 - 60_000,
    });
    view.shard.store.insert("deliveries", {
      id: deliveryId(view.id, eventId, DEV),
      incidentId: view.id,
      eventId,
      deviceId: DEV,
      userId: "usr_bia",
      platform: "ios",
      environment: "production",
      run: null,
      step: null,
      plannedAt: T0,
      sentAt: T0 + 300,
      acceptedAt: T0 + 600,
      deliveredAt: null,
      attempts: 1,
      error: null,
      reason: null,
      updatedAt: T0,
      ...fields,
    });
  };

  test("the incident page lists each member's outcome, with a link to why", async () => {
    const view = await mount("/incidents/1");
    view.declare("Checkout down");
    const id = view.shard.store.scan("incidents")[0]!.id;
    deliver({ ...view, id } as Awaited<ReturnType<typeof incidentPage>>, { deliveredAt: T0 + 900 });
    await act(() => view.router.load());
    await view.flush();
    const paging = card("Who was paged")!;
    expect(paging).toBeTruthy();
    const rows = $$("li", paging);
    const bia = rows.find((row) => row.textContent?.includes(LONG_NAME))!;
    expect(bia.textContent).toContain("Delivered");
    // Who a page touched comes first.
    expect(rows[0]).toBe(bia);
    const link = $$("a", bia).find((a) => a.textContent === "Why?")!;
    expect(link.getAttribute("href")).toBe("/incidents/1?why=usr_bia");
    expect(link.getAttribute("aria-label")).toBe(`Was ${LONG_NAME} paged?`);
    expect($$("a", paging).some((a) => a.textContent === "My paging")).toBe(true);
    // The name has a line of its own on a phone; the full name stays in a tooltip where it is cut on wide screens.
    const name = $$("span", bia).find((span) => span.textContent === LONG_NAME)!;
    expect(name.className).toContain("basis-full");
    expect(name.getAttribute("title")).toBe(LONG_NAME);
  });

  test("a page planned and never sent is stuck, not sending forever", async () => {
    const view = await mount("/incidents/1");
    view.declare("Checkout down");
    const id = view.shard.store.scan("incidents")[0]!.id;
    // Planned at T0, long before now: nothing sent since.
    deliver({ ...view, id } as Awaited<ReturnType<typeof incidentPage>>, {
      sentAt: null,
      acceptedAt: null,
      attempts: 0,
    });
    await act(() => view.router.load());
    await view.flush();
    const bia = $$("li", card("Who was paged")!).find((row) =>
      row.textContent?.includes(LONG_NAME),
    )!;
    expect(bia.textContent).toContain("Planned but never sent");
    expect(bia.textContent).not.toContain("Sending");

    await act(() =>
      view.router.navigate({
        to: "/incidents/$number",
        params: { number: "1" },
        search: { why: "usr_bia" },
      }),
    );
    await view.flush();
    const text = document.body.textContent ?? "";
    expect(text).toContain(`A page to ${LONG_NAME} was planned but never sent`);
    expect(text).toContain("Brigade planned this page but never sent it");
    expect(text).toContain("Stopped here");
  });

  test("step by step: the phone, each stage with its time, and Apple's error", async () => {
    const view = await mount("/incidents/1?why=usr_bia");
    view.declare("Checkout down");
    const id = view.shard.store.scan("incidents")[0]!.id;
    deliver({ ...view, id } as Awaited<ReturnType<typeof incidentPage>>, {
      acceptedAt: null,
      error: "token_invalid",
      reason: "BadDeviceToken",
      attempts: 3,
    });
    await act(() => view.router.load());
    await view.flush();
    const text = document.body.textContent ?? "";
    expect($("h1")?.textContent).toBe(`Paging for ${LONG_NAME}`);
    expect(text).toContain(`No page got through to ${LONG_NAME}'s phone`);
    expect(text).toContain("No escalation policy");
    expect(text).toContain("iPhone · App Store build");
    expect(text).toContain("Sent by Brigade");
    // The page stopped where Apple refused it; the stage after it was never reached.
    expect(text).toContain("Stopped here");
    expect(text).toContain("Not reached");
    const planned = $$("time").find(
      (time) => time.getAttribute("datetime") === new Date(T0).toISOString(),
    );
    expect(planned).toBeTruthy();
    expect(text).toContain("Apple said this phone's token is no longer valid");
    expect(text).toContain("Apple said: BadDeviceToken");
    expect(text).toContain("Attempts: 3");
    expect(text).toContain("Everyone in this workspace sees each member's phones");
    const back = $$("a").find((a) => a.textContent?.startsWith("Back to INC-1"));
    expect(back?.getAttribute("href")).toBe("/incidents/1");
  });

  test("a member with no phone is told how to get one, in Portuguese too", async () => {
    for (const locale of ["en", "pt-BR"] as const) {
      const view = await mount("/incidents/1?why=usr_dev", locale);
      view.declare("Checkout down");
      await act(() => view.router.load());
      await view.flush();
      const [title, devices] =
        locale === "en"
          ? ["My paging", "No phone registered."]
          : ["Meus acionamentos", "Nenhum celular registrado."];
      expect($("h1")?.textContent).toBe(title);
      expect(document.body.textContent).toContain(devices);
      act(() => root?.unmount());
      client?.close();
      document.body.innerHTML = "";
      localStorage.clear();
    }
  });
});
