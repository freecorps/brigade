// The first domain slice: WorkspaceDO's incident index (RFC 0002, 0003). In S3 the index is authoritative for
// status and severity; once IncidentDO exists it owns them and this becomes an outbox-fed projection (RFC 0004).

import { idTime } from "./id.ts";
import { canTransition, INCIDENT_STATUSES, isActive, SEVERITIES } from "./lifecycle.ts";
import type { IncidentStatus, Severity } from "./lifecycle.ts";
import {
  defineMutation,
  defineRegistry,
  fail,
  ok,
  type DomainEvent,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import type { IncidentRow } from "./tables.ts";
import { v } from "./validate.ts";

export const INCIDENT_TITLE_MAX = 200;
/** How far into the future of the server's clock the time in a client-made id may be. */
export const ID_CLOCK_SKEW_MS = 10 * 60 * 1000;

export type IncidentDeclared = DomainEvent<
  "incident.declared",
  Pick<IncidentRow, "id" | "number" | "title" | "severity" | "status">
>;
export type IncidentStatusChanged = DomainEvent<
  "incident.status_changed",
  { from: IncidentStatus; to: IncidentStatus }
>;
export type IncidentSeverityChanged = DomainEvent<
  "incident.severity_changed",
  { from: Severity; to: Severity }
>;
export type IncidentEvent = IncidentDeclared | IncidentStatusChanged | IncidentSeverityChanged;

/** `INC-142`; null while the server has not numbered the incident yet. */
export function formatIncidentNumber(number: number | null): string | null {
  return number === null ? null : `INC-${number}`;
}

/** Server only: the next per-workspace incident number, written in the same transaction as the incident. */
export function allocateIncidentNumber(store: MutationStore): number {
  const counter = store.get("counters", "incident");
  const value = (counter?.value ?? 0) + 1;
  if (counter) store.update("counters", "incident", { value });
  else store.insert("counters", { id: "incident", value });
  return value;
}

const incidentId = v.id("inc");

export const declareIncident = defineMutation({
  name: "incident.declare",
  args: v.object({
    id: incidentId,
    title: v.string({ min: 1, max: INCIDENT_TITLE_MAX }),
    severity: v.picklist(SEVERITIES),
  }),
  permission: "incident:declare",
  apply(store, args, ctx) {
    // Ids come from clients. Any past time is fine: a declare queued on an offline phone must never fail.
    // Only ids dated well into the future are refused, so a bad clock cannot pin an incident above newer ones.
    if (ctx.server && idTime(args.id) - ctx.now > ID_CLOCK_SKEW_MS) {
      return fail("invalid_args", "Incident id time is ahead of the server clock", [
        { path: "id", message: "Id time is too far in the future" },
      ]);
    }
    if (store.get("incidents", args.id)) return fail("conflict", "Incident already exists");
    const row: IncidentRow = {
      id: args.id,
      number: ctx.server ? allocateIncidentNumber(store) : null,
      title: args.title,
      severity: args.severity,
      status: "triage",
      declaredAt: ctx.now,
      declaredBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("incidents", row);
    const { id, number, title, severity, status } = row;
    const event: IncidentDeclared = {
      type: "incident.declared",
      subject: id,
      data: { id, number, title, severity, status },
    };
    return ok(event);
  },
});

export const setIncidentStatus = defineMutation({
  name: "incident.setStatus",
  args: v.object({ id: incidentId, status: v.picklist(INCIDENT_STATUSES) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    // No change is a `conflict` (as for severity): every successful mutation emits an event (RFC 0005).
    if (incident.status === args.status)
      return fail("conflict", `Status is already ${args.status}`);
    if (!canTransition(incident.status, args.status)) {
      return fail("invalid_transition", `Cannot move from ${incident.status} to ${args.status}`);
    }
    store.update("incidents", args.id, { status: args.status, updatedAt: ctx.now });
    const event: IncidentStatusChanged = {
      type: "incident.status_changed",
      subject: args.id,
      data: { from: incident.status, to: args.status },
    };
    return ok(event);
  },
});

export const setIncidentSeverity = defineMutation({
  name: "incident.setSeverity",
  args: v.object({ id: incidentId, severity: v.picklist(SEVERITIES) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    if (incident.severity === args.severity) {
      return fail("conflict", `Severity is already ${args.severity}`);
    }
    store.update("incidents", args.id, { severity: args.severity, updatedAt: ctx.now });
    const event: IncidentSeverityChanged = {
      type: "incident.severity_changed",
      subject: args.id,
      data: { from: incident.severity, to: args.severity },
    };
    return ok(event);
  },
});

/** Newest first; ids break ties so every replica orders equal timestamps the same way. */
const newestFirst = (a: IncidentRow, b: IncidentRow) =>
  b.declaredAt - a.declaredAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

export const activeIncidents = defineQuery({
  name: "incidents.active",
  args: v.object({}),
  permission: "incident:read",
  table: "incidents",
  filter: (row) => isActive(row.status),
  sort: newestFirst,
});

export const incidentById = defineQuery({
  name: "incident.byId",
  args: v.object({ id: incidentId }),
  permission: "incident:read",
  table: "incidents",
  // `key` reads the row directly; `filter` still tells the server whether a changed row belongs here.
  key: (args) => args.id,
  filter: (row, args) => row.id === args.id,
});

export const mutations = defineRegistry([declareIncident, setIncidentStatus, setIncidentSeverity]);
export const queries = defineRegistry([activeIncidents, incidentById]);
