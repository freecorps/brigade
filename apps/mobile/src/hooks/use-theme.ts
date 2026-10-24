import type { ThemeColors } from "@freecorps/brigade-ui";
import { useColorScheme } from "react-native";
import { themeFor } from "@/lib/theme";

/** packages/ui's colours for the current system scheme; re-renders when the scheme flips. */
export function useTheme(): ThemeColors {
  return themeFor(useColorScheme());
}
