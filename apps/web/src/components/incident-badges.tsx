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

/**
 * The code and the name ("SEV1 Critical"); SEV1 also gets the alert glyph and the only solid fill. `compact`: below
 * `md` the name is only read out, not drawn, so a list row's badges fit on its number's line.
 */
export function SeverityBadge({ severity, compact }: { severity: Severity; compact?: boolean }) {
  return (
    <Badge variant={severity}>
      {severity === "sev1" ? <OctagonAlertIcon aria-hidden /> : null}
      <span className="font-bold">{severity.toUpperCase()}</span>
      <span className={compact ? "max-md:sr-only" : undefined}>{severityLabels[severity]()}</span>
    </Badge>
  );
}

/** `compact`: below 375px the glyph goes, so a list row's two badges fit beside its number at 320px. */
export function StatusBadge({ status, compact }: { status: IncidentStatus; compact?: boolean }) {
  const Icon = STATUS_ICONS[status];
  return (
    <Badge variant={status}>
      <Icon aria-hidden className={compact ? "max-[374px]:hidden" : undefined} />
      {incidentStatusLabels[status]()}
    </Badge>
  );
}
