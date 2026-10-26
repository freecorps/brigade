// @vitest-environment happy-dom
// Member management in the dashboard: the choices each role is offered (the API's own rules), how the API's
// answers read, and the Members card: read-only for viewers, a role picker and a confirmed removal for owners and
// admins, and leaving.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { MemberChange, Role } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { MembersList } from "../src/components/members-card";
import { PreferencesProvider } from "../src/components/preferences";
import { MemberProvider } from "../src/components/session";
import {
  changeMember,
  memberChoices,
  selfDemotion,
  sortMembers,
  type ListedMember,
  type MemberChangeError,
} from "../src/lib/members";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  void setI18nLocale("en");
});

const team: ListedMember[] = [
  { userId: "usr_ana", name: "Ana Souza", email: "ana@example.com", role: "owner" },
  { userId: "usr_bia", name: "Bia Lima", email: "bia@example.com", role: "admin" },
  { userId: "usr_caio", name: "Caio Rocha", email: "caio@example.com", role: "responder" },
  { userId: "usr_duda", name: "", email: "duda@example.com", role: "viewer" },
];

describe("memberChoices", () => {
  test("owners pick any role for others and remove them; the last owner cannot step down or leave", () => {
    const ana = { id: "usr_ana", role: "owner" as const };
    expect(memberChoices(ana, { id: "usr_caio", role: "responder" }, 1)).toEqual({
      roles: ["owner", "admin", "responder", "viewer"],
      remove: true,
      leave: false,
    });
    expect(memberChoices(ana, { id: "usr_ana", role: "owner" }, 1)).toEqual({
      roles: [],
      remove: false,
      leave: false,
    });
    expect(memberChoices(ana, { id: "usr_ana", role: "owner" }, 2)).toMatchObject({ leave: true });
  });

  test("admins never touch owners nor offer owner; responders and viewers only leave", () => {
    const bia = { id: "usr_bia", role: "admin" as const };
    expect(memberChoices(bia, { id: "usr_ana", role: "owner" }, 1)).toEqual({
      roles: [],
      remove: false,
      leave: false,
    });
    expect(memberChoices(bia, { id: "usr_caio", role: "responder" }, 1).roles).toEqual([
      "admin",
      "responder",
      "viewer",
    ]);
    const duda = { id: "usr_duda", role: "viewer" as const };
    expect(memberChoices(duda, { id: "usr_caio", role: "responder" }, 1)).toEqual({
      roles: [],
      remove: false,
      leave: false,
    });
    expect(memberChoices(duda, { id: "usr_duda", role: "viewer" }, 1)).toEqual({
      roles: [],
      remove: false,
      leave: true,
    });
  });
});

describe("sortMembers and selfDemotion", () => {
  test("unnamed members come last within their role", () => {
    const sorted = sortMembers([
      { userId: "usr_x", name: "", email: "a@example.com", role: "viewer" },
      { userId: "usr_y", name: "Zé", email: "z@example.com", role: "viewer" },
      { userId: "usr_z", name: "", email: "b@example.com", role: "owner" },
    ]);
    expect(sorted.map((member) => member.userId)).toEqual(["usr_z", "usr_y", "usr_x"]);
  });

  test("only a step down is a demotion, and it says what is lost", () => {
    expect(selfDemotion("owner", "admin")).toBe("owner");
    expect(selfDemotion("owner", "viewer")).toBe("manage");
    expect(selfDemotion("admin", "responder")).toBe("manage");
    expect(selfDemotion("admin", "owner")).toBeNull();
    expect(selfDemotion("admin", "admin")).toBeNull();
  });
});

describe("changeMember", () => {
  test("sends PATCH with the role or DELETE, and reads the API's error codes", async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const answer = (status: number, body: unknown) => async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return Response.json(body, { status });
    };
    expect(
      await changeMember(
        "ws_1",
        "usr_caio",
        { kind: "role", role: "viewer" },
        answer(200, { ok: true }) as typeof fetch,
      ),
    ).toEqual({ ok: true });
    expect(calls[0]).toEqual({
      url: "/api/workspaces/ws_1/members/usr_caio",
      method: "PATCH",
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(
      await changeMember(
        "ws_1",
        "usr_ana",
        { kind: "remove" },
        answer(409, { error: "last_owner" }) as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "last_owner" });
    expect(calls[1]).toMatchObject({ method: "DELETE" });
    expect(
      await changeMember(
        "ws_1",
        "usr_ana",
        { kind: "remove" },
        answer(503, { error: "not_applied" }) as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "not_applied" });
    expect(
      await changeMember(
        "ws_1",
        "usr_ana",
        { kind: "remove" },
        answer(403, { error: "not_a_member" }) as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "not_a_member" });
    expect(
      await changeMember(
        "ws_1",
        "usr_ana",
        { kind: "remove" },
        answer(500, "nope") as typeof fetch,
      ),
    ).toEqual({ ok: false, error: "internal" });
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    expect(await changeMember("ws_1", "usr_ana", { kind: "remove" }, offline)).toEqual({
      ok: false,
      error: "network",
    });
  });
});

type Answer = { ok: true } | { ok: false; error: MemberChangeError };

function render(
  as: { userId: string; role: Role },
  options: {
    /** One answer for every change, or one per change in order (the last repeats). */
    result?: Answer | Answer[];
    locale?: "en" | "pt-BR";
    members?: ListedMember[];
    /** What reloading the list finds: whether D1 still has the signed-in user in the workspace. */
    member?: boolean;
  } = {},
) {
  const changes: [string, MemberChange][] = [];
  let leftCount = 0;
  void setI18nLocale(options.locale ?? "en");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <PreferencesProvider initialLocale={options.locale ?? "en"}>
        <MemberProvider workspaceId="ws_1" userId={as.userId} role={as.role}>
          <MembersList
            members={options.members ?? team}
            loading={false}
            change={async (userId, change) => {
              changes.push([userId, change]);
              const answers = [options.result ?? { ok: true }].flat();
              return answers[Math.min(changes.length, answers.length) - 1]!;
            }}
            refresh={async () => options.member ?? true}
            left={() => leftCount++}
          />
        </MemberProvider>
      </PreferencesProvider>,
    ),
  );
  const row = (userId: string) =>
    container.querySelector<HTMLElement>(`[data-member="${userId}"]`)!;
  const button = (scope: HTMLElement, text: string) =>
    [...scope.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
  return { container, changes, row, button, left: () => leftCount };
}

describe("MembersList", () => {
  test("viewers read names, emails and roles, and can only leave", () => {
    const { container, row } = render({ userId: "usr_duda", role: "viewer" });
    expect(container.textContent).toContain("4 members");
    expect(container.textContent).toContain(
      "Only owners and admins change roles or remove members.",
    );
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(row("usr_caio").textContent).toContain("caio@example.com");
    expect(row("usr_caio").textContent).toContain("Responder");
    expect(row("usr_caio").querySelector("button")).toBeNull();
    // An unnamed member still shows, as unnamed, and their own row says so.
    expect(row("usr_duda").textContent).toContain("Unnamed member");
    expect(row("usr_duda").textContent).toContain("You");
    expect(row("usr_duda").textContent).toContain("Leave workspace");
  });

  test("an admin changes a responder's role, but has no control on the owner's row", async () => {
    const { changes, row } = render({ userId: "usr_bia", role: "admin" });
    expect(row("usr_ana").querySelector("select")).toBeNull();
    expect(row("usr_ana").querySelector("button")).toBeNull();
    const select = row("usr_caio").querySelector("select")!;
    expect([...select.options].map((option) => option.value)).toEqual([
      "admin",
      "responder",
      "viewer",
    ]);
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(changes).toEqual([["usr_caio", { kind: "role", role: "viewer" }]]);
  });

  test("removing asks first, names the member, and Cancel changes nothing", async () => {
    const { changes, row, button } = render({ userId: "usr_ana", role: "owner" });
    act(() => button(row("usr_caio"), "Remove").click());
    expect(row("usr_caio").textContent).toContain(
      "Remove Caio Rocha from the workspace? They lose access and stop being paged right away.",
    );
    act(() => button(row("usr_caio"), "Cancel").click());
    expect(changes).toEqual([]);
    act(() => button(row("usr_caio"), "Remove").click());
    const confirm = [...row("usr_caio").querySelectorAll("button")].find(
      (b) => b.textContent === "Remove" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => confirm.click());
    expect(changes).toEqual([["usr_caio", { kind: "remove" }]]);
  });

  test("leaving goes back to the start once the API agreed; a refusal is shown instead", async () => {
    const ok = render({ userId: "usr_caio", role: "responder" });
    act(() => ok.button(ok.row("usr_caio"), "Leave workspace").click());
    const confirm = [...ok.row("usr_caio").querySelectorAll("button")].find(
      (b) => b.textContent === "Leave workspace" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => confirm.click());
    expect(ok.left()).toBe(1);
    act(() => root?.unmount());
    document.body.innerHTML = "";

    const refused = render(
      { userId: "usr_ana", role: "owner" },
      { result: { ok: false, error: "last_owner" } },
    );
    act(() => refused.button(refused.row("usr_caio"), "Remove").click());
    const remove = [...refused.row("usr_caio").querySelectorAll("button")].find(
      (b) => b.textContent === "Remove" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => remove.click());
    expect(refused.container.querySelector('[role="alert"]')?.textContent).toContain(
      "A workspace needs at least one owner.",
    );
  });

  test("stepping one's own role down asks first and says it cannot be undone alone", async () => {
    const { changes, row, button } = render({ userId: "usr_bia", role: "admin" });
    const select = row("usr_bia").querySelector("select")!;
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(changes).toEqual([]);
    expect(row("usr_bia").textContent).toContain(
      "Change your role to Viewer? You can no longer manage members; only an owner or admin can give it back.",
    );
    act(() => button(row("usr_bia"), "Cancel").click());
    expect(changes).toEqual([]);
    expect(document.activeElement).toBe(select);
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(row("usr_bia"), "Change role").click());
    expect(changes).toEqual([["usr_bia", { kind: "role", role: "viewer" }]]);
  });

  test("changing someone else's role, or raising one's own, does not ask", async () => {
    const { changes, row } = render({ userId: "usr_ana", role: "owner" });
    const select = row("usr_caio").querySelector("select")!;
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(changes).toEqual([["usr_caio", { kind: "role", role: "viewer" }]]);
  });

  test("not_applied is a quiet note, not an error: it is saved, and there is nothing to retry", async () => {
    const { row, button, container } = render(
      { userId: "usr_ana", role: "owner" },
      { result: { ok: false, error: "not_applied" } },
    );
    const select = row("usr_caio").querySelector("select")!;
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(row("usr_caio").querySelector('[role="status"]')?.textContent).toBe(
      "Saved. Paging catches up on its own within a minute.",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button(row("usr_caio"), "Try again")).toBeUndefined();
    // The control that started the change keeps focus.
    expect(document.activeElement).toBe(select);
  });

  test("a failure shows in the member's own row; Try again sends the same request and keeps focus", async () => {
    const { changes, row, button, container } = render(
      { userId: "usr_ana", role: "owner" },
      { result: { ok: false, error: "network" } },
    );
    const select = row("usr_caio").querySelector("select")!;
    await act(async () => {
      select.value = "viewer";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(row("usr_caio").querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't confirm the change; check the list.",
    );
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement).toBe(select);
    await act(async () => button(row("usr_caio"), "Try again").click());
    expect(changes).toEqual([
      ["usr_caio", { kind: "role", role: "viewer" }],
      ["usr_caio", { kind: "role", role: "viewer" }],
    ]);
    // Failed again: focus stays on Try again, which still shows.
    expect(document.activeElement).toBe(button(row("usr_caio"), "Try again"));
  });

  test("opening a confirm clears the row's error, so a row never shows both", async () => {
    const { row, button } = render(
      { userId: "usr_ana", role: "owner" },
      { result: { ok: false, error: "unavailable" } },
    );
    act(() => button(row("usr_caio"), "Remove").click());
    const confirm = [...row("usr_caio").querySelectorAll("button")].find(
      (b) => b.textContent === "Remove" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => confirm.click());
    expect(row("usr_caio").querySelector('[role="alert"]')).not.toBeNull();
    act(() => button(row("usr_caio"), "Remove").click());
    expect(row("usr_caio").querySelector('[role="group"]')).not.toBeNull();
    expect(row("usr_caio").querySelector('[role="alert"]')).toBeNull();
  });

  const leave = async (rendered: ReturnType<typeof render>, userId: string) => {
    const { row, button } = rendered;
    act(() => button(row(userId), "Leave workspace").click());
    const confirm = [...row(userId).querySelectorAll("button")].find(
      (b) => b.textContent === "Leave workspace" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => confirm.click());
  };

  test("one's own leave answered not_a_member (an earlier attempt went through) goes back to the start", async () => {
    const rendered = render(
      { userId: "usr_caio", role: "responder" },
      { result: { ok: false, error: "not_a_member" }, member: false },
    );
    await leave(rendered, "usr_caio");
    expect(rendered.left()).toBe(1);
  });

  test("one's own leave answered not_applied is done: D1 has it, and the shard catches up on its own", async () => {
    const rendered = render(
      { userId: "usr_caio", role: "responder" },
      { result: { ok: false, error: "not_applied" } },
    );
    await leave(rendered, "usr_caio");
    expect(rendered.left()).toBe(1);
  });

  test("not_a_member for someone D1 still has (a role Brigade does not know) stays put and says so", async () => {
    const rendered = render(
      { userId: "usr_caio", role: "responder" },
      { result: { ok: false, error: "not_a_member" }, member: true },
    );
    await leave(rendered, "usr_caio");
    // Going back to the start would open this same workspace again.
    expect(rendered.left()).toBe(0);
    expect(rendered.row("usr_caio").querySelector('[role="alert"]')?.textContent).toContain(
      "You can't make this change.",
    );
  });

  test("after a removal, focus moves to the next member's first control", async () => {
    const { row, button } = render({ userId: "usr_ana", role: "owner" });
    act(() => button(row("usr_bia"), "Remove").click());
    const confirm = [...row("usr_bia").querySelectorAll("button")].find(
      (b) => b.textContent === "Remove" && b.getAttribute("aria-expanded") === null,
    )!;
    await act(async () => confirm.click());
    expect(document.activeElement).toBe(row("usr_caio").querySelector("select"));
  });

  test("only one confirm is open at a time", () => {
    const { row, button, container } = render({ userId: "usr_ana", role: "owner" });
    act(() => button(row("usr_caio"), "Remove").click());
    act(() => button(row("usr_bia"), "Remove").click());
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(row("usr_bia").querySelector('[role="group"]')).not.toBeNull();
  });

  test("the only owner is told why they cannot leave or step down", () => {
    const { row } = render({ userId: "usr_ana", role: "owner" });
    expect(row("usr_ana").textContent).toContain(
      "You're the only owner. Make someone else an owner before you can leave or change your role.",
    );
    expect(row("usr_bia").textContent).not.toContain("only owner");
  });

  test("a long list shows owners and admins first and ten rows, until Show all", () => {
    const many: ListedMember[] = [
      ...team,
      ...Array.from({ length: 26 }, (_, index) => ({
        userId: `usr_m${index}`,
        name: `Member ${String(index).padStart(2, "0")}`,
        email: `m${index}@example.com`,
        role: "responder" as const,
      })),
    ];
    const { container, button } = render({ userId: "usr_ana", role: "owner" }, { members: many });
    expect(container.querySelectorAll("[data-member]")).toHaveLength(10);
    expect(container.querySelector("[data-member]")?.getAttribute("data-member")).toBe("usr_ana");
    act(() => button(container, "Show all 30 members").click());
    expect(container.querySelectorAll("[data-member]")).toHaveLength(30);
    expect(container.textContent).not.toContain("Show all");
  });

  test("a collapsed list always keeps the signed-in member's own row, and Show all focuses a viewer's next row", () => {
    const many: ListedMember[] = [
      ...team,
      ...Array.from({ length: 26 }, (_, index) => ({
        userId: `usr_m${index}`,
        name: `Member ${String(index).padStart(2, "0")}`,
        email: `m${index}@example.com`,
        role: "responder" as const,
      })),
    ];
    // Duda is a viewer: sorted last of 30, past the first ten.
    const { container, button, row } = render(
      { userId: "usr_duda", role: "viewer" },
      { members: many },
    );
    expect(container.querySelectorAll("[data-member]")).toHaveLength(11);
    expect(row("usr_duda").textContent).toContain("Leave workspace");
    act(() => button(container, "Show all 30 members").click());
    // The first row Show all revealed has no control for a viewer: the row itself takes focus.
    const first = container.querySelectorAll<HTMLElement>("[data-member]")[10]!;
    expect(first.querySelector("select, button")).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  test("reads in Portuguese", () => {
    const { container } = render({ userId: "usr_ana", role: "owner" }, { locale: "pt-BR" });
    expect(container.textContent).toContain("Membros");
    expect(container.textContent).toContain("Proprietário");
  });
});
