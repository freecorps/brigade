// The system's own colours for the app's chrome and grounds, so React Native views, the native header and tab bar
// and `@expo/ui`'s SwiftUI and Compose trees read as one surface. Brand, severity and status colours stay
// packages/ui's (`useTheme`). This file is the web preview's: packages/ui's theme.
import type { ColorValue } from "react-native";
import { useTheme } from "@/hooks/use-theme";

export type SystemColors = {
  /** The screen behind grouped rows, and the header over it. */
  ground: ColorValue;
  /** The tab bar. */
  bar: ColorValue;
  /** The selected tab's pill (Material 3); unused on iOS. */
  indicator: ColorValue;
  label: ColorValue;
  secondaryLabel: ColorValue;
  /** Buttons, links and the selected tab. */
  tint: ColorValue;
  /** A destructive action's words (Sign out), as the system writes one: a plain string, for `@expo/ui` text. */
  destructive: string;
};

export function useSystemColors(): SystemColors {
  const colors = useTheme();
  return {
    ground: colors.background,
    bar: colors.card,
    indicator: colors.accent,
    label: colors.foreground,
    secondaryLabel: colors.mutedForeground,
    tint: colors.primary,
    destructive: colors.destructive,
  };
}
