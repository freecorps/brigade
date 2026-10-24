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
import { LOCALE_STORAGE_KEY, readLocale, writeLocale } from "@/lib/locale";
import { getStorage } from "@/lib/storage";
import {
  applyTheme,
  DARK_QUERY,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
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

  const applyLocale = useCallback((next: Locale) => {
    // The i18n runtime first, so the render this state change triggers reads the new locale.
    void setI18nLocale(next);
    document.documentElement.lang = next;
    setLocaleState(next);
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      writeLocale(getStorage(), next);
      applyLocale(next);
    },
    [applyLocale],
  );

  const setTheme = useCallback((next: ThemePreference) => {
    writeThemePreference(getStorage(), next);
    setThemeState(next);
  }, []);

  // Before paint, so a theme switch (or the OS flipping while on "system") never shows a mixed frame.
  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolvedTheme);
    // The browser chrome (status bar on phones) takes the page ground, read from the tokens.
    const ground = getComputedStyle(document.documentElement).getPropertyValue("--background");
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", ground.trim());
    }
  }, [resolvedTheme]);

  // Other tabs changing the theme or the language follow along (the event fires only in other tabs).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      const storage = getStorage();
      if (event.storageArea !== storage) return;
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        setThemeState(readThemePreference(storage));
      }
      if (event.key === null || event.key === LOCALE_STORAGE_KEY) {
        applyLocale(readLocale(storage, navigator.languages));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [applyLocale]);

  const value = useMemo(
    () => ({ locale, setLocale, theme, resolvedTheme, setTheme }),
    [locale, setLocale, theme, resolvedTheme, setTheme],
  );
  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}
