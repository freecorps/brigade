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
import { changeMember, memberChoices, type ListedMember } from "../src/lib/members";

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

function render(
  as: { userId: string; role: Role },
  options: {
    result?: { ok: true } | { ok: false; error: "last_owner" };
    locale?: "en" | "pt-BR";
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
            members={team}
            loading={false}
            change={async (userId, change) => {
              changes.push([userId, change]);
              return options.result ?? { ok: true };
            }}
            refresh={async () => {}}
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

  test("reads in Portuguese", () => {
    const { container } = render({ userId: "usr_ana", role: "owner" }, { locale: "pt-BR" });
    expect(container.textContent).toContain("Membros");
    expect(container.textContent).toContain("Proprietário");
  });
});
