// Devices that can be paged (RFC 0006 "Device registration"): a member's phone, with its push tokens and the public
// key pushes are sealed to. Server-only: tokens and keys never reach another member, and the `device.*` events
// carry neither.

import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import { idTime } from "./id.ts";
import {
  defineMutation,
  fail,
  ok,
  type Actor,
  type DomainEvent,
  type MutationStore,
} from "./mutation.ts";
import type { DeviceRow, DeviceSummaryRow } from "./tables.ts";
import { v, type Validator } from "./validate.ts";

export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * Which APNs environment issued the token (S1 open question): Xcode debug builds get `sandbox` tokens, ad hoc and
 * store builds (every EAS build) `production` ones. A token sent to the other environment is `BadDeviceToken`.
 * Android has one environment and registers `production`.
 */
export const PUSH_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PushEnvironment = (typeof PUSH_ENVIRONMENTS)[number];

/**
 * Sent by the mobile app on Better Auth's `/sign-out`: the phone's device id (`dev_…`), so the session's end takes the
 * phone off every workspace of the member, not only the one the app had open (RFC 0006 "Device registration").
 */
export const DEVICE_HEADER = "Brigade-Device";

/**
 * Devices one member may register in one workspace; a page fans out to all of them. A new device over it replaces
 * the member's least recently registered ones (`replaced`): reinstalls make new devices, and the newest phone must
 * never be locked out by phones long gone.
 */
export const MAX_DEVICES_PER_MEMBER = 10;

/**
 * Why a device stopped being paged: its member unregistered it, APNs said its token is gone, its member left or
 * was removed from the workspace (`member.remove`, `member.reconcile`), its member's password was reset
 * (`device.signOut`), or its member registered a new device over `MAX_DEVICES_PER_MEMBER` and this one was the least
 * recently registered (`replaced`).
 */
export type DeviceRemoval =
  | "unregistered"
  | "token_invalid"
  | "member_removed"
  | "password_reset"
  | "replaced";

export type DeviceRegistered = DomainEvent<
  "device.registered",
  Pick<DeviceRow, "id" | "userId" | "platform" | "environment"> & { voip: boolean }
>;
export type DeviceUnregistered = DomainEvent<
  "device.unregistered",
  { id: string; userId: string; reason: DeviceRemoval }
>;
/**
 * A device's PushKit token was cleared, so it no longer rings as a call (RFC 0010); its alert pushes go on.
 * `token_invalid`: APNs said the token is gone.
 */
export type DeviceVoipCleared = DomainEvent<
  "device.voip_cleared",
  { id: string; userId: string; reason: "token_invalid" }
>;

/**
 * Who reports what a page did (RFC 0005 "Notifiers"): the queue consumer records failed pages through it. Server-only
 * mutations are reachable only from the shard's own code, so its role grants no member anything.
 */
export const NOTIFIER_ACTOR: Actor = { kind: "system", id: "sys_notifier", role: "admin" };

/**
 * Who signs a user's devices out of a workspace when their password is reset (`device.signOut`, RFC 0002 "Auth").
 * Server only, so its role grants no member anything.
 */
export const ACCOUNT_ACTOR: Actor = { kind: "system", id: "sys_account", role: "admin" };

/** What a member's device looks like to the rest of the workspace: no token, no key. */
export function deviceSummary(
  device: Pick<
    DeviceRow,
    "id" | "userId" | "platform" | "environment" | "voipToken" | "registeredAt"
  >,
  seenAt: number,
  previous?: DeviceSummaryRow,
): DeviceSummaryRow {
  return {
    id: device.id,
    userId: device.userId,
    platform: device.platform,
    environment: device.environment,
    voip: device.voipToken !== null,
    registeredAt: device.registeredAt,
    lastSeenAt: Math.max(seenAt, previous?.lastSeenAt ?? 0),
  };
}

/** Deletes a device and the summary the workspace sees of it. */
export function forgetDevice(store: MutationStore, id: string): void {
  store.delete("devices", id);
  if (store.get("member_devices", id)) store.delete("member_devices", id);
}

/**
 * Forgets every device of `userId`, or only those last registered before `before`, with a `device.unregistered` for
 * each.
 */
export function dropDevices(
  store: MutationStore,
  userId: string,
  reason: DeviceRemoval,
  before = Infinity,
  only?: string,
): DeviceUnregistered[] {
  const events: DeviceUnregistered[] = [];
  for (const device of store.scan("devices")) {
    if (device.userId !== userId || device.updatedAt >= before) continue;
    if (only !== undefined && device.id !== only) continue;
    forgetDevice(store, device.id);
    events.push({
      type: "device.unregistered",
      subject: device.id,
      data: { id: device.id, userId, reason },
    });
  }
  return events;
}

/** A native push token (APNs hex, FCM's own alphabet): printable ASCII without spaces, bounded. */
const pushToken: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[\x21-\x7e]{16,512}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a push token" }] };

/**
 * The device's HPKE public key as `packages/push` takes it: an uncompressed P-256 point (65 bytes) in base64url, so
 * 87 characters starting with `B` (0x04). `sealPush` checks the point itself.
 */
const publicKey: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^B[A-Za-z0-9_-]{86}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected an uncompressed P-256 public key" }] };

/**
 * Registers the actor's device, or refreshes it (a rotated token or key). The id is made by the app; the same push
 * token registered under another id by the same member (a reinstall) replaces that device, so one phone is never
 * paged twice. A device belongs to whoever registered it: another member's id is `forbidden`. No change is a
 * `conflict`, as for every mutation (RFC 0005). A new device over the member's limit replaces their least recently
 * registered ones (`replaced`): only ever the member's own, so the limit still bounds a page's fan-out.
 */
export const registerDevice = defineMutation({
  name: "device.register",
  args: v.object({
    id: v.id("dev"),
    platform: v.picklist(DEVICE_PLATFORMS),
    environment: v.picklist(PUSH_ENVIRONMENTS),
    pushToken,
    // PushKit's token for calls (RFC 0010, spike S6); null without one.
    voipToken: v.nullable(pushToken),
    publicKey,
    // Whether Critical Alerts are allowed (RFC 0006 "Critical Alerts"). Optional, so apps from before it still
    // register; left out reads as not allowed.
    criticalAlerts: v.optional(v.boolean()),
  }),
  permission: "device:register",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only members register devices");
    if (ctx.server && idTime(args.id) - ctx.now > ID_CLOCK_SKEW_MS) {
      return fail("invalid_args", "Device id time is ahead of the server clock", [
        { path: "id", message: "Id time is too far in the future" },
      ]);
    }
    const userId = ctx.actor.id;
    const events: (DeviceRegistered | DeviceUnregistered)[] = [];
    // The table is server-only: a client's optimistic run only emits the event.
    if (ctx.server) {
      const current = store.get("devices", args.id);
      if (current && current.userId !== userId) {
        return fail("forbidden", "Device belongs to another member");
      }
      const row: DeviceRow = {
        ...args,
        criticalAlerts: args.criticalAlerts === true,
        userId,
        registeredAt: current?.registeredAt ?? ctx.now,
        updatedAt: ctx.now,
        ...(current?.sessionId !== undefined ? { sessionId: current.sessionId } : {}),
      };
      const summary = store.get("member_devices", args.id);
      if (
        current &&
        current.platform === row.platform &&
        current.environment === row.environment &&
        current.pushToken === row.pushToken &&
        current.voipToken === row.voipToken &&
        (current.criticalAlerts ?? false) === row.criticalAlerts &&
        current.publicKey === row.publicKey
      ) {
        // A device registered before summaries existed gets its summary the next time the app registers it.
        if (summary) return fail("conflict", "Device is up to date");
        store.insert("member_devices", deviceSummary(current, ctx.now));
        return ok({
          type: "device.registered",
          subject: args.id,
          data: {
            id: args.id,
            userId,
            platform: current.platform,
            environment: current.environment,
            voip: current.voipToken !== null,
          },
        } satisfies DeviceRegistered);
      }
      const mine = store.scan("devices").filter((device) => device.userId === userId);
      for (const other of mine) {
        if (other.id === args.id || other.pushToken !== args.pushToken) continue;
        forgetDevice(store, other.id);
        events.push({
          type: "device.unregistered",
          subject: other.id,
          data: { id: other.id, userId, reason: "unregistered" },
        });
      }
      if (current) store.update("devices", args.id, row);
      else {
        // Least recently alive first: registered, or confirmed a page (`lastSeenAt`, a receipt), whichever is later,
        // so an on-call phone that pages reach but nobody opens is kept over a dead reinstall.
        const alive = (device: DeviceRow) =>
          Math.max(device.updatedAt, store.get("member_devices", device.id)?.lastSeenAt ?? 0);
        const kept = mine
          .filter((device) => device.pushToken !== args.pushToken)
          .sort((a, b) => alive(a) - alive(b) || a.id.localeCompare(b.id));
        const over = Math.max(0, kept.length - (MAX_DEVICES_PER_MEMBER - 1));
        for (const stale of kept.slice(0, over)) {
          forgetDevice(store, stale.id);
          events.push({
            type: "device.unregistered",
            subject: stale.id,
            data: { id: stale.id, userId, reason: "replaced" },
          });
        }
        store.insert("devices", row);
      }
      if (summary) store.update("member_devices", args.id, deviceSummary(row, ctx.now, summary));
      else store.insert("member_devices", deviceSummary(row, ctx.now));
    }
    events.push({
      type: "device.registered",
      subject: args.id,
      data: {
        id: args.id,
        userId,
        platform: args.platform,
        environment: args.environment,
        voip: args.voipToken !== null,
      },
    });
    return ok(...events);
  },
});

/**
 * Server only, as the member, right after their `device.register` went through or changed nothing (`conflict`):
 * records that they registered it now (`updatedAt`), so a sign-out acted on late (`device.signOut` with `before`)
 * never drops the phone they just registered again, and with `sessionId` the session they registered it with. Not a
 * change to the workspace: `silent`, no event (RFC 0005). Another member's device, or none, is `not_found`.
 */
export const touchDevice = defineMutation({
  name: "device.touch",
  args: v.object({
    id: v.id("dev"),
    sessionId: v.omittable(v.string({ min: 1, max: 128 })),
  }),
  permission: "device:register",
  silent: true,
  apply(store, args, ctx) {
    if (ctx.actor.kind !== "user") return fail("forbidden", "Only members register devices");
    const current = store.get("devices", args.id);
    if (!current || current.userId !== ctx.actor.id) return fail("not_found", "Device not found");
    store.update("devices", args.id, {
      ...current,
      updatedAt: Math.max(ctx.now, current.updatedAt),
      ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
    });
    return ok();
  },
});

/** Stops paging one of the actor's devices (signing out, turning paging off). Another member's is `not_found`. */
export const unregisterDevice = defineMutation({
  name: "device.unregister",
  args: v.object({ id: v.id("dev") }),
  permission: "device:register",
  apply(store, args, ctx) {
    if (ctx.server) {
      const current = store.get("devices", args.id);
      // Another member's device is indistinguishable from none: ids are not a way to probe.
      if (!current || current.userId !== ctx.actor.id) return fail("not_found", "Device not found");
      forgetDevice(store, args.id);
    }
    const event: DeviceUnregistered = {
      type: "device.unregistered",
      subject: args.id,
      data: { id: args.id, userId: ctx.actor.id, reason: "unregistered" },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier: drops a device whose push service said its token is gone (APNs `BadDeviceToken`,
 * `Unregistered`), so later pages do not count it. The app registers again with a fresh token when it next runs.
 * `pushToken` is the token the push went to: a device registered again with a new token while the push was out
 * is kept (`conflict`), since its new token was never tried.
 */
export const expireDevice = defineMutation({
  name: "device.expire",
  args: v.object({ id: v.id("dev"), pushToken }),
  permission: "incident:update",
  apply(store, args) {
    const current = store.get("devices", args.id);
    if (!current) return fail("not_found", "Device not found");
    if (current.pushToken !== args.pushToken) {
      return fail("conflict", "Device was registered again with another token");
    }
    forgetDevice(store, args.id);
    const event: DeviceUnregistered = {
      type: "device.unregistered",
      subject: args.id,
      data: { id: args.id, userId: current.userId, reason: "token_invalid" },
    };
    return ok(event);
  },
});

/**
 * Server only, as the notifier: clears a device's PushKit token after APNs refused a call to it as gone
 * (`BadDeviceToken`, `Unregistered`, `DeviceTokenNotForTopic`), so later pages do not keep calling a dead token. The
 * device stays, and so does its alert token: its pages keep coming as pushes. `voipToken` is the token the call went
 * to: a device registered again with another one meanwhile is kept as it is (`conflict`); so is a device whose token
 * is already cleared. The app gives PushKit's token again when it next registers (RFC 0010).
 */
export const expireVoipToken = defineMutation({
  name: "device.expireVoip",
  args: v.object({ id: v.id("dev"), voipToken: pushToken }),
  permission: "incident:update",
  apply(store, args) {
    const current = store.get("devices", args.id);
    if (!current) return fail("not_found", "Device not found");
    if (current.voipToken !== args.voipToken) {
      return fail("conflict", "Device was registered again with another VoIP token");
    }
    store.update("devices", args.id, { voipToken: null });
    const summary = store.get("member_devices", args.id);
    if (summary) store.update("member_devices", args.id, { voip: false });
    const event: DeviceVoipCleared = {
      type: "device.voip_cleared",
      subject: args.id,
      data: { id: args.id, userId: current.userId, reason: "token_invalid" },
    };
    return ok(event);
  },
});

/**
 * Server only, as `ACCOUNT_ACTOR`: stops paging every device of `userId` in this workspace, after their password was
 * reset (RFC 0002 "Auth"). A reset ends every session, and a phone still registered would keep getting the
 * account's pages without one: the phone of whoever held the account before (someone who signed up with another
 * person's address, or took over the password). The app registers again when its member next signs in. `before`:
 * only the devices last registered before then (the reset's time, when the shard catches up on a sign-out that
 * failed: `WorkspaceDO.fetch`). `deviceId`: only that device, as `unregistered`, when its member signed out on it (the
 * phone names itself on sign-out, so a phone registered in several of the member's workspaces comes off all of them,
 * RFC 0006 "Device registration"); with `before` the sign-out's time, so a sign-out acted on late never drops the
 * phone its member signed in on again since. Nothing to drop is a `conflict`.
 */
export const signOutDevices = defineMutation({
  name: "device.signOut",
  args: v.object({
    userId: v.string({ min: 1, max: 64 }),
    before: v.optional(v.integer({ min: 0, max: Number.MAX_SAFE_INTEGER })),
    deviceId: v.omittable(v.string({ min: 1, max: 64 })),
  }),
  permission: "incident:update",
  apply(store, args, ctx) {
    if (ctx.actor.kind !== ACCOUNT_ACTOR.kind || ctx.actor.id !== ACCOUNT_ACTOR.id) {
      return fail("forbidden", "Only the server signs devices out");
    }
    const events =
      args.deviceId === undefined
        ? dropDevices(store, args.userId, "password_reset", args.before ?? Infinity)
        : dropDevices(store, args.userId, "unregistered", args.before ?? Infinity, args.deviceId);
    if (events.length === 0) return fail("conflict", "No devices to sign out");
    return ok(...events);
  },
});
