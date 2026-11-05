import { SymbolView } from "expo-symbols";
import { CHECK_GLYPH } from "@/components/glyphs";
import { useGlyphSize } from "@/hooks/use-glyph-size";
import { useTheme } from "@/hooks/use-theme";

/**
 * The selected row's check mark, as Settings draws it (a React Native view: iOS hosts a row's edges as such), growing
 * with the row's text up to the glyph cap (`src/lib/glyph-size.ts`).
 */
export function RowCheck() {
  const colors = useTheme();
  const size = useGlyphSize(20);
  return (
    <SymbolView
      name={CHECK_GLYPH}
      tintColor={colors.primary}
      size={size}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
