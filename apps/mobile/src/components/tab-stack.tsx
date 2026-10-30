import { Stack } from "expo-router";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useSystemColors } from "@/theme/system-colors";

/**
 * A tab's own stack, opening on its screen `name` under the system's header: a large title that folds into the
 * bar as the screen scrolls on iOS, Material's top app bar on Android, both on the screen's own ground.
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
        headerStyle: { backgroundColor: system.ground as string },
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
