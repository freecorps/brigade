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
 * the member's least recently alive ones (registered, or confirmed a page; `replaced`): reinstalls make new devices, and the newest phone must
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
 * A device's relay handle was dropped while it keeps its raw tokens (RFC 0015 section 9): the relay said the handle is
 * not this instance's (`handle_not_yours`), so its pages go through `/send` until the app registers a new handle.
 */
export type DeviceHandleCleared = DomainEvent<
  "device.handle_cleared",
  { id: string; userId: string; reason: "handle_not_yours" }
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
    "id" | "userId" | "platform" | "environment" | "voipToken" | "handle" | "voip" | "registeredAt"
  >,
  seenAt: number,
  previous?: DeviceSummaryRow,
): DeviceSummaryRow {
  return {
    id: device.id,
    userId: device.userId,
    platform: device.platform,
    environment: device.environment,
    voip: canRing(device),
    registeredAt: device.registeredAt,
    lastSeenAt: Math.max(seenAt, previous?.lastSeenAt ?? 0),
  };
}

/**
 * Whether a device can ring as a call (RFC 0010): its handle says so (`voip`, RFC 0015) when it has one, else it has a
 * PushKit (or, on Android, call) token.
 */
export function canRing(device: Pick<DeviceRow, "voipToken" | "handle" | "voip">): boolean {
  return device.handle ? device.voip === true : device.voipToken !== null;
}

/**
 * Whether two devices are the same phone's push token: their relay tags when both have one (RFC 0015 section 2), else
 * their raw tokens. A device with only a tag and one with only a raw token never match: the instance cannot tell.
 */
export function samePushToken(
  a: Pick<DeviceRow, "pushToken" | "tag">,
  b: Pick<DeviceRow, "pushToken" | "tag">,
): boolean {
  if (a.tag && b.tag) return a.tag === b.tag;
  return a.pushToken !== null && a.pushToken === b.pushToken;
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
 * A relay handle as `POST /v1/handles` answers it (apps/relay src/handles.ts): `<key id>.<base64url sealed tokens>`.
 * Opaque here; the relay opens it on each send.
 */
const handle: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[A-Za-z0-9]{1,16}\.[A-Za-z0-9_-]{16,2048}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a relay handle" }] };

/** A relay tag: base64url of an HMAC-SHA-256, 43 characters. */
const tag: Validator<string> = (input, path = "") =>
  typeof input === "string" && /^[A-Za-z0-9_-]{43}$/.test(input)
    ? { ok: true, value: input }
    : { ok: false, issues: [{ path, message: "Expected a relay tag" }] };

/**
 * Registers the actor's device, or refreshes it (a rotated token or key). The phone is named to the relay by raw
 * tokens (`pushToken`, `voipToken`: apps that pair with an instance holding the relay's send token, RFC 0006) or by
 * a relay handle and its tag (`handle`, `tag`, `voip`: RFC 0015 section 7, the instance never seeing a token), or
 * both while an instance moves (RFC 0015 section 9); at least one. `envelope: 2` (or more) says the app opens envelope version
 * 2 (RFC 0015 section 4, Q29); left out by older apps, which then get version 1. The id is made by the app; the same
 * push token (the same tag, for handles) registered under another id by the same member (a reinstall) replaces that
 * device, so one phone is never paged twice. A device belongs to whoever registered it: another member's id is
 * `forbidden`. No change is a `conflict`, as for every mutation (RFC 0005). A new device over the member's limit
 * replaces their least recently alive ones (registered, or confirmed a page; `replaced`): only ever the member's own,
 * so the limit still bounds a page's fan-out.
 */
export const registerDevice = defineMutation({
  name: "device.register",
  args: v.object({
    id: v.id("dev"),
    platform: v.picklist(DEVICE_PLATFORMS),
    environment: v.picklist(PUSH_ENVIRONMENTS),
    // Left out by an app that registers with a handle alone.
    pushToken: v.optional(v.nullable(pushToken)),
    // PushKit's token for calls (RFC 0010, spike S6); null or left out without one.
    voipToken: v.optional(v.nullable(pushToken)),
    handle: v.optional(v.nullable(handle)),
    tag: v.optional(v.nullable(tag)),
    // Whether the handle can ring as a call; only with a handle.
    voip: v.omittable(v.boolean()),
    // The newest envelope version the app opens; a later one (3, …) is stored as 2, the newest this instance seals.
    envelope: v.omittable(v.integer({ min: 2, max: 1000 })),
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
    if (args.pushToken === null && args.handle === null) {
      return fail("invalid_args", "A device needs a push token or a relay handle", [
        { path: "pushToken", message: "Expected a push token or a relay handle" },
      ]);
    }
    if ((args.handle === null) !== (args.tag === null)) {
      return fail("invalid_args", "A relay handle comes with its tag", [
        { path: args.handle === null ? "handle" : "tag", message: "Expected both or neither" },
      ]);
    }
    if (args.pushToken === null && args.voipToken !== null) {
      return fail("invalid_args", "A VoIP token comes with its push token", [
        { path: "voipToken", message: "Expected no VoIP token without a push token" },
      ]);
    }
    if (args.handle === null && args.voip !== undefined) {
      return fail("invalid_args", "voip says whether a relay handle can ring", [
        { path: "voip", message: "Expected no voip without a relay handle" },
      ]);
    }
    const userId = ctx.actor.id;
    const events: (DeviceRegistered | DeviceUnregistered)[] = [];
    const ringable = canRing(args);
    // The table is server-only: a client's optimistic run only emits the event.
    if (ctx.server) {
      const current = store.get("devices", args.id);
      if (current && current.userId !== userId) {
        return fail("forbidden", "Device belongs to another member");
      }
      // Every field written, null when not given: `update` merges, so a phone that moved from raw tokens to a handle
      // (or back) keeps nothing of the other.
      const row: DeviceRow = {
        id: args.id,
        userId,
        platform: args.platform,
        environment: args.environment,
        pushToken: args.pushToken,
        voipToken: args.voipToken,
        handle: args.handle,
        tag: args.tag,
        voip: args.handle !== null && args.voip === true,
        envelope: args.envelope === undefined ? null : 2,
        publicKey: args.publicKey,
        criticalAlerts: args.criticalAlerts === true,
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
        (current.handle ?? null) === row.handle &&
        (current.tag ?? null) === row.tag &&
        (current.voip ?? false) === row.voip &&
        (current.envelope ?? null) === row.envelope &&
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
            voip: canRing(current),
          },
        } satisfies DeviceRegistered);
      }
      const mine = store.scan("devices").filter((device) => device.userId === userId);
      for (const other of mine) {
        if (other.id === args.id || !samePushToken(other, row)) continue;
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
          .filter((device) => !samePushToken(device, row))
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
        voip: ringable,
      },
    });
    return ok(...events);
  },
});

/**
 * Server only, as the member, right after their `device.register` went through or changed nothing (`conflict`):
 * records that they registered it now (`updatedAt`, and its summary's `lastSeenAt`, so "last heard from" and the
 * order replacement goes by agree), so a sign-out acted on late (`device.signOut` with `before`) never drops the
 * phone they just registered again, and with `sessionId` the session they registered it with. Not a
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
    // The phone just spoke to the shard: what the dashboard shows as "last heard from", and what replacement counts.
    const summary = store.get("member_devices", args.id);
    if (summary && summary.lastSeenAt < ctx.now) {
      store.update("member_devices", args.id, { lastSeenAt: ctx.now });
    }
    return ok();
  },
});

/**
 * Stops paging one of the actor's devices (signing out, removing it from the dashboard's "Your phones"). Another
 * member's is `not_found`. A client's optimistic run drops the synced summary of its own device, so the phone leaves
 * the member's list at once.
 */
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
    } else {
      const summary = store.get("member_devices", args.id);
      if (summary?.userId === ctx.actor.id) store.delete("member_devices", args.id);
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
 * `Unregistered`), or whose relay handle is no longer this instance's (`403 handle_not_yours` after a lost instance
 * key: RFC 0015 "Dead ends"), so later pages do not count it. The app registers again with a fresh token (and handle)
 * when it next runs. `pushToken` is the token the push went to, or `handle` the relay handle it went to (exactly
 * one): a device registered again meanwhile (another token, or a new handle, even for the same token and tag) is
 * kept (`conflict`), since what it registered was never tried. `handleOnly`: only the handle is dead, not the phone's
 * token, so a device that also has a raw token keeps it and loses only its handle (`device.handle_cleared`); one with
 * the handle alone is dropped.
 */
export const expireDevice = defineMutation({
  name: "device.expire",
  args: v.object({
    id: v.id("dev"),
    pushToken: v.omittable(pushToken),
    handle: v.omittable(handle),
    handleOnly: v.omittable(v.literal(true)),
  }),
  permission: "incident:update",
  apply(store, args) {
    if ((args.pushToken === undefined) === (args.handle === undefined)) {
      return fail("invalid_args", "Expected the push token or the relay handle the push went to");
    }
    if (args.handleOnly && args.handle === undefined) {
      return fail("invalid_args", "handleOnly comes with the relay handle");
    }
    const current = store.get("devices", args.id);
    if (!current) return fail("not_found", "Device not found");
    const same =
      args.handle !== undefined
        ? current.handle === args.handle
        : current.pushToken === args.pushToken;
    if (!same) return fail("conflict", "Device was registered again since");
    if (args.handleOnly && current.pushToken !== null) {
      store.update("devices", args.id, { handle: null, tag: null, voip: false });
      const summary = store.get("member_devices", args.id);
      const voip = current.voipToken !== null;
      if (summary && summary.voip !== voip) store.update("member_devices", args.id, { voip });
      const event: DeviceHandleCleared = {
        type: "device.handle_cleared",
        subject: args.id,
        data: { id: args.id, userId: current.userId, reason: "handle_not_yours" },
      };
      return ok(event);
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
 * device stays, and so does its alert token: its pages keep coming as pushes. `voipToken` is the PushKit token the
 * call went to (cleared), or `handle` the relay handle it went to (its `voip` turned off, RFC 0015; the handle, not
 * the tag, since a registration with a new PushKit token keeps the tag): a device registered again with another one
 * meanwhile is kept as it is (`conflict`); so is a device that already does not ring. The app gives PushKit's token
 * again when it next registers (RFC 0010).
 */
export const expireVoipToken = defineMutation({
  name: "device.expireVoip",
  args: v.object({
    id: v.id("dev"),
    voipToken: v.omittable(pushToken),
    handle: v.omittable(handle),
  }),
  permission: "incident:update",
  apply(store, args) {
    if ((args.voipToken === undefined) === (args.handle === undefined)) {
      return fail("invalid_args", "Expected the VoIP token or the relay handle the call went to");
    }
    const current = store.get("devices", args.id);
    if (!current) return fail("not_found", "Device not found");
    if (args.handle !== undefined) {
      if (current.handle !== args.handle || current.voip !== true) {
        return fail("conflict", "Device was registered again with another handle");
      }
      store.update("devices", args.id, { voip: false });
    } else {
      if (current.voipToken !== args.voipToken) {
        return fail("conflict", "Device was registered again with another VoIP token");
      }
      store.update("devices", args.id, { voipToken: null });
    }
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
