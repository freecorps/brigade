import { Text } from "@expo/ui";

/**
 * A short word at a row's trailing edge (Dismiss, Remove, Cover), drawn by the platform. iOS hosts a row's edges
 * as React Native views (`row-text.ios.tsx`).
 */
export function RowText({ color, children }: { color?: string; children: string }) {
  return <Text textStyle={color ? { color } : undefined}>{children}</Text>;
}
