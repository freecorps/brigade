// The app's Better Auth client (RFC 0002): email and password against the dashboard's `/api/auth`, the session
// kept in the Keychain or Android Keystore (expo-secure-store) by `@better-auth/expo`, which sends it back as a
// `Cookie` header and the app's scheme as `expo-origin` (apps/api/src/auth.ts, `APP_ORIGIN`).
import { expoClient } from "@better-auth/expo/client";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { brigadeServer } from "@/lib/sync";

/** Where this build signs in and syncs; undefined for a release build without EXPO_PUBLIC_BRIGADE_URL. */
export const server = brigadeServer({
  override: process.env.EXPO_PUBLIC_BRIGADE_URL,
  hostUri: Constants.expoConfig?.hostUri,
  dev: __DEV__,
});

export const authClient = createAuthClient({
  // Without a server every request fails as a network error, and sign-in says the build has no server.
  baseURL: server?.auth ?? "http://localhost.invalid/api/auth",
  plugins: [
    expoClient({
      scheme: "brigade",
      // Keys in secure storage: `brigade_cookie` (the session) and `brigade_session_data` (the last session read,
      // so the app opens signed in without the network).
      storagePrefix: "brigade",
      storage: SecureStore,
    }),
    organizationClient(),
  ],
});
