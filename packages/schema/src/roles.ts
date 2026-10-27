// Incident roles (RFC 0003 "Role definitions"): the three built-ins every workspace has, which keep their names as
// ids (`commander`, `communications`, `operations`; paging reads `roles.commander`), and the roles a workspace defines
// (`rol_<ULID>`). Pure helpers over the `incident_roles` rows; the mutations that write them are in catalog.ts.

import { isId } from "./id.ts";
import { INCIDENT_ROLES, type IncidentRole } from "./lifecycle.ts";
import type { IncidentRoleRow, IncidentRow, IncidentTypeRow } from "./tables.ts";

/** Roles a workspace has, the three built-ins included (removed ones too: they can come back). */
export const MAX_INCIDENT_ROLES = 15;
/** Responsibilities one role lists, and the longest one in UTF-16 code units after trimming. */
export const MAX_ROLE_CHECKLIST = 20;
export const ROLE_CHECKLIST_ITEM_MAX = 200;
/** The longest role id: a built-in's name or a `rol_<ULID>`. */
export const ROLE_ID_MAX = 32;

/** The role pages go to first under the interim rule (RFC 0006 "Who is paged"): it can be renamed, never removed. */
export const COMMANDER_ROLE = "commander" satisfies IncidentRole;

export const isBuiltinRole = (id: unknown): id is IncidentRole =>
  (INCIDENT_ROLES as readonly unknown[]).includes(id);

/** A built-in's name or a workspace role's `rol_` id. */
export const isRoleId = (id: unknown): id is string => isBuiltinRole(id) || isId("rol", id);

/**
 * A role as readers take it. `name` null: a built-in under its own (translated) name. `removed`: a built-in the
 * workspace took out, offered again only if restored.
 */
export type RoleDefinition = {
  id: string;
  builtin: IncidentRole | null;
  name: string | null;
  description: string;
  checklist: string[];
  removed: boolean;
};

function definitionOf(row: IncidentRoleRow | undefined, id: string): RoleDefinition {
  const builtin = isBuiltinRole(id) ? id : null;
  return {
    id,
    builtin,
    name: row?.name ? row.name : null,
    description: row?.description ?? "",
    checklist: row ? [...row.checklist] : [],
    removed: builtin !== null && builtin !== COMMANDER_ROLE && row?.removed === true,
  };
}

/** Every role the workspace has: the built-ins in their order, then its own in the order they were made. */
export function roleDefinitions(rows: readonly IncidentRoleRow[]): RoleDefinition[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const custom = rows
    .filter((row) => !isBuiltinRole(row.id))
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [
    ...INCIDENT_ROLES.map((id) => definitionOf(byId.get(id), id)),
    ...custom.map((row) => definitionOf(row, row.id)),
  ];
}

/** The role `id` names: a built-in (always, removed or not) or a workspace role that exists; else undefined. */
export function roleDefinition(
  rows: readonly IncidentRoleRow[],
  id: string,
): RoleDefinition | undefined {
  if (isBuiltinRole(id))
    return definitionOf(
      rows.find((row) => row.id === id),
      id,
    );
  const row = rows.find((one) => one.id === id);
  return row ? definitionOf(row, id) : undefined;
}

/** Whether a member may be given the role now: a built-in not removed, or a workspace role that exists. */
export const isLiveRole = (role: RoleDefinition | undefined): role is RoleDefinition =>
  role !== undefined && !role.removed;

/**
 * The roles an incident's page lists, in order. With a type that names roles: the commander (pages go to them),
 * then the type's roles, then any other role someone holds. Otherwise every role the workspace offers, then any
 * removed built-in someone still holds. A role deleted since is left out: it has no name left, and paging never reads
 * one.
 */
export function incidentRoleList(
  incident: Pick<IncidentRow, "roles" | "typeId">,
  types: readonly IncidentTypeRow[],
  rows: readonly IncidentRoleRow[],
): RoleDefinition[] {
  const all = roleDefinitions(rows);
  const type = incident.typeId ? types.find((one) => one.id === incident.typeId) : undefined;
  const held = (role: RoleDefinition) => incident.roles?.[role.id] !== undefined;
  const listed = type?.roles?.length
    ? [COMMANDER_ROLE, ...type.roles].flatMap((id, index, ids) => {
        const role = all.find((one) => one.id === id);
        return role && ids.indexOf(id) === index && (isLiveRole(role) || held(role)) ? [role] : [];
      })
    : all.filter(isLiveRole);
  return [...listed, ...all.filter((role) => held(role) && !listed.includes(role))];
}

/** The roles the incident's type requires that nobody holds yet, in the type's order. */
export function missingRoles(
  incident: Pick<IncidentRow, "roles" | "typeId">,
  types: readonly IncidentTypeRow[],
  rows: readonly IncidentRoleRow[],
): RoleDefinition[] {
  const type = incident.typeId ? types.find((one) => one.id === incident.typeId) : undefined;
  return (type?.requiredRoles ?? []).flatMap((id) => {
    const role = roleDefinition(rows, id);
    return isLiveRole(role) && incident.roles?.[id] === undefined ? [role] : [];
  });
}
