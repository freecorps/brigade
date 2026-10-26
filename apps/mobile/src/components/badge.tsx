import { fontSize, fontWeight, radius, spacing, type BadgeColors } from "@freecorps/brigade-ui";
import { SymbolView } from "expo-symbols";
import { Text, useWindowDimensions, View } from "react-native";
import type { Glyph } from "@/components/glyphs";

/**
 * A glyph's size for text of `size`: glyphs do not follow the system text size by themselves, so next to larger
 * text they would look small and clip in their frame (Android at 130 %).
 */
export function useGlyphSize(size: number): number {
  const { fontScale } = useWindowDimensions();
  return Math.round(size * Math.max(1, fontScale));
}

/**
 * A severity or status badge. The text always names the value, so colour is never the only signal;
 * `code` (SEV1) is drawn in bold before the translated name, and `icon` before both. The badge is one
 * accessibility element labelled with its text; the icon is decorative.
 */
export function Badge({
  colors,
  code,
  icon,
  label,
}: {
  colors: BadgeColors;
  code?: string;
  icon?: Glyph;
  label: string;
}) {
  const glyph = useGlyphSize(fontSize.sm.size);
  return (
    <View
      accessible
      accessibilityLabel={code ? `${code}, ${label}` : label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[1],
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: colors.bg,
      }}
    >
      {icon ? (
        <SymbolView
          name={icon}
          tintColor={colors.fg}
          size={glyph}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      {code ? (
        <Text
          style={{
            color: colors.fg,
            fontSize: fontSize.sm.size,
            lineHeight: fontSize.sm.lineHeight,
            fontWeight: fontWeight.bold,
          }}
        >
          {code}
        </Text>
      ) : null}
      <Text
        style={{
          color: colors.fg,
          fontSize: fontSize.sm.size,
          lineHeight: fontSize.sm.lineHeight,
          fontWeight: fontWeight.medium,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
