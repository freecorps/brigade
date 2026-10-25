import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import type { IncidentStatus, Severity } from "@freecorps/brigade-schema";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  EyeIcon,
  OctagonAlertIcon,
  SearchIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Each status carries its own glyph, so the name and the shape say it before the colour does.
export const STATUS_ICONS: Record<IncidentStatus, LucideIcon> = {
  triage: CircleDashedIcon,
  investigating: SearchIcon,
  fixing: WrenchIcon,
  monitoring: EyeIcon,
  resolved: CircleCheckIcon,
  declined: CircleSlashIcon,
};

/** The code and the name ("SEV1 Critical"); SEV1 also gets the alert glyph and the only solid fill. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge variant={severity}>
      {severity === "sev1" ? <OctagonAlertIcon aria-hidden /> : null}
      <span className="font-bold">{severity.toUpperCase()}</span>
      <span>{severityLabels[severity]()}</span>
    </Badge>
  );
}

export function StatusBadge({ status }: { status: IncidentStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant={status}>
      <Icon aria-hidden />
      {incidentStatusLabels[status]()}
    </Badge>
  );
}
