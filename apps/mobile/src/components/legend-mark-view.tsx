import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import { View } from "react-native";
import { Badge, useGlyphSize } from "@/components/badge";
import { SEV1_GLYPH, STATUS_GLYPHS } from "@/components/glyphs";
import { useTheme } from "@/hooks/use-theme";

/** Wide enough for SEV1's badge with its octagon, so every severity's name starts at the same place. */
const COLUMN = 72;

export type LegendMarkProps = { severity: Severity } | { status: IncidentStatus };

/**
 * How the app marks a severity or a status, alone, for a legend row's leading edge: the severity's code (SEV1 with
 * its octagon) or the status's glyph, in its colours. A severity's sits in a column of one width (growing with the
 * text), since SEV1's octagon widens its badge; every status's is the same size already. The row names the value, so
 * the mark is decorative.
 */
export function LegendMarkView(props: LegendMarkProps) {
  const colors = useTheme();
  const width = useGlyphSize(COLUMN);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={"severity" in props ? { width, alignItems: "flex-start" } : undefined}
    >
      {"severity" in props ? (
        <Badge
          colors={colors.severity[props.severity]}
          code={props.severity.toUpperCase()}
          icon={props.severity === "sev1" ? SEV1_GLYPH : undefined}
        />
      ) : (
        <Badge colors={colors.status[props.status]} icon={STATUS_GLYPHS[props.status]} />
      )}
    </View>
  );
}
