// UI locale: persisted in localStorage, defaulting to the browser's language. packages/i18n keeps the
// current locale in a module variable and never reads storage itself (packages/i18n/README.md), so the
// app reads it here before the first render and writes it on every change.
import { isLocale, resolveLocale, type Locale } from "@freecorps/brigade-i18n";

export const LOCALE_STORAGE_KEY = "brigade-locale";

/** The stored locale if valid; otherwise the first browser language we support; otherwise `en`. */
export function readLocale(
  storage: Pick<Storage, "getItem"> | undefined,
  browserLanguages: readonly string[] = [],
): Locale {
  try {
    const stored = storage?.getItem(LOCALE_STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to the browser's languages.
  }
  for (const language of browserLanguages) {
    const locale = resolveLocale(language);
    // resolveLocale falls back to `en` for anything unknown, so only accept a real match.
    if (locale.split("-")[0] === language.trim().toLowerCase().split(/[-_]/)[0]) return locale;
  }
  return resolveLocale(undefined);
}

/** Persists the locale; returns false when storage refused it. */
export function writeLocale(
  storage: Pick<Storage, "setItem"> | undefined,
  locale: Locale,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}
