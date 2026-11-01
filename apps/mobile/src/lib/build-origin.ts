// The origin of the build's default instance (RFC 0015 section 5): EXPO_PUBLIC_BRIGADE_URL, or the dev server on the
// Metro host in a development build; undefined for a release build without it. Read when asked, so modules that only
// import it (and their Node tests) need no React Native globals.
import Constants from "expo-constants";
import { buildOrigin } from "@/lib/sync";

export function defaultBuildOrigin(): string | undefined {
  return buildOrigin({
    override: process.env.EXPO_PUBLIC_BRIGADE_URL,
    hostUri: Constants.expoConfig?.hostUri,
    dev: typeof __DEV__ !== "undefined" && __DEV__,
  });
}
