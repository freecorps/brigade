// The workspace's catalog (RFC 0003 "Service catalog", "Incident types", "Custom fields", "Role definitions"): the
// services it runs, the kinds of incident it declares, the typed fields incidents carry and the roles people take on
// them. Owners and admins define them; responders name an incident's type and services, fill its fields
// (`incident.setType`, `setServices`, `setField`, below) and give its roles (`incident.assignRole`, incidents.ts).

import { idTime } from "./id.ts";
import { ID_CLOCK_SKEW_MS, MAX_INCIDENT_SERVICES } from "./incidents.ts";
import { INCIDENT_ROLES, SEVERITIES } from "./lifecycle.ts";
import {
  defineMutation,
  fail,
  ok,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import {
  COMMANDER_ROLE,
  isBuiltinRole,
  isLiveRole,
  MAX_INCIDENT_ROLES,
  MAX_ROLE_CHECKLIST,
  ROLE_CHECKLIST_ITEM_MAX,
  ROLE_ID_MAX,
  roleDefinition,
} from "./roles.ts";
import type {
  CustomFieldRow,
  EscalationTarget,
  FieldOption,
  FieldValue,
  IncidentRoleRow,
  IncidentRow,
  IncidentTypeRow,
  ServiceRow,
} from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Issue, type Validated, type Validator } from "./validate.ts";

export const SERVICE_TIERS = ["tier1", "tier2", "tier3"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];
export const FIELD_KINDS = ["text", "single_select", "multi_select", "number", "link"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export const SERVICE_NAME_MAX = 80;
export const CATALOG_NAME_MAX = 60;
export const CATALOG_DESCRIPTION_MAX = 500;
export const MAX_SERVICES_PER_WORKSPACE = 100;
export const MAX_SERVICE_OWNERS = 10;
export const MAX_INCIDENT_TYPES_PER_WORKSPACE = 20;
export const MAX_CUSTOM_FIELDS_PER_WORKSPACE = 25;
export const MAX_FIELD_OPTIONS = 50;
/** A text field's value, and a link's, in UTF-16 code units after trimming. */
export const FIELD_TEXT_MAX = 500;
export const FIELD_LINK_MAX = 1000;
/** Options one multi-select value holds. */
export const MAX_FIELD_CHOICES = 20;
/** A number field holds any finite number up to this size either way. */
export const FIELD_NUMBER_LIMIT = 1e15;

// ---- Events -------------------------------------------------------------------------------------------------------

type ServiceSummary = {
  id: string;
  name: string;
  tier: ServiceTier;
  owners: number;
  escalationPolicyId: string | null;
};
export type ServiceCreated = DomainEvent<"service.created", ServiceSummary>;
/**
 * `policy_deleted`, `schedule_deleted` and `member_removed`: what the service pointed at went away and was taken out
 * in the same transaction (`ref` names it).
 */
export type ServiceUpdated = DomainEvent<
  "service.updated",
  ServiceSummary & {
    reason: "edited" | "policy_deleted" | "schedule_deleted" | "member_removed";
    ref: string | null;
  }
>;
export type ServiceDeleted = DomainEvent<"service.deleted", { id: string; name: string }>;

type TypeSummary = {
  id: string;
  name: string;
  defaultSeverity: IncidentTypeRow["defaultSeverity"];
  escalationPolicyId: string | null;
  requiredFields: number;
  /** How many roles it lists, and how many of them it requires. */
  roles: number;
  requiredRoles: number;
};
export type IncidentTypeCreated = DomainEvent<"incident_type.created", TypeSummary>;
export type IncidentTypeUpdated = DomainEvent<
  "incident_type.updated",
  TypeSummary & {
    reason: "edited" | "policy_deleted" | "field_deleted" | "role_deleted";
    ref: string | null;
  }
>;
export type IncidentTypeDeleted = DomainEvent<
  "incident_type.deleted",
  { id: string; name: string }
>;

type FieldSummary = { id: string; name: string; kind: FieldKind; options: number };
export type CustomFieldCreated = DomainEvent<"custom_field.created", FieldSummary>;
export type CustomFieldUpdated = DomainEvent<"custom_field.updated", FieldSummary>;
export type CustomFieldDeleted = DomainEvent<"custom_field.deleted", { id: string; name: string }>;

/** `name` empty: a built-in under its own name. `checklist`: how many responsibilities. */
type RoleSummary = { id: string; name: string; checklist: number };
export type IncidentRoleCreated = DomainEvent<"incident_role.created", RoleSummary>;
export type IncidentRoleUpdated = DomainEvent<"incident_role.updated", RoleSummary>;
/** A workspace role deleted, or a built-in taken out (`builtin`); the commander never is. */
export type IncidentRoleDeleted = DomainEvent<
  "incident_role.deleted",
  { id: string; name: string; builtin: boolean }
>;
export type IncidentRoleRestored = DomainEvent<"incident_role.restored", RoleSummary>;

export type IncidentTypeChanged = DomainEvent<
  "incident.type_changed",
  { from: string | null; to: string | null }
>;
export type IncidentServicesChanged = DomainEvent<
  "incident.services_changed",
  { serviceIds: string[]; added: string[]; removed: string[] }
>;
export type IncidentFieldChanged = DomainEvent<
  "incident.field_changed",
  { fieldId: string; kind: FieldKind; value: FieldValue | null }
>;

const serviceSummary = (row: ServiceRow): ServiceSummary => ({
  id: row.id,
  name: row.name,
  tier: row.tier,
  owners: row.owners.length,
  escalationPolicyId: row.escalationPolicyId,
});
const typeSummary = (row: IncidentTypeRow): TypeSummary => ({
  id: row.id,
  name: row.name,
  defaultSeverity: row.defaultSeverity,
  escalationPolicyId: row.escalationPolicyId,
  requiredFields: row.requiredFields.length,
  roles: row.roles?.length ?? 0,
  requiredRoles: row.requiredRoles?.length ?? 0,
});
const roleSummary = (row: IncidentRoleRow): RoleSummary => ({
  id: row.id,
  name: row.name,
  checklist: row.checklist.length,
});
const fieldSummary = (row: CustomFieldRow): FieldSummary => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  options: row.options.length,
});

const serviceUpdated = (
  row: ServiceRow,
  reason: ServiceUpdated["data"]["reason"],
  ref: string | null = null,
): ServiceUpdated => ({
  type: "service.updated",
  subject: row.id,
  data: { ...serviceSummary(row), reason, ref },
});
const typeUpdated = (
  row: IncidentTypeRow,
  reason: IncidentTypeUpdated["data"]["reason"],
  ref: string | null = null,
): IncidentTypeUpdated => ({
  type: "incident_type.updated",
  subject: row.id,
  data: { ...typeSummary(row), reason, ref },
});

// ---- Validation ---------------------------------------------------------------------------------------------------

const serviceId = v.id("svc");
const typeId = v.id("typ");
const fieldId = v.id("fld");
const policyRef = v.nullable(v.id("esc"));
const description = v.string({ max: CATALOG_DESCRIPTION_MAX, multiline: true, joiners: true });

const ownerArgs = v.object({
  kind: v.picklist(["schedule", "member"] as const),
  // A schedule id or a member's user id; which one exists is checked against the store.
  id: v.string({ min: 1, max: 64 }),
});

const serviceFields = {
  name: v.string({ min: 1, max: SERVICE_NAME_MAX }),
  description,
  tier: v.picklist(SERVICE_TIERS),
  owners: v.array(ownerArgs, { max: MAX_SERVICE_OWNERS }),
  escalationPolicyId: policyRef,
};

const roleRef = v.string({ min: 1, max: ROLE_ID_MAX });
const roleRefs = v.array(roleRef, { max: MAX_INCIDENT_ROLES, unique: true });

const typeFields = {
  name: v.string({ min: 1, max: CATALOG_NAME_MAX }),
  description,
  defaultSeverity: v.nullable(v.picklist(SEVERITIES)),
  escalationPolicyId: policyRef,
  requiredFields: v.array(fieldId, { max: MAX_CUSTOM_FIELDS_PER_WORKSPACE, unique: true }),
  // Left out by clients from before role definitions: none when creating, unchanged when updating.
  roles: v.optional(roleRefs),
  requiredRoles: v.optional(roleRefs),
};

const roleFields = {
  description,
  checklist: v.array(v.string({ min: 1, max: ROLE_CHECKLIST_ITEM_MAX, joiners: true }), {
    max: MAX_ROLE_CHECKLIST,
  }),
};

const optionLabel = v.string({ min: 1, max: CATALOG_NAME_MAX });
const optionArgs = v.object({ id: v.id("opt"), label: optionLabel });
const fieldFields = {
  name: v.string({ min: 1, max: CATALOG_NAME_MAX }),
  description,
  options: v.array(optionArgs, { max: MAX_FIELD_OPTIONS }),
};

/**
 * What the catalog's mutations take, field by field, for the public HTTP API's bodies (rest.ts), so a route accepts
 * exactly what the mutation it runs does.
 */
export {
  anyValue as fieldValueArgs,
  fieldFields as customFieldArgs,
  optionLabel as fieldOptionLabel,
  serviceFields as serviceArgs,
  typeFields as incidentTypeArgs,
};

const isSelect = (kind: FieldKind) => kind === "single_select" || kind === "multi_select";

/**
 * A new service's, type's or field's id: not ahead of the server clock, and never one a deleted entry had. Incidents
 * keep those ids, so an entry that took one over would inherit their values (as another kind of field) or their
 * type and its policy.
 */
function checkNewId(
  store: MutationStore,
  id: string,
  ctx: MutationContext,
): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  if (store.get("catalog_deleted", id)) return fail("conflict", "Id belonged to a deleted entry");
  return undefined;
}

/** Remembers a deleted entry's id, so `checkNewId` refuses it. */
const retire = (store: MutationStore, id: string, ctx: MutationContext) => {
  if (!store.get("catalog_deleted", id)) store.insert("catalog_deleted", { id, at: ctx.now });
};

/** Owners once each, schedules that exist, members who can respond (like escalation targets). */
function checkOwners(store: MutationStore, owners: readonly EscalationTarget[]): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  owners.forEach((owner, index) => {
    const path = `owners[${index}]`;
    const key = `${owner.kind}:${owner.id}`;
    if (seen.has(key)) issues.push({ path, message: "Listed twice" });
    seen.add(key);
    if (owner.kind === "schedule") {
      if (!store.get("schedules", owner.id)) issues.push({ path, message: "Schedule not found" });
      return;
    }
    const member = store.get("members", owner.id);
    if (!member || member.role === "viewer") {
      issues.push({ path, message: member ? "Viewers cannot own services" : "Not a member" });
    }
  });
  return issues;
}

function checkPolicyRef(store: MutationStore, id: string | null): Issue[] {
  return id !== null && !store.get("escalation_policies", id)
    ? [{ path: "escalationPolicyId", message: "Policy not found" }]
    : [];
}

/** Option ids and labels once each (labels compared without case); only select fields have options. */
function checkOptions(kind: FieldKind, options: readonly FieldOption[]): Issue[] {
  if (!isSelect(kind)) {
    return options.length ? [{ path: "options", message: "Only select fields have options" }] : [];
  }
  if (options.length === 0) return [{ path: "options", message: "Add at least one option" }];
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();
  options.forEach((option, index) => {
    const label = option.label.toLowerCase();
    if (ids.has(option.id)) issues.push({ path: `options[${index}].id`, message: "Listed twice" });
    if (labels.has(label)) {
      issues.push({ path: `options[${index}].label`, message: "Listed twice" });
    }
    ids.add(option.id);
    labels.add(label);
  });
  return issues;
}

const choices = v.array(v.id("opt"), { max: MAX_FIELD_CHOICES, unique: true });
const text = v.string({ min: 1, max: FIELD_TEXT_MAX, multiline: true, joiners: true });
const link = v.string({ min: 1, max: FIELD_LINK_MAX });
const number: Validator<number> = (input, path = "") =>
  typeof input === "number" && Number.isFinite(input) && Math.abs(input) <= FIELD_NUMBER_LIMIT
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a finite number" }] };

/**
 * Any value a field may hold, before the field's kind is known: text, a number, or option ids. Only the shape and
 * the largest size; `checkFieldValue` is the check for the field.
 */
const anyValue: Validator<FieldValue> = (input, path = "") => {
  if (typeof input === "number") return number(input, path);
  if (Array.isArray(input)) return choices(input, path);
  return typeof input === "string" && input.length <= FIELD_LINK_MAX * 2 + 64
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected text, a number or options" }] };
};

const LINK = /^https?:\/\/[^\s/?#]+[^\s]*$/i;

/** Whether `value` is a link a field may hold, and so one a client may render as a link: http(s) only. */
export const isFieldLink = (value: unknown): value is string =>
  typeof value === "string" && value.length <= FIELD_LINK_MAX && LINK.test(value);

/**
 * `value` as `field` takes it, or why not: the one check the shard and clients both run. Text is trimmed and held to
 * the text rules, a number to `FIELD_NUMBER_LIMIT`, and option ids must be the field's own (and live).
 */
export function checkFieldValue(field: CustomFieldRow, value: unknown): Validated<FieldValue> {
  const no = (message: string): Validated<never> => ({
    ok: false,
    issues: [{ path: "value", message }],
  });
  switch (field.kind) {
    case "number":
      return number(value, "value");
    case "text":
      return text(value, "value");
    case "link": {
      const checked = link(value, "value");
      if (!checked.ok) return checked;
      return LINK.test(checked.value) ? checked : no("Expected an http(s) link");
    }
    case "single_select":
    case "multi_select": {
      if (field.kind === "single_select" && typeof value !== "string") {
        return no("Expected one option");
      }
      if (field.kind === "multi_select") {
        if (!Array.isArray(value)) return no("Expected options");
        const checked = choices(value, "value");
        if (!checked.ok) return checked;
        if (checked.value.length === 0) return no("Expected an option");
      }
      const ids: unknown[] = Array.isArray(value) ? value : [value];
      if (!ids.every((id) => field.options.some((option) => option.id === id))) {
        return no("Option not found");
      }
      return { ok: true, value: value as FieldValue };
    }
  }
}

/**
 * What a field holds, as readers take it: null for nothing, for a value not of the field's kind (say, one written
 * under an id a field of another kind had), and for options that were taken out.
 */
export function liveValue(field: CustomFieldRow, value: FieldValue | undefined): FieldValue | null {
  if (value === undefined) return null;
  if (!isSelect(field.kind)) return checkFieldValue(field, value).ok ? value : null;
  const has = (id: unknown) => field.options.some((option) => option.id === id);
  if (field.kind === "multi_select") {
    if (!Array.isArray(value)) return null;
    const kept = value.filter(has);
    return kept.length ? kept : null;
  }
  return typeof value === "string" && has(value) ? value : null;
}

/** The required fields of the incident's type that hold nothing yet, in the type's order. */
export function missingFields(
  incident: Pick<IncidentRow, "typeId" | "fields">,
  types: readonly IncidentTypeRow[],
  fields: readonly CustomFieldRow[],
): CustomFieldRow[] {
  const type = incident.typeId ? types.find((row) => row.id === incident.typeId) : undefined;
  if (!type) return [];
  return type.requiredFields.flatMap((id) => {
    const field = fields.find((row) => row.id === id);
    return field && liveValue(field, incident.fields?.[id]) === null ? [field] : [];
  });
}

// ---- Services -----------------------------------------------------------------------------------------------------

export const createService = defineMutation({
  name: "service.create",
  args: v.object({ id: serviceId, ...serviceFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(store, args.id, ctx);
    if (clock) return clock;
    const issues = [
      ...checkOwners(store, args.owners),
      ...checkPolicyRef(store, args.escalationPolicyId),
    ];
    if (issues.length) return fail("invalid_args", "Invalid arguments for service.create", issues);
    if (store.get("services", args.id)) return fail("conflict", "Service already exists");
    if (store.scan("services").length >= MAX_SERVICES_PER_WORKSPACE) {
      return fail("limit_reached", `At most ${MAX_SERVICES_PER_WORKSPACE} services per workspace`);
    }
    const row: ServiceRow = {
      id: args.id,
      name: args.name,
      description: args.description,
      tier: args.tier,
      owners: args.owners.map((owner: EscalationTarget) => ({ kind: owner.kind, id: owner.id })),
      escalationPolicyId: args.escalationPolicyId,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("services", row);
    const event: ServiceCreated = {
      type: "service.created",
      subject: row.id,
      data: serviceSummary(row),
    };
    return ok(event);
  },
});

export const updateService = defineMutation({
  name: "service.update",
  args: v.object({ id: serviceId, ...serviceFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const service = store.get("services", args.id);
    if (!service) return fail("not_found", "Service not found");
    const issues = [
      ...checkOwners(store, args.owners),
      ...checkPolicyRef(store, args.escalationPolicyId),
    ];
    if (issues.length) return fail("invalid_args", "Invalid arguments for service.update", issues);
    const owners = args.owners.map((owner: EscalationTarget) => ({
      kind: owner.kind,
      id: owner.id,
    }));
    if (
      service.name === args.name &&
      service.description === args.description &&
      service.tier === args.tier &&
      service.escalationPolicyId === args.escalationPolicyId &&
      JSON.stringify(service.owners) === JSON.stringify(owners)
    ) {
      return fail("conflict", "Service is unchanged");
    }
    const row = store.update("services", args.id, {
      name: args.name,
      description: args.description,
      tier: args.tier,
      owners,
      escalationPolicyId: args.escalationPolicyId,
      updatedAt: ctx.now,
    });
    return ok(serviceUpdated(row, "edited"));
  },
});

/**
 * Deletes the service. Incidents that named it keep its id, which readers skip, and lose it the next time their
 * services are set: rewriting every incident here would sync them all for a catalog edit.
 */
export const deleteService = defineMutation({
  name: "service.delete",
  args: v.object({ id: serviceId }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const service = store.get("services", args.id);
    if (!service) return fail("not_found", "Service not found");
    store.delete("services", args.id);
    retire(store, args.id, ctx);
    const event: ServiceDeleted = {
      type: "service.deleted",
      subject: args.id,
      data: { id: args.id, name: service.name },
    };
    return ok(event);
  },
});

// ---- Incident types -----------------------------------------------------------------------------------------------

function checkType(
  store: MutationStore,
  args: {
    escalationPolicyId: string | null;
    requiredFields: readonly string[];
    roles: readonly string[];
    requiredRoles: readonly string[];
  },
): Issue[] {
  const issues = checkPolicyRef(store, args.escalationPolicyId);
  args.requiredFields.forEach((id, index) => {
    if (!store.get("custom_fields", id)) {
      issues.push({ path: `requiredFields[${index}]`, message: "Field not found" });
    }
  });
  const rows = store.scan("incident_roles");
  args.roles.forEach((id, index) => {
    if (!isLiveRole(roleDefinition(rows, id))) {
      issues.push({ path: `roles[${index}]`, message: "Role not found" });
    }
  });
  args.requiredRoles.forEach((id, index) => {
    if (!args.roles.includes(id)) {
      issues.push({ path: `requiredRoles[${index}]`, message: "Not one of the type's roles" });
    }
  });
  return issues;
}

/** The type's role lists as given, or as they are when an older client left them out. */
const typeRoles = (
  args: { roles?: readonly string[]; requiredRoles?: readonly string[] },
  type?: IncidentTypeRow,
) => ({
  roles: [...(args.roles ?? type?.roles ?? [])],
  requiredRoles: [...(args.requiredRoles ?? (args.roles ? [] : (type?.requiredRoles ?? [])))],
});

export const createIncidentType = defineMutation({
  name: "incidentType.create",
  args: v.object({ id: typeId, ...typeFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(store, args.id, ctx);
    if (clock) return clock;
    const roles = typeRoles(args);
    const issues = checkType(store, { ...args, ...roles });
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for incidentType.create", issues);
    }
    if (store.get("incident_types", args.id)) return fail("conflict", "Type already exists");
    if (store.scan("incident_types").length >= MAX_INCIDENT_TYPES_PER_WORKSPACE) {
      return fail(
        "limit_reached",
        `At most ${MAX_INCIDENT_TYPES_PER_WORKSPACE} incident types per workspace`,
      );
    }
    const row: IncidentTypeRow = {
      id: args.id,
      name: args.name,
      description: args.description,
      defaultSeverity: args.defaultSeverity,
      escalationPolicyId: args.escalationPolicyId,
      requiredFields: [...args.requiredFields],
      ...roles,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("incident_types", row);
    const event: IncidentTypeCreated = {
      type: "incident_type.created",
      subject: row.id,
      data: typeSummary(row),
    };
    return ok(event);
  },
});

/** Replaces the type's definition. Incidents of the type keep their severity: defaults apply when declaring. */
export const updateIncidentType = defineMutation({
  name: "incidentType.update",
  args: v.object({ id: typeId, ...typeFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const type = store.get("incident_types", args.id);
    if (!type) return fail("not_found", "Type not found");
    const roles = typeRoles(args, type);
    const issues = checkType(store, { ...args, ...roles });
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for incidentType.update", issues);
    }
    if (
      type.name === args.name &&
      type.description === args.description &&
      type.defaultSeverity === args.defaultSeverity &&
      type.escalationPolicyId === args.escalationPolicyId &&
      JSON.stringify(type.requiredFields) === JSON.stringify(args.requiredFields) &&
      JSON.stringify(type.roles ?? []) === JSON.stringify(roles.roles) &&
      JSON.stringify(type.requiredRoles ?? []) === JSON.stringify(roles.requiredRoles)
    ) {
      return fail("conflict", "Type is unchanged");
    }
    const row = store.update("incident_types", args.id, {
      name: args.name,
      description: args.description,
      defaultSeverity: args.defaultSeverity,
      escalationPolicyId: args.escalationPolicyId,
      requiredFields: [...args.requiredFields],
      ...roles,
      updatedAt: ctx.now,
    });
    return ok(typeUpdated(row, "edited"));
  },
});

/** Deletes the type. Incidents of it keep the id, read as a deleted type, until someone sets another. */
export const deleteIncidentType = defineMutation({
  name: "incidentType.delete",
  args: v.object({ id: typeId }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const type = store.get("incident_types", args.id);
    if (!type) return fail("not_found", "Type not found");
    store.delete("incident_types", args.id);
    retire(store, args.id, ctx);
    const event: IncidentTypeDeleted = {
      type: "incident_type.deleted",
      subject: args.id,
      data: { id: args.id, name: type.name },
    };
    return ok(event);
  },
});

// ---- Custom fields ------------------------------------------------------------------------------------------------

export const createCustomField = defineMutation({
  name: "customField.create",
  args: v.object({ id: fieldId, kind: v.picklist(FIELD_KINDS), ...fieldFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(store, args.id, ctx);
    if (clock) return clock;
    const issues = checkOptions(args.kind, args.options);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for customField.create", issues);
    }
    if (store.get("custom_fields", args.id)) return fail("conflict", "Field already exists");
    if (store.scan("custom_fields").length >= MAX_CUSTOM_FIELDS_PER_WORKSPACE) {
      return fail(
        "limit_reached",
        `At most ${MAX_CUSTOM_FIELDS_PER_WORKSPACE} custom fields per workspace`,
      );
    }
    const row: CustomFieldRow = {
      id: args.id,
      name: args.name,
      description: args.description,
      kind: args.kind,
      options: args.options.map((option: FieldOption) => ({ id: option.id, label: option.label })),
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("custom_fields", row);
    const event: CustomFieldCreated = {
      type: "custom_field.created",
      subject: row.id,
      data: fieldSummary(row),
    };
    return ok(event);
  },
});

/**
 * Renames the field and replaces its options; its kind stays, so values already set keep their meaning. An option
 * taken out stops counting in values that hold it (`liveValue`), which lose it the next time the field is set.
 */
export const updateCustomField = defineMutation({
  name: "customField.update",
  args: v.object({ id: fieldId, ...fieldFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const field = store.get("custom_fields", args.id);
    if (!field) return fail("not_found", "Field not found");
    const issues = checkOptions(field.kind, args.options);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for customField.update", issues);
    }
    const options = args.options.map((option: FieldOption) => ({
      id: option.id,
      label: option.label,
    }));
    if (
      field.name === args.name &&
      field.description === args.description &&
      JSON.stringify(field.options) === JSON.stringify(options)
    ) {
      return fail("conflict", "Field is unchanged");
    }
    const row = store.update("custom_fields", args.id, {
      name: args.name,
      description: args.description,
      options,
      updatedAt: ctx.now,
    });
    const event: CustomFieldUpdated = {
      type: "custom_field.updated",
      subject: row.id,
      data: fieldSummary(row),
    };
    return ok(event);
  },
});

/** Deletes the field and takes it out of every type that required it. Values on incidents are left to fade. */
export const deleteCustomField = defineMutation({
  name: "customField.delete",
  args: v.object({ id: fieldId }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const field = store.get("custom_fields", args.id);
    if (!field) return fail("not_found", "Field not found");
    store.delete("custom_fields", args.id);
    retire(store, args.id, ctx);
    const events: DomainEvent[] = [
      {
        type: "custom_field.deleted",
        subject: args.id,
        data: { id: args.id, name: field.name },
      } satisfies CustomFieldDeleted,
    ];
    for (const type of store.scan("incident_types")) {
      if (!type.requiredFields.includes(args.id)) continue;
      const row = store.update("incident_types", type.id, {
        requiredFields: type.requiredFields.filter((id) => id !== args.id),
        updatedAt: ctx.now,
      });
      events.push(typeUpdated(row, "field_deleted", args.id));
    }
    return ok(...events);
  },
});

// ---- Role definitions ---------------------------------------------------------------------------------------------

const roleId = v.id("rol");

/**
 * Checklist items once each (compared without case), so a list reads as distinct responsibilities. Returns the
 * issues for `checklist[i]`.
 */
function checkChecklist(checklist: readonly string[]): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  checklist.forEach((item, index) => {
    const key = item.toLowerCase();
    if (seen.has(key)) issues.push({ path: `checklist[${index}]`, message: "Listed twice" });
    seen.add(key);
  });
  return issues;
}

/**
 * A role of the workspace's own (RFC 0003 "Role definitions"): a name, a description and what whoever holds it is
 * responsible for. At most `MAX_INCIDENT_ROLES` roles, the built-ins counted.
 */
export const createIncidentRole = defineMutation({
  name: "incidentRole.create",
  args: v.object({ id: roleId, name: v.string({ min: 1, max: CATALOG_NAME_MAX }), ...roleFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const clock = checkNewId(store, args.id, ctx);
    if (clock) return clock;
    const issues = checkChecklist(args.checklist);
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for incidentRole.create", issues);
    }
    if (store.get("incident_roles", args.id)) return fail("conflict", "Role already exists");
    const own = store.scan("incident_roles").filter((row) => !isBuiltinRole(row.id)).length;
    if (own + INCIDENT_ROLES.length >= MAX_INCIDENT_ROLES) {
      return fail("limit_reached", `At most ${MAX_INCIDENT_ROLES} incident roles per workspace`);
    }
    const row: IncidentRoleRow = {
      id: args.id,
      name: args.name,
      description: args.description,
      checklist: [...args.checklist],
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("incident_roles", row);
    const event: IncidentRoleCreated = {
      type: "incident_role.created",
      subject: row.id,
      data: roleSummary(row),
    };
    return ok(event);
  },
});

/**
 * Renames a role, or replaces its description and checklist. A built-in's id never changes, so renaming the commander
 * changes nothing about who is paged; an empty name puts a built-in back under its own. Holders keep the role.
 */
export const updateIncidentRole = defineMutation({
  name: "incidentRole.update",
  args: v.object({ id: roleRef, name: v.string({ max: CATALOG_NAME_MAX }), ...roleFields }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const builtin = isBuiltinRole(args.id);
    const row = store.get("incident_roles", args.id);
    if (!builtin && !row) return fail("not_found", "Role not found");
    const issues = checkChecklist(args.checklist);
    if (!builtin && args.name === "") issues.push({ path: "name", message: "Enter a name" });
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for incidentRole.update", issues);
    }
    const before = row ?? { name: "", description: "", checklist: [] };
    if (
      before.name === args.name &&
      before.description === args.description &&
      JSON.stringify(before.checklist) === JSON.stringify(args.checklist)
    ) {
      return fail("conflict", "Role is unchanged");
    }
    const fields = {
      name: args.name,
      description: args.description,
      checklist: [...args.checklist],
      updatedAt: ctx.now,
    };
    const next = row
      ? store.update("incident_roles", args.id, fields)
      : store.insert("incident_roles", {
          id: args.id,
          ...fields,
          createdAt: ctx.now,
          createdBy: ctx.actor.id,
        });
    const event: IncidentRoleUpdated = {
      type: "incident_role.updated",
      subject: args.id,
      data: roleSummary(next),
    };
    return ok(event);
  },
});

/**
 * Deletes a workspace role, or takes a built-in out (`removed`, restorable), and drops it from every type. Never the
 * commander: pages go to them first (RFC 0006 "Who is paged"). Incidents keep who held it, as for deleted types: a
 * deleted role is not listed and a removed built-in only while someone holds it; either can still be taken away.
 */
export const deleteIncidentRole = defineMutation({
  name: "incidentRole.delete",
  args: v.object({ id: roleRef }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    if (args.id === COMMANDER_ROLE) {
      const message = "The commander role cannot be removed";
      return fail("invalid_args", message, [{ path: "id", message }]);
    }
    const builtin = isBuiltinRole(args.id);
    const row = store.get("incident_roles", args.id);
    const role = roleDefinition(store.scan("incident_roles"), args.id);
    if (!isLiveRole(role)) return fail("not_found", "Role not found");
    if (builtin) {
      if (row) store.update("incident_roles", args.id, { removed: true, updatedAt: ctx.now });
      else {
        store.insert("incident_roles", {
          id: args.id,
          name: "",
          description: "",
          checklist: [],
          removed: true,
          createdAt: ctx.now,
          createdBy: ctx.actor.id,
          updatedAt: ctx.now,
        });
      }
    } else {
      store.delete("incident_roles", args.id);
      retire(store, args.id, ctx);
    }
    const events: DomainEvent[] = [
      {
        type: "incident_role.deleted",
        subject: args.id,
        data: { id: args.id, name: row?.name ?? "", builtin },
      } satisfies IncidentRoleDeleted,
    ];
    for (const type of store.scan("incident_types")) {
      if (!type.roles?.includes(args.id)) continue;
      const next = store.update("incident_types", type.id, {
        roles: type.roles.filter((id) => id !== args.id),
        requiredRoles: (type.requiredRoles ?? []).filter((id) => id !== args.id),
        updatedAt: ctx.now,
      });
      events.push(typeUpdated(next, "role_deleted", args.id));
    }
    return ok(...events);
  },
});

/** Brings back a built-in that was taken out, as it was (name, description, checklist). */
export const restoreIncidentRole = defineMutation({
  name: "incidentRole.restore",
  args: v.object({ id: v.picklist(INCIDENT_ROLES) }),
  permission: "catalog:manage",
  apply(store, args, ctx) {
    const row = store.get("incident_roles", args.id);
    if (!row?.removed) return fail("conflict", "Role is not removed");
    const next = store.update("incident_roles", args.id, { removed: false, updatedAt: ctx.now });
    const event: IncidentRoleRestored = {
      type: "incident_role.restored",
      subject: args.id,
      data: roleSummary(next),
    };
    return ok(event);
  },
});

// ---- References that go away --------------------------------------------------------------------------------------

/** Unsets a deleted escalation policy on every service and type, in the transaction that deleted it. */
export function dropPolicyFromCatalog(
  store: MutationStore,
  policyId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const service of store.scan("services")) {
    if (service.escalationPolicyId !== policyId) continue;
    const row = store.update("services", service.id, {
      escalationPolicyId: null,
      updatedAt: ctx.now,
    });
    events.push(serviceUpdated(row, "policy_deleted", policyId));
  }
  for (const type of store.scan("incident_types")) {
    if (type.escalationPolicyId !== policyId) continue;
    const row = store.update("incident_types", type.id, {
      escalationPolicyId: null,
      updatedAt: ctx.now,
    });
    events.push(typeUpdated(row, "policy_deleted", policyId));
  }
  return events;
}

/**
 * Takes a deleted schedule, or a member removed or made a viewer, out of every service's owners, in the same
 * transaction (wherever `dropFromPolicies` runs). A service left with no owner shows as unowned.
 */
export function dropOwner(
  store: MutationStore,
  owner: EscalationTarget,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  const same = (one: EscalationTarget) => one.kind === owner.kind && one.id === owner.id;
  for (const service of store.scan("services")) {
    if (!service.owners.some(same)) continue;
    const row = store.update("services", service.id, {
      owners: service.owners.filter((one) => !same(one)),
      updatedAt: ctx.now,
    });
    events.push(
      serviceUpdated(
        row,
        owner.kind === "member" ? "member_removed" : "schedule_deleted",
        owner.id,
      ),
    );
  }
  return events;
}

// ---- On incidents -------------------------------------------------------------------------------------------------

const incidentId = v.id("inc");

/**
 * The values an incident keeps: only fields that still exist and values they still take (`liveValue`); the rest fade
 * on the next write.
 */
export function liveFields(
  store: Pick<MutationStore, "get">,
  incident: IncidentRow,
): Record<string, FieldValue> {
  const kept: Record<string, FieldValue> = {};
  for (const [id, value] of Object.entries(incident.fields ?? {})) {
    const field = store.get("custom_fields", id);
    const live = field ? liveValue(field, value) : null;
    if (live !== null) kept[id] = live;
  }
  return kept;
}

/**
 * Sets or clears the incident's type. Its defaults (severity) apply only when declaring: changing the type later
 * changes nothing else, and an escalation run under way keeps the policy it started with.
 */
export const setIncidentType = defineMutation({
  name: "incident.setType",
  args: v.object({ id: incidentId, typeId: v.nullable(typeId) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const from = incident.typeId ?? null;
    if (from === args.typeId) {
      return fail("conflict", args.typeId ? "Type is already set" : "No type is set");
    }
    const type = args.typeId ? store.get("incident_types", args.typeId) : undefined;
    if (args.typeId && !type) {
      return fail("invalid_args", "Type not found", [
        { path: "typeId", message: "Type not found" },
      ]);
    }
    store.update("incidents", args.id, { typeId: args.typeId, updatedAt: ctx.now });
    // A type deleted since has no name left: the entry says the incident changed from a deleted type.
    const previous = from ? store.get("incident_types", from) : undefined;
    appendTimeline(
      store,
      incident,
      {
        kind: "type_changed",
        from: previous?.name ?? null,
        to: type?.name ?? null,
        ...(from !== null && !previous && { fromDeleted: true }),
      },
      ctx,
    );
    const event: IncidentTypeChanged = {
      type: "incident.type_changed",
      subject: args.id,
      data: { from, to: args.typeId },
    };
    return ok(event);
  },
});

/** Replaces the services the incident names (affected services). Every one must exist. */
export const setIncidentServices = defineMutation({
  name: "incident.setServices",
  args: v.object({
    id: incidentId,
    serviceIds: v.array(serviceId, { max: MAX_INCIDENT_SERVICES, unique: true }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const issues: Issue[] = [];
    args.serviceIds.forEach((id: string, index: number) => {
      if (!store.get("services", id)) {
        issues.push({ path: `serviceIds[${index}]`, message: "Service not found" });
      }
    });
    if (issues.length) {
      return fail("invalid_args", "Invalid arguments for incident.setServices", issues);
    }
    const before = incident.serviceIds ?? [];
    const added = args.serviceIds.filter((id: string) => !before.includes(id));
    const removed = before.filter((id) => !args.serviceIds.includes(id));
    // The order is the one picked (the incident lists them so), so a reorder is a change too.
    if (JSON.stringify(before) === JSON.stringify(args.serviceIds)) {
      return fail("conflict", "Services are unchanged");
    }
    store.update("incidents", args.id, { serviceIds: [...args.serviceIds], updatedAt: ctx.now });
    // By name as they are now; a deleted service has none left and is not named.
    const names = (ids: string[]) =>
      ids.flatMap((id) => {
        const name = store.get("services", id)?.name;
        return name ? [name] : [];
      });
    appendTimeline(
      store,
      incident,
      { kind: "services_changed", added: names(added), removed: names(removed) },
      ctx,
    );
    const event: IncidentServicesChanged = {
      type: "incident.services_changed",
      subject: args.id,
      data: { serviceIds: [...args.serviceIds], added, removed },
    };
    return ok(event);
  },
});

/**
 * Sets one custom field on the incident, or clears it (`value: null`). The value must fit the field's kind. A field
 * the incident's type requires can be changed but not cleared; nothing else waits on it (declaring, paging and
 * resolving never do).
 */
export const setIncidentField = defineMutation({
  name: "incident.setField",
  args: v.object({ id: incidentId, fieldId, value: v.nullable(anyValue) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const field = store.get("custom_fields", args.fieldId);
    if (!field) {
      return fail("invalid_args", "Field not found", [
        { path: "fieldId", message: "Field not found" },
      ]);
    }
    let value: FieldValue | null = args.value;
    if (value !== null) {
      const checked = checkFieldValue(field, value);
      if (!checked.ok) return fail("invalid_args", "Invalid value for the field", checked.issues);
      value = checked.value;
    }
    const current = liveValue(field, incident.fields?.[field.id]);
    if (JSON.stringify(current) === JSON.stringify(value)) {
      return fail("conflict", value === null ? "Field is already empty" : "Field already holds it");
    }
    if (value === null) {
      const type = incident.typeId ? store.get("incident_types", incident.typeId) : undefined;
      if (type?.requiredFields.includes(field.id)) {
        const message = "Required by the incident's type";
        return fail("invalid_args", message, [{ path: "value", message }]);
      }
    }
    const fields = liveFields(store, incident);
    if (value === null) delete fields[field.id];
    else fields[field.id] = value;
    store.update("incidents", args.id, { fields, updatedAt: ctx.now });
    // The value as it reads now, so the entry still reads once options are renamed or the field is gone.
    const labels =
      value !== null && isSelect(field.kind)
        ? (Array.isArray(value) ? value : [value]).map(
            (id) => field.options.find((option) => option.id === id)?.label ?? "",
          )
        : undefined;
    appendTimeline(
      store,
      incident,
      {
        kind: "field_changed",
        field: field.name,
        fieldKind: field.kind,
        value: labels ? null : value,
        ...(labels && { labels }),
      },
      ctx,
    );
    const event: IncidentFieldChanged = {
      type: "incident.field_changed",
      subject: args.id,
      data: { fieldId: field.id, kind: field.kind, value },
    };
    return ok(event);
  },
});

// ---- Queries ------------------------------------------------------------------------------------------------------

const byName = <R extends { id: string; name: string }>(a: R, b: R) =>
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const allServices = defineQuery({
  name: "services.all",
  args: v.object({}),
  permission: "catalog:read",
  table: "services",
  filter: () => true,
  // Most critical first, then by name.
  sort: (a, b) => SERVICE_TIERS.indexOf(a.tier) - SERVICE_TIERS.indexOf(b.tier) || byName(a, b),
});

export const allIncidentTypes = defineQuery({
  name: "incidentTypes.all",
  args: v.object({}),
  permission: "catalog:read",
  table: "incident_types",
  filter: () => true,
  sort: byName,
});

/** In the order they were created, which is the order the incident page lists them. */
export const allCustomFields = defineQuery({
  name: "customFields.all",
  args: v.object({}),
  permission: "catalog:read",
  table: "custom_fields",
  filter: () => true,
  sort: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

/** Every role row, built-in overrides included; `roleDefinitions` (roles.ts) reads them in order. */
export const allIncidentRoles = defineQuery({
  name: "incidentRoles.all",
  args: v.object({}),
  permission: "catalog:read",
  table: "incident_roles",
  filter: () => true,
  sort: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

/** What members may send. */
export const catalogMutations = [
  createService,
  updateService,
  deleteService,
  createIncidentType,
  updateIncidentType,
  deleteIncidentType,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  createIncidentRole,
  updateIncidentRole,
  deleteIncidentRole,
  restoreIncidentRole,
  setIncidentType,
  setIncidentServices,
  setIncidentField,
] as const;

export const catalogQueries = [
  allServices,
  allIncidentTypes,
  allCustomFields,
  allIncidentRoles,
] as const;
