import { fontSize, fontWeight, radius, spacing, type BadgeColors } from "@freecorps/brigade-ui";
import { SymbolView } from "expo-symbols";
import { Text, View } from "react-native";
import type { Glyph } from "@/components/glyphs";

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
          size={fontSize.sm.size}
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
