import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IOSConfig, withDangerousMod, type ConfigPlugin } from "expo/config-plugins";
import { escapeStrings } from "./notification-service.ts";

// Why the app asks for the camera (iOS `NSCameraUsageDescription`): to scan the dashboard's "Use the app" QR code
// (RFC 0015 sections 5 and 6). The text lives in packages/i18n like every user-facing string (RFC 0008), read here
// from the catalog by path, as app.config.ts reads packages/ui's tokens: Expo's config loader does not resolve the
// workspace package from source. `en` is the Info.plist's own (expo-camera's `cameraPermission`); each locale's goes
// to `InfoPlist.strings` in the app's `<locale>.lproj` folder, which plugins/notification-service.ts already adds to
// the app as a folder reference. Not Expo's `locales`: it adds its own `<locale>.lproj` group beside that folder, and
// Xcode then copies both into the same directory of the bundle at once (a build that fails now and then).

export const CAMERA_USAGE_KEY = "mobile_camera_usage";
export const CAMERA_USAGE_LOCALES = ["en", "pt-BR"] as const;

/** The usage text per locale the app ships, from the catalog at `catalogDir` (packages/i18n/messages). */
export function cameraUsage(
  catalogDir: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): Record<(typeof CAMERA_USAGE_LOCALES)[number], string> {
  const text = (locale: string) => {
    const value: unknown = JSON.parse(read(join(catalogDir, `${locale}.json`)))[CAMERA_USAGE_KEY];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`packages/i18n has no ${CAMERA_USAGE_KEY} in ${locale}`);
    }
    return value;
  };
  return { en: text("en"), "pt-BR": text("pt-BR") };
}

/** `InfoPlist.strings` with the camera's usage text. */
export function infoPlistStrings(usage: string): string {
  return `/* Generated from packages/i18n by plugins/camera-usage.ts. */\n"NSCameraUsageDescription" = "${escapeStrings(usage)}";\n`;
}

/** Writes each locale's `InfoPlist.strings` into the app's `<locale>.lproj` folder. */
export const withCameraUsage: ConfigPlugin<Record<string, string>> = (config, usage) =>
  withDangerousMod(config, [
    "ios",
    (mod) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
      for (const [locale, text] of Object.entries(usage)) {
        const dir = join(mod.modRequest.platformProjectRoot, projectName, `${locale}.lproj`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "InfoPlist.strings"), infoPlistStrings(text));
      }
      return mod;
    },
  ]);
