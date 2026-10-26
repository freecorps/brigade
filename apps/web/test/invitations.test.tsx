// @vitest-environment happy-dom
// Invitations and email verification in the dashboard: how the API's answers read, the Members card's Invite form
// (only the roles the inviter may give; while their own address is unverified, the way to verify it instead), the
// pending list with Resend and Revoke (collapsed after five, below the members), where focus goes, and the empty
// workspace pointing to Invite.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { Role } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import {
  InvitationsPanel,
  PENDING_SHOWN,
  type InvitationsApi,
} from "../src/components/invitations-panel";
import { MembersList } from "../src/components/members-card";
import { PreferencesProvider } from "../src/components/preferences";
import { MemberProvider } from "../src/components/session";
import { VerifyNotice } from "../src/components/verify-notice";
import {
  answerInvitation,
  inviteMember,
  isInvitationId,
  listInvitations,
  previewInvitation,
  resendVerification,
  verifyEmail,
  type PendingInvitation,
} from "../src/lib/invitations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  void setI18nLocale("en");
});

const ID = "inv_01JB0000000000000000000000";
const answer =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    Response.json(body, { status });

const pendingOne: PendingInvitation = {
  id: ID,
  email: "bartholomew.fitzgerald@northwind-industries-holdings.example.com",
  role: "owner",
  expiresAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
  createdAt: Date.now(),
  invitedBy: { id: "usr_ana", name: "Aleksandra Wiśniewska-Kowalczyk" },
};

describe("the API client", () => {
  test("reads invitations and refusals; anything unknown is `internal`", async () => {
    const listed = await listInvitations(
      "ws_1",
      answer(200, { invitations: [pendingOne, { id: 1 }, { ...pendingOne, role: "member" }] }),
    );
    expect(listed).toEqual({ ok: true, value: [pendingOne] });
    expect(
      await inviteMember(
        "ws_1",
        "x@example.com",
        "viewer",
        answer(409, { error: "already_invited" }),
      ),
    ).toEqual({
      ok: false,
      error: "already_invited",
    });
    expect(
      await inviteMember("ws_1", "x", "viewer", answer(400, { error: "invalid_args" })),
    ).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(
      await inviteMember(
        "ws_1",
        "x@example.com",
        "viewer",
        answer(429, { error: "address_limited" }),
      ),
    ).toEqual({ ok: false, error: "address_limited" });
    expect(
      await inviteMember("ws_1", "x@example.com", "viewer", answer(500, { error: "boom" })),
    ).toEqual({
      ok: false,
      error: "internal",
    });
    const offline: typeof fetch = async () => {
      throw new TypeError("offline");
    };
    expect(await listInvitations("ws_1", offline)).toEqual({ ok: false, error: "network" });
  });

  test("the invitee's preview, accepting and declining", async () => {
    const preview = await previewInvitation(
      ID,
      answer(200, {
        invitation: {
          id: ID,
          workspace: { id: "ws_1", name: "Acme" },
          invitedBy: "Ana",
          role: "responder",
          status: "pending",
          expiresAt: 1,
          forYou: true,
        },
      }),
    );
    expect(preview).toMatchObject({ ok: true, value: { forYou: true, role: "responder" } });
    expect(
      await answerInvitation(ID, "accept", answer(200, { ok: true, workspaceId: "ws_1" })),
    ).toEqual({
      ok: true,
      value: { workspaceId: "ws_1" },
    });
    expect(await answerInvitation(ID, "accept", answer(403, { error: "wrong_email" }))).toEqual({
      ok: false,
      error: "wrong_email",
    });
    expect(isInvitationId(ID)).toBe(true);
    expect(isInvitationId("inv_../../x")).toBe(false);
  });

  test("verification: asking again and opening the link", async () => {
    expect(
      await resendVerification("a@example.com", undefined, answer(200, { status: true })),
    ).toEqual({ ok: true });
    expect(await resendVerification("a@example.com", undefined, answer(429, {}))).toEqual({
      ok: false,
      error: "rate_limited",
    });
    expect(
      await resendVerification(
        "a@example.com",
        undefined,
        answer(503, { code: "EMAIL_NOT_CONFIGURED" }),
      ),
    ).toEqual({ ok: false, error: "not_configured" });
    expect(await verifyEmail("t", answer(200, { status: true }))).toBe("verified");
    expect(await verifyEmail("t", answer(401, { code: "TOKEN_EXPIRED" }))).toBe("expired");
    expect(await verifyEmail("t", answer(401, { code: "INVALID_TOKEN" }))).toBe("invalid");
  });
});

function fakeApi(list: PendingInvitation[] = []) {
  const calls: string[] = [];
  const api: InvitationsApi = {
    list: async () => ({ ok: true, value: list }),
    invite: async (_ws, email, role) => {
      calls.push(`invite ${email} ${role}`);
      return { ok: true, value: { ...pendingOne, email, role } };
    },
    resend: async (_ws, id) => {
      calls.push(`resend ${id}`);
      return { ok: false, error: "too_soon" };
    },
    revoke: async (_ws, id) => {
      calls.push(`revoke ${id}`);
      return { ok: true, value: true };
    },
  };
  return { api, calls };
}

async function renderPanel(
  role: Role,
  options: {
    verified?: boolean;
    list?: PendingInvitation[];
    open?: boolean;
    ownEmail?: string;
  } = {},
) {
  const { api, calls } = fakeApi(options.list);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <PreferencesProvider initialLocale="en">
        <InvitationsPanel
          workspaceId="ws_1"
          role={role}
          verified={options.verified ?? true}
          ownEmail={options.ownEmail ?? "ana@example.com"}
          open={options.open ?? true}
          setOpen={() => {}}
          api={api}
        />
      </PreferencesProvider>,
    ),
  );
  return { container, calls };
}

const click = async (button: Element | null | undefined) => {
  await act(async () => (button as HTMLButtonElement).click());
};
const byText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(text));

describe("the Invite form", () => {
  test("an admin is offered every role but owner; an owner every role", async () => {
    const admin = await renderPanel("admin");
    expect([...admin.container.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "admin",
      "responder",
      "viewer",
    ]);
    act(() => root?.unmount());
    const owner = await renderPanel("owner");
    expect([...owner.container.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "owner",
      "admin",
      "responder",
      "viewer",
    ]);
  });

  test("checks the address before sending, then sends it with the role", async () => {
    const { container, calls } = await renderPanel("owner");
    const input = container.querySelector<HTMLInputElement>("input[type=email]")!;
    await click(byText(container, "Send invitation"));
    expect(calls).toEqual([]);
    expect(container.textContent).toContain("Fill in this field.");
    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "  gil@example.com ", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(byText(container, "Send invitation"));
    expect(calls).toEqual(["invite gil@example.com responder"]);
    expect(container.textContent).toContain("Invitation sent to gil@example.com.");
  });

  test("an unverified inviter gets the way to confirm their own email, not a form they cannot send", async () => {
    const { container } = await renderPanel("owner", { verified: false });
    expect(container.textContent).toContain(
      "Confirm your own email before you invite people: open the link we sent to ana@example.com.",
    );
    expect(container.querySelector("input[type=email]")).toBeNull();
    expect(byText(container, "Send invitation")).toBeUndefined();
    const again = byText(container, "Send the link again");
    expect(document.activeElement).toBe(again);
  });

  test("before the session gives the inviter's address, nothing points at a blank one or asks for it", async () => {
    const fetching = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const { container } = await renderPanel("owner", { verified: false, ownEmail: "" });
    expect(container.textContent).toContain("Confirm your own email before you invite people.");
    expect(container.textContent).not.toContain("sent to .");
    await click(byText(container, "Send the link again"));
    expect(fetching).not.toHaveBeenCalled();
    fetching.mockRestore();
  });

  test("a double click sends once: Resend, Revoke and the Invite form", async () => {
    const { container, calls } = await renderPanel("owner", { list: [pendingOne] });
    const twice = (button: Element | null | undefined) =>
      act(async () => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
    await twice(byText(container, "Resend"));
    expect(calls).toEqual([`resend ${ID}`]);
    await click(byText(container, "Revoke"));
    await twice(container.querySelector("[role=group] button"));
    expect(calls).toEqual([`resend ${ID}`, `revoke ${ID}`]);
    const input = container.querySelector<HTMLInputElement>("input[type=email]")!;
    await act(async () => {
      Reflect.set(HTMLInputElement.prototype, "value", "gil@example.com", input);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await twice(byText(container, "Send invitation"));
    expect(calls.filter((call) => call.startsWith("invite"))).toEqual([
      "invite gil@example.com responder",
    ]);
  });

  test("pending invitations: an admin cannot touch an owner's; a refused resend says why", async () => {
    const admin = await renderPanel("admin", { list: [pendingOne] });
    expect(admin.container.textContent).toContain(pendingOne.email);
    expect(byText(admin.container, "Revoke")).toBeUndefined();
    act(() => root?.unmount());
    const owner = await renderPanel("owner", { list: [pendingOne] });
    // The day it runs out, not a count that reads one short right after sending.
    const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
      pendingOne.expiresAt,
    );
    expect(owner.container.textContent).toContain(`Expires ${day}. Invited by Aleksandra`);
    await click(byText(owner.container, "Resend"));
    expect(owner.calls).toEqual([`resend ${ID}`]);
    expect(owner.container.textContent).toContain("went out a few minutes ago");
    await click(byText(owner.container, "Revoke"));
    expect(owner.container.textContent).toContain(`Revoke the invitation to ${pendingOne.email}?`);
    const confirm = [...owner.container.querySelectorAll("[role=group] button")][0];
    expect(confirm?.textContent).toBe("Revoke invitation");
    await click(confirm);
    expect(owner.calls).toContain(`revoke ${ID}`);
  });
});

describe("focus in the pending list", () => {
  const other: PendingInvitation = {
    ...pendingOne,
    id: "inv_01JB0000000000000000000001",
    email: "gil@example.com",
  };
  const key = async (target: Element, name: string) => {
    await act(async () => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  };

  test("the prompt takes focus; Escape and Cancel close it and give focus back to Revoke", async () => {
    const { container } = await renderPanel("owner", { list: [pendingOne], open: false });
    const toggle = byText(container, "Revoke")!;
    await click(toggle);
    const confirm = byText(container, "Revoke invitation")!;
    expect(document.activeElement).toBe(confirm);
    await key(confirm, "Escape");
    expect(container.querySelector("[role=group]")).toBeNull();
    expect(document.activeElement).toBe(toggle);
    await click(toggle);
    await click(byText(container.querySelector("[role=group]")!, "Cancel"));
    expect(container.querySelector("[role=group]")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  test("after a revoke, focus moves to the next invitation, or to the outcome when none is left", async () => {
    const list = [pendingOne, other];
    const { api } = fakeApi();
    api.list = async () => ({ ok: true, value: [...list] });
    api.revoke = async (_ws, id) => {
      list.splice(
        list.findIndex((one) => one.id === id),
        1,
      );
      return { ok: true, value: true };
    };
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <PreferencesProvider initialLocale="en">
          <InvitationsPanel
            workspaceId="ws_1"
            role="owner"
            verified
            ownEmail="ana@example.com"
            open={false}
            setOpen={() => {}}
            api={api}
          />
        </PreferencesProvider>,
      ),
    );
    await click(byText(container, "Revoke"));
    await click(byText(container, "Revoke invitation"));
    const next = container.querySelector(`[data-invitation="${other.id}"] button`);
    expect(document.activeElement).toBe(next);
    await click(byText(container, "Revoke"));
    await click(byText(container, "Revoke invitation"));
    expect(document.activeElement?.textContent).toBe(`Invitation to ${other.email} revoked.`);
    expect(document.activeElement).not.toBe(document.body);
  });

  test(`after ${PENDING_SHOWN}, the rest wait behind Show all`, async () => {
    const many = Array.from({ length: PENDING_SHOWN + 2 }, (_, i) => ({
      ...pendingOne,
      id: `inv_01JB00000000000000000000${String(i).padStart(2, "0")}`,
      email: `person-${i}@example.com`,
    }));
    const { container } = await renderPanel("owner", { list: many, open: false });
    expect(container.querySelectorAll("[data-invitation]")).toHaveLength(PENDING_SHOWN);
    await click(byText(container, `Show all ${many.length} invitations`));
    expect(container.querySelectorAll("[data-invitation]")).toHaveLength(many.length);
    expect(document.activeElement).toBe(
      container.querySelector(`[data-invitation="${many[PENDING_SHOWN]!.id}"] button`),
    );
  });
});

describe("the Members card and the verification notice", () => {
  const renderCard = (role: Role, invite: boolean) => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let opened = 0;
    const render = (state: { opened?: boolean; count?: number; pending?: string } = {}) =>
      act(() =>
        root!.render(
          <PreferencesProvider initialLocale="pt-BR">
            <MemberProvider workspaceId="ws_1" userId="usr_ana" role={role}>
              <MembersList
                members={[{ userId: "usr_ana", name: "Ana", email: "ana@example.com", role }]}
                loading={false}
                change={async () => ({ ok: true })}
                refresh={async () => true}
                left={() => {}}
                invite={
                  invite
                    ? {
                        open: () => opened++,
                        opened: state.opened ?? false,
                        form: state.opened ? <p>form</p> : null,
                        pending: state.pending ? <p data-pending>{state.pending}</p> : null,
                        count: state.count ?? 0,
                      }
                    : undefined
                }
              />
            </MemberProvider>
          </PreferencesProvider>,
        ),
      );
    render();
    return { container, opened: () => opened, render };
  };

  test("alone in the workspace, an owner is pointed to Invite; a viewer is not", async () => {
    await setI18nLocale("pt-BR");
    const owner = renderCard("owner", true);
    expect(owner.container.textContent).toContain("Convide sua equipe");
    // The card's own Invite button, next to its heading: one per card.
    const buttons = [...owner.container.querySelectorAll("button")].filter(
      (b) => b.textContent === "Convidar",
    );
    expect(buttons).toHaveLength(1);
    await click(buttons[0]);
    expect(owner.opened()).toBe(1);
    act(() => root?.unmount());
    const viewer = renderCard("viewer", false);
    expect(viewer.container.textContent).toContain("Ainda não há mais ninguém");
    expect(viewer.container.textContent).not.toContain("Convidar");
  });

  test("pending invitations come after the members and replace the empty message", async () => {
    await setI18nLocale("pt-BR");
    const owner = renderCard("owner", true);
    owner.render({ count: 2, pending: "Convites pendentes" });
    expect(owner.container.textContent).not.toContain("Convide sua equipe");
    const list = owner.container.querySelector("ul")!;
    const pending = owner.container.querySelector("[data-pending]")!;
    expect(list.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("closing the form (sent or cancelled) gives focus back to Invite", async () => {
    await setI18nLocale("pt-BR");
    const owner = renderCard("owner", true);
    owner.render({ opened: true });
    expect(owner.container.textContent).toContain("form");
    owner.render({ opened: false });
    const button = [...owner.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Convidar",
    );
    expect(document.activeElement).toBe(button);
  });

  test("the notice shows only for an unverified address, and asks again", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const asked: string[] = [];
    const render = (verified: boolean) =>
      act(() =>
        root!.render(
          <PreferencesProvider initialLocale="en">
            <VerifyNotice
              email="ana@example.com"
              verified={verified}
              resend={async (email) => {
                asked.push(email);
                return { ok: false, error: "rate_limited" };
              }}
            />
          </PreferencesProvider>,
        ),
      );
    render(true);
    expect(container.textContent).toBe("");
    render(false);
    expect(container.textContent).toContain("We sent a link to ana@example.com.");
    // Twice before the re-render: still one email.
    await act(async () => {
      byText(container, "Send the link again")!.click();
      byText(container, "Send the link again")!.click();
    });
    expect(asked).toEqual(["ana@example.com"]);
    expect(container.textContent).toContain("Wait a few minutes");
  });
});
