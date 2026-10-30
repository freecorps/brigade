import { Text } from "@expo/ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * A section's footer: what a setting does, or why something failed. iOS sets a footer in the system's footnote and
 * secondary colour by itself; Android draws the text as given, so it gets its own (`footer-text.android.tsx`).
 */
export function FooterText({
  children,
  tone = "default",
}: {
  children: string;
  tone?: "default" | "destructive";
}) {
  const colors = useTheme();
  return (
    <Text textStyle={tone === "destructive" ? { color: colors.destructive } : undefined}>
      {children}
    </Text>
  );
}
