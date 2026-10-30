import { Color } from "expo-router";
import { useTheme } from "@/hooks/use-theme";
import type { SystemColors } from "./system-colors";

export type { SystemColors } from "./system-colors";

/** UIKit's semantic colours: they follow light, dark and increased contrast on the device by themselves. */
export function useSystemColors(): SystemColors {
  const colors = useTheme();
  return {
    ground: Color.ios.systemGroupedBackground,
    bar: Color.ios.systemBackground,
    indicator: Color.ios.systemFill,
    label: Color.ios.label,
    secondaryLabel: Color.ios.secondaryLabel,
    tint: colors.primary,
  };
}
