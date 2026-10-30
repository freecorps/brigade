import { SymbolView } from "expo-symbols";
import { Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

const SIZE = 32;

/** "Ana Souza" → "AS", "ana@example.com" → "A": the first letters of the first and last words. */
export function initials(name: string): string {
  const words = name
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/**
 * A member's initials in a circle, in the brand's accent; nobody (an unassigned role) is an outlined person glyph.
 * Decorative: the row names the member.
 */
export function AvatarView({ name }: { name: string | null }) {
  const colors = useTheme();
  const letters = name === null ? "" : initials(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: SIZE / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: letters ? colors.accent : colors.muted,
      }}
    >
      {letters ? (
        <Text
          allowFontScaling={false}
          accessible={false}
          importantForAccessibility="no"
          style={{ color: colors.accentForeground, fontSize: 13, fontWeight: "600" }}
        >
          {letters}
        </Text>
      ) : (
        <SymbolView
          name={{ ios: "person", android: "person", web: "person" }}
          tintColor={colors.mutedForeground}
          size={16}
        />
      )}
    </View>
  );
}
