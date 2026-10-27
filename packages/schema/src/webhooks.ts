// Outbound webhooks (RFC 0005 "Outbound webhooks"): endpoints an owner or admin registers per workspace, the public
// event catalog they can filter on, and the versioned JSON payload each delivery carries. The endpoint (`webhooks`) is
// synced to those who manage it only (its URL may hold a token of the receiver's); its signing secret is sealed by the
// API and server-only (`webhook_secrets`), and no event carries the URL or the secret. Delivery, signing and retries
// are the API's queue consumer (apps/api src/notify-webhooks.ts).

import {
  INCIDENT_ROLES,
  INCIDENT_STATUSES,
  SEVERITIES,
  type IncidentRole,
  type IncidentStatus,
  type Severity,
} from "./lifecycle.ts";
import {
  isCloudflareAddress,
  MONITOR_KINDS,
  MONITOR_STATUSES,
  MONITOR_URL_MAX,
  targetProblem,
  type MonitorKind,
  type MonitorStatus,
} from "./monitors.ts";
import type { EscalationReason, IncidentRow, MonitorRow, WebhookRow } from "./tables.ts";
import { defineMutation, fail, ok, type DomainEvent, type MutationStore } from "./mutation.ts";
import { defineQuery } from "./query.ts";
import { idTime } from "./id.ts";
import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import { v, type Validated, type Validator } from "./validate.ts";

/** At most this many endpoints per workspace (`limit_reached` past it). */
export const MAX_WEBHOOKS_PER_WORKSPACE = 20;
export const WEBHOOK_DESCRIPTION_MAX = 200;
/** How many delivery attempts each endpoint keeps (`WebhookRow.recent`), newest first. */
export const WEBHOOK_LOG_SIZE = 10;
/** The longest response snippet kept from a receiver: text only, never more. */
export const WEBHOOK_SNIPPET_MAX = 200;
/** "Send test event" at most once per endpoint in this long. */
export const WEBHOOK_TEST_EVERY_MS = 10_000;
/**
 * Auto-disable (RFC 0005 "Outbound webhooks"): an endpoint whose last `WEBHOOK_DISABLE_FAILURES` attempts or more all
 * failed, the first of them at least `WEBHOOK_DISABLE_AFTER_MS` ago, with no success since, is turned off.
 */
export const WEBHOOK_DISABLE_FAILURES = 10;
export const WEBHOOK_DISABLE_AFTER_MS = 24 * 60 * 60 * 1000;
/** After a rotation, deliveries are signed with the previous secret too for this long, so receivers can switch. */
export const WEBHOOK_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;
/** The payload's version: a change that is not purely additive is a new version, never an edit of this one. */
export const WEBHOOK_PAYLOAD_VERSION = 1 as const;

/**
 * The public event catalog: what an endpoint can subscribe to. Anything else (members, devices, schedules, the
 * notifiers' own records, the webhooks' own changes) is never delivered. `webhook.test` is not in it: "Send test event"
 * delivers it to the one endpoint it was sent from, whatever its filter.
 */
export const WEBHOOK_EVENT_TYPES = [
  "incident.declared",
  "incident.status_changed",
  "incident.severity_changed",
  "incident.acknowledged",
  "incident.update_posted",
  "incident.role_assigned",
  "alert.fired",
  "alert.resolved",
  "monitor.status_changed",
  "escalation.paged",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const WEBHOOK_TEST_EVENT = "webhook.test";
/** The notifier's own event that brings deliveries the ledger has due back to the queue (`webhook.redeliver`). */
export const WEBHOOK_REDELIVER_EVENT = "webhook.redeliver";

/** Whether `type` is in the public catalog. */
export function isWebhookEventType(type: unknown): type is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly unknown[]).includes(type);
}

/**
 * Why a delivery attempt failed: `timeout` (no answer in time), `network` (no connection), `status` (an answer other
 * than 2xx), `redirect` (a 3xx: never followed), `blocked` (the URL breaks the target rules now), `secret` (the
 * signing secret could not be opened: `WEBHOOK_SECRET_KEY` changed).
 */
export const WEBHOOK_ERRORS = [
  "timeout",
  "network",
  "status",
  "redirect",
  "blocked",
  "secret",
] as const;
export type WebhookError = (typeof WEBHOOK_ERRORS)[number];

/** Why an endpoint is off: turned off by a member, or by Brigade after sustained failures. */
export type WebhookDisabledReason = "manual" | "failing";

// ---- Target rules ------------------------------------------------------------------------------------------------

/** The WHATWG URL parser, as far as it is used here (src has no DOM or Node types). */
const URL_PARSER = (
  globalThis as unknown as {
    URL: new (input: string) => { protocol: string; hostname: string; href: string };
  }
).URL;

/**
 * Why an endpoint may not be `input`, or null if it may: the monitors' target rules (RFC 0007 "Targets": no
 * credentials, a port from `MONITOR_PORTS`, no private, loopback, link-local, reserved or local-only host), plus
 * `https:` only and no literal address of Cloudflare's own. Checked on save and again before every delivery.
 */
export function webhookTargetProblem(input: string): string | null {
  const problem = targetProblem(input);
  if (problem !== null) return problem;
  const url = new URL_PARSER(input);
  if (url.protocol !== "https:") return "Expected an https URL";
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isCloudflareAddress(host)) return "Expected an address outside Cloudflare";
  return null;
}

/** An endpoint URL, normalised (`new URL(…).href`). */
const webhookUrl: Validator<string> = (input, path = "") => {
  const text = v.string({ min: 1, max: MONITOR_URL_MAX })(input, path);
  if (!text.ok) return text;
  const problem = webhookTargetProblem(text.value);
  return problem
    ? { ok: false, issues: [{ path, message: problem }] }
    : { ok: true, value: new URL_PARSER(text.value).href };
};

/** A signing secret as the API seals it (`v1.<iv>.<ciphertext>`, base64url; apps/api src/slack-token.ts). */
const sealedSecret: Validator<string> = (input, path = "") =>
  typeof input === "string" &&
  input.length <= 512 &&
  /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{20,}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a sealed secret" }] };

const webhookId = v.id("whk");
const description = v.string({ max: WEBHOOK_DESCRIPTION_MAX });
const eventFilter = v.array(v.picklist(WEBHOOK_EVENT_TYPES), {
  min: 1,
  max: WEBHOOK_EVENT_TYPES.length,
  unique: true,
});

// ---- Events --------------------------------------------------------------------------------------------------------

export type WebhookCreated = DomainEvent<
  "webhook.created",
  { id: string; events: WebhookEventType[]; enabled: boolean }
>;
export type WebhookUpdated = DomainEvent<
  "webhook.updated",
  { id: string; events: WebhookEventType[]; urlChanged: boolean }
>;
export type WebhookEnabled = DomainEvent<"webhook.enabled", { id: string }>;
export type WebhookDisabled = DomainEvent<
  "webhook.disabled",
  { id: string; reason: WebhookDisabledReason; failures: number }
>;
export type WebhookSecretRotated = DomainEvent<"webhook.secret_rotated", { id: string }>;
export type WebhookDeleted = DomainEvent<"webhook.deleted", { id: string }>;
export type WebhookTestRequested = DomainEvent<"webhook.test", { id: string }>;
export type WebhookRedeliver = DomainEvent<"webhook.redeliver", { eventId: string }>;

// ---- Mutations ---------------------------------------------------------------------------------------------------

function sorted(events: readonly WebhookEventType[]): WebhookEventType[] {
  return WEBHOOK_EVENT_TYPES.filter((type) => events.includes(type));
}

function endpoint(store: MutationStore, id: string): WebhookRow | undefined {
  return store.get("webhooks", id);
}

/**
 * Server only: run by the API (`POST /workspaces/:id/webhooks`) as the member who asked, so `webhook:manage` is checked
 * here too. The API made the secret, showed it once and sends it sealed. Enabled from the start.
 */
export const createWebhook = defineMutation({
  name: "webhook.create",
  args: v.object({
    id: webhookId,
    url: webhookUrl,
    description,
    events: eventFilter,
    secret: sealedSecret,
  }),
  permission: "webhook:manage",
  apply(store, args, ctx) {
    if (ctx.server && idTime(args.id) - ctx.now > ID_CLOCK_SKEW_MS) {
      return fail("invalid_args", "Webhook id time is ahead of the server clock", [
        { path: "id", message: "Id time is too far in the future" },
      ]);
    }
    if (endpoint(store, args.id)) return fail("conflict", "Webhook already exists");
    if (store.scan("webhooks").length >= MAX_WEBHOOKS_PER_WORKSPACE) {
      return fail("limit_reached", `At most ${MAX_WEBHOOKS_PER_WORKSPACE} webhooks per workspace`);
    }
    const events = sorted(args.events);
    const row: WebhookRow = {
      id: args.id,
      url: args.url,
      description: args.description,
      events,
      enabled: true,
      disabledReason: null,
      disabledAt: null,
      failures: 0,
      failingSince: null,
      lastTestAt: null,
      secretRotatedAt: ctx.now,
      recent: [],
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
      updatedAt: ctx.now,
    };
    store.insert("webhooks", row);
    store.insert("webhook_secrets", {
      id: args.id,
      secret: args.secret,
      previous: null,
      previousUntil: null,
    });
    const event: WebhookCreated = {
      type: "webhook.created",
      subject: args.id,
      data: { id: args.id, events, enabled: true },
    };
    return ok(event);
  },
});

/** The URL, description and event filter; owners and admins. A changed URL keeps the secret. */
export const updateWebhook = defineMutation({
  name: "webhook.update",
  args: v.object({ id: webhookId, url: webhookUrl, description, events: eventFilter }),
  permission: "webhook:manage",
  apply(store, args, ctx) {
    const current = endpoint(store, args.id);
    if (!current) return fail("not_found", "Webhook not found");
    const events = sorted(args.events);
    const urlChanged = current.url !== args.url;
    if (
      !urlChanged &&
      current.description === args.description &&
      current.events.join() === events.join()
    ) {
      return fail("conflict", "Nothing to change");
    }
    store.update("webhooks", args.id, {
      url: args.url,
      description: args.description,
      events,
      updatedAt: ctx.now,
    });
    const event: WebhookUpdated = {
      type: "webhook.updated",
      subject: args.id,
      data: { id: args.id, events, urlChanged },
    };
    return ok(event);
  },
});

/**
 * Turns an endpoint on or off; owners and admins. Turning it on starts its failure count over, so an endpoint Brigade
 * turned off gets a full `WEBHOOK_DISABLE_AFTER_MS` again. Deliveries for events from while it was off are not sent.
 */
export const setWebhookEnabled = defineMutation({
  name: "webhook.setEnabled",
  args: v.object({ id: webhookId, enabled: v.boolean() }),
  permission: "webhook:manage",
  apply(store, args, ctx) {
    const current = endpoint(store, args.id);
    if (!current) return fail("not_found", "Webhook not found");
    if (current.enabled === args.enabled) return fail("conflict", "Nothing to change");
    if (args.enabled) {
      store.update("webhooks", args.id, {
        enabled: true,
        disabledReason: null,
        disabledAt: null,
        failures: 0,
        failingSince: null,
        updatedAt: ctx.now,
      });
      const event: WebhookEnabled = {
        type: "webhook.enabled",
        subject: args.id,
        data: { id: args.id },
      };
      return ok(event);
    }
    store.update("webhooks", args.id, {
      enabled: false,
      disabledReason: "manual",
      disabledAt: ctx.now,
      updatedAt: ctx.now,
    });
    const event: WebhookDisabled = {
      type: "webhook.disabled",
      subject: args.id,
      data: { id: args.id, reason: "manual", failures: current.failures },
    };
    return ok(event);
  },
});

/**
 * Server only, from the API (`POST /workspaces/:id/webhooks/:id/rotate`) as the member who asked: a new secret, shown
 * once. The one it replaces keeps signing alongside it for `WEBHOOK_ROTATION_GRACE_MS`, unless it was itself
 * replaced less than that ago (then the oldest is dropped: two at most).
 */
export const rotateWebhookSecret = defineMutation({
  name: "webhook.rotateSecret",
  args: v.object({ id: webhookId, secret: sealedSecret }),
  permission: "webhook:manage",
  apply(store, args, ctx) {
    const current = endpoint(store, args.id);
    if (!current) return fail("not_found", "Webhook not found");
    const secrets = store.get("webhook_secrets", args.id);
    if (secrets?.secret === args.secret) return fail("conflict", "Nothing to change");
    const row = {
      id: args.id,
      secret: args.secret,
      previous: secrets?.secret ?? null,
      previousUntil: secrets ? ctx.now + WEBHOOK_ROTATION_GRACE_MS : null,
    };
    if (secrets) store.update("webhook_secrets", args.id, row);
    else store.insert("webhook_secrets", row);
    store.update("webhooks", args.id, { secretRotatedAt: ctx.now, updatedAt: ctx.now });
    const event: WebhookSecretRotated = {
      type: "webhook.secret_rotated",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/** Deletes an endpoint, its secret and its delivery log; owners and admins. Deliveries in flight are dropped. */
export const deleteWebhook = defineMutation({
  name: "webhook.delete",
  args: v.object({ id: webhookId }),
  permission: "webhook:manage",
  apply(store, args) {
    if (!endpoint(store, args.id)) return fail("not_found", "Webhook not found");
    store.delete("webhooks", args.id);
    if (store.get("webhook_secrets", args.id)) store.delete("webhook_secrets", args.id);
    const event: WebhookDeleted = {
      type: "webhook.deleted",
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/**
 * "Send test event": a `webhook.test` event through the outbox like any other, which the consumer delivers to this
 * endpoint only, on or off, whatever its filter. At most once per `WEBHOOK_TEST_EVERY_MS`.
 */
export const sendWebhookTest = defineMutation({
  name: "webhook.sendTest",
  args: v.object({ id: webhookId }),
  permission: "webhook:manage",
  apply(store, args, ctx) {
    const current = endpoint(store, args.id);
    if (!current) return fail("not_found", "Webhook not found");
    if (current.lastTestAt !== null && ctx.now - current.lastTestAt < WEBHOOK_TEST_EVERY_MS) {
      return fail("limit_reached", "A test event was sent moments ago");
    }
    store.update("webhooks", args.id, { lastTestAt: ctx.now });
    const event: WebhookTestRequested = {
      type: WEBHOOK_TEST_EVENT,
      subject: args.id,
      data: { id: args.id },
    };
    return ok(event);
  },
});

/** One delivery attempt as the endpoint's log keeps it: no request body, at most a snippet of the response. */
const attemptArgs = v.object({
  eventId: v.id("evt"),
  type: v.string({ min: 1, max: 64 }),
  attempt: v.integer({ min: 1, max: 100 }),
  at: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  ok: v.boolean(),
  status: v.nullable(v.integer({ min: 100, max: 599 })),
  ms: v.nullable(v.integer({ min: 0, max: 600_000 })),
  error: v.nullable(v.picklist(WEBHOOK_ERRORS)),
  snippet: v.nullable(v.string({ max: WEBHOOK_SNIPPET_MAX })),
});

/**
 * Server only, as the notifier: what one delivery attempt did, kept in the endpoint's log (the last
 * `WEBHOOK_LOG_SIZE`). Silent, like a monitor's refresh: an attempt is no domain event. A success clears the failure
 * count; a failure that makes the endpoint fail for `WEBHOOK_DISABLE_AFTER_MS` with at least
 * `WEBHOOK_DISABLE_FAILURES` attempts turns it off with `webhook.disabled` (`failing`), which emails the owners.
 */
export const recordWebhookAttempt = defineMutation({
  name: "webhook.record",
  args: v.object({ id: webhookId, attempt: attemptArgs }),
  permission: "webhook:manage",
  silent: true,
  apply(store, args, ctx) {
    const current = endpoint(store, args.id);
    if (!current) return fail("not_found", "Webhook not found");
    const recent = [args.attempt, ...current.recent].slice(0, WEBHOOK_LOG_SIZE);
    if (args.attempt.ok) {
      store.update("webhooks", args.id, { recent, failures: 0, failingSince: null });
      return ok();
    }
    const failures = current.failures + 1;
    const failingSince = current.failingSince ?? args.attempt.at;
    const disable =
      current.enabled &&
      failures >= WEBHOOK_DISABLE_FAILURES &&
      ctx.now - failingSince >= WEBHOOK_DISABLE_AFTER_MS;
    if (!disable) {
      store.update("webhooks", args.id, { recent, failures, failingSince });
      return ok();
    }
    store.update("webhooks", args.id, {
      recent,
      failures,
      failingSince,
      enabled: false,
      disabledReason: "failing",
      disabledAt: ctx.now,
      updatedAt: ctx.now,
    });
    const event: WebhookDisabled = {
      type: "webhook.disabled",
      subject: args.id,
      data: { id: args.id, reason: "failing", failures },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier, from the shard's alarm: the deliveries of event `eventId` the webhook ledger has due
 * again (a backoff that ran out, a claim nobody recorded) go back to the queue as `webhook.redeliver`, through the
 * outbox like every event. Their retries never ride the original event's own redeliveries, so a slow receiver costs
 * the Queue's retries of a page nothing, and every attempt the ledger promises happens. No row changes.
 */
export const redeliverWebhooks = defineMutation({
  name: "webhook.redeliver",
  args: v.object({ eventId: v.id("evt") }),
  permission: "webhook:manage",
  apply(_store, args) {
    const event: WebhookRedeliver = {
      type: WEBHOOK_REDELIVER_EVENT,
      data: { eventId: args.eventId },
    };
    return ok(event);
  },
});

export const webhookMutations = [
  updateWebhook,
  setWebhookEnabled,
  deleteWebhook,
  sendWebhookTest,
] as const;

/** The workspace's endpoints, oldest first; owners and admins only (a URL may carry the receiver's token). */
export const allWebhooks = defineQuery({
  name: "webhook.all",
  args: v.object({}),
  permission: "webhook:manage",
  table: "webhooks",
  filter: () => true,
  sort: (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

// ---- Payload -------------------------------------------------------------------------------------------------------
// Within version 1, Brigade may add event types, values to any of the lists below and fields; removing or renaming
// any of them is a new version (RFC 0005 "Payloads"). So the types a receiver reads are open: `Open<Severity>` is
// every severity known now, or a string a newer Brigade sends.

/** One of the values known now, or another string a newer Brigade added within the same version. */
export type Open<Known extends string> = Known | (string & {});

/** An incident as a payload carries it. */
export type WebhookIncident = {
  id: string;
  /** `142` for INC-142; null in the rare case the shard has not numbered it. */
  number: number | null;
  title: string;
  severity: Open<Severity>;
  status: Open<IncidentStatus>;
  /** ISO 8601. */
  declaredAt: string;
  acknowledgedAt: string | null;
};

/** A monitor as a payload carries it: never its URL, host or heartbeat token. Name and kind null once deleted. */
export type WebhookMonitor = {
  id: string;
  name: string | null;
  kind: Open<MonitorKind> | null;
  status: Open<MonitorStatus> | null;
};

/**
 * Who caused the event: a member's id (`usr_…`), an API token's (`tok_…`, RFC 0014: a script acting for the member who
 * made it) or a system actor's (`sys_monitors`); never a name or an address.
 */
export type WebhookActor = { kind: Open<"user" | "system" | "integration" | "token">; id: string };

type Envelope<Type extends string, Data> = {
  version: typeof WEBHOOK_PAYLOAD_VERSION;
  /** The event's id (`evt_…`), also the `webhook-id` header: the same on every retry, so receivers de-duplicate by it. */
  id: string;
  type: Type;
  /** When the event happened, ISO 8601 (not when it was delivered: that is `webhook-timestamp`). */
  time: string;
  workspaceId: string;
  actor: WebhookActor;
  data: Data;
};

/** Every payload, by `type` (RFC 0005 "Payloads"). Member ids, never names or addresses. */
export type WebhookPayload =
  | Envelope<"incident.declared", { incident: WebhookIncident }>
  | Envelope<
      "incident.status_changed",
      { incident: WebhookIncident; from: Open<IncidentStatus>; to: Open<IncidentStatus> }
    >
  | Envelope<
      "incident.severity_changed",
      { incident: WebhookIncident; from: Open<Severity>; to: Open<Severity> }
    >
  /** `by`: the actor's id, a member's (`usr_…`) or an API token's (`tok_…`). */
  | Envelope<"incident.acknowledged", { incident: WebhookIncident; by: string }>
  | Envelope<"incident.update_posted", { incident: WebhookIncident; body: string }>
  /**
   * `roleId`: the role's id, a built-in's name or a workspace role's `rol_…` (RFC 0003 "Role definitions"); `role`:
   * the built-in's name, or `custom`; `roleName`: the workspace's name for it, null for a built-in under its own.
   */
  | Envelope<
      "incident.role_assigned",
      {
        incident: WebhookIncident;
        role: Open<IncidentRole | "custom">;
        roleId: string;
        roleName: string | null;
        from: string | null;
        to: string | null;
      }
    >
  | Envelope<"alert.fired", { alertId: string; monitor: WebhookMonitor; incidentId: string }>
  | Envelope<
      "alert.resolved",
      { alertId: string; monitor: WebhookMonitor; reason: Open<AlertResolvedReason> }
    >
  | Envelope<
      "monitor.status_changed",
      { monitor: WebhookMonitor; from: Open<MonitorStatus>; to: Open<MonitorStatus> }
    >
  | Envelope<
      "escalation.paged",
      {
        incident: WebhookIncident;
        /** 1-based; null: everyone who can respond was paged. */
        level: number | null;
        round: number;
        reason: Open<EscalationReason>;
        /** How many people the level paged, and how many it could not. */
        paged: number;
        missed: number;
      }
    >
  | Envelope<"webhook.test", { webhookId: string }>;

/**
 * A version 1 payload of a `type` this copy of the schema does not know: one Brigade added since. Its envelope is
 * checked; its `data` is left as sent.
 */
export type UnknownWebhookPayload = Envelope<string, unknown>;

/** The event as the outbox wrote it (apps/api `BrigadeEvent`), as far as a payload needs it. */
export type WebhookSourceEvent = {
  id: string;
  type: string;
  time: string;
  workspaceId: string;
  actor: WebhookActor;
  subject?: string;
  data: unknown;
};

/** What the shard knows when it first prepares a delivery: the event's incident or monitor, as they are then. */
export type WebhookContext = { incident?: IncidentRow; monitor?: MonitorRow };

/** Every `EscalationReason`, to check an event's against. */
export const ESCALATION_REASONS = [
  "started",
  "timeout",
  "unreachable",
  "undelivered",
  "exhausted",
  "stalled",
] as const satisfies readonly EscalationReason[];
/** `incident.role_assigned`'s `role`: a built-in's name, or `custom` for a role the workspace defined. */
const ROLE_KINDS = [...INCIDENT_ROLES, "custom"] as const;
/** Why an alert resolves (`alert.resolved`). */
export const ALERT_RESOLVED_REASONS = ["recovered", "paused", "deleted"] as const;
export type AlertResolvedReason = (typeof ALERT_RESOLVED_REASONS)[number];

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

function incidentOf(row: IncidentRow): WebhookIncident {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    severity: row.severity,
    status: row.status,
    declaredAt: new Date(row.declaredAt).toISOString(),
    acknowledgedAt: iso(row.acknowledgedAt),
  };
}

function monitorOf(id: string, row: MonitorRow | undefined): WebhookMonitor {
  return row
    ? { id, name: row.name, kind: row.kind, status: row.status }
    : { id, name: null, kind: null, status: null };
}

const field = (data: unknown, key: string): unknown =>
  typeof data === "object" && data !== null ? Reflect.get(data, key) : undefined;

/**
 * Which incident or monitor `event`'s payload describes, for the shard to read: an incident's id, or a monitor's;
 * none for a test.
 */
export function webhookSubject(
  event: WebhookSourceEvent,
): { incidentId: string } | { monitorId: string } | null {
  if (event.type.startsWith("incident.") && event.subject) return { incidentId: event.subject };
  if (event.type === "escalation.paged") {
    const id = field(event.data, "incidentId");
    return typeof id === "string" ? { incidentId: id } : null;
  }
  if (event.type === "monitor.status_changed" && event.subject) return { monitorId: event.subject };
  if (event.type === "alert.fired" || event.type === "alert.resolved") {
    const id = field(event.data, "monitorId");
    return typeof id === "string" ? { monitorId: id } : null;
  }
  return null;
}

/**
 * The payload of `event`, from the event's own data and `context` (the incident or monitor it is about); undefined
 * when the event is not in the catalog or what it describes is gone. Only the fields listed in `WebhookPayload`: an
 * event's other data (who was paged, why a page missed someone) is never copied through.
 */
export function webhookPayload(
  event: WebhookSourceEvent,
  context: WebhookContext,
): WebhookPayload | undefined {
  const base = {
    version: WEBHOOK_PAYLOAD_VERSION,
    id: event.id,
    time: event.time,
    workspaceId: event.workspaceId,
    actor: { kind: event.actor.kind, id: event.actor.id },
  };
  const data = event.data;
  // Each field is checked, never coerced: an event missing one (or holding the wrong kind) has no payload, so a
  // receiver never gets `"undefined"`, `"null"` or `NaN` where an id, a status or a count should be.
  const text = (key: string): string | undefined => {
    const value = field(data, key);
    return typeof value === "string" ? value : undefined;
  };
  const textOrNull = (key: string): string | null | undefined => {
    const value = field(data, key);
    return value === null || value === undefined
      ? null
      : typeof value === "string"
        ? value
        : undefined;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[]): T | undefined => {
    const value = field(data, key);
    return (values as readonly unknown[]).includes(value) ? (value as T) : undefined;
  };
  const count = (key: string): number | undefined => {
    const value = field(data, key);
    return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
  };
  if (event.type === WEBHOOK_TEST_EVENT) {
    const id = text("id");
    return id === undefined
      ? undefined
      : { ...base, type: "webhook.test", data: { webhookId: id } };
  }
  if (!isWebhookEventType(event.type)) return undefined;
  const type: WebhookEventType = event.type;
  const subject = webhookSubject(event);
  const incident =
    subject && "incidentId" in subject && context.incident
      ? incidentOf(context.incident)
      : undefined;
  const monitor =
    subject && "monitorId" in subject ? monitorOf(subject.monitorId, context.monitor) : undefined;
  switch (type) {
    case "incident.declared":
      return incident && { ...base, type, data: { incident } };
    case "incident.status_changed": {
      const from = oneOf("from", INCIDENT_STATUSES);
      const to = oneOf("to", INCIDENT_STATUSES);
      return incident && from && to ? { ...base, type, data: { incident, from, to } } : undefined;
    }
    case "incident.severity_changed": {
      const from = oneOf("from", SEVERITIES);
      const to = oneOf("to", SEVERITIES);
      return incident && from && to ? { ...base, type, data: { incident, from, to } } : undefined;
    }
    case "incident.acknowledged": {
      const by = text("by");
      return incident && by !== undefined ? { ...base, type, data: { incident, by } } : undefined;
    }
    case "incident.update_posted": {
      const body = text("body");
      return incident && body !== undefined
        ? { ...base, type, data: { incident, body } }
        : undefined;
    }
    case "incident.role_assigned": {
      const role = oneOf("role", ROLE_KINDS);
      // Events from before role definitions name a built-in only, whose name is its id.
      const roleId = text("roleId") ?? (role !== "custom" ? role : undefined);
      const roleName = textOrNull("roleName");
      const from = textOrNull("from");
      const to = textOrNull("to");
      return incident &&
        role &&
        roleId !== undefined &&
        roleName !== undefined &&
        from !== undefined &&
        to !== undefined
        ? { ...base, type, data: { incident, role, roleId, roleName, from, to } }
        : undefined;
    }
    case "escalation.paged": {
      const level = field(data, "level");
      const round = count("round");
      const reason = oneOf("reason", ESCALATION_REASONS);
      const userIds = field(data, "userIds");
      const missed = field(data, "missed");
      if (!incident || round === undefined || !reason) return undefined;
      if (level !== null && !(Number.isSafeInteger(level) && (level as number) >= 1))
        return undefined;
      return {
        ...base,
        type,
        data: {
          incident,
          level: level as number | null,
          round,
          reason,
          paged: Array.isArray(userIds) ? userIds.length : 0,
          missed: Array.isArray(missed) ? missed.length : 0,
        },
      };
    }
    case "monitor.status_changed": {
      const from = oneOf("from", MONITOR_STATUSES);
      const to = oneOf("to", MONITOR_STATUSES);
      return monitor && from && to ? { ...base, type, data: { monitor, from, to } } : undefined;
    }
    case "alert.fired": {
      const alertId = text("id");
      const incidentId = text("incidentId");
      return monitor && alertId !== undefined && incidentId !== undefined
        ? { ...base, type, data: { alertId, monitor, incidentId } }
        : undefined;
    }
    case "alert.resolved": {
      const alertId = text("id");
      const reason = oneOf("reason", ALERT_RESOLVED_REASONS);
      return monitor && alertId !== undefined && reason
        ? { ...base, type, data: { alertId, monitor, reason } }
        : undefined;
    }
    default: {
      // A type added to the catalog without a payload here fails to compile.
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** Whether endpoint `row` takes `event`: its own test, or (on, filtered in, and created by then) a catalog event. */
export function webhookWants(row: WebhookRow, event: WebhookSourceEvent): boolean {
  if (event.type === WEBHOOK_TEST_EVENT) return field(event.data, "id") === row.id;
  return (
    row.enabled &&
    isWebhookEventType(event.type) &&
    row.events.includes(event.type) &&
    Date.parse(event.time) >= row.createdAt
  );
}

// ---- Payload validators --------------------------------------------------------------------------------------------
// What a receiver may check a payload against (the SDK's `verifyWebhook`), and the API reference's `webhooks` section
// (`toJsonSchema`). Lenient wherever version 1 may grow, so an older receiver never refuses what a newer Brigade
// sends: open objects (a field added since is dropped), open lists (`v.openPicklist`: a value added since is kept as
// a string), text far longer than Brigade writes today, and a `type` added since parses as `UnknownWebhookPayload`.
// A test holds each to `WebhookPayload` and to what `webhookPayload` makes.

/** A user id, an API token's (`tok_…`) or a system actor's (`sys_monitors`): never a name or an address. */
const actorId = v.string({ min: 1, max: 64 });
/** An ISO 8601 time, as `Date.prototype.toISOString` writes it. */
const isoTime = v.string({ min: 1, max: 64 });
/** The longest value of an open list a receiver takes: far more than any Brigade uses. */
const OPEN_VALUE_MAX = 64;
/**
 * The longest text a receiver takes (a title, a name, an update): far more than Brigade allows today, so raising its
 * own limits later breaks no receiver.
 */
export const WEBHOOK_PAYLOAD_TEXT_MAX = 65_536;
const known = <const T extends string>(values: readonly T[]) =>
  v.openPicklist(values, { max: OPEN_VALUE_MAX });
const payloadText = v.string({ min: 1, max: WEBHOOK_PAYLOAD_TEXT_MAX });

const payloadIncident = v.object(
  {
    id: v.id("inc"),
    number: v.nullable(v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })),
    title: payloadText,
    severity: known(SEVERITIES),
    status: known(INCIDENT_STATUSES),
    declaredAt: isoTime,
    acknowledgedAt: v.nullable(isoTime),
  },
  { open: true },
);

const payloadMonitor = v.object(
  {
    id: v.id("mon"),
    name: v.nullable(payloadText),
    kind: v.nullable(known(MONITOR_KINDS)),
    status: v.nullable(known(MONITOR_STATUSES)),
  },
  { open: true },
);

/** The envelope every version 1 payload has, whatever its `type`. */
const envelopeFields = {
  version: v.literal(WEBHOOK_PAYLOAD_VERSION),
  id: v.id("evt"),
  time: isoTime,
  workspaceId: v.id("ws"),
  actor: v.object(
    { kind: known(["user", "system", "integration", "token"]), id: actorId },
    { open: true },
  ),
};

function envelope<const Type extends string, const S extends Record<string, Validator<unknown>>>(
  type: Type,
  data: S,
) {
  return v.object(
    { ...envelopeFields, type: v.literal(type), data: v.object(data, { open: true }) },
    { open: true },
  );
}

const statusChange = { from: known(INCIDENT_STATUSES), to: known(INCIDENT_STATUSES) };
const severityChange = { from: known(SEVERITIES), to: known(SEVERITIES) };

/** One validator per payload `type`, in the catalog's order, then `webhook.test`. */
export const WEBHOOK_PAYLOADS = {
  "incident.declared": envelope("incident.declared", { incident: payloadIncident }),
  "incident.status_changed": envelope("incident.status_changed", {
    incident: payloadIncident,
    ...statusChange,
  }),
  "incident.severity_changed": envelope("incident.severity_changed", {
    incident: payloadIncident,
    ...severityChange,
  }),
  "incident.acknowledged": envelope("incident.acknowledged", {
    incident: payloadIncident,
    by: actorId,
  }),
  "incident.update_posted": envelope("incident.update_posted", {
    incident: payloadIncident,
    body: v.string({ min: 1, max: WEBHOOK_PAYLOAD_TEXT_MAX, multiline: true, joiners: true }),
  }),
  "incident.role_assigned": envelope("incident.role_assigned", {
    incident: payloadIncident,
    role: known(ROLE_KINDS),
    roleId: v.string({ min: 1, max: OPEN_VALUE_MAX }),
    roleName: v.nullable(payloadText),
    from: v.nullable(actorId),
    to: v.nullable(actorId),
  }),
  "alert.fired": envelope("alert.fired", {
    alertId: v.id("alt"),
    monitor: payloadMonitor,
    incidentId: v.id("inc"),
  }),
  "alert.resolved": envelope("alert.resolved", {
    alertId: v.id("alt"),
    monitor: payloadMonitor,
    reason: known(ALERT_RESOLVED_REASONS),
  }),
  "monitor.status_changed": envelope("monitor.status_changed", {
    monitor: payloadMonitor,
    from: known(MONITOR_STATUSES),
    to: known(MONITOR_STATUSES),
  }),
  "escalation.paged": envelope("escalation.paged", {
    incident: payloadIncident,
    level: v.nullable(v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER })),
    round: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    reason: known(ESCALATION_REASONS),
    paged: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
    missed: v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  }),
  "webhook.test": envelope("webhook.test", { webhookId: v.id("whk") }),
} as const satisfies Record<WebhookPayload["type"], Validator<unknown>>;

/** Every payload `type` this copy of the schema knows: the catalog and `webhook.test`. */
export type WebhookPayloadType = WebhookPayload["type"];

/** Whether `payload` is of a `type` this copy of the schema knows (not an `UnknownWebhookPayload`). */
export function isKnownWebhookPayload(
  payload: WebhookPayload | UnknownWebhookPayload,
): payload is WebhookPayload {
  return Object.prototype.hasOwnProperty.call(WEBHOOK_PAYLOADS, payload.type);
}

/** A payload of a `type` added since: the envelope checked, `data` as sent. */
const unknownPayload = v.object(
  { ...envelopeFields, type: v.string({ min: 1, max: OPEN_VALUE_MAX }) },
  { open: true },
);

/**
 * `input` (parsed JSON) as a version 1 payload, or the issues that keep it from being one: another `version`, a
 * broken envelope, or a known `type` whose fields break its validator. A `type` added since is an
 * `UnknownWebhookPayload` (tell them apart with `isKnownWebhookPayload`); fields added since are dropped.
 */
export const webhookPayloadValidator: Validator<WebhookPayload | UnknownWebhookPayload> = (
  input,
  path = "",
) => {
  const type = field(input, "type");
  if (typeof type === "string" && Object.prototype.hasOwnProperty.call(WEBHOOK_PAYLOADS, type)) {
    return WEBHOOK_PAYLOADS[type as WebhookPayloadType](input, path) as Validated<WebhookPayload>;
  }
  const parsed = unknownPayload(input, path);
  if (!parsed.ok) return parsed;
  // Every payload carries `data`, whatever its type: one without it is not a payload at all.
  const data = field(input, "data");
  if (data === undefined) {
    return { ok: false, issues: [{ path: `${path}${path ? "." : ""}data`, message: "Required" }] };
  }
  return { ok: true, value: { ...parsed.value, data } as UnknownWebhookPayload };
};
