import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useGlyphSize } from "@/hooks/use-glyph-size";
import { useTheme } from "@/hooks/use-theme";
import type { RowIconProps } from "./row-icon";

export type { RowIconProps } from "./row-icon";

/**
 * Settings' tile: a white SF Symbol on a 29-point rounded square (a React Native view: iOS hosts a row's edges). The
 * tile and its symbol grow with the row's text, as Settings' do, up to the glyph cap (`src/lib/glyph-size.ts`).
 */
export function RowIcon({ glyph, color, plain = false }: RowIconProps) {
  const colors = useTheme();
  const tile = useGlyphSize(29);
  const symbol = useGlyphSize(plain ? 19 : 17);
  const corner = useGlyphSize(7);
  if (plain) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: tile, alignItems: "center" }}
      >
        <SymbolView name={glyph} tintColor={color ?? colors.mutedForeground} size={symbol} />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: tile,
        height: tile,
        borderRadius: corner,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color ?? colors.primary,
      }}
    >
      <SymbolView name={glyph} tintColor="#ffffff" size={symbol} weight="medium" />
    </View>
  );
}
