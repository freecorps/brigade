// Brigade follows the system light/dark setting and draws everything from packages/ui's themes.
import { themes, type ThemeColors, type ThemeName } from "@freecorps/brigade-ui";

/** React Native's scheme is "light", "dark", "unspecified" or null; only "dark" picks the dark theme. */
export function themeName(scheme: string | null | undefined): ThemeName {
  return scheme === "dark" ? "dark" : "light";
}

export function themeFor(scheme: string | null | undefined): ThemeColors {
  return themes[themeName(scheme)];
}
