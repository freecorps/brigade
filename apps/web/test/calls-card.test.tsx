// @vitest-environment happy-dom
// The dashboard's Calls card (RFC 0010): a member's own choice of which pages ring their iPhones as a call, saved as
// soon as it is picked, in English and Portuguese.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import type { CallChoice } from "@freecorps/brigade-schema";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { CallsPanel } from "../src/components/calls-card";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  void setI18nLocale("en");
});

function render(props: Partial<Parameters<typeof CallsPanel>[0]> = {}, saves = true) {
  const picked: CallChoice[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <CallsPanel
        value="sev1_sev2"
        loading={false}
        failed={false}
        onChange={async (calls) => {
          picked.push(calls);
          return saves;
        }}
        {...props}
      />,
    ),
  );
  return { container, picked };
}

const radios = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

test("shows the member's choice, the default first, and that the notification always comes", () => {
  const { container } = render();
  const text = container.textContent ?? "";
  expect(text).toContain("Calls");
  expect(text).toContain("The notification always comes");
  expect(radios(container).map((radio) => [radio.value, radio.checked])).toEqual([
    ["sev1_sev2", true],
    ["sev1", false],
    ["never", false],
  ]);
});

test("picking another saves it at once and says so; a refused save says so too", async () => {
  const saved = render();
  await act(async () => radios(saved.container)[2]!.click());
  expect(saved.picked).toEqual(["never"]);
  expect(saved.container.querySelector('[role="status"]')?.textContent).toBe("Saved");
  act(() => root?.unmount());

  const refused = render({}, false);
  await act(async () => radios(refused.container)[1]!.click());
  expect(refused.container.querySelector('[role="alert"]')?.textContent).toContain(
    "Couldn't save your choice",
  );
});

test("in Portuguese", async () => {
  await setI18nLocale("pt-BR");
  const { container } = render({ value: "never" });
  const text = container.textContent ?? "";
  expect(text).toContain("Chamadas");
  expect(text).toContain("Nunca");
  expect(radios(container)[2]!.checked).toBe(true);
});
