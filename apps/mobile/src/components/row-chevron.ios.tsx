import { SymbolView } from "expo-symbols";
import { PlatformColor } from "react-native";
import { useGlyphSize } from "@/hooks/use-glyph-size";

/**
 * The disclosure chevron of a row that opens another screen, in the system's tertiary label colour, growing with the
 * row's text up to the glyph cap (`src/lib/glyph-size.ts`), as the system's own does.
 */
export function RowChevron() {
  const size = useGlyphSize(13);
  return (
    <SymbolView
      name="chevron.right"
      tintColor={PlatformColor("tertiaryLabel") as unknown as string}
      size={size}
      weight="semibold"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
