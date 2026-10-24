import { baseLocale, locales, type Locale } from "./paraglide/runtime.js";

/**
 * Maps a stored or requested locale (user profile, device, header) to a supported one: exact match
 * ignoring case, then the language prefix (`pt`, `pt-PT` → `pt-BR`), else `baseLocale`. Never throws.
 */
export function resolveLocale(value: string | undefined): Locale {
  if (!value) return baseLocale;
  const wanted = value.trim().replaceAll("_", "-").toLowerCase();
  const language = wanted.split("-")[0];
  return (
    locales.find((locale) => locale.toLowerCase() === wanted) ??
    locales.find((locale) => locale.toLowerCase().split("-")[0] === language) ??
    baseLocale
  );
}
