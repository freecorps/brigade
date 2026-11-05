import { fontSize, fontWeight, radius, spacing, type BadgeColors } from "@freecorps/brigade-ui";
import { SizedSymbol } from "@/components/sized-symbol";
import { Text, View } from "react-native";
import type { Glyph } from "@/components/glyphs";
import { useGlyphSize } from "@/hooks/use-glyph-size";

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
  /** Left out for a compact badge, which shows the code alone. */
  label?: string;
}) {
  const glyph = useGlyphSize(fontSize.sm.size);
  // The gap grows with the text, as the glyph does.
  const gap = useGlyphSize(spacing[1]);
  return (
    <View
      accessible
      accessibilityLabel={[code, label].filter(Boolean).join(", ")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap,
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[1],
        borderRadius: radius.md,
        borderCurve: "continuous",
        backgroundColor: colors.bg,
      }}
    >
      {icon ? (
        <SizedSymbol
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
      {label ? (
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
      ) : null}
    </View>
  );
}
