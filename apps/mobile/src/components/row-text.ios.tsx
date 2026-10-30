import { ThemedText } from "@/components/themed-text";

/** A short word at a row's trailing edge, as React Native text: iOS hosts a row's edges as React Native views. */
export function RowText({ color, children }: { color?: string; children: string }) {
  return <ThemedText style={color ? { color } : undefined}>{children}</ThemedText>;
}
