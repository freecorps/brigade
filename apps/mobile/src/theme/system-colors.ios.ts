import { Color } from "expo-router";
import { useColorScheme } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import type { SystemColors } from "./system-colors";

export type { SystemColors } from "./system-colors";

/** UIKit's semantic colours: they follow light, dark and increased contrast on the device by themselves. */
export function useSystemColors(): SystemColors {
  const colors = useTheme();
  const dark = useColorScheme() === "dark";
  return {
    ground: Color.ios.systemGroupedBackground,
    bar: Color.ios.systemBackground,
    indicator: Color.ios.systemFill,
    label: Color.ios.label,
    secondaryLabel: Color.ios.secondaryLabel,
    tint: colors.primary,
    // systemRed, light and dark.
    destructive: dark ? "#FF453A" : "#FF3B30",
  };
}
