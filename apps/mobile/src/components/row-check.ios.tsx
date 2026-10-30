import { SymbolView } from "expo-symbols";
import { CHECK_GLYPH } from "@/components/glyphs";
import { useTheme } from "@/hooks/use-theme";

/** The selected row's check mark, as Settings draws it (a React Native view: iOS hosts a row's edges as such). */
export function RowCheck() {
  const colors = useTheme();
  return (
    <SymbolView
      name={CHECK_GLYPH}
      tintColor={colors.primary}
      size={20}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
