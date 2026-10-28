// @vitest-environment happy-dom
// The segmented control (src/components/ui/segmented.tsx): native radios under one named group, the chosen one
// checked, and a pick reported by value.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { Segmented } from "../src/components/ui/segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const picks: string[] = [];

function Harness() {
  const [value, setValue] = useState<"all" | "mine">("all");
  return (
    <Segmented
      label="Whose follow-ups"
      value={value}
      options={[
        { value: "all", label: "All" },
        { value: "mine", label: "Mine" },
      ]}
      onChange={(next) => {
        picks.push(next);
        setValue(next);
      }}
    />
  );
}

test("one named radio group; picking an option reports its value and checks it", () => {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => {
    root = createRoot(container);
    root.render(<Harness />);
  });
  const group = container.querySelector('[role="radiogroup"]')!;
  expect(group.getAttribute("aria-label")).toBe("Whose follow-ups");
  const radios = [...group.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  expect(radios.map((radio) => radio.value)).toEqual(["all", "mine"]);
  // One name, so the browser gives the group arrow-key movement and a single tab stop.
  expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
  expect(radios.map((radio) => radio.checked)).toEqual([true, false]);
  act(() => radios[1]!.click());
  expect(picks).toEqual(["mine"]);
  expect(radios.map((radio) => radio.checked)).toEqual([false, true]);
});
