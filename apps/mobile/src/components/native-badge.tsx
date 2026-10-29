import { Row, Text } from "@expo/ui";
import { severityLabels, incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import { fontSize, radius, spacing, type BadgeColors } from "@freecorps/brigade-ui";
import { useTheme } from "@/hooks/use-theme";

/**
 * A severity or status badge drawn by the platform (SwiftUI, Compose), for rows of `@expo/ui` lists. The text
 * always names the value, so colour is never the only signal; `code` (SEV1) is bold before the translated name.
 */
export function NativeBadge({
  colors,
  code,
  label,
}: {
  colors: BadgeColors;
  code?: string;
  /** Left out for the compact badge, which shows the code alone. */
  label?: string;
}) {
  return (
    <Row
      spacing={spacing[1]}
      alignment="center"
      style={{
        backgroundColor: colors.bg,
        borderRadius: radius.md,
        paddingHorizontal: spacing[2],
        paddingVertical: spacing[0.5],
      }}
    >
      {code ? (
        <Text textStyle={{ color: colors.fg, fontSize: fontSize.sm.size, fontWeight: "700" }}>
          {code}
        </Text>
      ) : null}
      {label ? (
        <Text
          numberOfLines={1}
          textStyle={{ color: colors.fg, fontSize: fontSize.sm.size, fontWeight: "500" }}
        >
          {label}
        </Text>
      ) : null}
    </Row>
  );
}

/** `compact`: SEV1 alone, for a row's leading edge, where the row says the rest. */
export function NativeSeverityBadge({
  severity,
  compact = false,
}: {
  severity: Severity;
  compact?: boolean;
}) {
  const colors = useTheme();
  return (
    <NativeBadge
      colors={colors.severity[severity]}
      code={severity.toUpperCase()}
      label={compact ? undefined : severityLabels[severity]()}
    />
  );
}

export function NativeStatusBadge({ status }: { status: IncidentStatus }) {
  const colors = useTheme();
  return <NativeBadge colors={colors.status[status]} label={incidentStatusLabels[status]()} />;
}
