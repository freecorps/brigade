import { m } from "@freecorps/brigade-i18n";
import { INCIDENT_STATUSES, SEVERITIES } from "@freecorps/brigade-schema";
import { SeverityBadge, StatusBadge } from "@/components/incident-badges";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

/** Sample counts for the plural message: zero, one, few, and a count that needs a separator. */
const SAMPLE_COUNTS = [0, 1, 3, 1284];

export function LegendCard() {
  return (
    <Card aria-labelledby="legend-title">
      <CardHeader id="legend-title" title={m.legend_title()} description={m.legend_description()} />
      <CardContent className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
        <Group id="legend-severity" title={m.legend_severity()}>
          <ul className="flex flex-wrap gap-2">
            {SEVERITIES.map((severity) => (
              <li key={severity}>
                <SeverityBadge severity={severity} />
              </li>
            ))}
          </ul>
        </Group>

        <Group id="legend-status" title={m.legend_status()}>
          <ul className="flex flex-wrap gap-2">
            {INCIDENT_STATUSES.map((status) => (
              <li key={status}>
                <StatusBadge status={status} />
              </li>
            ))}
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
