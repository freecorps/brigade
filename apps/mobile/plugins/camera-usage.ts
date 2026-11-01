import { readFileSync } from "node:fs";
import { join } from "node:path";

// Why the app asks for the camera (iOS `NSCameraUsageDescription`): to scan the dashboard's "Use the app" QR code
// (RFC 0015 sections 5 and 6). The text lives in packages/i18n like every user-facing string (RFC 0008), read here
// from the catalog by path, as app.config.ts reads packages/ui's tokens: Expo's config loader does not resolve the
// workspace package from source. `en` is the Info.plist's own; `pt-BR` goes to its InfoPlist.strings (`locales`).

export const CAMERA_USAGE_KEY = "mobile_camera_usage";

/** The usage text per locale the app ships, from the catalog at `catalogDir` (packages/i18n/messages). */
export function cameraUsage(
  catalogDir: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): { en: string; "pt-BR": string } {
  const text = (locale: string) => {
    const value: unknown = JSON.parse(read(join(catalogDir, `${locale}.json`)))[CAMERA_USAGE_KEY];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`packages/i18n has no ${CAMERA_USAGE_KEY} in ${locale}`);
    }
    return value;
  };
  return { en: text("en"), "pt-BR": text("pt-BR") };
}
