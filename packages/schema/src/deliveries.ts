// Delivery receipts (RFC 0006 "Delivery receipts"): what each page did on each device, stage by stage, so a member
// can see why they were or were not paged. One row per page and device: planned when the shard picks the device,
// sent and accepted (or not) when the notifier reports what the relay answered, delivered when the phone's
// Notification Service Extension reports it opened the page. Synced to every member of the workspace (it says when
// a phone was reachable, nothing more: no token, no key, no content); written only by the shard's own code.

import { isId } from "./id.ts";
import { DEVICE_PLATFORMS, PUSH_ENVIRONMENTS } from "./devices.ts";
import { defineMutation, fail, ok, type DomainEvent } from "./mutation.ts";
import { defineQuery, prefixRange } from "./query.ts";
import type { DeliveryRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";

/** A page goes to at most this many devices (`MAX_PAGE_DEVICES` in the API): one plan or report names no more. */
export const MAX_DELIVERY_DEVICES = 200;

/**
 * Why a device's push did not get past the relay, as the notifier classifies the relay's answer:
 * - `not_configured`: this instance has no relay;
 * - `unsupported`: a platform the relay cannot reach yet (Android until FCM);
 * - `seal_failed`: the device's key could not be used to encrypt the page;
 * - `relay_unreachable`: the relay did not answer in time, or not at all;
 * - `relay_refused`: the relay refused the request itself (its token, the body);
 * - `token_invalid`: APNs said the token is gone (`BadDeviceToken`, `Unregistered`): the device was dropped;
 * - `apns_refused`: APNs refused the push for another reason (`reason` says which);
 * - `apns_unavailable`: APNs throttled or failed (429, 5xx).
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

/** Splits a delivery id, or returns undefined unless it is exactly `inc_…:evt_…:dev_…`. */
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

/** APNs' reason for refusing a push (`BadDeviceToken`, `TooManyRequests`): letters only, bounded. */
const apnsReason: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[A-Za-z]{1,64}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected an APNs reason" }] };

const rowId: Validator<string> = (input, path = "") =>
  parseDeliveryId(input)
    ? { ok: true, value: input as string }
    : { ok: false, issues: [{ path, message: "Expected a delivery id" }] };

const memberId = v.string({ min: 1, max: 64 });

export type NotificationPlanned = DomainEvent<
  "notification.planned",
  { incidentId: string; eventId: string; devices: number; page?: { run: string; step: number } }
>;
export type NotificationSent = DomainEvent<
  "notification.sent",
  { incidentId: string; eventId: string; accepted: number; failed: number }
>;
export type NotificationDelivered = DomainEvent<
  "notification.delivered",
  { incidentId: string; eventId: string; userId: string; deviceId: string }
>;

/**
 * Server only, as the notifier: the devices a page is about to go to (`Pager.plan`), one `planned` row each. A device
 * the page already planned (a retry) keeps its row; with none new it is a `conflict`.
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
      }),
      { min: 1, max: MAX_DELIVERY_DEVICES },
    ),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    if (!store.get("incidents", args.incidentId)) return fail("not_found", "Incident not found");
    let planned = 0;
    for (const device of args.devices) {
      const id = deliveryId(args.incidentId, args.eventId, device.deviceId);
      if (store.get("deliveries", id)) continue;
      store.insert("deliveries", {
        id,
        incidentId: args.incidentId,
        eventId: args.eventId,
        ...device,
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
      planned++;
    }
    if (planned === 0) return fail("conflict", "Every device is planned already");
    const event: NotificationPlanned = {
      type: "notification.planned",
      subject: args.incidentId,
      data: {
        incidentId: args.incidentId,
        eventId: args.eventId,
        devices: planned,
        ...(args.page && { page: args.page }),
      },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier: what the relay answered for each device of one attempt (`Pager.record`). `ms` is how
 * long the relay took, so the row says when the push was handed over. An accepted push clears the last error; a
 * device without a planned row (a plan from before receipts) is skipped.
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
      }),
      { min: 1, max: MAX_DELIVERY_DEVICES },
    ),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    let accepted = 0;
    let failed = 0;
    for (const outcome of args.outcomes) {
      const id = deliveryId(args.incidentId, args.eventId, outcome.deviceId);
      const row = store.get("deliveries", id);
      if (!row) continue;
      // Never before the plan: the notifier's clock and the shard's may disagree.
      const sentAt = Math.max(row.plannedAt, ctx.now - outcome.ms);
      store.update("deliveries", id, {
        sentAt,
        attempts: row.attempts + 1,
        ...(outcome.ok
          ? { acceptedAt: row.acceptedAt ?? ctx.now, error: null, reason: null }
          : { error: outcome.error ?? "relay_unreachable", reason: outcome.reason }),
        updatedAt: ctx.now,
      });
      if (outcome.ok) accepted++;
      else failed++;
    }
    if (accepted + failed === 0) return fail("not_found", "No planned device");
    const event: NotificationSent = {
      type: "notification.sent",
      subject: args.incidentId,
      data: { incidentId: args.incidentId, eventId: args.eventId, accepted, failed },
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
