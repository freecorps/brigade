import { severityLabels, incidentStatusLabels } from "@freecorps/brigade-i18n/labels";
import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import { Badge } from "@/components/badge";
import { SEV1_GLYPH, STATUS_GLYPHS } from "@/components/glyphs";
import { useTheme } from "@/hooks/use-theme";

// On iOS a `ListItem`'s leading and trailing content is React Native, hosted in the SwiftUI row (`RNHostView`):
// the badges are the app's own, with their SF Symbols.

export function NativeSeverityBadge({
  severity,
  compact = false,
}: {
  severity: Severity;
  compact?: boolean;
}) {
  const colors = useTheme();
  return (
    <Badge
      colors={colors.severity[severity]}
      code={severity.toUpperCase()}
      icon={severity === "sev1" ? SEV1_GLYPH : undefined}
      label={compact ? undefined : severityLabels[severity]()}
    />
  );
}

export function NativeStatusBadge({ status }: { status: IncidentStatus }) {
  const colors = useTheme();
  return (
    <Badge
      colors={colors.status[status]}
      icon={STATUS_GLYPHS[status]}
      label={incidentStatusLabels[status]()}
    />
  );
}
