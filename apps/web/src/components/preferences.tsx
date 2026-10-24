import { setLocale as setI18nLocale, type Locale } from "@freecorps/brigade-i18n";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { writeLocale } from "@/lib/locale";
import { getStorage } from "@/lib/storage";
import {
  applyTheme,
  DARK_QUERY,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme";

interface Preferences {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const PreferencesContext = createContext<Preferences | null>(null);

export function usePreferences(): Preferences {
  const preferences = use(PreferencesContext);
  if (!preferences) throw new Error("usePreferences needs a <PreferencesProvider>");
  return preferences;
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

export function PreferencesProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  const [theme, setThemeState] = useState(() => readThemePreference(getStorage()));
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark);
  const resolvedTheme = resolveTheme(theme, prefersDark);

  const setLocale = useCallback((next: Locale) => {
    // The i18n runtime first, so the render this state change triggers reads the new locale.
    void setI18nLocale(next);
    writeLocale(getStorage(), next);
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    writeThemePreference(getStorage(), next);
    setThemeState(next);
  }, []);

  // Before paint, so a theme switch (or the OS flipping while on "system") never shows a mixed frame.
  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolvedTheme);
    // The browser chrome (status bar on phones) takes the page ground, read from the tokens.
    const ground = getComputedStyle(document.documentElement).getPropertyValue("--background");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", ground.trim());
  }, [resolvedTheme]);

  // Other tabs changing the theme follow along.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === getStorage()) setThemeState(readThemePreference(getStorage()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale, theme, resolvedTheme, setTheme }),
    [locale, setLocale, theme, resolvedTheme, setTheme],
  );
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}
