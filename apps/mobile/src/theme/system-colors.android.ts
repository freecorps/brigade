import { useMaterialColors } from "@expo/ui/jetpack-compose";
import { useColorScheme } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import type { SystemColors } from "./system-colors";

export type { SystemColors } from "./system-colors";

/**
 * Material 3's palette generated from Brigade's brand colour, the same one every `@expo/ui` tree is themed with
 * (`NativeHost`), so the top app bar, the navigation bar and the lists match.
 */
export function useSystemColors(): SystemColors {
  const scheme = useColorScheme();
  const material = useMaterialColors({
    colorScheme: scheme === "dark" ? "dark" : "light",
    seedColor: useTheme().primary,
  });
  return {
    ground: material.surface,
    bar: material.surfaceContainer,
    indicator: material.secondaryContainer,
    label: material.onSurface,
    secondaryLabel: material.onSurfaceVariant,
    tint: material.primary,
  };
}
