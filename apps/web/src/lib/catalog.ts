// The catalog on the dashboard (RFC 0003 "Service catalog", "Incident types", "Custom fields"): the editors' drafts,
// their checks before a mutation is sent, and how a field's value is entered and read. String-free except labels.

import { m } from "@freecorps/brigade-i18n";
import { fieldText, mutationErrorReason } from "@freecorps/brigade-i18n/incident";
import {
  CATALOG_DESCRIPTION_MAX,
  CATALOG_NAME_MAX,
  checkFieldValue,
  FIELD_TEXT_MAX,
  liveValue,
  MAX_CUSTOM_FIELDS_PER_WORKSPACE,
  MAX_FIELD_OPTIONS,
  MAX_INCIDENT_TYPES_PER_WORKSPACE,
  MAX_SERVICES_PER_WORKSPACE,
  newId,
  SERVICE_NAME_MAX,
  textRules,
  type CustomFieldRow,
  type EscalationTarget,
  type FieldKind,
  type FieldValue,
  type IncidentTypeRow,
  type MemberRow,
  type ScheduleRow,
  type ServiceRow,
  type ServiceTier,
  type Severity,
} from "@freecorps/brigade-schema";

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export { CATALOG_NAME_MAX, FIELD_TEXT_MAX, MAX_FIELD_OPTIONS, SERVICE_NAME_MAX };

/** `catalog_text` without the inputs a part does not use. */
export function catalogText(
  part: Parameters<typeof m.catalog_text>[0]["text"],
  inputs: { name?: string; reason?: string } = {},
): string {
  return m.catalog_text({ name: "", reason: "", ...inputs, text: part });
}

export function catalogRefusal(name: string, code: string): string {
  const reason = code === "not_found" ? catalogText("gone") : mutationErrorReason(code);
  return catalogText("change_failed", { name, reason });
}

export const newServiceId = (now: number) => newId("svc", now, random);
export const newTypeId = (now: number) => newId("typ", now, random);
export const newFieldId = (now: number) => newId("fld", now, random);
export const newOptionId = (now: number) => newId("opt", now, random);
export const canAddService = (count: number) => count < MAX_SERVICES_PER_WORKSPACE;
export const canAddType = (count: number) => count < MAX_INCIDENT_TYPES_PER_WORKSPACE;
export const canAddField = (count: number) => count < MAX_CUSTOM_FIELDS_PER_WORKSPACE;

/** What the text rules refuse (hidden characters, nothing visible) in a name or a description. */
const textProblem = (value: string, multiline: boolean) =>
  value.length > 0 &&
  (textRules.problem(value, multiline, true) !== undefined || !textRules.hasVisible(value));

const checkName = (value: string, max: number) => {
  const name = value.trim();
  return { name, bad: name.length === 0 || name.length > max || textProblem(name, false) };
};
const checkDescription = (value: string) => {
  const description = value.trim();
  return {
    description,
    bad: description.length > CATALOG_DESCRIPTION_MAX || textProblem(description, true),
  };
};

// ---- Services -----------------------------------------------------------------------------------------------------

export type ServiceDraft = {
  name: string;
  description: string;
  tier: ServiceTier;
  owners: EscalationTarget[];
  escalationPolicyId: string | null;
};
export type ServiceArgs = ServiceDraft & { id: string };
export type CheckedService =
  | { ok: true; args: ServiceArgs }
  | { ok: false; errors: { name: boolean; description: boolean } };

export const emptyService = (): ServiceDraft => ({
  name: "",
  description: "",
  tier: "tier2",
  owners: [],
  escalationPolicyId: null,
});

export const draftFromService = (row: ServiceRow): ServiceDraft => ({
  name: row.name,
  description: row.description,
  tier: row.tier,
  owners: row.owners.map((owner) => ({ ...owner })),
  escalationPolicyId: row.escalationPolicyId,
});

export function checkService(id: string, draft: ServiceDraft): CheckedService {
  const { name, bad: badName } = checkName(draft.name, SERVICE_NAME_MAX);
  const { description, bad: badDescription } = checkDescription(draft.description);
  if (badName || badDescription) {
    return { ok: false, errors: { name: badName, description: badDescription } };
  }
  return { ok: true, args: { id, ...draft, name, description } };
}

/** Owners that can no longer be saved (a deleted schedule, someone gone or now a viewer) are left out. */
export function liveOwners(
  owners: readonly EscalationTarget[],
  schedules: readonly ScheduleRow[],
  members: readonly MemberRow[],
): { owners: EscalationTarget[]; dropped: boolean } {
  const kept = owners.filter((owner) =>
    owner.kind === "schedule"
      ? schedules.some((row) => row.id === owner.id)
      : members.some((row) => row.id === owner.id && row.role !== "viewer"),
  );
  return { owners: kept, dropped: kept.length !== owners.length };
}

/** An owner's name: the schedule's or the member's, or what became of them. */
export function ownerLabel(
  owner: EscalationTarget,
  schedules: readonly ScheduleRow[],
  members: readonly MemberRow[],
): string {
  if (owner.kind === "schedule") {
    return schedules.find((row) => row.id === owner.id)?.name || catalogText("deleted_schedule");
  }
  return members.find((row) => row.id === owner.id)?.name || m.oncall_unnamed();
}

// ---- Incident types -----------------------------------------------------------------------------------------------

export type TypeDraft = {
  name: string;
  description: string;
  defaultSeverity: Severity | null;
  escalationPolicyId: string | null;
  requiredFields: string[];
};
export type TypeArgs = TypeDraft & { id: string };
export type CheckedType =
  | { ok: true; args: TypeArgs }
  | { ok: false; errors: { name: boolean; description: boolean } };

export const emptyType = (): TypeDraft => ({
  name: "",
  description: "",
  defaultSeverity: null,
  escalationPolicyId: null,
  requiredFields: [],
});

export const draftFromType = (row: IncidentTypeRow): TypeDraft => ({
  name: row.name,
  description: row.description,
  defaultSeverity: row.defaultSeverity,
  escalationPolicyId: row.escalationPolicyId,
  requiredFields: [...row.requiredFields],
});

export function checkType(
  id: string,
  draft: TypeDraft,
  fields: readonly CustomFieldRow[],
): CheckedType {
  const { name, bad: badName } = checkName(draft.name, CATALOG_NAME_MAX);
  const { description, bad: badDescription } = checkDescription(draft.description);
  if (badName || badDescription) {
    return { ok: false, errors: { name: badName, description: badDescription } };
  }
  // A field deleted while the form was open is left out rather than refused.
  const requiredFields = draft.requiredFields.filter((one) => fields.some((row) => row.id === one));
  return { ok: true, args: { id, ...draft, name, description, requiredFields } };
}

// ---- Custom fields ------------------------------------------------------------------------------------------------

export type OptionDraft = { id: string; label: string };
export type FieldDraft = {
  name: string;
  description: string;
  kind: FieldKind;
  options: OptionDraft[];
};
export type CheckedField =
  | {
      ok: true;
      args: { id: string; name: string; description: string; options: OptionDraft[] };
      kind: FieldKind;
    }
  | { ok: false; errors: { name: boolean; description: boolean; options: boolean } };

export const isSelect = (kind: FieldKind) => kind === "single_select" || kind === "multi_select";

export const emptyField = (): FieldDraft => ({
  name: "",
  description: "",
  kind: "text",
  options: [],
});

export const draftFromField = (row: CustomFieldRow): FieldDraft => ({
  name: row.name,
  description: row.description,
  kind: row.kind,
  options: row.options.map((option) => ({ ...option })),
});

export function checkField(id: string, draft: FieldDraft): CheckedField {
  const { name, bad: badName } = checkName(draft.name, CATALOG_NAME_MAX);
  const { description, bad: badDescription } = checkDescription(draft.description);
  const options = isSelect(draft.kind)
    ? draft.options.map((option) => ({ id: option.id, label: option.label.trim() }))
    : [];
  const labels = options.map((option) => option.label.toLowerCase());
  const badOptions =
    isSelect(draft.kind) &&
    (options.length === 0 ||
      options.some(
        (option) =>
          option.label.length === 0 ||
          option.label.length > CATALOG_NAME_MAX ||
          textProblem(option.label, false),
      ) ||
      new Set(labels).size !== labels.length);
  if (badName || badDescription || badOptions) {
    return {
      ok: false,
      errors: { name: badName, description: badDescription, options: badOptions },
    };
  }
  return { ok: true, kind: draft.kind, args: { id, name, description, options } };
}

/** A field's value as the incident page reads it; null when it holds nothing (or only options taken out). */
export function valueText(field: CustomFieldRow, value: FieldValue | undefined): string | null {
  const live = liveValue(field, value);
  if (live === null) return null;
  if (!isSelect(field.kind)) return fieldText(live);
  const ids = Array.isArray(live) ? live : [live];
  return fieldText(
    null,
    ids.map((one) => field.options.find((option) => option.id === one)?.label ?? ""),
  );
}

/**
 * What the value editor holds for each kind: text for text, links and numbers (as typed), the chosen option ids for
 * selects.
 */
export type ValueDraft = { text: string; choices: string[] };

export function draftFromValue(field: CustomFieldRow, value: FieldValue | undefined): ValueDraft {
  const live = liveValue(field, value);
  if (live === null) return { text: "", choices: [] };
  if (isSelect(field.kind))
    return { text: "", choices: Array.isArray(live) ? live : [String(live)] };
  return { text: String(live), choices: [] };
}

/** Which message says what is wrong with a value of `kind`. */
export const valueProblem = (kind: FieldKind) =>
  kind === "number" ? "number" : kind === "link" ? "link" : isSelect(kind) ? "choice" : "text";

/**
 * The draft as `incident.setField`'s value, by the shard's own check (`checkFieldValue`); `null` clears. A number is
 * read in the reader's notation too ("1,5" in pt-BR).
 */
export function checkValue(
  field: CustomFieldRow,
  draft: ValueDraft,
): { ok: true; value: FieldValue | null } | { ok: false } {
  let value: FieldValue;
  if (isSelect(field.kind)) {
    if (draft.choices.length === 0) return { ok: true, value: null };
    value = field.kind === "single_select" ? draft.choices[0]! : draft.choices;
  } else {
    const text = draft.text.trim();
    if (text === "") return { ok: true, value: null };
    if (field.kind === "number") {
      const plain = text.replace(/\s/g, "");
      const number = /^[-+]?\d+(?:[.,]\d+)?$/.test(plain) ? Number(plain.replace(",", ".")) : NaN;
      if (!Number.isFinite(number)) return { ok: false };
      value = number;
    } else {
      value = text;
    }
  }
  // The shard's own check: text rules and sizes, `FIELD_NUMBER_LIMIT`, http(s) links, live options.
  const checked = checkFieldValue(field, value);
  return checked.ok ? { ok: true, value: checked.value } : { ok: false };
}
