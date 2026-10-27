// The UI locale follows the device's preferred languages (expo-localization), in order: the first one
// Brigade ships wins, else `en`. Android 13+ and iOS also let people pick a language for Brigade alone
// (app.config.ts declares the supported locales), and that choice arrives here as the first language.
import { baseLocale, isLocale, resolveLocale, type Locale } from "@freecorps/brigade-i18n";

export function pickLocale(languageTags: readonly (string | null | undefined)[]): Locale {
  for (const tag of languageTags) {
    if (!tag) continue;
    const locale = resolveLocale(tag);
    // resolveLocale falls back to `en` for anything unknown, so only accept a real language match.
    if (locale.split("-")[0] === tag.trim().toLowerCase().split(/[-_]/)[0]) return locale;
  }
  return baseLocale;
}

/** Where the app remembers the language it last stored on the user (`user.locale`), in secure storage. */
export const SENT_LOCALE_KEY = "brigade_sent_locale";

/**
 * Whether the app stores its language on the signed-in user, so emails come in it (RFC 0008), as the dashboard does
 * from its language switch. The phone's language is the user's choice here, so the app sends it when the user has
 * none, and when the phone's language changed since the app last sent it. The first run on a phone only remembers
 * it: a language picked on the dashboard is not overwritten by a phone that never changed its own.
 * - `send`: store `locale` on the user, then remember it;
 * - `remember`: only remember `locale` as sent;
 * - `nothing`.
 */
export function localeAction(
  locale: Locale,
  userLocale: string | null | undefined,
  lastSent: string | null,
): "send" | "remember" | "nothing" {
  if (!userLocale || !isLocale(userLocale)) return "send";
  if (lastSent === null) return "remember";
  if (lastSent === locale) return "nothing";
  return userLocale === locale ? "remember" : "send";
}
