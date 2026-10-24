import { radius, spacing } from "@freecorps/brigade-ui";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/** A titled group: the title sits on the page ground, the content on a card surface. */
export function Section({
  title,
  children,
  inset = true,
}: {
  title: string;
  children: ReactNode;
  /** Pad the content; off for row lists that pad each row. */
  inset?: boolean;
}) {
  const colors = useTheme();
  return (
    <View style={{ gap: spacing[2] }}>
      <ThemedText variant="label" accessibilityRole="header">
        {title}
      </ThemedText>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.xl,
          borderCurve: "continuous",
          padding: inset ? spacing[4] : 0,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A row in a Section with `inset={false}`, separated from the previous one by a hairline. */
export function Row({ children, first = false }: { children: ReactNode; first?: boolean }) {
  const colors = useTheme();
  return (
    <View
      style={{
        minHeight: spacing[12],
        justifyContent: "center",
        gap: spacing[0.5],
        paddingHorizontal: spacing[4],
        paddingVertical: spacing[3],
        borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      {children}
    </View>
  );
}
