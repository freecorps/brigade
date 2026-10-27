import { m } from "@freecorps/brigade-i18n";
import {
  can,
  MAX_INCIDENT_SERVICES,
  missingFields,
  type CustomFieldRow,
  type FieldValue,
  type IncidentRow,
  type IncidentTypeRow,
  type ServiceRow,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { PencilIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Refusal, SELECT, TEXTAREA } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  catalogRefusal,
  catalogText,
  checkValue,
  draftFromValue,
  isSelect,
  valueProblem,
  valueText,
  type ValueDraft,
} from "@/lib/catalog";

/**
 * The incident's type, the services it affects and its custom fields (RFC 0003 "Incident types", "Service
 * catalog", "Custom fields"), each changed in place by anyone who may update the incident. Fields the type requires
 * and nobody filled yet are flagged; nothing waits on them. Hidden while the workspace has no catalog and the
 * incident names nothing from one.
 */
export function IncidentDetailsCard({ row }: { row: IncidentRow }) {
  const { role } = useMember();
  const editable = can(role, "incident:update");
  const types = useQuery("incidentTypes.all", {});
  const services = useQuery("services.all", {});
  const fields = useQuery("customFields.all", {});
  const setType = useMutation("incident.setType");
  const setServices = useMutation("incident.setServices");
  const setField = useMutation("incident.setField");
  const [refused, setRefused] = useState<string | null>(null);
  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) setRefused(catalogRefusal(name, outcome.error.code));
  };
  const typeId = row.typeId ?? null;
  const named = row.serviceIds ?? [];
  const type = typeId ? types.rows.find((one) => one.id === typeId) : undefined;
  const missing = missingFields(row, types.rows, fields.rows);
  const required = new Set(type?.requiredFields ?? []);
  const empty =
    types.rows.length === 0 &&
    services.rows.length === 0 &&
    fields.rows.length === 0 &&
    typeId === null &&
    named.length === 0;
  if (empty) return null;

  return (
    <Card aria-labelledby="details-title">
      <div className="flex flex-col gap-1 px-4 sm:px-6">
        <CardTitle id="details-title">{catalogText("details_title")}</CardTitle>
        {missing.length > 0 ? (
          <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0">
              {m.catalog_count({ kind: "missing", count: missing.length })}
            </span>
          </p>
        ) : null}
      </div>
      <CardContent className="flex flex-col gap-5 text-sm">
        {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        <TypePicker
          typeId={typeId}
          types={types.rows}
          editable={editable}
          onChange={(next) =>
            void setType({ id: row.id, typeId: next }).then(report(catalogText("type_label")))
          }
        />
        <ServicePicker
          named={named}
          services={services.rows}
          editable={editable}
          onChange={(next) =>
            void setServices({ id: row.id, serviceIds: next }).then(
              report(catalogText("services_label")),
            )
          }
        />
        {fields.rows.length > 0 ? (
          <dl className="flex flex-col gap-4 border-t pt-4">
            {fields.rows.map((field) => (
              <FieldValueRow
                key={field.id}
                field={field}
                incident={row}
                required={required.has(field.id)}
                editable={editable}
                onSave={(value) =>
                  setField({ id: row.id, fieldId: field.id, value }).then((outcome) => {
                    report(field.name)(outcome);
                    return outcome;
                  })
                }
              />
            ))}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TypePicker({
  typeId,
  types,
  editable,
  onChange,
}: {
  typeId: string | null;
  types: readonly IncidentTypeRow[];
  editable: boolean;
  onChange: (typeId: string | null) => void;
}) {
  const id = useId();
  const type = typeId ? types.find((one) => one.id === typeId) : undefined;
  const label =
    typeId === null ? catalogText("no_type") : (type?.name ?? catalogText("deleted_type"));
  if (!editable || (types.length === 0 && typeId === null)) {
    return (
      <div className="flex flex-col gap-1">
        <p className="font-medium">{catalogText("type_label")}</p>
        <p className="text-muted-foreground [overflow-wrap:anywhere]">{label}</p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {catalogText("type_label")}
      </label>
      <select
        id={id}
        className={SELECT}
        value={typeId ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">{catalogText("no_type")}</option>
        {typeId !== null && !type ? (
          <option value={typeId}>{catalogText("deleted_type")}</option>
        ) : null}
        {types.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ServicePicker({
  named,
  services,
  editable,
  onChange,
}: {
  named: readonly string[];
  services: readonly ServiceRow[];
  editable: boolean;
  onChange: (serviceIds: string[]) => void;
}) {
  const headingId = useId();
  const addId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  // A deleted service is skipped: it no longer reads as anything, and the next change drops it.
  const shown = named.flatMap((id) => {
    const service = services.find((one) => one.id === id);
    return service ? [service] : [];
  });
  const live = shown.map((one) => one.id);
  const open = services.filter((one) => !live.includes(one.id));
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p id={headingId} className="font-medium">
        {catalogText("services_label")}
      </p>
      {shown.length === 0 ? (
        <p className="text-muted-foreground">{catalogText("no_services")}</p>
      ) : (
        <ul ref={listRef} aria-labelledby={headingId} className="flex flex-wrap gap-1.5">
          {shown.map((service, index) => (
            <li
              key={service.id}
              className={cn(
                "inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border py-0.5 text-sm",
                editable ? "pr-0.5 pl-2" : "px-2",
              )}
            >
              <Link
                to="/services/$id"
                params={{ id: service.id }}
                className="min-w-0 [overflow-wrap:anywhere] hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {service.name}
              </Link>
              {editable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative shrink-0 focus-visible:z-10"
                  data-service-index={index}
                  aria-label={m.catalog_action_on({ action: "remove", name: service.name })}
                  onClick={() => {
                    onChange(live.filter((one) => one !== service.id));
                    const next = index < shown.length - 1 ? index : index - 1;
                    requestAnimationFrame(() =>
                      (
                        listRef.current?.querySelector<HTMLElement>(
                          `[data-service-index="${next}"]`,
                        ) ?? selectRef.current
                      )?.focus(),
                    );
                  }}
                >
                  <XIcon aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable && open.length > 0 && live.length < MAX_INCIDENT_SERVICES ? (
        <>
          <label htmlFor={addId} className="sr-only">
            {catalogText("add_service")}
          </label>
          <select
            ref={selectRef}
            id={addId}
            className={SELECT}
            value=""
            onChange={(event) => {
              if (event.target.value) onChange([...live, event.target.value]);
            }}
          >
            <option value="">{catalogText("add_service")}</option>
            {open.map((one) => (
              <option key={one.id} value={one.id}>
                {one.name}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}

function FieldValueRow({
  field,
  incident,
  required,
  editable,
  onSave,
}: {
  field: CustomFieldRow;
  incident: IncidentRow;
  required: boolean;
  editable: boolean;
  onSave: (value: FieldValue | null) => Promise<MutationOutcome>;
}) {
  const [editing, setEditing] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const value = incident.fields?.[field.id];
  const text = valueText(field, value);
  const stop = () => {
    setEditing(false);
    requestAnimationFrame(() => editRef.current?.focus());
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <dt className="min-w-0 font-medium [overflow-wrap:anywhere]">{field.name}</dt>
        {editable && !editing ? (
          <Button
            ref={editRef}
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={m.catalog_action_on({ action: "edit", name: field.name })}
            onClick={() => setEditing(true)}
          >
            <PencilIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      <dd className="min-w-0">
        {editing ? (
          <ValueEditor
            field={field}
            initial={draftFromValue(field, value)}
            required={required && text !== null}
            onCancel={stop}
            onSave={(next) => {
              void onSave(next);
              stop();
            }}
          />
        ) : text === null ? (
          required ? (
            <span className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">{catalogText("required")}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{catalogText("not_set")}</span>
          )
        ) : field.kind === "link" ? (
          <a
            href={text}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {text}
          </a>
        ) : (
          <span className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {text}
          </span>
        )}
      </dd>
    </div>
  );
}

function ValueEditor({
  field,
  initial,
  required,
  onCancel,
  onSave,
}: {
  field: CustomFieldRow;
  initial: ValueDraft;
  /** Filled and required by the type: it can change but not be cleared. */
  required: boolean;
  onCancel: () => void;
  onSave: (value: FieldValue | null) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  const groupName = useId();
  const firstRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkValue(field, draft);
    if (!checked.ok || (checked.value === null && required)) {
      setInvalid(true);
      firstRef.current?.focus();
      return;
    }
    // Nothing changed: close without a change the shard would refuse as a conflict.
    const before = checkValue(field, initial);
    if (before.ok && JSON.stringify(before.value) === JSON.stringify(checked.value)) {
      onCancel();
      return;
    }
    onSave(checked.value);
  };
  const describe = invalid ? errorId : undefined;
  const control = isSelect(field.kind) ? (
    <div role="group" aria-label={field.name} className="flex flex-col">
      {field.options.map((option, index) => {
        const checked = draft.choices.includes(option.id);
        return (
          <label key={option.id} className="flex min-h-11 cursor-pointer items-center gap-3">
            <input
              ref={index === 0 ? (node) => void (firstRef.current = node) : undefined}
              type={field.kind === "single_select" ? "radio" : "checkbox"}
              name={groupName}
              className="size-5 shrink-0 accent-primary"
              checked={checked}
              aria-invalid={invalid || undefined}
              aria-describedby={describe}
              onChange={(event) => {
                setInvalid(false);
                setDraft({
                  ...draft,
                  choices:
                    field.kind === "single_select"
                      ? [option.id]
                      : event.target.checked
                        ? [...draft.choices, option.id]
                        : draft.choices.filter((one) => one !== option.id),
                });
              }}
            />
            <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
          </label>
        );
      })}
    </div>
  ) : field.kind === "text" ? (
    <textarea
      ref={(node) => void (firstRef.current = node)}
      aria-label={field.name}
      className={TEXTAREA}
      rows={3}
      value={draft.text}
      aria-invalid={invalid || undefined}
      aria-describedby={describe}
      onChange={(event) => {
        setInvalid(false);
        setDraft({ ...draft, text: event.target.value });
      }}
    />
  ) : (
    <input
      ref={(node) => void (firstRef.current = node)}
      aria-label={field.name}
      className={SELECT}
      type={field.kind === "link" ? "url" : "text"}
      inputMode={field.kind === "number" ? "decimal" : field.kind === "link" ? "url" : undefined}
      autoComplete="off"
      placeholder={field.kind === "link" ? "https://" : undefined}
      value={draft.text}
      aria-invalid={invalid || undefined}
      aria-describedby={describe}
      onChange={(event) => {
        setInvalid(false);
        setDraft({ ...draft, text: event.target.value });
      }}
    />
  );
  return (
    <form
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
      className="flex flex-col gap-2"
    >
      {control}
      {invalid ? (
        <p id={errorId} className="text-sm text-destructive">
          {required && checkValue(field, draft).ok
            ? catalogText("required")
            : m.catalog_field({ field: valueProblem(field.kind), form: "invalid" })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{m.catalog_action({ action: "save" })}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {m.catalog_action({ action: "cancel" })}
        </Button>
        {!required && (initial.text !== "" || initial.choices.length > 0) ? (
          <Button type="button" variant="ghost" className="ml-auto" onClick={() => onSave(null)}>
            {m.catalog_action({ action: "clear" })}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
