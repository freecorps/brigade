// @vitest-environment happy-dom
// The dashboard's Workspace language card (RFC 0008 "Workspace locale", Q15): owners pick it and it is saved at once;
// everyone else reads it. In English and Portuguese.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { WorkspaceLocale } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { WorkspaceLanguagePanel } from "../src/components/workspace-language-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function render(
  props: { value?: WorkspaceLocale; owner?: boolean; failed?: boolean; saves?: boolean } = {},
) {
  const sent: WorkspaceLocale[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <WorkspaceLanguagePanel
        value={props.value ?? "en"}
        owner={props.owner ?? true}
        loading={false}
        failed={props.failed ?? false}
        onChange={async (locale) => {
          sent.push(locale);
          return props.saves ?? true;
        }}
      />,
    ),
  );
  return { container, sent };
}

const pick = (select: HTMLSelectElement, value: string) =>
  act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });

test("an owner picks the language and it is saved at once", async () => {
  const { container, sent } = render();
  expect(container.textContent).toContain("Workspace language");
  expect(container.textContent).toContain("Slack channel messages");
  const select = container.querySelector("select")!;
  expect([...select.options].map((one) => one.textContent)).toEqual([
    "English",
    "Português (Brasil)",
  ]);
  await pick(select, "pt-BR");
  expect(sent).toEqual(["pt-BR"]);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Saved");
});

test("a refused save goes back and says so", async () => {
  const { container } = render({ saves: false });
  const select = container.querySelector("select")!;
  await pick(select, "pt-BR");
  expect(select.value).toBe("en");
  expect(container.textContent).toContain("Couldn't save the language. Try again.");
});

test("admins and everyone else read it, with no picker", () => {
  const { container } = render({ owner: false, value: "pt-BR" });
  expect(container.querySelector("select")).toBeNull();
  expect(container.textContent).toContain(
    "Brigade writes this workspace's shared text in Português (Brasil). An owner can change it.",
  );
});

test("reads in Portuguese", () => {
  void setI18nLocale("pt-BR");
  const { container } = render();
  expect(container.textContent).toContain("Idioma do espaço de trabalho");
  expect(container.textContent).toContain("Só proprietários podem mudar.");
});

test("a workspace that failed to load says so and claims no language", () => {
  for (const owner of [true, false]) {
    const { container } = render({ owner, failed: true, value: "en" });
    expect(container.querySelector("select")).toBeNull();
    expect(container.textContent).not.toContain("English");
    act(() => root?.unmount());
    document.body.innerHTML = "";
  }
});
