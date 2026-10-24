// The UI locale follows the device's preferred languages (expo-localization), in order: the first one
// Brigade ships wins, else `en`. Android 13+ and iOS also let people pick a language for Brigade alone
// (app.config.ts declares the supported locales), and that choice arrives here as the first language.
import { baseLocale, resolveLocale, type Locale } from "@freecorps/brigade-i18n";

export function pickLocale(languageTags: readonly (string | null | undefined)[]): Locale {
  for (const tag of languageTags) {
    if (!tag) continue;
    const locale = resolveLocale(tag);
    // resolveLocale falls back to `en` for anything unknown, so only accept a real language match.
    if (locale.split("-")[0] === tag.trim().toLowerCase().split(/[-_]/)[0]) return locale;
  }
  return baseLocale;
}
