// The shard's side of the public HTTP API's incident and catalog routes (RFC 0002 "Public HTTP API"; the Worker's
// side is src/rest-routes.ts). Reads come from the shard's rows, as Brigade Sync's queries read them, held to the
// actor's permission (and an API token's scopes). Every write is one or more of the named mutations the dashboard
// sends over sync, run as the actor through `Shard.mutate` with their RBAC, timeline entries and events through the
// outbox (RFC 0004, RFC 0005): declaring here pages exactly as declaring in the dashboard does.
//
// Idempotency: each mutation's id is made from the request's `Idempotency-Key` (and, for a create, the id it makes
// is too), so a retry gets the stored results of the first request instead of running anything again.

import {
  allCustomFields,
  allIncidentTypes,
  allows,
  allServices,
  evaluateQuery,
  INCIDENT_PAGE_DEFAULT,
  newId,
  prefixRange,
  publicCustomField,
  publicIncident,
  publicIncidentType,
  publicService,
  type Actor,
  type CustomFieldCreateRequest,
  type CustomFieldPatchRequest,
  type CustomFieldRow,
  type DeclareRequest,
  type FieldOption,
  type IncidentPatch,
  type IncidentStatus,
  type IncidentTypeCreateRequest,
  type IncidentTypePatchRequest,
  type Issue,
  type MutationErrorCode,
  type Permission,
  type PublicIncident,
  type ServiceCreateRequest,
  type ServicePatchRequest,
  type ServiceRow,
  type Severity,
} from "@freecorps/brigade-schema";
import type { MutationResultMessage } from "@freecorps/brigade-sync/protocol";
import type { Shard } from "./shard.ts";
import type { RowChange } from "./store.ts";

/** The client id the API's mutations run under, apart from every socket's and the notification ack's. */
export const REST_CLIENT_ID = "rest";

export type IncidentFilter = {
  status?: IncidentStatus[];
  severity?: Severity[];
  typeId?: string;
  serviceId?: string;
  /** The last id of the page before: this page starts below it. */
  cursor?: string;
  limit?: number;
};

/** What a route reads. */
export type RestRead =
  | { kind: "incidents"; filter: IncidentFilter }
  | { kind: "incident"; id: string }
  | { kind: "services" }
  | { kind: "service"; id: string }
  | { kind: "incidentTypes" }
  | { kind: "incidentType"; id: string }
  | { kind: "customFields" }
  | { kind: "customField"; id: string };

/** What a route changes, its body already checked against its validator (`@freecorps/brigade-schema` rest.ts). */
export type RestWrite =
  | { kind: "declare"; body: DeclareRequest }
  | { kind: "updateIncident"; id: string; body: IncidentPatch }
  | { kind: "postUpdate"; id: string; body: { body: string } }
  | { kind: "createService"; body: ServiceCreateRequest }
  | { kind: "updateService"; id: string; body: ServicePatchRequest }
  | { kind: "deleteService"; id: string }
  | { kind: "createIncidentType"; body: IncidentTypeCreateRequest }
  | { kind: "updateIncidentType"; id: string; body: IncidentTypePatchRequest }
  | { kind: "createCustomField"; body: CustomFieldCreateRequest }
  | { kind: "updateCustomField"; id: string; body: CustomFieldPatchRequest };

export type RestCode = MutationErrorCode | "not_a_member" | "unauthenticated";

export type RestResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; code: RestCode; issues?: Issue[] };

const refused = (code: RestCode, issues?: Issue[]): RestResult =>
  issues?.length ? { ok: false, code, issues } : { ok: false, code };

/** The permission each read needs: what the Worker asks of an API token's scopes, and the shard of the actor. */
export const READ_PERMISSION: Record<RestRead["kind"], Permission> = {
  incidents: "incident:read",
  incident: "incident:read",
  services: "catalog:read",
  service: "catalog:read",
  incidentTypes: "catalog:read",
  incidentType: "catalog:read",
  customFields: "catalog:read",
  customField: "catalog:read",
};

/** The permission each write's mutations need; the mutations check it themselves too. */
export const WRITE_PERMISSION: Record<RestWrite["kind"], Permission> = {
  declare: "incident:declare",
  updateIncident: "incident:update",
  postUpdate: "incident:update",
  createService: "catalog:manage",
  updateService: "catalog:manage",
  deleteService: "catalog:manage",
  createIncidentType: "catalog:manage",
  updateIncidentType: "catalog:manage",
  createCustomField: "catalog:manage",
  updateCustomField: "catalog:manage",
};

/** Answers a read as `actor` (already backed by the shard: `WorkspaceDO.tokenActor`). */
export function readRest(shard: Shard, actor: Actor, read: RestRead): RestResult {
  if (!allows(actor, READ_PERMISSION[read.kind])) return refused("forbidden");
  const { store } = shard;
  const one = <R>(row: R | undefined, key: string, as: (row: R) => unknown = (row) => row) =>
    row ? { ok: true as const, body: { [key]: as(row) } } : refused("not_found");
  switch (read.kind) {
    case "incidents":
      return { ok: true, body: listIncidents(shard, read.filter) };
    case "incident":
      return one(store.get("incidents", read.id), "incident", (row) => publicIncident(store, row));
    case "services":
      return {
        ok: true,
        body: { services: evaluateQuery(allServices, {}, store).map(publicService) },
      };
    case "service":
      return one(store.get("services", read.id), "service", publicService);
    case "incidentTypes":
      return {
        ok: true,
        body: { incidentTypes: evaluateQuery(allIncidentTypes, {}, store).map(publicIncidentType) },
      };
    case "incidentType":
      return one(store.get("incident_types", read.id), "incidentType", publicIncidentType);
    case "customFields":
      return {
        ok: true,
        body: { customFields: evaluateQuery(allCustomFields, {}, store).map(publicCustomField) },
      };
    case "customField":
      return one(store.get("custom_fields", read.id), "customField", publicCustomField);
  }
}

/**
 * One page of the workspace's incidents, newest first by id (the time the declaring client made it), filtered, and
 * the cursor of the next page (null on the last). Reads the incidents below the cursor off the store's key.
 */
function listIncidents(
  shard: Shard,
  filter: IncidentFilter,
): { incidents: PublicIncident[]; nextCursor: string | null } {
  const { store } = shard;
  const limit = filter.limit ?? INCIDENT_PAGE_DEFAULT;
  const range = prefixRange("inc_");
  const rows = store.range("incidents", range.from, filter.cursor ?? range.to);
  const page: PublicIncident[] = [];
  let nextCursor: string | null = null;
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    if (filter.status && !filter.status.includes(row.status)) continue;
    if (filter.severity && !filter.severity.includes(row.severity)) continue;
    if (filter.typeId && row.typeId !== filter.typeId) continue;
    if (filter.serviceId && !(row.serviceIds ?? []).includes(filter.serviceId)) continue;
    if (page.length === limit) {
      nextCursor = page[page.length - 1]!.id;
      break;
    }
    page.push(publicIncident(store, row));
  }
  return { incidents: page, nextCursor };
}

export type WriteContext = {
  shard: Shard;
  /** Already backed by the shard (`WorkspaceDO.tokenActor`). */
  actor: Actor;
  /** The request's `Idempotency-Key`. */
  key: string;
  /** 32 bytes made from the actor, the write's kind and the key (`keySeed`): what a create's ids are made of. */
  seed: Uint8Array;
  now: number;
  /** A mutation committed: its patch goes to the open sockets. */
  committed(version: number, changes: RowChange[]): void;
};

/** The seed of a write's ids (`WriteContext.seed`): the same request again makes the same ones. */
export async function keySeed(kind: string, actorId: string, key: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}\n${actorId}\n${key}`),
  );
  return new Uint8Array(digest);
}

/** Runs a write as `ctx.actor`. */
export function writeRest(ctx: WriteContext, write: RestWrite): RestResult {
  switch (write.kind) {
    case "declare":
      return declare(ctx, write.body);
    case "updateIncident":
      return updateIncident(ctx, write.id, write.body);
    case "postUpdate": {
      const args = { id: write.id, body: write.body.body };
      const result = run(ctx, "incident.postUpdate", args, [write.id, "update"]);
      return result.ok ? { ok: true, body: { ok: true } } : failure(result);
    }
    case "createService":
      return createService(ctx, write.body);
    case "updateService":
      return updateService(ctx, write.id, write.body);
    case "deleteService": {
      const result = run(ctx, "service.delete", { id: write.id }, [write.id, "delete"]);
      return result.ok ? { ok: true, body: { ok: true } } : failure(result);
    }
    case "createIncidentType":
      return createIncidentType(ctx, write.body);
    case "updateIncidentType":
      return updateIncidentType(ctx, write.id, write.body);
    case "createCustomField":
      return createCustomField(ctx, write.body);
    case "updateCustomField":
      return updateCustomField(ctx, write.id, write.body);
  }
}

/** A mutation's id: what it is for (`parts`) and the request's key. */
const mutationIdOf = (ctx: WriteContext, parts: readonly string[]) => [...parts, ctx.key].join(":");

/**
 * One named mutation, as a socket's would run (never `internal`), de-duplicated by its id (`mutationIdOf`). A retry
 * answers the stored result and commits nothing.
 */
function run(
  ctx: WriteContext,
  name: string,
  args: Record<string, unknown>,
  parts: readonly string[],
): MutationResultMessage {
  const mutationId = mutationIdOf(ctx, parts);
  const stored = ctx.shard.storedResult(ctx.actor.id, REST_CLIENT_ID, mutationId, ctx.now);
  if (stored) return stored;
  const { result, changes } = ctx.shard.mutate({
    clientId: REST_CLIENT_ID,
    mutationId,
    actor: ctx.actor,
    name,
    args,
    now: ctx.now,
  });
  if (result.ok) ctx.committed(result.version, changes);
  return result;
}

const failure = (result: Extract<MutationResultMessage, { ok: false }>): RestResult =>
  refused(result.error.code, result.error.issues);

/** A refusal that only says nothing changed: a `PATCH` that asks for what already is succeeds. */
const unchanged = (result: MutationResultMessage) => !result.ok && result.error.code === "conflict";

/**
 * The id a create makes: from when its mutation first ran (the stored result's time, on a retry) and the seed, so a
 * retry makes the same one. `n` tells apart several ids one request makes (a field's options).
 */
function madeId(ctx: WriteContext, prefix: string, parts: readonly string[], n = 0): string {
  const at =
    ctx.shard.storedAt(ctx.actor.id, REST_CLIENT_ID, mutationIdOf(ctx, parts), ctx.now) ?? ctx.now;
  const bytes = ctx.seed.slice(0, 16);
  bytes[14]! ^= n >> 8;
  bytes[15]! ^= n & 0xff;
  return newId(prefix, at, (length) => bytes.slice(bytes.length - length));
}

function declare(ctx: WriteContext, body: DeclareRequest): RestResult {
  const parts = ["declare"];
  const id = madeId(ctx, "inc", parts);
  const args = {
    id,
    title: body.title,
    ...(body.severity !== undefined && { severity: body.severity }),
    ...(body.typeId !== undefined && { typeId: body.typeId }),
    ...(body.serviceIds !== undefined && { serviceIds: body.serviceIds }),
  };
  const result = run(ctx, "incident.declare", args, parts);
  if (!result.ok) return failure(result);
  const row = ctx.shard.store.get("incidents", id);
  if (!row) return refused("internal");
  return { ok: true, body: { incident: publicIncident(ctx.shard.store, row) } };
}

/**
 * Each change through its own mutation, in a fixed order: type, services, fields, severity, status (last, so a
 * resolve comes after the details it closes with). One that asks for what already is counts as done. The first
 * refusal stops the rest and is the answer; the ones before it stay made, and the same request again (same key) runs
 * only what is left.
 */
function updateIncident(ctx: WriteContext, id: string, body: IncidentPatch): RestResult {
  if (!ctx.shard.store.get("incidents", id)) return refused("not_found");
  const steps: [string, Record<string, unknown>, string][] = [];
  if (body.typeId !== undefined) {
    steps.push(["incident.setType", { id, typeId: body.typeId }, "type"]);
  }
  if (body.serviceIds !== undefined) {
    steps.push(["incident.setServices", { id, serviceIds: body.serviceIds }, "services"]);
  }
  for (const [fieldId, value] of Object.entries(body.fields ?? {})) {
    steps.push(["incident.setField", { id, fieldId, value }, `field:${fieldId}`]);
  }
  if (body.severity !== undefined) {
    steps.push(["incident.setSeverity", { id, severity: body.severity }, "severity"]);
  }
  if (body.status !== undefined) {
    steps.push(["incident.setStatus", { id, status: body.status }, "status"]);
  }
  for (const [name, args, step] of steps) {
    const result = run(ctx, name, args, [id, step]);
    if (!result.ok && !unchanged(result)) return failure(result);
  }
  const row = ctx.shard.store.get("incidents", id);
  if (!row) return refused("internal");
  return { ok: true, body: { incident: publicIncident(ctx.shard.store, row) } };
}

/** A create's answer: the row it made, read back (on a retry, as it is now). */
function created<R>(
  result: MutationResultMessage,
  row: R | undefined,
  key: string,
  as: (row: R) => unknown = (row) => row,
): RestResult {
  if (!result.ok) return failure(result);
  return row ? { ok: true, body: { [key]: as(row) } } : refused("internal");
}

/** A `PATCH`'s answer: the row as it is now, when the mutation made the change or there was none to make. */
function patched<R>(
  result: MutationResultMessage,
  row: R | undefined,
  key: string,
  as: (row: R) => unknown = (row) => row,
): RestResult {
  if (!result.ok && !unchanged(result)) return failure(result);
  return row ? { ok: true, body: { [key]: as(row) } } : refused("not_found");
}

function createService(ctx: WriteContext, body: ServiceCreateRequest): RestResult {
  const parts = ["service"];
  const id = madeId(ctx, "svc", parts);
  const args = {
    id,
    name: body.name,
    tier: body.tier,
    description: body.description ?? "",
    owners: body.owners ?? [],
    escalationPolicyId: body.escalationPolicyId ?? null,
  };
  const result = run(ctx, "service.create", args, parts);
  return created(result, ctx.shard.store.get("services", id), "service", publicService);
}

function updateService(ctx: WriteContext, id: string, body: ServicePatchRequest): RestResult {
  const current: ServiceRow | undefined = ctx.shard.store.get("services", id);
  if (!current) return refused("not_found");
  const args = {
    id,
    name: body.name ?? current.name,
    tier: body.tier ?? current.tier,
    description: body.description ?? current.description,
    owners: body.owners ?? current.owners,
    escalationPolicyId:
      body.escalationPolicyId === undefined ? current.escalationPolicyId : body.escalationPolicyId,
  };
  const result = run(ctx, "service.update", args, [id, "update"]);
  return patched(result, ctx.shard.store.get("services", id), "service", publicService);
}

function createIncidentType(ctx: WriteContext, body: IncidentTypeCreateRequest): RestResult {
  const parts = ["incidentType"];
  const id = madeId(ctx, "typ", parts);
  const args = {
    id,
    name: body.name,
    description: body.description ?? "",
    defaultSeverity: body.defaultSeverity ?? null,
    escalationPolicyId: body.escalationPolicyId ?? null,
    requiredFields: body.requiredFields ?? [],
    ...(body.roles != null && { roles: body.roles }),
    ...(body.requiredRoles != null && { requiredRoles: body.requiredRoles }),
  };
  const result = run(ctx, "incidentType.create", args, parts);
  return created(
    result,
    ctx.shard.store.get("incident_types", id),
    "incidentType",
    publicIncidentType,
  );
}

function updateIncidentType(
  ctx: WriteContext,
  id: string,
  body: IncidentTypePatchRequest,
): RestResult {
  const current = ctx.shard.store.get("incident_types", id);
  if (!current) return refused("not_found");
  const roles = body.roles ?? current.roles ?? [];
  const args = {
    id,
    name: body.name ?? current.name,
    description: body.description ?? current.description,
    defaultSeverity:
      body.defaultSeverity === undefined ? current.defaultSeverity : body.defaultSeverity,
    escalationPolicyId:
      body.escalationPolicyId === undefined ? current.escalationPolicyId : body.escalationPolicyId,
    requiredFields: body.requiredFields ?? current.requiredFields,
    roles,
    // Roles changed without required ones given: those still listed stay required.
    requiredRoles:
      body.requiredRoles ?? (current.requiredRoles ?? []).filter((role) => roles.includes(role)),
  };
  const result = run(ctx, "incidentType.update", args, [id, "update"]);
  return patched(
    result,
    ctx.shard.store.get("incident_types", id),
    "incidentType",
    publicIncidentType,
  );
}

/** Options as the mutation takes them: an id for each, made here for the new ones (the `n`th of the request). */
function optionsWithIds(
  ctx: WriteContext,
  parts: readonly string[],
  options: readonly { id?: string | undefined; label: string }[],
): FieldOption[] {
  return options.map((option, index) => ({
    id: option.id ?? madeId(ctx, "opt", parts, index + 1),
    label: option.label,
  }));
}

function createCustomField(ctx: WriteContext, body: CustomFieldCreateRequest): RestResult {
  const parts = ["customField"];
  const id = madeId(ctx, "fld", parts);
  const args = {
    id,
    name: body.name,
    kind: body.kind,
    description: body.description ?? "",
    options: optionsWithIds(ctx, parts, body.options ?? []),
  };
  const result = run(ctx, "customField.create", args, parts);
  return created(
    result,
    ctx.shard.store.get("custom_fields", id),
    "customField",
    publicCustomField,
  );
}

function updateCustomField(
  ctx: WriteContext,
  id: string,
  body: CustomFieldPatchRequest,
): RestResult {
  const current: CustomFieldRow | undefined = ctx.shard.store.get("custom_fields", id);
  if (!current) return refused("not_found");
  const parts = [id, "update"];
  const args = {
    id,
    name: body.name ?? current.name,
    description: body.description ?? current.description,
    options: body.options ? optionsWithIds(ctx, parts, body.options) : current.options,
  };
  const result = run(ctx, "customField.update", args, parts);
  return patched(
    result,
    ctx.shard.store.get("custom_fields", id),
    "customField",
    publicCustomField,
  );
}
