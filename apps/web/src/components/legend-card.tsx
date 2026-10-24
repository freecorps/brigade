import { m } from "@freecorps/brigade-i18n";
import { incidentStatusLabels, severityLabels } from "@freecorps/brigade-i18n/labels";
import { INCIDENT_STATUSES, SEVERITIES, type IncidentStatus } from "@freecorps/brigade-schema";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Each status carries its own glyph, so the name and the shape say it before the colour does.
const STATUS_ICONS: Record<IncidentStatus, LucideIcon> = {
  triage: CircleDashedIcon,
  investigating: SearchIcon,
  fixing: WrenchIcon,
  monitoring: EyeIcon,
  resolved: CircleCheckIcon,
  declined: CircleSlashIcon,
};

/** Sample counts for the plural message: zero, one, few, and a count that needs a separator. */
const SAMPLE_COUNTS = [0, 1, 3, 1284];

export function LegendCard() {
  return (
    <Card aria-labelledby="legend-title">
      <CardHeader>
        <CardTitle id="legend-title">{m.legend_title()}</CardTitle>
        <CardDescription>{m.legend_description()}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <Group id="legend-severity" title={m.legend_severity()}>
          <ul className="flex flex-wrap gap-2">
            {SEVERITIES.map((severity) => (
              <li key={severity}>
                <Badge variant={severity}>
                  {severity === "sev1" ? <OctagonAlertIcon aria-hidden /> : null}
                  <span className="font-bold">{severity.toUpperCase()}</span>
                  <span>{severityLabels[severity]()}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </Group>

        <Group id="legend-status" title={m.legend_status()}>
          <ul className="flex flex-wrap gap-2">
            {INCIDENT_STATUSES.map((status) => {
              const Icon = STATUS_ICONS[status];
              return (
                <li key={status}>
                  <Badge variant={status}>
                    <Icon aria-hidden />
                    {incidentStatusLabels[status]()}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Group>

        <Group id="legend-counts" title={m.legend_counts()} className="md:col-span-2 lg:col-span-1">
          <ul className="flex flex-col divide-y rounded-md border text-sm">
            {SAMPLE_COUNTS.map((count) => (
              <li key={count} className="px-3 py-2 tabular-nums">
                {m.incidents_active_count({ count })}
              </li>
            ))}
          </ul>
        </Group>
      </CardContent>
    </Card>
  );
}

function Group({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <h3 id={id} className="mb-3 text-sm font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
