import { join } from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";
// By path, not "@freecorps/brigade-ui": Expo's config loader does not use the @freecorps/source
// condition, so the package name would need packages/ui built first.
import { themes } from "../../packages/ui/src/tokens.ts";
import { appId } from "./plugins/app-id.ts";
import { cameraUsage } from "./plugins/camera-usage.ts";
import { googleServicesFile } from "./plugins/google-services.ts";
import { withIncomingCall } from "./plugins/incoming-call.ts";
import { withNotificationService } from "./plugins/notification-service.ts";
import { withPendingBackup } from "./plugins/pending-backup.ts";
import { withSplashGround } from "./plugins/splash-ground.ts";
import { withWidget } from "./plugins/widget.ts";

// One id on both stores: the store app's `app.freecorps.brigade` (registered under the Freecorps Apple team) unless
// `BRIGADE_APP_ID` names a company's own build. The App Group follows it (plugins/app-id.ts).
const APP_ID = appId();

// APNs environment the build's signing matches. Local Xcode builds use a development profile (sandbox device
// tokens); every EAS build is ad hoc or App Store signed, whose profiles carry `production`. The release workflow
// (.github/workflows/mobile.yml) sets BRIGADE_APS_ENVIRONMENT so the fingerprint it computes outside a build, for
// `eas update`, is the build's own.
const APS_ENVIRONMENT =
  process.env.BRIGADE_APS_ENVIRONMENT === "production" || process.env.EAS_BUILD === "true"
    ? "production"
    : "development";

// Critical Alerts (RFC 0006 "Critical Alerts"): `BRIGADE_CRITICAL_ALERTS=1` adds the entitlement and has the app ask
// for them. Off by default: Apple has not granted the entitlement to the team yet, and a profile without it fails
// the build. Without it, pages are time-sensitive, as on every build so far.
const CRITICAL_ALERTS = process.env.BRIGADE_CRITICAL_ALERTS === "1";

// Android pages through FCM (RFC 0006): the Firebase project's `google-services.json`, from outside the repository.
// Without it the app builds with no FCM token and says pages are not set up on the phone.
const GOOGLE_SERVICES_FILE = googleServicesFile();

export default ({ config, projectRoot }: ConfigContext): ExpoConfig =>
  // iOS: the Notification Service Extension that decrypts pushes (spike S1), the "I'm on call" widget (after the
  // extension, whose App Group it shares), and the launch screen pointed at the splash ground, which
  // expo-splash-screen skips without an image. Both: pages that ring as calls (S6). Android: the queue of unsent
  // changes kept out of backups (RFC 0004 "Clients").
  withPendingBackup(
    withIncomingCall(
      withWidget(
        withNotificationService(
          withSplashGround(appConfig(config, projectRoot), {
            fallback: themes.light.background,
          }),
          { apsEnvironment: APS_ENVIRONMENT, criticalAlerts: CRITICAL_ALERTS },
        ),
      ),
    ),
  );

const appConfig = (config: ConfigContext["config"], projectRoot: string): ExpoConfig => {
  // The camera scans the dashboard's "Use the app" QR code (RFC 0015 sections 5 and 6); why, in each locale the app
  // ships, from packages/i18n (plugins/camera-usage.ts).
  const camera = cameraUsage(join(projectRoot, "../../packages/i18n/messages"));
  return {
    ...config,
    name: "Brigade",
    slug: "brigade",
    // The EAS project belongs to the Freecorps organisation, not a personal account.
    owner: "freecorps",
    // Deep links (`brigade://`), and the dev client's own URL scheme.
    scheme: "brigade",
    version: "0.1.0",
    orientation: "portrait",
    // Placeholder until the real icon: the dashboard's two rank chevrons (apps/web site-header.tsx) in white on the
    // brand hue (packages/ui `--primary`), opaque as the App Store requires.
    icon: "./assets/icon.png",
    // Follow the system light/dark setting; the app picks packages/ui's theme from it.
    userInterfaceStyle: "automatic",
    // The window behind the app before React draws: the page ground. The root layout updates it to
    // the current theme at runtime (expo-system-ui).
    backgroundColor: themes.light.background,
    ios: {
      bundleIdentifier: APP_ID,
      // Local builds only, for automatic signing (`xcodebuild -allowProvisioningUpdates`); EAS signs with its own
      // credentials. Read from the environment so the team id stays out of the repository.
      ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
      // Phone-first. On iPad the app runs in iPhone compatibility mode until a tablet layout exists.
      supportsTablet: false,
      // Only standard encryption (HTTPS, CryptoKit for push payloads): exempt from export documentation.
      config: { usesNonExemptEncryption: false },
    },
    android: {
      package: APP_ID,
      // The same chevrons inside the adaptive icon's safe zone, over the brand hue.
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: themes.light.primary,
      },
      predictiveBackGestureEnabled: false,
      ...(GOOGLE_SERVICES_FILE ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
    },
    web: {
      output: "single",
    },
    // System prompts in the app's languages: the camera's, for scanning the dashboard's QR code.
    locales: {
      en: { ios: { NSCameraUsageDescription: camera.en } },
      "pt-BR": { ios: { NSCameraUsageDescription: camera["pt-BR"] } },
    },
    plugins: [
      "expo-router",
      // Native device tokens for the relay (`getDevicePushTokenAsync`), not Expo push tokens (RFC 0006).
      ["expo-notifications", { mode: APS_ENVIRONMENT }],
      [
        "expo-localization",
        {
          // Lets people pick Brigade's language apart from the system one (Android 13+ app languages,
          // iOS per-app language), and tells the OS which locales the app ships.
          supportedLocales: { ios: ["en", "pt-BR"], android: ["en", "pt-BR"] },
        },
      ],
      // The in-app scanner for the dashboard's QR code (RFC 0015): barcodes only, no microphone (nothing is recorded).
      [
        "expo-camera",
        {
          cameraPermission: camera.en,
          microphonePermission: false,
          recordAudioAndroid: false,
          barcodeScannerEnabled: true,
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
    // EAS Update (over the air). The runtime version is the native fingerprint: an update reaches only builds whose
    // native code is the same, and a native change needs a new build (.github/workflows/mobile.yml decides which).
    runtimeVersion: { policy: "fingerprint" },
    updates: { url: "https://u.expo.dev/67e9e504-0692-4883-88d5-8e17863f661d" },
    // EAS project `@freecorps/brigade`. `eas init` cannot write to a dynamic config, so it lives here. Not a
    // secret.
    extra: {
      eas: { projectId: "67e9e504-0692-4883-88d5-8e17863f661d" },
      // Which APNs environment this build's device tokens belong to, for device registration (src/lib/device.ts).
      apsEnvironment: APS_ENVIRONMENT,
      // Whether the app asks for Critical Alerts and reports them at registration (src/lib/phone.ts).
      criticalAlerts: CRITICAL_ALERTS,
    },
  };
};
