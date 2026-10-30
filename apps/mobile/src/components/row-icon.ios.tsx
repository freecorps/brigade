import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import type { RowIconProps } from "./row-icon";

export type { RowIconProps } from "./row-icon";

/** Settings' tile: a white SF Symbol on a 29-point rounded square (a React Native view: iOS hosts a row's edges). */
export function RowIcon({ glyph, color, plain = false }: RowIconProps) {
  const colors = useTheme();
  if (plain) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: 29, alignItems: "center" }}
      >
        <SymbolView name={glyph} tintColor={color ?? colors.mutedForeground} size={19} />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: 29,
        height: 29,
        borderRadius: 7,
        borderCurve: "continuous",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color ?? colors.primary,
      }}
    >
      <SymbolView name={glyph} tintColor="#ffffff" size={17} weight="medium" />
    </View>
  );
}
