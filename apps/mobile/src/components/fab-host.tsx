import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";
import { NativeHost } from "@/components/native-host";

/**
 * A Compose floating action button over a screen, as one element for TalkBack: the hosting view is the button, named
 * by `label` and activated by a double tap. `@expo/ui` leaves the button's text out of its semantics, so TalkBack
 * found an unnamed button, and a content description set as a modifier lands on a node of its own, not on the
 * clickable one. Touch stays with the Compose button, so a tap never runs `onPress` twice.
 */
export function FabHost({
  label,
  onPress,
  style,
  children,
}: {
  label: string;
  onPress: () => void;
  style: ViewStyle;
  children: ReactNode;
}) {
  return (
    <View
      pointerEvents="box-none"
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityActions={[{ name: "activate" }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "activate") onPress();
      }}
      style={[{ position: "absolute" }, style]}
    >
      <View importantForAccessibility="no-hide-descendants">
        <NativeHost matchContents>{children}</NativeHost>
      </View>
    </View>
  );
}
