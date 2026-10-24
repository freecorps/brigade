import type { Locale } from "@freecorps/brigade-i18n";
import { createContext, use } from "react";

export interface LocaleState {
  readonly locale: Locale;
  /** The device's IANA time zone, for formatDateTime. */
  readonly timeZone: string;
}

export const LocaleContext = createContext<LocaleState>({ locale: "en", timeZone: "UTC" });

export function useLocale(): LocaleState {
  return use(LocaleContext);
}
