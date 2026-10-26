// This phone's side of device registration (src/lib/device.ts): its key, notification permission and APNs token,
// and the member's sync client to send `device.register` and `device.unregister` through.
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import type { DeviceDeps } from "@/lib/device";
import type { WorkspaceSync } from "@/lib/sync-client";
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
