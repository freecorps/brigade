import { Host, type UniversalHostProps } from "@expo/ui";
import { useColorScheme } from "react-native";
import { useTheme } from "@/hooks/use-theme";

/**
 * The root of every `@expo/ui` tree in the app: SwiftUI or Compose in the system's light or dark scheme, with
 * Material 3's colours on Android drawn from Brigade's brand colour (its seed) rather than the wallpaper.
 */
export function NativeHost(props: Omit<UniversalHostProps, "colorScheme" | "seedColor">) {
  const scheme = useColorScheme();
  const colors = useTheme();
  return <Host {...props} colorScheme={scheme ?? undefined} seedColor={colors.primary} />;
}
