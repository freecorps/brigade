import { m } from "@freecorps/brigade-i18n";
import { Stack } from "expo-router";
import { Pressable } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/**
 * Post an update in the web preview: a text button at the header's right, since `Stack.Toolbar` draws nothing on
 * the web. iOS uses the toolbar's compose button (`update-button.ios.tsx`), Android a floating action button.
 */
export function UpdateButton({ onPress }: { onPress: () => void }) {
  const colors = useTheme();
  const label = m.incident_page({ part: "update_label" });
  return (
    <Stack.Screen
      options={{
        headerRight: () => (
          <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
            <ThemedText style={{ color: colors.primary }}>{label}</ThemedText>
          </Pressable>
        ),
      }}
    />
  );
}
