import { Text } from "@expo/ui/jetpack-compose";
import { useTheme } from "@/hooks/use-theme";
import { useSystemColors } from "@/theme/system-colors";

/**
 * A section's footer as Material writes supporting text: body small, in the surface's variant colour, so it reads as
 * a note under the rows rather than one of them.
 */
export function FooterText({
  children,
  tone = "default",
}: {
  children: string;
  tone?: "default" | "destructive";
}) {
  const colors = useTheme();
  const system = useSystemColors();
  return (
    <Text
      color={tone === "destructive" ? colors.destructive : (system.secondaryLabel as string)}
      style={{ typography: "bodyMedium" }}
    >
      {children}
    </Text>
  );
}
