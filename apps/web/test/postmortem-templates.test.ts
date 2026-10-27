// The postmortem template editor's helpers (src/lib/postmortem-templates.ts): names, what may still be added, moving,
// the checks before `postmortemTemplate.set`, and what a new postmortem's editor starts with.
import { setLocale as setI18nLocale } from "@freecorps/brigade-i18n";
import { BUILTIN_LAYOUT, MAX_TEMPLATE_SECTIONS } from "@freecorps/brigade-schema";
import { afterEach, expect, test } from "vite-plus/test";
import {
  addableSections,
  checkTemplate,
  moveSection,
  newSection,
  onlyStarters,
  outline,
  sectionName,
  starterSections,
} from "../src/lib/postmortem-templates";

afterEach(() => void setI18nLocale("en"));

test("a section reads by its title, else a built-in's own name in the reader's language", async () => {
  expect(sectionName({ key: "rootCause", title: "" })).toBe("Root cause");
  expect(sectionName({ key: "rootCause", title: "  Why it broke " })).toBe("Why it broke");
  expect(sectionName({ key: "custom2", title: "" })).toBe("Custom section 2");
  await setI18nLocale("pt-BR");
  expect(sectionName({ key: "rootCause", title: "" })).toBe("Causa raiz");
  expect(outline([newSection("summary"), newSection("custom1")])).toBe(
    "Resumo · Seção personalizada 1",
  );
});

test("what may still be added: the built-ins left out and the first custom key free", () => {
  expect(addableSections(BUILTIN_LAYOUT)).toEqual({ builtins: [], custom: "custom1" });
  const some = [newSection("summary"), newSection("custom1"), newSection("custom3")];
  expect(addableSections(some).builtins).toHaveLength(6);
  expect(addableSections(some).custom).toBe("custom2");
  const all = [
    ...BUILTIN_LAYOUT,
    newSection("custom1"),
    newSection("custom2"),
    newSection("custom3"),
  ];
  expect(all).toHaveLength(MAX_TEMPLATE_SECTIONS);
  expect(addableSections(all)).toEqual({ builtins: [], custom: null });
});

test("moving stays inside the list", () => {
  expect(moveSection(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
  expect(moveSection(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moveSection(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
});

test("the checks: a custom section needs a title, hidden characters and overlong text are refused", () => {
  expect(checkTemplate([newSection("custom1")])).toEqual({
    ok: false,
    errors: { 0: { title: true } },
  });
  expect(checkTemplate([{ ...newSection("summary"), hint: `a${"‮"}b` }])).toMatchObject({
    ok: false,
    errors: { 0: { hint: true } },
  });
  expect(checkTemplate([{ ...newSection("summary"), starter: "x".repeat(1001) }])).toMatchObject({
    ok: false,
  });
  expect(checkTemplate([])).toMatchObject({ ok: false });
  expect(
    checkTemplate([{ ...newSection("custom1"), title: " Comms ", starter: " Email:\n " }]),
  ).toEqual({
    ok: true,
    sections: [{ key: "custom1", title: "Comms", hint: "", starter: "Email:" }],
  });
});

test("a new postmortem starts from the starter text, and only that is nothing written", () => {
  const layout = [{ ...newSection("summary"), starter: "Customer-facing:" }, newSection("impact")];
  const sections = starterSections(layout);
  expect(sections).toEqual({ summary: "Customer-facing:", impact: "" });
  expect(onlyStarters(sections, layout)).toBe(true);
  expect(onlyStarters({ ...sections, impact: "All cards." }, layout)).toBe(false);
});
