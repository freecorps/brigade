// Delivery receipts (RFC 0006 "Delivery receipts"): what each page did on each device, stage by stage, so a member
// can see why they were or were not paged. One row per page and device: planned when the shard picks the device,
// sent and accepted (or not) when the notifier reports what the relay answered, delivered when the phone's
// Notification Service Extension reports it opened the page. Synced to every member of the workspace (it says when
// a phone was reachable, nothing more: no token, no key, no content); written only by the shard's own code.

import { isId } from "./id.ts";
import { DEVICE_PLATFORMS, PUSH_ENVIRONMENTS } from "./devices.ts";
import { MAX_ESCALATION_PAGES } from "./escalation.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery, prefixRange } from "./query.ts";
import type { DeliveryRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";

/** A page goes to at most this many devices (`MAX_PAGE_DEVICES` in the API): one plan or report names no more. */
export const MAX_DELIVERY_DEVICES = 200;

/**
 * Delivery rows an incident keeps per device: as many pages as its escalation run keeps (`MAX_ESCALATION_PAGES`),
 * so a long-running incident that pages every few minutes does not grow without bound. Planning a page past it drops
 * that device's oldest rows on the incident; the timeline still records every page and every miss.
 */
export const MAX_DELIVERIES_PER_DEVICE = MAX_ESCALATION_PAGES;

/**
 * Why a device's push did not get past the relay, as the notifier classifies the relay's answer:
 * - `not_configured`: this instance has no relay;
 * - `unsupported`: a platform the relay could not reach then (Android before FCM; no longer recorded);
 * - `seal_failed`: the device's key could not be used to encrypt the page;
 * - `relay_unreachable`: the relay did not answer in time, or not at all;
 * - `relay_refused`: the relay refused the request itself (its token, the body);
 * - `token_invalid`: the push service said the token is gone (APNs `BadDeviceToken`, `Unregistered`; FCM
 *   `UNREGISTERED`): the device was dropped;
 * - `apns_refused`: the push service (APNs, or FCM for Android) refused the push for another reason (`reason` says
 *   which);
 * - `apns_unavailable`: the push service throttled or failed (429, 5xx).
 */
export const DELIVERY_ERRORS = [
  "not_configured",
  "unsupported",
  "seal_failed",
  "relay_unreachable",
  "relay_refused",
  "token_invalid",
  "apns_refused",
  "apns_unavailable",
] as const;
export type DeliveryError = (typeof DELIVERY_ERRORS)[number];

/** What a delivery row is for: the page's alert push, or the call that rang after it (RFC 0010). */
export const DELIVERY_KINDS = ["push", "call"] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Whether a row is a call's, not a push's (rows from before calls had rows have no `kind`: pushes). */
export function isCallDelivery(row: Pick<DeliveryRow, "kind">): boolean {
  return row.kind === "call";
}

/** The furthest stage a device's page reached, from its row. */
export type DeliveryStage = "planned" | "sent" | "accepted" | "delivered";

export function deliveryStage(row: DeliveryRow): DeliveryStage {
  if (row.deliveredAt !== null) return "delivered";
  if (row.acceptedAt !== null) return "accepted";
  if (row.sentAt !== null) return "sent";
  return "planned";
}

/** A delivery row's id: the incident first, so one incident's rows are an id range. */
export function deliveryId(incidentId: string, eventId: string, deviceId: string): string {
  return `${incidentId}:${eventId}:${deviceId}`;
}

/**
 * A call's delivery row id: the push's with `:call`, so it sits next to it and `parseDeliveryId` (receipts) never
 * takes it.
 */
export function callDeliveryId(incidentId: string, eventId: string, deviceId: string): string {
  return `${deliveryId(incidentId, eventId, deviceId)}:call`;
}

/** Splits a push's delivery id, or returns undefined unless it is exactly `inc_…:evt_…:dev_…`. */
export function parseDeliveryId(
  id: unknown,
): { incidentId: string; eventId: string; deviceId: string } | undefined {
  if (typeof id !== "string" || id.length > 100) return undefined;
  const [incidentId, eventId, deviceId, ...rest] = id.split(":");
  if (
    rest.length > 0 ||
    !isId("inc", incidentId) ||
    !isId("evt", eventId) ||
    !isId("dev", deviceId)
  ) {
    return undefined;
  }
  return { incidentId, eventId, deviceId };
}

/**
 * The push service's reason for refusing a push: APNs' (`BadDeviceToken`, `TooManyRequests`) or FCM's
 * (`QUOTA_EXCEEDED`): letters and underscores only, bounded.
 */
const apnsReason: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[A-Za-z_]{1,64}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected an APNs reason" }] };

const rowId: Validator<string> = (input, path = "") =>
  parseDeliveryId(input)
    ? { ok: true, value: input as string }
    : { ok: false, issues: [{ path, message: "Expected a delivery id" }] };

const memberId = v.string({ min: 1, max: 64 });

export type NotificationPlanned = DomainEvent<
  "notification.planned",
  {
    incidentId: string;
    eventId: string;
    devices: number;
    /** Of those, the devices a call is planned for too (RFC 0010); absent when none. */
    calls?: number;
    page?: { run: string; step: number };
    /** Older rows dropped to keep `MAX_DELIVERIES_PER_DEVICE` per device; absent when none. */
    dropped?: number;
  }
>;
export type NotificationSent = DomainEvent<
  "notification.sent",
  {
    incidentId: string;
    eventId: string;
    /** Alert pushes. */
    accepted: number;
    failed: number;
    /** Calls the same attempt rang (RFC 0010); absent when it rang none. */
    calls?: { accepted: number; failed: number };
  }
>;
export type NotificationDelivered = DomainEvent<
  "notification.delivered",
  { incidentId: string; eventId: string; userId: string; deviceId: string }
>;

/**
 * Server only, as the notifier: the devices a page is about to go to (`Pager.plan`), one `planned` row each, and with
 * `call` a second row for the call that rings it after the alert push (RFC 0010). A row the page already planned (a
 * retry) is kept; with none new it is a `conflict`. Each device planned keeps its latest `MAX_DELIVERIES_PER_DEVICE`
 * rows of each kind on the incident; older ones are dropped.
 */
export const planDeliveries = defineMutation({
  name: "delivery.plan",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    page: v.nullable(
      v.object({ run: v.id("evt"), step: v.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }) }),
    ),
    devices: v.array(
      v.object({
        deviceId: v.id("dev"),
        userId: memberId,
        platform: v.picklist(DEVICE_PLATFORMS),
        environment: v.picklist(PUSH_ENVIRONMENTS),
        // Whether the page rings this device as a call too. Optional: a shard from before calls had rows.
        call: v.omittable(v.boolean()),
      }),
      { min: 1, max: MAX_DELIVERY_DEVICES },
    ),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    if (!store.get("incidents", args.incidentId)) return fail("not_found", "Incident not found");
    let planned = 0;
    let calls = 0;
    const plan = (id: string, device: (typeof args.devices)[number], kind?: "call") => {
      if (store.get("deliveries", id)) return false;
      store.insert("deliveries", {
        id,
        ...(kind ? { kind } : {}),
        incidentId: args.incidentId,
        eventId: args.eventId,
        deviceId: device.deviceId,
        userId: device.userId,
        platform: device.platform,
        environment: device.environment,
        run: args.page?.run ?? null,
        step: args.page?.step ?? null,
        plannedAt: ctx.now,
        sentAt: null,
        acceptedAt: null,
        deliveredAt: null,
        attempts: 0,
        error: null,
        reason: null,
        updatedAt: ctx.now,
      });
      return true;
    };
    for (const device of args.devices) {
      if (plan(deliveryId(args.incidentId, args.eventId, device.deviceId), device)) planned++;
      if (
        device.call === true &&
        plan(callDeliveryId(args.incidentId, args.eventId, device.deviceId), device, "call")
      ) {
        calls++;
      }
    }
    if (planned + calls === 0) return fail("conflict", "Every device is planned already");
    const { from, to } = prefixRange(`${args.incidentId}:`);
    const dropped = dropOldest(
      store.range("deliveries", from, to),
      new Set(args.devices.map((device: { deviceId: string }) => device.deviceId)),
      (id) => store.delete("deliveries", id),
    );
    const event: NotificationPlanned = {
      type: "notification.planned",
      subject: args.incidentId,
      data: {
        incidentId: args.incidentId,
        eventId: args.eventId,
        devices: planned,
        ...(calls > 0 && { calls }),
        ...(args.page && { page: args.page }),
        ...(dropped > 0 && { dropped }),
      },
    };
    return ok(event);
  },
});

/**
 * Drops each of `devices`' rows beyond its latest `MAX_DELIVERIES_PER_DEVICE` of each kind (by plan time); returns how
 * many.
 */
function dropOldest(
  rows: readonly DeliveryRow[],
  devices: ReadonlySet<string>,
  drop: (id: string) => void,
): number {
  const byDevice = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    if (!devices.has(row.deviceId)) continue;
    const key = `${row.deviceId}:${row.kind ?? "push"}`;
    byDevice.set(key, [...(byDevice.get(key) ?? []), row]);
  }
  let dropped = 0;
  for (const list of byDevice.values()) {
    if (list.length <= MAX_DELIVERIES_PER_DEVICE) continue;
    list.sort((a, b) => b.plannedAt - a.plannedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    for (const row of list.slice(MAX_DELIVERIES_PER_DEVICE)) {
      drop(row.id);
      dropped++;
    }
  }
  return dropped;
}

/**
 * Server only, as the notifier: what the relay answered for each device of one attempt (`Pager.record`), the alert
 * push's and, with `kind: "call"`, the call's. `ms` is how long the relay took, so the row says when it was handed
 * over. An accepted push or call clears the last error; one without a planned row (a plan from before receipts, or
 * from before calls had rows) is skipped.
 */
export const reportDeliveries = defineMutation({
  name: "delivery.report",
  args: v.object({
    incidentId: v.id("inc"),
    eventId: v.id("evt"),
    outcomes: v.array(
      v.object({
        deviceId: v.id("dev"),
        ok: v.boolean(),
        error: v.nullable(v.picklist(DELIVERY_ERRORS)),
        reason: v.nullable(apnsReason),
        ms: v.integer({ min: 0, max: 60_000 }),
        kind: v.omittable(v.picklist(DELIVERY_KINDS)),
      }),
      // A push and a call for every device.
      { min: 1, max: 2 * MAX_DELIVERY_DEVICES },
    ),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    let accepted = 0;
    let failed = 0;
    const calls = { accepted: 0, failed: 0 };
    for (const outcome of args.outcomes) {
      const call = outcome.kind === "call";
      const id = (call ? callDeliveryId : deliveryId)(
        args.incidentId,
        args.eventId,
        outcome.deviceId,
      );
      const row = store.get("deliveries", id);
      if (!row) continue;
      // Never before the plan: the notifier's clock and the shard's may disagree. Never after a receipt either: a
      // slow device in the same send can hold this report back past another phone's receipt.
      const cap = row.deliveredAt ?? Number.POSITIVE_INFINITY;
      const sentAt = Math.min(cap, Math.max(row.plannedAt, ctx.now - outcome.ms));
      store.update("deliveries", id, {
        sentAt,
        attempts: row.attempts + 1,
        ...(outcome.ok
          ? { acceptedAt: row.acceptedAt ?? Math.min(cap, ctx.now), error: null, reason: null }
          : { error: outcome.error ?? "relay_unreachable", reason: outcome.reason }),
        updatedAt: ctx.now,
      });
      if (call) calls[outcome.ok ? "accepted" : "failed"]++;
      else if (outcome.ok) accepted++;
      else failed++;
    }
    if (accepted + failed + calls.accepted + calls.failed === 0) {
      return fail("not_found", "No planned device");
    }
    const event: NotificationSent = {
      type: "notification.sent",
      subject: args.incidentId,
      data: {
        incidentId: args.incidentId,
        eventId: args.eventId,
        accepted,
        failed,
        ...(calls.accepted + calls.failed > 0 && { calls }),
      },
    };
    return ok(event);
  },
});

/**
 * Server only, from the phone's receipt (the Worker's `POST /receipts`, after the shard checked its token): the
 * device opened the page. Once only: a second receipt for the same page and device is a `conflict` and changes
 * nothing. The device's summary records when it was last heard from.
 */
export const confirmDelivery = defineMutation({
  name: "delivery.confirm",
  args: v.object({ id: rowId }),
  permission: "incident:update",
  apply(store, args, ctx) {
    const row = store.get("deliveries", args.id);
    if (!row) return fail("not_found", "Delivery not found");
    if (row.deliveredAt !== null) return fail("conflict", "Delivery already confirmed");
    store.update("deliveries", row.id, { deliveredAt: ctx.now, updatedAt: ctx.now });
    const device = store.get("member_devices", row.deviceId);
    if (device && device.userId === row.userId && device.lastSeenAt < ctx.now) {
      store.update("member_devices", row.deviceId, { lastSeenAt: ctx.now });
    }
    const event: NotificationDelivered = {
      type: "notification.delivered",
      subject: row.incidentId,
      data: {
        incidentId: row.incidentId,
        eventId: row.eventId,
        userId: row.userId,
        deviceId: row.deviceId,
      },
    };
    return ok(event);
  },
});

/** Every device of one incident's pages, oldest page first, then by device. */
export const incidentDeliveries = defineQuery({
  name: "incident.deliveries",
  args: v.object({ id: v.id("inc") }),
  permission: "incident:read",
  table: "deliveries",
  range: (args) => prefixRange(`${args.id}:`),
  filter: (row, args) => row.incidentId === args.id,
  sort: (a, b) => a.plannedAt - b.plannedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
});

/** The devices members registered for paging, as everyone in the workspace may see them (no tokens or keys). */
export const allDevices = defineQuery({
  name: "devices.all",
  args: v.object({}),
  permission: "workspace:read",
  table: "member_devices",
  filter: () => true,
});
