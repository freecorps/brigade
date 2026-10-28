import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// Firebase for Android pages (RFC 0006): `google-services.json` names the Firebase project the app gets its FCM token
// from. It is never committed. A build reads it from `GOOGLE_SERVICES_FILE` (a path, `~` allowed), or from
// `~/.config/brigade/google-services.json` when that exists; without either the app builds with no FCM and says pages
// are not set up on the phone (apps/mobile/README.md "Android pages").

export const DEFAULT_GOOGLE_SERVICES_FILE = join(".config", "brigade", "google-services.json");

/** The path to give `android.googleServicesFile`, or undefined to build without Firebase. */
export function googleServicesFile(
  env: Record<string, string | undefined> = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
): string | undefined {
  const named = env.GOOGLE_SERVICES_FILE?.trim();
  if (named) {
    // Named on purpose: a wrong path fails the build (prebuild cannot copy it) instead of quietly having no FCM.
    const path = named === "~" || named.startsWith("~/") ? join(home, named.slice(1)) : named;
    return isAbsolute(path) ? path : resolve(path);
  }
  const fallback = join(home, DEFAULT_GOOGLE_SERVICES_FILE);
  return exists(fallback) ? fallback : undefined;
}
