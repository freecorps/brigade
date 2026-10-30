import { Button, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  controlSize,
  disabled,
  font,
  frame,
  listRowBackground,
  listRowInsets,
} from "@expo/ui/swift-ui/modifiers";
import type { SubmitButtonProps } from "./submit-button";

export type { SubmitButtonProps } from "./submit-button";

/** A form's one action as iOS draws a sign-in's: large, full width and prominent, on the list's ground. */
export function SubmitButton({ label, busy = false, onPress }: SubmitButtonProps) {
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
      <Text modifiers={[font({ weight: "semibold" }), frame({ maxWidth: Infinity })]}>{label}</Text>
    </Button>
  );
}
