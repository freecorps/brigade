// Types for the server entry (src/messages.ts, generated): Paraglide's message functions with `{ locale }`
// required. Paraglide makes it optional and falls back to the current locale, which on Workers is one
// variable shared by every request the isolate serves.
import type * as messages from "./paraglide/messages/_index.js";
import type { Locale } from "./paraglide/runtime.js";

type Message = (inputs: never, options?: { locale?: Locale }) => string;

/**
 * A message function whose options, and so `locale`, are required. Only the call signature changes:
 * Paraglide's metadata stays, its optional-options signature does not (an intersection would keep it as an
 * overload and let a bare call through).
 */
export type LocaleRequired<F extends Message> = ((
  inputs: Parameters<F>[0],
  options: { locale: Locale },
) => ReturnType<F>) &
  Pick<F, keyof F>;

/** Every message, each requiring `{ locale }`. */
export type ServerMessages = {
  readonly [K in keyof typeof messages]: LocaleRequired<(typeof messages)[K]>;
};
