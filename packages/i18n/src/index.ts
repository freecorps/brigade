// Server code (Workers): import messages by name from "@freecorps/brigade-i18n/messages" (esbuild does
// not tree-shake `m.x`), pass `{ locale }` on every call and never call `setLocale`.
// The current locale is one variable per isolate (strategy "globalVariable"), so setting it for one
// request leaks into every concurrent request served by the same isolate.
//
// package.json declares `sideEffects: false` although the Paraglide runtime initialises
// `globalThis.__paraglide` at import. That write is idempotent (`??=`-style) and only feeds
// SSR helpers we do not use, so dropping an unused import of the runtime changes nothing.
import { setLocale as setRuntimeLocale, type Locale } from "./paraglide/runtime.js";

export { m } from "./paraglide/messages.js";
export {
  assertIsLocale,
  baseLocale,
  getLocale,
  isLocale,
  locales,
  overwriteGetLocale,
  overwriteSetLocale,
  toLocale,
  type Locale,
} from "./paraglide/runtime.js";
export { formatDateTime, formatNumber, formatRelativeTime, toTimeZone } from "./format.ts";
export { resolveLocale } from "./locale.ts";

/**
 * Sets the current locale for UIs (web, mobile). Unlike Paraglide's own `setLocale`, it never
 * reloads the page: with the "globalVariable" strategy a reload would reset the locale to `en`.
 */
export function setLocale(locale: Locale): void | Promise<void> {
  return setRuntimeLocale(locale, { reload: false });
}
