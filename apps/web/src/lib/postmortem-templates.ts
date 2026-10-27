// Postmortem templates on the dashboard (RFC 0013 "Templates"): their wording, the editor's draft and its checks before
// `postmortemTemplate.set` is sent, and what a postmortem's editor starts with. Pure; tested in
// test/postmortem-templates.test.ts.
import { m } from "@freecorps/brigade-i18n";
import {
  BUILTIN_LAYOUT,
  CUSTOM_POSTMORTEM_SECTIONS,
  isBuiltinSection,
  MAX_TEMPLATE_SECTIONS,
  POSTMORTEM_SECTIONS,
  TEMPLATE_HINT_MAX,
  TEMPLATE_STARTER_MAX,
  TEMPLATE_TITLE_MAX,
  textRules,
  type PostmortemSectionKey,
  type PostmortemSections,
  type PostmortemTemplateSection,
} from "@freecorps/brigade-schema";
import { postmortemText } from "@/lib/follow-ups";

export { MAX_TEMPLATE_SECTIONS, TEMPLATE_HINT_MAX, TEMPLATE_STARTER_MAX, TEMPLATE_TITLE_MAX };

/** `postmortem_template_text` without the inputs a part does not use. */
export function templateText(
  part: string,
  inputs: { name?: string; count?: string | number } = {},
): string {
  return m.postmortem_template_text({
    part,
    name: inputs.name ?? "",
    count: String(inputs.count ?? ""),
  });
}

/** A section's name as shown: its title, else a built-in's own translated name, else "Custom section n". */
export function sectionName(section: Pick<PostmortemTemplateSection, "key" | "title">): string {
  if (section.title.trim()) return section.title.trim();
  if (isBuiltinSection(section.key)) return postmortemText(`section_${section.key}`);
  return templateText("custom_name", {
    count: CUSTOM_POSTMORTEM_SECTIONS.indexOf(section.key as never) + 1,
  });
}

/** The sections a template may still add: the built-ins it left out, and the first custom key free. */
export function addableSections(sections: readonly PostmortemTemplateSection[]): {
  builtins: PostmortemSectionKey[];
  custom: PostmortemSectionKey | null;
} {
  const used = new Set(sections.map((section) => section.key));
  return {
    builtins: POSTMORTEM_SECTIONS.filter((key) => !used.has(key)),
    custom: CUSTOM_POSTMORTEM_SECTIONS.find((key) => !used.has(key)) ?? null,
  };
}

export const newSection = (key: PostmortemSectionKey): PostmortemTemplateSection => ({
  key,
  title: "",
  hint: "",
  starter: "",
});

/** `sections` with the one at `index` moved by `by` places (kept inside the list). */
export function moveSection<T>(sections: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (to < 0 || to >= sections.length) return [...sections];
  const next = [...sections];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** What the text rules refuse in a value: hidden characters, or nothing visible. */
const textProblem = (value: string, multiline: boolean) =>
  value.length > 0 &&
  (textRules.problem(value, multiline, true) !== undefined || !textRules.hasVisible(value));

export type SectionErrors = { title?: boolean; hint?: boolean; starter?: boolean };

/**
 * The template's sections ready for `postmortemTemplate.set` (trimmed), or what is wrong with each, by index. The
 * shard checks the same; this keeps the form from sending what it would refuse.
 */
export function checkTemplate(
  sections: readonly PostmortemTemplateSection[],
):
  | { ok: true; sections: PostmortemTemplateSection[] }
  | { ok: false; errors: Record<number, SectionErrors> } {
  const errors: Record<number, SectionErrors> = {};
  const trimmed = sections.map((section, index) => {
    const one = {
      key: section.key,
      title: section.title.trim(),
      hint: section.hint.trim(),
      starter: section.starter.trim(),
    };
    const wrong: SectionErrors = {};
    if (
      one.title.length > TEMPLATE_TITLE_MAX ||
      textProblem(one.title, false) ||
      (!isBuiltinSection(one.key) && one.title === "")
    ) {
      wrong.title = true;
    }
    if (one.hint.length > TEMPLATE_HINT_MAX || textProblem(one.hint, true)) wrong.hint = true;
    if (one.starter.length > TEMPLATE_STARTER_MAX || textProblem(one.starter, true)) {
      wrong.starter = true;
    }
    if (Object.keys(wrong).length) errors[index] = wrong;
    return one;
  });
  // The form never lets a template have none or too many; refused here all the same.
  const counted = trimmed.length > 0 && trimmed.length <= MAX_TEMPLATE_SECTIONS;
  return Object.keys(errors).length || !counted
    ? { ok: false, errors }
    : { ok: true, sections: trimmed };
}

/** A template's sections as one line: their names, in order. */
export const outline = (sections: readonly PostmortemTemplateSection[]) =>
  sections.map(sectionName).join(" · ");

/** What a new postmortem's editor starts with: each section's starter text. */
export const starterSections = (
  layout: readonly PostmortemTemplateSection[],
): Record<string, string> =>
  Object.fromEntries(layout.map((section) => [section.key, section.starter]));

/** Whether `sections` holds only the layout's starter text, untouched: nothing a member wrote. */
export const onlyStarters = (
  sections: PostmortemSections,
  layout: readonly PostmortemTemplateSection[],
) => layout.every((section) => (sections[section.key] ?? "").trim() === section.starter.trim());

export { BUILTIN_LAYOUT };
