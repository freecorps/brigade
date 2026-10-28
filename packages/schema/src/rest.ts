// The bodies and answers of the public HTTP API's incident and catalog routes (RFC 0002 "Public HTTP API"): what
// `apps/api` accepts and answers, made from the same validators as the named mutations each route runs, so a route
// never takes what its mutation would refuse, and the reference (`toJsonSchema`) documents exactly that.

import {
  customFieldArgs,
  FIELD_KINDS,
  fieldOptionLabel,
  fieldValueArgs,
  incidentTypeArgs,
  liveFields,
  MAX_CUSTOM_FIELDS_PER_WORKSPACE,
  MAX_FIELD_OPTIONS,
  serviceArgs,
} from "./catalog.ts";
import { INCIDENT_TITLE_MAX, MAX_INCIDENT_SERVICES, UPDATE_BODY_MAX } from "./incidents.ts";
import { isRoleId, MAX_INCIDENT_ROLES } from "./roles.ts";
import { INCIDENT_STATUSES, SEVERITIES, type IncidentStatus, type Severity } from "./lifecycle.ts";
import type { MutationStore } from "./mutation.ts";
import type {
  CustomFieldRow,
  FieldValue,
  IncidentRow,
  IncidentTypeRow,
  ServiceRow,
} from "./tables.ts";
import {
  MAX_ISSUES,
  v,
  type Infer,
  type Issue,
  type Validated,
  type Validator,
} from "./validate.ts";

/**
 * What a caller sends for a validator's output: a key whose value may be left out (`v.omittable`) is optional, at any
 * depth, so `{ status: "resolved" }` is a whole `IncidentPatch`.
 */
export type Sent<T> = T extends readonly (infer Item)[]
  ? Sent<Item>[]
  : T extends object
    ? { [K in keyof T as undefined extends T[K] ? K : never]?: Sent<Exclude<T[K], undefined>> } & {
        [K in keyof T as undefined extends T[K] ? never : K]: Sent<T[K]>;
      }
    : T;

/** Incidents one page of `GET /workspaces/:id/incidents` holds by default, and at most. */
export const INCIDENT_PAGE_DEFAULT = 50;
export const INCIDENT_PAGE_MAX = 100;
/**
 * Most incidents one list request reads: past it the page so far is answered, with a cursor where the read stopped,
 * so the shard that pages people never reads every incident for one request.
 */
export const INCIDENT_SCAN_CAP = 1000;

const serviceIds = v.array(v.id("svc"), { max: MAX_INCIDENT_SERVICES, unique: true });

/** `POST /workspaces/:id/incidents`: `incident.declare`'s arguments, the id made by the server. */
export const declareRequest = v.object({
  title: v.string({ min: 1, max: INCIDENT_TITLE_MAX }),
  severity: v.omittable(v.picklist(SEVERITIES)),
  typeId: v.omittable(v.id("typ")),
  serviceIds: v.omittable(serviceIds),
  // RFC 0006 "Who is paged": first in the policy order; one that does not exist is left out, as a deleted type is.
  escalationPolicyId: v.omittable(v.id("esc")),
});
export type DeclareRequest = Sent<Infer<typeof declareRequest>>;

/**
 * Custom field values by field id, `null` to clear one: each becomes an `incident.setField`. The value's shape only;
 * whether it fits the field is the mutation's check. Hand-written (no `v.*` makes a map), so the reference spells it
 * out itself (`FIELD_VALUES_SCHEMA`).
 */
export const fieldValues: Validator<Record<string, FieldValue | null>> = (input, path = "") => {
  const at = (key: string) => (path ? `${path}.${key}` : key);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path, message: "Expected an object" }] };
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_CUSTOM_FIELDS_PER_WORKSPACE) {
    return {
      ok: false,
      issues: [{ path, message: `At most ${MAX_CUSTOM_FIELDS_PER_WORKSPACE} fields` }],
    };
  }
  const fieldId = v.id("fld");
  const value = v.nullable(fieldValueArgs);
  const issues: Issue[] = [];
  const out: Record<string, FieldValue | null> = {};
  for (const [key, raw] of entries) {
    const id = fieldId(key, at(key));
    if (!id.ok) {
      issues.push(...id.issues);
      continue;
    }
    const checked = value(raw, at(key));
    if (checked.ok) out[key] = checked.value;
    else issues.push(...checked.issues);
  }
  return issues.length
    ? { ok: false, issues: issues.slice(0, MAX_ISSUES) }
    : { ok: true, value: out };
};

/**
 * Who holds each incident role, by role id (a built-in's name or a `rol_` id), `null` to leave one empty: each becomes
 * an `incident.assignRole`. The shape only; whether the role is offered and the person may hold it is the mutation's
 * check. Hand-written like `fieldValues`; the reference spells it out itself.
 */
export const roleHolders: Validator<Record<string, string | null>> = (input, path = "") => {
  const at = (key: string) => (path ? `${path}.${key}` : key);
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path, message: "Expected an object" }] };
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_INCIDENT_ROLES) {
    return { ok: false, issues: [{ path, message: `At most ${MAX_INCIDENT_ROLES} roles` }] };
  }
  const holder = v.nullable(v.string({ min: 1, max: 64 }));
  const issues: Issue[] = [];
  const out: Record<string, string | null> = {};
  for (const [key, raw] of entries) {
    if (!isRoleId(key)) {
      issues.push({ path: at(key), message: "Not a role id" });
      continue;
    }
    const checked = holder(raw, at(key));
    if (checked.ok) out[key] = checked.value;
    else issues.push(...checked.issues);
  }
  return issues.length
    ? { ok: false, issues: issues.slice(0, MAX_ISSUES) }
    : { ok: true, value: out };
};

/**
 * `PATCH /workspaces/:id/incidents/:incidentId` but `fields` and `roles` (`incidentPatchRequest` adds them): what
 * changes, each through its own named mutation, in this order: `incident.rename`, `incident.setType`,
 * `incident.setServices`, `incident.setField` per field, `incident.assignRole` per role, `incident.setSeverity`,
 * `incident.setStatus`.
 */
export const incidentPatchFields = v.object({
  title: v.omittable(v.string({ min: 1, max: INCIDENT_TITLE_MAX })),
  typeId: v.omittable(v.nullable(v.id("typ"))),
  serviceIds: v.omittable(serviceIds),
  severity: v.omittable(v.picklist(SEVERITIES)),
  status: v.omittable(v.picklist(INCIDENT_STATUSES)),
});
export type IncidentPatch = Sent<Infer<typeof incidentPatchFields>> & {
  fields?: Record<string, FieldValue | null>;
  /** User ids by role id; `null` leaves the role empty. */
  roles?: Record<string, string | null>;
};

export const incidentPatchRequest: Validator<IncidentPatch> = (input, path = "") => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path, message: "Expected an object" }] };
  }
  const { fields, roles, ...rest } = input as Record<string, unknown>;
  const base = incidentPatchFields(rest, path);
  const values: Validated<Record<string, FieldValue | null> | undefined> =
    fields === undefined ? { ok: true, value: undefined } : fieldValues(fields, "fields");
  const holders: Validated<Record<string, string | null> | undefined> =
    roles === undefined ? { ok: true, value: undefined } : roleHolders(roles, "roles");
  const issues = [
    ...(base.ok ? [] : base.issues),
    ...(values.ok ? [] : values.issues),
    ...(holders.ok ? [] : holders.issues),
  ];
  if (!base.ok || !values.ok || !holders.ok) {
    return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  }
  return {
    ok: true,
    value: {
      ...base.value,
      ...(values.value !== undefined && { fields: values.value }),
      ...(holders.value !== undefined && { roles: holders.value }),
    },
  };
};

/**
 * `POST /workspaces/:id/incidents/:incidentId/updates`: `incident.postUpdate`'s body; also `PATCH …/updates/:entryId`'s,
 * the text an edit (`incident.editUpdate`) puts in its place.
 */
export const updateRequest = v.object({
  body: v.string({ min: 1, max: UPDATE_BODY_MAX, multiline: true, joiners: true }),
});

/**
 * Whether `entryId` can be a timeline entry of incident `incidentId` (`<incident id>:<seq>`), as the edit and removal
 * routes take it: anything else is no entry of that incident.
 */
export function isEntryIdOf(incidentId: string, entryId: string): boolean {
  const prefix = `${incidentId}:`;
  return entryId.startsWith(prefix) && /^[1-9][0-9]{0,8}$/.test(entryId.slice(prefix.length));
}

/** `POST /workspaces/:id/services`: `service.create`'s arguments; only the name and tier are required. */
export const serviceCreateRequest = v.object({
  name: serviceArgs.name,
  tier: serviceArgs.tier,
  description: v.omittable(serviceArgs.description),
  owners: v.omittable(serviceArgs.owners),
  escalationPolicyId: v.omittable(serviceArgs.escalationPolicyId),
});

/** `PATCH /workspaces/:id/services/:serviceId`: what changes; the rest stays as it is (`service.update`). */
export const servicePatchRequest = v.object({
  name: v.omittable(serviceArgs.name),
  tier: v.omittable(serviceArgs.tier),
  description: v.omittable(serviceArgs.description),
  owners: v.omittable(serviceArgs.owners),
  escalationPolicyId: v.omittable(serviceArgs.escalationPolicyId),
});

/** `POST /workspaces/:id/incident-types`: `incidentType.create`'s arguments; only the name is required. */
export const incidentTypeCreateRequest = v.object({
  name: incidentTypeArgs.name,
  description: v.omittable(incidentTypeArgs.description),
  defaultSeverity: v.omittable(incidentTypeArgs.defaultSeverity),
  escalationPolicyId: v.omittable(incidentTypeArgs.escalationPolicyId),
  requiredFields: v.omittable(incidentTypeArgs.requiredFields),
  roles: v.omittable(incidentTypeArgs.roles),
  requiredRoles: v.omittable(incidentTypeArgs.requiredRoles),
});

/** `PATCH /workspaces/:id/incident-types/:typeId`: what changes (`incidentType.update`). */
export const incidentTypePatchRequest = v.object({
  name: v.omittable(incidentTypeArgs.name),
  description: v.omittable(incidentTypeArgs.description),
  defaultSeverity: v.omittable(incidentTypeArgs.defaultSeverity),
  escalationPolicyId: v.omittable(incidentTypeArgs.escalationPolicyId),
  requiredFields: v.omittable(incidentTypeArgs.requiredFields),
  roles: v.omittable(incidentTypeArgs.roles),
  requiredRoles: v.omittable(incidentTypeArgs.requiredRoles),
});

/** An option as a script sends it: its id to keep one, none for a new one (the server makes it). */
const optionRequest = v.object({ id: v.omittable(v.id("opt")), label: fieldOptionLabel });
const optionsRequest = v.array(optionRequest, { max: MAX_FIELD_OPTIONS });

/** `POST /workspaces/:id/custom-fields`: `customField.create`'s arguments; options only for select fields. */
export const customFieldCreateRequest = v.object({
  name: customFieldArgs.name,
  kind: v.picklist(FIELD_KINDS),
  description: v.omittable(customFieldArgs.description),
  options: v.omittable(optionsRequest),
});

/** `PATCH /workspaces/:id/custom-fields/:fieldId`: what changes; the kind never does (`customField.update`). */
export const customFieldPatchRequest = v.object({
  name: v.omittable(customFieldArgs.name),
  description: v.omittable(customFieldArgs.description),
  options: v.omittable(optionsRequest),
});

export type ServiceCreateRequest = Sent<Infer<typeof serviceCreateRequest>>;
export type ServicePatchRequest = Sent<Infer<typeof servicePatchRequest>>;
export type IncidentTypeCreateRequest = Sent<Infer<typeof incidentTypeCreateRequest>>;
export type IncidentTypePatchRequest = Sent<Infer<typeof incidentTypePatchRequest>>;
export type CustomFieldCreateRequest = Sent<Infer<typeof customFieldCreateRequest>>;
export type CustomFieldPatchRequest = Sent<Infer<typeof customFieldPatchRequest>>;

/** An incident as the public HTTP API answers it. Times are epoch milliseconds. */
export type PublicIncident = {
  id: string;
  /** `INC-<number>`'s number. */
  number: number | null;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  declaredAt: number;
  /** A user id, a `tok_` id, or a system actor's. */
  declaredBy: string;
  acknowledgedAt: number | null;
  acknowledgedBy: string | null;
  /** Null for none, or a type deleted since. */
  typeId: string | null;
  /** In the order picked; deleted services left out. */
  serviceIds: string[];
  /** Values by field id, as readers take them (`liveValue`): fields deleted since, and dropped options, left out. */
  fields: Record<string, FieldValue>;
  /** Who holds each incident role, by role id. */
  roles: Record<string, string>;
  updatedAt: number;
};

/** `row` as the public HTTP API answers it, read against the catalog in `store`. */
export function publicIncident(
  store: Pick<MutationStore, "get">,
  row: IncidentRow,
): PublicIncident {
  const typeId = row.typeId && store.get("incident_types", row.typeId) ? row.typeId : null;
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    severity: row.severity,
    status: row.status,
    declaredAt: row.declaredAt,
    declaredBy: row.declaredBy,
    acknowledgedAt: row.acknowledgedAt ?? null,
    acknowledgedBy: row.acknowledgedBy ?? null,
    typeId,
    serviceIds: (row.serviceIds ?? []).filter((id) => store.get("services", id)),
    fields: liveFields(store, row),
    roles: { ...row.roles },
    updatedAt: row.updatedAt,
  };
}

/** A service as the public HTTP API answers it (`ServiceRow`'s columns). */
export type PublicService = Pick<
  ServiceRow,
  | "id"
  | "name"
  | "description"
  | "tier"
  | "owners"
  | "escalationPolicyId"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
>;

export const publicService = (row: ServiceRow): PublicService => ({
  id: row.id,
  name: row.name,
  description: row.description,
  tier: row.tier,
  owners: row.owners.map((owner) => ({ kind: owner.kind, id: owner.id })),
  escalationPolicyId: row.escalationPolicyId,
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
});

/** An incident type as the public HTTP API answers it: its role lists always present (empty: every role). */
export type PublicIncidentType = Pick<
  IncidentTypeRow,
  | "id"
  | "name"
  | "description"
  | "defaultSeverity"
  | "escalationPolicyId"
  | "requiredFields"
  | "createdAt"
  | "createdBy"
  | "updatedAt"
> & { roles: string[]; requiredRoles: string[] };

export const publicIncidentType = (row: IncidentTypeRow): PublicIncidentType => ({
  id: row.id,
  name: row.name,
  description: row.description,
  defaultSeverity: row.defaultSeverity,
  escalationPolicyId: row.escalationPolicyId,
  requiredFields: [...row.requiredFields],
  roles: [...(row.roles ?? [])],
  requiredRoles: [...(row.requiredRoles ?? [])],
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
});

/** A custom field as the public HTTP API answers it. */
export type PublicCustomField = Pick<
  CustomFieldRow,
  "id" | "name" | "description" | "kind" | "options" | "createdAt" | "createdBy" | "updatedAt"
>;

export const publicCustomField = (row: CustomFieldRow): PublicCustomField => ({
  id: row.id,
  name: row.name,
  description: row.description,
  kind: row.kind,
  options: row.options.map((option) => ({ id: option.id, label: option.label })),
  createdAt: row.createdAt,
  createdBy: row.createdBy,
  updatedAt: row.updatedAt,
});
