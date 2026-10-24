// Theme preference: light, dark or system (follows `prefers-color-scheme`). Persisted in localStorage
// and applied as the `dark` class on <html>, which is what packages/ui's tokens and dark variant read.
// The inline script in index.html applies the same rules before first paint, so the page never
// flashes the wrong theme; test/theme.test.ts runs that script against this module.

export const THEME_STORAGE_KEY = "brigade-theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export const themePreferences = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = "light" | "dark";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return themePreferences.some((preference) => preference === value);
}

/** The stored preference, or "system" when nothing valid is stored or storage is unavailable. */
export function readThemePreference(storage: ReadableStorage | undefined): ThemePreference {
  try {
    const stored = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    // Storage can throw (blocked cookies, some private modes); the default still works.
    return "system";
  }
}

/** Persists the preference; returns false when storage refused it (the choice then lasts the session). */
export function writeThemePreference(
  storage: WritableStorage | undefined,
  preference: ThemePreference,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** Sets the `dark` class on the root element. `color-scheme` comes with the tokens. */
export function applyTheme(
  root: { classList: { toggle(token: string, force?: boolean): boolean } },
  theme: ResolvedTheme,
): void {
  root.classList.toggle("dark", theme === "dark");
}
