import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ConfigPlugin, withDangerousMod, withInfoPlist } from "expo/config-plugins";

// Pages that ring as calls (spike S6, RFC 0010), for modules/brigade-call:
// - iOS: the `voip` background mode, so PushKit wakes the app for a VoIP push. CallKit's strings come from
//   plugins/notification-service.ts (`call_caller` is one of its native keys).
// - Android: the ringing screen's and channels' strings as resources, generated from packages/i18n in `en` and
//   `pt-BR`. The module's manifest brings the permissions, the ConnectionService and the ringing activity.
// See docs/spikes/s6-voip-call-screen.md.

export const ANDROID_STRING_KEYS = [
  "call_ringing",
  "call_answer",
  "call_decline",
  "call_channel_calls",
  "call_channel_pages",
  "push_fallback_title",
  "push_fallback_body",
] as const;
/** packages/i18n locale → Android resource qualifier. */
export const ANDROID_LOCALES = { en: "values", "pt-BR": "values-pt-rBR" } as const;
export const STRINGS_FILE = "brigade_strings.xml";

const here = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(here, "../../../packages/i18n/messages");

/** A `res/values*` strings file for the keys the native call screen needs. Throws if a locale lacks one. */
export function androidStrings(messages: Record<string, unknown>): string {
  const lines = ANDROID_STRING_KEYS.map((key) => {
    const value = messages[key];
    if (typeof value !== "string") throw new Error(`packages/i18n has no plain string ${key}`);
    return `  <string name="${key}">${escapeAndroid(value)}</string>`;
  });
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from packages/i18n by plugins/incoming-call.ts. -->
<resources>
${lines.join("\n")}
</resources>
`;
}

/** XML escaping, then Android's own: quotes, apostrophes, backslashes, newlines and a leading @ or ?. */
export function escapeAndroid(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/^([@?])/, "\\$1");
}

/** Adds `voip` to `UIBackgroundModes`, keeping the others. */
export function applyBackgroundModes(plist: Record<string, unknown>): Record<string, unknown> {
  const modes = Array.isArray(plist.UIBackgroundModes)
    ? (plist.UIBackgroundModes as unknown[])
    : [];
  return { ...plist, UIBackgroundModes: modes.includes("voip") ? modes : [...modes, "voip"] };
}

function catalog(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8")) as Record<
    string,
    unknown
  >;
}

export const withIncomingCall: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (mod) => {
    mod.modResults = applyBackgroundModes(mod.modResults) as typeof mod.modResults;
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    (mod) => {
      const res = join(mod.modRequest.platformProjectRoot, "app/src/main/res");
      for (const [locale, folder] of Object.entries(ANDROID_LOCALES)) {
        mkdirSync(join(res, folder), { recursive: true });
        writeFileSync(join(res, folder, STRINGS_FILE), androidStrings(catalog(locale)));
      }
      return mod;
    },
  ]);
};
