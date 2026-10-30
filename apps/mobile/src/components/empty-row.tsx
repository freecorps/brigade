import { ListItem, Text } from "@expo/ui";
import type { Glyph } from "@/components/glyphs";

export type EmptyRowProps = {
  title: string;
  description: string;
  /** Shown by iOS's empty state (`empty-row.ios.tsx`); the list row here has none. */
  glyph: Glyph;
};

/** A list with nothing in it yet: what is missing, and what will fill it, as the section's one row. */
export function EmptyRow({ title, description }: EmptyRowProps) {
  return (
    <ListItem supportingText={description}>
      <Text>{title}</Text>
    </ListItem>
  );
}
