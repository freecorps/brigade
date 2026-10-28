import { m } from "@freecorps/brigade-i18n";
import { roleLabel, severityName } from "@freecorps/brigade-i18n/incident";
import {
  can,
  COMMANDER_ROLE,
  FIELD_KINDS,
  isLiveRole,
  roleDefinitions,
  SEVERITIES,
  type CustomFieldRow,
  type EscalationPolicyRow,
  type FieldKind,
  type IncidentTypeRow,
  type RoleDefinition,
  type Severity,
} from "@freecorps/brigade-schema";
import type { MutationOutcome } from "@freecorps/brigade-sync";
import { useMutation, useQuery } from "@freecorps/brigade-sync/react";
import { CheckIcon, PencilIcon, PlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { SeverityBadge } from "@/components/incident-badges";
import { AiDraftsSetting, PostmortemTemplates } from "@/components/postmortem-templates";
import { Description, FORM, FormButtons, LABEL, Refusal, SELECT } from "@/components/services-card";
import { useMember } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import {
  canAddField,
  canAddRole,
  canAddType,
  CATALOG_NAME_MAX,
  catalogRefusal,
  catalogText,
  checkField,
  checklistItem,
  checkRole,
  checkType,
  draftFromField,
  draftFromRole,
  draftFromType,
  emptyField,
  emptyRole,
  emptyType,
  isSelect,
  MAX_FIELD_OPTIONS,
  MAX_ROLE_CHECKLIST,
  newFieldId,
  newOptionId,
  newRoleId,
  newTypeId,
  ROLE_CHECKLIST_ITEM_MAX,
  setTypeRoleUse,
  typeRoleUse,
  type CheckedField,
  type CheckedRole,
  type CheckedType,
  type FieldDraft,
  type RoleDraft,
  type TypeDraft,
  type TypeRoleUse,
} from "@/lib/catalog";
import { queryErrorReason } from "@/lib/incidents";
import { templateText } from "@/lib/postmortem-templates";

type Editing = { kind: "type" | "field" | "role"; id: string | null } | null;

/**
 * The workspace's incident types, custom fields and incident roles (RFC 0003 "Incident types", "Custom fields",
 * "Role definitions"), live from its shard. A type sets the severity a declare starts with, the policy its pages use,
 * the fields it requires and the roles it fills, and its postmortem template (RFC 0013 "Templates") the sections its
 * postmortems start with; a field is a typed detail every incident can carry; a role is who does what, with the
 * responsibilities that come with it. Owners and admins edit them; everyone else reads.
 */
export function IncidentSettingsCard() {
  const { role } = useMember();
  const manage = can(role, "catalog:manage");
  const types = useQuery("incidentTypes.all", {});
  const fields = useQuery("customFields.all", {});
  const roleRows = useQuery("incidentRoles.all", {});
  const policies = useQuery("escalationPolicies.all", {});
  const templates = useQuery("postmortemTemplates.all", {});
  const createType = useMutation("incidentType.create");
  const updateType = useMutation("incidentType.update");
  const deleteType = useMutation("incidentType.delete");
  const createField = useMutation("customField.create");
  const updateField = useMutation("customField.update");
  const deleteField = useMutation("customField.delete");
  const createRole = useMutation("incidentRole.create");
  const updateRole = useMutation("incidentRole.update");
  const deleteRole = useMutation("incidentRole.delete");
  const restoreRole = useMutation("incidentRole.restore");
  const roles = roleDefinitions(roleRows.rows);
  const liveRoles = roles.filter(isLiveRole);
  const [editing, setEditing] = useState<Editing>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const report = (name: string) => (outcome: MutationOutcome) => {
    if (!outcome.ok) setRefused(catalogRefusal(name, outcome.error.code));
  };
  const focus = (selector: string) =>
    requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  const close = (kind: "type" | "field" | "role", id: string | null) => {
    setEditing(null);
    focus(id ? `[data-catalog="${id}"] [data-action="edit"]` : `[data-add="${kind}"]`);
  };
  const open = (next: Editing) => {
    setRefused(null);
    setEditing(next);
  };
  const loading = (status: string) => status !== "ready" && status !== "error";
  const failed =
    [types, fields, roleRows, templates].find((query) => query.status === "error") ?? null;

  return (
    <Card aria-labelledby="incident-settings-title">
      <CardTitle id="incident-settings-title" className="px-4 sm:px-6">
        {catalogText("settings_title")}
      </CardTitle>
      <CardContent className="flex flex-col gap-8">
        {refused ? <Refusal text={refused} onDismiss={() => setRefused(null)} /> : null}
        {failed ? <FormError>{queryErrorReason(failed.error?.code)}</FormError> : null}

        <Section
          id="types"
          title={catalogText("types_title")}
          count={
            loading(types.status)
              ? null
              : m.catalog_count({ kind: "types", count: types.rows.length })
          }
          add={
            manage && editing?.kind !== "type" ? (
              <Button
                variant="outline"
                data-add="type"
                disabled={!canAddType(types.rows.length)}
                onClick={() => open({ kind: "type", id: null })}
              >
                <PlusIcon aria-hidden />
                {m.catalog_action({ action: "add_type" })}
              </Button>
            ) : null
          }
        >
          {editing?.kind === "type" && editing.id === null ? (
            <TypeForm
              initial={emptyType()}
              fields={fields.rows}
              roles={liveRoles}
              policies={policies.rows}
              onCancel={() => close("type", null)}
              onSubmit={(draft) => {
                const checked = checkType(newTypeId(Date.now()), draft, fields.rows, roleRows.rows);
                if (!checked.ok) return checked;
                void createType(checked.args).then(report(checked.args.name));
                close("type", null);
                return checked;
              }}
            />
          ) : null}
          {types.rows.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-md border">
              {types.rows.map((row) => (
                <li key={row.id} data-catalog={row.id} className="flex flex-col gap-3 p-3 sm:p-4">
                  {editing?.kind === "type" && editing.id === row.id ? (
                    <TypeForm
                      initial={draftFromType(row)}
                      editing={row}
                      fields={fields.rows}
                      roles={liveRoles}
                      policies={policies.rows}
                      onCancel={() => close("type", row.id)}
                      onDelete={() => {
                        void deleteType({ id: row.id }).then(report(row.name));
                        close("type", null);
                      }}
                      onSubmit={(draft) => {
                        const checked = checkType(row.id, draft, fields.rows, roleRows.rows);
                        if (!checked.ok) return checked;
                        void updateType(checked.args).then(report(checked.args.name));
                        close("type", row.id);
                        return checked;
                      }}
                    />
                  ) : (
                    <TypeItem
                      row={row}
                      fields={fields.rows}
                      roles={roles}
                      policies={policies.rows}
                      manage={manage}
                      onEdit={() => open({ kind: "type", id: row.id })}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : types.status === "ready" && editing?.kind !== "type" ? (
            <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              {catalogText("types_empty")}
            </p>
          ) : null}
        </Section>

        <Section
          id="templates"
          title={templateText("title")}
          count={loading(types.status) || loading(templates.status) ? null : false}
          add={null}
        >
          {manage ? <AiDraftsSetting /> : null}
          <p className="text-sm text-muted-foreground">{templateText("note")}</p>
          <PostmortemTemplates
            types={types.rows}
            templates={templates.rows}
            manage={manage}
            onRefused={setRefused}
          />
        </Section>

        <Section
          id="fields"
          title={catalogText("fields_title")}
          count={
            loading(fields.status)
              ? null
              : m.catalog_count({ kind: "fields", count: fields.rows.length })
          }
          add={
            manage && editing?.kind !== "field" ? (
              <Button
                variant="outline"
                data-add="field"
                disabled={!canAddField(fields.rows.length)}
                onClick={() => open({ kind: "field", id: null })}
              >
                <PlusIcon aria-hidden />
                {m.catalog_action({ action: "add_field" })}
              </Button>
            ) : null
          }
        >
          {editing?.kind === "field" && editing.id === null ? (
            <FieldForm
              initial={emptyField()}
              onCancel={() => close("field", null)}
              onSubmit={(draft) => {
                const checked = checkField(newFieldId(Date.now()), draft);
                if (!checked.ok) return checked;
                void createField({ ...checked.args, kind: checked.kind }).then(
                  report(checked.args.name),
                );
                close("field", null);
                return checked;
              }}
            />
          ) : null}
          {fields.rows.length > 0 ? (
            <ul className="flex flex-col divide-y rounded-md border">
              {fields.rows.map((row) => (
                <li key={row.id} data-catalog={row.id} className="flex flex-col gap-3 p-3 sm:p-4">
                  {editing?.kind === "field" && editing.id === row.id ? (
                    <FieldForm
                      initial={draftFromField(row)}
                      editing={row}
                      onCancel={() => close("field", row.id)}
                      onDelete={() => {
                        void deleteField({ id: row.id }).then(report(row.name));
                        close("field", null);
                      }}
                      onSubmit={(draft) => {
                        const checked = checkField(row.id, draft);
                        if (!checked.ok) return checked;
                        void updateField(checked.args).then(report(checked.args.name));
                        close("field", row.id);
                        return checked;
                      }}
                    />
                  ) : (
                    <FieldItem
                      row={row}
                      manage={manage}
                      onEdit={() => open({ kind: "field", id: row.id })}
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : fields.status === "ready" && editing?.kind !== "field" ? (
            <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              {catalogText("fields_empty")}
            </p>
          ) : null}
        </Section>

        <Section
          id="roles"
          title={catalogText("roles_title")}
          count={
            loading(roleRows.status)
              ? null
              : m.catalog_count({ kind: "roles", count: liveRoles.length })
          }
          add={
            manage && editing?.kind !== "role" ? (
              <Button
                variant="outline"
                data-add="role"
                disabled={!canAddRole(roleRows.rows)}
                aria-describedby={canAddRole(roleRows.rows) ? undefined : "roles-limit"}
                onClick={() => open({ kind: "role", id: null })}
              >
                <PlusIcon aria-hidden />
                {m.catalog_action({ action: "add_role" })}
              </Button>
            ) : null
          }
        >
          <p className="text-sm text-muted-foreground">{catalogText("roles_note")}</p>
          {manage && !canAddRole(roleRows.rows) ? (
            <p id="roles-limit" className="text-sm text-muted-foreground">
              {catalogText("roles_limit")}
            </p>
          ) : null}
          {editing?.kind === "role" && editing.id === null ? (
            <RoleForm
              initial={emptyRole()}
              onCancel={() => close("role", null)}
              onSubmit={(draft) => {
                const checked = checkRole(newRoleId(Date.now()), draft);
                if (!checked.ok) return checked;
                void createRole(checked.args).then(report(checked.args.name));
                close("role", null);
                return checked;
              }}
            />
          ) : null}
          <ul className="flex flex-col divide-y rounded-md border">
            {roles.map((one) => {
              const label = roleLabel(one.id, one.name);
              return (
                <li key={one.id} data-catalog={one.id} className="flex flex-col gap-3 p-3 sm:p-4">
                  {editing?.kind === "role" && editing.id === one.id ? (
                    <RoleForm
                      initial={draftFromRole(one)}
                      editing={one}
                      onCancel={() => close("role", one.id)}
                      onDelete={
                        one.id === COMMANDER_ROLE
                          ? undefined
                          : () => {
                              void deleteRole({ id: one.id }).then(report(label));
                              close("role", null);
                            }
                      }
                      onSubmit={(draft) => {
                        const checked = checkRole(one.id, draft);
                        if (!checked.ok) return checked;
                        void updateRole(checked.args).then(report(label));
                        close("role", one.id);
                        return checked;
                      }}
                    />
                  ) : (
                    <RoleItem
                      role={one}
                      manage={manage}
                      onEdit={() => open({ kind: "role", id: one.id })}
                      onRestore={() => {
                        setRefused(null);
                        if (one.builtin) void restoreRole({ id: one.builtin }).then(report(label));
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      </CardContent>
    </Card>
  );
}

function Section({
  id,
  title,
  count,
  add,
  children,
}: {
  id: string;
  title: string;
  /** Null while it loads; false for a section that counts nothing. */
  count: string | null | false;
  add: React.ReactNode;
  children: React.ReactNode;
}) {
  const headingId = `incident-settings-${id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 id={headingId} className="font-semibold">
            {title}
          </h3>
          {count === null ? (
            <span aria-hidden className="block h-4 w-16 rounded-sm bg-muted" />
          ) : count === false ? null : (
            <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
          )}
        </div>
        {add}
      </div>
      {children}
    </section>
  );
}

function EditButton({ name, onEdit }: { name: string; onEdit: () => void }) {
  return (
    <Button
      variant="outline"
      data-action="edit"
      aria-label={m.catalog_action_on({ action: "edit", name })}
      onClick={onEdit}
    >
      <PencilIcon aria-hidden />
      {m.catalog_action({ action: "edit" })}
    </Button>
  );
}

function TypeItem({
  row,
  fields,
  roles,
  policies,
  manage,
  onEdit,
}: {
  row: IncidentTypeRow;
  fields: readonly CustomFieldRow[];
  roles: readonly RoleDefinition[];
  policies: readonly EscalationPolicyRow[];
  manage: boolean;
  onEdit: () => void;
}) {
  const policy = row.escalationPolicyId
    ? policies.find((one) => one.id === row.escalationPolicyId)
    : undefined;
  const required = row.requiredFields.flatMap((id) => {
    const field = fields.find((one) => one.id === id);
    return field ? [field.name] : [];
  });
  const filled = (row.roles ?? []).flatMap((id) => {
    const role = roles.find((one) => one.id === id);
    if (!role) return [];
    const name = roleLabel(role.id, role.name);
    return [row.requiredRoles?.includes(id) ? catalogText("required_role", { name }) : name];
  });
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
          <h4 className="min-w-0 font-medium [overflow-wrap:anywhere]">{row.name}</h4>
          {row.defaultSeverity ? <SeverityBadge severity={row.defaultSeverity} /> : null}
        </div>
        {manage ? <EditButton name={row.name} onEdit={onEdit} /> : null}
      </div>
      {row.description ? (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {row.description}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {/* A default shows as the badge beside the name; only its absence needs saying. */}
        {row.defaultSeverity ? null : <li>{catalogText("no_default_severity")}</li>}
        <li>
          {policy
            ? catalogText("pages_through", { name: policy.name })
            : catalogText("pages_default")}
        </li>
        <li>
          {required.length
            ? catalogText("requires", { name: required.join(", ") })
            : catalogText("requires_none")}
        </li>
        <li>
          {filled.length
            ? catalogText("fills_roles", { name: filled.join(", ") })
            : catalogText("fills_every_role")}
        </li>
      </ul>
    </>
  );
}

function FieldItem({
  row,
  manage,
  onEdit,
}: {
  row: CustomFieldRow;
  manage: boolean;
  onEdit: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
          <h4 className="min-w-0 font-medium [overflow-wrap:anywhere]">{row.name}</h4>
          <Badge variant="outline">{catalogText(`kind_${row.kind}`)}</Badge>
        </div>
        {manage ? <EditButton name={row.name} onEdit={onEdit} /> : null}
      </div>
      {row.description ? (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
          {row.description}
        </p>
      ) : null}
      {isSelect(row.kind) ? (
        <ul
          aria-label={m.catalog_field({ field: "options", form: "label" })}
          className="flex flex-wrap gap-1.5"
        >
          {row.options.map((option) => (
            <li
              key={option.id}
              className="max-w-full rounded-md border px-2 py-0.5 text-sm [overflow-wrap:anywhere]"
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function useFocusOnOpen() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

function useFormFocus(titleId: string) {
  return () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[aria-labelledby="${titleId}"] [aria-invalid="true"]`)
        ?.focus(),
    );
}

function TypeForm({
  initial,
  editing,
  fields,
  roles,
  policies,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: TypeDraft;
  editing?: IncidentTypeRow;
  fields: readonly CustomFieldRow[];
  /** The roles the workspace offers. */
  roles: readonly RoleDefinition[];
  policies: readonly EscalationPolicyRow[];
  onCancel: () => void;
  onSubmit: (draft: TypeDraft) => CheckedType;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{ name: boolean; description: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const severityId = useId();
  const policyId = useId();
  const requiredId = useId();
  const rolesId = useId();
  const nameRef = useFocusOnOpen();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const focusInvalid = useFormFocus(titleId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = onSubmit(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusInvalid();
    }
  };
  const toggle = (id: string, on: boolean) =>
    setDraft((current) => ({
      ...current,
      requiredFields: on
        ? [...current.requiredFields, id]
        : current.requiredFields.filter((one) => one !== id),
    }));
  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onCancel();
      }}
      className={FORM}
    >
      <h4 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {editing
          ? m.catalog_action_on({ action: "edit", name: editing.name })
          : m.catalog_action({ action: "add_type" })}
      </h4>
      <Field
        ref={nameRef}
        label={m.catalog_field({ field: "name", form: "label" })}
        value={draft.name}
        maxLength={CATALOG_NAME_MAX}
        autoComplete="off"
        error={errors?.name ? m.catalog_field({ field: "name", form: "invalid" }) : undefined}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <Description
        id={descriptionId}
        errorId={descriptionErrorId}
        value={draft.description}
        invalid={errors?.description ?? false}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={severityId} className="text-sm font-medium">
            {m.catalog_field({ field: "severity", form: "label" })}
          </label>
          <select
            id={severityId}
            className={SELECT}
            value={draft.defaultSeverity ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                defaultSeverity: (event.target.value || null) as Severity | null,
              })
            }
          >
            <option value="">{catalogText("severity_none")}</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severityName(severity)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={policyId} className="text-sm font-medium">
            {m.catalog_field({ field: "policy", form: "label" })}
          </label>
          <select
            id={policyId}
            className={SELECT}
            value={draft.escalationPolicyId ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, escalationPolicyId: event.target.value || null })
            }
          >
            <option value="">{catalogText("policy_default")}</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {fields.length > 0 ? (
        <fieldset aria-describedby={`${requiredId}-note`} className="flex min-w-0 flex-col gap-1.5">
          <legend className={`${LABEL} mb-1.5`}>
            {m.catalog_field({ field: "required", form: "label" })}
          </legend>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label
                key={field.id}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-primary"
                  checked={draft.requiredFields.includes(field.id)}
                  onChange={(event) => toggle(field.id, event.target.checked)}
                />
                <span className="min-w-0 [overflow-wrap:anywhere]">{field.name}</span>
              </label>
            ))}
          </div>
          <p id={`${requiredId}-note`} className="text-sm text-muted-foreground">
            {catalogText("required_note")}
          </p>
        </fieldset>
      ) : null}
      <fieldset aria-describedby={`${rolesId}-note`} className="flex min-w-0 flex-col gap-1.5">
        <legend className={`${LABEL} mb-1.5`}>
          {m.catalog_field({ field: "roles", form: "label" })}
        </legend>
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {roles.map((role) => {
            const selectId = `${rolesId}-${role.id}`;
            return (
              <li
                key={role.id}
                className="flex min-h-11 min-w-0 items-center justify-between gap-3 text-sm"
              >
                <label htmlFor={selectId} className="min-w-0 [overflow-wrap:anywhere]">
                  {roleLabel(role.id, role.name)}
                </label>
                <select
                  id={selectId}
                  className={`${SELECT} w-36 shrink-0`}
                  value={typeRoleUse(draft, role.id)}
                  onChange={(event) =>
                    setDraft((current) =>
                      setTypeRoleUse(current, role.id, event.target.value as TypeRoleUse),
                    )
                  }
                >
                  <option value="off">{catalogText("role_off")}</option>
                  <option value="listed">{catalogText("role_listed")}</option>
                  <option value="required">{catalogText("role_required")}</option>
                </select>
              </li>
            );
          })}
        </ul>
        <p id={`${rolesId}-note`} className="text-sm text-muted-foreground">
          {catalogText("roles_type_note")}
        </p>
      </fieldset>
      <FormButtons
        editing={editing !== undefined}
        create={m.catalog_action({ action: "create_type" })}
        remove={onDelete ? m.catalog_action({ action: "delete_type" }) : undefined}
        confirm={editing ? catalogText("delete_type", { name: editing.name }) : ""}
        confirming={confirming}
        deleteRef={deleteRef}
        onCancel={onCancel}
        onAskDelete={() => setConfirming(true)}
        onCloseConfirm={() => {
          setConfirming(false);
          requestAnimationFrame(() => deleteRef.current?.focus());
        }}
        onDelete={onDelete}
      />
    </form>
  );
}

function FieldForm({
  initial,
  editing,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: FieldDraft;
  editing?: CustomFieldRow;
  onCancel: () => void;
  onSubmit: (draft: FieldDraft) => CheckedField;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{
    name: boolean;
    description: boolean;
    options: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const kindId = useId();
  const optionsErrorId = useId();
  const nameRef = useFocusOnOpen();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusInvalid = useFormFocus(titleId);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = onSubmit(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusInvalid();
    }
  };
  const focusOption = (index: number) =>
    requestAnimationFrame(() =>
      (
        listRef.current?.querySelectorAll<HTMLInputElement>("input")[index] ?? addRef.current
      )?.focus(),
    );
  const setKind = (kind: FieldKind) =>
    setDraft((current) => ({
      ...current,
      kind,
      // A select starts with one empty option to fill.
      options:
        isSelect(kind) && current.options.length === 0
          ? [{ id: newOptionId(Date.now()), label: "" }]
          : current.options,
    }));
  return (
    <form
      aria-labelledby={titleId}
      noValidate
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !(event.target instanceof HTMLSelectElement)) onCancel();
      }}
      className={FORM}
    >
      <h4 id={titleId} className="font-medium [overflow-wrap:anywhere]">
        {editing
          ? m.catalog_action_on({ action: "edit", name: editing.name })
          : m.catalog_action({ action: "add_field" })}
      </h4>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
        <Field
          ref={nameRef}
          label={m.catalog_field({ field: "name", form: "label" })}
          value={draft.name}
          maxLength={CATALOG_NAME_MAX}
          autoComplete="off"
          error={errors?.name ? m.catalog_field({ field: "name", form: "invalid" }) : undefined}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={kindId} className="text-sm font-medium">
            {m.catalog_field({ field: "kind", form: "label" })}
          </label>
          <select
            id={kindId}
            className={SELECT}
            value={draft.kind}
            disabled={editing !== undefined}
            aria-describedby={editing ? `${kindId}-fixed` : undefined}
            onChange={(event) => setKind(event.target.value as FieldKind)}
          >
            {FIELD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {catalogText(`kind_${kind}`)}
              </option>
            ))}
          </select>
          {editing ? (
            <p id={`${kindId}-fixed`} className="text-sm text-muted-foreground">
              {catalogText("kind_fixed")}
            </p>
          ) : null}
        </div>
      </div>
      <Description
        id={descriptionId}
        errorId={descriptionErrorId}
        value={draft.description}
        invalid={errors?.description ?? false}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      {isSelect(draft.kind) ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className={`${LABEL} mb-1.5`}>
            {m.catalog_field({ field: "options", form: "label" })}
          </legend>
          <ol ref={listRef} className="flex flex-col gap-2">
            {draft.options.map((option, index) => (
              <li key={option.id} className="flex min-w-0 items-center gap-1">
                <input
                  value={option.label}
                  maxLength={CATALOG_NAME_MAX}
                  autoComplete="off"
                  aria-label={m.catalog_action_on({ action: "option", name: String(index + 1) })}
                  aria-invalid={errors?.options || undefined}
                  aria-describedby={errors?.options ? optionsErrorId : undefined}
                  className={`${SELECT} sm:max-w-sm`}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      options: current.options.map((one) =>
                        one.id === option.id ? { ...one, label: event.target.value } : one,
                      ),
                    }))
                  }
                  onKeyDown={(event) => {
                    // Enter adds the next option, as a list editor does, instead of saving half a list.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (draft.options.length >= MAX_FIELD_OPTIONS) return;
                    setDraft((current) => ({
                      ...current,
                      options: [
                        ...current.options.slice(0, index + 1),
                        { id: newOptionId(Date.now()), label: "" },
                        ...current.options.slice(index + 1),
                      ],
                    }));
                    focusOption(index + 1);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={m.catalog_action_on({
                    action: "remove",
                    name: option.label.trim() || String(index + 1),
                  })}
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      options: current.options.filter((one) => one.id !== option.id),
                    }));
                    focusOption(Math.min(index, draft.options.length - 2));
                  }}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          {errors?.options ? (
            <p id={optionsErrorId} className="text-sm text-destructive">
              {m.catalog_field({ field: "options", form: "invalid" })}
            </p>
          ) : null}
          {draft.options.length < MAX_FIELD_OPTIONS ? (
            <Button
              ref={addRef}
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  options: [...current.options, { id: newOptionId(Date.now()), label: "" }],
                }));
                focusOption(draft.options.length);
              }}
            >
              <PlusIcon aria-hidden />
              {m.catalog_action({ action: "add_option" })}
            </Button>
          ) : null}
        </fieldset>
      ) : null}
      <FormButtons
        editing={editing !== undefined}
        create={m.catalog_action({ action: "create_field" })}
        remove={onDelete ? m.catalog_action({ action: "delete_field" }) : undefined}
        confirm={editing ? catalogText("delete_field", { name: editing.name }) : ""}
        confirming={confirming}
        deleteRef={deleteRef}
        onCancel={onCancel}
        onAskDelete={() => setConfirming(true)}
        onCloseConfirm={() => {
          setConfirming(false);
          requestAnimationFrame(() => deleteRef.current?.focus());
        }}
        onDelete={onDelete}
      />
    </form>
  );
}

function RoleItem({
  role,
  manage,
  onEdit,
  onRestore,
}: {
  role: RoleDefinition;
  manage: boolean;
  onEdit: () => void;
  onRestore: () => void;
}) {
  const name = roleLabel(role.id, role.name);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
          <h4
            className={`min-w-0 font-medium [overflow-wrap:anywhere] ${role.removed ? "text-muted-foreground" : ""}`}
          >
            {name}
          </h4>
          {role.builtin ? <Badge variant="outline">{catalogText("builtin")}</Badge> : null}
          {role.removed ? <Badge variant="secondary">{catalogText("removed")}</Badge> : null}
        </div>
        {manage && role.removed ? (
          <Button
            variant="outline"
            data-action="edit"
            aria-label={m.catalog_action_on({ action: "restore", name })}
            onClick={onRestore}
          >
            <RotateCcwIcon aria-hidden />
            {m.catalog_action({ action: "restore" })}
          </Button>
        ) : manage ? (
          <EditButton name={name} onEdit={onEdit} />
        ) : null}
      </div>
      {role.removed ? (
        <p className="text-sm text-muted-foreground">{catalogText("removed_note")}</p>
      ) : (
        <>
          {role.description ? (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
              {role.description}
            </p>
          ) : null}
          {role.checklist.length ? (
            <ul
              aria-label={catalogText("responsibilities")}
              className="flex flex-col gap-1.5 text-sm"
            >
              {role.checklist.map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{item}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{catalogText("checklist_none")}</p>
          )}
        </>
      )}
    </>
  );
}

function RoleForm({
  initial,
  editing,
  onCancel,
  onSubmit,
  onDelete,
}: {
  initial: RoleDraft;
  editing?: RoleDefinition;
  onCancel: () => void;
  onSubmit: (draft: RoleDraft) => CheckedRole;
  /** Absent for the commander, who can never be removed. */
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{
    name: boolean;
    description: boolean;
    checklist: boolean;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const descriptionErrorId = useId();
  const checklistErrorId = useId();
  const nameRef = useFocusOnOpen();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusInvalid = useFormFocus(titleId);
  const builtin = editing?.builtin ?? null;
  const ownName = builtin ? roleLabel(builtin, null) : "";
  const shown = editing ? roleLabel(editing.id, editing.name) : "";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = onSubmit(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusInvalid();
    }
  };
  const focusItem = (index: number) =>
    requestAnimationFrame(() =>
      (
        listRef.current?.querySelectorAll<HTMLInputElement>("input")[index] ?? addRef.current
      )?.focus(),
    );
  const insertAt = (index: number) => {
    setDraft((current) => ({
      ...current,
      checklist: [
        ...current.checklist.slice(0, index),
        checklistItem(),
        ...current.checklist.slice(index),
      ],
    }));
    focusItem(index);
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
        {editing
          ? m.catalog_action_on({ action: "edit", name: shown })
          : m.catalog_action({ action: "add_role" })}
      </h4>
      <Field
        ref={nameRef}
        label={m.catalog_field({ field: "name", form: "label" })}
        value={draft.name}
        maxLength={CATALOG_NAME_MAX}
        autoComplete="off"
        placeholder={ownName || undefined}
        hint={builtin ? catalogText("builtin_name", { name: ownName }) : undefined}
        error={errors?.name ? m.catalog_field({ field: "name", form: "invalid" }) : undefined}
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <Description
        id={descriptionId}
        errorId={descriptionErrorId}
        value={draft.description}
        invalid={errors?.description ?? false}
        onChange={(description) => setDraft({ ...draft, description })}
      />
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className={`${LABEL} mb-1.5`}>
          {m.catalog_field({ field: "checklist", form: "label" })}
        </legend>
        {draft.checklist.length ? (
          <ol ref={listRef} className="flex flex-col gap-2">
            {draft.checklist.map((item, index) => (
              <li key={item.key} className="flex min-w-0 items-center gap-1">
                <input
                  value={item.text}
                  maxLength={ROLE_CHECKLIST_ITEM_MAX}
                  autoComplete="off"
                  aria-label={m.catalog_action_on({ action: "item", name: String(index + 1) })}
                  aria-invalid={errors?.checklist || undefined}
                  aria-describedby={errors?.checklist ? checklistErrorId : undefined}
                  className={SELECT}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      checklist: current.checklist.map((one) =>
                        one.key === item.key ? { ...one, text: event.target.value } : one,
                      ),
                    }))
                  }
                  onKeyDown={(event) => {
                    // Enter adds the next responsibility, as a list editor does, instead of saving half a list.
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (draft.checklist.length < MAX_ROLE_CHECKLIST) insertAt(index + 1);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={m.catalog_action_on({
                    action: "remove",
                    name: item.text.trim() || String(index + 1),
                  })}
                  onClick={() => {
                    setDraft((current) => ({
                      ...current,
                      checklist: current.checklist.filter((one) => one.key !== item.key),
                    }));
                    focusItem(Math.min(index, draft.checklist.length - 2));
                  }}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        {errors?.checklist ? (
          <p id={checklistErrorId} className="text-sm text-destructive">
            {m.catalog_field({ field: "checklist", form: "invalid" })}
          </p>
        ) : null}
        {draft.checklist.length < MAX_ROLE_CHECKLIST ? (
          <Button
            ref={addRef}
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => insertAt(draft.checklist.length)}
          >
            <PlusIcon aria-hidden />
            {m.catalog_action({ action: "add_item" })}
          </Button>
        ) : null}
      </fieldset>
      {editing?.id === COMMANDER_ROLE ? (
        <p className="text-sm text-muted-foreground">{catalogText("commander_kept")}</p>
      ) : null}
      <FormButtons
        editing={editing !== undefined}
        create={m.catalog_action({ action: "create_role" })}
        remove={
          onDelete
            ? m.catalog_action({ action: builtin ? "remove_role" : "delete_role" })
            : undefined
        }
        confirm={
          editing ? catalogText(builtin ? "remove_role" : "delete_role", { name: shown }) : ""
        }
        confirmAction={builtin ? m.catalog_action({ action: "remove_role" }) : undefined}
        confirming={confirming}
        deleteRef={deleteRef}
        onCancel={onCancel}
        onAskDelete={() => setConfirming(true)}
        onCloseConfirm={() => {
          setConfirming(false);
          requestAnimationFrame(() => deleteRef.current?.focus());
        }}
        onDelete={onDelete}
      />
    </form>
  );
}
