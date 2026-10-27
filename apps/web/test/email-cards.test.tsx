// @vitest-environment happy-dom
// The dashboard's Email cards: a member's own email choices (RFC 0005 "Email", RFC 0013 "Reminders") and who the
// workspace emails when paging fails, each saved as soon as it is switched, in English and Portuguese.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { EmailSettings, MemberEmail } from "@freecorps/brigade-schema";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { EmailPanel, WorkspaceEmailPanel } from "../src/components/email-cards";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const switches = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[role="switch"]'));

function member(value: Partial<MemberEmail> = {}, workspaceUnpaged = true, saves = true) {
  const sent: MemberEmail[] = [];
  const container = mount(
    <EmailPanel
      value={{ missedPages: true, followUpReminders: true, ...value }}
      workspaceUnpaged={workspaceUnpaged}
      loading={false}
      failed={false}
      onChange={async (next) => {
        sent.push(next);
        return saves;
      }}
    />,
  );
  return { container, sent };
}

test("a member's choices, both on by default, and that owners always get the fallback email", () => {
  const { container } = member();
  const text = container.textContent ?? "";
  expect(text).toContain("Missed pages");
  expect(text).toContain("Follow-up reminders");
  expect(text).toContain("Owners always get the email when a page reached nobody");
  expect(switches(container).map((one) => one.checked)).toEqual([true, true]);
  expect(text).not.toContain("turned these emails off for everyone");
});

test("switching one saves both at once and says so; a refused save goes back and says so", async () => {
  const saved = member();
  await act(async () => switches(saved.container)[1]!.click());
  expect(saved.sent).toEqual([{ missedPages: true, followUpReminders: false }]);
  expect(saved.container.querySelector('[role="status"]')?.textContent).toBe("Saved");
  act(() => root?.unmount());

  const refused = member({}, true, false);
  await act(async () => switches(refused.container)[0]!.click());
  expect(refused.container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't save your choice",
  );
  expect(switches(refused.container)[0]!.checked).toBe(true);
});

test("says when the workspace turned missed-page emails off for everyone", () => {
  const { container } = member({}, false);
  expect(container.textContent).toContain(
    "Your workspace has turned these emails off for everyone.",
  );
});

test("the workspace's settings: a warning while the owners' fallback is off", async () => {
  const sent: EmailSettings[] = [];
  const container = mount(
    <WorkspaceEmailPanel
      value={{ unpaged: true, nobodyPaged: true }}
      loading={false}
      failed={false}
      onChange={async (next) => {
        sent.push(next);
        return true;
      }}
    />,
  );
  expect(container.textContent).toContain("Email when paging fails");
  expect(container.textContent).not.toContain("nobody hears of a page");
  await act(async () => switches(container)[1]!.click());
  expect(sent).toEqual([{ unpaged: true, nobodyPaged: false }]);
  expect(container.textContent).toContain(
    "While this is off, nobody hears of a page that reached nobody until they open Brigade.",
  );
});

test("in Portuguese", async () => {
  await setI18nLocale("pt-BR");
  const { container } = member({ followUpReminders: false });
  const text = container.textContent ?? "";
  expect(text).toContain("Acionamentos perdidos");
  expect(text).toContain("Lembretes de ações");
  expect(switches(container).map((one) => one.checked)).toEqual([true, false]);
});
