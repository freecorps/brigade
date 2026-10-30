import { Row, Text } from "@expo/ui";
import { incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import { fontSize, radius, spacing, type BadgeColors } from "@freecorps/brigade-ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * A small severity or status label drawn by the platform (SwiftUI, Compose), for a row's own lines rather than its
 * edges: the incident list puts both under the title, so the title keeps the row's width. The text names the value,
 * so colour is never the only signal.
 */
export function Pill({
  colors,
  text,
  bold = false,
}: {
  colors: BadgeColors;
  text: string;
  bold?: boolean;
}) {
  return (
    <Row
      alignment="center"
      style={{
        backgroundColor: colors.bg,
        borderRadius: radius.sm,
        paddingHorizontal: spacing[1] + spacing[0.5],
        paddingVertical: spacing[0.5],
      }}
    >
      <Text
        numberOfLines={1}
        textStyle={{
          color: colors.fg,
          fontSize: fontSize.xs.size,
          fontWeight: bold ? "700" : "600",
        }}
      >
        {text}
      </Text>
    </Row>
  );
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <Pill colors={useTheme().severity[severity]} text={severity.toUpperCase()} bold />;
}

export function StatusPill({ status }: { status: IncidentStatus }) {
  return <Pill colors={useTheme().status[status]} text={incidentStatusLabels[status]()} />;
}
