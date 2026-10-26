// This phone's side of device registration (src/lib/device.ts): its key, notification permission and APNs token,
// and the member's sync client to send `device.register` and `device.unregister` through; and finishing a sign-out
// kept from offline (src/lib/sign-out.ts) with the kept session.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { unregisterPhone, type DeviceDeps } from "@/lib/device";
import { SESSION_LIFETIME_S } from "@freecorps/brigade-schema";
import { leftovers, SIGNED_OUT_KEY, type FinishDeps } from "@/lib/sign-out";
import { memberActor, neverOpened, type Server } from "@/lib/sync";
import { createWorkspaceSync, type WorkspaceSync } from "@/lib/sync-client";
import { BrigadePush } from "../../modules/brigade-push";

export function phoneDeps(sync: WorkspaceSync, server?: Server): DeviceDeps {
  const keys = BrigadePush;
  return {
    platform: process.env.EXPO_OS === "ios" ? "ios" : "android",
    apsEnvironment: Constants.expoConfig?.extra?.apsEnvironment,
    // iOS only for now (spike S1): Android has no device key until FCM (RFC 0006).
    publicKey: keys ? () => keys.getPublicKey() : null,
    permission: async () => {
      const { status } = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      });
      return status === "granted";
    },
    pushToken: async () => String((await Notifications.getDevicePushTokenAsync()).data),
    mutate: (name, args) => sync.client.mutate(sync.shard, name, args as never),
    // Delivery receipts go only to the instance this phone registered with (RFC 0006 "Delivery receipts").
    ...(server && keys?.setReceiptOrigin
      ? {
          receiptOrigin: { origin: server.auth, keep: (origin) => keys.setReceiptOrigin?.(origin) },
        }
      : {}),
  };
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
        return await unregisterPhone(phoneDeps(sync), 10_000, refused.promise);
      } finally {
        refused.dispose();
        sync.client.close();
      }
    },
    signOut: async (cookie) => {
      try {
        const response = await fetch(`${server.auth}/sign-out`, {
          method: "POST",
          headers: { ...headers(cookie), "content-type": "application/json" },
          body: "{}",
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
