import type { ConfigContext, ExpoConfig } from "expo/config";
// By path, not "@freecorps/brigade-ui": Expo's config loader does not use the @freecorps/source
// condition, so the package name would need packages/ui built first.
import { themes } from "../../packages/ui/src/tokens.ts";
import { withSplashGround } from "./plugins/splash-ground.ts";

// One id on both stores, registered under the Freecorps Apple team. Same `app.freecorps.*` prefix as
// Freecorps' other apps.
const APP_ID = "app.freecorps.brigade";

export default ({ config }: ConfigContext): ExpoConfig =>
  // iOS: point the launch screen at the splash ground, which expo-splash-screen skips without an image.
  withSplashGround(appConfig(config), { fallback: themes.light.background });

const appConfig = (config: ConfigContext["config"]): ExpoConfig => ({
  ...config,
  name: "Brigade",
  slug: "brigade",
  // The EAS project belongs to the Freecorps organisation, not a personal account.
  owner: "freecorps",
  // Deep links (`brigade://`), and the dev client's own URL scheme.
  scheme: "brigade",
  version: "0.1.0",
  orientation: "portrait",
  // Follow the system light/dark setting; the app picks packages/ui's theme from it.
  userInterfaceStyle: "automatic",
  // The window behind the app before React draws: the page ground. The root layout updates it to
  // the current theme at runtime (expo-system-ui).
  backgroundColor: themes.light.background,
  ios: {
    bundleIdentifier: APP_ID,
    // Phone-first. On iPad the app runs in iPhone compatibility mode until a tablet layout exists.
    supportsTablet: false,
    // Only standard encryption (HTTPS, CryptoKit for push payloads): exempt from export documentation.
    config: { usesNonExemptEncryption: false },
  },
  android: {
    package: APP_ID,
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "single",
  },
  plugins: [
    "expo-router",
    [
      "expo-localization",
      {
        // Lets people pick Brigade's language apart from the system one (Android 13+ app languages,
        // iOS per-app language), and tells the OS which locales the app ships.
        supportedLocales: { ios: ["en", "pt-BR"], android: ["en", "pt-BR"] },
      },
    ],
    [
      "expo-splash-screen",
      {
        // No image yet: a plain ground in the system theme, so a 3 a.m. cold start is not a white flash.
        backgroundColor: themes.light.background,
        dark: { backgroundColor: themes.dark.background },
      },
    ],
  ],
  // EAS project `@freecorps/brigade`. `eas init` cannot write to a dynamic config, so it lives here. Not a
  // secret.
  extra: {
    eas: { projectId: "67e9e504-0692-4883-88d5-8e17863f661d" },
  },
});
