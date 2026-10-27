// Monitor alerts through the alert routes (RFC 0007 "Monitor alerts through the routes"): a monitor that turns down
// is matched against the workspace's ordered routes like an alert source's alert, and the route's action applies.
// A monitor matches only a route that names it or every monitor (`ROUTE_ALL_MONITORS`), so routes saved before this
// never catch one; with no route matching, and whenever a route's action cannot be carried out, the monitor opens its
// incident exactly as it always has. Everything stays in the workspace shard (RFC 0007 "`AlertGroupDO` (later)").

import type { Role } from "./access.ts";
import { ALERT_TITLE_MAX, type AlertSeverity, type NormalizedAlert } from "./alert-normalize.ts";
import {
  ALERTS_ACTOR,
  CAPACITY_TITLE,
  groupIncident,
  MAX_ALERT_ROWS,
  MAX_OPEN_ALERTS,
  orderedRoutes,
  pickRoute,
  pruneSourceAlerts,
  raiseIncident,
  rerouteSourceAlert,
  ROUTE_LOUDNESS,
  routeIncident,
  runIncidentMutation,
  targetSeverity,
} from "./alert-sources.ts";
import { INCIDENT_TITLE_MAX } from "./incidents.ts";
import type { Severity } from "./lifecycle.ts";
import {
  defineMutation,
  fail,
  ok,
  type Actor,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import type { AlertRouteRow, AlertRow, MonitorRow, RouteAction } from "./tables.ts";
import { v } from "./validate.ts";

/** The severity of the incident a monitor opens, unless it names its own (`MonitorRow.severity`). */
export const MONITOR_INCIDENT_SEVERITY: Severity = "sev2";

/**
 * Who runs monitor reports and the incidents they open (RFC 0004 "Server-side writes"): a system actor that
 * carries a role like any other, here `admin` (manage monitors, declare incidents). Server-only mutations are
 * reachable only from the shard's own code, never from a socket, so the role grants a member nothing new.
 */
export const MONITOR_ACTOR: Actor = {
  kind: "system",
  id: "sys_monitors",
  role: "admin" satisfies Role,
};

/** The alert severity a monitor's alert is routed with, from the severity of the incident it opens. */
export const MONITOR_ALERT_SEVERITY: Record<Severity, AlertSeverity> = {
  sev1: "critical",
  sev2: "high",
  sev3: "warning",
  sev4: "info",
};

/** What a monitor routed through a route was: the dashboard's summary on the monitor row. */
export type MonitorAlertOutcome = NonNullable<AlertRow["outcome"]>;

/**
 * A monitor's alert fired. `incidentId` is null when a route suppressed it; `outcome`, `routeId` and `reason` are
 * there only when a route took it (absent: it opened its incident as monitors always have).
 */
export type AlertFired = DomainEvent<
  "alert.fired",
  {
    id: string;
    fingerprint: string;
    monitorId: string;
    incidentId: string | null;
    outcome?: Exclude<MonitorAlertOutcome, "dropped">;
    routeId?: string;
    reason?: "matched";
  }
>;
/** A route dropped a monitor's alert: recorded, never paged. */
export type MonitorAlertDropped = DomainEvent<
  "alert.dropped",
  { id: string; fingerprint: string; monitorId: string; routeId: string; routeName: string }
>;
/**
 * A monitor's alert stopped firing: it recovered, was paused or deleted, or (`rerouted`) a quiet one was routed
 * again into a new alert because the routes changed.
 */
export type AlertResolved = DomainEvent<
  "alert.resolved",
  { id: string; monitorId: string; reason: "recovered" | "paused" | "deleted" | "rerouted" }
>;

/** What the shard makes for a monitor that may open an incident: ids and the title (mutations make neither). */
export type MonitorOpen = { alertId: string; incidentId: string; title: string };

/**
 * The alert a monitor's routes match: its severity (`MONITOR_ALERT_SEVERITY`, from the monitor's own) and the labels
 * `monitor` (its name) and `kind` (`http`, `tcp` or `heartbeat`).
 */
export function monitorAlert(
  monitor: Pick<MonitorRow, "id" | "name" | "kind" | "severity">,
  title: string,
): NormalizedAlert {
  return {
    dedupKey: `monitor:${monitor.id}`,
    title,
    severity: MONITOR_ALERT_SEVERITY[monitor.severity ?? MONITOR_INCIDENT_SEVERITY],
    status: "firing",
    link: null,
    labels: { monitor: monitor.name, kind: monitor.kind },
  };
}

/** The monitor row's fields a fired alert sets. */
type MonitorPatch = Pick<MonitorRow, "alertId" | "incidentId"> &
  Pick<Partial<MonitorRow>, "alertRoute">;

type Fired = { events: DomainEvent[]; patch: MonitorPatch } | { failed: MutationResult };

/**
 * Fires `monitor`'s alert through the routes, in the caller's transaction (`monitor.report`, `monitor.evaluate`,
 * `alert.reroute`): the first route that matches decides (`pickRoute`). `open` declares an incident with the route's
 * severity (else its type's, else the monitor's), type and services, and keeps the route with it (`incident_routes`)
 * so its policy pages first, then the type's, the first service's, the monitor's, the default (RFC 0006 "Who is
 * paged"). `group` joins the open incident of its group key, from an alert source's alert or a monitor's, else opens
 * one. `suppress` and `drop` record the alert with no incident.
 *
 * No route matching opens the incident exactly as before routes: the monitor's severity, no type, no services, paged
 * through the monitor's policy, else the default. A routed declare that fails falls back to that (a deleted type or
 * service is already left out by `incident.declare`, and a deleted policy was taken off the route), and only when
 * that fails too does the caller's mutation fail, so the probe sends its report again.
 */
export function fireMonitorAlert(
  store: MutationStore,
  monitor: MonitorRow,
  open: MonitorOpen,
  ctx: MutationContext,
): Fired {
  const alert = monitorAlert(monitor, open.title);
  const { route, action } = pickRoute(orderedRoutes(store), monitor.id, alert, false);
  if (route) {
    const routed = fireRouted(store, monitor, alert, route, action, open, ctx);
    if (routed) return routed;
  }
  return fireDefault(store, monitor, open, ctx);
}

/** Today's path, unchanged: the incident at the monitor's severity, no route kept with it. */
function fireDefault(
  store: MutationStore,
  monitor: MonitorRow,
  open: MonitorOpen,
  ctx: MutationContext,
): Fired {
  const fingerprint = `monitor:${monitor.id}`;
  const declared = runIncidentMutation(
    store,
    "incident.declare",
    {
      id: open.incidentId,
      title: open.title,
      severity: monitor.severity ?? MONITOR_INCIDENT_SEVERITY,
    },
    ctx,
  );
  // Without its incident the alert would page nobody: fail the report, and the probe sends it again.
  if (!declared.ok) return { failed: declared };
  store.insert("alerts", {
    id: open.alertId,
    fingerprint,
    monitorId: monitor.id,
    status: "firing",
    firedAt: ctx.now,
    resolvedAt: null,
    incidentId: open.incidentId,
  });
  const fired: AlertFired = {
    type: "alert.fired",
    subject: open.alertId,
    data: { id: open.alertId, fingerprint, monitorId: monitor.id, incidentId: open.incidentId },
  };
  return {
    // The incident first: a consumer that sees the alert can already find what it points at.
    events: [...declared.events, fired],
    patch: {
      alertId: open.alertId,
      incidentId: open.incidentId,
      ...(monitor.alertRoute ? { alertRoute: null } : {}),
    },
  };
}

/** Through a route that matched; undefined when its declare failed, so the caller falls back to `fireDefault`. */
function fireRouted(
  store: MutationStore,
  monitor: MonitorRow,
  alert: NormalizedAlert,
  route: AlertRouteRow,
  action: RouteAction,
  open: MonitorOpen,
  ctx: MutationContext,
): Fired | undefined {
  const base: AlertRow = {
    id: open.alertId,
    fingerprint: alert.dedupKey,
    monitorId: monitor.id,
    status: "firing",
    firedAt: ctx.now,
    resolvedAt: null,
    incidentId: null,
    routeId: route.id,
    routeName: route.name,
  };
  const done = (row: AlertRow, events: DomainEvent[]): Fired => {
    store.insert("alerts", row);
    return {
      events,
      patch: {
        alertId: row.id,
        incidentId: row.incidentId,
        alertRoute: { id: route.id, name: route.name, outcome: row.outcome! },
      },
    };
  };
  if (action.kind === "drop") {
    const event: MonitorAlertDropped = {
      type: "alert.dropped",
      subject: base.id,
      data: {
        id: base.id,
        fingerprint: base.fingerprint,
        monitorId: monitor.id,
        routeId: route.id,
        routeName: route.name,
      },
    };
    return done({ ...base, outcome: "dropped" }, [event]);
  }
  if (action.kind === "suppress") {
    const row: AlertRow = { ...base, outcome: "suppressed" };
    return done(row, [firedEvent(row)]);
  }
  const severity = targetSeverity(store, action, alert);
  const groupKey =
    action.kind === "group" ? `${route.id}:${alert.labels[action.groupBy] ?? ""}` : null;
  const holder = groupKey === null ? undefined : groupIncident(store, groupKey);
  if (holder) {
    const row: AlertRow = { ...base, outcome: "grouped", groupKey, incidentId: holder };
    // A SEV1 monitor joining a group of warnings raises the group's incident, which pages again.
    return done(row, [firedEvent(row), ...raiseIncident(store, holder, severity, ctx)]);
  }
  // A type or service deleted since the route was saved is left out by `incident.declare` itself.
  const declared = runIncidentMutation(
    store,
    "incident.declare",
    {
      id: open.incidentId,
      title: open.title,
      severity,
      ...(action.typeId && { typeId: action.typeId }),
      ...(action.serviceIds.length > 0 && { serviceIds: action.serviceIds }),
    },
    ctx,
  );
  if (!declared.ok) return undefined;
  routeIncident(store, open.incidentId, route, action.policyId, ctx);
  const row: AlertRow = { ...base, outcome: "opened", groupKey, incidentId: open.incidentId };
  return done(row, [...declared.events, firedEvent(row)]);
}

function firedEvent(row: AlertRow): AlertFired {
  return {
    type: "alert.fired",
    subject: row.id,
    data: {
      id: row.id,
      fingerprint: row.fingerprint,
      monitorId: row.monitorId,
      incidentId: row.incidentId,
      outcome: row.outcome as Exclude<MonitorAlertOutcome, "dropped">,
      ...(row.routeId && { routeId: row.routeId }),
      reason: "matched",
    },
  };
}

/** The quiet monitor alerts `alert.reroute` would look at: suppressed or dropped, still firing. */
export function quietMonitorAlerts(store: Pick<MutationStore, "scan">): AlertRow[] {
  return store
    .scan("alerts")
    .filter(
      (row) =>
        row.status === "firing" && (row.outcome === "suppressed" || row.outcome === "dropped"),
    );
}

/**
 * The quiet monitor alerts the routes would now do something louder with (`rerouteMonitorAlert` would fire them
 * again): what the shard's alarm checks, so a reroute that failed right after the routes changed is retried.
 */
export function monitorAlertsToReroute(store: Pick<MutationStore, "scan" | "get">): AlertRow[] {
  const routes = orderedRoutes(store);
  return quietMonitorAlerts(store).filter((row) => {
    const monitor = store.get("monitors", row.monitorId);
    if (!monitor || monitor.paused || monitor.alertId !== row.id) return false;
    const { action } = pickRoute(routes, monitor.id, monitorAlert(monitor, monitor.name), false);
    return ROUTE_LOUDNESS[action.kind] > ROUTE_LOUDNESS[row.outcome!];
  });
}

/**
 * Routes a quiet monitor alert again: when the routes now do something louder with it (the suppress or drop route
 * that kept it quiet deleted, changed, moved below another, or disabled), it is resolved as `rerouted` and the monitor
 * fires a new alert through them, which pages. Monitors never send again while down, so without this a deleted
 * suppress route would leave a down monitor unpaged until it recovered. Undefined when it stays as it is (no longer
 * the monitor's firing alert, the monitor paused, deleted or no longer down, or the routes as quiet as before).
 */
function rerouteMonitorAlert(
  store: MutationStore,
  row: AlertRow,
  open: MonitorOpen,
  routes: readonly AlertRouteRow[],
  ctx: MutationContext,
): Fired | undefined {
  if (row.status !== "firing" || !row.outcome || ROUTE_LOUDNESS[row.outcome] >= ROUTE_LOUDNESS.open)
    return undefined;
  const monitor = store.get("monitors", row.monitorId);
  if (!monitor || monitor.paused || monitor.alertId !== row.id) return undefined;
  const { action } = pickRoute(routes, monitor.id, monitorAlert(monitor, open.title), false);
  if (ROUTE_LOUDNESS[action.kind] <= ROUTE_LOUDNESS[row.outcome]) return undefined;
  store.update("alerts", row.id, { status: "resolved", resolvedAt: ctx.now });
  const resolved: AlertResolved = {
    type: "alert.resolved",
    subject: row.id,
    data: { id: row.id, monitorId: monitor.id, reason: "rerouted" },
  };
  // Declared as the monitors, as any incident a monitor opens.
  const fired = fireMonitorAlert(store, monitor, open, { ...ctx, actor: MONITOR_ACTOR });
  if ("failed" in fired) return fired;
  store.update("monitors", monitor.id, { ...fired.patch, updatedAt: ctx.now });
  return { events: [resolved, ...fired.events], patch: fired.patch };
}

/** One quiet row to route again, with the ids the shard made in case it opens (and a monitor's incident title). */
const rerouteItem = v.object({
  rowId: v.id("alt"),
  alertId: v.id("alt"),
  incidentId: v.id("inc"),
  // A monitor's alert: the title of the incident it would open, which the shard renders (mutations render no text).
  title: v.optional(v.string({ min: 1, max: INCIDENT_TITLE_MAX })),
});

/**
 * Server only, as `ALERTS_ACTOR`, right after the routes changed (created, changed, moved, deleted or disabled by a
 * takeover): every suppressed or dropped alert still firing, an alert source's or a monitor's, is routed again, and
 * becomes a new alert where the routes now do something louder with it, so deleting the route that suppressed an
 * alert pages it now rather than at its next repeat (or, for a monitor, which never repeats, not until it recovers).
 * Rows already routed again, or no longer firing, are skipped; none to route is a `conflict`. The shard runs it with
 * the ids; if it fails, an alert source's next repeat routes it again anyway.
 */
export const rerouteAlerts = defineMutation({
  name: "alert.reroute",
  args: v.object({
    rows: v.array(rerouteItem, { max: MAX_OPEN_ALERTS + MAX_ALERT_ROWS }),
    capacityTitle: v.optional(v.string({ min: 1, max: ALERT_TITLE_MAX })),
  }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    if (ctx.actor.id !== ALERTS_ACTOR.id) return fail("forbidden", "Only the alert intake routes");
    const routes = orderedRoutes(store);
    const events: DomainEvent[] = [];
    for (const { rowId, alertId, incidentId, title } of args.rows) {
      const source = store.get("source_alerts", rowId);
      const monitorRow = source ? undefined : store.get("alerts", rowId);
      const ids = { alertId, incidentId };
      const routed = source
        ? rerouteSourceAlert(store, source, ids, routes, args.capacityTitle ?? CAPACITY_TITLE, ctx)
        : monitorRow
          ? rerouteMonitorAlert(
              store,
              monitorRow,
              {
                ...ids,
                title: title ?? store.get("monitors", monitorRow.monitorId)?.name ?? rowId,
              },
              routes,
              ctx,
            )
          : undefined;
      if (!routed) continue;
      if ("failed" in routed) return routed.failed;
      events.push(...routed.events);
    }
    if (events.length === 0) return fail("conflict", "Nothing to route again");
    pruneSourceAlerts(store);
    return ok(...events);
  },
});
