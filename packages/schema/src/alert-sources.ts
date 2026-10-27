// Alert sources and alert routes (RFC 0005 "Alert sources", RFC 0003 "Alert → incident flow"): inbound webhooks from
// Grafana, Datadog, Sentry or anything that speaks Brigade's generic shape, normalized (alert-normalize.ts), matched
// against the workspace's ordered routes and turned into incidents through `incident.declare`, run as the alerts'
// system actor. Everything lives in the workspace shard for now, with caps per workspace; an `AlertGroupDO` per
// fingerprint is later work (RFC 0007).

import type { Role } from "./access.ts";
import {
  applyMapping,
  MAX_SEVERITY_RULES,
  parseTemplate,
  SEVERITY_FIELDS,
  SEVERITY_VALUE_MAX,
  TITLE_TEMPLATE_MAX,
  type AlertMapping,
  type SeverityMapping,
  type TemplateProblem,
} from "./alert-mapping.ts";
import {
  ALERT_AT_MAX,
  ALERT_AT_MIN,
  ALERT_KEY_MAX,
  ALERT_LABEL_KEY_MAX,
  ALERT_LABEL_VALUE_MAX,
  ALERT_LABELS_MAX,
  ALERT_LINK_MAX,
  ALERT_SEVERITIES,
  ALERT_SOURCE_KINDS,
  ALERT_TITLE_MAX,
  MAX_ALERTS_PER_PAYLOAD,
  PROVIDER_SEVERITY_MAX,
  type AlertSeverity,
  type NormalizedAlert,
} from "./alert-normalize.ts";
import { ACCOUNT_ACTOR } from "./devices.ts";
import { idTime, isId } from "./id.ts";
import {
  declareIncident,
  ID_CLOCK_SKEW_MS,
  MAX_INCIDENT_SERVICES,
  setIncidentSeverity,
  setIncidentStatus,
  type IncidentSeverityChanged,
} from "./incidents.ts";
import { isActive, SEVERITIES, type Severity } from "./lifecycle.ts";
import {
  defineMutation,
  defineRegistry,
  fail,
  ok,
  runMutation,
  type Actor,
  type DomainEvent,
  type MutationContext,
  type MutationResult,
  type MutationStore,
} from "./mutation.ts";
import { defineQuery, prefixRange } from "./query.ts";
import type {
  AlertResolveMarkerRow,
  AlertRouteRow,
  AlertSourceRow,
  IncidentRouteRow,
  IncidentRow,
  RouteAction,
  RouteMatch,
  SourceAlertRow,
} from "./tables.ts";
import { appendTimeline } from "./timeline.ts";
import { v, type Issue, type Validator } from "./validate.ts";

/** Incidents alert sources open are declared by this system actor (RFC 0004 "Server-side writes"). */
export const ALERTS_ACTOR: Actor = {
  kind: "system",
  id: "sys_alerts",
  role: "admin" satisfies Role,
};

export const ALERT_SOURCE_NAME_MAX = 80;
export const ALERT_ROUTE_NAME_MAX = 80;
export const MAX_ALERT_SOURCES = 20;
export const MAX_ALERT_ROUTES = 50;
/**
 * Alerts firing at once (dropped ones and the capacity alert aside). Past it a new alert is never refused: the oldest
 * suppressed one is let go, else the new one pages as the single "alert capacity reached" alert (`alert.ingest`).
 */
export const MAX_OPEN_ALERTS = 200;
/** Alert rows kept for the dashboard; past it the oldest resolved and closed (then dropped) ones are deleted. */
export const MAX_ALERT_ROWS = 300;
/** A suppressed or dropped alert not sent again for this long expires (`closed`): 24 hours. */
export const ALERT_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
/** A key firing again this soon after its incident resolved by itself reopens that incident: 10 minutes. */
export const FLAP_WINDOW_MS = 10 * 60 * 1000;
/**
 * A resolve that came before its firing is remembered this long, so the late firing opens nothing: 5 minutes, the
 * span a sender's retries realistically reorder two notifications by. Kept short because a firing whose own first
 * delivery never reached Brigade (too large, given up on, an outage, a source created mid-alert) also leaves a
 * resolve with no row, and a real firing after it must not be held back for long.
 */
export const EARLY_RESOLVE_TTL_MS = 5 * 60 * 1000;
/** Early resolves remembered at once; past it the oldest is forgotten. */
export const MAX_RESOLVE_MARKERS = 200;
/** The capacity alert's title when the shard gives none (it gives the workspace's language). */
export const CAPACITY_TITLE = "Alert capacity reached";
/** The capacity alert's key; it is told apart by its `reason`, `capacity`, which no sender can give. */
export const CAPACITY_KEY = "capacity";
/** Alert sources a route may name (`src_…` ids, or every source), counted apart from its monitors. */
export const MAX_ROUTE_SOURCES = 20;
/**
 * Monitors a route may name one by one: the instance's default monitor cap (`MAX_MONITORS_PER_WORKSPACE`), so a route
 * can name every monitor of a workspace at the default. A workspace allowed more names them all as every monitor.
 */
export const MAX_ROUTE_MONITORS = 100;
/**
 * In a route's `sourceIds`: every monitor (RFC 0007 "Monitor alerts through the routes"). A monitor matches only a
 * route that names it or this, so routes that name no monitor never catch one.
 */
export const ROUTE_ALL_MONITORS = "monitors";
/**
 * In a route's `sourceIds`: every alert source, said explicitly, for a route that also names monitors (an empty list
 * is every source too, but a list naming only monitors takes no source). See `routeMatches`.
 */
export const ROUTE_ALL_SOURCES = "sources";
export const MAX_ROUTE_LABELS = 10;
/** A source's `lastReceivedAt` moves at most this often, so a storm does not make a shard version a payload. */
export const SOURCE_SEEN_EVERY_MS = 60_000;

/** The incident severity an alert opens with when its route names none (the default route included). */
export const ALERT_INCIDENT_SEVERITY: Record<AlertSeverity, Severity> = {
  critical: "sev1",
  high: "sev2",
  warning: "sev3",
  info: "sev4",
};

/**
 * `resolved_early`: a firing that came after its own resolve (`EARLY_RESOLVE_TTL_MS`), so it opened nothing; recorded,
 * already resolved, so the dashboard shows it rather than nothing.
 */
export type AlertOutcome = "opened" | "grouped" | "suppressed" | "dropped" | "resolved_early";
/**
 * Why the outcome: a route `matched`, none did (`default`), the payload was `malformed` (straight to default), or
 * there was no room for it and it stands in the capacity alert (`capacity`, straight to default).
 */
export type AlertRouteReason = "matched" | "default" | "malformed" | "capacity";

// ---- Validation --------------------------------------------------------------------------------------------------

const sourceId = v.id("src");
const routeId = v.id("rte");
const policyRef = v.nullable(v.id("esc"));

/** A SHA-256 digest in lower-case hex: a token's or a header value's hash, never the value. */
const sha256Hex: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[0-9a-f]{64}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a SHA-256 digest in hex" }] };

/** Headers a source may not use for its secret: ones the transport or a provider's signature owns. */
const RESERVED_HEADERS = new Set([
  "host",
  "content-type",
  "content-length",
  "cookie",
  "user-agent",
  "cf-connecting-ip",
  "x-forwarded-for",
]);

/** An HTTP header name, stored lower-cased. */
const headerName: Validator<string> = (input, path = "") => {
  if (typeof input !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(input)) {
    return { ok: false, issues: [{ path, message: "Expected a header name" }] };
  }
  const name = input.toLowerCase();
  if (RESERVED_HEADERS.has(name) || name.startsWith("sentry-hook-") || name.startsWith("cf-")) {
    return { ok: false, issues: [{ path, message: "This header cannot carry the secret" }] };
  }
  return { ok: true, value: name };
};

/** A provider's signing secret (Sentry's client secret, Grafana's HMAC secret): printable ASCII, no spaces. */
const signingSecret: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[\x21-\x7e]{8,256}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected 8 to 256 printable characters" }] };

const headerAuth = v.object({ headerName, headerHash: sha256Hex });

const labelMatch = v.object({
  key: v.string({ min: 1, max: ALERT_LABEL_KEY_MAX }),
  // Empty: the label is present, whatever its value.
  value: v.string({ max: ALERT_LABEL_VALUE_MAX }),
});

/** Whether a route's `sourceIds` entry names monitors (a monitor, or every monitor) rather than alert sources. */
export const namesMonitor = (id: string): boolean => id === ROUTE_ALL_MONITORS || isId("mon", id);

/** What a route's `sourceIds` may name: an alert source, every source, a monitor, or every monitor. */
const routeSourceId: Validator<string> = (input, path = "") =>
  input === ROUTE_ALL_SOURCES ||
  input === ROUTE_ALL_MONITORS ||
  isId("src", input) ||
  isId("mon", input)
    ? { ok: true, value: input as string }
    : {
        ok: false,
        issues: [
          {
            path,
            message: `Expected an alert source, a monitor, "${ROUTE_ALL_SOURCES}" or "${ROUTE_ALL_MONITORS}"`,
          },
        ],
      };

/** A route's `sourceIds`: at most `MAX_ROUTE_SOURCES` sources and, apart, at most `MAX_ROUTE_MONITORS` monitors. */
const routeSourceIds: Validator<string[]> = (input, path = "") => {
  const result = v.array(routeSourceId, {
    max: MAX_ROUTE_SOURCES + MAX_ROUTE_MONITORS,
    unique: true,
  })(input, path);
  if (!result.ok) return result;
  const monitors = result.value.filter(namesMonitor).length;
  if (result.value.length - monitors > MAX_ROUTE_SOURCES) {
    return { ok: false, issues: [{ path, message: `At most ${MAX_ROUTE_SOURCES} alert sources` }] };
  }
  if (monitors > MAX_ROUTE_MONITORS) {
    return { ok: false, issues: [{ path, message: `At most ${MAX_ROUTE_MONITORS} monitors` }] };
  }
  return result;
};

const routeMatch: Validator<RouteMatch> = (input, path = "") => {
  const result = v.object({
    sourceIds: routeSourceIds,
    severities: v.array(v.picklist(ALERT_SEVERITIES), {
      max: ALERT_SEVERITIES.length,
      unique: true,
    }),
    labels: v.array(labelMatch, { max: MAX_ROUTE_LABELS }),
  })(input, path);
  if (!result.ok) return result;
  // Keys compare lower-cased, as labels are stored.
  return {
    ok: true,
    value: {
      ...result.value,
      labels: result.value.labels.map((one) => ({ key: one.key.toLowerCase(), value: one.value })),
    },
  };
};

/** What an incident a route opens is declared with (RFC 0003 "Incident types", "Service catalog"). */
const incidentFields = {
  // Null: the type's default severity, else the alert's own (`ALERT_INCIDENT_SEVERITY`).
  severity: v.nullable(v.picklist(SEVERITIES)),
  typeId: v.nullable(v.id("typ")),
  serviceIds: v.array(v.id("svc"), { max: MAX_INCIDENT_SERVICES, unique: true }),
  policyId: policyRef,
};
const openAction = v.object({ kind: v.picklist(["open"] as const), ...incidentFields });
const groupAction = v.object({
  kind: v.picklist(["group"] as const),
  // The label whose value groups alerts into one open incident; alerts without it group together.
  groupBy: v.string({ min: 1, max: ALERT_LABEL_KEY_MAX }),
  ...incidentFields,
});
const quietAction = v.object({ kind: v.picklist(["suppress", "drop"] as const) });

const routeAction: Validator<RouteAction> = (input, path = "") => {
  const kind = typeof input === "object" && input !== null ? Reflect.get(input, "kind") : undefined;
  if (kind === "open") return openAction(input, path);
  if (kind === "group") {
    const result = groupAction(input, path);
    return result.ok
      ? { ok: true, value: { ...result.value, groupBy: result.value.groupBy.toLowerCase() } }
      : result;
  }
  if (kind === "suppress" || kind === "drop") return quietAction(input, path);
  return {
    ok: false,
    issues: [
      { path: path ? `${path}.kind` : "kind", message: "Expected open, group, suppress or drop" },
    ],
  };
};

/** Labels as the shard stores them: at most `ALERT_LABELS_MAX` short strings. */
const labelsRecord: Validator<Record<string, string>> = (input, path = "") => {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path, message: "Expected labels" }] };
  }
  const keys = Object.keys(input);
  if (keys.length > ALERT_LABELS_MAX) {
    return {
      ok: false,
      issues: [{ path, message: `Expected at most ${ALERT_LABELS_MAX} labels` }],
    };
  }
  const key = v.string({ min: 1, max: ALERT_LABEL_KEY_MAX });
  const value = v.string({ min: 1, max: ALERT_LABEL_VALUE_MAX });
  const out: Record<string, string> = {};
  for (const name of keys) {
    const k = key(name, path);
    const val = value(Reflect.get(input, name), path);
    if (!k.ok) return k;
    if (!val.ok) return val;
    out[k.value] = val.value;
  }
  return { ok: true, value: out };
};

const linkValue: Validator<string> = (input, path = "") =>
  typeof input === "string" && input.length <= ALERT_LINK_MAX && /^https?:\/\//.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected an http(s) link" }] };

const normalizedAlert = v.object({
  dedupKey: v.string({ min: 1, max: ALERT_KEY_MAX }),
  title: v.string({ min: 1, max: ALERT_TITLE_MAX }),
  severity: v.picklist(ALERT_SEVERITIES),
  status: v.picklist(["firing", "resolved"] as const),
  link: v.nullable(linkValue),
  labels: labelsRecord,
  providerSeverity: v.optional(v.string({ min: 1, max: PROVIDER_SEVERITY_MAX })),
  at: v.optional(v.nullable(v.integer({ min: ALERT_AT_MIN, max: ALERT_AT_MAX }))),
});

const TEMPLATE_PROBLEMS: Record<TemplateProblem, string> = {
  unknown_field: "Use {title}, {severity} or {labels.<key>}",
  unclosed: "A { is never closed",
  stray_brace: "A } closes nothing",
  too_many_fields: "Use at most 10 placeholders",
};

/** A title template: text and `{field}` placeholders that `parseTemplate` reads (alert-mapping.ts). */
const titleTemplate: Validator<string> = (input, path = "") => {
  const result = v.string({ min: 1, max: TITLE_TEMPLATE_MAX })(input, path);
  if (!result.ok) return result;
  const parsed = parseTemplate(result.value);
  return parsed.ok
    ? result
    : { ok: false, issues: [{ path, message: TEMPLATE_PROBLEMS[parsed.problem] }] };
};

const severityRule = v.object({
  value: v.string({ min: 1, max: SEVERITY_VALUE_MAX }),
  severity: v.picklist(ALERT_SEVERITIES),
});

/** A severity map: a label to read when it reads one, each value once (ignoring case). */
const severityMapping: Validator<SeverityMapping> = (input, path = "") => {
  const result = v.object({
    from: v.picklist(SEVERITY_FIELDS),
    label: v.nullable(v.string({ min: 1, max: ALERT_LABEL_KEY_MAX })),
    rules: v.array(severityRule, { max: MAX_SEVERITY_RULES }),
    fallback: v.nullable(v.picklist(ALERT_SEVERITIES)),
  })(input, path);
  if (!result.ok) return result;
  const at = (key: string) => (path ? `${path}.${key}` : key);
  const { from, label, rules, fallback } = result.value;
  if (from === "label" && label === null) {
    return { ok: false, issues: [{ path: at("label"), message: "Name the label to read" }] };
  }
  const seen = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    const value = rule.value.toLowerCase();
    if (seen.has(value)) {
      return {
        ok: false,
        issues: [{ path: at(`rules[${index}].value`), message: "Each value once" }],
      };
    }
    seen.add(value);
  }
  return {
    ok: true,
    value: { from, label: from === "label" ? label!.toLowerCase() : null, rules, fallback },
  };
};

const alertMapping = v.object({
  titleTemplate: v.nullable(titleTemplate),
  severity: v.nullable(severityMapping),
});

function checkNewId(id: string, ctx: MutationContext): MutationResult | undefined {
  if (ctx.server && idTime(id) - ctx.now > ID_CLOCK_SKEW_MS) {
    return fail("invalid_args", "Id time is ahead of the server clock", [
      { path: "id", message: "Id time is too far in the future" },
    ]);
  }
  return undefined;
}

// ---- Events ------------------------------------------------------------------------------------------------------

export type AlertSourceEvent = DomainEvent<
  "alert_source.created" | "alert_source.updated",
  Pick<AlertSourceRow, "id" | "name" | "kind" | "headerName" | "signed">
>;
export type AlertSourceRotated = DomainEvent<"alert_source.rotated", { id: string }>;
/** A source's title and severity mapping changed; `mapping` null: as the sender says again. */
export type AlertSourceMappingChanged = DomainEvent<
  "alert_source.mapping_changed",
  { id: string; mapping: AlertMapping | null }
>;
export type AlertSourceDeleted = DomainEvent<
  "alert_source.deleted",
  { id: string; resolved: number }
>;
export type AlertRouteEvent = DomainEvent<
  "alert_route.created" | "alert_route.updated",
  Pick<AlertRouteRow, "id" | "name" | "position" | "match" | "action"> & {
    /** Changed by Brigade, not a member: its policy was deleted, or a takeover disabled it. */
    reason?: "policy_deleted" | "takeover";
  }
>;
export type AlertRouteMoved = DomainEvent<"alert_route.moved", { id: string; position: number }>;
export type AlertRouteDeleted = DomainEvent<"alert_route.deleted", { id: string }>;
/** An inbound alert fired: what the route did with it (`incidentId` null when suppressed). */
export type SourceAlertFired = DomainEvent<
  "alert.fired",
  {
    id: string;
    fingerprint: string;
    sourceId: string;
    incidentId: string | null;
    outcome: Exclude<AlertOutcome, "dropped" | "resolved_early">;
    routeId: string | null;
    reason: AlertRouteReason;
  }
>;
/** A route dropped an inbound alert: recorded, never paged. */
export type SourceAlertDropped = DomainEvent<
  "alert.dropped",
  { id: string; fingerprint: string; sourceId: string; routeId: string; routeName: string }
>;
export type SourceAlertResolved = DomainEvent<
  "alert.resolved",
  {
    id: string;
    sourceId: string;
    /**
     * The sender resolved it, or its source was deleted; or it was let go (`closed`): its incident was closed, it was
     * not sent for `ALERT_IDLE_TTL_MS` (`expired`), it made room past `MAX_OPEN_ALERTS` (`evicted`), or it was routed
     * again into a new alert (`rerouted`).
     */
    reason: "resolved" | "source_deleted" | "incident_closed" | "expired" | "evicted" | "rerouted";
    /** The incident it was on, resolved with it because every alert on it is resolved now. */
    resolvedIncident?: string;
  }
>;

function sourceEvent(type: AlertSourceEvent["type"], row: AlertSourceRow): AlertSourceEvent {
  return {
    type,
    subject: row.id,
    data: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      headerName: row.headerName,
      signed: row.signed,
    },
  };
}

function routeEvent(
  type: AlertRouteEvent["type"],
  row: AlertRouteRow,
  reason?: AlertRouteEvent["data"]["reason"],
): AlertRouteEvent {
  return {
    type,
    subject: row.id,
    data: {
      id: row.id,
      name: row.name,
      position: row.position,
      match: row.match,
      action: row.action,
      ...(reason && { reason }),
    },
  };
}

// ---- Sources -----------------------------------------------------------------------------------------------------

/**
 * A new alert source. As for a heartbeat (RFC 0007), the client makes the URL's secret, shows the URL once and sends
 * only its SHA-256 (`tokenHash`). `auth`: an optional header the sender must also send (Basic auth is the
 * `authorization` header), by its value's SHA-256. `signingSecret`: the provider's HMAC secret, required for Sentry
 * (its client secret) and optional for Grafana; kept server-only, since verifying needs the secret itself.
 */
export const createAlertSource = defineMutation({
  name: "alertSource.create",
  args: v.object({
    id: sourceId,
    name: v.string({ min: 1, max: ALERT_SOURCE_NAME_MAX }),
    kind: v.picklist(ALERT_SOURCE_KINDS),
    tokenHash: sha256Hex,
    auth: v.nullable(headerAuth),
    signingSecret: v.nullable(signingSecret),
  }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const early = checkNewId(args.id, ctx);
    if (early) return early;
    if (store.get("alert_sources", args.id)) return fail("conflict", "Alert source already exists");
    const issues = signingIssues(args.kind, args.signingSecret);
    if (issues.length) return fail("invalid_args", "Invalid alert source", issues);
    if (store.scan("alert_sources").length >= MAX_ALERT_SOURCES) {
      return fail("limit_reached", `At most ${MAX_ALERT_SOURCES} alert sources per workspace`);
    }
    const row: AlertSourceRow = {
      id: args.id,
      name: args.name,
      kind: args.kind,
      headerName: args.auth?.headerName ?? null,
      signed: args.signingSecret !== null,
      lastReceivedAt: null,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("alert_sources", row);
    // Server only: a client's optimistic store never holds the hashes or the signing secret.
    if (ctx.server) {
      store.insert("alert_source_secrets", {
        id: args.id,
        tokenHash: args.tokenHash,
        headerHash: args.auth?.headerHash ?? null,
        signingSecret: args.signingSecret,
      });
    }
    return ok(sourceEvent("alert_source.created", row));
  },
});

function signingIssues(kind: AlertSourceRow["kind"], secret: string | null): Issue[] {
  if (kind === "sentry" && secret === null) {
    return [
      {
        path: "signingSecret",
        message: "Sentry signs every webhook: its client secret is required",
      },
    ];
  }
  if (secret !== null && kind !== "sentry" && kind !== "grafana") {
    return [{ path: "signingSecret", message: "This kind of source does not sign its webhooks" }];
  }
  return [];
}

/**
 * Renames a source or changes its header or signing secret. `auth` and `signingSecret` left out keep what the
 * source has; null removes them (Sentry's secret cannot be removed).
 */
export const updateAlertSource = defineMutation({
  name: "alertSource.update",
  args: v.object({
    id: sourceId,
    name: v.string({ min: 1, max: ALERT_SOURCE_NAME_MAX }),
    auth: v.omittable(v.nullable(headerAuth)),
    signingSecret: v.omittable(v.nullable(signingSecret)),
  }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const source = store.get("alert_sources", args.id);
    if (!source) return fail("not_found", "Alert source not found");
    if (args.signingSecret !== undefined) {
      const issues = signingIssues(source.kind, args.signingSecret);
      if (issues.length) return fail("invalid_args", "Invalid alert source", issues);
    }
    const headerName =
      args.auth === undefined ? source.headerName : (args.auth?.headerName ?? null);
    const signed = args.signingSecret === undefined ? source.signed : args.signingSecret !== null;
    if (args.name === source.name && args.auth === undefined && args.signingSecret === undefined) {
      return fail("conflict", "Nothing to change");
    }
    if (ctx.server) {
      const secret = store.get("alert_source_secrets", args.id);
      if (secret) {
        store.update("alert_source_secrets", args.id, {
          ...(args.auth !== undefined && { headerHash: args.auth?.headerHash ?? null }),
          ...(args.signingSecret !== undefined && { signingSecret: args.signingSecret }),
        });
      }
    }
    const row = store.update("alert_sources", args.id, {
      name: args.name,
      headerName,
      signed,
      updatedAt: ctx.now,
    });
    return ok(sourceEvent("alert_source.updated", row));
  },
});

/**
 * How a source's alerts are named and how urgent they are (RFC 0005 "Alert sources", "Mapping"): a title template and
 * a severity map, applied to every alert it sends from the next payload on, before the routes see it. A mapping with
 * neither, or null, is the sender's own title and severity again. The alerts already in are left as they are; a quiet
 * one that comes again is mapped and routed again like any repeat.
 */
export const setAlertSourceMapping = defineMutation({
  name: "alertSource.setMapping",
  args: v.object({ id: sourceId, mapping: v.nullable(alertMapping) }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const source = store.get("alert_sources", args.id);
    if (!source) return fail("not_found", "Alert source not found");
    const given = args.mapping;
    const mapping =
      given && (given.titleTemplate !== null || given.severity !== null) ? given : null;
    if (JSON.stringify(source.mapping ?? null) === JSON.stringify(mapping)) {
      return fail("conflict", "Nothing to change");
    }
    store.update("alert_sources", args.id, { mapping, updatedAt: ctx.now });
    const event: AlertSourceMappingChanged = {
      type: "alert_source.mapping_changed",
      subject: args.id,
      data: { id: args.id, mapping },
    };
    return ok(event);
  },
});

/** A new URL: the old one gets the same 404 as any wrong one from the next request. Only the hash is sent. */
export const rotateAlertSource = defineMutation({
  name: "alertSource.rotate",
  args: v.object({ id: sourceId, tokenHash: sha256Hex }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const source = store.get("alert_sources", args.id);
    if (!source) return fail("not_found", "Alert source not found");
    if (ctx.server) {
      const secret = store.get("alert_source_secrets", args.id);
      if (secret?.tokenHash === args.tokenHash) return fail("conflict", "Nothing to change");
      if (secret) store.update("alert_source_secrets", args.id, { tokenHash: args.tokenHash });
      else {
        store.insert("alert_source_secrets", {
          id: args.id,
          tokenHash: args.tokenHash,
          headerHash: null,
          signingSecret: null,
        });
      }
    }
    store.update("alert_sources", args.id, { updatedAt: ctx.now });
    const event: AlertSourceRotated = {
      type: "alert_source.rotated",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/**
 * Deletes a source and its secrets: its URL answers 404 from then on. Its firing alerts resolve (nothing can
 * resolve them any more); the incidents they opened stay for people, as for a deleted monitor. Routes naming it
 * keep its id, which matches nothing: a route scoped to it never widens to every source.
 */
export const deleteAlertSource = defineMutation({
  name: "alertSource.delete",
  args: v.object({ id: sourceId }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const source = store.get("alert_sources", args.id);
    if (!source) return fail("not_found", "Alert source not found");
    const events: DomainEvent[] = [];
    for (const row of store.scan("source_alerts")) {
      if (row.sourceId !== args.id || row.status !== "firing") continue;
      store.update("source_alerts", row.id, {
        status: "resolved",
        resolvedAt: ctx.now,
        updatedAt: ctx.now,
      });
      events.push(resolvedEvent(row, "source_deleted"));
    }
    store.delete("alert_sources", args.id);
    store.delete("alert_source_secrets", args.id);
    const event: AlertSourceDeleted = {
      type: "alert_source.deleted",
      subject: args.id,
      data: { id: args.id, resolved: events.length },
    };
    return ok(event, ...events);
  },
});

export type AlertSourceRevoked = DomainEvent<"alert_source.revoked", { id: string }>;

/**
 * Server only, as `ACCOUNT_ACTOR`: the owner of an address took back an account someone else signed up with, alone in
 * this workspace (RFC 0002 "Auth"). Whoever signed up could keep paging the owner through a source URL they kept, so
 * every source's hash becomes `tokenHash`, random bytes nobody holds a token for, like `monitor.takeOver` does for
 * heartbeats. The owner gives a source a new URL (`alertSource.rotate`). The routes that account (`userId`) created
 * are disabled too (`disabled: "takeover"`): one could drop or suppress what the owner needs paged. Saving one again
 * enables it. Nothing to change is a `conflict`.
 */
export const takeOverAlertSources = defineMutation({
  name: "alertSource.takeOver",
  args: v.object({ tokenHash: sha256Hex, userId: v.optional(v.string({ min: 1, max: 64 })) }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== ACCOUNT_ACTOR.kind || ctx.actor.id !== ACCOUNT_ACTOR.id) {
      return fail("forbidden", "Only the server takes alert sources over");
    }
    const events: DomainEvent[] = [];
    for (const route of store.scan("alert_routes")) {
      if (args.userId === undefined || route.createdBy !== args.userId || route.disabled) continue;
      const row = store.update("alert_routes", route.id, {
        disabled: "takeover",
        updatedAt: ctx.now,
      });
      events.push(routeEvent("alert_route.updated", row, "takeover"));
    }
    for (const secret of store.scan("alert_source_secrets")) {
      if (secret.tokenHash === args.tokenHash) continue;
      store.update("alert_source_secrets", secret.id, { tokenHash: args.tokenHash });
      store.update("alert_sources", secret.id, { updatedAt: ctx.now });
      const event: AlertSourceRevoked = {
        type: "alert_source.revoked",
        subject: secret.id,
        data: { id: secret.id },
      };
      events.push(event);
    }
    if (events.length === 0) return fail("conflict", "Nothing to take over");
    return ok(...events);
  },
});

// ---- Routes ------------------------------------------------------------------------------------------------------

/** A route's policy, type and services must exist when it is saved (`invalid_args` otherwise). */
function routeIssues(store: MutationStore, action: RouteAction): Issue[] {
  if (action.kind !== "open" && action.kind !== "group") return [];
  const issues: Issue[] = [];
  if (action.policyId !== null && !store.get("escalation_policies", action.policyId)) {
    issues.push({ path: "action.policyId", message: "Escalation policy not found" });
  }
  if (action.typeId !== null && !store.get("incident_types", action.typeId)) {
    issues.push({ path: "action.typeId", message: "Incident type not found" });
  }
  action.serviceIds.forEach((id, index) => {
    if (!store.get("services", id)) {
      issues.push({ path: `action.serviceIds[${index}]`, message: "Service not found" });
    }
  });
  return issues;
}

/** Routes in the order they are tried. */
export function orderedRoutes(store: Pick<MutationStore, "scan">): AlertRouteRow[] {
  return [...store.scan("alert_routes")].sort(byPosition);
}

const byPosition = (a: AlertRouteRow, b: AlertRouteRow) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Positions 0, 1, 2… in `order`, writing only the rows that moved. */
function renumber(store: MutationStore, order: AlertRouteRow[], ctx: MutationContext): void {
  order.forEach((row, index) => {
    if (row.position !== index)
      store.update("alert_routes", row.id, { position: index, updatedAt: ctx.now });
  });
}

const routeFields = {
  name: v.string({ min: 1, max: ALERT_ROUTE_NAME_MAX }),
  match: routeMatch,
  action: routeAction,
};

/** A new route, tried after the existing ones. */
export const createAlertRoute = defineMutation({
  name: "alertRoute.create",
  args: v.object({ id: routeId, ...routeFields }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const early = checkNewId(args.id, ctx);
    if (early) return early;
    if (store.get("alert_routes", args.id)) return fail("conflict", "Alert route already exists");
    const issues = routeIssues(store, args.action);
    if (issues.length) return fail("invalid_args", "Invalid alert route", issues);
    const routes = orderedRoutes(store);
    if (routes.length >= MAX_ALERT_ROUTES) {
      return fail("limit_reached", `At most ${MAX_ALERT_ROUTES} alert routes per workspace`);
    }
    const row: AlertRouteRow = {
      id: args.id,
      name: args.name,
      position: routes.length,
      match: args.match,
      action: args.action,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    renumber(store, routes, ctx);
    store.insert("alert_routes", row);
    return ok(routeEvent("alert_route.created", row));
  },
});

export const updateAlertRoute = defineMutation({
  name: "alertRoute.update",
  args: v.object({ id: routeId, ...routeFields }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const route = store.get("alert_routes", args.id);
    if (!route) return fail("not_found", "Alert route not found");
    const issues = routeIssues(store, args.action);
    if (issues.length) return fail("invalid_args", "Invalid alert route", issues);
    // Saving a route a takeover disabled is someone with `alert:manage` vouching for it: it routes again.
    if (
      !route.disabled &&
      route.name === args.name &&
      JSON.stringify(route.match) === JSON.stringify(args.match) &&
      JSON.stringify(route.action) === JSON.stringify(args.action)
    ) {
      return fail("conflict", "Nothing to change");
    }
    const row = store.update("alert_routes", args.id, {
      name: args.name,
      match: args.match,
      action: args.action,
      disabled: null,
      updatedAt: ctx.now,
    });
    return ok(routeEvent("alert_route.updated", row));
  },
});

/** Moves a route to `position` (0 is tried first); the others close up around it. */
export const moveAlertRoute = defineMutation({
  name: "alertRoute.move",
  args: v.object({ id: routeId, position: v.integer({ min: 0, max: MAX_ALERT_ROUTES - 1 }) }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    const routes = orderedRoutes(store);
    const from = routes.findIndex((row) => row.id === args.id);
    if (from < 0) return fail("not_found", "Alert route not found");
    const to = Math.min(args.position, routes.length - 1);
    if (from === to) return fail("conflict", "Already there");
    const [moved] = routes.splice(from, 1);
    routes.splice(to, 0, moved!);
    renumber(store, routes, ctx);
    const event: AlertRouteMoved = {
      type: "alert_route.moved",
      subject: args.id,
      data: { id: args.id, position: to },
    };
    return ok(event);
  },
});

export const deleteAlertRoute = defineMutation({
  name: "alertRoute.delete",
  args: v.object({ id: routeId }),
  permission: "alert:manage",
  apply(store, args, ctx) {
    if (!store.get("alert_routes", args.id)) return fail("not_found", "Alert route not found");
    store.delete("alert_routes", args.id);
    renumber(store, orderedRoutes(store), ctx);
    const event: AlertRouteDeleted = {
      type: "alert_route.deleted",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/**
 * Takes a deleted escalation policy off every route that named it, in the transaction that deleted it: their
 * incidents page through the default again (RFC 0006 "Who is paged"), never through nothing.
 */
export function dropPolicyFromRoutes(
  store: MutationStore,
  policyId: string,
  ctx: MutationContext,
): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const route of store.scan("alert_routes")) {
    const action = route.action;
    if ((action.kind !== "open" && action.kind !== "group") || action.policyId !== policyId)
      continue;
    const row = store.update("alert_routes", route.id, {
      action: { ...action, policyId: null },
      updatedAt: ctx.now,
    });
    events.push(routeEvent("alert_route.updated", row, "policy_deleted"));
  }
  return events;
}

// ---- Routing -----------------------------------------------------------------------------------------------------

/**
 * Whether `route` matches an alert from `sourceId` (an alert source, or a monitor's id): every condition it sets holds
 * (empty severities or labels hold always). `sourceIds` is read in two halves:
 *
 * - **Monitors** must be named, by id or as every monitor (`ROUTE_ALL_MONITORS`): naming none takes no monitor, so a
 *   route saved before monitors were routed (a catch-all `drop`) never silences one.
 * - **Alert sources**: every source (`ROUTE_ALL_SOURCES`), the sources named, or, naming no source, every source when
 *   the route names no monitor either (an empty list, as every route saved before monitors) and none when it does (a
 *   route for monitors only). So a route saved before keeps its meaning, and the editor writes every source
 *   explicitly whenever it adds monitors to a route that took every source.
 */
export function routeMatches(match: RouteMatch, sourceId: string, alert: NormalizedAlert): boolean {
  if (isId("mon", sourceId)) {
    if (!match.sourceIds.includes(ROUTE_ALL_MONITORS) && !match.sourceIds.includes(sourceId)) {
      return false;
    }
  } else if (!matchesSource(match.sourceIds, sourceId)) return false;
  if (match.severities.length > 0 && !match.severities.includes(alert.severity)) return false;
  return match.labels.every((one) => {
    const value = Object.prototype.hasOwnProperty.call(alert.labels, one.key)
      ? alert.labels[one.key]
      : undefined;
    return one.value === "" ? value !== undefined : value === one.value;
  });
}

/** The alert-source half of `routeMatches`. */
function matchesSource(sourceIds: readonly string[], sourceId: string): boolean {
  if (sourceIds.includes(ROUTE_ALL_SOURCES) || sourceIds.includes(sourceId)) return true;
  // Naming no source at all: every source for an empty list, none for a list of monitors only.
  return sourceIds.length === 0;
}

/** The default route: open an incident at the alert's own severity, paged through the default policy. */
export const DEFAULT_ROUTE_ACTION: RouteAction = {
  kind: "open",
  severity: null,
  typeId: null,
  serviceIds: [],
  policyId: null,
};

/**
 * Which route takes an alert: the first that matches, in order, else the default (`route` null). A malformed
 * payload never goes through the routes: a route could drop it, and nobody would know the sender is broken. A
 * route a takeover disabled is skipped.
 */
export function pickRoute(
  routes: readonly AlertRouteRow[],
  sourceId: string,
  alert: NormalizedAlert,
  malformed: boolean,
): { route: AlertRouteRow | null; action: RouteAction; reason: AlertRouteReason } {
  if (malformed) return { route: null, action: DEFAULT_ROUTE_ACTION, reason: "malformed" };
  const route = routes.find((one) => !one.disabled && routeMatches(one.match, sourceId, alert));
  return route
    ? { route, action: route.action, reason: "matched" }
    : { route: null, action: DEFAULT_ROUTE_ACTION, reason: "default" };
}

// ---- Ingest ------------------------------------------------------------------------------------------------------

const declaring = defineRegistry([declareIncident, setIncidentStatus, setIncidentSeverity]);

function resolvedEvent(
  row: SourceAlertRow,
  reason: SourceAlertResolved["data"]["reason"],
  resolvedIncident?: string,
): SourceAlertResolved {
  return {
    type: "alert.resolved",
    subject: row.id,
    data: {
      id: row.id,
      sourceId: row.sourceId,
      reason,
      ...(resolvedIncident && { resolvedIncident }),
    },
  };
}

/** Lets go of a firing row without its sender resolving it (`closed`), and says why. */
function closeRow(
  store: MutationStore,
  row: SourceAlertRow,
  reason: Exclude<SourceAlertResolved["data"]["reason"], "resolved" | "source_deleted">,
  ctx: MutationContext,
): SourceAlertResolved {
  store.update("source_alerts", row.id, {
    status: "closed",
    resolvedAt: ctx.now,
    updatedAt: ctx.now,
  });
  return resolvedEvent(row, reason);
}

/**
 * Runs a nested incident mutation as `ctx`'s actor (the alerts' or the monitors'). A storage failure must reach the
 * shard as one (it rolls back and the sender retries), not as the `internal` `runMutation` would make of it, so it is
 * caught and thrown again.
 */
export function runIncidentMutation(
  store: MutationStore,
  name: "incident.declare" | "incident.setStatus" | "incident.setSeverity",
  args: unknown,
  ctx: MutationContext,
): MutationResult {
  let thrown: { error: unknown } | undefined;
  const result = runMutation(declaring, name, args, store, ctx, {
    onError: (error) => (thrown = { error }),
  });
  if (thrown) throw thrown.error;
  return result;
}

/**
 * The open incident a `group` route's `groupKey` already has, from an alert source's alert or a monitor's: one route
 * grouping both puts them in one incident (RFC 0007 "Monitor alerts through the routes").
 */
export function groupIncident(store: MutationStore, groupKey: string): string | undefined {
  const rows = [...store.scan("source_alerts"), ...store.scan("alerts")];
  const holder = rows.find(
    (row) => row.groupKey === groupKey && incidentOpen(store, row.incidentId),
  );
  return holder?.incidentId ?? undefined;
}

/**
 * Says on `incidentId`'s timeline that an alert was grouped onto it (`alert_grouped`): an alert source's, by its
 * title, or a monitor's, by its name. Grouping pages nobody by itself, so the incident's people see it there.
 */
export function noteGrouped(
  store: MutationStore,
  incidentId: string,
  alert: { sourceId: string; name: string } | { monitorId: string; name: string },
  ctx: MutationContext,
): void {
  const incident = store.get("incidents", incidentId);
  if (!incident) return;
  store.update("incidents", incident.id, { updatedAt: ctx.now });
  appendTimeline(store, incident, { kind: "alert_grouped", ...alert }, ctx);
}

/** Whether a row still holds its incident: an alert whose incident people closed is over. */
export function incidentOpen(store: MutationStore, incidentId: string | null): boolean {
  if (incidentId === null) return false;
  const incident = store.get("incidents", incidentId);
  return incident !== undefined && isActive(incident.status);
}

/** System actors' ids start so (`sys_alerts`, `sys_escalation`, `sys_notifier`…); members' never do. */
const isSystem = (actor: string) => actor.startsWith("sys_");

/**
 * Whether nobody has worked on `incident` yet: still in triage, not acknowledged, no role held, and every timeline
 * entry written by Brigade itself (no update, no change by a member). Only such an incident closes by itself.
 */
function untouched(store: MutationStore, incident: IncidentRow): boolean {
  if (incident.status !== "triage" || incident.acknowledgedAt != null) return false;
  if (Object.values(incident.roles ?? {}).some((holder) => holder !== undefined)) return false;
  const { from, to } = prefixRange(`${incident.id}:`);
  return store.range("timeline", from, to).every((entry) => isSystem(entry.actor));
}

/**
 * Once every alert on `incidentId` stopped firing: an incident nobody worked on resolves (the sender said the
 * problem is gone, and nobody is on it); one people worked on stays open for them, with an `alerts_resolved` timeline
 * entry. Returns its events (none while another alert still fires on it, or for an incident already over) and
 * whether it resolved.
 */
export function settleIncident(
  store: MutationStore,
  incidentId: string | null,
  ctx: MutationContext,
): { events: DomainEvent[]; resolved: boolean } {
  const none = { events: [], resolved: false };
  if (incidentId === null || !incidentOpen(store, incidentId)) return none;
  // A monitor grouped onto it that is still down holds it too: the sender's resolve is not the monitor's recovery.
  const firing = [...store.scan("source_alerts"), ...store.scan("alerts")].some(
    (row) => row.incidentId === incidentId && row.status === "firing",
  );
  if (firing) return none;
  const incident = store.get("incidents", incidentId)!;
  if (!untouched(store, incident)) {
    store.update("incidents", incident.id, { updatedAt: ctx.now });
    appendTimeline(store, incident, { kind: "alerts_resolved" }, ctx);
    return none;
  }
  const result = runIncidentMutation(
    store,
    "incident.setStatus",
    { id: incidentId, status: "resolved" },
    ctx,
  );
  return result.ok ? { events: result.events, resolved: true } : none;
}

/** One alert to ingest, with the ids the shard made for it (mutations make no randomness). */
const ingestItem = v.object({
  alert: normalizedAlert,
  alertId: v.id("alt"),
  incidentId: v.id("inc"),
  // The alert standing for unreadable entries of a payload that also held readable ones: past every route, as for a
  // payload unreadable as a whole (`malformed`).
  malformed: v.optional(v.boolean()),
});

/** Whether `alert` is one `alert.ingest` takes: the shard drops (and reports) the ones that are not, before sending. */
export function alertIssues(alert: unknown): Issue[] {
  const result = normalizedAlert(alert);
  return result.ok ? [] : result.issues;
}

/**
 * Whether `row` is the alert of `sourceId` with `dedupKey`. Brigade's own alerts (the unreadable payload's, the
 * capacity alert) are kept apart from a sender's by their `reason`, whatever the key: a sender that names its alert
 * `malformed` or `capacity` neither merges into them nor resolves them.
 */
function sameAlert(
  row: SourceAlertRow,
  sourceId: string,
  dedupKey: string,
  system: boolean,
): boolean {
  const own = row.reason === "malformed" || row.reason === "capacity";
  return row.sourceId === sourceId && row.dedupKey === dedupKey && own === system;
}

/** The firing row an alert of `sourceId` with `dedupKey` belongs to, if any (`system`: one of Brigade's own). */
function firingRow(
  store: MutationStore,
  sourceId: string,
  dedupKey: string,
  system: boolean,
): SourceAlertRow | undefined {
  return store
    .scan("source_alerts")
    .find((row) => row.status === "firing" && sameAlert(row, sourceId, dedupKey, system));
}

/** Deletes the oldest resolved and closed rows, then the oldest dropped ones, past `MAX_ALERT_ROWS`. Firing ones stay. */
function prune(store: MutationStore): void {
  const rows = store.scan("source_alerts");
  let extra = rows.length - MAX_ALERT_ROWS;
  if (extra <= 0) return;
  const oldest = (a: SourceAlertRow, b: SourceAlertRow) => a.lastSeenAt - b.lastSeenAt;
  const over = rows.filter((row) => row.status !== "firing").sort(oldest);
  const dropped = rows
    .filter((row) => row.status === "firing" && row.outcome === "dropped")
    .sort(oldest);
  for (const row of [...over, ...dropped]) {
    if (extra-- <= 0) break;
    store.delete("source_alerts", row.id);
  }
}

/**
 * Lets go of the rows that hold nothing any more, before a payload is ingested: a row whose incident was closed
 * (`setIncidentStatus` releases them as it closes; this catches any it could not), and a suppressed or dropped row
 * not sent again for `ALERT_IDLE_TTL_MS`. A row on an open incident never expires: the incident holds it, and
 * closing the incident lets it go.
 */
function sweep(store: MutationStore, ctx: MutationContext): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const row of store.scan("source_alerts")) {
    if (row.status !== "firing") continue;
    if (row.incidentId !== null && !incidentOpen(store, row.incidentId)) {
      events.push(closeRow(store, row, "incident_closed", ctx));
    } else if (row.incidentId === null && ctx.now - row.lastSeenAt >= ALERT_IDLE_TTL_MS) {
      events.push(closeRow(store, row, "expired", ctx));
    }
  }
  const stale = store
    .scan("alert_resolve_markers")
    .filter((marker) => ctx.now - marker.at >= EARLY_RESOLVE_TTL_MS);
  for (const marker of stale) store.delete("alert_resolve_markers", marker.id);
  return events;
}

const markerId = (sourceId: string, dedupKey: string) => `${sourceId}:${dedupKey}`;

/**
 * Remembers a resolve that came before its firing, with when the sender says it resolved (`endedAt`, if it says),
 * keeping at most `MAX_RESOLVE_MARKERS` (the newest).
 */
function markResolved(
  store: MutationStore,
  sourceId: string,
  alert: NormalizedAlert,
  ctx: MutationContext,
): void {
  if (!ctx.server) return;
  const id = markerId(sourceId, alert.dedupKey);
  const endedAt = alert.at ?? null;
  if (store.get("alert_resolve_markers", id)) {
    store.update("alert_resolve_markers", id, { at: ctx.now, endedAt });
    return;
  }
  const markers = store.scan("alert_resolve_markers");
  if (markers.length >= MAX_RESOLVE_MARKERS) {
    const oldest = markers.reduce((a, b) => (b.at < a.at ? b : a));
    store.delete("alert_resolve_markers", oldest.id);
  }
  store.insert("alert_resolve_markers", { id, at: ctx.now, endedAt });
}

/**
 * Whether a firing is the late one of the resolve `marker` remembers, so it opens nothing: the marker is recent
 * (`EARLY_RESOLVE_TTL_MS`), and the firing did not start after the resolve. A firing that says when it started is
 * compared with when the sender says it resolved (else when the resolve came): one that started later is a new
 * problem, whose own earlier firing never reached Brigade, and pages.
 */
function lateFiring(
  marker: AlertResolveMarkerRow,
  alert: NormalizedAlert,
  ctx: MutationContext,
): boolean {
  if (ctx.now - marker.at >= EARLY_RESOLVE_TTL_MS) return false;
  if (alert.at == null) return true;
  return alert.at <= (marker.endedAt ?? marker.at);
}

/** How loud a route action is: a quiet row is routed again once the routes would do something louder with it. */
export const ROUTE_LOUDNESS: Record<RouteAction["kind"] | AlertOutcome, number> = {
  drop: 0,
  dropped: 0,
  resolved_early: 0,
  suppress: 1,
  suppressed: 1,
  open: 2,
  group: 2,
  opened: 2,
  grouped: 2,
};

/** The incident severity `action` gives `alert`: the route's, else its type's default, else the alert's own. */
export function targetSeverity(
  store: MutationStore,
  action: RouteAction,
  alert: Pick<NormalizedAlert, "severity">,
): Severity {
  if (action.kind !== "open" && action.kind !== "group")
    return ALERT_INCIDENT_SEVERITY[alert.severity];
  const type = action.typeId ? store.get("incident_types", action.typeId) : undefined;
  return action.severity ?? type?.defaultSeverity ?? ALERT_INCIDENT_SEVERITY[alert.severity];
}

/**
 * Raises `incidentId` to `severity` if it is lower (`incident.setSeverity` as the alerts' actor), never lowering it:
 * a raise into SEV1 or SEV2 pages again (RFC 0006 "Who is paged").
 */
export function raiseIncident(
  store: MutationStore,
  incidentId: string | null,
  severity: Severity,
  ctx: MutationContext,
): DomainEvent[] {
  if (incidentId === null || !incidentOpen(store, incidentId)) return [];
  const incident = store.get("incidents", incidentId)!;
  if (SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf(incident.severity)) return [];
  const result = runIncidentMutation(
    store,
    "incident.setSeverity",
    { id: incidentId, severity },
    ctx,
  );
  return result.ok ? result.events : [];
}

const moreUrgent = (a: AlertSeverity, b: AlertSeverity) =>
  ALERT_SEVERITIES.indexOf(a) < ALERT_SEVERITIES.indexOf(b);

/** What one ingest needs besides the store: the payload's source, the routes, and the capacity alert's title. */
type Intake = {
  sourceId: string;
  routes: readonly AlertRouteRow[];
  malformed: boolean;
  capacityTitle: string;
  /** The alert as sent, before its source's mapping, kept on its row (`SourceAlertRow.received`). */
  received: SourceAlertRow["received"];
  ctx: MutationContext;
};

/**
 * Server only, as `ALERTS_ACTOR`: the alerts one payload of a source held, already normalized and fitted by the
 * shard, which also made each one's ids. Rows that hold nothing any more are let go first (`sweep`). Then, for each
 * alert, by its source and `dedupKey`:
 *
 * - **Firing, and a row fires already**: the same alert again. Its title, severity, link and labels are refreshed
 *   and `repeats` counts it; no event, no incident, no page, so a dedup storm pages once. Two exceptions. A row the
 *   routes kept quiet (suppressed or dropped) is routed again, and becomes a new alert if they now do something
 *   louder with it (a deleted drop route, a warning that turned critical past a route suppressing warnings). And a
 *   row on an open incident that comes back more urgent raises the incident to what the routes give it now, which
 *   pages again into SEV1 or SEV2.
 * - **Firing, new**: the routes decide (`pickRoute`, `fire`): `open` declares an incident through
 *   `incident.declare` (with RBAC) in this transaction; `group` attaches it to the open incident its group already
 *   has (raising it if the alert asks for more), else opens one; `suppress` records it without an incident; `drop`
 *   records only that a route dropped it, and why. Within `FLAP_WINDOW_MS` of this key's incident resolving by itself,
 *   that incident reopens (and pages, once, at the more urgent of its severity and the alert's) instead of a new one,
 *   unless the routes now keep the alert quiet. Within `EARLY_RESOLVE_TTL_MS` of a resolve that came first, a firing
 *   that did not start after that resolve opens nothing, and is recorded as `resolved_early` (`lateFiring`).
 * - **Resolved**: resolves the firing row; once nothing fires on its incident, the incident resolves if nobody
 *   worked on it, else gets an `alerts_resolved` timeline entry (`settleIncident`). A resolve for an alert not firing
 *   is remembered for `EARLY_RESOLVE_TTL_MS`, in case its firing is still on its way, only when the key never fired
 *   (no row of it at all): a repeated resolve, or one after people closed the incident, keeps nothing from paging.
 *
 * A new alert is never refused for room: past `MAX_OPEN_ALERTS` the oldest suppressed one is let go, else the oldest grouped
 * one whose incident another alert still holds, else the alert becomes the workspace's single "alert capacity reached" alert, which pages through the default route. Declared
 * `silent` since a payload of repeats changes rows but is no domain event.
 */
export const ingestAlerts = defineMutation({
  name: "alert.ingest",
  args: v.object({
    sourceId,
    malformed: v.boolean(),
    // One more than a payload holds: the unreadable alert, when some of its entries were.
    alerts: v.array(ingestItem, { min: 1, max: MAX_ALERTS_PER_PAYLOAD + 1 }),
    // The capacity alert's title in the workspace's language (the shard has the messages; this package does not).
    capacityTitle: v.optional(v.string({ min: 1, max: ALERT_TITLE_MAX })),
  }),
  permission: "alert:manage",
  silent: true,
  apply(store, args, ctx) {
    if (ctx.actor.id !== ALERTS_ACTOR.id) return fail("forbidden", "Only the alert intake ingests");
    const source = store.get("alert_sources", args.sourceId);
    if (!source) return fail("not_found", "Alert source not found");
    const intake: Intake = {
      sourceId: source.id,
      routes: orderedRoutes(store),
      malformed: args.malformed,
      capacityTitle: args.capacityTitle ?? CAPACITY_TITLE,
      received: null,
      ctx,
    };
    const events: DomainEvent[] = sweep(store, ctx);
    for (const { alert: sent, alertId, incidentId, malformed: unreadable } of args.alerts) {
      const malformed = args.malformed || unreadable === true;
      intake.malformed = malformed;
      // Brigade's own alert stands for what could not be read: no mapping applies to it. Every other alert is
      // mapped before anything else reads it, so the routes match the severity the mapping gives.
      const alert = malformed ? sent : applyMapping(source.mapping, sent);
      intake.received = malformed
        ? null
        : {
            title: sent.title,
            severity: sent.severity,
            providerSeverity: sent.providerSeverity ?? null,
          };
      const current = firingRow(store, source.id, alert.dedupKey, malformed);
      if (alert.status === "resolved") {
        events.push(...resolveOne(store, current, alert, intake));
        continue;
      }
      const ids = { alertId, incidentId };
      if (!current) {
        const opened = fireNew(store, alert, ids, intake);
        if ("failed" in opened) return opened.failed;
        events.push(...opened.events);
        continue;
      }
      const { action } = pickRoute(intake.routes, source.id, alert, malformed);
      if (ROUTE_LOUDNESS[action.kind] > ROUTE_LOUDNESS[current.outcome]) {
        events.push(closeRow(store, current, "rerouted", ctx));
        const opened = fire(store, alert, ids, intake);
        if ("failed" in opened) return opened.failed;
        events.push(...opened.events);
        continue;
      }
      store.update("source_alerts", current.id, {
        title: alert.title,
        severity: alert.severity,
        link: alert.link,
        labels: alert.labels,
        ...(intake.received && { received: intake.received }),
        lastSeenAt: ctx.now,
        repeats: current.repeats + 1,
        updatedAt: ctx.now,
      });
      if (moreUrgent(alert.severity, current.severity)) {
        events.push(
          ...raiseIncident(store, current.incidentId, targetSeverity(store, action, alert), ctx),
        );
      }
    }
    prune(store);
    if (source.lastReceivedAt === null || ctx.now - source.lastReceivedAt >= SOURCE_SEEN_EVERY_MS) {
      store.update("alert_sources", source.id, { lastReceivedAt: ctx.now });
    }
    return ok(...events);
  },
});

/**
 * A resolve: of the firing row, else, when this key never fired at all, remembered in case its firing comes after
 * it. A key with any row (resolved, closed by people or by Brigade) already fired: the resolve is a repeat, or comes
 * after its incident was closed, and must not keep the key's next firing from paging.
 */
function resolveOne(
  store: MutationStore,
  current: SourceAlertRow | undefined,
  alert: NormalizedAlert,
  { sourceId, malformed, ctx }: Intake,
): DomainEvent[] {
  if (!current) {
    // While the capacity alert fires, a key with no row may have been folded into it: it fired, so no marker either.
    const fired = store
      .scan("source_alerts")
      .some(
        (row) =>
          sameAlert(row, sourceId, alert.dedupKey, malformed) ||
          (row.reason === "capacity" && row.status === "firing"),
      );
    if (!fired) markResolved(store, sourceId, alert, ctx);
    return [];
  }
  store.update("source_alerts", current.id, {
    status: "resolved",
    resolvedAt: ctx.now,
    lastSeenAt: ctx.now,
    updatedAt: ctx.now,
  });
  const settled = settleIncident(store, current.incidentId, ctx);
  return [
    resolvedEvent(
      current,
      "resolved",
      settled.resolved ? (current.incidentId ?? undefined) : undefined,
    ),
    ...settled.events,
  ];
}

/**
 * The incident this key's alert last had, if it resolved by itself (as the alerts' actor, `settleIncident`) less than
 * `FLAP_WINDOW_MS` ago and is still resolved: a flapping alert reopens it rather than opening another.
 */
function flapped(store: MutationStore, alert: NormalizedAlert, { sourceId, ctx }: Intake) {
  const last = store
    .scan("source_alerts")
    .filter(
      (row) =>
        sameAlert(row, sourceId, alert.dedupKey, false) &&
        row.status === "resolved" &&
        row.incidentId !== null &&
        row.resolvedAt !== null &&
        ctx.now - row.resolvedAt < FLAP_WINDOW_MS,
    )
    .sort((a, b) => b.resolvedAt! - a.resolvedAt!)[0];
  const incident = last?.incidentId ? store.get("incidents", last.incidentId) : undefined;
  if (!last || !incident || incident.status !== "resolved") return undefined;
  const entry = store.get("timeline", `${incident.id}:${incident.timelineSeq ?? 0}`);
  const closedByAlerts =
    entry?.kind === "status_changed" &&
    entry.to === "resolved" &&
    entry.actor === ALERTS_ACTOR.id &&
    ctx.now - entry.at < FLAP_WINDOW_MS;
  return closedByAlerts ? { row: last, incident } : undefined;
}

/**
 * A firing alert with no firing row: a resolve that came first, a flap, or a new alert through its route. A flap goes
 * through the routes as they are now: one that keeps it quiet (a suppress or drop route added since) leaves the
 * incident resolved and records the alert as that route has it; otherwise the incident reopens at the more urgent of
 * its own severity and what the routes give the alert, with one page, the reopen's, through the policy of the route
 * that matches now (`routeIncident`).
 */
function fireNew(
  store: MutationStore,
  alert: NormalizedAlert,
  ids: { alertId: string; incidentId: string },
  intake: Intake,
): { events: DomainEvent[] } | { failed: MutationResult } {
  const { sourceId, malformed, ctx } = intake;
  if (malformed) return fire(store, alert, ids, intake);
  const marker = store.get("alert_resolve_markers", markerId(sourceId, alert.dedupKey));
  if (marker) {
    store.delete("alert_resolve_markers", marker.id);
    if (lateFiring(marker, alert, ctx)) {
      // Its resolve already came: the problem is over, so nothing opens. Recorded, resolved, never silent.
      store.insert("source_alerts", {
        ...newRow(alert, ids.alertId, intake),
        status: "resolved",
        outcome: "resolved_early",
        resolvedAt: ctx.now,
      });
      return { events: [] };
    }
  }
  const flap = flapped(store, alert, intake);
  if (!flap) return fire(store, alert, ids, intake);
  const { route, action, reason } = pickRoute(intake.routes, sourceId, alert, false);
  if (action.kind !== "open" && action.kind !== "group") return fire(store, alert, ids, intake);
  const events: DomainEvent[] = [];
  const severity = targetSeverity(store, action, alert);
  if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(flap.incident.severity)) {
    // Raised while still resolved, and marked so it asks for no page of its own: the reopen right after pages, at
    // this severity (apps/api `asksForPage`).
    const raised = runIncidentMutation(
      store,
      "incident.setSeverity",
      { id: flap.incident.id, severity },
      ctx,
    );
    if (raised.ok) {
      events.push(
        ...raised.events.map((event) =>
          event.type === "incident.severity_changed"
            ? { ...event, data: { ...(event as IncidentSeverityChanged).data, reopening: true } }
            : event,
        ),
      );
    }
  }
  // Reopened as the alerts' actor, which pages again (`asksForPage`): nobody acknowledged it before it closed.
  const reopened = runIncidentMutation(
    store,
    "incident.setStatus",
    { id: flap.incident.id, status: "investigating" },
    ctx,
  );
  if (!reopened.ok) return fire(store, alert, ids, intake);
  routeIncident(store, flap.incident.id, route, action.policyId, ctx);
  const row: SourceAlertRow = {
    ...newRow(alert, ids.alertId, intake),
    outcome: "grouped",
    reason,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
    groupKey: flap.row.groupKey,
    policyId: action.policyId,
    incidentId: flap.incident.id,
    incidentNumber: flap.incident.number,
  };
  store.insert("source_alerts", row);
  return { events: [...events, ...reopened.events, firedEvent(row)] };
}

/**
 * Records the route that pages `incidentId` (`incident_routes`, one row per incident): written as a route declares
 * it, and replaced as a flap reopens it, so the reopen pages through the route that matches now. The default route
 * keeps no row (the default policy pages), so a reopen through it deletes the one there was.
 */
export function routeIncident(
  store: MutationStore,
  incidentId: string,
  route: AlertRouteRow | null,
  policyId: string | null,
  ctx: MutationContext,
): void {
  if (!ctx.server) return;
  const kept = store.get("incident_routes", incidentId);
  if (!route) {
    if (kept) store.delete("incident_routes", incidentId);
    return;
  }
  const row = { routeId: route.id, routeName: route.name, policyId };
  if (kept) store.update("incident_routes", incidentId, row);
  else store.insert("incident_routes", { id: incidentId, ...row });
}

function newRow(
  alert: NormalizedAlert,
  alertId: string,
  { sourceId, received, ctx }: Intake,
): SourceAlertRow {
  return {
    id: alertId,
    sourceId,
    dedupKey: alert.dedupKey,
    title: alert.title,
    severity: alert.severity,
    status: "firing",
    link: alert.link,
    labels: alert.labels,
    outcome: "dropped",
    reason: "default",
    routeId: null,
    routeName: null,
    groupKey: null,
    policyId: null,
    incidentId: null,
    incidentNumber: null,
    firedAt: ctx.now,
    lastSeenAt: ctx.now,
    resolvedAt: null,
    repeats: 0,
    ...(received && { received }),
    updatedAt: ctx.now,
  };
}

function firedEvent(row: SourceAlertRow): SourceAlertFired {
  return {
    type: "alert.fired",
    subject: row.id,
    data: {
      id: row.id,
      fingerprint: row.dedupKey,
      sourceId: row.sourceId,
      incidentId: row.incidentId,
      outcome: row.outcome as SourceAlertFired["data"]["outcome"],
      routeId: row.routeId,
      reason: row.reason,
    },
  };
}

/**
 * Makes room for one more firing alert: past `MAX_OPEN_ALERTS` (the capacity alert aside), the oldest suppressed
 * one is let go, else the oldest alert grouped onto an incident that another firing alert still holds (the incident
 * stays open and paged; the alert sent again groups onto it again). False when every firing alert is the only one
 * holding its open incident, so none can be.
 */
function makeRoom(store: MutationStore, ctx: MutationContext, events: DomainEvent[]): boolean {
  const holding = store
    .scan("source_alerts")
    .filter(
      (row) => row.status === "firing" && row.outcome !== "dropped" && row.reason !== "capacity",
    );
  if (holding.length < MAX_OPEN_ALERTS) return true;
  const held = new Map<string, number>();
  for (const row of holding) {
    if (row.incidentId !== null) held.set(row.incidentId, (held.get(row.incidentId) ?? 0) + 1);
  }
  const byAge = (a: SourceAlertRow, b: SourceAlertRow) => a.lastSeenAt - b.lastSeenAt;
  const oldest =
    holding.filter((row) => row.outcome === "suppressed").sort(byAge)[0] ??
    holding
      .filter((row) => row.outcome === "grouped" && (held.get(row.incidentId ?? "") ?? 0) > 1)
      .sort(byAge)[0];
  if (!oldest) return false;
  events.push(closeRow(store, oldest, "evicted", ctx));
  return true;
}

/**
 * A new firing alert through its route. Never refused for room: with none to make (`makeRoom`), the alert pages as
 * the workspace's one "alert capacity reached" alert (key `capacity`, the default route), whose repeats count like
 * any other, so a storm past the cap pages once and every alert still reaches someone.
 */
function fire(
  store: MutationStore,
  alert: NormalizedAlert,
  ids: { alertId: string; incidentId: string },
  intake: Intake,
): { events: DomainEvent[] } | { failed: MutationResult } {
  const { sourceId, routes, malformed, ctx } = intake;
  const { route, action, reason } = pickRoute(routes, sourceId, alert, malformed);
  const base: SourceAlertRow = {
    ...newRow(alert, ids.alertId, intake),
    reason,
    routeId: route?.id ?? null,
    routeName: route?.name ?? null,
  };
  if (action.kind === "drop") {
    store.insert("source_alerts", base);
    const event: SourceAlertDropped = {
      type: "alert.dropped",
      subject: base.id,
      data: {
        id: base.id,
        fingerprint: base.dedupKey,
        sourceId,
        routeId: route!.id,
        routeName: route!.name,
      },
    };
    return { events: [event] };
  }
  const events: DomainEvent[] = [];
  if (!makeRoom(store, ctx, events)) {
    const held = capacity(store, alert, ids, intake);
    return "failed" in held ? held : { events: [...events, ...held.events] };
  }
  if (action.kind === "suppress") {
    const row = { ...base, outcome: "suppressed" as const };
    store.insert("source_alerts", row);
    return { events: [...events, firedEvent(row)] };
  }
  const groupKey =
    action.kind === "group"
      ? `${route?.id ?? "default"}:${alert.labels[action.groupBy] ?? ""}`
      : null;
  if (groupKey !== null) {
    const holder = groupIncident(store, groupKey);
    if (holder) {
      const row: SourceAlertRow = {
        ...base,
        outcome: "grouped",
        groupKey,
        policyId: action.policyId,
        incidentId: holder,
        incidentNumber: store.get("incidents", holder)?.number ?? null,
      };
      store.insert("source_alerts", row);
      noteGrouped(store, holder, { sourceId, name: alert.title }, ctx);
      // A critical alert joining a group of warnings raises the group's incident.
      const raised = raiseIncident(store, holder, targetSeverity(store, action, alert), ctx);
      return { events: [...events, firedEvent(row), ...raised] };
    }
  }
  // A type or service deleted since the route was saved is left out by `incident.declare` itself.
  const declared = runIncidentMutation(
    store,
    "incident.declare",
    {
      id: ids.incidentId,
      title: alert.title,
      severity: targetSeverity(store, action, alert),
      ...(action.typeId && { typeId: action.typeId }),
      ...(action.serviceIds.length > 0 && { serviceIds: action.serviceIds }),
    },
    ctx,
  );
  // Without its incident the alert would page nobody: the payload fails, and the shard pages its fallback alert.
  if (!declared.ok) return { failed: declared };
  routeIncident(store, ids.incidentId, route, action.policyId, ctx);
  const row: SourceAlertRow = {
    ...base,
    outcome: "opened",
    groupKey,
    policyId: action.policyId,
    incidentId: ids.incidentId,
    incidentNumber: store.get("incidents", ids.incidentId)?.number ?? null,
  };
  store.insert("source_alerts", row);
  // The incident first: a consumer that sees the alert can already find what it points at.
  return { events: [...events, ...declared.events, firedEvent(row)] };
}

/** The "alert capacity reached" alert in place of one there is no room for: opened once, then counted as repeats. */
function capacity(
  store: MutationStore,
  alert: NormalizedAlert,
  ids: { alertId: string; incidentId: string },
  intake: Intake,
): { events: DomainEvent[] } | { failed: MutationResult } {
  const { ctx } = intake;
  const held = store
    .scan("source_alerts")
    .find(
      (row) =>
        row.reason === "capacity" && row.status === "firing" && incidentOpen(store, row.incidentId),
    );
  if (held) {
    store.update("source_alerts", held.id, {
      lastSeenAt: ctx.now,
      repeats: held.repeats + 1,
      updatedAt: ctx.now,
    });
    // As urgent as the most urgent alert it stands for.
    return {
      events: moreUrgent(alert.severity, "high")
        ? raiseIncident(store, held.incidentId, ALERT_INCIDENT_SEVERITY[alert.severity], ctx)
        : [],
    };
  }
  const declared = runIncidentMutation(
    store,
    "incident.declare",
    {
      id: ids.incidentId,
      title: intake.capacityTitle,
      severity:
        ALERT_INCIDENT_SEVERITY[moreUrgent(alert.severity, "high") ? alert.severity : "high"],
    },
    ctx,
  );
  if (!declared.ok) return { failed: declared };
  const row: SourceAlertRow = {
    ...newRow(
      { ...alert, dedupKey: CAPACITY_KEY, title: intake.capacityTitle, labels: {}, link: null },
      ids.alertId,
      { ...intake, received: null },
    ),
    severity: moreUrgent(alert.severity, "high") ? alert.severity : "high",
    outcome: "opened",
    reason: "capacity",
    incidentId: ids.incidentId,
    incidentNumber: store.get("incidents", ids.incidentId)?.number ?? null,
  };
  store.insert("source_alerts", row);
  return { events: [...declared.events, firedEvent(row)] };
}

/**
 * Routes one quiet alert source row again (`alert.reroute`, in monitor-alerts.ts): when the routes now do something
 * louder with it, it is closed (`rerouted`) and fires again through them as a new alert. Undefined when it stays as it
 * is (no longer firing or quiet, its source gone, or the routes as quiet as before).
 */
export function rerouteSourceAlert(
  store: MutationStore,
  row: SourceAlertRow,
  ids: { alertId: string; incidentId: string },
  routes: readonly AlertRouteRow[],
  capacityTitle: string,
  ctx: MutationContext,
): { events: DomainEvent[] } | { failed: MutationResult } | undefined {
  if (row.status !== "firing" || ROUTE_LOUDNESS[row.outcome] >= ROUTE_LOUDNESS.open)
    return undefined;
  if (!store.get("alert_sources", row.sourceId)) return undefined;
  const alert: NormalizedAlert = {
    dedupKey: row.dedupKey,
    title: row.title,
    severity: row.severity,
    status: "firing",
    link: row.link,
    labels: row.labels,
  };
  const intake: Intake = {
    sourceId: row.sourceId,
    routes,
    malformed: false,
    capacityTitle,
    // Already mapped when it came in: routed as it is, never mapped twice.
    received: row.received ?? null,
    ctx,
  };
  const { action } = pickRoute(routes, row.sourceId, alert, false);
  if (ROUTE_LOUDNESS[action.kind] <= ROUTE_LOUDNESS[row.outcome]) return undefined;
  const closed = closeRow(store, row, "rerouted", ctx);
  const opened = fire(store, alert, ids, intake);
  return "failed" in opened ? opened : { events: [closed, ...opened.events] };
}

/** Deletes the oldest rows past `MAX_ALERT_ROWS` (`prune`), after `alert.reroute` added some. */
export const pruneSourceAlerts = (store: MutationStore): void => prune(store);

/** The quiet rows `alert.reroute` would look at: suppressed or dropped, still firing. */
export function quietAlerts(store: Pick<MutationStore, "scan">): SourceAlertRow[] {
  return store
    .scan("source_alerts")
    .filter(
      (row) =>
        row.status === "firing" && (row.outcome === "suppressed" || row.outcome === "dropped"),
    );
}

/**
 * The quiet alert source rows the routes would now do something louder with (`rerouteSourceAlert` would fire them
 * again): what the shard routes again, in chunks, after the routes changed and on its alarm.
 */
export function sourceAlertsToReroute(
  store: Pick<MutationStore, "scan" | "get">,
): SourceAlertRow[] {
  const routes = orderedRoutes(store);
  return quietAlerts(store).filter((row) => {
    if (!store.get("alert_sources", row.sourceId)) return false;
    const { action } = pickRoute(routes, row.sourceId, { ...row, status: "firing" }, false);
    return ROUTE_LOUDNESS[action.kind] > ROUTE_LOUDNESS[row.outcome];
  });
}

/**
 * The route an alert source opened `incidentId` through, kept with the incident (`incident_routes`), for the run's
 * policy (RFC 0006 "Who is paged": route, then type, then monitor, then default). Undefined for an incident the
 * default route opened, or no alert source did.
 */
export function incidentRoute(
  store: Pick<MutationStore, "get">,
  incidentId: string,
): IncidentRouteRow | undefined {
  return store.get("incident_routes", incidentId);
}

// ---- Queries -----------------------------------------------------------------------------------------------------

const byName = (a: AlertSourceRow, b: AlertSourceRow) =>
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const allAlertSources = defineQuery({
  name: "alertSources.all",
  args: v.object({}),
  permission: "alert:read",
  table: "alert_sources",
  filter: () => true,
  sort: byName,
});

export const allAlertRoutes = defineQuery({
  name: "alertRoutes.all",
  args: v.object({}),
  permission: "alert:read",
  table: "alert_routes",
  filter: () => true,
  sort: byPosition,
});

/** Newest first: what came in lately and what Brigade did with it. */
export const recentAlerts = defineQuery({
  name: "sourceAlerts.recent",
  args: v.object({}),
  permission: "alert:read",
  table: "source_alerts",
  filter: () => true,
  sort: (a, b) => b.lastSeenAt - a.lastSeenAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
});

/** What members may send. */
export const alertSourceMutations = [
  createAlertSource,
  updateAlertSource,
  rotateAlertSource,
  setAlertSourceMapping,
  deleteAlertSource,
  createAlertRoute,
  updateAlertRoute,
  moveAlertRoute,
  deleteAlertRoute,
] as const;

// ---- Tokens ------------------------------------------------------------------------------------------------------

/** 32 random bytes in base64url, like a heartbeat's (`newHeartbeatSecret`). */
const SOURCE_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** The token in an alert source's URL (`POST /alerts/<token>`): `<workspace id>.<source id>.<secret>`. */
export function alertSourceToken(workspaceId: string, sourceId: string, secret: string): string {
  return `${workspaceId}.${sourceId}.${secret}`;
}

/** The parts of an alert source token, or undefined if it is not shaped like one (the workspace id is the caller's). */
export function parseAlertSourceToken(
  token: string,
): { workspaceId: string; sourceId: string; secret: string } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [workspaceId, sourceId, secret] = parts as [string, string, string];
  if (!workspaceId || !isId("src", sourceId) || !SOURCE_SECRET.test(secret)) return undefined;
  return { workspaceId, sourceId, secret };
}

/** One item of `alert.ingest`'s `alerts`, for the shard's own use. */
export type IngestItem = {
  alert: NormalizedAlert;
  alertId: string;
  incidentId: string;
  malformed?: boolean;
};
