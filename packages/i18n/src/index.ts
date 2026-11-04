// This entry is for UIs (web, mobile), where messages follow the current locale.
// Server code (Workers) imports messages by name from "@freecorps/brigade-i18n/messages" instead (esbuild
// does not tree-shake `m.x`), whose types require `{ locale }` on every call, and never reads or sets the
// current locale: it is one variable per isolate (strategy "globalVariable"), so setting it for one request
// leaks into every concurrent request served by the same isolate. A lint rule (root vite.config.ts) keeps
// `m`, `getLocale` and `setLocale` from this entry out of apps/api, apps/status-edge and integrations.
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
