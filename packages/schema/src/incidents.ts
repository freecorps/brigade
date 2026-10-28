// The first domain slice: WorkspaceDO's incident index (RFC 0002, 0003). In S3 the index is authoritative for
// status and severity; once IncidentDO exists it owns them and this becomes an outbox-fed projection (RFC 0004).

import { idTime } from "./id.ts";
import { canTransition, INCIDENT_STATUSES, isActive, SEVERITIES } from "./lifecycle.ts";
import type { IncidentRole, IncidentStatus, Severity } from "./lifecycle.ts";
import {
  actingMember,
  defineMutation,
  fail,
  ok,
  type Actor,
  type DomainEvent,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery } from "./query.ts";
import { isBuiltinRole, isLiveRole, isRoleId, roleDefinition, ROLE_ID_MAX } from "./roles.ts";
import type { IncidentRow, TimelineRow, UpdateEdit } from "./tables.ts";
import type { MutationContext } from "./mutation.ts";
import { appendTimeline } from "./timeline.ts";
import { v } from "./validate.ts";

export const INCIDENT_TITLE_MAX = 200;
/** The longest written update, in UTF-16 code units after trimming. */
export const UPDATE_BODY_MAX = 4000;
/** How far into the future of the server's clock the time in a client-made id may be. */
export const ID_CLOCK_SKEW_MS = 10 * 60 * 1000;
/** The severity of a declare that names none and whose type has no default. */
export const DEFAULT_SEVERITY: Severity = "sev3";
/** Services one incident names (RFC 0003 "Service catalog"). */
export const MAX_INCIDENT_SERVICES = 10;

export type IncidentDeclared = DomainEvent<
  "incident.declared",
  Pick<IncidentRow, "id" | "number" | "title" | "severity" | "status">
>;
export type IncidentStatusChanged = DomainEvent<
  "incident.status_changed",
  { from: IncidentStatus; to: IncidentStatus }
>;
/**
 * `reopening`: raised by the alerts' actor as a flapping alert reopens its incident (RFC 0005 "Alert sources"); the
 * reopen right after it pages, at this severity, so this one asks for no page of its own.
 */
/**
 * `escalates`: the raise reached the severity the incident's run did not escalate below (its policy's `minSeverity`,
 * `once` on the run), so it asks for a page that starts a new, full run (RFC 0006 "Who is paged").
 */
export type IncidentSeverityChanged = DomainEvent<
  "incident.severity_changed",
  { from: Severity; to: Severity; reopening?: true; escalates?: true }
>;
/** Someone acknowledged the page: escalation stops (RFC 0003, "Escalation run"). */
export type IncidentAcknowledged = DomainEvent<"incident.acknowledged", { by: string }>;
/** A member wrote an update; `entryId` is its timeline entry. */
export type IncidentUpdatePosted = DomainEvent<
  "incident.update_posted",
  { entryId: string; body: string }
>;
/** Its author edited a written update: `body` is the text now, `previous` the text it replaced. */
export type IncidentUpdateEdited = DomainEvent<
  "incident.update_edited",
  { entryId: string; body: string; previous: string }
>;
/** A written update was removed (its text gone); `author` wrote it, the event's actor removed it. */
export type IncidentUpdateDeleted = DomainEvent<
  "incident.update_deleted",
  { entryId: string; author: string }
>;
/**
 * An incident role changed hands; `to` null: unassigned. `roleId` is the role's id (a built-in's name or a `rol_`
 * id); `role` is the built-in's name, or `custom` for a workspace role, so readers from before role definitions keep
 * reading the built-ins. `roleName`: the workspace's name for it, null for a built-in under its own name. Events from
 * before have `role` only, the built-in's name, which is its id.
 */
export type IncidentRoleAssigned = DomainEvent<
  "incident.role_assigned",
  {
    role: IncidentRole | "custom";
    roleId: string;
    roleName: string | null;
    from: string | null;
    to: string | null;
  }
>;
/** The incident's title changed: `from` the title it had, `to` the one it has now. */
export type IncidentRenamed = DomainEvent<"incident.renamed", { from: string; to: string }>;
export type IncidentEvent =
  | IncidentDeclared
  | IncidentRenamed
  | IncidentStatusChanged
  | IncidentSeverityChanged
  | IncidentAcknowledged
  | IncidentUpdatePosted
  | IncidentUpdateEdited
  | IncidentUpdateDeleted
  | IncidentRoleAssigned;

/** `INC-142`; null while the server has not numbered the incident yet. */
export function formatIncidentNumber(number: number | null): string | null {
  return number === null ? null : `INC-${number}`;
}

/**
 * Stops the incident's escalation run, if one is under way (RFC 0003 "Escalation run"): `acknowledged` by
 * `incident.ack`, `resolved` when the incident leaves the active statuses. In the same transaction as the change, so
 * no level fires after it, whichever route ran the mutation. The timer is server-only; clients only see the run stop.
 * A run that ended on paging everyone (`exhausted`) or on its one page below its policy's severity (`paged_once`) is
 * closed the same way, keeping when it ended: its pages still send while it is the incident's last word, and must not
 * once the incident is reopened.
 */
function stopEscalation(
  store: MutationStore,
  incident: IncidentRow,
  status: "acknowledged" | "resolved",
  ctx: MutationContext,
): void {
  const run = incident.escalation;
  if (!run) return;
  if (run.status === "exhausted" || run.status === "paged_once") {
    store.update("incidents", incident.id, { escalation: { ...run, status } });
    return;
  }
  if (run.status !== "running") return;
  store.update("incidents", incident.id, {
    escalation: { ...run, status, nextAt: null, endedAt: ctx.now },
  });
  if (ctx.server && store.get("escalation_timers", incident.id)) {
    store.delete("escalation_timers", incident.id);
  }
}

/**
 * Lets go of the alerts still firing on an incident that is closing (RFC 0005 "Alert sources"). An alert source's are
 * `closed`, no longer count against the workspace's firing alerts, and their key firing again is a new alert. A
 * monitor's, opened or grouped (RFC 0007 "Monitor alerts through the routes"), resolves and the monitor lets go of it,
 * so a monitor still down alerts again at its next report rather than never until it recovers. Written here rather
 * than in alert-sources.ts or monitors.ts, which build on this module. `alert.resolved` for each (`incident_closed`).
 */
function releaseAlerts(
  store: MutationStore,
  incidentId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const row of store.scan("source_alerts")) {
    if (row.incidentId !== incidentId || row.status !== "firing") continue;
    store.update("source_alerts", row.id, {
      status: "closed",
      resolvedAt: ctx.now,
      updatedAt: ctx.now,
    });
    events.push({
      type: "alert.resolved",
      subject: row.id,
      data: { id: row.id, sourceId: row.sourceId, reason: "incident_closed" },
    });
  }
  for (const row of store.scan("alerts")) {
    if (row.incidentId !== incidentId || row.status !== "firing") continue;
    store.update("alerts", row.id, { status: "resolved", resolvedAt: ctx.now });
    const monitor = store.get("monitors", row.monitorId);
    if (monitor?.alertId === row.id) {
      store.update("monitors", monitor.id, {
        alertId: null,
        incidentId: null,
        ...(monitor.alertRoute ? { alertRoute: null } : {}),
        updatedAt: ctx.now,
      });
    }
    events.push({
      type: "alert.resolved",
      subject: row.id,
      data: { id: row.id, monitorId: row.monitorId, reason: "incident_closed" },
    });
  }
  return events;
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
    // Left out: the type's default severity, else `DEFAULT_SEVERITY`.
    severity: v.optional(v.picklist(SEVERITIES)),
    // RFC 0003 "Incident types", "Service catalog". Left out by clients from before them.
    typeId: v.optional(v.id("typ")),
    serviceIds: v.optional(v.array(v.id("svc"), { max: MAX_INCIDENT_SERVICES, unique: true })),
    // RFC 0006 "Who is paged": a policy picked by hand, first in the order. Left out: none.
    escalationPolicyId: v.optional(v.id("esc")),
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
    // A type, a service or a policy deleted while the declare waited (offline, queued) is left out rather than refused:
    // declaring must not fail on the catalog.
    const type = args.typeId ? store.get("incident_types", args.typeId) : undefined;
    const serviceIds = (args.serviceIds ?? []).filter((id: string) => store.get("services", id));
    const policy = args.escalationPolicyId
      ? store.get("escalation_policies", args.escalationPolicyId)
      : undefined;
    const row: IncidentRow = {
      id: args.id,
      number: ctx.server ? allocateIncidentNumber(store) : null,
      title: args.title,
      severity: args.severity ?? type?.defaultSeverity ?? DEFAULT_SEVERITY,
      status: "triage",
      declaredAt: ctx.now,
      declaredBy: ctx.actor.id,
      acknowledgedAt: null,
      acknowledgedBy: null,
      roles: {},
      timelineSeq: 0,
      ...(type && { typeId: type.id }),
      ...(serviceIds.length > 0 && { serviceIds }),
      ...(policy && { escalationPolicyId: policy.id }),
      updatedAt: ctx.now,
    };
    store.insert("incidents", row);
    appendTimeline(store, row, { kind: "declared", title: row.title, severity: row.severity }, ctx);
    const { id, number, title, severity, status } = row;
    const event: IncidentDeclared = {
      type: "incident.declared",
      subject: id,
      data: { id, number, title, severity, status },
    };
    return ok(event);
  },
});

/**
 * Renames an incident (RFC 0003 "Incident"): a title within the declare's limits, in any status, so a resolved
 * incident can still get a better name for its postmortem. The timeline keeps both titles ("renamed from … to …").
 */
export const renameIncident = defineMutation({
  name: "incident.rename",
  args: v.object({ id: incidentId, title: v.string({ min: 1, max: INCIDENT_TITLE_MAX }) }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    if (incident.title === args.title) return fail("conflict", "The title is already that");
    store.update("incidents", args.id, { title: args.title, updatedAt: ctx.now });
    appendTimeline(store, incident, { kind: "renamed", from: incident.title, to: args.title }, ctx);
    const event: IncidentRenamed = {
      type: "incident.renamed",
      subject: args.id,
      data: { from: incident.title, to: args.title },
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
    // A reopened incident pages again: the ack that stopped the last page must not stop the next one.
    const reopened = !isActive(incident.status) && isActive(args.status);
    store.update("incidents", args.id, {
      status: args.status,
      updatedAt: ctx.now,
      ...(reopened && { acknowledgedAt: null, acknowledgedBy: null }),
    });
    const released = isActive(args.status) ? [] : releaseAlerts(store, args.id, ctx);
    if (!isActive(args.status)) stopEscalation(store, incident, "resolved", ctx);
    appendTimeline(
      store,
      incident,
      { kind: "status_changed", from: incident.status, to: args.status },
      ctx,
    );
    const event: IncidentStatusChanged = {
      type: "incident.status_changed",
      subject: args.id,
      data: { from: incident.status, to: args.status },
    };
    return ok(event, ...released);
  },
});

/**
 * Whether raising `incident` to `severity` reaches the policy's `minSeverity` its run started below (`once`): the run
 * paged once and stopped there, and the raise starts a new, full run (RFC 0006 "Who is paged"). Only while the run is
 * the incident's last word (`paged_once`, or `exhausted` after paging everyone; `running` never has `once` once its
 * start committed): one acknowledged or resolved pages nothing.
 */
function raisesPastOnce(incident: IncidentRow, severity: Severity): boolean {
  const run = incident.escalation;
  if (run?.once === undefined) return false;
  if (run.status === "acknowledged" || run.status === "resolved") return false;
  const rank = (one: Severity) => SEVERITIES.indexOf(one);
  return rank(severity) <= rank(run.once) && rank(incident.severity) > rank(run.once);
}

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
    appendTimeline(
      store,
      incident,
      { kind: "severity_changed", from: incident.severity, to: args.severity },
      ctx,
    );
    const event: IncidentSeverityChanged = {
      type: "incident.severity_changed",
      subject: args.id,
      data: {
        from: incident.severity,
        to: args.severity,
        ...(raisesPastOnce(incident, args.severity) && { escalates: true }),
      },
    };
    return ok(event);
  },
});

/**
 * Acknowledges the incident's page, from the app, a notification or the call screen (RFC 0010). The first ack
 * wins; a second one is a `conflict` (no change), so a responder who acks twice, or two who ack at once, see
 * that someone already did. Pages belong to active incidents only. It stops the escalation run under way (RFC 0003
 * "Escalation run"), whichever route sent it: the app, a notification's action or an HTTP endpoint. Until IncidentDO
 * exists the ack and the run live on the incident.
 */
export const acknowledgeIncident = defineMutation({
  name: "incident.ack",
  args: v.object({ id: incidentId }),
  permission: "incident:ack",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    if (!isActive(incident.status)) {
      return fail("invalid_transition", `Cannot acknowledge a ${incident.status} incident`);
    }
    // `!= null`: rows stored before acknowledgements existed have no such field.
    if (incident.acknowledgedAt != null) return fail("conflict", "Already acknowledged");
    store.update("incidents", args.id, {
      acknowledgedAt: ctx.now,
      acknowledgedBy: ctx.actor.id,
      updatedAt: ctx.now,
    });
    stopEscalation(store, incident, "acknowledged", ctx);
    appendTimeline(store, incident, { kind: "acknowledged" }, ctx);
    const event: IncidentAcknowledged = {
      type: "incident.acknowledged",
      subject: args.id,
      data: { by: ctx.actor.id },
    };
    return ok(event);
  },
});

/**
 * A written update on the incident's timeline (RFC 0003 "Update"): what responders know, for the team and, once
 * status pages exist, for publishing (a separate step then; every update is internal now). Allowed in any status,
 * so a resolved incident can still get its closing notes.
 */
export const postIncidentUpdate = defineMutation({
  name: "incident.postUpdate",
  args: v.object({
    id: incidentId,
    // Joiners between letters, as in names: Persian, Arabic and Indic text needs them.
    body: v.string({ min: 1, max: UPDATE_BODY_MAX, multiline: true, joiners: true }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    store.update("incidents", args.id, { updatedAt: ctx.now });
    const entry = appendTimeline(store, incident, { kind: "update", body: args.body }, ctx);
    const event: IncidentUpdatePosted = {
      type: "incident.update_posted",
      subject: args.id,
      data: { entryId: entry.id, body: args.body },
    };
    return ok(event);
  },
});

/** A timeline entry's id: `<incident id>:<seq>`. */
const entryId = v.string({ min: 1, max: 64 });

/**
 * The written update `entryId` of incident `id`, for an edit or a removal; or why there is none to change: the
 * incident, the entry or an update by that id is missing, or the update was removed already.
 */
function writtenUpdate(
  store: MutationStore,
  id: string,
  entryId: string,
): { ok: true; incident: IncidentRow; entry: UpdateRow } | { ok: false; result: MutationResult } {
  const incident = store.get("incidents", id);
  if (!incident) return { ok: false, result: fail("not_found", "Incident not found") };
  const entry = store.get("timeline", entryId);
  if (!entry || entry.incidentId !== id || entry.kind !== "update") {
    return { ok: false, result: fail("not_found", "Update not found") };
  }
  if (entry.removed) return { ok: false, result: fail("conflict", UPDATE_REMOVED) };
  return { ok: true, incident, entry };
}

type UpdateRow = Extract<TimelineRow, { kind: "update" }>;
/**
 * A patch of an update's own fields, checked against the update entry: the store's patch type (`Omit` over the entry
 * union) keeps only the fields every kind has, so a literal passed to it straight would not be checked.
 */
type UpdatePatch = Partial<Omit<UpdateRow, "id" | "kind">>;

/** `incident.editUpdate`'s and `incident.deleteUpdate`'s refusal of an update removed already. */
export const UPDATE_REMOVED = "Update was removed";

/**
 * Whether the actor wrote `entry`: its member, or an API token (RFC 0014) that posted it or acts for the member who
 * did.
 */
export function wroteUpdate(entry: Pick<TimelineRow, "actor">, actor: Actor): boolean {
  return entry.actor === actor.id || entry.actor === actingMember(actor);
}

/** Whether the actor may remove `entry`: its author, or an owner or admin (anyone's, RFC 0003 "Update"). */
export function mayRemoveUpdate(entry: Pick<TimelineRow, "actor">, actor: Actor): boolean {
  return wroteUpdate(entry, actor) || actor.role === "owner" || actor.role === "admin";
}

/**
 * Edits a written update (RFC 0003 "Update"): only its author, in place, so the entry keeps its number and time and
 * reads "edited". The entry keeps the last edit (when, how many, the text it replaced); the event carries both texts.
 * The status page is never touched: what was published there is a copy, corrected on its own (RFC 0012).
 */
export const editIncidentUpdate = defineMutation({
  name: "incident.editUpdate",
  args: v.object({
    id: incidentId,
    entryId,
    body: v.string({ min: 1, max: UPDATE_BODY_MAX, multiline: true, joiners: true }),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const found = writtenUpdate(store, args.id, args.entryId);
    if (!found.ok) return found.result;
    const { entry } = found;
    if (!wroteUpdate(entry, ctx.actor)) {
      return fail("forbidden", "Only its author edits an update");
    }
    if (entry.body === args.body) return fail("conflict", "The update already says that");
    const edited: UpdateEdit = {
      at: ctx.now,
      by: ctx.actor.id,
      count: (entry.edited?.count ?? 0) + 1,
      previous: entry.body,
    };
    const patch: UpdatePatch = { body: args.body, edited };
    store.update("timeline", entry.id, patch);
    store.update("incidents", args.id, { updatedAt: ctx.now });
    const event: IncidentUpdateEdited = {
      type: "incident.update_edited",
      subject: args.id,
      data: { entryId: entry.id, body: args.body, previous: entry.body },
    };
    return ok(event);
  },
});

/**
 * Removes a written update (RFC 0003 "Update"): its author, or an owner or admin. The entry stays where it was as a
 * tombstone ("update removed by …") with its text gone, so the timeline's order never changes; the event names the
 * entry, not the text.
 */
export const deleteIncidentUpdate = defineMutation({
  name: "incident.deleteUpdate",
  args: v.object({ id: incidentId, entryId }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const found = writtenUpdate(store, args.id, args.entryId);
    if (!found.ok) return found.result;
    const { entry } = found;
    if (!mayRemoveUpdate(entry, ctx.actor)) {
      return fail("forbidden", "Only its author, an owner or an admin removes an update");
    }
    const edited = entry.edited && {
      at: entry.edited.at,
      by: entry.edited.by,
      count: entry.edited.count,
    };
    const patch: UpdatePatch = {
      body: "",
      removed: { at: ctx.now, by: ctx.actor.id },
      ...(edited && { edited }),
    };
    store.update("timeline", entry.id, patch);
    store.update("incidents", args.id, { updatedAt: ctx.now });
    const event: IncidentUpdateDeleted = {
      type: "incident.update_deleted",
      subject: args.id,
      data: { entryId: entry.id, author: entry.actor },
    };
    return ok(event);
  },
});

/**
 * Gives an incident role to a member, or takes it away (`userId: null`). `role` is a role id: a built-in's name, as
 * clients from before role definitions send, or a workspace role's `rol_` id (RFC 0003 "Role definitions"). Giving
 * it needs a role the workspace offers (not deleted, nor a removed built-in); taking it away works for any role
 * someone holds. The member must be in the shard's member list (`members`, RFC 0003) and hold a role that may run
 * incidents: viewers only read. On a client the checks run over the rows it holds, so the picker subscribes to them.
 */
export const assignIncidentRole = defineMutation({
  name: "incident.assignRole",
  args: v.object({
    id: incidentId,
    role: v.string({ min: 1, max: ROLE_ID_MAX }),
    // Better Auth user ids (`usr_<ULID>`), or the local dev actor's; membership is the real check.
    userId: v.nullable(v.string({ min: 1, max: 64 })),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const incident = store.get("incidents", args.id);
    if (!incident) return fail("not_found", "Incident not found");
    const role: string = args.role;
    if (!isRoleId(role)) {
      return fail("invalid_args", "Not a role id", [{ path: "role", message: "Not a role id" }]);
    }
    const userId: string | null = args.userId;
    const roles = { ...incident.roles };
    const from = roles[role] ?? null;
    if (from === userId) {
      return fail("conflict", userId ? "Already holds the role" : "Nobody holds the role");
    }
    const definition = roleDefinition(store.scan("incident_roles"), role);
    if (userId !== null) {
      if (!isLiveRole(definition)) {
        const message = "Role not found";
        return fail("invalid_args", message, [{ path: "role", message }]);
      }
      const member = store.get("members", userId);
      // `invalid_args`, not `not_found` or `forbidden`: the incident exists and the actor may assign; the
      // choice of member is what is wrong.
      if (!member || member.role === "viewer") {
        const message = member ? "Viewers cannot hold incident roles" : "Not a member";
        return fail("invalid_args", message, [{ path: "userId", message }]);
      }
      roles[role] = userId;
    } else {
      delete roles[role];
    }
    store.update("incidents", args.id, { roles, updatedAt: ctx.now });
    // By the name it has now, so the entry still reads once the role is renamed or deleted.
    const roleName = definition?.name ?? null;
    appendTimeline(
      store,
      incident,
      { kind: "role_assigned", role, ...(roleName !== null && { roleName }), from, to: userId },
      ctx,
    );
    const event: IncidentRoleAssigned = {
      type: "incident.role_assigned",
      subject: args.id,
      data: {
        role: isBuiltinRole(role) ? role : "custom",
        roleId: role,
        roleName,
        from,
        to: userId,
      },
    };
    return ok(event);
  },
});

/** Newest first; ids break ties so every replica orders equal timestamps the same way. */
const newestFirst = (a: IncidentRow, b: IncidentRow) =>
  b.declaredAt - a.declaredAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Most severe first (SEV1 on top), then newest first: defined here so every client lists them alike. */
const mostSevereFirst = (a: IncidentRow, b: IncidentRow) =>
  SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || newestFirst(a, b);

export const activeIncidents = defineQuery({
  name: "incidents.active",
  args: v.object({}),
  permission: "incident:read",
  table: "incidents",
  filter: (row) => isActive(row.status),
  sort: mostSevereFirst,
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

/** The incident numbered `INC-<number>`: how the dashboard's incident page addresses it. */
export const incidentByNumber = defineQuery({
  name: "incident.byNumber",
  args: v.object({ number: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) }),
  permission: "incident:read",
  table: "incidents",
  filter: (row, args) => row.number === args.number,
});
