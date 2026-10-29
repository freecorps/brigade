import { Stack } from "expo-router";
import { useColorScheme } from "react-native";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/hooks/use-theme";
import { colors as system } from "@/theme/colors";

/**
 * A tab's own stack, opening on its screen `name` under the system's header: a large title that folds into the
 * bar as the screen scrolls on iOS, Material's top app bar on Android.
 */
export function TabStack({ name, title }: { name: string; title: string }) {
  // Android's Material colours resolve at render: re-render when the scheme flips.
  useColorScheme();
  const colors = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: colors.primary,
        headerTitleStyle: { color: system.label },
        headerLargeTitleStyle: { color: system.label },
        contentStyle: { backgroundColor: colors.background },
        animation: reducedMotion ? "fade" : "default",
      }}
    >
      <Stack.Screen name={name} options={{ title }} />
    </Stack>
  );
}
