import { Button, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/hooks/use-theme";
import type { SubmitButtonProps } from "./submit-button";

export type { SubmitButtonProps } from "./submit-button";

/**
 * A form's one action as iOS draws a sign-in's: large, full width and prominent, on the list's ground. The label takes
 * the brand's foreground: SwiftUI's white is unreadable on the light teal the brand turns in dark mode.
 */
export function SubmitButton({ label, busy = false, onPress }: SubmitButtonProps) {
  const colors = useTheme();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle("borderedProminent"),
        controlSize("large"),
        disabled(busy),
        listRowBackground("clear"),
        listRowInsets({ top: 0, leading: 0, bottom: 0, trailing: 0 }),
      ]}
    >
      <Text
        modifiers={[
          font({ textStyle: "body", weight: "semibold" }),
          foregroundStyle(colors.primaryForeground),
          frame({ maxWidth: Infinity }),
        ]}
      >
        {label}
      </Text>
    </Button>
  );
}
