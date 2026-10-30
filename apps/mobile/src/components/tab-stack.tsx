import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useSystemColors } from "@/theme/system-colors";

/**
 * A tab's own stack, opening on its screen `name` under the system's header: a large title that folds into the
 * bar as the screen scrolls on iOS, Material's top app bar on Android, both on the screen's own ground.
 * On iOS the header keeps no background of its own: iOS 26 draws no large title over a header with a background
 * colour, so the screen's ground shows through it instead.
 */
export function TabStack({ name, title }: { name: string; title: string }) {
  const system = useSystemColors();
  const reducedMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerStyle:
          Platform.OS === "ios" ? undefined : { backgroundColor: system.ground as string },
        headerTintColor: system.tint as string,
        headerTitleStyle: { color: system.label as string },
        headerLargeTitleStyle: { color: system.label as string },
        contentStyle: { backgroundColor: system.ground },
        animation: reducedMotion ? "fade" : "default",
      }}
    >
      <Stack.Screen name={name} options={{ title }} />
    </Stack>
  );
}
