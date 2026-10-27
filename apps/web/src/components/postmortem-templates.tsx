import {
  DEFAULT_TEMPLATE_ID,
  isBuiltinSection,
  type IncidentTypeRow,
  type PostmortemTemplateRow,
  type PostmortemTemplateSection,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation } from "@freecorps/brigade-sync/react";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { FORM, FormButtons, LABEL, TEXTAREA } from "@/components/services-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { catalogRefusal } from "@/lib/catalog";
import {
  addableSections,
  BUILTIN_LAYOUT,
  checkTemplate,
  MAX_TEMPLATE_SECTIONS,
  moveSection,
  newSection,
  outline,
  sectionName,
  TEMPLATE_HINT_MAX,
  TEMPLATE_STARTER_MAX,
  TEMPLATE_TITLE_MAX,
  templateText,
  type SectionErrors,
} from "@/lib/postmortem-templates";

/**
 * The workspace's postmortem templates (RFC 0013 "Templates"): its default and one per incident type, each the
 * sections a new postmortem of it starts with, in order, with a title, a hint and starter text. Owners and admins edit
 * them, with a preview of the editor a new postmortem opens; everyone else reads which sections each one has. A
 * postmortem keeps the sections it was made with, so nothing here changes one already written.
 */
export function PostmortemTemplates({
  types,
  templates,
  manage,
  onRefused,
}: {
  types: readonly IncidentTypeRow[];
  templates: readonly PostmortemTemplateRow[];
  manage: boolean;
  onRefused: (text: string | null) => void;
}) {
  const set = useMutation("postmortemTemplate.set");
  const reset = useMutation("postmortemTemplate.reset");
  const [editing, setEditing] = useState<string | null>(null);
  const byId = new Map(templates.map((row) => [row.id, row]));
  const fallback = byId.get(DEFAULT_TEMPLATE_ID);
  const entries = [
    { id: DEFAULT_TEMPLATE_ID, name: templateText("default_name") },
    ...types.map((type) => ({ id: type.id, name: type.name })),
  ];
  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) onRefused(catalogRefusal(name, outcome.error.code));
  };
  const close = (id: string) => {
    setEditing(null);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-template="${id}"] [data-action="edit-template"]`)
        ?.focus(),
    );
  };

  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {entries.map((entry) => {
        const row = byId.get(entry.id);
        const isDefault = entry.id === DEFAULT_TEMPLATE_ID;
        // What the entry falls back to without a template of its own.
        const inherited = isDefault ? BUILTIN_LAYOUT : (fallback?.sections ?? BUILTIN_LAYOUT);
        const sections = row?.sections ?? inherited;
        return (
          <li key={entry.id} data-template={entry.id} className="flex flex-col gap-3 p-3 sm:p-4">
            {editing === entry.id ? (
              <TemplateForm
                name={entry.name}
                initial={sections}
                resetLabel={
                  row ? templateText(isDefault ? "reset_default" : "reset_type") : undefined
                }
                resetTo={
                  isDefault || !fallback ? templateText("builtin") : templateText("default_name")
                }
                onCancel={() => close(entry.id)}
                onReset={() => {
                  onRefused(null);
                  void reset({ id: entry.id }).then(report(entry.name));
                  close(entry.id);
                }}
                onSubmit={(next) => {
                  onRefused(null);
                  // Saving what it already reads as would only pin the fallback: nothing is sent.
                  if (JSON.stringify(next) !== JSON.stringify(sections)) {
                    void set({ id: entry.id, sections: next }).then(report(entry.name));
                  }
                  close(entry.id);
                }}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                  <h4 className="min-w-0 font-medium [overflow-wrap:anywhere]">{entry.name}</h4>
                  <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {row
                      ? templateText("sections", { name: outline(row.sections) })
                      : isDefault || !fallback
                        ? templateText("builtin")
                        : templateText("uses_default")}
                  </p>
                  {isDefault ? (
                    <p className="text-sm text-muted-foreground">{templateText("default_note")}</p>
                  ) : null}
                </div>
                {manage ? (
                  <Button
                    variant="outline"
                    data-action="edit-template"
                    aria-label={templateText("edit_on", { name: entry.name })}
                    onClick={() => {
                      onRefused(null);
                      setEditing(entry.id);
                    }}
                  >
                    <PencilIcon aria-hidden />
                    {templateText("edit")}
                  </Button>
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function TemplateForm({
  name,
  initial,
  resetLabel,
  resetTo,
  onCancel,
  onReset,
  onSubmit,
}: {
  name: string;
  initial: readonly PostmortemTemplateSection[];
  /** Absent while the entry has no template of its own. */
  resetLabel?: string;
  /** What new postmortems take once it is reset. */
  resetTo: string;
  onCancel: () => void;
  onReset: () => void;
  onSubmit: (sections: PostmortemTemplateSection[]) => void;
}) {
  const [sections, setSections] = useState<PostmortemTemplateSection[]>(() =>
    initial.map((section) => ({ ...section })),
  );
  const [errors, setErrors] = useState<Record<number, SectionErrors> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addable = addableSections(sections);
  const full = sections.length >= MAX_TEMPLATE_SECTIONS;
  const update = (index: number, patch: Partial<PostmortemTemplateSection>) =>
    setSections((current) => current.map((one, at) => (at === index ? { ...one, ...patch } : one)));
  const focusSection = (key: string, field = "title") =>
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLElement>(`[data-section="${key}"] [data-field="${field}"]`)
        ?.focus(),
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkTemplate(sections);
    if (!checked.ok) {
      setErrors(checked.errors);
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[aria-labelledby="${titleId}"] [aria-invalid="true"]`)
          ?.focus(),
      );
      return;
    }
    onSubmit(checked.sections);
  };

  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      className={FORM}
    >
      <h4 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {templateText("form_title", { name })}
      </h4>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <div className="flex min-w-0 flex-col gap-3">
          <ol ref={listRef} className="flex flex-col gap-3">
            {sections.map((section, index) => {
              const label = sectionName(section);
              const wrong = errors?.[index];
              const builtin = isBuiltinSection(section.key);
              return (
                <li
                  key={section.key}
                  data-section={section.key}
                  className="flex min-w-0 flex-col gap-3 rounded-md border bg-card p-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {index + 1}
                      </span>
                      <h5 className="min-w-0 font-medium [overflow-wrap:anywhere]">{label}</h5>
                      {builtin ? null : (
                        <Badge variant="outline" className="shrink-0">
                          {templateText("custom")}
                        </Badge>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === 0}
                        aria-label={templateText("move_up", { name: label })}
                        onClick={() => setSections((current) => moveSection(current, index, -1))}
                      >
                        <ArrowUpIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={index === sections.length - 1}
                        aria-label={templateText("move_down", { name: label })}
                        onClick={() => setSections((current) => moveSection(current, index, 1))}
                      >
                        <ArrowDownIcon aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={sections.length <= 1}
                        aria-label={templateText("remove", { name: label })}
                        onClick={() => {
                          setErrors(null);
                          setSections((current) => current.filter((_, at) => at !== index));
                          const next = sections[index + 1] ?? sections[index - 1];
                          if (next) focusSection(next.key);
                        }}
                      >
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <Field
                    data-field="title"
                    label={templateText("field_title")}
                    value={section.title}
                    maxLength={TEMPLATE_TITLE_MAX}
                    autoComplete="off"
                    placeholder={builtin ? sectionName({ key: section.key, title: "" }) : undefined}
                    hint={
                      builtin
                        ? templateText("field_title_builtin", {
                            name: sectionName({ key: section.key, title: "" }),
                          })
                        : undefined
                    }
                    error={
                      wrong?.title
                        ? templateText(
                            !builtin && !section.title.trim()
                              ? "field_title_invalid"
                              : "field_invalid",
                          )
                        : undefined
                    }
                    onChange={(event) => update(index, { title: event.target.value })}
                  />
                  <TextArea
                    label={templateText("field_hint")}
                    note={templateText("field_hint_note")}
                    value={section.hint}
                    max={TEMPLATE_HINT_MAX}
                    rows={2}
                    invalid={wrong?.hint ?? false}
                    onChange={(hint) => update(index, { hint })}
                  />
                  <TextArea
                    label={templateText("field_starter")}
                    note={templateText("field_starter_note")}
                    value={section.starter}
                    max={TEMPLATE_STARTER_MAX}
                    rows={3}
                    invalid={wrong?.starter ?? false}
                    onChange={(starter) => update(index, { starter })}
                  />
                </li>
              );
            })}
          </ol>
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className={LABEL}>{templateText("add")}</p>
            {full || (addable.builtins.length === 0 && addable.custom === null) ? (
              <p className="text-sm text-muted-foreground">{templateText("limit")}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {[...addable.builtins, ...(addable.custom ? [addable.custom] : [])].map((key) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSections((current) => [...current, newSection(key)]);
                      focusSection(key);
                    }}
                  >
                    <PlusIcon aria-hidden />
                    {isBuiltinSection(key)
                      ? sectionName({ key, title: "" })
                      : templateText("add_custom")}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
        <Preview sections={sections} />
      </div>
      <FormButtons
        editing
        create=""
        remove={resetLabel}
        confirm={templateText("reset_confirm", { name: resetTo })}
        confirmAction={templateText("reset_confirm_action")}
        confirming={confirming}
        deleteRef={deleteRef}
        onCancel={onCancel}
        onAskDelete={() => setConfirming(true)}
        onCloseConfirm={() => {
          setConfirming(false);
          requestAnimationFrame(() => deleteRef.current?.focus());
        }}
        onDelete={resetLabel ? onReset : undefined}
      />
    </form>
  );
}

function TextArea({
  label,
  note,
  value,
  max,
  rows,
  invalid,
  onChange,
}: {
  label: string;
  note: string;
  value: string;
  max: number;
  rows: number;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const noteId = useId();
  const errorId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        className={TEXTAREA}
        rows={rows}
        value={value}
        maxLength={max}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${errorId} ${noteId}` : noteId}
        onChange={(event) => onChange(event.target.value)}
      />
      {invalid ? (
        <p id={errorId} className="text-sm text-destructive">
          {templateText("field_invalid")}
        </p>
      ) : null}
      <p id={noteId} className="text-sm text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

/** What a new postmortem's editor shows with these sections: each name, its hint, and its starter text. */
function Preview({ sections }: { sections: readonly PostmortemTemplateSection[] }) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 self-start rounded-md border border-dashed p-3 xl:sticky xl:top-4"
    >
      <div className="flex flex-col gap-0.5">
        <h5 id={titleId} className={LABEL}>
          {templateText("preview")}
        </h5>
        <p className="text-xs text-muted-foreground">{templateText("preview_note")}</p>
      </div>
      <ol className="flex flex-col gap-3">
        {sections.map((section) => (
          <li key={section.key} className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">{sectionName(section)}</p>
            {section.hint.trim() ? (
              <p className="text-xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                {section.hint.trim()}
              </p>
            ) : null}
            <div
              aria-hidden
              className={cn(
                "min-h-10 rounded-md border bg-card px-2.5 py-1.5 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]",
                section.starter.trim() ? "" : "text-muted-foreground/60",
              )}
            >
              {section.starter.trim()}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
