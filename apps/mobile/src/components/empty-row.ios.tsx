import { ContentUnavailableView } from "@expo/ui/swift-ui";
import { listRowBackground } from "@expo/ui/swift-ui/modifiers";
import type { ComponentProps } from "react";
import type { EmptyRowProps } from "./empty-row";

export type { EmptyRowProps } from "./empty-row";

/**
 * A list with nothing in it yet, as iOS says it: the system's empty state (a symbol, a title and what will fill the
 * list) on the list's own ground, not in a card.
 */
export function EmptyRow({ title, description, glyph }: EmptyRowProps) {
  const symbol = (typeof glyph === "object" ? glyph.ios : glyph) as ComponentProps<
    typeof ContentUnavailableView
  >["systemImage"];
  return (
    <ContentUnavailableView
      title={title}
      description={description}
      systemImage={symbol}
      modifiers={[listRowBackground("clear")]}
    />
  );
}
