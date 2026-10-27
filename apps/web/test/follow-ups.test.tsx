// @vitest-environment happy-dom
// Follow-ups, the postmortem and exports (RFC 0013) on the incident page and `/follow-ups`, in the real router against
// the reference shard server from packages/sync's tests; and the helpers in src/lib/follow-ups.ts.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import {
  EMPTY_SECTIONS,
  newId,
  type Actor,
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
import {
  formatDueDate,
  linkProblem,
  loadFeatures,
  localDate,
  resetFeatures,
} from "../src/lib/follow-ups";
import { routeTree } from "../src/routeTree.gen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The signed-in member's role, read by the mocked Better Auth client. */
let role: Role = "responder";
/** What `GET /api/features` answers. */
let features = { ai: false, exports: false };
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
  features = { ai: false, exports: false };
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
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    input === "/api/features" ? Response.json(features) : Promise.reject(new TypeError("offline")),
  );
  resetFeatures();
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

function setValue(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = field instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
  Reflect.set(proto.prototype, "value", value, field);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

const FUP = "fup_01JB0000000000000000000001";

const followUp = (id: string, patch: Record<string, unknown> = {}) => ({
  id: FUP,
  incidentId: id,
  title: "Add a retry budget to the payment client",
  ownerId: "usr_bia",
  dueDate: "2026-10-20",
  link: "https://issues.example.com/PAY-12",
  ...patch,
});

describe("follow-ups", () => {
  test("an open follow-up past its due date reads as overdue, with its owner and link", async () => {
    const view = await incidentPage();
    expect(view.shard.write(bia, "followUp.create", followUp(view.id))).toMatchObject({ ok: true });
    await view.flush();
    const followUps = card("Follow-ups")!;
    expect(followUps.textContent).toContain("Add a retry budget to the payment client");
    expect(followUps.textContent).toContain("Overdue since Oct 20, 2026");
    expect(followUps.textContent).toContain(LONG_NAME);
    expect($<HTMLAnchorElement>("a[target=_blank]", followUps)!.href).toBe(
      "https://issues.example.com/PAY-12",
    );
    // Done, it is no longer overdue.
    await click($("button[aria-pressed=false]", followUps));
    await view.flush();
    expect(card("Follow-ups")!.textContent).not.toContain("Overdue");
    expect(view.shard.store.get("follow_ups", FUP)!.status).toBe("done");
  });

  test("a responder adds one; a bad link is refused before anything is sent", async () => {
    // The new follow-up's id is dated by this clock: the shard refuses ids far ahead of its own.
    vi.spyOn(Date, "now").mockReturnValue(T0);
    const view = await incidentPage();
    const followUps = card("Follow-ups")!;
    await click($$("button", followUps).find((button) => button.textContent === "Add follow-up"));
    const inputs = $$("input", followUps) as HTMLInputElement[];
    await act(async () => {
      setValue(inputs[0]!, "Page the payments team earlier");
      setValue(
        inputs.find((input) => input.type === "url")!,
        "ftp://nope",
      );
    });
    await click($$("button", followUps).find((button) => button.textContent === "Save"));
    expect(followUps.textContent).toContain("Enter a link that starts with http:// or https://.");
    expect(view.sentMutations()).toHaveLength(0);
    await act(async () =>
      setValue(
        inputs.find((input) => input.type === "url")!,
        "",
      ),
    );
    await click($$("button", followUps).find((button) => button.textContent === "Save"));
    await view.flush();
    expect(view.shard.store.scan("follow_ups")).toMatchObject([
      { title: "Page the payments team earlier", ownerId: null, dueDate: null, link: null },
    ]);
  });

  test("viewers read them and change nothing", async () => {
    role = "viewer";
    const view = await incidentPage();
    view.shard.write(bia, "followUp.create", followUp(view.id));
    await view.flush();
    const followUps = card("Follow-ups")!;
    expect(followUps.textContent).toContain(
      "Only responders, admins and owners change follow-ups.",
    );
    expect($$("button", followUps)).toHaveLength(0);
  });

  test("/follow-ups lists every incident's open ones with their incident, in pt-BR too", async () => {
    const view = await mount("/follow-ups", "pt-BR");
    const id = view.declare("Checkout down");
    view.shard.write(bia, "followUp.create", followUp(id));
    await act(() => view.router.load());
    await view.flush();
    expect(document.body.textContent).toContain("Ações em aberto");
    expect(document.body.textContent).toContain("INC-1 Checkout down");
    expect(document.body.textContent).toContain("Atrasadas: 1");
  });
});

describe("postmortem", () => {
  test("an AI draft is marked for review; the button is hidden without Workers AI", async () => {
    const view = await mount("/incidents/1");
    const id = view.declare("Checkout down");
    view.shard.store.insert("postmortems", {
      id,
      sections: { ...EMPTY_SECTIONS, summary: "Checkout failed for 20 minutes." },
      revision: 1,
      ai: { at: T0, model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", by: "usr_dev" },
      draft: null,
      createdAt: T0,
      updatedAt: T0,
      updatedBy: "sys_ai",
    });
    await act(() => view.router.load());
    await view.flush();
    const postmortem = card("Postmortem")!;
    expect(postmortem.textContent).toContain("AI draft — review before sharing");
    expect(postmortem.textContent).toContain("Checkout failed for 20 minutes.");
    expect(postmortem.textContent).not.toContain("Draft again with AI");
  });

  test("with Workers AI an empty postmortem offers a draft; editing saves over its revision", async () => {
    features = { ai: true, exports: false };
    const view = await incidentPage();
    await view.flush();
    const postmortem = card("Postmortem")!;
    expect(postmortem.textContent).toContain("Draft with AI");
    await click(
      $$("button", postmortem).find((button) => button.textContent === "Write postmortem"),
    );
    const summary = $<HTMLTextAreaElement>("textarea", postmortem)!;
    await act(async () => setValue(summary, "Checkout failed."));
    await click($$("button", postmortem).find((button) => button.textContent === "Save"));
    await view.flush();
    expect(view.shard.store.get("postmortems", view.id)).toMatchObject({
      revision: 1,
      sections: { summary: "Checkout failed." },
    });
  });
});

describe("helpers", () => {
  test("dates are the reader's calendar days, never shifted by a zone", () => {
    expect(localDate(Date.UTC(2026, 9, 27, 2, 0), "America/Sao_Paulo")).toBe("2026-10-26");
    expect(formatDueDate("2026-11-02", "en")).toBe("Nov 2, 2026");
    expect(formatDueDate("2026-11-02", "pt-BR")).toContain("2026");
  });

  test("a link is empty or http(s)", () => {
    expect(linkProblem("")).toBeUndefined();
    expect(linkProblem("https://issues.example.com/1")).toBeUndefined();
    expect(linkProblem("javascript:alert(1)")).toBeTruthy();
  });

  test("features are off until the server says otherwise, and a failure is asked again", async () => {
    resetFeatures();
    const failing = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await loadFeatures(failing as unknown as typeof fetch)).toEqual({
      ai: false,
      exports: false,
    });
    const ok = vi.fn(async () => Response.json({ ai: true, exports: true }));
    expect(await loadFeatures(ok as unknown as typeof fetch)).toEqual({ ai: true, exports: true });
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
