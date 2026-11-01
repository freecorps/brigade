// This phone's side of device registration (src/lib/device.ts): its key, notification permission, APNs and PushKit
// tokens (FCM's on Android),
// and the member's sync client to send `device.register` and `device.unregister` through; and finishing a sign-out
// kept from offline (src/lib/sign-out.ts) with the kept session.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import {
  deviceId,
  devicePublicKey,
  unregisterPhone,
  type DeviceDeps,
  type RegisterAnswer,
} from "@/lib/device";
import { DEVICE_HEADER, SESSION_LIFETIME_S } from "@freecorps/brigade-schema";
import { PHONE_WORKSPACES_KEY, phoneWorkspacesStore } from "@/lib/phone-workspaces";
import {
  inTime,
  leftovers,
  SIGN_OUT_TIMEOUT_MS,
  SIGNED_OUT_KEY,
  type FinishDeps,
} from "@/lib/sign-out";
import { memberActor, neverOpened, type Server } from "@/lib/sync";
import { createWorkspaceSync, type WorkspaceSync } from "@/lib/sync-client";
import { knownTokens, permissionAsks } from "@/lib/paging";
import { BrigadeCall } from "../../modules/brigade-call";
import { BrigadePush } from "../../modules/brigade-push";

/**
 * Whether this build has the Critical Alerts entitlement (`BRIGADE_CRITICAL_ALERTS=1` at build time, RFC 0006
 * "Critical Alerts"). Asking for them without it is ignored by iOS, so it is only asked when set.
 */
const CRITICAL_ALERTS = Constants.expoConfig?.extra?.criticalAlerts === true;

/**
 * `server`'s `POST /devices/register` with the member's session: the phone registered in every workspace it was opened
 * in at once (RFC 0006 "Device registration").
 */
export function registerAllWith(
  server: Server,
  cookie: () => Promise<string>,
): NonNullable<DeviceDeps["registerAll"]> {
  return async (args, workspaces) => {
    let response: Response;
    try {
      response = await fetch(server.devices, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          cookie: await cookie(),
        },
        body: JSON.stringify({ device: args, workspaces }),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    const body: unknown = await response.json().catch(() => null);
    const answers =
      typeof body === "object" && body !== null ? Reflect.get(body, "workspaces") : undefined;
    if (!response.ok || typeof answers !== "object" || answers === null) {
      return { ok: false, status: response.ok ? 502 : response.status };
    }
    return { ok: true, workspaces: answers as Record<string, string> } satisfies RegisterAnswer;
  };
}

/** The workspaces this phone pages the signed-in member for, in secure storage (src/lib/phone-workspaces.ts). */
export const phoneWorkspaces = phoneWorkspacesStore({
  read: () => SecureStore.getItemAsync(PHONE_WORKSPACES_KEY),
  write: (raw) =>
    raw === null
      ? SecureStore.deleteItemAsync(PHONE_WORKSPACES_KEY)
      : SecureStore.setItemAsync(PHONE_WORKSPACES_KEY, raw),
});

/** The push tokens fetched to register, so the token listener asks for a registration only for a new one. */
export const pushTokens = knownTokens();

/** The app's notification permission requests, so coming back from one is not taken as the member coming back. */
export const permissions = permissionAsks();

export function phoneDeps(
  sync: WorkspaceSync,
  server?: Server,
  registerAll?: DeviceDeps["registerAll"],
): DeviceDeps {
  const keys = BrigadePush;
  const android = process.env.EXPO_OS === "android";
  // Android pages through FCM (RFC 0006): a build without Firebase has no token to give, and says so ("unsupported").
  const pageable = keys !== null && (!android || keys.fcmAvailable === true);
  const pushToken = () =>
    pushTokens.fetch(async () => String((await Notifications.getDevicePushTokenAsync()).data));
  return {
    platform: process.env.EXPO_OS === "ios" ? "ios" : "android",
    apsEnvironment: Constants.expoConfig?.extra?.apsEnvironment,
    // In the Keychain on iOS, the Android Keystore on Android (modules/brigade-push): one per instance (RFC 0015).
    publicKey: pageable ? () => devicePublicKey(keys, server?.auth) : null,
    permission: async () => {
      // Android shows its permission screen for every request, even one granted already: asked only when it is not.
      // iOS asks again for Critical Alerts, which a phone granted notifications before the entitlement never was.
      if (android && (await Notifications.getPermissionsAsync()).status === "granted") return true;
      const { status } = await permissions.ask(() =>
        Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowSound: true,
            allowBadge: false,
            ...(CRITICAL_ALERTS ? { allowCriticalAlerts: true } : {}),
          },
        }),
      );
      return status === "granted";
    },
    // Read every registration: the member can turn them off in Settings at any time.
    ...(CRITICAL_ALERTS && process.env.EXPO_OS === "ios"
      ? {
          criticalAlerts: async () =>
            (await Notifications.getPermissionsAsync()).ios?.allowsCriticalAlerts === true,
        }
      : {}),
    pushToken,
    // Pages that ring as calls (RFC 0010). iOS: the module reports every VoIP push to CallKit, so its token is safe to
    // give. Android: a call is an FCM data message the app rings for, so the call token is the FCM token again.
    ...(BrigadeCall ? { voipToken: android ? pushToken : () => BrigadeCall!.getVoipToken() } : {}),
    mutate: (name, args) => sync.client.mutate(sync.shard, name, args as never),
    ...(registerAll ? { registerAll } : {}),
    // Delivery receipts go only to the instance this phone registered with (RFC 0006 "Delivery receipts").
    ...(server && keys?.setReceiptOrigin
      ? {
          receiptOrigin: { origin: server.auth, keep: (origin) => keys.setReceiptOrigin?.(origin) },
        }
      : {}),
  };
}

/**
 * This phone's device id, sent on sign-out (`DEVICE_HEADER`) so the server takes it off every workspace of the member,
 * not only the one the app has open. Undefined without a device key (an Android build without Firebase), which
 * registers nowhere.
 */
export async function phoneDeviceId(origin?: string): Promise<string | undefined> {
  try {
    if (!BrigadePush || (process.env.EXPO_OS === "android" && BrigadePush.fcmAvailable !== true)) {
      return undefined;
    }
    return deviceId(await devicePublicKey(BrigadePush, origin));
  } catch {
    return undefined;
  }
}

/** The sign-outs kept from offline, in secure storage: one list for the app, so its changes run in turn. */
export const keptSignOuts = leftovers({
  read: () => SecureStore.getItemAsync(SIGNED_OUT_KEY),
  write: (raw) =>
    raw === null
      ? SecureStore.deleteItemAsync(SIGNED_OUT_KEY)
      : SecureStore.setItemAsync(SIGNED_OUT_KEY, raw),
});

/** How long a session lasts on the server, in ms (Better Auth's `expiresIn`). */
export const SESSION_LIFETIME_MS = SESSION_LIFETIME_S * 1000;

/**
 * Finishing kept sign-outs against `server`, as the member who left: Better Auth's `/get-session` (without
 * refreshing the session, so asking does not keep it alive; it says when the session expires) and `/sign-out` with
 * their `Cookie` (and the app's
 * `expo-origin`, as `@better-auth/expo` sends it), and a sync client of their own for `device.unregister`, closed
 * when it answers.
 */
export function finishDeps(server: Server): FinishDeps {
  const headers = (cookie: string) => ({ cookie, "expo-origin": "brigade://" });
  return {
    leftovers: keptSignOuts,
    origin: server.auth,
    now: Date.now,
    lifetime: SESSION_LIFETIME_MS,
    session: async (cookie) => {
      try {
        const response = await fetch(`${server.auth}/get-session?disableRefresh=true`, {
          headers: headers(cookie),
        });
        if (response.status === 401) return false;
        if (!response.ok) return null;
        const body = (await response.json()) as { session?: { expiresAt?: unknown } } | null;
        if (!body?.session) return false;
        const expiresAt = Date.parse(String(body.session.expiresAt));
        // An expiry it cannot read: as long as the server could keep it.
        return {
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + SESSION_LIFETIME_MS,
        };
      } catch {
        return null;
      }
    },
    unregister: async (leftover) => {
      const sync = createWorkspaceSync({
        server,
        workspaceId: leftover.workspaceId,
        // Only for the optimistic run: every role may unregister its own devices.
        actor: () => memberActor(leftover.userId, undefined),
        cookie: () => leftover.cookie,
      });
      // A socket that never opens (the upgrade refused, as for a removed member's 403, or the server unreachable)
      // ends the try at once instead of after the timeout. It stays pending and is tried again on the backoff:
      // nothing else can take the device off as them (RFC 0006 "A handed-over phone").
      const refused = neverOpened(sync.client, sync.shard);
      try {
        return await unregisterPhone(phoneDeps(sync, server), 10_000, refused.promise);
      } finally {
        refused.dispose();
        sync.client.close();
      }
    },
    signOut: (cookie) =>
      inTime(
        async () => {
          const device = await phoneDeviceId(server.auth);
          const response = await fetch(`${server.auth}/sign-out`, {
            method: "POST",
            headers: {
              ...headers(cookie),
              "content-type": "application/json",
              // The member's other workspaces: the shard of the kept one was told already.
              ...(device ? { [DEVICE_HEADER]: device } : {}),
            },
            body: "{}",
          });
          return response.ok;
        },
        SIGN_OUT_TIMEOUT_MS,
        false,
      ),
  };
}
