// This phone's side of device registration (src/lib/device.ts): its key, notification permission and APNs token,
// and the member's sync client to send `device.register` and `device.unregister` through; and finishing a sign-out
// kept from offline (src/lib/sign-out.ts) with the kept session.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { unregisterPhone, type DeviceDeps } from "@/lib/device";
import { parseLeftover, SIGNED_OUT_KEY, type FinishDeps, type Leftover } from "@/lib/sign-out";
import { memberActor, type Server } from "@/lib/sync";
import { createWorkspaceSync, type WorkspaceSync } from "@/lib/sync-client";
import { BrigadePush } from "../../modules/brigade-push";

export function phoneDeps(sync: WorkspaceSync): DeviceDeps {
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
  };
}

export const saveLeftover = (leftover: Leftover) =>
  SecureStore.setItemAsync(SIGNED_OUT_KEY, JSON.stringify(leftover));

/**
 * Finishing a kept sign-out against `server`, as the member who left: Better Auth's `/get-session` and `/sign-out`
 * with their `Cookie` (and the app's `expo-origin`, as `@better-auth/expo` sends it), and a sync client of their own
 * for `device.unregister`, closed when it answers.
 */
export function finishDeps(server: Server): FinishDeps {
  const headers = (cookie: string) => ({ cookie, "expo-origin": "brigade://" });
  return {
    load: async () => parseLeftover(await SecureStore.getItemAsync(SIGNED_OUT_KEY)),
    save: saveLeftover,
    clear: () => SecureStore.deleteItemAsync(SIGNED_OUT_KEY),
    session: async (cookie) => {
      try {
        const response = await fetch(`${server.auth}/get-session`, { headers: headers(cookie) });
        if (response.status === 401) return false;
        if (!response.ok) return null;
        const body = (await response.json()) as { session?: unknown } | null;
        return Boolean(body?.session);
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
      try {
        return await unregisterPhone(phoneDeps(sync), 10_000);
      } finally {
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
