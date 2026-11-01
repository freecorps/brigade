// The app's Better Auth clients (RFC 0002): email and password against an instance's `/api/auth`, the session kept in
// the Keychain or Android Keystore (expo-secure-store) by `@better-auth/expo`, which sends it back as a `Cookie` header
// and the app's scheme as `expo-origin` (apps/api/src/auth.ts, `APP_ORIGIN`). One per instance (RFC 0015 section 5),
// each under its own storage prefix (src/lib/instances.ts `instanceStorage`); src/lib/instance-clients.ts makes them.
import { expoClient, getCookie, getSetCookie, storageAdapter } from "@better-auth/expo/client";
import { inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import type * as SecureStore from "expo-secure-store";
import { defaultBuildOrigin } from "@/lib/build-origin";
import { SessionExists } from "@/lib/qr-sign-in";

/** The origin of the build's default instance; undefined for a release build without EXPO_PUBLIC_BRIGADE_URL. */
export const defaultOrigin = defaultBuildOrigin();

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

/**
 * Whether a session is kept under `storagePrefix` (one not past its cookie's expiry, as `@better-auth/expo` reads it).
 * Storage that cannot be read counts as one: a session may be there.
 */
export async function sessionKept(
  storage: SessionStorage,
  storagePrefix: string,
): Promise<boolean> {
  try {
    const raw = await storageAdapter(storage).getItemAsync(`${storagePrefix}_cookie`);
    return getCookie(raw ?? "{}").includes("session_token=");
  } catch {
    return true;
  }
}

/**
 * Keeps a session the server made for this phone (a QR sign-in's `Set-Cookie`, RFC 0015 section 6) where
 * `@better-auth/expo` keeps the one a password sign-in gets: `<storagePrefix>_cookie`, merged as its own `getSetCookie`
 * merges an answer's cookies, through its own storage wrapper (chunked values, one write at a time per key). Only the
 * instance whose prefix is given gets it. The client then reads it as its session (`$sessionSignal`). Throws
 * `SessionExists` when a session is kept there already, which this never replaces.
 */
export async function storeSessionCookie(
  storage: SessionStorage,
  storagePrefix: string,
  setCookie: string,
): Promise<void> {
  const managed = storageAdapter(storage);
  const key = `${storagePrefix}_cookie`;
  const previous = await managed.getItemAsync(key);
  // A session kept there already is never replaced: its member may be on call there, and the phone registered for
  // them. Signing out of it first (the app's own sign-out, which unregisters the phone) is the member's choice.
  if (getCookie(previous ?? "{}").includes("session_token=")) throw new SessionExists();
  const next = getSetCookie(setCookie, previous ?? undefined);
  if (next === "{}") throw new Error("No session in the answer");
  await managed.setItemAsync(key, next);
  // The managed write logs and swallows a failure: read it back, so a session not kept is said.
  if ((await managed.getItemAsync(key)) !== next) throw new Error("The session was not kept");
  // The last session read there (offline start) was someone's before: the new one is read from the server.
  await managed.setItemAsync(`${storagePrefix}_session_data`, "{}");
}
