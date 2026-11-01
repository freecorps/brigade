// The app's Better Auth clients (RFC 0002): email and password against an instance's `/api/auth`, the session kept in
// the Keychain or Android Keystore (expo-secure-store) by `@better-auth/expo`, which sends it back as a `Cookie` header
// and the app's scheme as `expo-origin` (apps/api/src/auth.ts, `APP_ORIGIN`). One per instance (RFC 0015 section 5),
// each under its own storage prefix (src/lib/instances.ts `instanceStorage`); src/lib/instance-clients.ts makes them.
import { expoClient } from "@better-auth/expo/client";
import { inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import type * as SecureStore from "expo-secure-store";
import { buildOrigin } from "@/lib/sync";

/** The origin of the build's default instance; undefined for a release build without EXPO_PUBLIC_BRIGADE_URL. */
export const defaultOrigin = buildOrigin({
  override: process.env.EXPO_PUBLIC_BRIGADE_URL,
  hostUri: Constants.expoConfig?.hostUri,
  dev: __DEV__,
});

/** Where `@better-auth/expo` keeps the session: expo-secure-store, or a fake one in tests. */
export type SessionStorage = Pick<
  typeof SecureStore,
  "getItem" | "getItemAsync" | "setItem" | "setItemAsync"
>;

/**
 * Made by a function so src/lib/auth-client.test.ts can run it in Node against fake storage and network.
 * `storagePrefix`: `brigade` for the build's default instance (the keys from before several instances, so an existing
 * install stays signed in), `brigade:<instance id>` for every other.
 */
export function brigadeAuthClient(
  baseURL: string,
  storage: SessionStorage,
  storagePrefix = "brigade",
) {
  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({
        scheme: "brigade",
        // Keys in secure storage: `<prefix>_cookie` (the session) and `<prefix>_session_data` (the last session
        // read, so the app opens signed in without the network); `:` is written `_`.
        storagePrefix,
        storage,
      }),
      organizationClient(),
      // `locale`: the language Brigade writes to the user in, set at sign-up (apps/api src/auth.ts).
      inferAdditionalFields({ user: { locale: { type: "string", required: false } } }),
    ],
  });
}

export type AuthClient = ReturnType<typeof brigadeAuthClient>;

/**
 * Signs out here only: `@better-auth/expo` forgets the stored session before a `/sign-out` request goes out, and
 * this one never does, so the server keeps the session (src/lib/sign-out.ts keeps it aside to finish with).
 */
export async function forgetSession(client: Pick<AuthClient, "signOut">): Promise<void> {
  try {
    await client.signOut({
      fetchOptions: {
        customFetchImpl: () => Promise.reject(new Error("Signed out on this phone only")),
      },
    });
  } catch {
    // The request that never went out.
  }
}
