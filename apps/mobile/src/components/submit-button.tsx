import { Button } from "@expo/ui";

export type SubmitButtonProps = { label: string; busy?: boolean; onPress: () => void };

/**
 * A form's one action, at the end of its list. iOS draws it as a large full-width prominent button on the list's
 * ground (`submit-button.ios.tsx`); the web preview keeps `@expo/ui`'s own.
 */
export function SubmitButton({ label, busy = false, onPress }: SubmitButtonProps) {
  return <Button label={label} onPress={busy ? undefined : onPress} />;
}
