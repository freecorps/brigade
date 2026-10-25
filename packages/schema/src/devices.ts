// Devices that can be paged (RFC 0006 "Device registration"): a member's phone, with its push tokens and the public
// key pushes are sealed to. Server-only: tokens and keys never reach another member, and the `device.*` events
// carry neither.

import { ID_CLOCK_SKEW_MS } from "./incidents.ts";
import { idTime } from "./id.ts";
import { defineMutation, fail, ok, type Actor, type DomainEvent } from "./mutation.ts";
import type { DeviceRow } from "./tables.ts";
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

/** Devices one member may register in one workspace; a page fans out to all of them. */
export const MAX_DEVICES_PER_MEMBER = 10;

/** Why a device stopped being paged. */
export type DeviceRemoval = "unregistered" | "token_invalid";

export type DeviceRegistered = DomainEvent<
  "device.registered",
  Pick<DeviceRow, "id" | "userId" | "platform" | "environment"> & { voip: boolean }
>;
export type DeviceUnregistered = DomainEvent<
  "device.unregistered",
  { id: string; userId: string; reason: DeviceRemoval }
>;

/**
 * Who reports what a page did (RFC 0005 "Notifiers"): the queue consumer records failed pages through it. Server-only
 * mutations are reachable only from the shard's own code, so its role grants no member anything.
 */
export const NOTIFIER_ACTOR: Actor = { kind: "system", id: "sys_notifier", role: "admin" };

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
 * `conflict`, as for every mutation (RFC 0005).
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
        userId,
        registeredAt: current?.registeredAt ?? ctx.now,
        updatedAt: ctx.now,
      };
      if (
        current &&
        current.platform === row.platform &&
        current.environment === row.environment &&
        current.pushToken === row.pushToken &&
        current.voipToken === row.voipToken &&
        current.publicKey === row.publicKey
      ) {
        return fail("conflict", "Device is up to date");
      }
      const mine = store.scan("devices").filter((device) => device.userId === userId);
      for (const other of mine) {
        if (other.id === args.id || other.pushToken !== args.pushToken) continue;
        store.delete("devices", other.id);
        events.push({
          type: "device.unregistered",
          subject: other.id,
          data: { id: other.id, userId, reason: "unregistered" },
        });
      }
      if (current) store.update("devices", args.id, row);
      else {
        if (
          mine.filter((device) => device.pushToken !== args.pushToken).length >=
          MAX_DEVICES_PER_MEMBER
        ) {
          return fail("conflict", `At most ${MAX_DEVICES_PER_MEMBER} devices per member`);
        }
        store.insert("devices", row);
      }
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
      store.delete("devices", args.id);
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
    store.delete("devices", args.id);
    const event: DeviceUnregistered = {
      type: "device.unregistered",
      subject: args.id,
      data: { id: args.id, userId: current.userId, reason: "token_invalid" },
    };
    return ok(event);
  },
});
