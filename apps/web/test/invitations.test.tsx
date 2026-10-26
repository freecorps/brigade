// @vitest-environment happy-dom
// Invitations and email verification in the dashboard: how the API's answers read, the Members card's Invite form
// (only the roles the inviter may give, refused while their own address is unverified), the pending list with
// Resend and Revoke, and the empty workspace pointing to Invite.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { Role } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { InvitationsPanel, type InvitationsApi } from "../src/components/invitations-panel";
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
  options: { verified?: boolean; list?: PendingInvitation[] } = {},
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
          open
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

  test("an unverified inviter is told to confirm their own email first, and cannot send", async () => {
    const { container } = await renderPanel("owner", { verified: false });
    expect(container.textContent).toContain("Confirm your own email before you invite people.");
    expect(byText(container, "Send invitation")?.getAttribute("aria-disabled")).toBe("true");
  });

  test("pending invitations: an admin cannot touch an owner's; a refused resend says why", async () => {
    const admin = await renderPanel("admin", { list: [pendingOne] });
    expect(admin.container.textContent).toContain(pendingOne.email);
    expect(byText(admin.container, "Revoke")).toBeUndefined();
    act(() => root?.unmount());
    const owner = await renderPanel("owner", { list: [pendingOne] });
    expect(owner.container.textContent).toContain("Expires in 3 days. Invited by Aleksandra");
    await click(byText(owner.container, "Resend"));
    expect(owner.calls).toEqual([`resend ${ID}`]);
    expect(owner.container.textContent).toContain("went out a few minutes ago");
    await click(byText(owner.container, "Revoke"));
    expect(owner.container.textContent).toContain(`Revoke the invitation to ${pendingOne.email}?`);
    const confirm = [...owner.container.querySelectorAll("[role=group] button")][0];
    await click(confirm);
    expect(owner.calls).toContain(`revoke ${ID}`);
  });
});

describe("the Members card and the verification notice", () => {
  const renderCard = (role: Role, invite: boolean) => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    let opened = 0;
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
              invite={invite ? { open: () => opened++, opened: false, panel: null } : undefined}
            />
          </MemberProvider>
        </PreferencesProvider>,
      ),
    );
    return { container, opened: () => opened };
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
    await click(byText(container, "Send the link again"));
    expect(asked).toEqual(["ana@example.com"]);
    expect(container.textContent).toContain("Wait a few minutes");
  });
});
